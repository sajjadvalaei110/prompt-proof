package dev.codeatlas.modelclient;

import dev.codeatlas.config.CodeAtlasProperties;
import dev.codeatlas.api.dto.ModelTestResponse;
import org.springframework.stereotype.Service;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import java.util.Map;
import java.util.List;

@Service
public class ModelClientService {

    private final CodeAtlasProperties properties;
    private final RestTemplate restTemplate = new RestTemplate();

    public ModelClientService(CodeAtlasProperties properties) {
        this.properties = properties;
    }

    public ModelTestResponse testConnection() {
        if (properties.getModel().getBaseUrl() == null || properties.getModel().getBaseUrl().isEmpty()) {
            return new ModelTestResponse(false, false, false, "Not configured", 0, List.of("No base URL"));
        }
        long start = System.currentTimeMillis();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            String payload = """
            {
                "model": "%s",
                "messages": [{"role": "user", "content": "Reply with 'OK' only."}],
                "temperature": 0.0
            }
            """.formatted(properties.getModel().getModelId());

            ResponseEntity<Map> response = restTemplate.exchange(
                properties.getModel().getBaseUrl() + "/chat/completions",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Map.class
            );

            long latency = System.currentTimeMillis() - start;
            boolean working = response.getStatusCode().is2xxSuccessful();
            return new ModelTestResponse(working, working, working, properties.getModel().getModelId(), latency, List.of());
        } catch (Exception e) {
            return new ModelTestResponse(false, false, false, properties.getModel().getModelId(), System.currentTimeMillis() - start, List.of("Error: " + e.getMessage()));
        }
    }

    public String getExplanation(String systemPrompt, String userPrompt) {
        String baseUrl = properties.getModel().getBaseUrl();
        String modelId = properties.getModel().getModelId();
        if (baseUrl == null || baseUrl.isEmpty()) {
            baseUrl = "http://127.0.0.1:11434/v1";
            modelId = "llama3.1";
        }
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            String payload = String.format("""
            {
                "model": "%s",
                "messages": [
                    {"role": "system", "content": %s},
                    {"role": "user", "content": %s}
                ],
                "temperature": 0.0,
                "response_format": { "type": "json_object" }
            }
            """, 
            modelId,
            escapeJsonString(systemPrompt),
            escapeJsonString(userPrompt));

            ResponseEntity<Map> response = restTemplate.exchange(
                baseUrl + "/chat/completions",
                HttpMethod.POST,
                new HttpEntity<>(payload, headers),
                Map.class
            );
            
            if(response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
                List<Map> choices = (List<Map>) response.getBody().get("choices");
                if (choices != null && !choices.isEmpty()) {
                    Map message = (Map) choices.get(0).get("message");
                    return (String) message.get("content");
                }
            }
            throw new RuntimeException("Empty response from model");
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Failed to request model: " + e.getMessage(), e);
        }
    }
    
    private String escapeJsonString(String input) {
        return "\"" + input.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }
}
