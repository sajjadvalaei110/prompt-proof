# ADR 0007: Package-only exploration view; drill-in via expand-in-place only

## Context

The explorer had two overlapping ways to see classes and methods:

1. A **level switcher** ("Packages / Classes / Methods" segmented control in the
   graph toolbar, `App.tsx`'s `NAVIGATE_LEVEL` dispatch) that re-pointed the
   whole map at a different abstraction level. Reachable from the segmented
   control itself, the navigation tree's `⌖` "View classes"/"View methods"
   buttons, the inspector's "View classes ↗"/"View methods ↗" buttons, and
   clicking an HTTP entry-point route card.
2. **Expand-in-place** (`⊞`/`⊟` on a package or class card, see "In-place card
   details and resizable cards" in `PROJECT_STATUS.md`), which expands a card
   into a box showing its children inline without changing the map's level.

Both existed at once, so the same underlying navigation ("see this package's
classes") could be done two different, inconsistent ways — one that discarded
the current package-view arrangement and re-rendered the whole map, one that
stayed in context. The user asked to keep only the second.

`docs/BUILD.md:200` (the original, frozen product brief; see its own header:
"a proposed product specification... not an implemented application... This
document governs exact behavior") explicitly lists "Graph controls:
abstraction (package/class/method)" as a requirement, and
`docs/STABLE_GRAPH_INTERACTIONS.md` (a maintained, currently-followed
interaction spec) required keeping "drill-down... View methods or View
classes" as a level-navigation mode distinct from double-click arrangement.
This decision knowingly deviates from both.

## Decision

Remove the level switcher as a user-facing feature. The graph toolbar no
longer has a Packages/Classes/Methods control; `App.tsx`'s `activeLevel` is
never driven away from `'PACKAGE'` by any UI action. The four former
level-switch trigger points are repurposed rather than deleted:

- Tree `⌖` "View classes"/"View methods" and the inspector's "View classes ↗"/
  "View methods ↗" buttons now ensure the target card is expanded in place
  (never toggled closed if already open) and select it.
- An HTTP entry-point route card and the `?selectedSymbol=` deep link now
  expand every ancestor package/class of the target in place, one level at a
  time, then select the target — instead of switching levels.

## Alternatives considered

- **Keep both mechanisms.** Rejected — it is the redundancy being removed;
  keeping both preserves the inconsistency the user flagged.
- **Remove both mechanisms** (no drill-in at all beyond flat package cards).
  Rejected — expand-in-place is the currently-completed, in-context way to
  drill in, and the user explicitly asked to keep it.
- **Delete the four trigger points outright** instead of repurposing them.
  Considered and rejected in favor of repurposing: they remain useful
  discoverable affordances (a tree row, an inspector section, a route card)
  for "go look at this," and expand-in-place is a strict improvement over
  jumping the whole map to a different level for that purpose.

## Consequences

- No backend change: `GraphQueryService.java` never had a `level` parameter;
  level slicing was always client-side. The unused `GraphLevel.java` enum is
  unaffected (already dead code before this change).
- The `Level` type, `levelViews` per-level state shape, and the
  `NAVIGATE_LEVEL` reducer case remain in `explorerViewState.ts`/
  `graphModel.ts` as internal infrastructure: expand-in-place's edge routing
  (`ownerAt`/`aggregateEdges`) is parameterized on `Level` and continues to
  need `'PACKAGE'` as an input, and a large existing unit-test suite keys
  state on `Level` values for reasons unrelated to the view switcher. No
  behavior regresses by leaving this in place.
- `docs/BUILD.md` is not edited (a frozen historical brief); this ADR is the
  record of the deviation. `docs/STABLE_GRAPH_INTERACTIONS.md` is corrected
  since it describes currently-built, maintained behavior.
- Known gap: the browser-driven verification suites
  (`scripts/verify-stable-graph-ui.mjs`, `verify-git-review-ui.mjs`,
  `verify-hierarchical-ui.mjs`, `verify-change-edges-ui.mjs`) contain
  extensive scenarios built around clicking the removed segmented control;
  they were not rewritten as part of this change (see PROJECT_STATUS.md for
  what was and wasn't verified).

## Verification

- `npx tsc -b --force` (frontend) — PASS.
- `node scripts/test-graph-model.mjs`, `test-explorer-view-state.mjs`,
  `test-expansion-layout.mjs`, `test-focused-arrangement.mjs`,
  `test-explorer-journeys.mjs`, `test-node-card.mjs`, `test-graph-placement.mjs`,
  `test-source-evidence.mjs` — all PASS unmodified (they test underlying
  primitives/reducers, not the removed UI).
- Not run: the four browser-driven `verify-*-ui.mjs` suites named above (they
  test the removed control directly and need a rewrite of their own); the
  packaged-jar `verify_*_pipeline.py` suites; `./gradlew test` (expected
  unaffected since no backend file changed, but not re-run in this session).
