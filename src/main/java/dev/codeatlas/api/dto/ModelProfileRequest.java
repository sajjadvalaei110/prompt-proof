package dev.codeatlas.api.dto;

public record ModelProfileRequest(String baseUrl, String modelId, String apiKey, int contextBudget, int outputBudget, int timeoutSeconds, int concurrency) {}
