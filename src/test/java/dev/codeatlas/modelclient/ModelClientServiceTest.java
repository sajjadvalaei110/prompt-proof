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
    void truncatedJsonIsRejectedBeforeItCanBeMistakenForACompleteAnswer() throws Exception {
        withProvider(200, "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{\\\"classes\\\":[]}\"}}]}", count -> {
            assertThrows(ModelClientService.OutputLimitException.class, () -> service.getExplanation("system", "synthetic", 512));
            assertEquals(1, count.get());
        });
    }

    @Test
    void contextRejectionDoesNotReplayIdenticalInputWithoutResponseFormat() throws Exception {
        withProvider(400, "{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"private input\"}}", count -> {
            var error = assertThrows(ModelClientService.ContextLimitException.class, () -> service.getExplanation("system", "synthetic"));
            assertFalse(error.getMessage().contains("private"));
            assertEquals(1, count.get());
        });
    }

    @Test
    void oversizedProviderResponseIsStoppedAtTheByteLimit() throws Exception {
        properties.getModel().setMaxResponseBytes(16_384);
        String response = "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"" + "x".repeat(20_000) + "\"}}]}";
        withProvider(200, response, count -> {
            assertThrows(ModelClientService.OversizedResponseException.class, () -> service.getExplanation("system", "synthetic"));
            assertEquals(1, count.get());
        });
    }

    private void withProvider(int status, String response, java.util.function.Consumer<java.util.concurrent.atomic.AtomicInteger> verify) throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var count = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/v1/chat/completions", exchange -> {
            count.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            byte[] body = response.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        properties.getModel().setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/v1");
        properties.getModel().setModelId("synthetic");
        try { verify.accept(count); } finally { server.stop(0); }
    }

    @Test
    void testNormalizeBaseUrl() {
        assertEquals("https://api.agentrouter.org/v1", service.normalizeBaseUrl("https://api.agentrouter.org/v1"));
        assertEquals("https://agentrouter.org/v1", service.normalizeBaseUrl("https://agentrouter.org/v1/"));
        assertEquals("http://localhost:11434/v1", service.normalizeBaseUrl("http://localhost:11434/v1/"));
    }
}
