-- V001: Initial schema for Code Atlas
-- SQLite with foreign key enforcement (enabled per-connection in DataSourceConfig)

-- Workspaces
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    canonical_root TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    include_patterns TEXT, -- JSON array
    exclude_patterns TEXT, -- JSON array
    trust_state TEXT NOT NULL DEFAULT 'source_only',
    active_snapshot_id TEXT,
    model_profile_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Analysis snapshots
CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    status TEXT NOT NULL DEFAULT 'staging', -- staging, published, failed
    parser_version TEXT NOT NULL DEFAULT '1',
    rule_version TEXT NOT NULL DEFAULT '1',
    roots_fingerprint TEXT,
    classpath_fingerprint TEXT,
    diagnostics TEXT, -- JSON
    file_count INTEGER DEFAULT 0,
    symbol_count INTEGER DEFAULT 0,
    relationship_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_snapshots_workspace ON snapshots(workspace_id);

-- Logical symbols (workspace-scoped, survives across snapshots)
CREATE TABLE logical_symbols (
    key TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    PRIMARY KEY (workspace_id, key)
);

-- Symbol versions (snapshot-scoped instances of logical symbols)
CREATE TABLE symbol_versions (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    logical_symbol_key TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL, -- CLASS, INTERFACE, ENUM, RECORD, ANNOTATION, METHOD, CONSTRUCTOR, FIELD
    qualified_name TEXT NOT NULL,
    simple_name TEXT NOT NULL,
    signature TEXT,
    parent_symbol_id TEXT,
    module TEXT,
    modifiers TEXT, -- JSON array
    roles TEXT, -- JSON array (Spring stereotypes)
    annotations TEXT, -- JSON array
    type_parameters TEXT, -- JSON
    return_type TEXT,
    parameters TEXT, -- JSON array [{name, type, annotations}]
    thrown_types TEXT, -- JSON array
    doc_comment TEXT,
    content_hash TEXT NOT NULL,
    FOREIGN KEY (workspace_id, logical_symbol_key) REFERENCES logical_symbols(workspace_id, key),
    UNIQUE(snapshot_id, logical_symbol_key)
);
CREATE INDEX idx_sv_snapshot ON symbol_versions(snapshot_id);
CREATE INDEX idx_sv_qualified ON symbol_versions(snapshot_id, qualified_name);
CREATE INDEX idx_sv_kind ON symbol_versions(snapshot_id, kind);
CREATE INDEX idx_sv_parent ON symbol_versions(parent_symbol_id);
CREATE INDEX idx_sv_simple ON symbol_versions(snapshot_id, simple_name);

-- Source file versions (retained source for evidence display)
CREATE TABLE source_file_versions (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    relative_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'UTF-8',
    source_content TEXT NOT NULL,
    UNIQUE(snapshot_id, relative_path)
);
CREATE INDEX idx_sfv_snapshot ON source_file_versions(snapshot_id);

-- Evidence (exact source range within a file version)
CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    source_file_version_id TEXT NOT NULL REFERENCES source_file_versions(id),
    start_line INTEGER NOT NULL,
    start_column INTEGER DEFAULT 0,
    end_line INTEGER NOT NULL,
    end_column INTEGER DEFAULT 0,
    snippet TEXT
);
CREATE INDEX idx_evidence_file ON evidence(source_file_version_id);

-- Relationship occurrences (snapshot-scoped edges)
CREATE TABLE relationship_occurrences (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    source_symbol_id TEXT NOT NULL REFERENCES symbol_versions(id),
    target_symbol_id TEXT REFERENCES symbol_versions(id),
    unresolved_target TEXT, -- text when target cannot be resolved
    kind TEXT NOT NULL, -- EXTENDS, IMPLEMENTS, CALLS, CONSTRUCTS, etc.
    resolution TEXT NOT NULL DEFAULT 'CANDIDATE', -- RESOLVED, CANDIDATE, UNRESOLVED
    reason TEXT, -- why candidate/unresolved
    dispatch_notes TEXT,
    condition_notes TEXT
);
CREATE INDEX idx_ro_snapshot ON relationship_occurrences(snapshot_id);
CREATE INDEX idx_ro_source ON relationship_occurrences(source_symbol_id);
CREATE INDEX idx_ro_target ON relationship_occurrences(target_symbol_id);
CREATE INDEX idx_ro_kind ON relationship_occurrences(snapshot_id, kind);

-- Relationship evidence (many-to-many)
CREATE TABLE relationship_evidence (
    relationship_id TEXT NOT NULL REFERENCES relationship_occurrences(id),
    evidence_id TEXT NOT NULL REFERENCES evidence(id),
    PRIMARY KEY (relationship_id, evidence_id)
);

-- Symbol evidence (many-to-many)
CREATE TABLE symbol_evidence (
    symbol_version_id TEXT NOT NULL REFERENCES symbol_versions(id),
    evidence_id TEXT NOT NULL REFERENCES evidence(id),
    PRIMARY KEY (symbol_version_id, evidence_id)
);

-- Explanations (AI-generated, linked to subject versions)
CREATE TABLE explanations (
    id TEXT PRIMARY KEY,
    subject_version_id TEXT NOT NULL,
    subject_type TEXT NOT NULL, -- 'symbol' or 'relationship'
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    schema_version TEXT NOT NULL DEFAULT '1',
    short_label TEXT,
    hover_summary TEXT,
    claims TEXT, -- JSON array [{text, basis, evidenceIds}]
    inputs TEXT, -- JSON array
    outputs TEXT, -- JSON array
    side_effects TEXT, -- JSON array
    failure_behavior TEXT, -- JSON array
    unknowns TEXT, -- JSON array
    suggested_next_ids TEXT, -- JSON array
    model_id TEXT,
    model_revision TEXT,
    prompt_version TEXT,
    input_fingerprint TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    generated_at TEXT
);
CREATE INDEX idx_expl_subject ON explanations(subject_version_id, subject_type);
CREATE INDEX idx_expl_snapshot ON explanations(snapshot_id);
CREATE INDEX idx_expl_status ON explanations(snapshot_id, status);

-- Jobs
CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    snapshot_id TEXT REFERENCES snapshots(id),
    operation TEXT NOT NULL, -- 'analysis', 'explain_all', 'explain_single'
    status TEXT NOT NULL DEFAULT 'PENDING',
    total_items INTEGER DEFAULT 0,
    completed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    skipped_items INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_jobs_workspace ON jobs(workspace_id);
CREATE INDEX idx_jobs_status ON jobs(status);

-- Job items (per-subject work records)
CREATE TABLE job_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    subject_id TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER DEFAULT 0,
    dedup_key TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_ji_job ON job_items(job_id);
CREATE INDEX idx_ji_dedup ON job_items(dedup_key);

-- User notes
CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    logical_subject_key TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    content TEXT NOT NULL,
    orphan_state TEXT, -- NULL, 'orphaned', 'relinked'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_notes_subject ON notes(workspace_id, logical_subject_key);

-- Bookmarks
CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    logical_subject_key TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_bm_workspace ON bookmarks(workspace_id);

-- Model profiles
CREATE TABLE model_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model_id TEXT NOT NULL,
    api_key_ref TEXT, -- encrypted reference, never plaintext in logs/responses
    context_budget INTEGER DEFAULT 8192,
    output_budget INTEGER DEFAULT 2048,
    timeout_seconds INTEGER DEFAULT 120,
    concurrency INTEGER DEFAULT 1,
    model_revision TEXT,
    explanation_language TEXT DEFAULT 'en',
    capabilities TEXT, -- JSON: {streaming, structuredOutput, etc.}
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
