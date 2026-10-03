package dev.codeatlas.workspace;

/**
 * Values of {@code workspaces.trust_state}. Every workspace starts source-only. ADR 0012 adds the one other
 * state: the owner explicitly allowed an indexer that runs the repository's own build (for example scip-java
 * running Gradle, which executes the build scripts). Choosing a source-only indexer again drops that permission.
 */
public final class WorkspaceTrust {
    public static final String SOURCE_ONLY = "source_only";
    public static final String BUILD_ALLOWED = "build_allowed";
    /** A project with no source folder, holding only a design (ADR 0016). Never analyzed. */
    public static final String DESIGN_ONLY = "design_only";

    private WorkspaceTrust() { }
}
