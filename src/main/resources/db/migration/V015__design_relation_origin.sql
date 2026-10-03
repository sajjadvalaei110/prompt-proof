-- V015 (ADR 0016): where a design relation came from.
--   AUTHORED  drawn by the engineer or an agent: a relation they want the code to have
--   CODE      a parsed dependency carried along: an explanation on a relation the code has, or an
--             imported reference to a dependency of code this workspace lacks (a design-only project)
-- A CODE relation is never work to do; only its explanation is (a requested behaviour change).
ALTER TABLE design_relations ADD COLUMN origin TEXT NOT NULL DEFAULT 'AUTHORED' CHECK (origin IN ('AUTHORED', 'CODE'));

-- Spring roles of an imported reference to code (origin CODE) the workspace lacks, as a JSON array, so
-- it is drawn like the original card (ADR 0016). Null for authored resources and for parsed code,
-- whose roles come from analysis.
ALTER TABLE design_resources ADD COLUMN roles TEXT;
