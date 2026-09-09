package dev.codeatlas.explanations;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Priority-based explanation queue with resumable bulk processing.
 *
 * R4 features:
 * - User-initiated explanations get priority 100 (processed first)
 * - Bulk "Explain All" jobs get priority 0 (background)
 * - Bounded retries with exponential backoff (default 3 retries)
 * - Graceful cancellation after current item completes
 * - Restart recovery: abandoned IN_PROGRESS items revert to PENDING
 * - Deduplication via snapshot:type:id composite key
 */
@Service
public class ExplanationQueueService {
    private static final Logger log = LoggerFactory.getLogger(ExplanationQueueService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ExplanationService explanationService;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final List<Thread> workers = new CopyOnWriteArrayList<>();
    private volatile int concurrency = 1;

    public ExplanationQueueService(JdbcTemplate jdbcTemplate, ExplanationService explanationService) {
        this.jdbcTemplate = jdbcTemplate;
        this.explanationService = explanationService;
    }

    @PostConstruct
    public void init() {
        log.info("Recovering abandoned explanation queue items...");
        try {
            int recovered = jdbcTemplate.update(
                    "UPDATE explanation_queue SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP " +
                            "WHERE status = 'IN_PROGRESS'");
            if (recovered > 0) {
                log.info("Recovered {} abandoned items back to PENDING state.", recovered);
            }
        } catch (Exception e) {
            log.debug("Queue recovery skipped (table may not exist yet): {}", e.getMessage());
        }
        startWorker();
    }

    @PreDestroy
    public void stopWorker() {
        log.info("Stopping explanation queue workers...");
        running.set(false);
        for (Thread worker : workers) {
            worker.interrupt();
            try {
                worker.join(5000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        workers.clear();
        log.info("Explanation queue workers stopped.");
    }

    public void startWorker() {
        ensureWorkerCount(concurrency);
    }

    /**
     * Grow the worker pool up to {@code desired} threads without tearing down
     * workers already in flight (stopWorker() is @PreDestroy and would interrupt them).
     */
    private synchronized void ensureWorkerCount(int desired) {
        running.set(true);
        if (workers.size() >= desired) {
            return;
        }
        log.info("Growing explanation queue workers from {} to {}", workers.size(), desired);
        while (workers.size() < desired) {
            Thread worker = new Thread(this::workerLoop, "ExplQueueWorker-" + workers.size());
            worker.setDaemon(true);
            worker.start();
            workers.add(worker);
        }
    }

    private void workerLoop() {
        while (running.get()) {
            try {
                boolean processed = processNextItem();
                if (!processed) {
                    // Nothing to process, sleep before polling again
                    Thread.sleep(2000);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.error("Unexpected error in explanation queue worker", e);
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    /**
     * Process the next pending item from the priority queue.
     * Items are ordered by priority DESC (user requests first), then created_at ASC.
     *
     * @return true if an item was found and processed, false if queue is empty
     */
    public boolean processNextItem() {
        List<Map<String, Object>> items;
        try {
            items = jdbcTemplate.queryForList(
                    "SELECT id, snapshot_id, subject_id, subject_type, attempt_count, max_retries " +
                            "FROM explanation_queue WHERE status = 'PENDING' " +
                            "ORDER BY priority DESC, created_at ASC LIMIT 1");
        } catch (Exception e) {
            return false; // Table may not exist yet
        }

        if (items.isEmpty()) {
            // Check if any bulk jobs should be completed
            completeFinalizedJobs();
            return false;
        }

        Map<String, Object> item = items.get(0);
        String id = (String) item.get("id");
        String snapshotId = (String) item.get("snapshot_id");
        String subjectId = (String) item.get("subject_id");
        String subjectType = (String) item.get("subject_type");
        int attemptCount = ((Number) item.get("attempt_count")).intValue();
        int maxRetries = ((Number) item.get("max_retries")).intValue();

        // Atomically claim the item (prevents duplicate processing with multiple workers)
        int updated = jdbcTemplate.update(
                "UPDATE explanation_queue SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP " +
                        "WHERE id = ? AND status = 'PENDING'", id);
        if (updated == 0) {
            return true; // Someone else claimed it
        }

        log.debug("Processing queue item {} ({} {}) attempt {}/{}",
                id, subjectType, subjectId, attemptCount + 1, maxRetries);

        try {
            explanationService.explainSubject(snapshotId, subjectId, subjectType);
            jdbcTemplate.update(
                    "UPDATE explanation_queue SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    id);
            log.debug("Successfully completed queue item {}", id);
        } catch (Exception e) {
            log.warn("Failed to process queue item {}: {}", id, e.getMessage());
            int newAttemptCount = attemptCount + 1;
            String newStatus = newAttemptCount >= maxRetries ? "FAILED" : "PENDING";
            String errorMessage = e.getMessage() != null ? e.getMessage() : e.getClass().getName();
            // Truncate error message to prevent DB overflow
            if (errorMessage.length() > 500) {
                errorMessage = errorMessage.substring(0, 500);
            }

            jdbcTemplate.update(
                    "UPDATE explanation_queue SET status = ?, attempt_count = ?, last_error = ?, " +
                            "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    newStatus, newAttemptCount, errorMessage, id);

            if ("PENDING".equals(newStatus)) {
                // Exponential backoff
                try {
                    long backoffMs = (long) Math.pow(2, newAttemptCount) * 1000L;
                    Thread.sleep(Math.min(backoffMs, 30_000));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------
    //  Bulk "Explain All" job
    // -----------------------------------------------------------------------

    /**
     * Start a bulk "Explain All" job that enqueues all symbols and relationships
     * in a snapshot for explanation generation.
     *
     * @param concurrency Maximum concurrent workers (default 1)
     * @return Job ID for tracking
     */
    public String startExplainAllJob(String workspaceId, String snapshotId, int concurrency) {
        validateSnapshot(workspaceId, snapshotId);
        var active = jdbcTemplate.queryForList("SELECT id FROM jobs WHERE workspace_id = ? AND snapshot_id = ? AND operation = 'EXPLAIN_ALL' AND status = 'RUNNING'", String.class, workspaceId, snapshotId);
        if (!active.isEmpty()) return active.get(0);
        this.concurrency = Math.min(4, Math.max(1, concurrency));
        ensureWorkerCount(this.concurrency);
        String jobId = UUID.randomUUID().toString();
        jdbcTemplate.update("INSERT INTO jobs (id, workspace_id, snapshot_id, operation, status, created_at, updated_at) VALUES (?, ?, ?, 'EXPLAIN_ALL', 'RUNNING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", jobId, workspaceId, snapshotId);
        var subjects = jdbcTemplate.queryForList("SELECT id, 'symbol' AS type FROM symbol_versions WHERE snapshot_id = ? AND kind != 'PACKAGE' AND COALESCE(source_status, 'ACTIVE') = 'ACTIVE' UNION ALL SELECT id, 'relationship' AS type FROM relationship_occurrences WHERE snapshot_id = ?", snapshotId, snapshotId);
        int count = 0;
        for (var subject : subjects) {
            String id = (String) subject.get("id"); String type = (String) subject.get("type");
            Integer ready = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ? AND status = 'READY' AND prompt_version = '2.0'", Integer.class, snapshotId, id, type);
            if (ready != null && ready > 0) continue;
            String key = snapshotId + ":" + type + ":" + id;
            var existing = jdbcTemplate.queryForList("SELECT id, status FROM explanation_queue WHERE dedup_key = ?", key);
            if (existing.isEmpty()) {
                jdbcTemplate.update("INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, priority, status, job_id, attempt_count, max_retries, dedup_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'PENDING', ?, 0, 3, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", UUID.randomUUID().toString(), workspaceId, snapshotId, id, type, jobId, key);
            } else {
                jdbcTemplate.update("UPDATE explanation_queue SET job_id = ?, status = CASE WHEN status = 'IN_PROGRESS' THEN status ELSE 'PENDING' END, attempt_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE dedup_key = ?", jobId, key);
            }
            count++;
        }
        jdbcTemplate.update("UPDATE jobs SET total_items = ? WHERE id = ?", count, jobId);
        completeFinalizedJobs();
        return jobId;
    }

    private void validateSnapshot(String workspaceId, String snapshotId) {
        if (jdbcTemplate.queryForObject("SELECT COUNT(*) FROM snapshots WHERE id = ? AND workspace_id = ? AND status = 'published'", Integer.class, snapshotId, workspaceId) == 0) throw new IllegalArgumentException("Published snapshot does not belong to this workspace");
    }

    // -----------------------------------------------------------------------
    //  User-initiated (high priority) explanation
    // -----------------------------------------------------------------------

    /**
     * Enqueue a single high-priority explanation (from user click in UI).
     * Gets processed before any bulk background work.
     */
    public void enqueueExplanation(String workspaceId, String snapshotId,
                                    String subjectId, String subjectType) {
        validateSnapshot(workspaceId, snapshotId);
        if (!"symbol".equals(subjectType) && !"relationship".equals(subjectType)) throw new IllegalArgumentException("Unknown subject type");
        if ("symbol".equals(subjectType)) {
            var ids = jdbcTemplate.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND (id = ? OR qualified_name = ?)", String.class, snapshotId, subjectId, subjectId);
            if (ids.size() == 1) subjectId = ids.get(0);
        }
        String table = "symbol".equals(subjectType) ? "symbol_versions" : "relationship_occurrences";
        if (jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE snapshot_id = ? AND id = ?", Integer.class, snapshotId, subjectId) == 0) throw new IllegalArgumentException("Subject does not belong to this snapshot");
        String dedupKey = snapshotId + ":" + subjectType + ":" + subjectId;
        log.info("Enqueueing high-priority explanation for {} {}", subjectType, subjectId);

        // Check for existing entry
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT id, status FROM explanation_queue WHERE dedup_key = ?", dedupKey);

        if (!existing.isEmpty()) {
            String status = (String) existing.get(0).get("status");
            if ("IN_PROGRESS".equals(status)) {
                log.debug("Item {} already {}", dedupKey, status);
                return;
            }
            // Boost priority if currently pending at low priority
            if ("PENDING".equals(status)) {
                jdbcTemplate.update(
                        "UPDATE explanation_queue SET priority = 100, updated_at = CURRENT_TIMESTAMP " +
                                "WHERE dedup_key = ? AND status = 'PENDING'", dedupKey);
                return;
            }
            // If FAILED or SKIPPED, reset and re-queue at high priority
            jdbcTemplate.update(
                    "UPDATE explanation_queue SET priority = 100, status = 'PENDING', attempt_count = 0, " +
                            "last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE dedup_key = ?", dedupKey);
            return;
        }

        // Insert new high-priority item
        jdbcTemplate.update(
                "INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, " +
                        "priority, status, attempt_count, max_retries, dedup_key, created_at, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, 100, 'PENDING', 0, 3, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                UUID.randomUUID().toString(), workspaceId, snapshotId, subjectId, subjectType, dedupKey);
    }

    // -----------------------------------------------------------------------
    //  Job management
    // -----------------------------------------------------------------------

    /**
     * Cancel a running explanation job. Pending items are marked SKIPPED.
     */
    public void cancelJob(String jobId) {
        log.info("Cancelling job {}", jobId);
        int cancelled = jdbcTemplate.update(
                "UPDATE explanation_queue SET status = 'SKIPPED', updated_at = CURRENT_TIMESTAMP " +
                        "WHERE job_id = ? AND status = 'PENDING'", jobId);
        jdbcTemplate.update(
                "UPDATE jobs SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?", jobId);
        log.info("Cancelled {} pending items for job {}", cancelled, jobId);
    }

    /**
     * Get current queue status for a workspace.
     */
    public QueueStatus getQueueStatus(String workspaceId) {
        int pending = 0, inProgress = 0, completed = 0, failed = 0, skipped = 0;

        try {
            List<Map<String, Object>> stats = jdbcTemplate.queryForList(
                    "SELECT status, COUNT(*) as cnt FROM explanation_queue " +
                            "WHERE workspace_id = ? GROUP BY status", workspaceId);

            for (Map<String, Object> stat : stats) {
                String status = (String) stat.get("status");
                int count = ((Number) stat.get("cnt")).intValue();
                switch (status) {
                    case "PENDING" -> pending = count;
                    case "IN_PROGRESS" -> inProgress = count;
                    case "COMPLETED" -> completed = count;
                    case "FAILED" -> failed = count;
                    case "SKIPPED" -> skipped = count;
                }
            }
        } catch (Exception e) {
            // Table may not exist yet
        }

        String activeJobId = null;
        try {
            List<String> jobs = jdbcTemplate.queryForList(
                    "SELECT id FROM jobs WHERE workspace_id = ? AND status = 'RUNNING' " +
                            "AND operation = 'EXPLAIN_ALL' LIMIT 1", String.class, workspaceId);
            if (!jobs.isEmpty()) {
                activeJobId = jobs.get(0);
            }
        } catch (Exception e) {
            // Ignore
        }

        return new QueueStatus(pending, inProgress, completed, failed, skipped, activeJobId);
    }

    /**
     * Check if any bulk jobs have all items processed and mark them complete.
     */
    private void completeFinalizedJobs() {
        try {
            List<Map<String, Object>> runningJobs = jdbcTemplate.queryForList(
                    "SELECT id FROM jobs WHERE status = 'RUNNING' AND operation = 'EXPLAIN_ALL'");

            for (Map<String, Object> job : runningJobs) {
                String jobId = (String) job.get("id");
                Integer remaining = jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM explanation_queue WHERE job_id = ? AND status IN ('PENDING', 'IN_PROGRESS')",
                        Integer.class, jobId);

                if (remaining != null && remaining == 0) {
                    Integer completedCount = jdbcTemplate.queryForObject(
                            "SELECT COUNT(*) FROM explanation_queue WHERE job_id = ? AND status = 'COMPLETED'",
                            Integer.class, jobId);
                    Integer failedCount = jdbcTemplate.queryForObject(
                            "SELECT COUNT(*) FROM explanation_queue WHERE job_id = ? AND status = 'FAILED'",
                            Integer.class, jobId);

                    jdbcTemplate.update(
                            "UPDATE jobs SET status = 'COMPLETED', completed_items = ?, failed_items = ?, " +
                                    "updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?",
                            completedCount, failedCount, jobId);
                    log.info("Bulk job {} completed: {} succeeded, {} failed",
                            jobId, completedCount, failedCount);
                }
            }
        } catch (Exception e) {
            // Ignore if tables don't exist yet
        }
    }
}
