package dev.codeatlas.explanations;

public record QueueStatus(int pending, int inProgress, int completed, int failed, int skipped,
                          String activeJobId, String synthesisStatus, String errorMessage,
                          String synthesisStage, int synthesisCompleted,
                          String synthesisStageStartedAt) {}
