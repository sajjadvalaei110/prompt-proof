-- V007 established generated-work cleanup. Replace it with the complete dependency
-- order so an explicit snapshot deletion is valid with foreign keys enabled.
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
