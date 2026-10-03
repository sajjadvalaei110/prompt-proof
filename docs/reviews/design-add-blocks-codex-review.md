# Review prompt: design-mode add blocks and empty-box expansion (ADR 0017)

Paste everything below the line into Codex. Codex should run on a clean checkout of branch
`claude/wizardly-meitner-rekrqx`.

---

You are reviewing one feature on branch `claude/wizardly-meitner-rekrqx` of Code Atlas. Code Atlas is a
local, privacy-first Java/Spring code-understanding tool: a Spring Boot 3.4 / Java 21 backend, and a
React 19 + TypeScript + Vite frontend drawn on a Cytoscape.js canvas.

The work under review is every commit after `d8c6111` up to the branch head:

```bash
git log --oneline d8c6111..HEAD
git diff d8c6111..HEAD --stat
git diff d8c6111..HEAD
```

Review all of it, in every aspect listed below. Do not limit yourself to the latest commit. Do not
modify files. Report findings only.

## Read first (binding context)

- `CLAUDE.md` and `AGENTS.md`: the invariants are binding. In particular:
  - design items are never parser facts;
  - design edits stay outside undo history;
  - with Design off, and in the Changes overlay, behaviour must be unchanged;
  - renderer inputs passed to Cytoscape must be copied, never aliased;
  - the layering is pure reducer → pure layout helpers → journey → App → `GraphCanvas`, the only
    imperative Cytoscape adapter.
- `docs/adr/0014-design-layer.md`, `0015-design-direct-manipulation.md`,
  `0016-quick-intent-plain-prompt-design-only-projects.md`, and the ADR under review,
  `docs/adr/0017-design-add-blocks.md`, including its "Round 2" section.
- `docs/ARCHITECTURE.md` §5 and §8, and `docs/STABLE_GRAPH_INTERACTIONS.md`.
- `PROJECT_STATUS.md`, the top entry ("Design layer round 4"). Treat it as claims to verify, not as truth.

## What the feature is supposed to do (owner requirements)

All of this applies in design mode only: Design on, Changes off.

1. An expanded package (or class) must not stretch just to make room for an add button.
2. Hovering **any** empty space inside an expanded package shows "+ class", and inside an expanded class
   shows "+ method". The block sits under the pointer, as large as the free space allows, up to a card,
   and never smaller than 220×150.
3. The card created there takes **exactly** the block's shape (position and size). The box must never
   grow for it.
4. Only when no block fits anywhere does the box keep one small reserve block (220×150), which grows it
   right and down.
5. An empty package or class can be expanded in design mode. It opens onto one card-sized block for its
   first class or method.
6. Room-making keeps an ancestor's reserve as it cascades, and measures nested growth against the boxes
   as they were before the change.
7. With Design off or in Changes, a childless expansion is drawn, measured and dragged as an ordinary
   card.

## Key code

- Pure layout:
  - `frontend/src/features/explorer/expansionLayout.ts`: `freeRect`, `addBlockAt`, `designBlocks`,
    `boxWithBlocks`, `RoomCard.blocks`, `roomMoves`;
  - `placementGeometry.ts`: `geometryForJourney` (`slots`, `areas`, `slotMinSizes`, empty boxes),
    `addSlotSizes`, `DESIGN_LEAST_BLOCK`, `expandsWhenEmpty`.
- `frontend/src/features/explorer/nodeCard.ts`: `hasDetailsButton` and `designExpandable`.
- `frontend/src/features/explorer/GraphCanvas.tsx`:
  - `blockAt`, `addHoverRef`, `updateDesignView` (the covered-block drop);
  - the mousemove, mouseout and tap handlers;
  - `node[?expanded][?emptyBox]` style, empty-box positioning in reconciliation, and `cardMove`;
  - `DesignDraftInput`, drawn at model size and scaled by the zoom.
- `frontend/src/App.tsx`:
  - the `projected` memo (childless expansions as cards outside design mode);
  - `toggleExpand`, `resizeContainer`, `makeRoom`, `startInlineAdd`, `commitInlineDraft`;
  - `Growth`, and `reconcileJourneyGraph` (`RESIZE_RESOURCE` for the new child), `makeRoomForGrowth`.
- Tests:
  - `scripts/test-expansion-layout.mjs`, `scripts/test-node-card.mjs`;
  - `scripts/verify-design-layer-ui.mjs`, driven by `scripts/verify_design_layer_pipeline.py`.
- Evidence: `docs/evidence/design-layer-ux/`, with screenshots, `report.json` and `design-prompt.md`.

## Review in all aspects

For each aspect, look for concrete defects, not style preferences.

1. **Correctness of the geometry.** Work through `freeRect` and `addBlockAt` by hand on awkward layouts:
   - children dragged to arbitrary positions;
   - nested expanded children (their boxes, not card sizes);
   - a user-resized box larger than its children;
   - the pointer exactly on a GAP boundary;
   - rounding in `addBlockAt` (`Math.round` and `Math.floor`): can a block end up within GAP of a child,
     or outside the inner area?

   Also:
   - Can the greedy nearest-first cut in `freeRect` miss free space, or keep a rectangle that still
     intersects a child?
   - Can `designBlocks.gaps` be empty while `addBlockAt` finds a block somewhere? Then a reserve grows
     the box although space exists. Can the reverse happen?
   - Is the "gaps are searched without the reserve" rule really free of oscillation?
