package dev.codeatlas.analysis;

import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;
import java.util.List;
import java.io.File;

@Service
public class AnalysisService {
    private final JdbcTemplate jdbcTemplate;
    private final SourceDiscoveryService discoveryService;
    private final JavaParserAdapter parserAdapter;

    public AnalysisService(JdbcTemplate jdbcTemplate, SourceDiscoveryService discoveryService, JavaParserAdapter parserAdapter) {
        this.jdbcTemplate = jdbcTemplate;
        this.discoveryService = discoveryService;
        this.parserAdapter = parserAdapter;
    }

    public void runAnalysis(String workspaceId, String jobId) {
        // 1. Get workspace path
        String path = jdbcTemplate.queryForObject("SELECT canonical_root FROM workspaces WHERE id = ?", String.class, workspaceId);
        
        // 2. Create snapshot
        String snapshotId = UUID.randomUUID().toString();
        jdbcTemplate.update(
            "INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'staging', datetime('now'))",
            snapshotId, workspaceId
        );
        jdbcTemplate.update("UPDATE jobs SET snapshot_id = ? WHERE id = ?", snapshotId, jobId);
        
        try {
            // 3. Discover files
            List<File> javaFiles = discoveryService.discoverJavaFiles(new File(path));
            jdbcTemplate.update("UPDATE jobs SET total_items = ? WHERE id = ?", javaFiles.size(), jobId);
            
            // 4. Parse declarations
            parserAdapter.setupSymbolSolver(path);
            int parsed = 0;
            for (File file : javaFiles) {
                parserAdapter.parseDeclarations(file, workspaceId, snapshotId);
                parsed++;
                jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            }
            
            // 5. Parse relationships (second pass)
            for (File file : javaFiles) {
                parserAdapter.parseRelationships(file, workspaceId, snapshotId);
            }
            
            // 6. Publish snapshot
            jdbcTemplate.update("UPDATE snapshots SET status = 'published', completed_at = datetime('now') WHERE id = ?", snapshotId);
            jdbcTemplate.update("UPDATE workspaces SET active_snapshot_id = ?, updated_at = datetime('now') WHERE id = ?", snapshotId, workspaceId);
            
            // 7. Complete job
            jdbcTemplate.update("UPDATE jobs SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?", jobId);
            
        } catch (Exception e) {
            e.printStackTrace();
            jdbcTemplate.update("UPDATE snapshots SET status = 'failed' WHERE id = ?", snapshotId);
            jdbcTemplate.update("UPDATE jobs SET status = 'FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?", e.getMessage(), jobId);
        }
    }
}
