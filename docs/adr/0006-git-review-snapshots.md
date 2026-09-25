# ADR 0006: Source-only Git review snapshots

- Status: Accepted
- Date: 2026-09-17
- Scope: R6 Git review view

## Decision

Compare a pinned local Git base with a captured working tree, and expose three
views: base, base plus changes, and after changes. The overlay is a presentation
of two independently parsed snapshots. Comparison output cannot create canonical
parser relationships or change their resolution status.

Use the installed Git executable through an isolated revision adapter, without a
shell or another Git library. Read raw tree/blob data; never check out, reset,
fetch, pull, evaluate builds, run filters, or execute target application code.
An empty base selection uses the common ancestor of HEAD and the locally available
upstream, falling back to HEAD with a visible diagnostic. Explicit local revision
expressions are resolved to a commit before capture. No remote update is implied.
The after side includes tracked staged and unstaged changes and nonignored
untracked files. It describes captured file content, rather than a mutable branch
name or a promise that later disk edits are included.

Do not run a working-tree diff inside the target repository: Git can execute its
clean filters even when external diff and text conversion are disabled. Instead,
compare raw blobs and filesystem bytes, then use `git diff --no-index` on private
temporary files. Git process environments discard inherited Git redirections and
disable hooks, fsmonitor, lazy fetching and transports. Raw-byte fingerprints before
and after capture detect concurrent edits independently of index flags and diff
attributes. Private diff files are removed after use.

Analysis uses temporary private copies outside the target repository, retains
snapshot source for evidence, and shares the existing serialized parser boundary.
Review snapshots do not replace the workspace's ordinary active snapshot and do
not invalidate successful explanations for that snapshot.

Compare declarations and relationship occurrences independently. A behavior change
may modify a method without changing a relationship. Parent line totals must count
physical changed lines once, even when they belong to nested declarations.
Relationship matching must preserve multiplicity and resolution, and must not
classify line-number movement alone as a topology change. Renames and ambiguous
identities are not assumed equivalent. Analysis diagnostics remain visible.

The versioned review DTO retains each side's actual symbol and relationship IDs.
The frontend remaps IDs only for display and routes source requests to the correct
snapshot. Added and removed occurrences remain separate when they share the same
displayed endpoint pair. Base and after views use ordinary graph colors; the
overlay colors added resources green, removed resources red, modified resources yellow,
and adds line counts plus matching relationship styling.
Text and line patterns accompany color.

## Consequences

Git must be installed and the selected directory must be a supported local Git
workspace. Comparison has explicit resource limits and may reject oversized
captures. Source-only Java analysis retains its existing coverage limitations;
unsupported files and partial analysis must remain visible. Static graph changes
do not prove runtime impact or correctness.

This slice does not introduce pull request hosting, generated review verdicts,
review decision persistence, or automatic model calls. Review presentation is a
page-session workflow. Retained source snapshots and comparison identity provide
the foundation for a later persistent review workflow.

## Addendum: overlay integrated into the Code map (per-tab mode)

The original slice presented base/overlay/after as three radio views inside a
separate "Review changes" page, each embedding its own `ExplorerApp` instance. A
follow-up replaced that page: the overlay now draws directly on the ordinary Code
map, toggled by a **Changes** control in the graph toolbar, with the base/after-only
views dropped (the overlay is a superset for review purposes -- it already carries
after-change resources plus removed base-only resources). The separate report
(summary, changed-file list, resource/relationship columns, diagnostics list) and
the change-color legend were removed at the same time; the only remaining review-
specific UI is the toggle, a small popover for the base ref and Recompare, and the
overlay styling already on the map.

