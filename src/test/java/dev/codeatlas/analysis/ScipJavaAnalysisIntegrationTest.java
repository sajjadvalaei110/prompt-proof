package dev.codeatlas.analysis;

import dev.codeatlas.analysis.scip.ScipIndex;
import dev.codeatlas.analysis.scip.ScipJavaTool;
import dev.codeatlas.graph.NavigationService;
import dev.codeatlas.workspace.WorkspaceTrust;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The scip-java engine end to end through {@link AnalysisService}, with {@link ScipJavaTool#index} returning the
 * golden index scip-java 0.12.3 produced for {@code test-fixtures/scip-gradle-project} instead of running Gradle
 * (the live run is {@code ScipJavaLiveIndexingTest}). Build-root detection is real: workspaces are the fixture's
 * {@code app} module and the fixture root.
 */
@SpringBootTest
class ScipJavaAnalysisIntegrationTest {

    private static final Path FIXTURE = Path.of("test-fixtures/scip-gradle-project").toAbsolutePath().normalize();
    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-scip-db-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
    }

    @MockitoBean ScipJavaTool tool;
    @Autowired AnalysisService analysisService;
    @Autowired NavigationService navigationService;
    @Autowired JdbcTemplate db;

    private String analyze(Path workspace, String trust) throws Exception {
        when(tool.unavailableReason()).thenReturn(Optional.empty());
        when(tool.index(any(), any())).thenReturn(ScipIndex.read(Path.of("src/test/resources/scip/scip-gradle-project.scip")));
        // canonical_root is unique, so each path has one workspace; every test sets its engine and trust afresh.
        List<String> existing = db.queryForList("SELECT id FROM workspaces WHERE canonical_root = ?", String.class, workspace.toString());
        String workspaceId = existing.isEmpty() ? UUID.randomUUID().toString() : existing.get(0), jobId = UUID.randomUUID().toString();
        if (existing.isEmpty()) {
            db.update("INSERT INTO workspaces (id, canonical_root, display_name, language, created_at, updated_at) VALUES (?, ?, 'scip', 'java', datetime('now'), datetime('now'))",
                    workspaceId, workspace.toString());
        }
        db.update("UPDATE workspaces SET indexer = 'scip-java', trust_state = ? WHERE id = ?", trust, workspaceId);
        db.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);
        analysisService.runAnalysis(workspaceId, jobId);
        Map<String, Object> job = db.queryForMap("SELECT status, error_message FROM jobs WHERE id = ?", jobId);
        if (!"COMPLETED".equals(job.get("status"))) return "FAILED: " + job.get("error_message");
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        return snapshot;
    }

    private Set<String> relationships(String snapshot, String kind) {
        return db.queryForList("SELECT s.qualified_name AS source, t.qualified_name AS target FROM relationship_occurrences r " +
                        "JOIN symbol_versions s ON s.id = r.source_symbol_id JOIN symbol_versions t ON t.id = r.target_symbol_id " +
                        "WHERE r.snapshot_id = ? AND r.kind = ?", snapshot, kind).stream()
                .map(row -> row.get("source") + " -> " + row.get("target")).collect(Collectors.toSet());
    }

    @Test void wholeBuildProducesJavaParserShapedGraphFactsAndAnOccurrenceIndex() throws Exception {
        String snapshot = analyze(FIXTURE, WorkspaceTrust.BUILD_ALLOWED);
        assertFalse(snapshot.startsWith("FAILED"), snapshot);
        assertEquals("scip-java", db.queryForObject("SELECT indexer FROM snapshots WHERE id = ?", String.class, snapshot));

        Map<String, String> kinds = db.queryForList("SELECT qualified_name, kind FROM symbol_versions WHERE snapshot_id = ?", snapshot).stream()
                .collect(Collectors.toMap(r -> (String) r.get("qualified_name"), r -> (String) r.get("kind")));
        assertEquals(Map.ofEntries(
                Map.entry("com.example.app", "PACKAGE"), Map.entry("com.example.core", "PACKAGE"),
                Map.entry("com.example.app.Main", "CLASS"), Map.entry("com.example.app.Main.main(String[])", "METHOD"),
                Map.entry("com.example.app.GreetingService", "CLASS"),
                Map.entry("com.example.app.GreetingService.greetAll(List<String>)", "METHOD"),
                Map.entry("com.example.core.Greeter", "INTERFACE"), Map.entry("com.example.core.Greeter.greet(String)", "METHOD"),
                Map.entry("com.example.core.BaseGreeter", "CLASS"), Map.entry("com.example.core.BaseGreeter.BaseGreeter(String)", "CONSTRUCTOR"),
                Map.entry("com.example.core.BaseGreeter.decorate(String)", "METHOD"), Map.entry("com.example.core.BaseGreeter.decorate(String,int)", "METHOD"),
                Map.entry("com.example.core.FriendlyGreeter", "CLASS"), Map.entry("com.example.core.FriendlyGreeter.FriendlyGreeter()", "CONSTRUCTOR"),
                Map.entry("com.example.core.FriendlyGreeter.greet(String)", "METHOD"),
                Map.entry("com.example.core.Greeting", "RECORD"), Map.entry("com.example.core.Greeting.greet(String)", "METHOD"),
                Map.entry("com.example.core.Greeting.Builder", "CLASS"), Map.entry("com.example.core.Greeting.Builder.build()", "METHOD")), kinds,
                "implicit constructors, fields and locals are not graph symbols");
        assertEquals("String greet(String)", db.queryForObject("SELECT signature FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?", String.class, snapshot, "com.example.core.FriendlyGreeter.greet(String)"));
        assertEquals("[\"Override\"]", db.queryForObject("SELECT annotations FROM symbol_versions WHERE snapshot_id = ? AND qualified_name = ?", String.class, snapshot, "com.example.core.FriendlyGreeter.greet(String)"));

        assertEquals(Set.of("com.example.core.FriendlyGreeter -> com.example.core.BaseGreeter"), relationships(snapshot, "EXTENDS"));
        assertEquals(Set.of("com.example.core.BaseGreeter -> com.example.core.Greeter", "com.example.core.Greeting -> com.example.core.Greeter"),
                relationships(snapshot, "IMPLEMENTS"),
                "only direct supertypes (javac's transitive FriendlyGreeter -> Greeter is not an edge); a record's clause follows its components");
        assertEquals("com.example.core.Greeting", db.queryForObject("SELECT p.qualified_name FROM symbol_versions s JOIN symbol_versions p ON p.id = s.parent_symbol_id " +
                "WHERE s.snapshot_id = ? AND s.qualified_name = 'com.example.core.Greeting.Builder'", String.class, snapshot), "a nested type's parent is its outer type");
        assertEquals(Set.of(
                "com.example.app.Main.main(String[]) -> com.example.app.GreetingService.greetAll(List<String>)",
                "com.example.app.Main.main(String[]) -> com.example.core.Greeting.Builder.build()",
                "com.example.app.Main.main(String[]) -> com.example.core.Greeting.greet(String)",
                "com.example.app.GreetingService.greetAll(List<String>) -> com.example.core.Greeter.greet(String)",
                "com.example.core.BaseGreeter.decorate(String,int) -> com.example.core.BaseGreeter.decorate(String)",
                "com.example.core.FriendlyGreeter.greet(String) -> com.example.core.BaseGreeter.decorate(String)"),
                relationships(snapshot, "CALLS"), "overloads are told apart; JDK calls are not edges");
        assertEquals(Set.of(
                "com.example.app.Main.main(String[]) -> com.example.app.GreetingService",
                "com.example.app.Main.main(String[]) -> com.example.core.Greeting.Builder",
                "com.example.core.Greeting.Builder.build() -> com.example.core.Greeting",
                "com.example.app.GreetingService -> com.example.core.FriendlyGreeter.FriendlyGreeter()"),
                relationships(snapshot, "CONSTRUCTS"),
                "field initializers belong to the type; `new Outer.Inner()` is a construction; super(..) is not; implicit constructors target the type");
        assertEquals(Set.of("com.example.core.FriendlyGreeter.greet(String) -> com.example.core.Greeter.greet(String)",
                "com.example.core.Greeting.greet(String) -> com.example.core.Greeter.greet(String)"), relationships(snapshot, "OVERRIDES"),
                "subtype side only, including a record whose supertypes javac's SemanticDB omits");
        assertTrue(relationships(snapshot, "DEPENDS_ON").containsAll(Set.of(
                "com.example.app.Main -> com.example.app.GreetingService",
                "com.example.app.GreetingService -> com.example.core.Greeter",
                "com.example.app.GreetingService -> com.example.core.FriendlyGreeter",
                "com.example.core.FriendlyGreeter -> com.example.core.BaseGreeter")));
        // The engine's own facts are all javac-resolved. (The shared Spring pass still adds its own facts, e.g. an
        // UNRESOLVED INJECTS for BaseGreeter(String), exactly as it does for the JavaParser engine.)
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences WHERE snapshot_id = ? AND kind <> 'INJECTS' AND resolution <> 'RESOLVED'", Integer.class, snapshot));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences r WHERE snapshot_id = ? AND NOT EXISTS (SELECT 1 FROM relationship_evidence e WHERE e.relationship_id = r.id)", Integer.class, snapshot),
                "every relationship has evidence");

        // The call's evidence is the exact name token: `greeter.greet(name)` -> `greet`, line 14, columns 32-36.
        Map<String, Object> callEvidence = db.queryForMap("SELECT e.start_line, e.start_column, e.end_column, e.snippet FROM relationship_occurrences r " +
                "JOIN relationship_evidence re ON re.relationship_id = r.id JOIN evidence e ON e.id = re.evidence_id " +
                "JOIN symbol_versions t ON t.id = r.target_symbol_id WHERE r.snapshot_id = ? AND r.kind = 'CALLS' AND t.qualified_name = 'com.example.core.Greeter.greet(String)'", snapshot);
        assertEquals(List.of(14, 32, 36), List.of(callEvidence.get("start_line"), callEvidence.get("start_column"), callEvidence.get("end_column")));
        assertEquals("result.add(greeter.greet(name));", callEvidence.get("snippet"));

        // Go to definition: the call jumps across modules to the interface method...
        NavigationService.Definition greet = navigationService.definition(snapshot, "app/src/main/java/com/example/app/GreetingService.java", 14, 33);
        assertEquals("found", greet.status());
        assertEquals("core/src/main/java/com/example/core/Greeter.java", greet.locations().get(0).path());
        assertEquals(4, greet.locations().get(0).startLine());
        assertNotNull(greet.locations().get(0).symbolId());
        // ...a local variable to its declaration in the same file...
        NavigationService.Definition local = navigationService.definition(snapshot, "app/src/main/java/com/example/app/GreetingService.java", 14, 38);
        assertEquals("found", local.status());
        assertEquals(13, local.locations().get(0).startLine());
        assertEquals("String name", local.locations().get(0).signature());
        assertNull(local.locations().get(0).symbolId(), "locals are navigation data, not graph symbols");
        // ...and a JDK call reports that it is outside the workspace.
        assertEquals("external", navigationService.definition(snapshot, "app/src/main/java/com/example/app/GreetingService.java", 14, 21).status());
        assertEquals("no_symbol", navigationService.definition(snapshot, "app/src/main/java/com/example/app/GreetingService.java", 14, 1).status());
    }

    @Test void moduleWorkspaceIndexesOnlyItsModuleAndTreatsSiblingModulesAsExternal() throws Exception {
        String snapshot = analyze(FIXTURE.resolve("app"), WorkspaceTrust.BUILD_ALLOWED);
        assertFalse(snapshot.startsWith("FAILED"), snapshot);
        assertEquals(List.of("src/main/java/com/example/app/GreetingService.java", "src/main/java/com/example/app/Main.java"),
                db.queryForList("SELECT relative_path FROM source_file_versions WHERE snapshot_id = ? ORDER BY relative_path", String.class, snapshot));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM symbol_versions WHERE snapshot_id = ? AND qualified_name LIKE 'com.example.core%'", Integer.class, snapshot));
        assertEquals(Set.of("com.example.app.Main.main(String[]) -> com.example.app.GreetingService.greetAll(List<String>)"), relationships(snapshot, "CALLS"));
        assertEquals("external", navigationService.definition(snapshot, "src/main/java/com/example/app/GreetingService.java", 14, 33).status());
        String warnings = db.queryForObject("SELECT diagnostics FROM snapshots WHERE id = ?", String.class, snapshot);
        assertTrue(warnings.contains("indexed its app directory"), warnings);
    }

    @Test void buildEngineDoesNotRunWithoutRecordedConsent() throws Exception {
        String result = analyze(FIXTURE, WorkspaceTrust.SOURCE_ONLY);
        assertTrue(result.startsWith("FAILED") && result.contains("was not allowed"), result);
        verify(tool, never()).index(any(), any());
    }

    @Test void snapshotDeletionRemovesItsOccurrences() throws Exception {
        String snapshot = analyze(FIXTURE, WorkspaceTrust.BUILD_ALLOWED);
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM code_occurrences WHERE snapshot_id = ?", Integer.class, snapshot) > 0);
        db.update("DELETE FROM snapshots WHERE id = ?", snapshot);
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM code_occurrences WHERE snapshot_id = ?", Integer.class, snapshot));
    }
}
