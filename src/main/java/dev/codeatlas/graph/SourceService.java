package dev.codeatlas.graph;

import dev.codeatlas.analysis.AnalysisService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.io.File;
import java.nio.file.Path;
import java.util.*;

@Service
public class SourceService {
    private final JdbcTemplate db;
    public SourceService(JdbcTemplate db) { this.db = db; }
    public record Source(String schemaVersion, String path, int startLine, int endLine, String content, boolean exact) {}

    private static final String SYMBOL_QUERY =
        "SELECT f.relative_path, e.start_line, e.end_line, e.snippet, f.content_hash, w.canonical_root " +
        "FROM symbol_evidence se JOIN evidence e ON e.id = se.evidence_id " +
        "JOIN source_file_versions f ON f.id = e.source_file_version_id " +
        "JOIN symbol_versions s ON s.id = se.symbol_version_id " +
        "JOIN snapshots sn ON sn.id = f.snapshot_id " +
        "JOIN workspaces w ON w.id = sn.workspace_id " +
        "WHERE s.snapshot_id = ? AND f.snapshot_id = ? AND s.id = ? ORDER BY e.start_line LIMIT 1";

    private static final String RELATIONSHIP_QUERY =
        "SELECT f.relative_path, e.start_line, e.end_line, e.snippet, f.content_hash, w.canonical_root " +
        "FROM relationship_evidence re JOIN evidence e ON e.id = re.evidence_id " +
        "JOIN source_file_versions f ON f.id = e.source_file_version_id " +
        "JOIN relationship_occurrences r ON r.id = re.relationship_id " +
        "JOIN snapshots sn ON sn.id = f.snapshot_id " +
        "JOIN workspaces w ON w.id = sn.workspace_id " +
        "WHERE r.snapshot_id = ? AND f.snapshot_id = ? AND r.id = ? ORDER BY e.start_line";

    public Source symbol(String snapshot, String id) {
        var rows = db.query(SYMBOL_QUERY, this::mapRow, snapshot, snapshot, id);
        if (!rows.isEmpty()) return rows.get(0);
        // Older indexes did not store declaration ranges. Do not pretend a file is a method.
        throw new NoSuchElementException("Exact source range unavailable. Re-analyze the project to index declaration evidence.");
    }

    public List<Source> relationship(String snapshot, String id) {
        return db.query(RELATIONSHIP_QUERY, this::mapRow, snapshot, snapshot, id);
    }

    private Source mapRow(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        String relativePath = rs.getString(1);
        int startLine = rs.getInt(2);
        int endLine = rs.getInt(3);
        String snippet = rs.getString(4);
        String storedHash = rs.getString(5);
        String canonicalRoot = rs.getString(6);
        return new Source("1", relativePath, startLine, endLine, snippet, isStillExact(canonicalRoot, relativePath, storedHash));
    }

    /**
     * Re-hashes the live file (if it still exists) and compares against the hash captured at
     * index time, per DATA_MODEL.md's tamper-detection invariant. A missing file or mismatched
     * hash means the retained snippet can no longer be trusted as an exact match for the file on disk.
     */
    private boolean isStillExact(String canonicalRoot, String relativePath, String storedHash) {
        try {
            File liveFile = Path.of(canonicalRoot).resolve(relativePath).normalize().toFile();
            if (!liveFile.exists() || !liveFile.isFile()) {
                return false;
            }
            return AnalysisService.computeContentHash(liveFile).equals(storedHash);
        } catch (Exception e) {
            return false;
        }
    }
}
