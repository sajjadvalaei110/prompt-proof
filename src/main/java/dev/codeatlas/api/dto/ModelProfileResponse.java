package dev.codeatlas.api.dto;

public record ModelProfileResponse(
    String baseUrl,
    String modelId,
    boolean hasApiKey,
    int contextBudget,
    int outputBudget,
    int timeoutSeconds,
    int concurrency,
    double temperature
) {
    public ModelProfileResponse(String baseUrl, String modelId, boolean hasApiKey, int contextBudget, int outputBudget, int timeoutSeconds, int concurrency) {
        this(baseUrl, modelId, hasApiKey, contextBudget, outputBudget, timeoutSeconds, concurrency, 0.2);
    }
}
