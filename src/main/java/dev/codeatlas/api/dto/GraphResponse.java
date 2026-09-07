package dev.codeatlas.api.dto;
import java.util.List;
import java.util.Map;

public record GraphResponse(List<GraphNode> nodes, List<GraphEdge> edges, Map<String, Object> metadata) {}
