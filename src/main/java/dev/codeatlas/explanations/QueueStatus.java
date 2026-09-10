package dev.codeatlas.explanations;

public record QueueStatus(String schemaVersion, int pending, int inProgress, int completed, int failed, int skipped,
                          String activeJobId, String synthesisStatus, String errorMessage,
                          String synthesisStage, int synthesisCompleted,
                          String synthesisStageStartedAt, String jobStatus,
                          int totalItems, int completedJobItems, int failedJobItems) {}
