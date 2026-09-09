package dev.codeatlas.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.hamcrest.Matchers.*;

@SpringBootTest
@AutoConfigureMockMvc
public class WorkspaceApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void testCreateWorkspaceEmptyPathReturns400() throws Exception {
        String payload = """
        { "path": "" }
        """;

        mockMvc.perform(post("/api/workspaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status", is(400)))
                .andExpect(jsonPath("$.error", is("Bad Request")))
                .andExpect(jsonPath("$.message", containsString("must not be empty")));
    }

    @Test
    void testCreateWorkspaceNonExistentPathReturns400() throws Exception {
        String payload = """
        { "path": "/path/that/definitely/does/not/exist/anywhere" }
        """;

        mockMvc.perform(post("/api/workspaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status", is(400)))
                .andExpect(jsonPath("$.error", is("Bad Request")))
                .andExpect(jsonPath("$.message", containsString("Path does not exist")));
    }

    @Test
    void testCreateWorkspaceFilePathReturns400() throws Exception {
        java.io.File tempFile = java.io.File.createTempFile("codeatlas-test", ".txt");
        tempFile.deleteOnExit();

        String payload = String.format("{\"path\": \"%s\"}", tempFile.getAbsolutePath());

        mockMvc.perform(post("/api/workspaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status", is(400)))
                .andExpect(jsonPath("$.error", is("Bad Request")))
                .andExpect(jsonPath("$.message", containsString("Path is a file, not a directory")));
    }

    @Test
    void testCreateWorkspaceQuotedPathReturns200() throws Exception {
        String payload = """
        { "path": "\\" . \\"" }
        """;

        mockMvc.perform(post("/api/workspaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", notNullValue()));
    }

    @Test
    void testCreateWorkspaceTildePathReturns200() throws Exception {
        String payload = """
        { "path": "~" }
        """;

        mockMvc.perform(post("/api/workspaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.path", is(System.getProperty("user.home"))));
    }
}
