package dev.codeatlas.modelclient;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.api.dto.ModelTestResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;

@Service
public class ModelClientService {

    private static final Logger log = LoggerFactory.getLogger(ModelClientService.class);

    private final CodeAtlasProperties properties;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ModelClientService(CodeAtlasProperties properties) {
        this.properties = properties;
    }

    private RestTemplate createRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        int timeoutSeconds = properties.getModel().getTimeoutSeconds();
        if (timeoutSeconds <= 0) {
            timeoutSeconds = 60;
        }
        int timeoutMs = timeoutSeconds * 1000;
        factory.setConnectTimeout(timeoutMs);
        factory.setReadTimeout(timeoutMs);
        return new RestTemplate(factory);
    }

    public String normalizeBaseUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return rawUrl;
        }
        return rawUrl.trim().replaceAll("/+$", "");
    }

    private HttpHeaders createHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String userAgent = properties.getModel().getUserAgent();
        if (userAgent != null && !userAgent.isBlank()) {
            headers.set("User-Agent", userAgent.trim());
        }

        String apiKey = properties.getModel().getApiKey();
        if (apiKey != null && !apiKey.isBlank()) {
            headers.setBearerAuth(apiKey.trim());
        }
        return headers;
    }

    private String sanitize(String message) {
        if (message == null) return "";
        String apiKey = properties.getModel().getApiKey();
        if (apiKey != null && !apiKey.isBlank() && message.contains(apiKey.trim())) {
            return message.replace(apiKey.trim(), "[REDACTED]");
        }
        return message;
    }

    public ModelTestResponse testConnection() {
        String baseUrl = properties.getModel().getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            return new ModelTestResponse(false, false, false, "Not configured", 0, List.of("No base URL configured"));
        }
        String modelId = properties.getModel().getModelId();
        if (modelId == null || modelId.isBlank()) {
            modelId = "gpt-4o";
        }

        String normalizedBase = normalizeBaseUrl(baseUrl);
        String url = normalizedBase + (normalizedBase.endsWith("/chat/completions") ? "" : "/chat/completions");
        long start = System.currentTimeMillis();

        try {
            HttpHeaders headers = createHeaders();

            Map<String, Object> requestBody = new LinkedHashMap<>();
            requestBody.put("model", modelId);
            requestBody.put("messages", List.of(Map.of("role", "user", "content", "Reply with 'OK' only.")));
            requestBody.put("temperature", 0.0);
            requestBody.put("max_tokens", 10);

            String payload = objectMapper.writeValueAsString(requestBody);

            ResponseEntity<Map> response = createRestTemplate().exchange(
                url,
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Map.class
            );

            long latency = System.currentTimeMillis() - start;
            boolean working = response.getStatusCode().is2xxSuccessful();
            return new ModelTestResponse(working, working, working, modelId, latency, List.of("Connection successful"));
        } catch (HttpStatusCodeException e) {
            long latency = System.currentTimeMillis() - start;
            String errorMsg = "HTTP " + e.getStatusCode().value() + " " + e.getStatusText();
            String responseBody = e.getResponseBodyAsString();
            if (responseBody != null && !responseBody.isBlank()) {
                errorMsg += ": " + sanitize(responseBody);
            }
            return new ModelTestResponse(false, false, false, modelId, latency, List.of(errorMsg));
        } catch (Exception e) {
            long latency = System.currentTimeMillis() - start;
            return new ModelTestResponse(false, false, false, modelId, latency, List.of(sanitize("Error: " + e.getMessage())));
        }
    }

    public String getExplanation(String systemPrompt, String userPrompt) {
        String baseUrl = properties.getModel().getBaseUrl();
        String modelId = properties.getModel().getModelId();
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException("Configure a model endpoint before requesting explanations");
        }
        String normalizedBase = normalizeBaseUrl(baseUrl);
        String url = normalizedBase + (normalizedBase.endsWith("/chat/completions") ? "" : "/chat/completions");

        HttpHeaders headers = createHeaders();
        double temperature = properties.getModel().getTemperature();
        int maxTokens = properties.getModel().getOutputBudget();
        if (maxTokens <= 0) {
            maxTokens = 2048;
        }

        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", modelId);
        requestBody.put("messages", List.of(
            Map.of("role", "system", "content", systemPrompt),
            Map.of("role", "user", "content", userPrompt)
        ));
        requestBody.put("temperature", temperature);
        requestBody.put("max_tokens", maxTokens);

        Map<String, Object> requestWithFormat = new LinkedHashMap<>(requestBody);
        requestWithFormat.put("response_format", Map.of("type", "json_object"));

        try {
            return executeChatCompletion(url, headers, requestWithFormat);
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 400) {
                log.info("Request with response_format failed (HTTP 400), retrying without response_format...");
                try {
                    return executeChatCompletion(url, headers, requestBody);
                } catch (Exception retryEx) {
                    throw new RuntimeException(sanitize("Failed to request model without response_format: " + retryEx.getMessage()), retryEx);
                }
            }
            throw new RuntimeException(sanitize("Failed to request model: HTTP " + e.getStatusCode().value()), e);
        } catch (Exception e) {
            String errStr = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
            if (errStr.contains("response_format") || errStr.contains("content-blocked") || errStr.contains("400")) {
                log.info("Retrying chat completion without response_format after provider rejection");
                try {
                    return executeChatCompletion(url, headers, requestBody);
                } catch (Exception retryEx) {
                    throw new RuntimeException(sanitize("Retry failed: " + retryEx.getMessage()), retryEx);
                }
            }
            throw new RuntimeException(sanitize("Failed to request model: " + e.getMessage()), e);
        }
    }

    private String executeChatCompletion(String url, HttpHeaders headers, Map<String, Object> requestBody) throws Exception {
        String payload = objectMapper.writeValueAsString(requestBody);

        ResponseEntity<Map> response = createRestTemplate().exchange(
            url,
            HttpMethod.POST,
            new HttpEntity<>(payload, headers),
            Map.class
        );

        if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
            Map body = response.getBody();
            if (body.containsKey("error") && body.get("error") != null) {
                Map errMap = (Map) body.get("error");
                String errMsg = errMap.get("message") != null ? errMap.get("message").toString() : errMap.toString();
                throw new RuntimeException(errMsg.toLowerCase().contains("response_format") ? "Model provider rejected response_format" : "Model provider rejected the request");
            }

            List<Map> choices = (List<Map>) body.get("choices");
            if (choices != null && !choices.isEmpty()) {
                Map message = (Map) choices.get(0).get("message");
                String rawContent = (String) message.get("content");
                return stripMarkdownCodeFences(rawContent);
            }
        }
        throw new RuntimeException("Empty or invalid response from model");
    }

    public static String stripMarkdownCodeFences(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();

        int firstBrace = trimmed.indexOf('{');
        int lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace != -1 && lastBrace > firstBrace) {
            return trimmed.substring(firstBrace, lastBrace + 1).trim();
        }

        if (trimmed.startsWith("```")) {
            String[] lines = trimmed.split("\n");
            StringBuilder sb = new StringBuilder();
            for (String line : lines) {
                if (line.trim().startsWith("```")) continue;
                sb.append(line).append("\n");
            }
            return sb.toString().trim();
        }

        return trimmed;
    }
}
