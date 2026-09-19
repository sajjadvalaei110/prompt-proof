package dev.codeatlas.api.dto;

/** Versioned request for a local, source-only Git review capture. */
public record ReviewRequest(String schemaVersion, String baseRef) {
    public ReviewRequest {
        if (schemaVersion != null && !schemaVersion.isBlank() && !"1".equals(schemaVersion)) {
            throw new IllegalArgumentException("Unsupported review request schemaVersion.");
        }
        if (baseRef != null && baseRef.length() > 512) {
            throw new IllegalArgumentException("baseRef is too long");
        }
    }
}
