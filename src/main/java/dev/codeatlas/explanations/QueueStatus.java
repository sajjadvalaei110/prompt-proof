package dev.codeatlas.explanations;

public record QueueStatus(int pending, int inProgress, int completed, int failed, int skipped, String activeJobId) {
}
