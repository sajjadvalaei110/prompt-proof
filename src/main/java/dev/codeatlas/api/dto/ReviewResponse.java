package dev.codeatlas.api.dto;

import java.util.List;

/** Immutable comparison facts. Presentation decides which of the base/overlay/head modes to render. */
public record ReviewResponse(
        String schemaVersion,
        String workspaceId,
        ReviewSide base,
        ReviewHead head,
        ReviewSummary summary,
        List<ReviewFile> files,
        List<ReviewNode> nodes,
        List<ReviewRelationship> relationships,
        List<ReviewDiagnostic> diagnostics) {
    public record ReviewSide(String snapshotId, String requestedRef, String resolvedRef, String warning) {}
    public record ReviewHead(String snapshotId, String ref, String headOid, String fingerprint, String capturedAt) {}
    public record ReviewSummary(int addedLines, int removedLines, int changedFiles) {}
    public record ReviewFile(String path, String status, int addedLines, int removedLines, boolean javaFile,
                             boolean lineCountsAvailable) {}
    public record ReviewNode(String comparisonKey, String change, int addedLines, int removedLines, GraphNode base, GraphNode head) {}
    public record ReviewRelationship(String comparisonKey, String change, GraphEdge base, GraphEdge head) {}
    public record ReviewDiagnostic(String severity, String code, String message) {}
}
