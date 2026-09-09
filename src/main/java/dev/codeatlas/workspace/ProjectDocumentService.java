package dev.codeatlas.workspace;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class ProjectDocumentService {
    private final JdbcTemplate db;
    public ProjectDocumentService(JdbcTemplate db) { this.db = db; }
    public record Document(String schemaVersion, String id, String title, String content, int revision, String updatedAt) {}
    public List<Document> list(String workspaceId) {
        requireWorkspace(workspaceId);
        return db.query("SELECT * FROM project_documents WHERE workspace_id = ? ORDER BY created_at, id",
            (rs, n) -> new Document("1", rs.getString("id"), rs.getString("title"), rs.getString("content"), rs.getInt("revision"), rs.getString("updated_at")), workspaceId);
    }
    @Transactional
    public Document save(String workspaceId, String id, String title, String content) {
        requireWorkspace(workspaceId);
        if (title == null || title.isBlank() || title.length() > 160) throw new IllegalArgumentException("Document title must contain 1–160 characters");
        if (content == null || content.isBlank() || content.length() > 100_000) throw new IllegalArgumentException("Document must contain 1–100,000 characters");
        if (id == null) {
            if (list(workspaceId).size() >= 30) throw new IllegalArgumentException("A project can contain up to 30 context documents");
            id = UUID.randomUUID().toString();
            db.update("INSERT INTO project_documents (id, workspace_id, title, content) VALUES (?, ?, ?, ?)", id, workspaceId, title.trim(), content);
        } else if (db.update("UPDATE project_documents SET title = ?, content = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ? AND id = ?", title.trim(), content, workspaceId, id) == 0) {
            throw new NoSuchElementException("Document not found");
        }
        invalidate(workspaceId);
        final String savedId = id;
        return list(workspaceId).stream().filter(d -> d.id().equals(savedId)).findFirst().orElseThrow();
    }
    @Transactional
    public void delete(String workspaceId, String id) {
        requireWorkspace(workspaceId);
        if (db.update("DELETE FROM project_documents WHERE workspace_id = ? AND id = ?", workspaceId, id) == 0) throw new NoSuchElementException("Document not found");
        invalidate(workspaceId);
    }
    private void invalidate(String workspaceId) {
        db.update("UPDATE explanations SET status = 'STALE', updated_at = CURRENT_TIMESTAMP WHERE snapshot_id IN (SELECT id FROM snapshots WHERE workspace_id = ?) AND status = 'READY'", workspaceId);
        // Completed items may be resumed using the revised context; pending work reads it at execution time.
        db.update("UPDATE explanation_queue SET status = 'SKIPPED' WHERE workspace_id = ? AND status = 'COMPLETED'", workspaceId);
    }
    private void requireWorkspace(String id) {
        if (db.queryForObject("SELECT COUNT(*) FROM workspaces WHERE id = ?", Integer.class, id) == 0) throw new NoSuchElementException("Workspace not found");
    }
}
