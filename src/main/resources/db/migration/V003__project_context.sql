-- User-managed context lives in the application database, never in target repositories.
CREATE TABLE project_documents (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 title TEXT NOT NULL,
 content TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_documents_workspace ON project_documents(workspace_id);
ALTER TABLE explanations ADD COLUMN context_evidence TEXT;
ALTER TABLE explanations ADD COLUMN provider_base_url TEXT;
