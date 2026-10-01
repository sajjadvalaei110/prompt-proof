package dev.codeatlas.analysis;

import dev.codeatlas.analysis.scip.ScipBuildFailedException;
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

    private static ScipIndex golden() throws Exception {
        return ScipIndex.read(Path.of("src/test/resources/scip/scip-gradle-project.scip"));
    }

    /** What the real tool returns for the golden index: the indexed sources as the build compiled them (here, the fixture's). */
    private static ScipJavaTool.IndexedBuild goldenBuild(ScipJavaTool.BuildLayout layout, Map<String, String> replacedSources) throws Exception {
        ScipIndex index = golden();
        Map<String, String> sources = new java.util.HashMap<>(ScipJavaTool.captureSources(index, layout.buildRoot(), layout.modulePath()));
        replacedSources.forEach((path, content) -> { if (content == null) sources.remove(path); else sources.put(path, content); });
        return new ScipJavaTool.IndexedBuild(index, sources);
    }

    private String analyze(Path workspace, String trust) throws Exception {
        return analyze(workspace, trust, invocation -> goldenBuild(invocation.getArgument(0), Map.of()));
    }

    private String analyze(Path workspace, String trust, org.mockito.stubbing.Answer<ScipJavaTool.IndexedBuild> build) throws Exception {
        when(tool.unavailableReason()).thenReturn(Optional.empty());
        when(tool.index(any(), any())).thenAnswer(build);
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
                Map.entry("com.example.app.Factories", "CLASS"), Map.entry("com.example.app.Factories.plain()", "METHOD"),
                Map.entry("com.example.app.Factories.commented()", "METHOD"), Map.entry("com.example.app.Factories.qualified()", "METHOD"),
                Map.entry("com.example.app.Factories.reference()", "METHOD"),
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
                "com.example.app.GreetingService -> com.example.core.FriendlyGreeter.FriendlyGreeter()",
                "com.example.app.Factories.plain() -> com.example.app.GreetingService",
                "com.example.app.Factories.commented() -> com.example.app.GreetingService",
                "com.example.app.Factories.qualified() -> com.example.core.FriendlyGreeter.FriendlyGreeter()",
                "com.example.app.Factories.reference() -> com.example.app.GreetingService"),
                relationships(snapshot, "CONSTRUCTS"),
                "field initializers belong to the type; `new Outer.Inner()` is a construction; super(..) is not; implicit constructors target the type; "
                        + "`new` split from its type by newlines, comments or a qualifier, and `T\n::new`, are constructions");
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

        // The file's occurrences (ADR 0013): the call token is one row whose symbol has one definition; the JDK's
        // `add` resolves outside the workspace (no definition in this snapshot).
        NavigationService.FileOccurrences occurrences = navigationService.occurrences(snapshot, "app/src/main/java/com/example/app/GreetingService.java");
        assertEquals("indexed", occurrences.status());
        assertEquals("scip-java", occurrences.indexer());
        assertFalse(occurrences.truncated());
        int[] call = occurrences.occurrences().stream().filter(r -> r[0] == 14 && r[1] == 32).findFirst().orElseThrow();
        assertEquals(36, call[3]);
        assertEquals(1, occurrences.symbols().get(call[4]).definitions());
        int[] add = occurrences.occurrences().stream().filter(r -> r[0] == 14 && r[1] == 20).findFirst().orElseThrow();
        assertEquals(0, occurrences.symbols().get(add[4]).definitions());
    }

    @Test void moduleWorkspaceIndexesOnlyItsModuleAndTreatsSiblingModulesAsExternal() throws Exception {
        String snapshot = analyze(FIXTURE.resolve("app"), WorkspaceTrust.BUILD_ALLOWED);
        assertFalse(snapshot.startsWith("FAILED"), snapshot);
        assertEquals(List.of("src/main/java/com/example/app/Factories.java", "src/main/java/com/example/app/GreetingService.java", "src/main/java/com/example/app/Main.java"),
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

    private static final String SERVICE = "app/src/main/java/com/example/app/GreetingService.java";

    /**
     * The index's ranges belong to the text the build compiled. When the file on disk differs (edited during the
     * build, or rewritten by a build task in the private copy), the snapshot keeps the indexed text — stored content,
     * symbol and relationship evidence — and says the disk changed.
     */
    @Test void snapshotKeepsTheIndexedTextWhenTheFileOnDiskDiffers() throws Exception {
        String disk = Files.readString(FIXTURE.resolve(SERVICE));
        String indexed = disk.replace("result.add(greeter.greet(name));", "result.add(greeter.greet(name)); // as compiled");
        assertNotEquals(disk, indexed);

        String snapshot = analyze(FIXTURE, WorkspaceTrust.BUILD_ALLOWED, invocation -> goldenBuild(invocation.getArgument(0), Map.of(SERVICE, indexed)));
        assertFalse(snapshot.startsWith("FAILED"), snapshot);

        assertEquals(indexed, db.queryForObject("SELECT source_content FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshot, SERVICE));
        Map<String, Object> callEvidence = db.queryForMap("SELECT e.start_line, e.start_column, e.snippet FROM relationship_occurrences r " +
                "JOIN relationship_evidence re ON re.relationship_id = r.id JOIN evidence e ON e.id = re.evidence_id " +
                "JOIN symbol_versions t ON t.id = r.target_symbol_id WHERE r.snapshot_id = ? AND r.kind = 'CALLS' AND t.qualified_name = 'com.example.core.Greeter.greet(String)'", snapshot);
        assertEquals("result.add(greeter.greet(name)); // as compiled", callEvidence.get("snippet"));
        String methodEvidence = db.queryForObject("SELECT e.snippet FROM symbol_versions s JOIN symbol_evidence se ON se.symbol_version_id = s.id " +
                "JOIN evidence e ON e.id = se.evidence_id WHERE s.snapshot_id = ? AND s.qualified_name = 'com.example.app.GreetingService.greetAll(List<String>)'", String.class, snapshot);
        assertTrue(methodEvidence.contains("// as compiled"), methodEvidence);
        String warnings = db.queryForObject("SELECT diagnostics FROM snapshots WHERE id = ?", String.class, snapshot);
        assertTrue(warnings.contains(SERVICE + ": changed on disk while scip-java indexed it"), warnings);
        assertFalse(warnings.contains("app/src/main/java/com/example/app/Main.java: changed on disk"), "unchanged files get no diagnostic: " + warnings);
    }

    /** A compiled file whose indexed text was not captured gets its disk content, a diagnostic and no facts. */
    @Test void fileWithoutCapturedIndexedTextIsStoredWithoutFacts() throws Exception {
        Map<String, String> missing = new java.util.HashMap<>();
        missing.put(SERVICE, null);
        String snapshot = analyze(FIXTURE, WorkspaceTrust.BUILD_ALLOWED, invocation -> goldenBuild(invocation.getArgument(0), missing));
        assertFalse(snapshot.startsWith("FAILED"), snapshot);

        assertEquals(Files.readString(FIXTURE.resolve(SERVICE)),
                db.queryForObject("SELECT source_content FROM source_file_versions WHERE snapshot_id = ? AND relative_path = ?", String.class, snapshot, SERVICE));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM symbol_versions WHERE snapshot_id = ? AND qualified_name LIKE 'com.example.app.GreetingService%'", Integer.class, snapshot));
        String warnings = db.queryForObject("SELECT diagnostics FROM snapshots WHERE id = ?", String.class, snapshot);
        assertTrue(warnings.contains(SERVICE + ": the text the Gradle build compiled is unavailable"), warnings);
    }

    /**
     * A failing build's output can contain credentials or source text: the job's error (display data) shows its
     * tail, while the application log gets only the sanitized message (AGENTS.md: keep them out of logs).
     */
    @Test void failedBuildOutputReachesTheJobErrorButNotTheLog() throws Exception {
        String secret = "ORG_GRADLE_PROJECT_token=s3cr3t-from-build-output";
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(AnalysisService.class);
        ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent> appender = new ch.qos.logback.core.read.ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            String result = analyze(FIXTURE, WorkspaceTrust.BUILD_ALLOWED, invocation -> {
                throw new ScipBuildFailedException("scip-java could not index the Gradle build at /x (exit code 1).", "> Task :compileJava FAILED\n" + secret);
            });

            assertTrue(result.startsWith("FAILED: scip-java could not index the Gradle build at /x (exit code 1)."), result);
            assertTrue(result.contains("Last build output:\n> Task :compileJava FAILED\n" + secret), "the user still sees the build output: " + result);
            String failedSnapshot = db.queryForObject("SELECT id FROM snapshots WHERE status = 'failed' ORDER BY rowid DESC LIMIT 1", String.class);
            assertTrue(db.queryForObject("SELECT diagnostics FROM snapshots WHERE id = ?", String.class, failedSnapshot).contains(secret));

            List<ch.qos.logback.classic.spi.ILoggingEvent> failures = appender.list.stream().filter(e -> e.getFormattedMessage().startsWith("Analysis failed")).toList();
            assertEquals(1, failures.size());
            assertNotNull(failures.get(0).getThrowableProxy(), "the failure is still logged with its stack trace");
            for (ch.qos.logback.classic.spi.ILoggingEvent event : appender.list) {
                assertFalse(event.getFormattedMessage().contains(secret), event.getFormattedMessage());
                for (var t = event.getThrowableProxy(); t != null; t = t.getCause()) {
                    assertFalse(String.valueOf(t.getMessage()).contains(secret), t.getMessage());
                }
            }
        } finally {
            logger.detachAppender(appender);
        }
    }
}
