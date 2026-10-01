-- V014 (ADR 0014): the engineer-owned design layer. Workspace-scoped and keyed by the parser's
-- stable logical key (qualified name; methods `Owner.name(ParamType,...)`), never by snapshot IDs,
-- so it survives re-analysis. It is not parser fact: analysis never writes it, snapshot deletion
-- never touches it, and model explanations never write it.
--   origin AUTHORED  a package/type/method the engineer or an agent added to the map
--   origin CODE      an explanation attached to (or an imported placeholder for) a parsed resource
-- Status (planned / implemented / present / missing / orphaned) is computed against a snapshot on
-- every read, never stored.
CREATE TABLE design_resources (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    resource_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    simple_name TEXT NOT NULL,
    parent_key TEXT,
    parameter_types TEXT, -- JSON array, methods and constructors only
    signature TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('AUTHORED', 'CODE')),
    explanation TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, resource_key)
);
CREATE INDEX idx_design_resources_parent ON design_resources(workspace_id, parent_key);

-- A relation between any two keys (parsed or authored, any level). Its resolution is DESIGNED:
-- there is no parser evidence; the explanation is its provenance. One row per (source, target, kind).
CREATE TABLE design_relations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    source_key TEXT NOT NULL,
    target_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (workspace_id, source_key, target_key, kind)
);
CREATE INDEX idx_design_relations_target ON design_relations(workspace_id, target_key);
