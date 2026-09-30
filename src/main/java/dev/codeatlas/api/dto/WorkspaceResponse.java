package dev.codeatlas.api.dto;

/** {@code indexer} null means the language's default engine (ADR 0012). */
public record WorkspaceResponse(String id, String path, String activeSnapshotId, String language, String indexer) {
    /** Kept for callers that predate indexing engines (ADR 0012): the language's default engine. */
    public WorkspaceResponse(String id, String path, String activeSnapshotId, String language) {
        this(id, path, activeSnapshotId, language, null);
    }
}
