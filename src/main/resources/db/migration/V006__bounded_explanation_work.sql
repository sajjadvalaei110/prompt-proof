-- Bounded architecture preparation and ordered Explain All claims.
ALTER TABLE architecture_checkpoints ADD COLUMN run_fingerprint TEXT;
ALTER TABLE architecture_checkpoints ADD COLUMN reduction_level INTEGER;
ALTER TABLE architecture_checkpoints ADD COLUMN stage_sequence INTEGER;
ALTER TABLE architecture_checkpoints ADD COLUMN range_start TEXT;
ALTER TABLE architecture_checkpoints ADD COLUMN range_end TEXT;

CREATE INDEX idx_architecture_checkpoint_plan
    ON architecture_checkpoints(snapshot_id, run_fingerprint, stage_kind, reduction_level, stage_sequence);

-- Validated batch output is durable but invisible as a DRAFT until the final synthesis transaction.
CREATE TABLE architecture_class_purposes (
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    run_fingerprint TEXT NOT NULL,
    symbol_id TEXT NOT NULL REFERENCES symbol_versions(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    business_logic TEXT NOT NULL,
    validated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(snapshot_id, run_fingerprint, symbol_id)
);
CREATE INDEX idx_architecture_purpose_page
    ON architecture_class_purposes(snapshot_id, run_fingerprint, symbol_id);

CREATE INDEX idx_queue_claim
    ON explanation_queue(status, priority DESC, relation_count, loc, subject_id, id);
CREATE INDEX idx_queue_job_status ON explanation_queue(job_id, status);
CREATE INDEX idx_relationship_snapshot_source ON relationship_occurrences(snapshot_id, source_symbol_id, id);
CREATE INDEX idx_relationship_snapshot_target ON relationship_occurrences(snapshot_id, target_symbol_id, id);
CREATE INDEX idx_symbol_evidence_symbol ON symbol_evidence(symbol_version_id, evidence_id);
CREATE INDEX idx_documents_workspace_id ON project_documents(workspace_id, id);
CREATE INDEX idx_jobs_explain_status ON jobs(operation, status, synthesis_status, created_at, id);
