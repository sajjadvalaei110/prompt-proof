package dev.codeatlas.analysis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Java visibility and scoping edge cases for the ADR 0010 post-pass, each written as the smallest source that
 * reproduces one review finding: package-private methods across packages (C1) and parameter types that share a simple
 * name (C2, decision F1) for OVERRIDES. The C3/C4 sources (implicit calls inside anonymous and local classes, nest
 * access to private outer members) once pinned candidate-call scoping; candidate calls were withdrawn (ADR 0010,
 * 2026-09-25 "candidate calls reverted"), so they now pin that each such call stays UNRESOLVED with no target and that
 * no CALLS/CANDIDATE exists anywhere.
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OverridesAndUnresolvedCallEdgeCasesTest {

    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-candidate-edges-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @Autowired private AnalysisService analysisService;
    @Autowired private JdbcTemplate jdbcTemplate;

    private Map<String, String> idByName;
    private Map<String, String> nameById;
    private List<Map<String, Object>> relationships;

    @BeforeAll
    void analyze() throws Exception {
        Path root = Files.createTempDirectory("atlas-candidate-edges-src-");
        // C1: a package-private method is not inherited across packages (JLS 8.4.8.1).
        source(root, "a/Base.java", """
            package a;
            public class Base {
                void process(String s) {}
                protected void guard(String s) {}
            }""");
        source(root, "a/SamePackageChild.java", """
            package a;
            public class SamePackageChild extends Base {
                void process(String s) {}
            }""");
        source(root, "b/Child.java", """
            package b;
            public class Child extends a.Base {
                public void process(String s) {}
                protected void guard(String s) {}
            }""");
        // C2: parameter identity is the in-source type, not its simple name.
        source(root, "x/Value.java", "package x;\npublic class Value {}");
        source(root, "y/Value.java", "package y;\npublic class Value {}");
        source(root, "a/Sink.java", """
            package a;
            import x.Value;
            public class Sink {
                public void same(Value v) {}
                public void qualified(x.Value v) {}
                public void at(java.util.Date d) {}
            }""");
        source(root, "b/Overload.java", """
            package b;
            public class Overload extends a.Sink {
                public void same(y.Value v) {}
            }""");
        source(root, "b/Imported.java", """
            package b;
            import x.Value;
            public class Imported extends a.Sink {
                public void same(Value v) {}
                public void qualified(Value v) {}
            }""");
        source(root, "b/Qualified.java", """
            package b;
            public class Qualified extends a.Sink {
                public void same(x.Value v) {}
            }""");
        // F1: b.Date resolves in source, java.util.Date does not: an overload, never an OVERRIDES fact.
        source(root, "b/Date.java", "package b;\npublic class Date {}");
        source(root, "b/Local.java", """
            package b;
            public class Local extends a.Sink {
                public void at(Date d) {}
            }""");
        // C3: implicit calls inside anonymous and local class bodies.
        source(root, "c/Request.java", "package c;\npublic record Request(String value) {}");
        source(root, "c/Anonymous.java", """
            package c;
            public class Anonymous {
                public void helper(String s) {}
                public Runnable make(Request request) {
                    return new Runnable() {
                        public void helper(String s) {}
                        public void run() { helper(request.value()); }
                    };
                }
            }""");
        source(root, "c/LocalCaller.java", """
            package c;
            public class LocalCaller {
                public void helper(String s) {}
                public void make(Request request) {
                    class Worker {
                        void helper(String s) {}
                        void go() { helper(request.value()); }
                    }
                    new Worker().go();
                }
            }""");
        // C4: nest access to a private outer method, explicit and implicit.
        source(root, "c/Outer.java", """
            package c;
            public class Outer {
                private void work(String s) {}
                public class Inner {
                    public void run(Request r) { Outer.this.work(r.value()); work(r.value()); }
                }
            }""");
        // F3: the innermost enclosing type that has a method of that name wins (JLS 15.12.1).
        source(root, "c/Shadow.java", """
            package c;
            public class Shadow {
                private void work(String s) {}
                public class Inner {
                    void work(String s) {}
                    public void run(Request r) { work(r.value()); }
                }
            }""");

        String workspaceId = UUID.randomUUID().toString(), jobId = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'candidate-edges', datetime('now'), datetime('now'))", workspaceId, root.toString());
        jdbcTemplate.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);
        analysisService.runAnalysis(workspaceId, jobId);
        String snapshotId = jdbcTemplate.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotNull(snapshotId, "Analysis must publish a snapshot");
        List<Map<String, Object>> symbols = jdbcTemplate.queryForList("SELECT id, qualified_name FROM symbol_versions WHERE snapshot_id = ?", snapshotId);
        idByName = symbols.stream().collect(Collectors.toMap(s -> (String) s.get("qualified_name"), s -> (String) s.get("id")));
        nameById = symbols.stream().collect(Collectors.toMap(s -> (String) s.get("id"), s -> (String) s.get("qualified_name")));
        relationships = jdbcTemplate.queryForList("""
            SELECT r.id, r.source_symbol_id, r.target_symbol_id, r.unresolved_target, r.kind, r.resolution, r.reason
            FROM relationship_occurrences r WHERE r.snapshot_id = ?""", snapshotId);
    }

    // --- C1: package-private visibility.

    @Test
    void aPackagePrivateMethodIsNotOverriddenFromAnotherPackage() {
        assertNone("b.Child.process(String)", "a.Base.process(String)");
    }

    @Test
    void aPackagePrivateMethodIsOverriddenInTheSamePackage() {
        assertEquals("RESOLVED", only("OVERRIDES", "a.SamePackageChild.process(String)", "a.Base.process(String)").get("resolution"));
    }

    @Test
    void aProtectedMethodIsOverriddenFromAnotherPackage() {
        only("OVERRIDES", "b.Child.guard(String)", "a.Base.guard(String)");
    }

    // --- C2: parameter types that share a simple name.

    @Test
    void differentInSourceTypesWithOneSimpleNameAreAnOverload() {
        assertNone("b.Overload.same(y.Value)", "a.Sink.same(Value)");
    }

    @Test
    void theSameInSourceTypeOverridesWhetherImportedOrQualified() {
        only("OVERRIDES", "b.Imported.same(Value)", "a.Sink.same(Value)");
        only("OVERRIDES", "b.Imported.qualified(Value)", "a.Sink.qualified(x.Value)");
        only("OVERRIDES", "b.Qualified.same(x.Value)", "a.Sink.same(Value)");
    }

    @Test
    void aParameterResolvedOnOneSideOnlyIsNotAnOverride() {
        assertNone("b.Local.at(Date)", "a.Sink.at(java.util.Date)");
    }

    // --- C3: implicit calls inside anonymous and local class bodies stay UNRESOLVED.

    @Test
    void anImplicitCallInAnAnonymousClassIsNotAttributedToTheOuterType() {
        assertNone("c.Anonymous.make(Request)", "c.Anonymous.helper(String)");
        assertUnresolved("c.Anonymous.make(Request)", "helper(request.value())");
    }

    @Test
    void anImplicitCallInALocalClassIsNotAttributedToTheOuterType() {
        assertNone("c.LocalCaller.make(Request)", "c.LocalCaller.helper(String)");
        assertUnresolved("c.LocalCaller.make(Request)", "helper(request.value())");
    }

    // --- C4: calls on private outer members the solver cannot type stay UNRESOLVED.

    @Test
    void outerPrivateMethodCallsWithUntypedArgumentsStayUnresolved() {
        assertUnresolved("c.Outer.Inner.run(Request)", "Outer.this.work(r.value())");
        assertUnresolved("c.Outer.Inner.run(Request)", "work(r.value())");
        assertNone("c.Outer.Inner.run(Request)", "c.Outer.work(String)");
        assertNone("c.Outer.Inner.run(Request)", "c.Outer");
    }

    @Test
    void aShadowedImplicitCallStaysUnresolved() {
        assertUnresolved("c.Shadow.Inner.run(Request)", "work(r.value())");
        assertNone("c.Shadow.Inner.run(Request)", "c.Shadow.Inner.work(String)");
        assertNone("c.Shadow.Inner.run(Request)", "c.Shadow.work(String)");
    }

    @Test
    void noCallIsACandidate() {
        assertTrue(relationships.stream().noneMatch(r -> "CALLS".equals(r.get("kind")) && "CANDIDATE".equals(r.get("resolution"))),
                "CALLS/CANDIDATE found: " + relationships.stream().filter(r -> "CANDIDATE".equals(r.get("resolution"))).toList());
    }

    private List<Map<String, Object>> matching(String kind, String source, String target) {
        String sourceId = id(source), targetId = id(target);
        return relationships.stream().filter(r -> kind.equals(r.get("kind")) && sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))).toList();
    }

    private Map<String, Object> only(String kind, String source, String target) {
        List<Map<String, Object>> found = matching(kind, source, target);
        assertEquals(1, found.size(), "Expected one " + kind + " " + source + " -> " + target + "; found from source: " + outgoing(id(source)));
        return found.get(0);
    }

    private void assertNone(String source, String target) {
        String sourceId = id(source), targetId = id(target);
        assertTrue(relationships.stream().noneMatch(r -> sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))),
                "Unexpected relationship " + source + " -> " + target + "; found from source: " + outgoing(sourceId));
    }

    private void assertUnresolved(String source, String call) {
        String sourceId = id(source);
        assertTrue(relationships.stream().anyMatch(r -> sourceId.equals(r.get("source_symbol_id")) && call.equals(r.get("unresolved_target"))
                        && "UNRESOLVED".equals(r.get("resolution")) && r.get("target_symbol_id") == null && "Static target unavailable in indexed source".equals(r.get("reason"))),
                call + " stays UNRESOLVED; found from source: " + outgoing(sourceId));
    }

    private String id(String qualifiedName) {
        String id = idByName.get(qualifiedName);
        assertNotNull(id, "No symbol " + qualifiedName + "; symbols: " + new TreeSet<>(idByName.keySet()));
        return id;
    }

    private List<String> outgoing(String sourceId) {
        return relationships.stream().filter(r -> sourceId.equals(r.get("source_symbol_id")))
                .map(r -> r.get("kind") + " " + r.get("resolution") + " " + nameById.getOrDefault((String) r.get("target_symbol_id"), "<" + r.get("unresolved_target") + ">")).sorted().toList();
    }

    private static void source(Path root, String relative, String text) throws Exception {
        Path file = root.resolve("src/main/java").resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, text);
    }
}
