package dev.codeatlas.modelclient;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.api.dto.ModelTestResponse;
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

    public ModelTestResponse testConnection() {
        String baseUrl = properties.getModel().getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            return new ModelTestResponse(false, false, false, "Not configured", 0, List.of("No base URL configured"));
        }
        String modelId = properties.getModel().getModelId();
        if (modelId == null || modelId.isBlank()) {
            modelId = "gpt-4o";
        }

        String url = baseUrl.trim().replaceAll("/+$", "") + "/chat/completions";
        long start = System.currentTimeMillis();

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            String apiKey = properties.getModel().getApiKey();
            if (apiKey != null && !apiKey.isBlank()) {
                headers.setBearerAuth(apiKey.trim());
            }

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
                errorMsg += ": " + responseBody;
            }
            return new ModelTestResponse(false, false, false, modelId, latency, List.of(errorMsg));
        } catch (Exception e) {
            long latency = System.currentTimeMillis() - start;
            return new ModelTestResponse(false, false, false, modelId, latency, List.of("Error: " + e.getMessage()));
        }
    }

    public String getExplanation(String systemPrompt, String userPrompt) {
        String baseUrl = properties.getModel().getBaseUrl();
        String modelId = properties.getModel().getModelId();
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = "http://127.0.0.1:11434/v1";
            modelId = "llama3.1";
        }
        String url = baseUrl.trim().replaceAll("/+$", "") + "/chat/completions";

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            String apiKey = properties.getModel().getApiKey();
            if (apiKey != null && !apiKey.isBlank()) {
                headers.setBearerAuth(apiKey.trim());
            }

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
            requestBody.put("response_format", Map.of("type", "json_object"));

            String payload = objectMapper.writeValueAsString(requestBody);

            ResponseEntity<Map> response = createRestTemplate().exchange(
                url,
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Map.class
            );

            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                List<Map> choices = (List<Map>) response.getBody().get("choices");
                if (choices != null && !choices.isEmpty()) {
                    Map message = (Map) choices.get(0).get("message");
                    return (String) message.get("content");
                }
            }
            throw new RuntimeException("Empty response from model");
        } catch (Exception e) {
            throw new RuntimeException("Failed to request model: " + e.getMessage(), e);
        }
    }
}
