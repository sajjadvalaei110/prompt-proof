package dev.codeatlas.modelclient;

import dev.codeatlas.api.dto.ModelTestResponse;
import dev.codeatlas.config.CodeAtlasProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ModelClientServiceTest {

    private CodeAtlasProperties properties;
    private ModelClientService service;

    @BeforeEach
    void setUp() {
        properties = new CodeAtlasProperties();
        service = new ModelClientService(properties);
    }

    @Test
    void testConnectionWhenNotConfigured() {
        properties.getModel().setBaseUrl(null);
        ModelTestResponse response = service.testConnection();
        assertFalse(response.reachable());
        assertFalse(response.chatWorking());
        assertEquals("Not configured", response.actualModelId());
        assertTrue(response.capabilities().contains("No base URL configured"));
    }

    @Test
    void unconfiguredExplanationDoesNotUseAnyDefaultEndpoint() {
        assertThrows(IllegalStateException.class, () -> service.getExplanation("system", "synthetic source"));
    }

    @Test
    void testConnectionGracefulFailureOnUnreachableEndpoint() {
        properties.getModel().setBaseUrl("http://127.0.0.1:59123/v1");
        properties.getModel().setModelId("gpt-4o");
        properties.getModel().setApiKey("sk-test-token");
        properties.getModel().setTimeoutSeconds(1);

        ModelTestResponse response = service.testConnection();
        assertFalse(response.reachable());
        assertFalse(response.chatWorking());
        assertEquals("gpt-4o", response.actualModelId());
        assertFalse(response.capabilities().isEmpty());
    }

    @Test
    void testStripMarkdownCodeFences() {
        String fenced = "```json\n{\n  \"shortLabel\": \"OrderController\"\n}\n```";
        String stripped = ModelClientService.stripMarkdownCodeFences(fenced);
        assertEquals("{\n  \"shortLabel\": \"OrderController\"\n}", stripped);

        String withSurroundingText = "Here is the explanation:\n```json\n{\"shortLabel\":\"Test\"}\n```\nHope this helps!";
        assertEquals("{\"shortLabel\":\"Test\"}", ModelClientService.stripMarkdownCodeFences(withSurroundingText));

        String rawJson = "{\"status\": \"ok\"}";
        assertEquals("{\"status\": \"ok\"}", ModelClientService.stripMarkdownCodeFences(rawJson));
    }

    @Test
    void testNormalizeBaseUrl() {
        assertEquals("https://api.agentrouter.org/v1", service.normalizeBaseUrl("https://api.agentrouter.org/v1"));
        assertEquals("https://agentrouter.org/v1", service.normalizeBaseUrl("https://agentrouter.org/v1/"));
        assertEquals("http://localhost:11434/v1", service.normalizeBaseUrl("http://localhost:11434/v1/"));
    }
}
