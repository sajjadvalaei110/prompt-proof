package dev.codeatlas.analysis;

import dev.codeatlas.api.dto.GraphResponse;
import dev.codeatlas.graph.GraphQueryService;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Performance and scale benchmark verification against test-fixtures/large-project (100 classes).
 * Validates:
 * 1. Two-pass parsing and symbol extraction across 100 classes.
 * 2. Relationship extraction and resolution.
 * 3. Graph query latency and node/edge traversal.
 * 4. SQLite WAL journal mode and foreign key integrity.
 * 5. Bounded memory consumption.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
public class LargeProjectBenchmarkTest {

    private static final Logger log = LoggerFactory.getLogger(LargeProjectBenchmarkTest.class);

    @Autowired
    private AnalysisService analysisService;

    @Autowired
    private GraphQueryService graphQueryService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void testLargeProjectBenchmark100Classes() {
        Path fixturePath = Path.of("test-fixtures/large-project").toAbsolutePath();
        assertTrue(fixturePath.toFile().exists(), "Large project fixture must exist at " + fixturePath);

        // 1. Setup workspace (handle existing record gracefully)
        String workspaceId;
        List<String> existing = jdbcTemplate.queryForList(
                "SELECT id FROM workspaces WHERE canonical_root = ?", String.class, fixturePath.toString());
        if (!existing.isEmpty()) {
            workspaceId = existing.get(0);
        } else {
            workspaceId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                    "INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'large-project-benchmark', datetime('now'), datetime('now'))",
                    workspaceId, fixturePath.toString()
            );
        }

        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))",
                jobId, workspaceId
        );

        // 2. Measure analysis performance (100 classes)
        long parseStartTime = System.currentTimeMillis();
        analysisService.runAnalysis(workspaceId, jobId);
        long parseDurationMs = System.currentTimeMillis() - parseStartTime;

        log.info("BENCHMARK: 100-class parse and relationship extraction completed in {} ms", parseDurationMs);

        // 3. Verify snapshot publication and counts
        Map<String, Object> workspace = jdbcTemplate.queryForMap("SELECT * FROM workspaces WHERE id = ?", workspaceId);
        String snapshotId = (String) workspace.get("active_snapshot_id");
        assertNotNull(snapshotId, "Active snapshot must be published");

        Map<String, Object> snapshot = jdbcTemplate.queryForMap("SELECT * FROM snapshots WHERE id = ?", snapshotId);
        assertEquals("published", snapshot.get("status"));

        int symbolCount = (int) snapshot.get("symbol_count");
        int relationshipCount = (int) snapshot.get("relationship_count");

        log.info("BENCHMARK: Indexed {} symbols, {} total relationships", symbolCount, relationshipCount);

        // 100 classes + 200 methods + 10 packages = 310 symbols
        assertEquals(310, symbolCount, "Must index 310 symbols (10 packages, 100 classes, 200 methods)");
        assertEquals(770, relationshipCount, "Must extract 770 total relationships");

        // Verify exactly 100 classes were parsed
        int classCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM symbol_versions WHERE snapshot_id = ? AND kind = 'CLASS'",
                Integer.class, snapshotId);
        assertEquals(100, classCount, "Must have exactly 100 classes indexed");

        // Verify all 10 packages are represented
        List<String> packages = jdbcTemplate.queryForList(
                "SELECT qualified_name FROM symbol_versions WHERE snapshot_id = ? AND kind = 'PACKAGE'",
                String.class, snapshotId);
        for (int i = 0; i < 10; i++) {
            String expectedPkg = "com.example.largeproject.pkg" + i;
            assertTrue(packages.contains(expectedPkg), "Must contain package " + expectedPkg);
        }

        // 4. Measure graph query latency
        long graphQueryStartTime = System.currentTimeMillis();
        GraphResponse graphResponse = graphQueryService.getGraph(snapshotId);
        long graphQueryDurationMs = System.currentTimeMillis() - graphQueryStartTime;

        log.info("BENCHMARK: Graph query returned {} nodes and {} edges in {} ms",
                graphResponse.nodes().size(), graphResponse.edges().size(), graphQueryDurationMs);

        assertEquals(310, graphResponse.nodes().size(), "Graph response must contain all 310 nodes");

        int resolvedEdgeCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM relationship_occurrences WHERE snapshot_id = ? AND target_symbol_id IS NOT NULL",
                Integer.class, snapshotId);
        assertEquals(resolvedEdgeCount, graphResponse.edges().size(), "Graph edges must match internal resolved relationship count (470)");
        assertEquals(470, graphResponse.edges().size());
        assertTrue(graphQueryDurationMs < 500, "Graph query latency must be < 500ms (was: " + graphQueryDurationMs + "ms)");

        // 5. Verify SQLite WAL mode and Database Integrity
        String journalMode = jdbcTemplate.queryForObject("PRAGMA journal_mode;", String.class);
        log.info("BENCHMARK: SQLite journal mode: {}", journalMode);
        assertEquals("wal", journalMode.toLowerCase(), "SQLite must be running in WAL mode");

        List<Map<String, Object>> fkViolations = jdbcTemplate.queryForList("PRAGMA foreign_key_check;");
        assertTrue(fkViolations.isEmpty(), "Foreign key check must return zero violations: " + fkViolations);

        String integrityResult = jdbcTemplate.queryForObject("PRAGMA integrity_check;", String.class);
        assertEquals("ok", integrityResult.toLowerCase(), "SQLite integrity check must report 'ok'");

        // 6. Memory consumption verification
        Runtime runtime = Runtime.getRuntime();
        runtime.gc();
        long usedMemoryMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024);
        log.info("BENCHMARK: JVM Used Memory after 100-class indexing: {} MB", usedMemoryMb);
        assertTrue(usedMemoryMb < 512, "Used heap memory must remain bounded under 512 MB (was " + usedMemoryMb + " MB)");

        // Latency assertion: 100 classes parsed and resolved under 30 seconds
        assertTrue(parseDurationMs < 30000, "100-class parse should complete under 30s (was " + parseDurationMs + "ms)");
    }
}
