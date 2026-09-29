package dev.codeatlas.api;

import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.explanations.ExplanationService;
import dev.codeatlas.modelclient.ModelClientService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Exercises real explanation persistence and retrieval after a V011 database is upgraded. */
@SpringBootTest
@AutoConfigureMockMvc
class LanguageMigrationExplanationIntegrationTest {
    private static final String WORKSPACE_ID = "v011-workspace";
    private static final String SNAPSHOT_ID = "v011-snapshot";
    private static final String SYMBOL_ID = "v011-symbol";
    private static final String LEGACY_EXPLANATION_ID = "v011-legacy-explanation";
    private static final String SYNTHETIC_RESPONSE = """
            {"shortLabel":"Migrated service","hoverSummary":"Runs the migrated service operation.",
             "claims":[{"description":"The class declares the service operation.",
             "basis":"SOURCE_FACT","evidenceIds":["ev-source"]}],
             "unknowns":["Runtime callers are not established."]}
            """;

    private static final Path DATA_DIRECTORY;
    private static final Path DATABASE_FILE;

    static {
        try {
            DATA_DIRECTORY = Files.createTempDirectory("code-atlas-v011-explanation-");
            DATABASE_FILE = DATA_DIRECTORY.resolve("codeatlas.db");
            seedVersionElevenDatabase(DATABASE_FILE);
        } catch (Exception error) {
            throw new ExceptionInInitializerError(error);
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("codeatlas.data-dir", () -> DATA_DIRECTORY.toString());
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATABASE_FILE);
    }

    @Autowired MockMvc mockMvc;
    @Autowired JdbcTemplate db;
    @Autowired CodeAtlasProperties properties;
    @Autowired ExplanationService explanations;
    @MockitoBean ModelClientService model;

    @BeforeEach
    void syntheticModelProfile() {
        properties.getModel().setBaseUrl("http://127.0.0.1:19999/v1");
        properties.getModel().setModelId("v011-synthetic-model");
        properties.getModel().setContextBudget(100_000);
        properties.getModel().setOutputBudget(4096);
        when(model.getExplanation(anyString(), anyString())).thenReturn(SYNTHETIC_RESPONSE);
    }

    @Test
    void migratedDatabaseCanGenerateAndServeAnExplanationForItsExistingSymbol() throws Exception {
        // V012 is applied by Spring Boot before this test, preserving both identities and
        // backfilling their language before the current explanation service uses the database.
        assertEquals("java", db.queryForObject(
                "SELECT language FROM workspaces WHERE id=?", String.class, WORKSPACE_ID));
        assertEquals("java", db.queryForObject(
                "SELECT language FROM snapshots WHERE id=?", String.class, SNAPSHOT_ID));
        assertEquals(LEGACY_EXPLANATION_ID, db.queryForObject(
                "SELECT id FROM explanations WHERE snapshot_id=? AND subject_version_id=?",
                String.class, SNAPSHOT_ID, SYMBOL_ID));
        assertEquals("Legacy label",
                db.queryForObject("SELECT short_label FROM explanations WHERE id=?", String.class, LEGACY_EXPLANATION_ID));

        // Invoke the same service entry point used by the explanation queue, then read through
        // the HTTP API to cover upgraded schema writes, provenance, and response mapping.
        explanations.explainSubject(SNAPSHOT_ID, SYMBOL_ID, "symbol");
        verify(model).getExplanation(anyString(), org.mockito.ArgumentMatchers.argThat(
                prompt -> prompt.contains("TARGET SYMBOL: " + SYMBOL_ID + " CLASS demo.MigratedService")
                        && prompt.contains("class MigratedService")));

        assertEquals(1, db.queryForObject(
                "SELECT COUNT(*) FROM explanations WHERE snapshot_id=? AND subject_version_id=?",
                Integer.class, SNAPSHOT_ID, SYMBOL_ID));
        assertEquals("READY", db.queryForObject(
                "SELECT status FROM explanations WHERE id=?", String.class, LEGACY_EXPLANATION_ID));
        assertNotEquals("legacy-fingerprint", db.queryForObject(
                "SELECT input_fingerprint FROM explanations WHERE id=?", String.class, LEGACY_EXPLANATION_ID));

        mockMvc.perform(get("/api/snapshots/{snapshotId}/symbols/{symbolId}/explanation", SNAPSHOT_ID, SYMBOL_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("READY")))
                .andExpect(jsonPath("$.shortLabel", is("Migrated service")))
                .andExpect(jsonPath("$.claims[0].evidenceIds[0]", is("ev-source")))
                .andExpect(jsonPath("$.provenance", containsString("v011-synthetic-model")));
    }

    private static void seedVersionElevenDatabase(Path database) {
        String url = "jdbc:sqlite:" + database;
        Flyway.configure().dataSource(url, "", "").target("11").load().migrate();
        JdbcTemplate oldDb = new JdbcTemplate(new DriverManagerDataSource(url));
        oldDb.update("""
                INSERT INTO workspaces(id,canonical_root,display_name,created_at,updated_at)
                VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                """, WORKSPACE_ID, "/fixture/v011", "V011 fixture");
        oldDb.update("""
                INSERT INTO snapshots(id,workspace_id,status,purpose,created_at)
                VALUES(?,?,'published','ANALYSIS',CURRENT_TIMESTAMP)
                """, SNAPSHOT_ID, WORKSPACE_ID);
        oldDb.update("UPDATE workspaces SET active_snapshot_id=? WHERE id=?", SNAPSHOT_ID, WORKSPACE_ID);
        oldDb.update("INSERT INTO logical_symbols(workspace_id,key) VALUES(?,?)", WORKSPACE_ID, "demo.MigratedService");
        oldDb.update("""
                INSERT INTO symbol_versions(id,snapshot_id,logical_symbol_key,workspace_id,kind,qualified_name,
                    simple_name,content_hash)
                VALUES(?,?,?,?,'CLASS','demo.MigratedService','MigratedService','v011-source-hash')
                """, SYMBOL_ID, SNAPSHOT_ID, "demo.MigratedService", WORKSPACE_ID);
        oldDb.update("""
                INSERT INTO source_file_versions(id,snapshot_id,relative_path,content_hash,source_content)
                VALUES('v011-file',?,'src/MigratedService.java','v011-source-hash',
                    'package demo; class MigratedService { void run() {} }')
                """, SNAPSHOT_ID);
        oldDb.update("""
                INSERT INTO evidence(id,source_file_version_id,start_line,start_column,end_line,end_column,snippet)
                VALUES('v011-evidence','v011-file',1,1,1,58,'class MigratedService { void run() {} }')
                """);
        oldDb.update("INSERT INTO symbol_evidence(symbol_version_id,evidence_id) VALUES(?, 'v011-evidence')", SYMBOL_ID);
        oldDb.update("""
                INSERT INTO explanations(id,subject_version_id,subject_type,snapshot_id,status,short_label,
                    hover_summary,claims,model_id,prompt_version,input_fingerprint,context_evidence,
                    provider_base_url,context_dependencies,created_at,updated_at)
                VALUES(?,?,'symbol',?,'READY','Legacy label','Legacy summary','[]','legacy-model','1.0',
                    'legacy-fingerprint','[]','mock://legacy','[]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
                """, LEGACY_EXPLANATION_ID, SYMBOL_ID, SNAPSHOT_ID);
    }
}
