package dev.codeatlas.api;

import dev.codeatlas.api.dto.ExplanationResponse;
import dev.codeatlas.api.dto.JobResponse;
import dev.codeatlas.api.dto.enums.JobStatus;
import dev.codeatlas.explanations.ExplanationQueueService;
import dev.codeatlas.explanations.ExplanationService;
import dev.codeatlas.explanations.QueueStatus;
import dev.codeatlas.jobs.JobService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * REST endpoints for explanation generation and queue management.
 *
 * R4 enhancements:
 * - Bulk "Explain All" job submission
 * - Single high-priority explanation requests (user clicks)
 * - Job cancellation
 * - Queue status for UI progress indicators
 * - GET explanation retrieval for inspector panel
 */
@RestController
@RequestMapping("/api")
public class ExplanationController {

    private final JobService jobService;
    private final ExplanationQueueService queueService;
    private final ExplanationService explanationService;

    public ExplanationController(JobService jobService, ExplanationQueueService queueService, ExplanationService explanationService) {
        this.jobService = jobService;
        this.queueService = queueService;
        this.explanationService = explanationService;
    }

    /**
     * Get explanation for a symbol in a snapshot.
     */
    @GetMapping("/snapshots/{snapshotId}/symbols/{symbolId}/explanation")
    public ResponseEntity<ExplanationResponse> getExplanation(
            @PathVariable String snapshotId,
            @PathVariable String symbolId) {
        ExplanationResponse response = explanationService.getExplanationForSymbol(snapshotId, symbolId);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/snapshots/{snapshotId}/relationships/{id}/explanation")
    public ExplanationResponse relationship(@PathVariable String snapshotId, @PathVariable String id) {
        return explanationService.getExplanation(snapshotId, id, "relationship");
    }
    @GetMapping("/snapshots/{snapshotId}/explanation-evidence/{id}")
    public Object evidence(@PathVariable String snapshotId, @PathVariable String id, @RequestParam(defaultValue = "symbol") String subjectType) {
        return explanationService.getEvidence(snapshotId, id, subjectType);
    }

    /**
     * Submit a bulk "Explain All" job for a snapshot.
     * Enqueues all classes and key relationships for explanation generation.
     */
    @PostMapping("/explanation-jobs")
    public ResponseEntity<Map<String, Object>> submitExplainAllJob(
            @RequestParam String workspaceId,
            @RequestParam String snapshotId,
            @RequestParam(defaultValue = "1") int concurrency) {
        String jobId = queueService.startExplainAllJob(workspaceId, snapshotId, concurrency);
        return ResponseEntity.ok(Map.of(
                "jobId", jobId,
                "operation", "EXPLAIN_ALL",
                "status", "RUNNING"));
    }

    /**
     * Enqueue a single high-priority explanation (from user clicking "Explain" in UI).
     * Gets priority over background bulk jobs.
     */
    @PostMapping("/explanations/request")
    public ResponseEntity<Map<String, Object>> requestExplanation(
            @RequestParam String workspaceId,
            @RequestParam String snapshotId,
            @RequestParam String subjectId,
            @RequestParam String subjectType) {
        queueService.enqueueExplanation(workspaceId, snapshotId, subjectId, subjectType);
        return ResponseEntity.ok(Map.of(
                "status", "QUEUED",
                "subjectId", subjectId,
                "subjectType", subjectType,
                "priority", 100));
    }

    /**
     * Get job status by ID.
     */
    @GetMapping("/jobs/{id}")
    public JobResponse getJob(@PathVariable String id) {
        return jobService.getJob(id);
    }

    /**
     * Cancel a running job. Pending items are marked SKIPPED.
     */
    @PostMapping("/jobs/{id}/cancel")
    public ResponseEntity<Map<String, String>> cancelJob(@PathVariable String id) {
        queueService.cancelJob(id);
        return ResponseEntity.ok(Map.of("status", "CANCELLED", "jobId", id));
    }

    /**
     * Get explanation queue status for a workspace.
     * Used by the frontend to show progress in the status bar.
     */
    @GetMapping("/workspaces/{workspaceId}/queue-status")
    public QueueStatus getQueueStatus(@PathVariable String workspaceId) {
        return queueService.getQueueStatus(workspaceId);
    }
}
