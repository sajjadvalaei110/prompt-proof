-- Architecture drafts are generated prose, never canonical symbol facts or READY coverage.
CREATE TABLE explanation_syntheses (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    status TEXT NOT NULL CHECK (status IN ('READY', 'STALE')),
    schema_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model_id TEXT,
    provider_base_url TEXT,
    input_fingerprint TEXT NOT NULL,
    context_evidence TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_synthesis_snapshot ON explanation_syntheses(snapshot_id, status);
CREATE TABLE class_pre_explanations (
    symbol_id TEXT PRIMARY KEY REFERENCES symbol_versions(id),
    synthesis_id TEXT NOT NULL REFERENCES explanation_syntheses(id),
    business_logic TEXT NOT NULL
);
ALTER TABLE explanations ADD COLUMN context_dependencies TEXT NOT NULL DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN synthesis_status TEXT;
ALTER TABLE explanation_queue ADD COLUMN relation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE explanation_queue ADD COLUMN loc INTEGER NOT NULL DEFAULT 2147483647;
CREATE INDEX idx_queue_bottom_up ON explanation_queue(status, priority DESC, relation_count, loc, subject_id);

-- Upgrade unfinished legacy bulk work without losing successful explanations or explicit clicks.
UPDATE explanation_queue SET status = 'SKIPPED'
WHERE job_id IS NOT NULL AND priority = 0 AND status IN ('PENDING', 'IN_PROGRESS')
AND (subject_type != 'symbol' OR subject_id NOT IN
    (SELECT id FROM symbol_versions WHERE kind IN ('CLASS', 'METHOD')));
UPDATE jobs SET synthesis_status = 'PENDING' WHERE operation = 'EXPLAIN_ALL' AND status = 'RUNNING';
UPDATE explanation_queue SET relation_count =
    (SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id = explanation_queue.snapshot_id AND r.source_symbol_id = explanation_queue.subject_id) +
    (SELECT COUNT(*) FROM relationship_occurrences r WHERE r.snapshot_id = explanation_queue.snapshot_id AND r.target_symbol_id = explanation_queue.subject_id),
    loc = COALESCE((SELECT MAX(e.end_line - e.start_line + 1) FROM symbol_evidence se JOIN evidence e ON e.id = se.evidence_id
                   WHERE se.symbol_version_id = explanation_queue.subject_id), 2147483647)
WHERE subject_type = 'symbol';
