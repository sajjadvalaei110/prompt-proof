-- Review captures are immutable parser snapshots but must never become a workspace's active analysis.
ALTER TABLE snapshots ADD COLUMN purpose TEXT NOT NULL DEFAULT 'ANALYSIS';
ALTER TABLE snapshots ADD COLUMN review_identity TEXT;
CREATE INDEX idx_snapshots_workspace_purpose ON snapshots(workspace_id, purpose, created_at);
