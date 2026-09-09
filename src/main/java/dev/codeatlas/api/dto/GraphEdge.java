package dev.codeatlas.api.dto;
import dev.codeatlas.api.dto.enums.RelationshipKind;
import dev.codeatlas.api.dto.enums.ResolutionStatus;
import dev.codeatlas.api.dto.enums.ExplanationStatus;

public record GraphEdge(String id, String sourceId, String targetId, RelationshipKind kind, ResolutionStatus resolution, String descriptiveLabel, String hoverSummary, int callSiteCount, ExplanationStatus explanationStatus) {}
