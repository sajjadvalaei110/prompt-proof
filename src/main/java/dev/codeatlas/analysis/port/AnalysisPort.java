package dev.codeatlas.analysis.port;

import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.function.IntConsumer;

/**
 * Language-neutral seam for source analysis.
 *
 * <p>An implementation owns the parser and the language-specific resolution rules. The
 * orchestration layer only knows how to discover source files, run the declaration pass before
 * the relationship pass, and report diagnostics. Implementations persist the facts through the
 * application's versioned graph tables: every symbol and relationship must retain exact evidence
 * coordinates, and every relationship must use an explicit {@code RESOLVED}, {@code CANDIDATE}, or
 * {@code UNRESOLVED} status. Explanations are outside this port.</p>
 *
 * <p>A port instance is used by one synchronized analysis run at a time. Implementations may keep
 * parser and lookup caches between the two passes, and must release those caches after the run,
 * including when the run fails.</p>
 */
public interface AnalysisPort {

    /** Stable lowercase identifier stored on a workspace and its snapshots, for example {@code java}. */
    String language();

    /**
     * Stable lowercase identifier of the indexing engine inside {@link #language()}, for example
     * {@code javaparser} or {@code scip-java} (ADR 0012). A language may ship several engines; each
     * workspace and snapshot records the one it used. Defaults to the language itself for adapters
     * that are the only engine of their language.
     */
    default String indexer() {
        return language();
    }

    /** Human-readable engine name for the import screen. */
    default String indexerLabel() {
        return indexer();
    }

    /** Whether this engine is the one chosen when a workspace names only its language. */
    default boolean defaultIndexer() {
        return true;
    }

    /**
     * Whether this engine runs the target repository's own build (ADR 0012). Such an engine is used only
     * for a workspace whose owner explicitly allowed build execution, and never for review captures.
     */
    default boolean executesTargetBuild() {
        return false;
    }

    /**
     * Whether this engine fills the occurrence index ({@code code_occurrences}) that source navigation reads
     * (ADR 0013): every resolved name in an indexed file, definitions and references, with 1-based lines,
     * 1-based start and inclusive end columns counted in UTF-16 code units, and an engine-scoped symbol key the
     * API never parses. Navigation is a capability of the engine, not of its language; the viewer offers go to
     * definition exactly for snapshots whose engine declares it.
     */
    default boolean providesNavigation() {
        return false;
    }

    /**
     * Why this engine cannot run on this machine right now (for example a missing tool), or empty when
     * it can. Callers show the reason instead of offering an engine that would fail every run.
     */
    default java.util.Optional<String> unavailableReason() {
        return java.util.Optional.empty();
    }

    /**
     * Discovers source files for this language below {@code root}. Implementations must keep
     * discovery source-only: regular files only, no symlink traversal, and no target build/tool
     * execution.
     */
    List<File> discoverFiles(File root) throws IOException;

    /** Prepare parser/type-resolution state for a run rooted at {@code workspacePath}. */
    void prepare(String workspacePath);

    /** Prepare a captured tree while retaining the original workspace layout for resolution. */
    default void prepare(String capturedPath, java.nio.file.Path workspaceRoot) {
        prepare(capturedPath);
    }

    /** Optional cross-file relationship linking after all relationship passes, inside one transaction. */
    default void linkRelationships(String snapshotId) { }

    /** Index declarations and their exact source evidence for one file. */
    void parseDeclarations(File file, String workspaceId, String snapshotId);

    /** Index relationships and their exact source evidence after declarations are available. */
    void parseRelationships(File file, String workspaceId, String snapshotId);

    /**
     * Whether this language adapter supplies one additional, source-only framework enrichment pass.
     * The orchestration layer uses this only for progress accounting; framework rules and facts stay
     * inside the adapter.
     */
    default boolean supportsFrameworkPass() {
        return false;
    }

    /**
     * Run optional framework enrichment after relationships have been indexed. The callback receives
     * the number of input files processed so far (starting at one). The return value is the number of
     * files that produced framework facts. Adapters without a framework pass keep the default.
     */
    default int runFrameworkPass(List<File> files, String workspaceId, String snapshotId,
                                 IntConsumer completedFileCount) {
        throw new UnsupportedOperationException("This analysis adapter has no framework pass");
    }

    /** Diagnostics accumulated during the current run, safe for persistence as display data. */
    List<String> diagnostics();

    /** Add a non-fatal diagnostic while retaining partial-analysis visibility. */
    void addDiagnostic(String message);

    /** Release per-run parser and resolution caches. */
    void releaseRunCaches();
}
