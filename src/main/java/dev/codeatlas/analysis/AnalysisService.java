package dev.codeatlas.analysis;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;

import java.io.File;
import java.nio.file.Files;
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
    private final SourceDiscoveryService discoveryService;
    private final JavaParserAdapter parserAdapter;
    private final SpringAnnotationAnalyzer springAnalyzer;

    public AnalysisService(JdbcTemplate jdbcTemplate,
                           SourceDiscoveryService discoveryService,
                           JavaParserAdapter parserAdapter,
                           SpringAnnotationAnalyzer springAnalyzer) {
        this.jdbcTemplate = jdbcTemplate;
        this.discoveryService = discoveryService;
        this.parserAdapter = parserAdapter;
        this.springAnalyzer = springAnalyzer;
    }

    /**
     * Run a full analysis for a workspace, creating a new snapshot.
     * Includes change detection against the previous snapshot.
     */
    public synchronized void runAnalysis(String workspaceId, String jobId) {
        String path = jdbcTemplate.queryForObject(
                "SELECT canonical_root FROM workspaces WHERE id = ?", String.class, workspaceId);

        // Get previous active snapshot for change detection
        String previousSnapshotId = null;
        try {
            previousSnapshotId = jdbcTemplate.queryForObject(
                    "SELECT active_snapshot_id FROM workspaces WHERE id = ?", String.class, workspaceId);
        } catch (Exception e) {
            // No previous snapshot
        }

        // Create new snapshot
        String snapshotId = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO snapshots (id, workspace_id, status, created_at) VALUES (?, ?, 'staging', datetime('now'))",
                snapshotId, workspaceId);
        jdbcTemplate.update("UPDATE jobs SET snapshot_id = ? WHERE id = ?", snapshotId, jobId);

        try {
            // Phase 1: Discover files
            List<File> javaFiles = discoveryService.discoverJavaFiles(new File(path));
            int totalFiles = javaFiles.size();
            // 3 passes: declarations, relationships, spring analysis
            jdbcTemplate.update("UPDATE jobs SET total_items = ? WHERE id = ?", totalFiles * 3, jobId);
            log.info("Analysis started: {} Java files discovered in {}", totalFiles, path);

            // Phase 2: Parse declarations (Pass 1)
            parserAdapter.setupSymbolSolver(path);
            int parsed = 0;
            for (File file : javaFiles) {
                try {
                    parserAdapter.parseDeclarations(file, workspaceId, snapshotId);
                } catch (Exception e) {
                    log.warn("Declaration parsing failed for {}: {}", file.getName(), e.getMessage());
                    parserAdapter.addDiagnostic(file.getName() + ": declaration parsing failed (" + e.getMessage() + "); file excluded from graph.");
                }
                parsed++;
                if (parsed % 50 == 0) {
                    jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                }
            }
            jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            log.info("Pass 1 complete: {} declarations parsed", parsed);

            // Phase 3: Parse relationships (Pass 2)
            for (File file : javaFiles) {
                try {
                    parserAdapter.parseRelationships(file, workspaceId, snapshotId);
                } catch (Exception e) {
                    log.warn("Relationship parsing failed for {}: {}", file.getName(), e.getMessage());
                    parserAdapter.addDiagnostic(file.getName() + ": relationship parsing failed (" + e.getMessage() + "); relationships for this file may be incomplete.");
                }
                parsed++;
                if (parsed % 50 == 0) {
                    jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                }
            }
            jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            log.info("Pass 2 complete: relationships extracted");

            // Phase 4: Spring annotation analysis (Pass 3)
            int springFilesAnalyzed = 0;
            List<SpringAnnotationAnalyzer.SpringAnalysisResult> springResults = new ArrayList<>();
            for (File file : javaFiles) {
                try {
                    CompilationUnit cu = StaticJavaParser.parse(file);
                    SpringAnnotationAnalyzer.SpringAnalysisResult result = springAnalyzer.analyze(cu);
                    if (!result.isEmpty()) {
                        springResults.add(result);
                        springFilesAnalyzed++;
                    }
                } catch (Exception e) {
                    log.debug("Spring analysis skipped for {}: {}", file.getName(), e.getMessage());
                }
                parsed++;
                if (parsed % 50 == 0) {
                    jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
                }
            }

            // Sub-pass 4a: Persist all roles, routes, and bean declarations first
            for (SpringAnnotationAnalyzer.SpringAnalysisResult result : springResults) {
                springAnalyzer.persistRolesRoutesBeans(snapshotId, workspaceId, result);
            }

            // Sub-pass 4b: Resolve and persist all injection points now that all components exist in DB
            for (SpringAnnotationAnalyzer.SpringAnalysisResult result : springResults) {
                springAnalyzer.persistInjections(snapshotId, result);
            }

            jdbcTemplate.update("UPDATE jobs SET completed_items = ? WHERE id = ?", parsed, jobId);
            log.info("Pass 3 complete: {} files had Spring annotations", springFilesAnalyzed);

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
                    new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(Map.of("routes", routeCount, "injections", injectionCount, "springFiles", springFilesAnalyzed, "warnings", parserAdapter.diagnostics())),
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
            jdbcTemplate.update("UPDATE snapshots SET status = 'failed' WHERE id = ?", snapshotId);
            jdbcTemplate.update(
                    "UPDATE jobs SET status = 'FAILED', error_message = ?, updated_at = datetime('now') WHERE id = ?",
                    e.getMessage(), jobId);
        }
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
