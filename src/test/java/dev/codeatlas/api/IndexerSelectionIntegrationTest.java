package dev.codeatlas.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ADR 0012: choosing an indexing engine per workspace, and the explicit consent a build-running engine needs. */
@SpringBootTest
@AutoConfigureMockMvc
class IndexerSelectionIntegrationTest {
    private static final Path DATA_DIR;
    static { try { DATA_DIR = Files.createTempDirectory("atlas-indexers-"); } catch (Exception e) { throw new RuntimeException(e); } }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;

    @DynamicPropertySource
    static void isolatedDataDirectory(DynamicPropertyRegistry properties) {
        properties.add("codeatlas.data-dir", DATA_DIR::toString);
        properties.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA_DIR.resolve("codeatlas.db"));
        properties.add("codeatlas.indexers.scip-java.home", () -> DATA_DIR.resolve("no-tool").toString());
        properties.add("codeatlas.indexers.scip-java.command", () -> "no-such-scip-java");
    }

    private String create(String path, String body) throws Exception {
        return mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON).content(body.replace("PATH", path)))
                .andReturn().getResponse().getContentAsString();
    }

    @Test void enginesAreListedWithTheirAvailability() throws Exception {
        mvc.perform(get("/api/indexers")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].language").value("java"))
                .andExpect(jsonPath("$[0].indexer").value("javaparser"))
                .andExpect(jsonPath("$[0].defaultIndexer").value(true))
                .andExpect(jsonPath("$[0].executesTargetBuild").value(false))
                .andExpect(jsonPath("$[0].available").value(true))
                .andExpect(jsonPath("$[1].indexer").value("scip-java"))
                .andExpect(jsonPath("$[1].defaultIndexer").value(false))
                .andExpect(jsonPath("$[1].executesTargetBuild").value(true))
                .andExpect(jsonPath("$[1].available").value(false))
                .andExpect(jsonPath("$[1].unavailableReason").value(org.hamcrest.Matchers.containsString("installScipJava")));
    }

    @Test void buildEngineNeedsExplicitConsentAndIsRejectedBeforeRegistration() throws Exception {
        Path project = Files.createTempDirectory(DATA_DIR, "consent");
        Integer before = db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class);
        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"" + project + "\",\"indexer\":\"scip-java\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"" + project + "\",\"indexer\":\"no-such-engine\",\"allowBuildExecution\":true}"))
                .andExpect(status().isBadRequest());
        assertEquals(before, db.queryForObject("SELECT COUNT(*) FROM workspaces", Integer.class));

        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"" + project + "\",\"indexer\":\" SCIP-Java \",\"allowBuildExecution\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.indexer").value("scip-java"));
        assertEquals("build_allowed", db.queryForObject("SELECT trust_state FROM workspaces WHERE canonical_root = ?", String.class, project.toRealPath().toString()));
    }

    @Test void omittingTheEngineKeepsItAndChoosingSourceOnlyDropsBuildPermission() throws Exception {
        Path project = Files.createTempDirectory(DATA_DIR, "switch");
        String canonical = project.toRealPath().toString();
        create(project.toString(), "{\"path\":\"PATH\",\"indexer\":\"scip-java\",\"allowBuildExecution\":true}");

        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"" + project + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.indexer").value("scip-java"));
        assertEquals("build_allowed", db.queryForObject("SELECT trust_state FROM workspaces WHERE canonical_root = ?", String.class, canonical));

        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"" + project + "\",\"indexer\":\"javaparser\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.indexer").value("javaparser"));
        assertEquals("source_only", db.queryForObject("SELECT trust_state FROM workspaces WHERE canonical_root = ?", String.class, canonical));
    }

    @Test void defaultRegistrationStaysSourceOnlyJavaParser() throws Exception {
        Path project = Files.createTempDirectory(DATA_DIR, "default");
        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON).content("{\"path\":\"" + project + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.language").value("java")).andExpect(jsonPath("$.indexer").value("javaparser"));
        assertEquals("source_only", db.queryForObject("SELECT trust_state FROM workspaces WHERE canonical_root = ?", String.class, project.toRealPath().toString()));
    }
}
