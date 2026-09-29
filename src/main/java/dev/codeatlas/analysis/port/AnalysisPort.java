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
     * Discovers source files for this language below {@code root}. Implementations must keep
     * discovery source-only: regular files only, no symlink traversal, and no target build/tool
     * execution.
     */
    List<File> discoverFiles(File root) throws IOException;

    /** Prepare parser/type-resolution state for a run rooted at {@code workspacePath}. */
    void prepare(String workspacePath);

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
