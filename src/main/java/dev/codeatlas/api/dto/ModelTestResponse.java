package dev.codeatlas.api.dto;
import java.util.List;

public record ModelTestResponse(boolean reachable, boolean modelsSupported, boolean chatWorking, String actualModelId, long latencyMs, List<String> capabilities) {}
