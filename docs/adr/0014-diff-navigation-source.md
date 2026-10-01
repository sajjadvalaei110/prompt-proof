# ADR 0014: Go to definition inside the Changes diff — where its answers come from

- Status: Accepted
- Date: 2026-10-01
- Scope: `graph` (`NavigationService`), `api` (`/files/occurrences`, `/files/definition`),
  `frontend/src/features/source/` (`diffNavigation.ts`, `SourceDialog.tsx`, `navigationStack.ts`, `codeTokens.ts`)

## Context

ADR 0013 shipped Ctrl/Cmd+click go to definition in the read-only source viewer. In the Changes diff it was switched
off ("not available in the Changes diff yet"). The owner asked for it there too, especially for added files and
added lines: one location jumps, several open a `path:line` picker, `external` says "outside workspace", and the
`not_indexed` hint stays. Find in file must keep working.

The obstacle is where the data lives:

- Review captures (ADR 0006) are analyzed by the language's default, source-only engine and never by a build engine
  (ADR 0012 §2, `AGENTS.md`). So both sides of a comparison are `not_indexed`, even when the workspace itself uses
  scip-java.
- Changing that would mean running the target build on review captures. That needs an ADR and an `AGENTS.md`
  amendment, and the owner did not want it.

The owner settled decisions D1–D3 before implementation. Two further questions were settled in a grilling round
(Q4, Q5).

## Decision

### 1. The head side is served from the workspace's active snapshot, file by file (D1, Q4, Q5)

- The existing `GET /api/snapshots/{id}/files/occurrences` and `/files/definition` are called with the review's
  after-change (`REVIEW_HEAD`) snapshot id. No new route was added.
- `NavigationService` reads the snapshot's `purpose`. For a review head, the workspace's active snapshot (the one
  active at request time, published) answers, but only for a file whose
  `source_file_versions.content_hash` is identical in both snapshots at the same relative path. Every line and
  column then means the same thing in both.
  - **Paths:** both snapshots key paths relative to the workspace (ADR 0015 makes this hold for module
    workspaces too), so the path check is an identity rather than a mapping.
  - **Hashes:** they are comparable because every engine and every capture hashes the stored text the same way:
    SHA-256 of its UTF-8 encoding. `RepositoryRootIntegrationTest` and `ReviewDiffNavigationTest` prove both facts.
- When the hashes differ, or the active snapshot lacks the file, the status is a new `stale`. The viewer says "This
  file changed since the last analysis; re-analyze to navigate it". A path the head does not hold is `no_file`.
- When the workspace has no active snapshot, or the active snapshot's engine provides no navigation, the answer is
  `not_indexed`. Its capability fields describe the active snapshot's engine, so ADR 0013's hint names the engine that
  would have to provide navigation.
- Every response carries `servedFrom: {snapshotId, label}`. For a head it is the active snapshot, labelled
  "Current analysis · <engine label>"; for any other snapshot it is the snapshot itself. It is `null` when nothing
  answered. The viewer shows "Navigation from <label>" when the answering snapshot is not the one asked.
- Ordinary and base (`REVIEW_BASE`) snapshots answer for themselves exactly as before. A base is the default engine's
  snapshot, so it stays `not_indexed`.
- Review captures still never run a build, and `AGENTS.md` is unchanged.

### 2. Rows navigate through their head line (D2)

The new pure module `diffNavigation.ts` maps rows to head lines:

| Row or cell | Behaviour |
|---|---|
| Added and context rows (unified) | Navigate through their head line number (`newNo`), whichever side the dialog is pinned to. |
| Split: right cells, and left cells of context rows | Navigate through the head line as well, since a context row is the same line on both sides. |
| Deleted rows and split's left-only cells | Not navigable. They carry `data-nav-blocked`, and Ctrl/Cmd+click says "Deleted lines aren't navigable". |
| Blank (padded) split cells | Have no line. |

- An added file's rows have no `oldNo`, and that is fine.
- Occurrence rows are clamped to the head file's line lengths, recovered from the diff rows, which hold every head
  line once. They are tokenized with the unchanged `codeTokens.ts`. Spans hold text only; source is never rendered
  as HTML.
- Find in file keeps its keys and works on every row.

### 3. Jump targets stay in the change (D3)

- Each definition location gains `snapshotId` (where to open it) and `differsFromChange`.
- For a head request, `snapshotId` is the head itself when the head's copy of the target file has the answering
  text's hash. Line numbers then match: the file opens from the after-change snapshot, as its diff when the file
  changed in the review (with a usable diff), otherwise as plain source.
- Otherwise the location opens in the active snapshot as plain source, with the chip "Current analysis — differs
  from this change".
- The picker marks such locations "· current analysis".
- `navigationStack.ts` views carry an optional `snapshot`, `mode` (`plain` / `diff`) and `chip`, so back/forward
  covers all of these views. The dialog's caches are keyed by (snapshot, path).

## Consequences

- **What navigates now.** A scip-java workspace (or any future engine declaring `providesNavigation()`) gets go to
  definition in the Changes diff, on added files and added lines included. As a side effect it also works on plain
  after-change files opened in Changes mode, which were `not_indexed` before.
- **Re-analysis.** Navigation in the diff needs the workspace to have been analyzed after the change: a file edited
  since then is `stale` until Re-analyze source. This is honest rather than a guess, and it costs no build on review
  captures.
- **Language-neutral.** `ReviewDiffNavigationTest` uses a fake non-Java `fixture` language with a source-only default
  engine and a navigating one, through the real `AnalysisService.runReviewAnalysis`. `scripts/test-diff-navigation.mjs`
  uses Go-shaped text. No Java names, extensions or symbol grammars were added to `NavigationService`, the DTOs or the
  viewer.
- **Known limits:**
  - deleted lines have no navigation; the base side has no navigation data;
  - the chip path is covered by the backend and pure tests, but not by the browser pipeline, whose fixture has no
    definition inside a file edited after analysis;
  - the split layout drops leading indentation, which predates this ADR;
  - touch devices still need a modifier key (ADR 0013).

## Alternatives considered

- **Index review captures with the build engine.** Rejected: it would run the target build on captures, which needs an
  invariant change the owner did not want.
- **Serve the head from the active snapshot without a hash check.** Rejected: positions would silently point at the
  wrong text once a file changed.
- **New review-scoped navigation routes.** Rejected (Q4): the existing endpoints already take a snapshot id. Routing
  by the snapshot's `purpose` keeps one contract.
- **Pin the review to the snapshot that was active at capture time** (a new column). Rejected (Q5): the per-file hash
  check already guarantees the answer matches. A later re-analysis only makes more files navigable.
