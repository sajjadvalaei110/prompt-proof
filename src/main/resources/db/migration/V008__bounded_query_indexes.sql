-- Stable keyset scans and bounded context/queue lookups introduced by pipeline 3.0.
CREATE INDEX idx_symbol_snapshot_kind_id
    ON symbol_versions(snapshot_id, kind, id);
CREATE INDEX idx_relationship_snapshot_id
    ON relationship_occurrences(snapshot_id, id);
CREATE INDEX idx_explanation_dependency_page
    ON explanations(snapshot_id, status, id);
CREATE INDEX idx_synthesis_fingerprint
    ON explanation_syntheses(snapshot_id, input_fingerprint, status);
CREATE INDEX idx_queue_workspace_status
    ON explanation_queue(workspace_id, status);
CREATE INDEX idx_jobs_workspace_explain_status
    ON jobs(workspace_id, operation, status, created_at, id);
