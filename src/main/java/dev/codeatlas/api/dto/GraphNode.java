package dev.codeatlas.api.dto;
import java.util.List;
import dev.codeatlas.api.dto.enums.SymbolKind;
import dev.codeatlas.api.dto.enums.ExplanationStatus;

public record GraphNode(String id, SymbolKind kind, String qualifiedName, String simpleName, String module, List<String> roles, String responsibilitySummary, ExplanationStatus explanationStatus) {}
