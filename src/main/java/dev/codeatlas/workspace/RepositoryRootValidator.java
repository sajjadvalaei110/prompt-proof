package dev.codeatlas.workspace;

import java.io.File;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Validates a workspace's optional repository root (ADR 0015): the directory that holds the Git repository and
 * bounds a build engine's build-root search. The root is canonicalized (symbolic links resolved), and the
 * canonical root must contain the canonical workspace, so a root that is, or passes through, a link pointing
 * somewhere that does not hold the workspace is rejected rather than followed out of the tree.
 */
public final class RepositoryRootValidator {
    private RepositoryRootValidator() {}

    /** Empty for a blank value (auto-detect); otherwise the canonical root, or IllegalArgumentException (400). */
    public static Optional<Path> validate(Path canonicalWorkspace, String raw) {
        if (raw == null || raw.isBlank()) return Optional.empty();
        File file = WorkspacePaths.normalize(raw);
        if (!file.exists()) throw new IllegalArgumentException("Repository root does not exist: " + file);
        if (!file.isDirectory()) throw new IllegalArgumentException("Repository root is a file, not a directory: " + file);
        Path root;
        try { root = file.toPath().toRealPath(); }
        catch (IOException e) { throw new IllegalArgumentException("Repository root cannot be resolved: " + file); }
        Path workspace = canonicalWorkspace.toAbsolutePath().normalize();
        if (!workspace.startsWith(root)) {
            throw new IllegalArgumentException("Repository root " + root + " does not contain the workspace " + workspace
                    + ". Name the workspace's own directory or one above it.");
        }
        return Optional.of(root);
    }
}
