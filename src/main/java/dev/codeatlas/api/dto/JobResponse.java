package dev.codeatlas.api.dto;
import dev.codeatlas.api.dto.enums.JobStatus;

public record JobResponse(String id, String operation, JobStatus status, int totalItems, int completedItems, int failedItems) {}