Review mode is **per exploration tab**, not global: each `Journey` carries
`review`, `reviewKey` and a `stash` of the other mode's parked layout/scope/
selection, so switching modes in one tab never disturbs another tab exploring the
ordinary snapshot. `+ New tab` opens in the requesting tab's current mode; `Clone
tab` copies it verbatim, including undo/redo history. A `REVIEW_RECAPTURED` action
resets every tab (open or closed) that ever touched review state after a
Recompare, since display IDs are derived from the comparison's snapshot pair and
have no meaning once it is superseded.

The map-heading (breadcrumbs, title, scope banner) can be collapsed to a single
toolbar row -- a per-viewer preference (`localStorage`), not exploration state --
so the overlay does not cost graph screen space.

Changed-file code now opens as a real diff (unified or split) built from the
comparison's existing `git diff --unified=0` hunks (now included per file in the
API response) plus both snapshots' whole-file content, rather than plain
highlighted source. This applies whenever the symbol's file changed, not only when
the symbol's own declaration did, and covers relationship evidence the same way.

A later review showed that the relationship identity used for matching included the
concatenated evidence text. Class-level `DEPENDS_ON` and member `USES_TYPE` occurrences
aggregate every use site as evidence, so editing one call argument split an unchanged
dependency into a false REMOVED/ADDED pair. Matching is now two-phase within a structural
key (source, target, kind, resolution): identical-evidence occurrences pair first, then any
leftovers pair one-to-one; only a genuine surplus is REMOVED/ADDED. Multiplicity and
resolution changes remain visible, and line movement alone is still not a topology change.
Ambiguous declarations are still never paired across captures by guess.

The non-Java changed-file list and comparison diagnostics that the removed report
surfaced are not presented elsewhere; they were not load-bearing for the parser
facts, but this is a deliberate reduction in visible partial-analysis signal,
noted here per the project's transparency invariant rather than silently dropped.

## Addendum: unknown change status, and one route per ordered pair

Two review facts were being drawn as confident claims they are not.

A Java file that parses in one capture and not in the other is stored (its
`source_file_versions` row is written before parsing) but contributes no
declarations there. Its declarations and relationships were therefore missing on
that side and classified REMOVED (or ADDED) -- reported as a deletion when the
truth is that the file could not be read. `ReviewService.compare` now derives the
unanalyzed paths of each side structurally (a stored file with no indexed
declaration, never by matching diagnostic text, whose format differs per producer)
and emits a fourth status, `UNKNOWN`, for a declaration missing only there and for
any unmatched occurrence touching such a declaration. `UNKNOWN` is additive within
schema version `1`: existing values keep their meaning, and a consumer that does
not know it sees an unrecognized status rather than a wrong one. The overlay draws
an unknown route in the amber of an unresolved route but dotted, and the card
carries a dashed "NOT ANALYZED" badge, so the resource stays on the map with its
uncertainty visible instead of vanishing or posing as deleted.

Merging every status between a pair of cards into one route was tried and
reverted at the user's direction: separated lines are the wanted behavior, since a
removed relationship must stay visible beside the unchanged one rather than being
folded into it. `reviewChange` therefore remains in the drawn route's aggregate
key, and added, removed, unknown and unchanged routes between the same two cards
are separate lines; occurrences sharing a status still merge as usual.

Consequently nothing in review mode is red unless it was removed: incoming-route
emphasis and its glow are indigo, and a route's change color owns its own glow.
An open question stays with the separated lines: what a selected card's routes
should look like when several statuses run between the same pair. That is being
taken up separately.

ADR 0008 resolves the selection-color question: selection no longer recolors
routes; direction uses chevrons and resource halos in both map modes.

## Addendum: layout continuity across Changes mode (2026-09-22)

The separate `stash.map` / `stash.review` layouts described above are superseded.
They restarted the map on first activation and restored an older arrangement on
later toggles. Each tab now owns one current exploration state across both modes:
scope, card positions, expansions, sizes, camera and resource selection.

Comparison declarations reuse ordinary display IDs only when kind, qualified name
and module match uniquely in both inventories and their parents also align.
Ambiguous declarations and ancestors retain comparison display IDs. This is a
presentation mapping, not a claim of canonical identity across snapshots. Source
and explanation requests still use each fact's actual retained-snapshot identity.

Review-only resources remain real parser facts from the comparison: they appear
in Changes mode without resetting surviving cards. Expanded container bounds can
grow to include removed children. Turning Changes off hides these resources while
retaining the current arrangement of shared cards. The canvas explicitly removes
review data when switching shared elements back to ordinary styling.

A toggle remains one undoable action. Recompare invalidates history that refers to
the superseded capture and reconciles review state for open and closed tabs.
No model call, backend schema change, or target-repository execution is introduced.

### Amendment (2026-09-25): source roots follow the workspace layout

A capture is analyzed from `capture-*/base` and `capture-*/head`, but the symbol solver's source
roots were found by matching absolute paths against `src/main/java` / `src/test/java`. For a
repository whose root is itself a `src` directory, the ordinary analysis matched `main/java`
through the root's own name and the captures did not, so the solver saw no in-source types in
review and facts that need it (for example `DeveloperWorkflowTest -> ExplanationResponse`,
a DEPENDS_ON inferred from a call chain) vanished in Changes mode. `runReviewAnalysis` now takes
the workspace root, and `JavaParserAdapter.setupSymbolSolver(capturedRoot, workspaceRoot)` matches
each capture directory as if it were laid out under the workspace root, so both sides find the
same source roots as the ordinary analysis. Ordinary analysis is unchanged.
