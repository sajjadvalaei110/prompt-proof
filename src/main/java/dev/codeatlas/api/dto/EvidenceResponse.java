package dev.codeatlas.api.dto;

public record EvidenceResponse(String relativePath, String fileHash, int startLine, int startColumn, int endLine, int endColumn, String snippet, String snapshotSource) {}
