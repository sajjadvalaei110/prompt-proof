package dev.codeatlas.jobs;

import dev.codeatlas.api.dto.JobResponse;
import dev.codeatlas.api.dto.enums.JobStatus;
import dev.codeatlas.analysis.AnalysisService;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.UUID;
import java.util.Optional;
import java.util.List;

@Service
public class JobService {
    private final JdbcTemplate jdbcTemplate;
    private final AnalysisService analysisService;

    public JobService(JdbcTemplate jdbcTemplate, AnalysisService analysisService) {
        this.jdbcTemplate = jdbcTemplate;
        this.analysisService = analysisService;
    }

    public JobResponse createAnalysisJob(String workspaceId) {
        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
            "INSERT INTO jobs (id, workspace_id, operation, status, created_at, updated_at) VALUES (?, ?, 'ANALYSIS', 'RUNNING', datetime('now'), datetime('now'))",
            id, workspaceId
        );
        
        // Run analysis asynchronously
        new Thread(() -> {
            try {
                analysisService.runAnalysis(workspaceId, id);
            } catch (Exception e) {
                e.printStackTrace();
                jdbcTemplate.update("UPDATE jobs SET status = 'FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?", e.getMessage(), id);
            }
        }).start();
        
        return new JobResponse(id, "ANALYSIS", JobStatus.RUNNING, 0, 0, 0);
    }
    
    public JobResponse getJob(String id) {
        List<JobResponse> results = jdbcTemplate.query(
            "SELECT id, operation, status, total_items, completed_items, failed_items FROM jobs WHERE id = ?",
            (rs, rowNum) -> new JobResponse(
                rs.getString("id"),
                rs.getString("operation"),
                JobStatus.valueOf(rs.getString("status")),
                rs.getInt("total_items"),
                rs.getInt("completed_items"),
                rs.getInt("failed_items")
            ),
            id
        );
        if (results.isEmpty()) throw new IllegalArgumentException("Job not found");
        return results.get(0);
    }
}
