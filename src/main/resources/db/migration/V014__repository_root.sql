-- V014 (ADR 0015): an optional repository root per workspace. The workspace path may be a module or a
-- subdirectory; the root names the directory that holds the Git repository and bounds the build-root search
-- of a build-running engine. NULL means "auto-detect" (Git's own top level, and the engine's own boundary).
-- Snapshots record the root that was configured when they were produced, as provenance. No language-specific
-- default and no backfill: every existing row keeps auto-detection, which is today's behavior.
ALTER TABLE workspaces ADD COLUMN repository_root TEXT;
ALTER TABLE snapshots ADD COLUMN repository_root TEXT;
