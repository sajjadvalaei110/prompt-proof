package dev.codeatlas.storage;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;
import dev.codeatlas.api.dto.WorkspaceResponse;
import dev.codeatlas.workspace.WorkspaceTrust;

@Repository
public class WorkspaceRepository {
    private final JdbcTemplate jdbcTemplate;

    public WorkspaceRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public void insert(String id, String canonicalRoot, String displayName, String language) {
        insert(id, canonicalRoot, displayName, language, null, "source_only");
    }

    public void insert(String id, String canonicalRoot, String displayName, String language, String indexer, String trustState) {
        jdbcTemplate.update(
            "INSERT INTO workspaces (id, canonical_root, display_name, language, indexer, trust_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
            id, canonicalRoot, displayName, language, indexer, trustState
        );
    }

    /** Switch an existing workspace's engine and the build permission that goes with it (ADR 0012). */
    public void updateIndexer(String id, String indexer, String trustState) {
        jdbcTemplate.update("UPDATE workspaces SET indexer = ?, trust_state = ?, updated_at = datetime('now') WHERE id = ?", indexer, trustState, id);
    }

    /**
     * A design-only project (ADR 0016): no source folder, and one empty published snapshot so every
     * snapshot-keyed read (graph, design overlay, export) works unchanged on an empty parsed graph.
     */
    public void insertDesignOnly(String id, String displayName, String snapshotId) {
        insert(id, "design-only:" + id, displayName, "java", null, WorkspaceTrust.DESIGN_ONLY);
        jdbcTemplate.update("INSERT INTO snapshots (id, workspace_id, status, created_at, completed_at) VALUES (?, ?, 'published', datetime('now'), datetime('now'))", snapshotId, id);
        jdbcTemplate.update("UPDATE workspaces SET active_snapshot_id = ? WHERE id = ?", snapshotId, id);
    }

    public boolean isDesignOnly(String id) {
        return jdbcTemplate.queryForList("SELECT 1 FROM workspaces WHERE id = ? AND trust_state = ?", id, WorkspaceTrust.DESIGN_ONLY).size() > 0;
    }

    public Optional<WorkspaceResponse> findById(String id) {
        List<WorkspaceResponse> results = jdbcTemplate.query(
            "SELECT id, canonical_root, active_snapshot_id, language, indexer, trust_state, display_name FROM workspaces WHERE id = ?",
            (rs, rowNum) -> new WorkspaceResponse(rs.getString("id"), rs.getString("canonical_root"), rs.getString("active_snapshot_id"), rs.getString("language"), rs.getString("indexer"), WorkspaceTrust.DESIGN_ONLY.equals(rs.getString("trust_state")), rs.getString("display_name")),
            id
        );
        return results.isEmpty() ? Optional.empty() : Optional.of(results.get(0));
    }
    
    public Optional<WorkspaceResponse> findByPath(String path) {
        List<WorkspaceResponse> results = jdbcTemplate.query(
            "SELECT id, canonical_root, active_snapshot_id, language, indexer, trust_state, display_name FROM workspaces WHERE canonical_root = ?",
            (rs, rowNum) -> new WorkspaceResponse(rs.getString("id"), rs.getString("canonical_root"), rs.getString("active_snapshot_id"), rs.getString("language"), rs.getString("indexer"), WorkspaceTrust.DESIGN_ONLY.equals(rs.getString("trust_state")), rs.getString("display_name")),
            path
        );
        return results.isEmpty() ? Optional.empty() : Optional.of(results.get(0));
    }

    public List<WorkspaceResponse> findAll() {
        return jdbcTemplate.query(
            "SELECT id, canonical_root, active_snapshot_id, language, indexer, trust_state, display_name FROM workspaces ORDER BY created_at DESC",
            (rs, rowNum) -> new WorkspaceResponse(rs.getString("id"), rs.getString("canonical_root"), rs.getString("active_snapshot_id"), rs.getString("language"), rs.getString("indexer"), WorkspaceTrust.DESIGN_ONLY.equals(rs.getString("trust_state")), rs.getString("display_name"))
        );
    }
}
