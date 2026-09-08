package dev.codeatlas.graph;

import dev.codeatlas.api.dto.GraphResponse;
import dev.codeatlas.api.dto.GraphNode;
import dev.codeatlas.api.dto.GraphEdge;
import dev.codeatlas.api.dto.enums.SymbolKind;
import dev.codeatlas.api.dto.enums.ExplanationStatus;
import dev.codeatlas.api.dto.enums.RelationshipKind;
import dev.codeatlas.api.dto.enums.ResolutionStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Queries the graph store for rendering in the frontend.
 *
 * R3 enhancements:
 * - Includes Spring roles in node data
 * - Includes INJECTS and DECLARES_BEAN edges
 * - Provides HTTP route metadata
 * - Includes explanation status for each node
 */
@Service
public class GraphQueryService {

    private static final Logger log = LoggerFactory.getLogger(GraphQueryService.class);
    private final JdbcTemplate jdbcTemplate;

    public GraphQueryService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public GraphResponse getGraph(String snapshotId) {
        // Fetch nodes with Spring roles and explanation status
        List<GraphNode> nodes = jdbcTemplate.query(
                "SELECT sv.id, sv.kind, sv.qualified_name, sv.simple_name, sv.module, " +
                        "sv.parent_symbol_id, sv.roles, sv.source_status, " +
                        "COALESCE(e.status, 'NOT_REQUESTED') AS explanation_status " +
                        "FROM symbol_versions sv " +
                        "LEFT JOIN explanations e ON sv.id = e.subject_version_id AND e.subject_type = 'symbol' " +
                        "WHERE sv.snapshot_id = ? AND COALESCE(sv.source_status, 'ACTIVE') != 'DELETED'",
                (rs, rowNum) -> {
                    String rolesStr = rs.getString("roles");
                    List<String> roles = parseJsonArrayString(rolesStr);
                    String explStatus = rs.getString("explanation_status");
                    String responsibilitySummary = buildResponsibilitySummary(
                            rs.getString("kind"), roles);

                    return new GraphNode(
                            rs.getString("id"),
                            SymbolKind.valueOf(rs.getString("kind")),
                            rs.getString("qualified_name"),
                            rs.getString("simple_name"),
                            rs.getString("module"),
                            roles,
                            responsibilitySummary,
                            parseExplanationStatus(explStatus),
                            rs.getString("parent_symbol_id")
                    );
                },
                snapshotId
        );

        // Fetch edges including new R3 types (INJECTS, DECLARES_BEAN, HANDLES_ROUTE)
        List<GraphEdge> edges = jdbcTemplate.query(
                "SELECT id, source_symbol_id, target_symbol_id, kind, resolution, reason " +
                        "FROM relationship_occurrences " +
                        "WHERE snapshot_id = ? AND target_symbol_id IS NOT NULL",
                (rs, rowNum) -> {
                    String kindStr = rs.getString("kind");
                    RelationshipKind kind;
                    try {
                        kind = RelationshipKind.valueOf(kindStr);
                    } catch (IllegalArgumentException e) {
                        kind = RelationshipKind.DEPENDS_ON;
                    }

                    String resolutionStr = rs.getString("resolution");
                    ResolutionStatus resolution;
                    try {
                        resolution = ResolutionStatus.valueOf(resolutionStr);
                    } catch (IllegalArgumentException e) {
                        resolution = ResolutionStatus.UNRESOLVED;
                    }

                    String reason = rs.getString("reason");
                    String label = buildEdgeLabel(kind, reason);

                    return new GraphEdge(
                            rs.getString("id"),
                            rs.getString("source_symbol_id"),
                            rs.getString("target_symbol_id"),
                            kind,
                            resolution,
                            label,
                            buildEdgeHoverSummary(kind, reason),
                            1
                    );
                },
                snapshotId
        );

        // Build metadata with Spring-specific counts
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("nodeCount", nodes.size());
        metadata.put("edgeCount", edges.size());
        metadata.put("omittedCount", 0);

        // Add Spring route info
        try {
            List<Map<String, Object>> routes = jdbcTemplate.queryForList(
                    "SELECT hr.http_method, hr.path, sv.simple_name AS method_name, sv.qualified_name " +
                            "FROM http_routes hr " +
                            "JOIN symbol_versions sv ON hr.symbol_version_id = sv.id " +
                            "WHERE hr.snapshot_id = ?",
                    snapshotId);
            metadata.put("routes", routes);
            metadata.put("routeCount", routes.size());
        } catch (Exception e) {
            metadata.put("routeCount", 0);
            metadata.put("routes", List.of());
        }

        // Add injection summary
        try {
            int injectionCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM injection_points WHERE snapshot_id = ?",
                    Integer.class, snapshotId);
            metadata.put("injectionCount", injectionCount);
        } catch (Exception e) {
            metadata.put("injectionCount", 0);
        }

        return new GraphResponse(nodes, edges, metadata);
    }

    // -----------------------------------------------------------------------
    //  Helper methods
    // -----------------------------------------------------------------------

    private List<String> parseJsonArrayString(String json) {
        if (json == null || json.isBlank() || "null".equals(json)) {
            return List.of();
        }
        // Simple JSON array parser for ["FOO", "BAR"] format
        try {
            json = json.trim();
            if (json.startsWith("[") && json.endsWith("]")) {
                json = json.substring(1, json.length() - 1);
                if (json.isBlank()) return List.of();
                return Arrays.stream(json.split(","))
                        .map(s -> s.trim().replace("\"", ""))
                        .filter(s -> !s.isBlank())
                        .collect(Collectors.toList());
            }
        } catch (Exception e) {
            log.debug("Failed to parse JSON array: {}", json);
        }
        return List.of();
    }

    private ExplanationStatus parseExplanationStatus(String status) {
        if (status == null) return ExplanationStatus.NOT_REQUESTED;
        try {
            return ExplanationStatus.valueOf(status);
        } catch (IllegalArgumentException e) {
            return ExplanationStatus.NOT_REQUESTED;
        }
    }

    private String buildResponsibilitySummary(String kind, List<String> roles) {
        if (roles.isEmpty()) {
            return "Analyzed " + kind.toLowerCase();
        }
        StringBuilder sb = new StringBuilder("Spring ");
        sb.append(String.join("/", roles).toLowerCase());
        return sb.toString();
    }

    private String buildEdgeLabel(RelationshipKind kind, String reason) {
        return switch (kind) {
            case INJECTS -> reason != null ? "injects (" + reason + ")" : "injects";
            case DECLARES_BEAN -> "declares bean";
            case HANDLES_ROUTE -> "handles route";
            case CALLS -> "calls";
            case EXTENDS -> "extends";
            case IMPLEMENTS -> "implements";
            case CONSTRUCTS -> "constructs";
            case DEPENDS_ON -> "depends on";
            default -> kind.name().toLowerCase().replace('_', ' ');
        };
    }

    private String buildEdgeHoverSummary(RelationshipKind kind, String reason) {
        return switch (kind) {
            case INJECTS -> "Spring dependency injection" + (reason != null ? " via " + reason : "");
            case DECLARES_BEAN -> "Factory method produces this bean";
            case HANDLES_ROUTE -> "HTTP endpoint handler";
            default -> kind.name() + " relationship";
        };
    }
}
