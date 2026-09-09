-- Successful model stages survive cancellation/restart without publishing partial class coverage.
CREATE TABLE architecture_checkpoints (
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    stage_key TEXT NOT NULL,
    stage_kind TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model_id TEXT,
    provider_base_url TEXT,
    input_context TEXT NOT NULL,
    output_json TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(snapshot_id, stage_key)
);
ALTER TABLE jobs ADD COLUMN synthesis_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN synthesis_stage TEXT;
