package dev.codeatlas.graph;

import dev.codeatlas.api.dto.GraphResponse;
import dev.codeatlas.api.dto.GraphNode;
import dev.codeatlas.api.dto.GraphEdge;
import dev.codeatlas.api.dto.enums.SymbolKind;
import dev.codeatlas.api.dto.enums.ExplanationStatus;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.List;
import java.util.ArrayList;

@Service
public class GraphQueryService {
    private final JdbcTemplate jdbcTemplate;

    public GraphQueryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public GraphResponse getGraph(String snapshotId) {
        List<GraphNode> nodes = jdbcTemplate.query(
            "SELECT id, kind, qualified_name, simple_name, module, parent_symbol_id FROM symbol_versions WHERE snapshot_id = ?",
            (rs, rowNum) -> new GraphNode(
                rs.getString("id"),
                SymbolKind.valueOf(rs.getString("kind")),
                rs.getString("qualified_name"),
                rs.getString("simple_name"),
                rs.getString("module"),
                List.of(),
                "Analyzed class",
                ExplanationStatus.NOT_REQUESTED,
                rs.getString("parent_symbol_id")
            ),
            snapshotId
        );
        
        List<GraphEdge> edges = jdbcTemplate.query(
            "SELECT id, source_symbol_id, target_symbol_id, kind, resolution FROM relationship_occurrences WHERE snapshot_id = ? AND target_symbol_id IS NOT NULL",
            (rs, rowNum) -> new GraphEdge(
                rs.getString("id"),
                rs.getString("source_symbol_id"),
                rs.getString("target_symbol_id"),
                dev.codeatlas.api.dto.enums.RelationshipKind.valueOf(rs.getString("kind")),
                dev.codeatlas.api.dto.enums.ResolutionStatus.valueOf(rs.getString("resolution")),
                "Relationship",
                "Detailed summary",
                1
            ),
            snapshotId
        );
        
        return new GraphResponse(nodes, edges, java.util.Map.of("nodeCount", nodes.size(), "edgeCount", edges.size(), "omittedCount", 0));
    }
}
