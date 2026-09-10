-- Explicit snapshot deletion discards snapshot-bound generated/checkpoint/job data.
-- Workspace-scoped notes and bookmarks are intentionally untouched.
CREATE TRIGGER cleanup_snapshot_explanation_data
BEFORE DELETE ON snapshots
BEGIN
    DELETE FROM class_pre_explanations
      WHERE synthesis_id IN (SELECT id FROM explanation_syntheses WHERE snapshot_id=OLD.id);
    DELETE FROM explanation_syntheses WHERE snapshot_id=OLD.id;
    DELETE FROM architecture_class_purposes WHERE snapshot_id=OLD.id;
    DELETE FROM architecture_checkpoints WHERE snapshot_id=OLD.id;
    DELETE FROM explanation_queue WHERE snapshot_id=OLD.id;
    DELETE FROM job_items WHERE job_id IN (SELECT id FROM jobs WHERE snapshot_id=OLD.id);
    DELETE FROM jobs WHERE snapshot_id=OLD.id;
    DELETE FROM explanations WHERE snapshot_id=OLD.id;
END;
