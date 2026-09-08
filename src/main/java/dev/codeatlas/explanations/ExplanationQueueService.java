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
        if (running.compareAndSet(false, true)) {
            log.info("Starting explanation queue workers with concurrency = {}", concurrency);
            for (int i = 0; i < concurrency; i++) {
                Thread worker = new Thread(this::workerLoop, "ExplQueueWorker-" + i);
                worker.setDaemon(true);
                worker.start();
                workers.add(worker);
            }
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
        this.concurrency = Math.max(1, concurrency);
        String jobId = UUID.randomUUID().toString();
        log.info("Starting Explain All job {} for workspace {} snapshot {} (concurrency={})",
                jobId, workspaceId, snapshotId, this.concurrency);

        // Create job record
        jdbcTemplate.update(
                "INSERT INTO jobs (id, workspace_id, snapshot_id, operation, status, created_at, updated_at) " +
                        "VALUES (?, ?, ?, 'EXPLAIN_ALL', 'RUNNING', datetime('now'), datetime('now'))",
                jobId, workspaceId, snapshotId);

        // Enqueue all symbol versions (classes, interfaces, etc.) - skip packages & methods for now
        List<Map<String, Object>> symbols = jdbcTemplate.queryForList(
                "SELECT id FROM symbol_versions WHERE snapshot_id = ? AND kind IN ('CLASS', 'INTERFACE', 'ENUM', 'RECORD') " +
                        "AND COALESCE(source_status, 'ACTIVE') = 'ACTIVE'",
                snapshotId);

        int symbolsEnqueued = 0;
        for (Map<String, Object> sym : symbols) {
            String symId = (String) sym.get("id");
            String dedupKey = snapshotId + ":symbol:" + symId;
            try {
                // Skip if already queued/completed
                Integer existing = jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM explanation_queue WHERE dedup_key = ? AND status IN ('COMPLETED', 'PENDING', 'IN_PROGRESS')",
                        Integer.class, dedupKey);
                if (existing != null && existing > 0) continue;

                // Also skip if explanation already exists and is READY
                Integer hasExplanation = jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM explanations WHERE subject_version_id = ? AND subject_type = 'symbol' AND status = 'READY'",
                        Integer.class, symId);
                if (hasExplanation != null && hasExplanation > 0) continue;

                jdbcTemplate.update(
                        "INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, " +
                                "priority, status, job_id, attempt_count, max_retries, dedup_key, created_at, updated_at) " +
                                "VALUES (?, ?, ?, ?, 'symbol', 0, 'PENDING', ?, 0, 3, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                        UUID.randomUUID().toString(), workspaceId, snapshotId, symId, jobId, dedupKey);
                symbolsEnqueued++;
            } catch (Exception e) {
                log.debug("Skipped enqueue for symbol {}: {}", symId, e.getMessage());
            }
        }

        // Enqueue key relationships (INJECTS, EXTENDS, IMPLEMENTS - skip CALLS/DEPENDS_ON for bulk)
        List<Map<String, Object>> relationships = jdbcTemplate.queryForList(
                "SELECT id FROM relationship_occurrences WHERE snapshot_id = ? " +
                        "AND kind IN ('INJECTS', 'EXTENDS', 'IMPLEMENTS', 'DECLARES_BEAN') " +
                        "AND target_symbol_id IS NOT NULL",
                snapshotId);

        int relsEnqueued = 0;
        for (Map<String, Object> rel : relationships) {
            String relId = (String) rel.get("id");
            String dedupKey = snapshotId + ":relationship:" + relId;
            try {
                Integer existing = jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM explanation_queue WHERE dedup_key = ? AND status IN ('COMPLETED', 'PENDING', 'IN_PROGRESS')",
                        Integer.class, dedupKey);
                if (existing != null && existing > 0) continue;

                jdbcTemplate.update(
                        "INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, " +
                                "priority, status, job_id, attempt_count, max_retries, dedup_key, created_at, updated_at) " +
                                "VALUES (?, ?, ?, ?, 'relationship', 0, 'PENDING', ?, 0, 3, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                        UUID.randomUUID().toString(), workspaceId, snapshotId, relId, jobId, dedupKey);
                relsEnqueued++;
            } catch (Exception e) {
                log.debug("Skipped enqueue for relationship {}: {}", relId, e.getMessage());
            }
        }

        // Update job totals
        int total = symbolsEnqueued + relsEnqueued;
        jdbcTemplate.update(
                "UPDATE jobs SET total_items = ?, updated_at = datetime('now') WHERE id = ?",
                total, jobId);

        log.info("Enqueued {} symbols and {} relationships for job {}", symbolsEnqueued, relsEnqueued, jobId);

        // Restart workers with new concurrency if changed
        if (this.concurrency > workers.size()) {
            stopWorker();
            startWorker();
        }

        return jobId;
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
        String dedupKey = snapshotId + ":" + subjectType + ":" + subjectId;
        log.info("Enqueueing high-priority explanation for {} {}", subjectType, subjectId);

        // Check for existing entry
        List<Map<String, Object>> existing = jdbcTemplate.queryForList(
                "SELECT id, status FROM explanation_queue WHERE dedup_key = ?", dedupKey);

        if (!existing.isEmpty()) {
            String status = (String) existing.get(0).get("status");
            if ("COMPLETED".equals(status) || "IN_PROGRESS".equals(status)) {
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
