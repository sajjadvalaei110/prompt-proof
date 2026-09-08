package dev.codeatlas.analysis;

import dev.codeatlas.explanations.ExplanationQueueService;
import dev.codeatlas.explanations.QueueStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * End-to-end integration test verifying Milestone R3 (Spring Comprehension)
 * and Milestone R4 (Explanation Queue and Incremental Analysis) against
 * the test-fixtures/spring-project codebase.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
public class AnalysisServiceSpringIntegrationTest {

    @Autowired
    private AnalysisService analysisService;

    @Autowired
    private ExplanationQueueService explanationQueueService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void testEndToEndSpringAnalysisAndExplanationQueue() {
        // 1. Setup workspace pointing to spring fixture
        Path fixturePath = Path.of("test-fixtures/spring-project").toAbsolutePath();
        assertTrue(fixturePath.toFile().exists(), "Fixture path must exist");

        String workspaceId;
        List<String> existing = jdbcTemplate.queryForList(
                "SELECT id FROM workspaces WHERE canonical_root = ?", String.class, fixturePath.toString());
        if (!existing.isEmpty()) {
            workspaceId = existing.get(0);
        } else {
            workspaceId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                    "INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'spring-test', datetime('now'), datetime('now'))",
                    workspaceId, fixturePath.toString()
            );
        }
        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))",
                jobId, workspaceId
        );

        // 2. Run analysis
        analysisService.runAnalysis(workspaceId, jobId);

        // 3. Verify snapshot is published
        Map<String, Object> workspace = jdbcTemplate.queryForMap("SELECT * FROM workspaces WHERE id = ?", workspaceId);
        String snapshotId = (String) workspace.get("active_snapshot_id");
        assertNotNull(snapshotId, "Active snapshot must be published");

        Map<String, Object> snapshot = jdbcTemplate.queryForMap("SELECT * FROM snapshots WHERE id = ?", snapshotId);
        assertEquals("published", snapshot.get("status"));
        assertTrue((int) snapshot.get("symbol_count") > 50, "Symbols count should exceed 50");
        assertTrue((int) snapshot.get("relationship_count") > 30, "Relationships count should exceed 30");

        // 4. Verify R3: HTTP Routes
        List<Map<String, Object>> routes = jdbcTemplate.queryForList(
                "SELECT * FROM http_routes WHERE snapshot_id = ? ORDER BY path, http_method", snapshotId);
        assertEquals(7, routes.size(), "Should find exactly 7 HTTP routes");

        boolean hasUserGet = routes.stream().anyMatch(r -> "/api/users".equals(r.get("path")) && "GET".equals(r.get("http_method")));
        boolean hasUserPost = routes.stream().anyMatch(r -> "/api/users".equals(r.get("path")) && "POST".equals(r.get("http_method")));
        boolean hasUserDelete = routes.stream().anyMatch(r -> "/api/users/{id}".equals(r.get("path")) && "DELETE".equals(r.get("http_method")));
        boolean hasOrderPost = routes.stream().anyMatch(r -> "/api/orders".equals(r.get("path")) && "POST".equals(r.get("http_method")));
        boolean hasOrderGet = routes.stream().anyMatch(r -> "/api/orders/{id}".equals(r.get("path")) && "GET".equals(r.get("http_method")));

        assertTrue(hasUserGet, "Should contain GET /api/users");
        assertTrue(hasUserPost, "Should contain POST /api/users");
        assertTrue(hasUserDelete, "Should contain DELETE /api/users/{id}");
        assertTrue(hasOrderPost, "Should contain POST /api/orders");
        assertTrue(hasOrderGet, "Should contain GET /api/orders/{id}");

        // 5. Verify R3: Spring Components & Stereotypes
        List<Map<String, Object>> components = jdbcTemplate.queryForList(
                "SELECT qualified_name, roles, spring_metadata FROM symbol_versions WHERE snapshot_id = ? AND roles IS NOT NULL AND roles != '[]'",
                snapshotId
        );
        assertEquals(10, components.size(), "Should detect exactly 10 Spring components");

        boolean hasCreditCard = components.stream().anyMatch(c ->
                ((String) c.get("qualified_name")).contains("CreditCardPaymentService") &&
                ((String) c.get("spring_metadata")).contains("primaryPayment")
        );
        assertTrue(hasCreditCard, "CreditCardPaymentService should have primaryPayment qualifier in metadata");

        // 6. Verify R3: Dependency Injections
        List<Map<String, Object>> injections = jdbcTemplate.queryForList(
                "SELECT * FROM injection_points WHERE snapshot_id = ?", snapshotId);
        assertEquals(7, injections.size(), "Should extract 7 injection points");

        long resolvedCount = injections.stream().filter(ip -> "RESOLVED".equals(ip.get("resolution"))).count();
        assertTrue(resolvedCount >= 6, "At least 6 of 7 injection points should be RESOLVED (found " + resolvedCount + ")");

        // Check CreditCardPaymentService matched via qualifier
        Map<String, Object> paymentInjection = injections.stream()
                .filter(ip -> "primaryPayment".equals(ip.get("qualifier_value")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("PaymentService injection point missing"));
        assertEquals("RESOLVED", paymentInjection.get("resolution"));
        assertTrue(((String) paymentInjection.get("resolved_candidates")).contains("CreditCardPaymentService"));

        // 7. Verify R3: Relationship Occurrences
        List<String> edgeKinds = jdbcTemplate.queryForList(
                "SELECT DISTINCT kind FROM relationship_occurrences WHERE snapshot_id = ?", String.class, snapshotId);
        assertTrue(edgeKinds.contains("INJECTS"), "Must contain INJECTS edges");
        assertTrue(edgeKinds.contains("DECLARES_BEAN"), "Must contain DECLARES_BEAN edges");
        assertTrue(edgeKinds.contains("IMPLEMENTS"), "Must contain IMPLEMENTS edges");
        assertTrue(edgeKinds.contains("CALLS"), "Must contain CALLS edges");
        assertTrue(edgeKinds.contains("DEPENDS_ON"), "Must contain DEPENDS_ON edges");

        // 8. Verify R4: Explanation Queue, Priority, and Cancellation
        String firstSymbolId = (String) components.get(0).get("qualified_name");

        // Enqueue high priority user request
        explanationQueueService.enqueueExplanation(workspaceId, snapshotId, firstSymbolId, "symbol");
        QueueStatus statusAfterSingle = explanationQueueService.getQueueStatus(workspaceId);
        assertTrue(statusAfterSingle.pending() >= 1, "Queue must have at least 1 pending item");

        // Start bulk Explain All
        String bulkJobId = explanationQueueService.startExplainAllJob(workspaceId, snapshotId, 1);
        assertNotNull(bulkJobId, "Bulk job ID must not be null");

        QueueStatus statusAfterBulk = explanationQueueService.getQueueStatus(workspaceId);
        assertTrue(statusAfterBulk.pending() > 10, "Bulk job must have enqueued >10 items");
        assertEquals(bulkJobId, statusAfterBulk.activeJobId(), "Active job ID must match");

        // Cancel job
        explanationQueueService.cancelJob(bulkJobId);
        QueueStatus statusAfterCancel = explanationQueueService.getQueueStatus(workspaceId);
        assertTrue(statusAfterCancel.skipped() > 0, "Cancelled bulk items must be SKIPPED");
        assertNull(statusAfterCancel.activeJobId(), "No active job ID after cancellation");

        // 9. Verify R4: Incremental Analysis
        String secondJobId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))",
                secondJobId, workspaceId
        );
        analysisService.runAnalysis(workspaceId, secondJobId);

        String secondSnapshotId = jdbcTemplate.queryForObject(
                "SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        assertNotEquals(snapshotId, secondSnapshotId, "Incremental run must publish a new snapshot");
    }
}
