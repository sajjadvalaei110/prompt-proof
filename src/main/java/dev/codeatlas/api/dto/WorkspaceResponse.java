package dev.codeatlas.api.dto;

/**
 * {@code indexer} null means the language's default engine (ADR 0012). {@code repositoryRoot} null means the
 * Git and build roots are auto-detected from the workspace path (ADR 0015).
 */
public record WorkspaceResponse(String id, String path, String activeSnapshotId, String language, String indexer, String repositoryRoot) {
    /** Kept for callers that predate indexing engines (ADR 0012): the language's default engine. */
    public WorkspaceResponse(String id, String path, String activeSnapshotId, String language) {
        this(id, path, activeSnapshotId, language, null, null);
    }
    public WorkspaceResponse(String id, String path, String activeSnapshotId, String language, String indexer) {
        this(id, path, activeSnapshotId, language, indexer, null);
    }
}
