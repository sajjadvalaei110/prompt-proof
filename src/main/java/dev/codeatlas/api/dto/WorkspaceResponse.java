package dev.codeatlas.api.dto;

/**
 * {@code indexer} null means the language's default engine (ADR 0012). {@code designOnly}: a project with no
 * source folder, holding only an imported or authored design (ADR 0016); it is never analyzed. {@code name} is the
 * display name.
 */
public record WorkspaceResponse(String id, String path, String activeSnapshotId, String language, String indexer, boolean designOnly, String name) {
    public WorkspaceResponse(String id, String path, String activeSnapshotId, String language, String indexer) {
        this(id, path, activeSnapshotId, language, indexer, false, null);
    }
    /** Kept for callers that predate indexing engines (ADR 0012): the language's default engine. */
    public WorkspaceResponse(String id, String path, String activeSnapshotId, String language) {
        this(id, path, activeSnapshotId, language, null);
    }
}
