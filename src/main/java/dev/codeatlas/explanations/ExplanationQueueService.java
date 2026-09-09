package dev.codeatlas.explanations;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Durable architecture barrier followed by deterministic, sequential symbol processing. */
@Service
public class ExplanationQueueService {
    private static final Logger log = LoggerFactory.getLogger(ExplanationQueueService.class);
    private final JdbcTemplate db;
    private final ExplanationService explanations;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private volatile boolean running;
    private Thread worker;

    public ExplanationQueueService(JdbcTemplate db, ExplanationService explanations, org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.db = db;
        this.explanations = explanations;
        this.transactions = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
    }

    @PostConstruct
    public void init() {
        recoverAbandonedWork();
        startWorker();
    }

    @Transactional
    public void recoverAbandonedWork() {
        db.update("UPDATE explanation_queue SET status = 'PENDING' WHERE status = 'IN_PROGRESS'");
        db.update("UPDATE jobs SET synthesis_status = 'PENDING' WHERE operation = 'EXPLAIN_ALL' AND status = 'RUNNING' AND synthesis_status = 'RUNNING'");
        db.update("UPDATE explanation_queue SET status = 'SKIPPED' WHERE status = 'PENDING' AND job_id IN (SELECT id FROM jobs WHERE status IN ('CANCELLED', 'FAILED'))");
    }

    public synchronized void startWorker() {
        if (running) return;
        running = true;
        worker = new Thread(this::workerLoop, "ExplanationWorker");
        worker.setDaemon(true);
        worker.start();
    }

