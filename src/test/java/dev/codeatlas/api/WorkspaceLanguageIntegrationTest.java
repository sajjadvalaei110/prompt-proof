package dev.codeatlas.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class WorkspaceLanguageIntegrationTest {
    private static final Path DATA_DIR = createDataDirectory();

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @TempDir Path directory;

    @DynamicPropertySource
    static void isolatedDataDirectory(DynamicPropertyRegistry properties) {
        properties.add("codeatlas.data-dir", () -> DATA_DIR.toString());
        properties.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA_DIR.resolve("codeatlas.db"));
    }

    @Test void omittedAndNormalizedJavaReuseTheSameWorkspace() throws Exception {
        String original = mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                .content("{\"path\":\".\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.language").value("java"))
                .andReturn().getResponse().getContentAsString();
        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                .content("{\"path\":\".\",\"language\":\" JAVA \"}"))
                .andExpect(status().isOk()).andExpect(content().json(original));
    }

    @Test void unshippedLanguageIsRejectedBeforeCreatingWorkspace() throws Exception {
        Integer before = db.queryForObject("SELECT count(*) FROM workspaces", Integer.class);
        for (String language : new String[]{"go", "dart", "unknown"}) {
            mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"path\":\".\",\"language\":\"" + language + "\"}"))
                    .andExpect(status().isBadRequest());
        }
        assertEquals(before, db.queryForObject("SELECT count(*) FROM workspaces", Integer.class));
    }

    @Test void existingWorkspaceWithAnotherLanguageIsRejectedAsBadRequest() throws Exception {
        Path root = Files.createDirectory(directory.resolve("other-language"));
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO workspaces(id,canonical_root,display_name,language,created_at,updated_at) "
                        + "VALUES(?,?,?,'go',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                id, root.toRealPath().toString(), "Other language");

        mvc.perform(post("/api/workspaces").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"path\":\"" + root.toRealPath() + "\",\"language\":\"java\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("A workspace for this path already exists with language 'go'. Choose that language or use a different path."));

        assertEquals(1, db.queryForObject("SELECT count(*) FROM workspaces WHERE id=?", Integer.class, id));
    }

    private static Path createDataDirectory() {
        try {
            return Files.createTempDirectory("atlas-workspace-language-");
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }
}