2. **The shape promise.** Prove or disprove that a created card is never larger than its block and that
   the box never grows for a card made in a block.
   - Trace `startInlineAdd` → draft box → `commitInlineDraft` → `pendingGrowth.child` → `RESIZE_RESOURCE`
     → `geometryForJourney`.
   - Check the reserve case, the empty-box case, a card menu "Add …" (first gap), and a collapsed parent
     (draft below the card).
   - Check what happens when the server rejects the name, when the overlay poll reconciles before or
     after the create, and when another tab is active.
3. **Design-off and Changes invariance.**
   - Verify that nothing in Design-off or Changes geometry changed: `projected`, `placementForGraphs`,
     `roomMoves` with `blocks: null`, `hasDetailsButton` without the flag, and the card image.
   - Look especially at the `projected` memo that marks childless expansions `expanded: false` outside
     design mode. Does any other consumer (relation stack, aggregateEdges, ungroup, collapse,
     `hiddenAncestorOf`, revalidation, the inspector, the tree) depend on `expanded` and now behave
     differently?
   - Consider a box emptied by a scope edit, and an ungrouped (`hiddenBox`) one.
4. **Undo history and journeys.**
   - Design edits and their geometry side effects must stay outside undo history. Confirm that the
     `RESIZE_RESOURCE` inside `RECONCILE_ALL` cannot create a history entry, and cannot bleed into
     other tabs.
   - Expanding an empty box *is* an ordinary history step (EXPAND_RESOURCE). Is undo and redo of it
     correct, including collapse back?
5. **Cytoscape adapter.**
   - The empty box is a childless node sized by `minW`/`minH`. Check the transitions: empty box → first
     child added (it becomes a compound), last child deleted (compound → childless), and Design toggled
     while it is empty.
   - Check that position writes cannot drag children and that `cardMove` reads back the exact anchor.
   - Check for aliasing of renderer inputs.
   - Check `updateDesignView`'s covered-block logic for stale overlays.
6. **Performance.**
   - `addBlockAt` runs on every mousemove over an expanded box, sorting children each call. Is that
     acceptable on a 100-child package? Does `updateDesignView` re-render React on every mousemove,
     including `JSON.stringify` of state?
   - `geometryForJourney` now computes `designBlocks` for every expanded box on every geometry change.
7. **Interaction and accessibility.**
   - Keyboard users still have the card menu "Add …". Is it consistent with the hover rules?
   - Does the hover block conflict with the corner buttons (collapse, ungroup, stack), the relation handle,
     the resize grip or a drag start?
   - The draft is scaled by the zoom: is the input still usable at the minimum zoom (0.12), and do focus,
     Enter, Esc and blur behave the same?
   - Does the error text overflow the fixed-height draft?
8. **Tests.**
   - Do the unit and browser tests actually pin the requirements above, or could they pass with the bug
     present? For example: tolerances, assertions skipped when a fixture lacks a case, the hover point
     chosen.
   - Name important untested paths: drag, nested boxes, resize, undo, other tabs, the server error path.
9. **Documentation accuracy.** Compare ADR 0017 (both rounds), `ARCHITECTURE.md`, `TESTING.md`,
   `CLAUDE.md` and the `PROJECT_STATUS.md` entry against the code. Flag every claim the code does not
   support, and every behaviour change the docs do not mention.
10. **Security and trust boundaries.** No new network, storage or model path should exist. Check that
    nothing from an analyzed repository (names, strings) is rendered unsafely in the new DOM overlays
    (draft, slot label), and that no design path writes parser facts.
11. **Code quality.** Look for:
    - dead code left from round 1, for example `designSlot`/`minSizeWithSlot` callers, `slots` semantics,
      `blockKey` and the scratch keys;
    - duplicated geometry outside the pure layer;
    - naming that no longer matches behaviour (`slots`, `slotMinSizes`, `addSlotSizes`);
    - comments that describe the old behaviour.

## How to verify (optional, if you can run it)

```bash
cd frontend && npm ci && npx tsc -b --force && npm run build && cd ..
for f in scripts/test-*.mjs; do node "$f" || echo "FAIL $f"; done
./gradlew bootJar
CHROMIUM=/path/to/chromium python3 scripts/verify_design_layer_pipeline.py
CHROMIUM=/path/to/chromium python3 scripts/verify_ungroup_pipeline.py
CHROMIUM=/path/to/chromium python3 scripts/verify_change_edges_pipeline.py
CHROMIUM=/path/to/chromium python3 scripts/verify_git_review_pipeline.py
```

Known, pre-existing failures that are not findings:
- `verify_stable_graph_pipeline.py acceptance` fails at `revealClasses`, which clicks a level switcher
  that ADR 0007 removed;
- `ScipJavaLiveIndexingTest` fails where scip-java is installed but the fixture's Gradle build cannot run.

Not verified on the last commit: `verify_ungroup_pipeline.py`. On the author's machine it hung at its
`?selectedSymbol=` deep-link step. The previous commit, which had passed it, hung the same way, and the
browser then became unstable. If you can run it, do. Treat a hang or failure there as a finding to
investigate, not as known noise.

## Output format

Return a list of findings, most severe first. For each finding, give:

- **Severity**: blocker / major / minor / nit.
- **Aspect**: one of the numbered aspects above.
- **Location**: `path:line`.
- **What is wrong**: one or two sentences.
- **Failure scenario**: concrete state or input, then what goes wrong.
- **Suggested fix**: short.

Then add:

- a short list of requirements (1–7 above) you could **not** confirm from the code or tests;
- a list of documentation claims that are false or unverifiable.

Say "no findings" for an aspect only after you have checked it.
