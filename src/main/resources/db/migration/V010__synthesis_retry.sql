-- Bounded automatic retry for the architecture synthesis phase.
-- A transient provider fault previously failed the whole Explain all job and required a
-- human to press retry, even though validated checkpoints made resuming nearly free.
ALTER TABLE jobs ADD COLUMN synthesis_attempts INTEGER NOT NULL DEFAULT 0;
