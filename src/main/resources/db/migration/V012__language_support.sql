-- V012: Persist the language selected for each single-language workspace and snapshot.
-- Java is the only shipped adapter in this phase, so existing data and newly-created
-- rows default to its canonical wire value. Later adapters can add supported values
-- without losing the historical language of an existing snapshot.
ALTER TABLE workspaces ADD COLUMN language TEXT NOT NULL DEFAULT 'java';
ALTER TABLE snapshots ADD COLUMN language TEXT NOT NULL DEFAULT 'java';
