package dev.codeatlas.modelclient;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.api.dto.ModelTestResponse;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.explanations.BoundedWorkMetrics;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Semaphore;

/** OpenAI-compatible adapter with independent hard request/response byte limits. */
@Service
public class ModelClientService {
    private final CodeAtlasProperties properties;
    private final BoundedWorkMetrics metrics;
    private final ObjectMapper json = new ObjectMapper();
    private final Semaphore requests = new Semaphore(1, true);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(60))
        .followRedirects(HttpClient.Redirect.NEVER).build();

    @Autowired
    public ModelClientService(CodeAtlasProperties properties, BoundedWorkMetrics metrics) {
        this.properties = properties;
        this.metrics = metrics;
    }

    /** Kept for focused adapter tests outside Spring. */
    public ModelClientService(CodeAtlasProperties properties) {
        this(properties, new BoundedWorkMetrics());
    }

    public String normalizeBaseUrl(String rawUrl) {
        return rawUrl == null || rawUrl.isBlank() ? rawUrl : rawUrl.trim().replaceAll("/+$", "");
    }

    public static class ContextLimitException extends RuntimeException {
        public ContextLimitException() { super("The configured model rejected the input context size."); }
    }
    public static class OutputLimitException extends RuntimeException {
        public OutputLimitException() { super("The model response was truncated at its output limit."); }
    }
    public static class RequestLimitException extends RuntimeException {
        public RequestLimitException() { super("The bounded model request exceeds the configured request byte limit."); }
    }
    public static class OversizedResponseException extends RuntimeException {
        public OversizedResponseException() { super("The provider response exceeded the configured response byte limit; retry the bounded batch."); }
    }

    public ModelTestResponse testConnection() {
        String baseUrl = properties.getModel().getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank())
            return new ModelTestResponse(false, false, false, "Not configured", 0, List.of("No base URL configured"));
        String modelId = properties.getModel().getModelId();
        if (modelId == null || modelId.isBlank()) modelId = "gpt-4o";
        long start = System.currentTimeMillis();
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("model", modelId);
            body.put("messages", List.of(Map.of("role", "user", "content", "Reply with 'OK' only.")));
            body.put("temperature", 0.0);
            body.put("max_tokens", 10);
            RawResponse response = execute(endpoint(baseUrl), body);
            long latency = System.currentTimeMillis() - start;
            if (response.status() >= 200 && response.status() < 300)
                return new ModelTestResponse(true, true, true, modelId, latency, List.of("Connection successful"));
            return new ModelTestResponse(false, false, false, modelId, latency, List.of("HTTP " + response.status()));
        } catch (Exception e) {
            return new ModelTestResponse(false, false, false, modelId, System.currentTimeMillis() - start,
                List.of("Error: " + safeMessage(e)));
        }
    }

    public String getExplanation(String systemPrompt, String userPrompt) {
        return getExplanation(systemPrompt, userPrompt, properties.getModel().getOutputBudget());
    }

    public String getExplanation(String systemPrompt, String userPrompt, int outputTokens) {
        String baseUrl = properties.getModel().getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) throw new IllegalStateException("Configure a model endpoint before requesting explanations");
        // A declared output maximum above what the response-byte cap could ever hold is
        // never honorable: the response reader truncates/rejects past maxResponseBytes
        // regardless of what the provider sends. Never send a value the app itself cannot accept back.
        int responseCeiling = ModelRequestBudget.maxTokensForBytes(properties.getModel().getMaxResponseBytes());
        int maxTokens = outputTokens > 0 ? Math.min(outputTokens, responseCeiling) : 2048;
        metrics.prompt(systemPrompt, userPrompt);
        Map<String, Object> body = requestBody(systemPrompt, userPrompt, maxTokens);
        Map<String, Object> formatted = new LinkedHashMap<>(body);
        formatted.put("response_format", Map.of("type", "json_object"));
        RawResponse response = execute(endpoint(baseUrl), formatted);
        if (isContextLimit(response)) throw new ContextLimitException();
        if (response.status() == 400) {
            response = execute(endpoint(baseUrl), body);
            if (isContextLimit(response)) throw new ContextLimitException();
        }
        if (response.status() < 200 || response.status() >= 300)
            throw new RuntimeException("Model rejected the bounded request (HTTP " + response.status() + ")");
        return content(response.body());
    }

    private Map<String, Object> requestBody(String system, String user, int output) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", properties.getModel().getModelId());
        body.put("messages", List.of(Map.of("role", "system", "content", system), Map.of("role", "user", "content", user)));
        body.put("temperature", properties.getModel().getTemperature());
        body.put("max_tokens", output);
        return body;
    }

    private RawResponse execute(String url, Map<String, Object> body) {
        byte[] payload;
        try { payload = json.writeValueAsBytes(body); }
        catch (Exception e) { throw new IllegalStateException("Could not encode bounded model request", e); }
        if (payload.length > properties.getModel().getMaxRequestBytes()) throw new RequestLimitException();
        boolean acquired = false;
        try {
            requests.acquire();
            acquired = true;
            try (AutoCloseable ignored = metrics.requestStarted()) {
                HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(Math.max(1, properties.getModel().getTimeoutSeconds())))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofByteArray(payload));
                String userAgent = properties.getModel().getUserAgent();
                if (userAgent != null && !userAgent.isBlank()) request.header("User-Agent", userAgent.trim());
                String apiKey = properties.getModel().getApiKey();
                if (apiKey != null && !apiKey.isBlank()) request.header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey.trim());
                HttpResponse<InputStream> response = client.send(request.build(), HttpResponse.BodyHandlers.ofInputStream());
                int max = properties.getModel().getMaxResponseBytes();
                byte[] bytes;
                try (InputStream stream = response.body()) { bytes = stream.readNBytes(max + 1); }
                metrics.responseBytes(bytes.length);
                if (bytes.length > max) throw new OversizedResponseException();
                return new RawResponse(response.statusCode(), bytes);
            }
        } catch (OversizedResponseException | RequestLimitException e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new RuntimeException("Model request interrupted"); }
        catch (Exception e) { throw new RuntimeException("Failed to request configured model: " + safeMessage(e), e); }
        finally { if (acquired) requests.release(); }
    }

    private String content(byte[] response) {
        try {
            JsonNode root = json.readTree(response);
            JsonNode choice = root.path("choices").path(0);
            if ("length".equals(choice.path("finish_reason").asText())) throw new OutputLimitException();
            if (root.hasNonNull("error")) throw new RuntimeException("Model provider rejected the bounded request");
            JsonNode value = choice.path("message").path("content");
            if (!value.isTextual()) throw new RuntimeException("Empty or invalid response from model");
            String content = value.asText();
            if (BoundedWorkMetrics.utf8Bytes(content) > properties.getModel().getMaxResponseBytes()) throw new OversizedResponseException();
            return stripMarkdownCodeFences(content);
        } catch (OutputLimitException | OversizedResponseException e) { throw e; }
        catch (RuntimeException e) { throw e; }
        catch (Exception e) { throw new RuntimeException("Invalid bounded response from model", e); }
    }

    private boolean isContextLimit(RawResponse response) {
        String body = new String(response.body(), StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
        return response.status() == 413 || (response.status() == 400 || response.status() == 422)
            && (body.contains("context_length_exceeded") || body.contains("maximum context length") || body.contains("context window")
                || body.contains("input too long") || body.contains("prompt is too long") || body.contains("too many input tokens")
                || (body.contains("input token") && (body.contains("exceed") || body.contains("limit"))));
    }

    private String endpoint(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        return normalized + (normalized.endsWith("/chat/completions") ? "" : "/chat/completions");
    }

    private String safeMessage(Exception error) {
        String value = error.getMessage();
        if (value == null || value.isBlank()) return error.getClass().getSimpleName();
        String apiKey = properties.getModel().getApiKey();
        if (apiKey != null && !apiKey.isBlank()) value = value.replace(apiKey.trim(), "[REDACTED]");
        return value.substring(0, Math.min(300, value.length()));
    }

    private record RawResponse(int status, byte[] body) {}

    public static String stripMarkdownCodeFences(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();
        int firstBrace = trimmed.indexOf('{');
        int lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace != -1 && lastBrace > firstBrace) return trimmed.substring(firstBrace, lastBrace + 1).trim();
        if (trimmed.startsWith("```")) {
            StringBuilder result = new StringBuilder(trimmed.length());
            for (String line : trimmed.split("\n")) if (!line.trim().startsWith("```")) result.append(line).append('\n');
            return result.toString().trim();
        }
        return trimmed;
    }
}
