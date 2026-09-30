-- V013 (ADR 0012): a language may ship several indexing engines. Every workspace and snapshot
-- records the engine it chose/used. NULL means "the language's default engine": the column has
-- no language-specific default, so a row of any language is valid. Existing rows are all Java
-- and were produced by the source-only JavaParser engine.
ALTER TABLE workspaces ADD COLUMN indexer TEXT;
ALTER TABLE snapshots ADD COLUMN indexer TEXT;
UPDATE workspaces SET indexer = 'javaparser' WHERE language = 'java';
UPDATE snapshots SET indexer = 'javaparser' WHERE language = 'java';

-- Occurrence index: every name the engine resolved in an indexed file, definitions and
-- references alike, including locals, parameters and fields that are never graph symbols.
-- It is navigation data only (go to definition / find references); graph topology stays in
-- symbol_versions and relationship_occurrences. Coordinates use the evidence convention:
-- 1-based lines, 1-based start column, inclusive end column.
--   symbol            engine-scoped key; file-local symbols are prefixed with their file id
--   is_definition     1 for the declaring occurrence
--   symbol_version_id the graph symbol this occurrence names, when that symbol is in the graph
--   display_name      the declared name (definitions only)
--   signature         the declaration signature as the engine prints it (definitions only)
CREATE TABLE code_occurrences (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
    source_file_version_id TEXT NOT NULL REFERENCES source_file_versions(id),
    start_line INTEGER NOT NULL,
    start_column INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    end_column INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    is_definition INTEGER NOT NULL DEFAULT 0,
    symbol_version_id TEXT REFERENCES symbol_versions(id),
    display_name TEXT,
    signature TEXT
);
CREATE INDEX idx_code_occurrences_file_line ON code_occurrences(source_file_version_id, start_line);
CREATE INDEX idx_code_occurrences_symbol ON code_occurrences(snapshot_id, symbol, is_definition);

-- Snapshot deletion must also remove occurrences before the file versions and symbols they
-- reference (foreign keys are enforced). Same body as V009 plus that one statement.
DROP TRIGGER cleanup_snapshot_explanation_data;

CREATE TRIGGER cleanup_snapshot_explanation_data
BEFORE DELETE ON snapshots
BEGIN
    UPDATE workspaces SET active_snapshot_id=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE active_snapshot_id=OLD.id;

    DELETE FROM class_pre_explanations
      WHERE synthesis_id IN (SELECT id FROM explanation_syntheses WHERE snapshot_id=OLD.id);
    DELETE FROM explanation_syntheses WHERE snapshot_id=OLD.id;
    DELETE FROM architecture_class_purposes WHERE snapshot_id=OLD.id;
    DELETE FROM architecture_checkpoints WHERE snapshot_id=OLD.id;
    DELETE FROM explanation_queue WHERE snapshot_id=OLD.id;
    DELETE FROM job_items WHERE job_id IN (SELECT id FROM jobs WHERE snapshot_id=OLD.id);
    DELETE FROM jobs WHERE snapshot_id=OLD.id;
    DELETE FROM explanations WHERE snapshot_id=OLD.id;

    DELETE FROM code_occurrences WHERE snapshot_id=OLD.id;
    DELETE FROM relationship_evidence
      WHERE relationship_id IN (SELECT id FROM relationship_occurrences WHERE snapshot_id=OLD.id);
    DELETE FROM symbol_evidence
      WHERE symbol_version_id IN (SELECT id FROM symbol_versions WHERE snapshot_id=OLD.id);
    DELETE FROM http_routes WHERE snapshot_id=OLD.id;
    DELETE FROM injection_points WHERE snapshot_id=OLD.id;
    DELETE FROM relationship_occurrences WHERE snapshot_id=OLD.id;
    DELETE FROM evidence
      WHERE source_file_version_id IN (SELECT id FROM source_file_versions WHERE snapshot_id=OLD.id);
    DELETE FROM source_file_versions WHERE snapshot_id=OLD.id;
    DELETE FROM symbol_versions WHERE snapshot_id=OLD.id;
END;
