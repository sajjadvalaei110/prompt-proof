package dev.codeatlas.analysis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import dev.codeatlas.graph.SourceService;
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
 * Java language edge cases for declaration and relationship extraction, each written as the smallest source that
 * reproduces one defect: symbol-key collisions, local classes, record compact constructors, static type imports,
 * names that are values rather than types, and self-construction.
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RelationshipEdgeCasesTest {

    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-edge-cases-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @Autowired private AnalysisService analysisService;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private SourceService sourceService;

    private List<Map<String, Object>> symbols;
    private List<Map<String, Object>> relationships;
    private String diagnostics;
    private String snapshotId;

    @BeforeAll
    void analyze() throws Exception {
        Path root = Files.createTempDirectory("atlas-edge-cases-src-");
        source(root, "edge/Clash.java", """
            package edge;
            public class Clash {
                public Clash() {}
                public void Clash() {}
            }""");
        source(root, "edge/Base.java", "package edge;\npublic class Base {}");
        source(root, "edge/Shape.java", "package edge;\npublic interface Shape {}");
        source(root, "edge/Circle.java", "package edge;\npublic class Circle extends Base implements Shape {}");
        source(root, "edge/Helper.java", "package edge;\npublic class Helper { public void help() {} }");
        source(root, "edge/UsesLocal.java", """
            package edge;
            public class UsesLocal {
                void first() { class Helper {} }
                void second() { class Helper {} }
            }""");
        source(root, "edge/Audit.java", "package edge;\npublic class Audit {}");
        source(root, "edge/Person.java", """
            package edge;
            public record Person(String name, int age) {
                public Person {
                    if (name == null) throw new IllegalArgumentException();
                    new Audit();
                }
            }""");
        source(root, "edge/People.java", """
            package edge;
            public class People {
                Person make() { return new Person("a", 1); }
            }""");
        // Annotations resolve through deterministic name lookup only, never the symbol solver.
        source(root, "edge/a/Outer.java", "package edge.a;\npublic class Outer { public @interface Tag {} }");
        source(root, "edge/b/Tag.java", "package edge.b;\npublic @interface Tag {}");
        source(root, "edge/b/StaticImporter.java", """
            package edge.b;
            import static edge.a.Outer.Tag;
            public class StaticImporter {
                @Tag void take() {}
            }""");
        source(root, "edge/Catcher.java", """
            package edge;
            public class Catcher {
                void caught() {
                    try { run(); } catch (com.unknown.LibraryException Audit) { Audit.report(); }
                }
                void matched(Object o) {
                    if (o instanceof com.unknown.Thing Audit) { Audit.report(); }
                }
                void run() {}
                Object caughtField() {
                    try { run(); } catch (com.unknown.LibraryException Audit) { return Audit.detail; }
                    return null;
                }
                Object matchedField(Object o) {
                    return o instanceof com.unknown.Thing Audit ? Audit.detail : null;
                }
                void known() {
                    try { run(); } catch (IllegalStateException Audit) { Audit.getMessage(); }
                }
            }""");
        source(root, "edge/Level.java", "package edge;\npublic enum Level { LOW }");
        source(root, "edge/Branches.java", """
            package edge;
            public class Branches {
                Object branch(boolean flag) {
                    if (flag) { int Level = 1; return Level; }
                    else { return Level.LOW; }
                }
            }""");
        source(root, "edge/a/Status.java", "package edge.a;\npublic class Status { public static int CODE; }");
        source(root, "edge/Chain.java", """
            package edge;
            public class Chain {
                Object read(Object a) { return a.Status.CODE; }
            }""");
        source(root, "edge/Singleton.java", """
            package edge;
            public class Singleton {
                public static final Singleton INSTANCE = new Singleton();
            }""");

        // The same type declared by two files: whichever is indexed second fails and must leave nothing behind.
        source(root, "edge/dup/one/Dup.java", "package edge.dup;\npublic class Dup { void first() {} }");
        source(root, "edge/dup/two/Dup.java", "package edge.dup;\npublic class Dup { void second() {} }");
        StringBuilder manySites = new StringBuilder("package edge;\npublic class ManySites {\n");
        for (int i = 0; i < 13; i++) manySites.append("    Audit site").append(i).append("() { return null; }\n");
        source(root, "edge/ManySites.java", manySites.append("}").toString());

        String workspaceId = UUID.randomUUID().toString(), jobId = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'edge-cases', datetime('now'), datetime('now'))", workspaceId, root.toString());
        jdbcTemplate.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);
        analysisService.runAnalysis(workspaceId, jobId);
        snapshotId = jdbcTemplate.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotNull(snapshotId, "Analysis must publish a snapshot");
        diagnostics = jdbcTemplate.queryForObject("SELECT diagnostics FROM snapshots WHERE id = ?", String.class, snapshotId);
        symbols = jdbcTemplate.queryForList("SELECT id, kind, qualified_name FROM symbol_versions WHERE snapshot_id = ?", snapshotId);
        relationships = jdbcTemplate.queryForList("SELECT source_symbol_id, target_symbol_id, kind FROM relationship_occurrences WHERE snapshot_id = ?", snapshotId);
    }

    @Test
    void methodNamedLikeItsTypeDoesNotCollideWithTheConstructor() {
        assertFalse(diagnostics.contains("Clash.java"), diagnostics);
        assertEquals("METHOD", kindOf("edge.Clash.Clash()"));
        assertEquals("CONSTRUCTOR", kindOf("edge.Clash.<init>()"));
    }

    @Test
    void inheritanceIsSummarizedAsDependsOn() {
        assertHas("EXTENDS", "edge.Circle", "edge.Base");
        assertHas("IMPLEMENTS", "edge.Circle", "edge.Shape");
        assertHas("DEPENDS_ON", "edge.Circle", "edge.Base");
        assertHas("DEPENDS_ON", "edge.Circle", "edge.Shape");
    }

    @Test
    void localClassesAreNotIndexedAsTopLevelTypes() {
        assertFalse(diagnostics.contains("UsesLocal.java") || diagnostics.contains("Helper.java"), diagnostics);
        assertEquals("CLASS", kindOf("edge.Helper"));
        assertEquals("METHOD", kindOf("edge.Helper.help()"));
        assertEquals("CLASS", kindOf("edge.UsesLocal"));
    }

    @Test
    void recordCompactConstructorIsIndexedTargetedAndOwnsItsBody() {
        assertEquals("CONSTRUCTOR", kindOf("edge.Person.Person(String,int)"));
        assertHas("CONSTRUCTS", "edge.People.make()", "edge.Person.Person(String,int)");
        assertHas("CONSTRUCTS", "edge.Person.Person(String,int)", "edge.Audit");
    }

    @Test
    void singleStaticImportOfAMemberTypeWinsOverTheSamePackage() {
        assertHas("USES_TYPE", "edge.b.StaticImporter.take()", "edge.a.Outer.Tag");
        assertHasNot("edge.b.StaticImporter.take()", "edge.b.Tag");
    }

    @Test
    void catchParametersAndPatternVariablesAreValuesNotTypes() {
        assertHasNot("edge.Catcher", "edge.Audit");
        assertHasNot("edge.Catcher.caught()", "edge.Audit");
        assertHasNot("edge.Catcher.matched(Object)", "edge.Audit");
        assertHasNot("edge.Catcher.known()", "edge.Audit");
        assertHasNot("edge.Catcher.caughtField()", "edge.Audit");
        assertHasNot("edge.Catcher.matchedField(Object)", "edge.Audit");
    }

    @Test
    void aLocalInAnotherBranchDoesNotHideATypeName() {
        assertHas("USES_TYPE", "edge.Branches.branch(boolean)", "edge.Level");
        assertHas("DEPENDS_ON", "edge.Branches", "edge.Level");
    }

    @Test
    void aQualifiedNameRootedInAValueIsNotAType() {
        assertHasNot("edge.Chain", "edge.a.Status");
        assertHasNot("edge.Chain.read(Object)", "edge.a.Status");
    }

    @Test
    void noSelfEdgesAndOneUsesTypePerPair() {
        for (Map<String, Object> r : relationships) {
            if (r.get("target_symbol_id") != null) assertNotEquals(r.get("source_symbol_id"), r.get("target_symbol_id"), "self edge " + r);
        }
        Map<String, Long> usesType = relationships.stream().filter(r -> "USES_TYPE".equals(r.get("kind")))
                .collect(Collectors.groupingBy(r -> r.get("source_symbol_id") + "->" + r.get("target_symbol_id"), Collectors.counting()));
        assertTrue(usesType.values().stream().allMatch(count -> count == 1), usesType.toString());
    }

    @Test
    void aFileThatFailsDeclarationIndexingLeavesNoPartialRows() {
        List<String> files = jdbcTemplate.queryForList("SELECT relative_path FROM source_file_versions WHERE snapshot_id = ? AND relative_path LIKE '%Dup.java'", String.class, snapshotId);
        assertEquals(1, files.size(), files.toString());
        String indexed = files.get(0).contains("/one/") ? "first()" : "second()", failed = indexed.equals("first()") ? "second()" : "first()";
        assertEquals("METHOD", kindOf("edge.dup.Dup." + indexed));
        assertTrue(symbols.stream().noneMatch(s -> ("edge.dup.Dup." + failed).equals(s.get("qualified_name"))), "rolled back with its file");
        assertTrue(diagnostics.contains("Dup.java: declaration parsing failed"), diagnostics);
        assertFalse(diagnostics.contains("Dup.java: relationship parsing failed"), diagnostics);
    }

    @Test
    void relationshipSourceResponseIsBoundedAndReportsTheTotal() {
        String dependsOn = jdbcTemplate.queryForObject("SELECT id FROM relationship_occurrences WHERE snapshot_id = ? AND kind = 'DEPENDS_ON' AND source_symbol_id = ? AND target_symbol_id = ?",
                String.class, snapshotId, idOf("edge.ManySites"), idOf("edge.Audit"));
        List<SourceService.Source> sources = sourceService.relationship(snapshotId, dependsOn);
        assertEquals(12, sources.size(), "bounded by codeatlas.explanations.evidence-occurrences");
        assertTrue(sources.stream().allMatch(source -> source.totalSites() == 13), sources.stream().map(SourceService.Source::totalSites).toList().toString());
    }

    private static void source(Path root, String relative, String text) throws Exception {
        Path file = root.resolve("src/main/java").resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, text);
    }

    private String kindOf(String qualifiedName) {
        List<String> kinds = symbols.stream().filter(s -> qualifiedName.equals(s.get("qualified_name"))).map(s -> (String) s.get("kind")).toList();
        assertEquals(1, kinds.size(), "exactly one symbol named " + qualifiedName + "; symbols: "
                + symbols.stream().map(s -> s.get("kind") + " " + s.get("qualified_name")).sorted().toList() + "; diagnostics: " + diagnostics);
        return kinds.get(0);
    }

    private String idOf(String qualifiedName) {
        kindOf(qualifiedName);
        return symbols.stream().filter(s -> qualifiedName.equals(s.get("qualified_name"))).map(s -> (String) s.get("id")).findFirst().orElseThrow();
    }

    private void assertHas(String kind, String source, String target) {
        String sourceId = idOf(source), targetId = idOf(target);
        assertTrue(relationships.stream().anyMatch(r -> kind.equals(r.get("kind")) && sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))),
                "Expected " + kind + " " + source + " -> " + target + "; found from source: " + outgoing(sourceId));
    }

    private void assertHasNot(String source, String target) {
        String sourceId = idOf(source), targetId = idOf(target);
        assertTrue(relationships.stream().noneMatch(r -> sourceId.equals(r.get("source_symbol_id")) && targetId.equals(r.get("target_symbol_id"))),
                "Unexpected relationship " + source + " -> " + target + "; found from source: " + outgoing(sourceId));
    }

    private List<String> outgoing(String sourceId) {
        Map<String, String> names = symbols.stream().collect(Collectors.toMap(s -> (String) s.get("id"), s -> (String) s.get("qualified_name")));
        return relationships.stream().filter(r -> sourceId.equals(r.get("source_symbol_id")))
                .map(r -> r.get("kind") + " " + names.getOrDefault((String) r.get("target_symbol_id"), "<unresolved>")).sorted().toList();
    }
}
