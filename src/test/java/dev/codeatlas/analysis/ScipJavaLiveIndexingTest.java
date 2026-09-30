package dev.codeatlas.analysis;

import dev.codeatlas.analysis.scip.ScipJavaTool;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The real scip-java engine: scip-java runs the fixture's Gradle build (offline first, with the machine's
 * Gradle cache) in a private copy, and the index feeds the graph. Skipped, not failed, when scip-java is not
 * installed ({@code ./gradlew installScipJava}) because this is the only test that needs the tool and Gradle.
 */
@SpringBootTest
class ScipJavaLiveIndexingTest {

    private static final Path FIXTURE = Path.of("test-fixtures/scip-gradle-project").toAbsolutePath().normalize();
    private static final Path DATA;
    static { try { DATA = Files.createTempDirectory("atlas-scip-live-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", DATA::toString);
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("test.db"));
        registry.add("codeatlas.indexers.scip-java.home", () -> Path.of("data/tools/scip-java").toAbsolutePath().toString());
    }

    @Autowired AnalysisService analysisService;
    @Autowired ScipJavaTool tool;
    @Autowired JdbcTemplate db;

    @Test void realGradleBuildIsIndexedWithoutTouchingTheRepository() throws Exception {
        Assumptions.assumeTrue(tool.launcher().isPresent(), "scip-java is not installed; run ./gradlew installScipJava");
        String before = treeHash(FIXTURE);
        String workspaceId = UUID.randomUUID().toString(), jobId = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces (id, canonical_root, display_name, language, indexer, trust_state, created_at, updated_at) VALUES (?, ?, 'live', 'java', 'scip-java', 'build_allowed', datetime('now'), datetime('now'))",
                workspaceId, FIXTURE.resolve("app").toString());
        db.update("INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))", jobId, workspaceId);

        analysisService.runAnalysis(workspaceId, jobId);

        Map<String, Object> job = db.queryForMap("SELECT status, error_message FROM jobs WHERE id = ?", jobId);
        assertEquals("COMPLETED", job.get("status"), String.valueOf(job.get("error_message")));
        String snapshot = db.queryForObject("SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM relationship_occurrences r JOIN symbol_versions t ON t.id = r.target_symbol_id " +
                "WHERE r.snapshot_id = ? AND r.kind = 'CALLS' AND t.qualified_name = 'com.example.app.GreetingService.greetAll(List<String>)'", Integer.class, snapshot));
        assertTrue(db.queryForObject("SELECT COUNT(*) FROM code_occurrences WHERE snapshot_id = ?", Integer.class, snapshot) > 30);
        assertEquals(before, treeHash(FIXTURE), "the fixture must be byte-identical after indexing (no build/ or .gradle/ written)");
        try (Stream<Path> work = Files.list(DATA.resolve("indexer-work"))) {
            assertEquals(List.of(), work.toList(), "the private build copy is removed after the run");
        }
    }

    private static String treeHash(Path root) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : files.sorted().toList()) {
                digest.update(root.relativize(file).toString().getBytes());
                if (Files.isRegularFile(file)) digest.update(Files.readAllBytes(file));
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }
}
