package dev.codeatlas.api.dto;

public record ModelProfileResponse(String baseUrl, String modelId, boolean hasApiKey, int contextBudget, int outputBudget, int timeoutSeconds, int concurrency) {}
