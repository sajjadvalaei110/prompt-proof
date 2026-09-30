package dev.codeatlas.analysis;

import dev.codeatlas.analysis.port.AnalysisPort;
import dev.codeatlas.analysis.port.AnalysisPortRegistry;
import dev.codeatlas.workspace.WorkspaceTrust;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;

/**
 * Orchestrates analysis runs: file discovery, parsing, Spring annotation
 * analysis, and change detection.
 *
 * Analysis proceeds in phases:
 * 1. File discovery
 * 2. Declaration parsing (classes, methods, fields)
 * 3. Relationship extraction (calls, inheritance)
 * 4. Spring annotation analysis (stereotypes, routes, injection)
 * 5. Change detection and staleness marking (R4)
 */
@Service
public class AnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    private final JdbcTemplate jdbcTemplate;
    private final AnalysisPortRegistry portRegistry;
    /**
     * One transaction per file in the declaration and relationship passes: a file's rows land together or not at
     * all (a failure mid-file no longer leaves partial symbols that break later files), and SQLite commits once per
     * file instead of once per inserted row, which dominated extraction time.
     */
    private final TransactionTemplate fileTransaction;

    public AnalysisService(JdbcTemplate jdbcTemplate,
                           AnalysisPortRegistry portRegistry,
                           PlatformTransactionManager transactionManager) {
        this.jdbcTemplate = jdbcTemplate;
        this.portRegistry = portRegistry;
        this.fileTransaction = new TransactionTemplate(transactionManager);
    }

    /**
     * Run a full analysis for a workspace, creating a new snapshot.
     * Includes change detection against the previous snapshot.
     */
    public synchronized void runAnalysis(String workspaceId, String jobId) {
        String snapshotId = null;
        AnalysisPort adapter = null;
        try {
            Map<String, Object> workspace = jdbcTemplate.queryForMap(
                    "SELECT canonical_root, language, indexer, trust_state, active_snapshot_id FROM workspaces WHERE id = ?", workspaceId);
            String path = (String) workspace.get("canonical_root");
            // Resolve the adapter before creating a staging snapshot. Unsupported language errors
            // are still recorded on the existing job instead of leaving it RUNNING forever.
            adapter = portRegistry.require((String) workspace.get("language"), (String) workspace.get("indexer"));
            String language = adapter.language();
            String indexer = AnalysisPortRegistry.indexerOf(adapter);
            // ADR 0012: an engine that runs the repository's own build needs the owner's explicit consent,
            // recorded on the workspace, and a working installation; otherwise nothing is started.
            if (adapter.executesTargetBuild() && !WorkspaceTrust.BUILD_ALLOWED.equals(workspace.get("trust_state"))) {
                throw new IllegalStateException("The " + indexer + " indexer runs this project's build, which was not allowed for this workspace. "
                        + "Re-import it with build execution allowed, or choose a source-only indexer.");
            }
            Optional<String> unavailable = adapter.unavailableReason();
            if (unavailable.isPresent()) throw new IllegalStateException(unavailable.get());
            final AnalysisPort runAdapter = adapter;

            String previousSnapshotId = (String) workspace.get("active_snapshot_id");
            snapshotId = UUID.randomUUID().toString();
            jdbcTemplate.update(
                    "INSERT INTO snapshots (id, workspace_id, language, indexer, status, created_at) VALUES (?, ?, ?, ?, 'staging', datetime('now'))",
                    snapshotId, workspaceId, language, indexer);
            jdbcTemplate.update("UPDATE jobs SET snapshot_id = ? WHERE id = ?", snapshotId, jobId);

            // Phase 1: Discover files
            List<File> sourceFiles = adapter.discoverFiles(new File(path));
            int totalFiles = sourceFiles.size();
            boolean hasFrameworkPass = adapter.supportsFrameworkPass();
            int passCount = hasFrameworkPass ? 3 : 2;
            jdbcTemplate.update("UPDATE jobs SET total_items = ? WHERE id = ?", totalFiles * passCount, jobId);
            log.info("Analysis started: {} {} files discovered in {}", totalFiles, language, path);

            // Phase 2: Parse declarations (Pass 1)
            adapter.prepare(path);
            int parsed = 0;
            for (File file : sourceFiles) {
                try {
                    String currentSnapshotId = snapshotId;
                    fileTransaction.executeWithoutResult(status -> runAdapter.parseDeclarations(file, workspaceId, currentSnapshotId));
                } catch (Exception e) {
                    log.warn("Declaration parsing failed for {}: {}", file.getName(), e.getMessage());
                    // The file's transaction rolled back, so none of its rows remain; the relationship pass skips it.
                    adapter.addDiagnostic(file.getName() + ": declaration parsing failed (" + e.getMessage() + "); file excluded from graph.");
                }
                parsed++;
                if (parsed % 50 == 0) {
                    jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                }
            }
            jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            log.info("Pass 1 complete: {} declarations parsed", parsed);

            // Phase 3: Parse relationships (Pass 2)
            for (File file : sourceFiles) {
                try {
                    String currentSnapshotId = snapshotId;
                    fileTransaction.executeWithoutResult(status -> runAdapter.parseRelationships(file, workspaceId, currentSnapshotId));
                } catch (Exception e) {
                    log.warn("Relationship parsing failed for {}: {}", file.getName(), e.getMessage());
                    adapter.addDiagnostic(file.getName() + ": relationship parsing failed (" + e.getMessage() + "); relationships for this file may be incomplete.");
                }
                parsed++;
                if (parsed % 50 == 0) {
                    jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                }
            }
            linkOverrides(adapter, snapshotId);
            jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            log.info("Pass 2 complete: relationships extracted");

            // Optional adapter-owned framework enrichment (Pass 3 for Java).
            int frameworkFilesAnalyzed = 0;
            if (hasFrameworkPass) {
                int baseProgress = parsed;
                frameworkFilesAnalyzed = adapter.runFrameworkPass(sourceFiles, workspaceId, snapshotId,
                        completedFiles -> {
                            int completed = baseProgress + completedFiles;
                            if (completed % 50 == 0 || completed == totalFiles * passCount) {
                                jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", completed, jobId);
                            }
                        });
                parsed += totalFiles;
                jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                log.info("Framework pass complete: {} files had framework annotations", frameworkFilesAnalyzed);
            }

            // Phase 5: Change detection (R4)
            if (previousSnapshotId != null) {
                detectChanges(previousSnapshotId, snapshotId, workspaceId);
            }

            // Update snapshot stats
            int symbolCount = countForSnapshot("symbol_versions", snapshotId);
            int relCount = countForSnapshot("relationship_occurrences", snapshotId);
            int fileCount = countForSnapshot("source_file_versions", snapshotId);
            int routeCount = countForSnapshot("http_routes", snapshotId);
            int injectionCount = countForSnapshot("injection_points", snapshotId);

            jdbcTemplate.update(
                    "UPDATE snapshots SET status = 'published', symbol_count = ?, " +
                            "relationship_count = ?, file_count = ?, completed_at = datetime('now'), " +
                            "diagnostics = ? WHERE id = ?",
                    symbolCount, relCount, fileCount,
                    new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(Map.of("routes", routeCount, "injections", injectionCount, "springFiles", frameworkFilesAnalyzed, "warnings", adapter.diagnostics())),
                    snapshotId);

            // Atomically publish: update active snapshot
            jdbcTemplate.update(
                    "UPDATE workspaces SET active_snapshot_id = ?, updated_at = datetime('now') WHERE id = ?",
                    snapshotId, workspaceId);

            // Complete job
            jdbcTemplate.update(
                    "UPDATE jobs SET status = 'COMPLETED', completed_items = ?, updated_at = datetime('now') WHERE id = ?",
                    parsed, jobId);

            log.info("Analysis complete: {} symbols, {} relationships, {} routes, {} injections",
                    symbolCount, relCount, routeCount, injectionCount);

        } catch (Exception e) {
            log.error("Analysis failed for workspace {}: {}", workspaceId, e.getMessage(), e);
            if (snapshotId != null) {
                jdbcTemplate.update("UPDATE snapshots SET status = 'failed' WHERE id = ?", snapshotId);
            }
            jdbcTemplate.update(
                    "UPDATE jobs SET status = 'FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?",
                    e.getMessage(), jobId);
        } finally {
            if (adapter != null) adapter.releaseRunCaches();
        }
    }

    /**
     * Indexes a private, already-captured source tree for a review.  This shares the parser lock with
     * ordinary analysis, but deliberately has no job, change detection, active-snapshot update, or
     * explanation invalidation.  The captured tree is owned by the application, never by the target repo.
     * {@code workspaceRoot} is the workspace the tree was captured from; source roots are found by its layout.
     */
    public synchronized void runReviewAnalysis(String workspaceId, String snapshotId, Path capturedRoot) {
        runReviewAnalysis(workspaceId, snapshotId, capturedRoot, capturedRoot);
    }

    public synchronized void runReviewAnalysis(String workspaceId, String snapshotId, Path capturedRoot, Path workspaceRoot) {
        AnalysisPort adapter = null;
        try {
            String requestedLanguage = jdbcTemplate.queryForObject(
                    "SELECT language FROM snapshots WHERE id = ? AND workspace_id = ?", String.class,
                    snapshotId, workspaceId);
            // Captures hold sources only and must never run a build: always the language's default,
            // source-only engine, whatever engine the workspace itself uses (ADR 0012).
            adapter = portRegistry.require(requestedLanguage);
            String language = adapter.language();
            final AnalysisPort runAdapter = adapter;
            jdbcTemplate.update("UPDATE snapshots SET indexer = ? WHERE id = ?", AnalysisPortRegistry.indexerOf(adapter), snapshotId);
            List<File> sourceFiles = adapter.discoverFiles(capturedRoot.toFile());
            adapter.prepare(capturedRoot.toString(), workspaceRoot);
            List<File> declarationFiles = new ArrayList<>();
            for (File file : sourceFiles) {
                try {
                    fileTransaction.executeWithoutResult(status -> runAdapter.parseDeclarations(file, workspaceId, snapshotId));
                    if (hasIndexedDeclarations(snapshotId, capturedRoot, file)) declarationFiles.add(file);
                } catch (Exception e) {
                    adapter.addDiagnostic(file.getName() + ": declaration parsing failed; file excluded from graph.");
                }
            }
            for (File file : declarationFiles) {
                try {
                    fileTransaction.executeWithoutResult(status -> runAdapter.parseRelationships(file, workspaceId, snapshotId));
                } catch (Exception e) {
                    adapter.addDiagnostic(file.getName() + ": relationship parsing failed; relationships may be incomplete.");
                }
            }
            linkOverrides(adapter, snapshotId);
            if (adapter.supportsFrameworkPass()) {
                adapter.runFrameworkPass(declarationFiles, workspaceId, snapshotId, ignored -> { });
            }
            int symbolCount = countForSnapshot("symbol_versions", snapshotId);
            int relationshipCount = countForSnapshot("relationship_occurrences", snapshotId);
            int fileCount = countForSnapshot("source_file_versions", snapshotId);
            String diagnostics = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                    Map.of("warnings", adapter.diagnostics(), "reviewCapture", true, "language", language));
            jdbcTemplate.update("UPDATE snapshots SET status='published', symbol_count=?, relationship_count=?, file_count=?, diagnostics=?, completed_at=datetime('now') WHERE id=?",
                    symbolCount, relationshipCount, fileCount, diagnostics, snapshotId);
            log.info("Review snapshot complete: {} source files, {} symbols, {} relationships", fileCount, symbolCount, relationshipCount);
        } catch (Exception e) {
            jdbcTemplate.update("UPDATE snapshots SET status='failed', completed_at=datetime('now') WHERE id=?", snapshotId);
            throw new IllegalArgumentException("Review capture analysis failed (" + e.getClass().getSimpleName() + ").");
        } finally {
            if (adapter != null) adapter.releaseRunCaches();
        }
    }

    /** ADR 0010: OVERRIDES facts need every file's relationship pass first; one transaction. */
    private void linkOverrides(AnalysisPort adapter, String snapshotId) {
        try {
            fileTransaction.executeWithoutResult(status -> adapter.linkRelationships(snapshotId));
        } catch (Exception e) {
            log.warn("OVERRIDES linking failed: {}", e.getMessage());
            adapter.addDiagnostic("OVERRIDES linking failed (" + e.getMessage() + "); no OVERRIDES facts were added.");
        }
    }

    private boolean hasIndexedDeclarations(String snapshotId, Path root, File file) {
        String relative = root.relativize(file.toPath().toAbsolutePath()).toString();
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM symbol_evidence se JOIN evidence e ON e.id=se.evidence_id " +
                        "JOIN source_file_versions f ON f.id=e.source_file_version_id " +
                        "WHERE f.snapshot_id=? AND f.relative_path=?", Integer.class, snapshotId, relative);
        return count != null && count > 0;
    }

    // -----------------------------------------------------------------------
    //  R4: Change detection
    // -----------------------------------------------------------------------

    /**
     * Detect changes between two snapshots and mark stale explanations.
     *
     * Compares source_file_versions by content_hash to find:
     * - New files (present in new, absent in old)
     * - Modified files (different content_hash for same relative_path)
     * - Deleted files (present in old, absent in new)
     *
     * For modified/deleted files, marks their explanations as STALE
     * instead of discarding them.
     */
    private void detectChanges(String oldSnapshotId, String newSnapshotId, String workspaceId) {
        log.info("Detecting changes between snapshots {} → {}", oldSnapshotId, newSnapshotId);

        try {
            // Find modified files (same path, different hash)
            List<Map<String, Object>> modifiedFiles = jdbcTemplate.queryForList(
                    "SELECT old.relative_path, old.content_hash AS old_hash, new.content_hash AS new_hash " +
                            "FROM source_file_versions old " +
                            "JOIN source_file_versions new ON old.relative_path = new.relative_path " +
                            "WHERE old.snapshot_id = ? AND new.snapshot_id = ? AND old.content_hash != new.content_hash",
                    oldSnapshotId, newSnapshotId);

            // Find deleted files (in old but not in new)
            List<Map<String, Object>> deletedFiles = jdbcTemplate.queryForList(
                    "SELECT old.relative_path " +
                            "FROM source_file_versions old " +
                            "LEFT JOIN source_file_versions new ON old.relative_path = new.relative_path AND new.snapshot_id = ? " +
                            "WHERE old.snapshot_id = ? AND new.id IS NULL",
                    newSnapshotId, oldSnapshotId);

            int staleCount = 0;

            // Mark explanations for modified files as STALE
            for (Map<String, Object> modified : modifiedFiles) {
                String relativePath = (String) modified.get("relative_path");
                staleCount += markExplanationsStale(oldSnapshotId, relativePath);
                log.debug("Modified file: {} → marking explanations stale", relativePath);
            }

            // Mark explanations for deleted files as STALE and symbols as DELETED
            for (Map<String, Object> deleted : deletedFiles) {
                String relativePath = (String) deleted.get("relative_path");
                staleCount += markExplanationsStale(oldSnapshotId, relativePath);
                // Mark symbols from deleted files in old snapshot
                // Published snapshots retain their historical symbols. The new snapshot omits deleted files.
                log.debug("Deleted file: {} → marking symbols deleted and explanations stale", relativePath);
            }

            // Find new files
            int newFileCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM source_file_versions new " +
                            "LEFT JOIN source_file_versions old ON new.relative_path = old.relative_path AND old.snapshot_id = ? " +
                            "WHERE new.snapshot_id = ? AND old.id IS NULL",
                    Integer.class, oldSnapshotId, newSnapshotId);

            log.info("Change detection: {} modified, {} deleted, {} new files; {} explanations marked stale",
                    modifiedFiles.size(), deletedFiles.size(), newFileCount, staleCount);

        } catch (Exception e) {
            log.warn("Change detection failed (non-fatal): {}", e.getMessage());
        }
    }

    /**
     * Mark explanations for symbols in a given file as STALE.
     * Returns count of explanations marked stale.
     */
    private int markExplanationsStale(String snapshotId, String relativePath) {
        // Find all symbol IDs that came from this file
        // The source_file_versions stores the file content; we need to find symbols
        // that were parsed from files matching this path
        try {
            // Note: symbols don't directly reference source files in current schema,
            // but we can match by looking at qualified names that were in those files
            return jdbcTemplate.update(
                    "UPDATE explanations SET status = 'STALE', updated_at = datetime('now') " +
                            "WHERE snapshot_id = ? AND status = 'READY' AND subject_version_id IN " +
                            "(SELECT sv.id FROM symbol_versions sv " +
                            " JOIN source_file_versions sfv ON sv.snapshot_id = sfv.snapshot_id " +
                            " WHERE sfv.relative_path = ? AND sfv.snapshot_id = ?)",
                    snapshotId, relativePath, snapshotId);
        } catch (Exception e) {
            log.debug("Could not mark explanations stale for {}: {}", relativePath, e.getMessage());
            return 0;
        }
    }

    // -----------------------------------------------------------------------
    //  Content hashing for change detection
    // -----------------------------------------------------------------------

    /**
     * Compute SHA-256 hash of file content for change detection.
     */
    public static String computeContentHash(File file) {
        try {
            byte[] content = Files.readAllBytes(file.toPath());
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(content);
            return bytesToHex(hash);
        } catch (Exception e) {
            return "error:" + e.getMessage();
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private int countForSnapshot(String table, String snapshotId) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM " + table + " WHERE snapshot_id = ?",
                    Integer.class, snapshotId);
        } catch (Exception e) {
            return 0;
        }
    }
}
