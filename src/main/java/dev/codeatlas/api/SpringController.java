package dev.codeatlas.api;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST endpoints for Spring-specific graph data.
 *
 * Provides access to HTTP route mappings, injection points,
 * and Spring stereotype information extracted during R3 analysis.
 */
@RestController
@RequestMapping("/api/snapshots/{snapshotId}/spring")
public class SpringController {

    private final JdbcTemplate jdbcTemplate;

    public SpringController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * Get all HTTP routes discovered in a snapshot.
     */
    @GetMapping("/routes")
    public List<Map<String, Object>> getRoutes(@PathVariable String snapshotId) {
        return jdbcTemplate.queryForList(
                "SELECT hr.id, hr.http_method, hr.path, hr.consumes, hr.produces, " +
                        "sv.simple_name AS handler_method, sv.qualified_name AS handler_qualified " +
                        "FROM http_routes hr " +
                        "JOIN symbol_versions sv ON hr.symbol_version_id = sv.id " +
                        "WHERE hr.snapshot_id = ? " +
                        "ORDER BY hr.path, hr.http_method",
                snapshotId);
    }

    /**
     * Get all injection points discovered in a snapshot.
     */
    @GetMapping("/injections")
    public List<Map<String, Object>> getInjections(@PathVariable String snapshotId) {
        return jdbcTemplate.queryForList(
                "SELECT ip.id, ip.target_type_name, ip.injection_kind, " +
                        "ip.qualifier_value, ip.resolved_candidates, ip.resolution, " +
                        "sv.simple_name AS source_class, sv.qualified_name AS source_qualified " +
                        "FROM injection_points ip " +
                        "JOIN symbol_versions sv ON ip.source_symbol_id = sv.id " +
                        "WHERE ip.snapshot_id = ? " +
                        "ORDER BY sv.qualified_name",
                snapshotId);
    }

    /**
     * Get all Spring stereotype-annotated classes in a snapshot.
     */
    @GetMapping("/components")
    public List<Map<String, Object>> getComponents(@PathVariable String snapshotId) {
        return jdbcTemplate.queryForList(
                "SELECT id, kind, qualified_name, simple_name, roles, spring_metadata " +
                        "FROM symbol_versions " +
                        "WHERE snapshot_id = ? AND roles IS NOT NULL AND roles != '[]' " +
                        "ORDER BY qualified_name",
                snapshotId);
    }
}
