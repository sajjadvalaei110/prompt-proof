# Step zero — Claude review handoff

Review the current working tree in `/home/sajjad/projects/review-assist`.
The acceptance criterion is that switching Changes on/off preserves the current
map arrangement while changing review styling and source inspection behavior.
Step one's edge/arrow/halo redesign is outside this review.

Read AGENTS.md, PROJECT_STATUS.md, docs/GIT_REVIEW.md, docs/ARCHITECTURE.md and
ADR 0006's layout-continuity addendum. BUILD_BRIEF.md is absent; docs/BUILD.md
is the historical brief, with package-only navigation documented by ADR 0007.

## Review scope

Current HEAD is `213571a`. Some initial step-zero work is already in that commit;
`git diff HEAD` alone does not show the entire implementation. Inspect the current
files, `git diff`, and untracked files reported by `git status --short`. The older
CODEX_REVIEW_PROMPT.md describes a different slice and is not this review's scope.
Preserve user changes; report findings before editing or committing.

- `frontend/src/features/review/reviewModel.ts`: unambiguous display-ID alignment
  with aligned ancestors; actual base/head identities still own source requests.
- `frontend/src/features/review/useReviewComparison.ts`: comparison projection and
  source identity maps.
- `frontend/src/features/explorer/explorerJourney.ts` and `explorerViewState.ts`:
  shared layout, reversible toggles, scoped parked resources, late child expansion,
  and atomic recapture reconciliation for open and closed tabs.
- `frontend/src/features/explorer/placementGeometry.ts` and `frontend/src/App.tsx`:
  shared geometry derivation, compound bounds, admission below surviving cards,
  and reserved space for hidden in-scope review cards.
- `frontend/src/features/explorer/GraphCanvas.tsx`: surviving canvas elements are
  reused and stale optional review data is explicitly removed on return to ordinary mode.

Check both toggle directions after drag/resize, scope edits, expansion, pan/zoom,
undo/redo and tab changes. Review ambiguity handling, snapshot-local source routing,
removed/unknown resources, recapture and hidden-card placement. Report concrete
reproductions with file/line references, distinguishing defects from known limits.

## Verification evidence

All 11 `scripts/test-*.mjs` scripts pass, including 63 view-state checks, 18 journey
checks and actual helper/reducer regressions in `test-review-placement.mjs`.
The production build passes TypeScript/Vite and bootJar. The packaged application
passes 33/33 Chromium checks with zero page errors, zero model requests and unchanged
fixture source/index hashes. All four screenshots were inspected.

See [evidence and reproduction commands](evidence/changes-toggle/README.md),
[the machine-readable report](evidence/changes-toggle/report.json), and
[exact outcomes and skipped checks](../PROJECT_STATUS.md).
The final runtime output is `build/git-review/run-1acmt2pw`, with log
`build/git-review/step0-final-placement.log`.

## Known limits

Review-only children can enlarge their container bounds; surviving leaf positions
and user dimensions remain preserved. Ambiguous declarations are kept distinct
rather than assigned an unsafe identity. Aggregate relationship inspection clears
across modes because aggregate route identities differ. No live model integration
is claimed. Legacy browser suites that target the removed level switcher were not
run; the review harness was updated for package-only navigation.

Claude returned three findings on 2026-09-23: asymmetric geometry retention,
ordinary relationship inspection cleared by recapture, and plain symbol source
remaining open on entry to Changes. Corrections are being implemented and verified.
