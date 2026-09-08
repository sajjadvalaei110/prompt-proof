-- R3 Additions

-- Add spring_metadata to symbol_versions
ALTER TABLE symbol_versions ADD COLUMN spring_metadata TEXT;

-- New table http_routes
CREATE TABLE http_routes (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    symbol_version_id TEXT NOT NULL,
    http_method TEXT NOT NULL,
    path TEXT NOT NULL,
    consumes TEXT,
    produces TEXT,
    FOREIGN KEY(symbol_version_id) REFERENCES symbol_versions(id)
);

CREATE INDEX idx_http_routes_symbol_version_id ON http_routes(symbol_version_id);
CREATE INDEX idx_http_routes_snapshot_id ON http_routes(snapshot_id);

-- New table injection_points
CREATE TABLE injection_points (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL,
    source_symbol_id TEXT NOT NULL,
    target_type_name TEXT NOT NULL,
    injection_kind TEXT NOT NULL,
    qualifier_value TEXT,
    resolved_candidates TEXT,
    resolution TEXT NOT NULL,
    FOREIGN KEY(source_symbol_id) REFERENCES symbol_versions(id)
);

CREATE INDEX idx_injection_points_source_symbol_id ON injection_points(source_symbol_id);
CREATE INDEX idx_injection_points_snapshot_id ON injection_points(snapshot_id);

-- R4 Additions

-- Add columns to explanations
ALTER TABLE explanations ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE explanations ADD COLUMN last_error TEXT;
ALTER TABLE explanations ADD COLUMN priority INTEGER DEFAULT 0;

-- Add column to job_items
ALTER TABLE job_items ADD COLUMN priority INTEGER DEFAULT 0;

-- Add column to symbol_versions
ALTER TABLE symbol_versions ADD COLUMN source_status TEXT DEFAULT 'ACTIVE';

-- New table explanation_queue
CREATE TABLE explanation_queue (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'PENDING',
    job_id TEXT,
    attempt_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,
    dedup_key TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES jobs(id)
);

CREATE INDEX idx_explanation_queue_status ON explanation_queue(status);
CREATE INDEX idx_explanation_queue_job_id ON explanation_queue(job_id);
CREATE INDEX idx_explanation_queue_snapshot_id ON explanation_queue(snapshot_id);
CREATE INDEX idx_explanation_queue_priority ON explanation_queue(priority);
