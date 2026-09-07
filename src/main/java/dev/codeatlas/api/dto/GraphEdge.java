package dev.codeatlas.api.dto;
import dev.codeatlas.api.dto.enums.RelationshipKind;
import dev.codeatlas.api.dto.enums.ResolutionStatus;

public record GraphEdge(String id, String sourceId, String targetId, RelationshipKind kind, ResolutionStatus resolution, String descriptiveLabel, String hoverSummary, int callSiteCount) {}
