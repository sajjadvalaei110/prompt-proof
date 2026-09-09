package dev.codeatlas.explanations;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
public class ContextBuilderTest {

    @Autowired
    private ContextBuilder contextBuilder;

    @Autowired
    private PromptTemplate promptTemplate;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private String workspaceId;
    private String snapshotId;
    private String classId;

    @BeforeEach
    void setUp() {
        workspaceId = UUID.randomUUID().toString();
        snapshotId = UUID.randomUUID().toString();
        classId = UUID.randomUUID().toString();

        jdbcTemplate.update("INSERT INTO workspaces (id, canonical_root, display_name, created_at, updated_at) VALUES (?, ?, 'ws', datetime('now'), datetime('now'))",
                workspaceId, "/tmp/ws-" + workspaceId);
        jdbcTemplate.update("INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'published', datetime('now'))",
                snapshotId, workspaceId);

        // Insert logical symbol
        jdbcTemplate.update("INSERT INTO logical_symbols (workspace_id, key) VALUES (?, 'com.example.OrderController')", workspaceId);

        // Insert symbol version
        jdbcTemplate.update("INSERT INTO symbol_versions (id, snapshot_id, logical_symbol_key, workspace_id, kind, qualified_name, simple_name, roles, content_hash) " +
                "VALUES (?, ?, 'com.example.OrderController', ?, 'CLASS', 'com.example.OrderController', 'OrderController', '[\"REST_CONTROLLER\"]', 'hash-123')",
                classId, snapshotId, workspaceId);

        // Insert route
        jdbcTemplate.update("INSERT INTO http_routes (id, snapshot_id, symbol_version_id, http_method, path) " +
                "VALUES (?, ?, ?, 'POST', '/api/orders')", UUID.randomUUID().toString(), snapshotId, classId);

        // Insert injection point
        jdbcTemplate.update("INSERT INTO injection_points (id, snapshot_id, source_symbol_id, target_type_name, injection_kind, qualifier_value, resolution) " +
                "VALUES (?, ?, ?, 'OrderService', 'CONSTRUCTOR', 'primary', 'RESOLVED')",
                UUID.randomUUID().toString(), snapshotId, classId);

        // Insert source file version
        jdbcTemplate.update("INSERT INTO source_file_versions (id, snapshot_id, relative_path, content_hash, source_content) " +
                "VALUES (?, ?, 'OrderController.java', 'hash-123', '@RestController\npublic class OrderController {\n  private final OrderService service;\n}')",
                UUID.randomUUID().toString(), snapshotId);
    }

    @Test
    void testBuildSymbolContextExtractsFactsAndEvidence() {
        ContextBuilder.SymbolContext ctx = contextBuilder.buildSymbolContext(snapshotId, classId);

        assertNotNull(ctx);
        assertEquals("OrderController", ctx.simpleName());
        assertEquals("com.example.OrderController", ctx.qualifiedName());
        assertEquals("CLASS", ctx.kind());
        assertTrue(ctx.roles().contains("REST_CONTROLLER"));
        assertNotNull(ctx.sourceSnippet());
        assertTrue(ctx.sourceSnippet().contains("class OrderController"));

        // Evidence assertions
        assertTrue(ctx.evidenceItems().stream().anyMatch(e -> e.id().equals("ev-roles")));
        assertTrue(ctx.evidenceItems().stream().anyMatch(e -> e.id().equals("ev-route-1")));
        assertTrue(ctx.evidenceItems().stream().anyMatch(e -> e.id().equals("ev-inj-1")));
        assertTrue(ctx.evidenceItems().stream().anyMatch(e -> e.id().equals("ev-source")));

        // Prompt formatting
        String sysPrompt = promptTemplate.getSystemPrompt();
        assertTrue(sysPrompt.contains("CRITICAL GROUNDING INVARIANTS"));
        assertTrue(sysPrompt.contains("SOURCE_FACT"));

        String userPrompt = promptTemplate.getUserPrompt(ctx);
        assertTrue(userPrompt.contains("OrderController"));
        assertTrue(userPrompt.contains("ev-roles"));
        assertTrue(userPrompt.contains("ev-route-1"));
        assertTrue(userPrompt.contains("ev-inj-1"));
        assertTrue(userPrompt.contains("ev-source"));
    }
}
