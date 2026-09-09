package dev.codeatlas.api.dto;

public record ModelProfileRequest(
    String baseUrl,
    String modelId,
    String apiKey,
    int contextBudget,
    int outputBudget,
    int timeoutSeconds,
    int concurrency,
    Double temperature,
    String userAgent
) {
    public ModelProfileRequest(String baseUrl, String modelId, String apiKey, int contextBudget, int outputBudget, int timeoutSeconds, int concurrency) {
        this(baseUrl, modelId, apiKey, contextBudget, outputBudget, timeoutSeconds, concurrency, 0.2, null);
    }

    public ModelProfileRequest(String baseUrl, String modelId, String apiKey, int contextBudget, int outputBudget, int timeoutSeconds, int concurrency, Double temperature) {
        this(baseUrl, modelId, apiKey, contextBudget, outputBudget, timeoutSeconds, concurrency, temperature, null);
    }
}
