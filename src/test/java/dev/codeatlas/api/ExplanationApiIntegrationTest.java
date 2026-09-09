package dev.codeatlas.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
public class ExplanationApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void testGetExplanationNotRequestedReturnsNotRequestedStatus() throws Exception {
        String snapshotId = UUID.randomUUID().toString();
        String symbolId = UUID.randomUUID().toString();

        mockMvc.perform(get("/api/snapshots/{snapshotId}/symbols/{symbolId}/explanation", snapshotId, symbolId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("NOT_REQUESTED")))
                .andExpect(jsonPath("$.claims", hasSize(0)));
    }

    @Test
    void testGetExplanationQueuedWhenInExplanationQueue() throws Exception {
        String workspaceId = UUID.randomUUID().toString();
        String snapshotId = UUID.randomUUID().toString();
        String symbolId = UUID.randomUUID().toString();

        jdbcTemplate.update(
                "INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, priority, status, attempt_count, max_retries, dedup_key, created_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, 'symbol', 100, 'PENDING', 0, 3, ?, datetime('now'), datetime('now'))",
                UUID.randomUUID().toString(), workspaceId, snapshotId, symbolId, snapshotId + ":symbol:" + symbolId
        );

        mockMvc.perform(get("/api/snapshots/{snapshotId}/symbols/{symbolId}/explanation", snapshotId, symbolId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("QUEUED")));
    }

    @Test
    void testGetExplanationReadyWhenPersistedInExplanationsTable() throws Exception {
        String workspaceId = UUID.randomUUID().toString();
        String snapshotId = UUID.randomUUID().toString();
        String symbolId = UUID.randomUUID().toString();

        // Ensure workspace & snapshot exist for FK
        jdbcTemplate.update(
                "INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'ws', datetime('now'), datetime('now'))",
                workspaceId, "/tmp/ws-" + workspaceId
        );
        jdbcTemplate.update(
                "INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'published', datetime('now'))",
                snapshotId, workspaceId
        );

        String claimsJson = """
        [
          {
            "description": "OrderController handles REST requests.",
            "basis": "SOURCE_FACT",
            "evidenceIds": ["ev-source", "ev-roles"]
          }
        ]
        """;
        String unknownsJson = "[\"Internal service logic unknown\"]";
        String suggestedJson = "[\"OrderService\"]";

        jdbcTemplate.update(
                "INSERT INTO explanations (id, subject_version_id, subject_type, snapshot_id, status, schema_version, " +
                        "short_label, hover_summary, claims, unknowns, suggested_next_ids, model_id, prompt_version, created_at, updated_at, generated_at) " +
                        "VALUES (?, ?, 'symbol', ?, 'READY', '1', 'Order Controller', 'Handles incoming orders', ?, ?, ?, 'deepseek-v4-flash', '1.0', datetime('now'), datetime('now'), datetime('now'))",
                UUID.randomUUID().toString(), symbolId, snapshotId, claimsJson, unknownsJson, suggestedJson
        );

        mockMvc.perform(get("/api/snapshots/{snapshotId}/symbols/{symbolId}/explanation", snapshotId, symbolId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("READY")))
                .andExpect(jsonPath("$.shortLabel", is("Order Controller")))
                .andExpect(jsonPath("$.hoverSummary", is("Handles incoming orders")))
                .andExpect(jsonPath("$.claims", hasSize(1)))
                .andExpect(jsonPath("$.claims[0].description", is("OrderController handles REST requests.")))
                .andExpect(jsonPath("$.claims[0].basis", is("SOURCE_FACT")))
                .andExpect(jsonPath("$.claims[0].evidenceIds", contains("ev-source", "ev-roles")))
                .andExpect(jsonPath("$.unknowns", contains("Internal service logic unknown")))
                .andExpect(jsonPath("$.suggestedNextSymbolIds", contains("OrderService")))
                .andExpect(jsonPath("$.provenance", containsString("deepseek-v4-flash")));
    }
}
