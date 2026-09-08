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
public class ModelProfileApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void testGetProfilesReturnsActiveProfile() throws Exception {
        mockMvc.perform(get("/api/model-profiles"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].contextBudget", greaterThan(0)))
                .andExpect(jsonPath("$[0].outputBudget", greaterThan(0)));
    }

    @Test
    void testUpdateProfileAndTestEndpoint() throws Exception {
        String updatePayload = """
        {
            "baseUrl": "http://127.0.0.1:11434/v1",
            "modelId": "qwen2.5-coder",
            "apiKey": "sk-secret-test-token",
            "contextBudget": 16384,
            "outputBudget": 4096,
            "timeoutSeconds": 45,
            "temperature": 0.3
        }
        """;

        mockMvc.perform(post("/api/model-profiles")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updatePayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.baseUrl", is("http://127.0.0.1:11434/v1")))
                .andExpect(jsonPath("$.modelId", is("qwen2.5-coder")))
                .andExpect(jsonPath("$.hasApiKey", is(true)))
                .andExpect(jsonPath("$.temperature", is(0.3)))
                .andExpect(jsonPath("$.contextBudget", is(16384)))
                .andExpect(jsonPath("$.outputBudget", is(4096)))
                .andExpect(jsonPath("$.timeoutSeconds", is(45)));

        // GET should now reflect hasApiKey true, but NEVER leak the raw token in plaintext
        mockMvc.perform(get("/api/model-profiles"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].baseUrl", is("http://127.0.0.1:11434/v1")))
                .andExpect(jsonPath("$[0].hasApiKey", is(true)))
                .andExpect(content().string(not(containsString("sk-secret-test-token"))));

        // Test endpoint should execute and return response without throwing 500
        mockMvc.perform(post("/api/model-profiles/test")
                .contentType(MediaType.APPLICATION_JSON)
                .content(updatePayload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actualModelId", is("qwen2.5-coder")));
    }
}