    @PreDestroy
    public void stopWorker() {
        running = false;
        if (worker != null) {
            worker.interrupt();
            try { worker.join(5000); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
    }

    private void workerLoop() {
        while (running) {
            try {
                if (!processNextItem()) Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                // Provider errors can contain private response data; never log their bodies.
                log.warn("Explanation worker failed ({})", e.getClass().getSimpleName());
                try { Thread.sleep(2000); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
            }
        }
    }

    /**
     * One worker deliberately completes each request before dispatching the next. This gives
     * exact degree/LOC order and makes earlier results available even for cyclic graphs.
     * Explicit clicks have priority, but bulk members cannot pass their architecture barrier.
     */
    public synchronized boolean processNextItem() {
        completeFinalizedJobs();
        var items = db.queryForList("""
            SELECT q.* FROM explanation_queue q LEFT JOIN jobs j ON j.id = q.job_id
            WHERE q.status = 'PENDING' AND (q.job_id IS NULL OR (j.status = 'RUNNING' AND j.synthesis_status = 'READY'))
            ORDER BY q.priority DESC, q.relation_count ASC, q.loc ASC, q.subject_id ASC, q.id ASC LIMIT 1
            """);
        // Start a waiting architecture phase before background symbols, but allow explicit clicks.
        var jobs = db.queryForList("SELECT id, workspace_id, snapshot_id FROM jobs WHERE operation = 'EXPLAIN_ALL' AND status = 'RUNNING' AND synthesis_status = 'PENDING' ORDER BY created_at, id LIMIT 1");
        if (!jobs.isEmpty() && (items.isEmpty() || ((Number) items.get(0).get("priority")).intValue() == 0)) {
            processSynthesis(jobs.get(0));
            return true;
        }
        if (items.isEmpty()) return false;
        var item = items.get(0);
        String id = (String) item.get("id");
        if (db.update("UPDATE explanation_queue SET status = 'IN_PROGRESS', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'", id) == 0) return true;
        try {
            explanations.explainSubject((String) item.get("snapshot_id"), (String) item.get("subject_id"), (String) item.get("subject_type"));
            int fresh = db.queryForObject("SELECT COUNT(*) FROM explanations WHERE snapshot_id = ? AND subject_version_id = ? AND subject_type = ? AND status = 'READY'", Integer.class, item.get("snapshot_id"), item.get("subject_id"), item.get("subject_type"));
            if (fresh == 0) throw new IllegalStateException("Context changed during generation");
            db.update("UPDATE explanation_queue SET status = 'COMPLETED', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        } catch (Exception e) {
            int attempt = ((Number) item.get("attempt_count")).intValue() + 1;
            boolean retry = attempt < ((Number) item.get("max_retries")).intValue();
            db.update("""
                UPDATE explanation_queue SET status = CASE
                    WHEN job_id IN (SELECT id FROM jobs WHERE status != 'RUNNING') THEN 'SKIPPED' ELSE ? END,
                    attempt_count = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
                """, retry ? "PENDING" : "FAILED", attempt, "Generation failed. Check model settings and context budget, then retry.", id);
            if (retry && running) {
                try { Thread.sleep(Math.min(30_000, (1L << Math.min(attempt, 10)) * 1000)); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
        }
        completeFinalizedJobs();
        return true;
    }

    private void processSynthesis(Map<String, Object> job) {
        String id = (String) job.get("id");
        if (db.update("UPDATE jobs SET synthesis_status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING' AND synthesis_status = 'PENDING'", id) == 0) return;
        try {
            var inputs = explanations.synthesizeArchitecture((String) job.get("snapshot_id"));
            transactions.executeWithoutResult(transaction -> {
                // Cancellation and phase release are serialized database mutations, without
                // holding a transaction open during the preceding model request.
                if (!explanations.architectureInputsFresh((String)job.get("snapshot_id"), inputs)) {
                    db.update("UPDATE jobs SET synthesis_status = 'PENDING' WHERE id = ? AND status = 'RUNNING'", id);
                    return;
                }
                if (db.update("UPDATE jobs SET synthesis_status = 'READY', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING'", id) > 0)
                    enqueueBulkSubjects((String)job.get("workspace_id"), (String)job.get("snapshot_id"), id);
            });
        } catch (Exception e) {
            // Only our own bounded validation errors are safe for the UI. Provider errors are opaque.
            String error = e instanceof ExplanationService.SynthesisException ? e.getMessage()
                : "Architecture synthesis failed. Check the configured model and retry Explain all.";
            db.update("UPDATE jobs SET status = 'FAILED', synthesis_status = 'FAILED', error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING'", error, id);
            db.update("UPDATE explanation_queue SET status = 'SKIPPED' WHERE job_id = ? AND status = 'PENDING'", id);
        }
        completeFinalizedJobs();
    }

    @Transactional
    public String startExplainAllJob(String workspaceId, String snapshotId, int concurrency) {
        validateSnapshot(workspaceId, snapshotId);
        var active = db.queryForList("SELECT id FROM jobs WHERE workspace_id = ? AND snapshot_id = ? AND operation = 'EXPLAIN_ALL' AND status = 'RUNNING'", String.class, workspaceId, snapshotId);
        if (!active.isEmpty()) return active.get(0);
        // Sequential execution is the hierarchical policy regardless of the legacy concurrency hint.
        String jobId = UUID.randomUUID().toString();
        db.update("INSERT INTO jobs (id, workspace_id, snapshot_id, operation, status, synthesis_status, created_at, updated_at) VALUES (?, ?, ?, 'EXPLAIN_ALL', 'RUNNING', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", jobId, workspaceId, snapshotId);
        enqueueBulkSubjects(workspaceId, snapshotId, jobId);
        return jobId;
    }

    private void enqueueBulkSubjects(String workspaceId, String snapshotId, String jobId) {
        var subjects = db.queryForList("""
            SELECT s.id,
                (SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id = s.snapshot_id AND r.source_symbol_id = s.id) +
                (SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id = s.snapshot_id AND r.target_symbol_id = s.id) AS relation_count,
                COALESCE((SELECT MAX(e.end_line - e.start_line + 1) FROM symbol_evidence se JOIN evidence e ON e.id = se.evidence_id
                          WHERE se.symbol_version_id = s.id), 2147483647) AS loc
            FROM symbol_versions s WHERE s.snapshot_id = ? AND s.kind IN ('CLASS', 'METHOD')
                AND COALESCE(s.source_status, 'ACTIVE') = 'ACTIVE'
                AND NOT EXISTS (SELECT 1 FROM explanations e WHERE e.snapshot_id = s.snapshot_id AND e.subject_version_id = s.id
                                AND e.subject_type = 'symbol' AND e.status = 'READY')
            ORDER BY relation_count, loc, s.id
            """, snapshotId);
        for (var subject : subjects) {
            String id = (String) subject.get("id");
            db.update("""
                INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, job_id, dedup_key, relation_count, loc)
                VALUES (?, ?, ?, ?, 'symbol', ?, ?, ?, ?)
                ON CONFLICT(dedup_key) DO UPDATE SET job_id = excluded.job_id,
                    status = CASE WHEN explanation_queue.status = 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'PENDING' END,
                    priority = CASE WHEN explanation_queue.status IN ('PENDING','IN_PROGRESS') THEN explanation_queue.priority ELSE 0 END,
                    relation_count = excluded.relation_count, loc = excluded.loc,
                    attempt_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
                """, UUID.randomUUID().toString(), workspaceId, snapshotId, id, jobId, snapshotId + ":symbol:" + id, subject.get("relation_count"), subject.get("loc"));
        }
        db.update("UPDATE jobs SET total_items = (SELECT COUNT(*) FROM explanation_queue WHERE job_id = ?) WHERE id = ?", jobId, jobId);
    }

    private void validateSnapshot(String workspaceId, String snapshotId) {
        if (db.queryForObject("SELECT COUNT(*) FROM snapshots WHERE id = ? AND workspace_id = ? AND status = 'published'", Integer.class, snapshotId, workspaceId) == 0)
            throw new IllegalArgumentException("Published snapshot does not belong to this workspace");
    }

    @Transactional
    public void enqueueExplanation(String workspaceId, String snapshotId, String subjectId, String subjectType) {
        validateSnapshot(workspaceId, snapshotId);
        if (!List.of("symbol", "relationship").contains(subjectType)) throw new IllegalArgumentException("Unknown subject type");
        if ("symbol".equals(subjectType)) {
            var ids = db.queryForList("SELECT id FROM symbol_versions WHERE snapshot_id = ? AND (id = ? OR qualified_name = ?)", String.class, snapshotId, subjectId, subjectId);
            if (ids.size() == 1) subjectId = ids.get(0);
        }
        String table = "symbol".equals(subjectType) ? "symbol_versions" : "relationship_occurrences";
        if (db.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE snapshot_id = ? AND id = ?", Integer.class, snapshotId, subjectId) == 0)
            throw new IllegalArgumentException("Subject does not belong to this snapshot");
        db.update("""
            INSERT INTO explanation_queue (id, workspace_id, snapshot_id, subject_id, subject_type, priority, dedup_key)
            VALUES (?, ?, ?, ?, ?, 100, ?)
            ON CONFLICT(dedup_key) DO UPDATE SET priority = 100,
                job_id = CASE WHEN explanation_queue.job_id IN (SELECT id FROM jobs WHERE status = 'RUNNING') THEN explanation_queue.job_id ELSE NULL END,
                status = CASE WHEN explanation_queue.status = 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'PENDING' END,
                attempt_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            """, UUID.randomUUID().toString(), workspaceId, snapshotId, subjectId, subjectType, snapshotId + ":" + subjectType + ":" + subjectId);
    }

    @Transactional
    public void cancelJob(String jobId) {
        db.update("UPDATE jobs SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING' AND operation = 'EXPLAIN_ALL'", jobId);
        db.update("UPDATE explanation_queue SET status = 'SKIPPED', updated_at = CURRENT_TIMESTAMP WHERE job_id = ? AND status = 'PENDING' AND job_id IN (SELECT id FROM jobs WHERE status = 'CANCELLED')", jobId);
    }

    public QueueStatus getQueueStatus(String workspaceId) {
        var counts = new java.util.HashMap<String, Integer>();
        db.queryForList("SELECT status, COUNT(*) AS n FROM explanation_queue WHERE workspace_id = ? GROUP BY status", workspaceId)
            .forEach(row -> counts.put((String) row.get("status"), ((Number) row.get("n")).intValue()));
        var jobs = db.queryForList("SELECT id, status, synthesis_status, error_message FROM jobs WHERE workspace_id = ? AND operation = 'EXPLAIN_ALL' ORDER BY CASE WHEN status = 'RUNNING' THEN 0 ELSE 1 END, created_at DESC, rowid DESC LIMIT 1", workspaceId);
        var job = jobs.isEmpty() ? Map.<String, Object>of() : jobs.get(0);
        return new QueueStatus(counts.getOrDefault("PENDING", 0), counts.getOrDefault("IN_PROGRESS", 0), counts.getOrDefault("COMPLETED", 0),
            counts.getOrDefault("FAILED", 0), counts.getOrDefault("SKIPPED", 0), "RUNNING".equals(job.get("status")) ? (String) job.get("id") : null,
            (String) job.get("synthesis_status"), (String) job.get("error_message"));
    }

    private void completeFinalizedJobs() {
        db.update("""
            UPDATE jobs SET
                completed_items = (SELECT COUNT(*) FROM explanation_queue q WHERE q.job_id = jobs.id AND q.status = 'COMPLETED'),
                failed_items = (SELECT COUNT(*) FROM explanation_queue q WHERE q.job_id = jobs.id AND q.status = 'FAILED'),
                skipped_items = (SELECT COUNT(*) FROM explanation_queue q WHERE q.job_id = jobs.id AND q.status = 'SKIPPED')
            WHERE operation = 'EXPLAIN_ALL' AND status = 'RUNNING'
            """);
        db.update("""
            UPDATE jobs SET status = CASE WHEN failed_items > 0 THEN 'FAILED' ELSE 'COMPLETED' END,
                updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
            WHERE operation = 'EXPLAIN_ALL' AND status = 'RUNNING' AND synthesis_status = 'READY'
                AND NOT EXISTS (SELECT 1 FROM explanation_queue q WHERE q.job_id = jobs.id AND q.status IN ('PENDING', 'IN_PROGRESS'))
            """);
    }
}
