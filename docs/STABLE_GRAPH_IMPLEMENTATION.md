# Stable Graph Implementation — Handoff Ledger

This ledger tracks the implementation of stable class traversal, predictable inspection, and deliberate on-demand map reordering in Code Atlas (`/home/sajjad/projects/review-assist`).

- Specification: `/home/sajjad/prompts/product-design.md` (mirrored as `docs/STABLE_GRAPH_INTERACTIONS.md`)
- Implementation plan: `/home/sajjad/prompts/steps.md`
- **Documentation substitution:** `docs/BUILD_BRIEF.md` does not exist in this worktree. `docs/BUILD.md` was read in its place, as the plan's common instructions require this to be recorded.

## Milestone & Status Overview

- **Active Milestone**: R6 — Developer comprehension redesign
- **Objective**: Fix map reshaping on clicks, eliminate 36→12 class count resets, preserve canvas viewport and node positions across inspections and scope additions, and provide two explicit arrangement commands (Double-click / Arrange around resource, and Reorder map).
- **Execution Plan**: 10 sequential steps with strict exit gates.

| Step | Objective | Status | Completed Date | Evidence |
|---|---|---|---|---|
| **Step 1** | Capture failures & create 60-class CDP fixture | **Complete** | 2026-09-10 | `scripts/verify_stable_graph_pipeline.py baseline` — 15 scenarios, 12 screenshots |
| **Step 2** | Separate inspection from displayed-page membership (`explorerViewState.ts`) | **Complete** | 2026-09-10 | 17 pure reducer tests; browser acceptance failures 34→26 |
| **Step 3** | Incremental canvas updates & append-below placement | **Complete** | 2026-09-10 | 13/16 acceptance scenarios pass; 3 owned by Step 5 |
| **Step 4** | Class traversal (A→B→C) and restorative Back navigation | **Complete** | 2026-09-11 | 41 pure reducer tests; browser acceptance failures 7→3 |
| **Step 5** | Double-click focused arrangement around resource | **Complete** | 2026-09-11 | 11 pure layout tests; browser acceptance 3→0 unmet (first fully green run) |
| **Step 6** | Pure geometry, candidate routing & scoring contract | Pending | — | Math fixtures |
| **Step 7** | Whole-map optimization algorithm (condensed SCCs, layering, sweeps) | Pending | — | Determinism benchmarks |
| **Step 8** | Cytoscape edge routing adapter & renderer agreement | Pending | — | Segment & loop rendering |
| **Step 9** | Reorder map UI, Web Worker lifecycle & atomic commit | Pending | — | Worker cancellation & fit policy |
| **Step 10** | End-to-end journey audit & full verification | Pending | — | Full suite + screenshots |

No application code was changed in Step 1.

---

## Step 1 — Trigger inventory (source inspection)

Every place the current implementation can arrange, fit, centre, change level, reset the display
limit, or create/destroy the canvas. Line numbers are from the Step 1 worktree.

### Display-limit resets (`nodeLimit`, initial 12 — `frontend/src/App.tsx:20`)

| Trigger | Location | Effect |
|---|---|---|
| `select(node)` for any non-PACKAGE resource | `App.tsx:57` | `setNodeLimit(12)` **and** `setLevel('CLASS'\|'METHOD')` |
| `explore(node)` | `App.tsx:58` | calls `select()`, then `setNodeLimit(12)` again and changes level |
| `openCodeMap()` | `App.tsx:59` | `setLevel('PACKAGE')`, `setNodeLimit(12)`, clears inspection |
| Back button | `App.tsx:98` | restores a node, sets level from its kind, `setNodeLimit(12)` |
| Level segmented control | `App.tsx:99` | `setNodeLimit(12)`, clears node **and** edge — re-selecting the active level is not a no-op |
| Show more | `App.tsx:100` | `setNodeLimit(l => l + 12)` |

Every inspection entry point funnels into `select()`: canvas node tap (`GraphCanvas` `onNodeSelect`),
tree class/package labels (`NavigationPane` `onSelect`), breadcrumb re-inspect, "Recently viewed",
global search results, inspector relationship rows and `onSelect`, and `explore()` from route cards,
tree ⌖ buttons and canvas double-tap. Constructors are covered by the same path: `select()` branches
only on `kind !== 'PACKAGE'`, so `CONSTRUCTOR` takes the METHOD-ish branch and resets the limit.

### Canvas creation / destruction (`frontend/src/features/explorer/GraphCanvas.tsx`)

| Trigger | Location | Effect |
|---|---|---|
| `topology` string changes | `:17`, effect dep at `:66` | Cytoscape `destroy()` + full re-create. `topology` is `JSON.stringify([[id,kind]…,[edgeId,source,target]…])`, so **any** node-set or edge-set change tears down the instance, and with it all positions, pan, zoom and pending gestures |
| Construction layout | `:33` | `layout: { name:'preset', positions: graphLayout(nodes, edges, selectedId), padding: 45, fit: true }` |
| Post-construction clamp | `:36` | `cy.zoom(1); cy.center()` when the fit zoomed past 1 |

`explanationStatus` is **not** part of `topology`, so explanation refreshes do not recreate the canvas
(see "Not reproduced" below).

### Arrangement / camera calls

| Trigger | Location | Effect |
|---|---|---|
| Selection effect, dep `[selectedId, topology]` | `GraphCanvas.tsx:83–91` | `cy.layout({ name:'preset', positions: graphLayout(nodes, edges, selectedId), fit: true }).run()` on **every** selection change, including clearing selection, plus a `zoom(1)/center()` clamp |
| `ResizeObserver` | `GraphCanvas.tsx:64` | `cy.resize()` then `cy.fit(undefined, 45)` and the zoom clamp, on any container size change |
| Fit map button | `GraphCanvas.tsx:93` | `cy.fit(undefined, 55)` + clamp (camera only — correct today) |
| Zoom buttons | `GraphCanvas.tsx:92` | `cy.zoom({...})` (camera only — correct today) |
| Minimap click | `GraphCanvas.tsx:103–107` | `cy.pan({...})` (camera only — correct today) |
| Data refresh effect, dep `[model]` | `GraphCanvas.tsx:76–82` | `cy.batch()` data update only — **no** layout. This is the one path that already behaves |

### Membership selection (`frontend/src/features/explorer/graphModel.ts`)

- `:26–28` — degree is computed over **all** `graph.edges`, ignoring scope and the relationship
  filter; nodes are then sorted by that global degree (descending), tie-broken by `simpleName`, and
  `:30` takes `slice(0, limit)`. The displayed page is therefore **re-selected from scratch on every
  render**, so a scope addition containing higher-degree classes evicts already displayed ones, and a
  removal silently refills the holes from the hidden queue.
- `:38` — `kind !== 'ALL' && kind !== e.kind` drops filtered edges, which changes `topology`.
- `:43` — `source.id === target.id` is dropped at PACKAGE and CLASS level, so an intra-package cycle
  is invisible above METHOD level.
- `:47` — aggregate edge IDs are `aggregate:["<source>","<target>"]`: the key is the ordered endpoint
  pair only, with neither kind nor resolution in it, so every relationship between the same ordered
  pair merges into one line and a relationship-filter change thins that line instead of renaming it.
  This is **never** a node ID, which is why passing `selectedId` into `graphLayout` as a focus fails
  for edges.

### Layout function (`frontend/src/features/explorer/graphLayout.ts`)

- `:6` — `nodes.find(n => n.id === focus)`; an unmatched focus (edge selection, out-of-map subject,
  cleared selection) silently falls through to the unfocused branch.
- `:9–17` — focused branch: incoming-left / focus-middle / outgoing-right / unrelated-below, using
  **uniform point spacing** (`dx` 310 or 345, `dy` 142 or 166), not card rectangles.
- `:19–20` — unfocused branch: alphabetical grid with `columns = ceil(sqrt(n * 1.2))`, i.e. the column
  count is recomputed from the total node count on every call.

### Card geometry (`frontend/src/features/explorer/nodeCard.ts:7`)

`width = PACKAGE ? 280 : 250`, `height = PACKAGE ? 148 : METHOD ? 104 : 128`. Confirmed from the
module, and duplicated as a hard-coded Cytoscape style rule at `GraphCanvas.tsx:26`.

### Dead placeholders

`features/explorer/GraphControls.tsx`, `hooks/useNavigationHistory.ts` and `hooks/useGraphState.ts`
have no importers anywhere in `frontend/src`. The active controls, history and level state all live
in `App.tsx`. Later steps must edit `App.tsx` (or the new view-state module), not these files.

---

## Step 1 — Reusable fixture and browser runner

### Fixture: `test-fixtures/stable-graph-fixture/`

74 types (72 `CLASS` + 2 `INTERFACE`) across 6 packages. Full topology table, verified counts and
known limits are in `test-fixtures/stable-graph-fixture/README.md`. Highlights:

- `OrderController → OrderService → PricingService → TaxService` (visible A→B→C chain)
- `PaymentService ⇄ FraudService` (reciprocal)
- `Order → Item → Customer → Order` (cycle, CLASS level only)
- 21 zero-degree types (all of `util`, plus unused domain entities)
- `INJECTS` + `CALLS` + `DEPENDS_ON` in parallel between the same pairs
- 4 drawn `CANDIDATE` edges from two deliberately ambiguous `@Autowired` interfaces
- 23 `UNRESOLVED` relationships that are **metadata only** — `GraphQueryService` filters
  `WHERE r.target_symbol_id IS NOT NULL`, and `projectGraph()` skips `!e.targetId`, so `CANDIDATE`
  is the only non-`RESOLVED` state that can appear as a drawn route

### Runner: `scripts/verify_stable_graph_pipeline.py` + `scripts/verify-stable-graph-ui.mjs`

Follows the existing Chromium/CDP pattern of `verify_hierarchical_pipeline.py`; the explanation
harness was left untouched.

- Isolated SQLite data dir and Chromium profile per run, under `build/stable-graph/<mode>-<random>/`.
- The fixture is copied to a temp directory before import and SHA-256 hashed before and after, so
  source read-only is proven per run. The user's own workspaces and model profile are never touched.
- **No provider is reachable**: `--codeatlas.model.base-url` points at a free port with nothing bound
  to it, and no explanation job is ever started. The header still reads "Model configured" because a
  base URL *string* is present; that label is not evidence of reachability. This is not a live-model
  verification and not an explanation verification.
- Instrumentation is installed **from the test side** onto Cytoscape's own registry
  (`.graph-canvas._cyreg.cy`). The application ships no debug object. `window.__probe` is created by
  the harness and holds integer counters only (`instances`, `layouts`, `fits`, `centers`, `taps`,
  `dbltaps`, `anyDbltaps`) — no graph data. Because the canvas is destroyed and recreated on the same
  container `div`, DOM identity proves nothing, so each core is stamped with an incrementing
  `__probeId` and the counters live on `window` to survive recreation.
- Captured per scenario: displayed node IDs and their order, per-node model coordinates, aggregate
  edge IDs, zoom, pan, level, scope-banner text, Show-more text, inspecting chip, scope checkbox
  tri-states, inspector subject, canvas box size, and the `__probeId`.
- **All gestures are real CDP pointer input** (`Input.dispatchMouseEvent` with `mouseMoved`,
  `mousePressed`/`mouseReleased`, `clickCount` 1 then 2). Nothing uses `.emit('tap')`. Camera moves in
  the scenarios use the app's own Zoom-in button plus a genuine background drag.

Two modes, selected explicitly:

```bash
python3 scripts/verify_stable_graph_pipeline.py baseline     # records today's behaviour; PASSES
python3 scripts/verify_stable_graph_pipeline.py acceptance   # asserts the product contract; FAILS today
```

`baseline` asserts the known-broken outcomes and is the Step 1 exit evidence. It is expected to start
failing once Steps 2–3 land — that failure is the signal to retire the baseline case, not to weaken
`acceptance`. `acceptance` encodes the stable-map contract and must never be softened.

---

## Step 1 — Baseline results (2026-09-10)

`python3 scripts/verify_stable_graph_pipeline.py baseline` → **PASS**, 15 scenarios, 12 screenshots.
**Durable evidence: `docs/evidence/stable-graph-step1/`** — `baseline-report.json` (full before/after
state for every scenario) plus the four screenshots cited below. The complete run, including
application/Chromium logs and all 12 screenshots, is in `build/stable-graph/baseline-_q7q6egb/`; note
that `build/` is git-ignored and a `./gradlew clean` removes it, which is why the exit-gate evidence
is duplicated under `docs/`.

| # | Scenario | Reproduced? | Measured outcome |
|---|---|---|---|
| S1 | Click a class card with 12 displayed | **Yes** | 12→12 IDs kept, but `cy.layout` ×1, `cy.fit` ×1, **all 12 cards moved** (max 1042 model units), zoom and pan both changed |
| S2 | Reveal 36 classes, pan/zoom, click one | **Yes** | **36 → 12 displayed**, 24 IDs dropped, canvas destroyed and recreated, 12 survivors moved (max 1560), user camera discarded |
| S3 | Click a package card at Packages level | **Yes** | Count unchanged (no limit at PACKAGE level), but `cy.layout` ×1, `cy.fit` ×1, all 6 cards moved (max 735), camera changed |
| S4 | Click an edge | **Yes** | Membership and limit preserved, but `cy.layout` ×1 + `cy.fit` ×1 and **every card moved** (max 1055) — the aggregate edge ID matches no node, so `graphLayout` falls back to the alphabetical grid; the user's camera is discarded |
| S5 | Change the relationship filter to `CALLS` | **Yes** | Edges 93→31 with node IDs preserved, but the **canvas is destroyed and recreated** and the user's pan/zoom is lost |
| S6 | Add package `service` to an explicit 4-package scope | **Yes** | Canvas recreated; **23 of 36 displayed classes evicted** and replaced by 23 higher-degree ones; the page did **not** grow (36→36); 12 survivors moved (max 1869); camera lost |
| S7 | Remove package `service` again | **Yes** | Canvas recreated; 23 evicted and **23 holes refilled from the hidden queue**; survivors moved |
| S8 | Close the details pane | **Yes** | Clearing the inspection re-runs the unfocused arrangement: `cy.layout` ×1, `cy.fit` ×1, all 12 cards moved (max 1055), camera changed |
| S9 | Resize the viewport (1500→1180 wide) | **Yes** | `ResizeObserver` calls `cy.fit` ×1; membership and coordinates survive, but the camera moves with no user navigation |
| S10 | Two spaced single clicks (700 ms apart) | **Yes** | 2 node taps, 0 double-taps, but `cy.layout` ×1 and the page still collapsed 36→12 |
| S11 | **Control:** real double-click on empty canvas | n/a | Cytoscape core `dbltap` fires exactly once — the CDP gesture synthesis is sound |
| S12 | Real double-click on a card, 12 displayed, 90 ms gap | **Yes** | Canvas survives, but the first tap's arrangement moves the target **334 px away from the pointer**; core `dbltap` fires on empty space, node `dbltap` = 0, no drill-down |
| S13 | Same, 15 ms gap | **Yes** | Identical outcome: `cy.layout` ×1, all cards moved, node `dbltap` = 0, no drill-down — the re-arrangement wins the race even at minimal separation |
| S14 | Real double-click on a card, 36 displayed | **Yes** | The first tap resets the limit, changing `topology` and destroying the canvas; **no `dbltap` at all**, not even on the core; page collapses to 12 |
| S15 | Narrow layout 430×900 | n/a | No horizontal page overflow |

### Precisely classified as *not reproduced*

- **Explanation refresh reordering the map.** Not reproduced, and inspected: `topology`
  (`GraphCanvas.tsx:17`) contains only `[id, kind]` and `[edgeId, source, target]`, so an
  `explanationStatus` change cannot recreate the canvas; the data-refresh effect
  (`GraphCanvas.tsx:76–82`) is a `cy.batch()` data update with no layout call; and `App.tsx:52`
  compares the refetched graph by JSON and keeps the previous object when identical. The existing
  `scripts/verify_hierarchical_pipeline.py` already asserts that pan and zoom are unchanged across an
  explanation refresh. This run cannot add to that: it deliberately has no reachable provider.
  **Residual risk for Step 3:** an explanation refresh that changes an edge's aggregate *membership*
  would still change `topology`; that is untested here.
- **Opening/closing the details pane resizing the canvas.** The `<aside class="inspector">` is mounted
  whenever `tab !== 'context'` and only swaps content, so closing it did **not** change the canvas
  width and did **not** fire the `ResizeObserver`. The observed disturbance in S8 comes from a
  different cause: `onClose` sets `selectedId` to `undefined`, which re-runs the selection effect and
  re-applies the unfocused grid. The `ResizeObserver` failure is real but is exercised by S9 instead.

### Screenshots inspected

Desktop 1500×980: `s1-click-class-at-12`, `s2-reveal-36-then-click`, `s3-click-package`,
`s4-click-edge`, `s5-filter-change`, `s6-add-package`, `s7-remove-package`, `s8-close-details`,
`s9-resize`, `s10a-double-click-at-12`, `s10b-double-click-at-36`. Narrow 430×900: `s11-narrow-map`.

Inspected directly. The final run also reports zero browser runtime exceptions. `s2` shows the banner reading "Showing 12 of 74 in scope · show 12 more" with 12
cards on the map immediately after the user had 36 revealed and clicked `NotificationService` — the
reported reset, visible. `s4` shows the relationship inspector open on
`OrderService → OrderRepository (injects, resolved)` while the map behind it has snapped back to the
alphabetical grid at 70 %, with the pan and zoom the scenario had deliberately set now gone. `s6` shows the whole page re-composed of different classes at 39 % zoom after
one package checkbox, with amber dashed `CANDIDATE` edges present, confirming uncertainty styling is
exercised by the fixture.

### Acceptance-mode result (expected failure)

`python3 scripts/verify_stable_graph_pipeline.py acceptance` → **FAIL**, as intended: 34 contract
assertions unmet across 13 scenarios. Only the gesture control passes. This is the target Steps 2–5 must turn green.

---

---

## Step 2 — Separate inspection from displayed-page membership

### What changed

- **New `frontend/src/features/explorer/explorerViewState.ts`** (Appendix A/F). A small pure
  reducer owns `activeLevel`, per-level `LevelViewState` (`displayedIds`, `priorEligibleIds`,
  `initialized`), `inspectedSubjectId`/`inspectedKind`, and Back-navigation `history` (deduped,
  capped at 20). Positions, camera, and edge routes are **not** tracked yet — that is Step 3's
  contract extension, not built ahead of schedule with no caller.
  - `INSPECT_NODE`/`INSPECT_EDGE`/`CLEAR_INSPECTION` never touch `levelViews` or `activeLevel`.
  - `reconcileLevelView` implements Appendix A2 exactly: `survivors` = previous `displayedIds`
    filtered by new eligibility (order preserved); `newlyEligible` = eligible IDs absent from the
    **previous eligible boundary** (`priorEligibleIds`), not merely absent from the displayed page —
    this is what stops an unrelated scope edit from revealing classes that were already
    eligible-but-pending. An `explicitClassAddId` (a direct class checkbox) appends exactly that
    one class; otherwise the next bounded batch of `newlyEligible` is appended.
  - `SHOW_MORE` uses a separate `appendPendingBatch` helper that reveals from *all*
    eligible-but-undisplayed IDs regardless of when they became eligible (Appendix A2's `pending`).
  - `NAVIGATE_LEVEL` re-runs the same reconcile for the target level every time, so a level's page
    is lazily reconciled against the *current* scope only when the user actually returns to it
    (Story 6: "Changing scope while visiting another level is applied when returning to Classes").
    Called with unchanged eligibility it is provably idempotent (verified by test), which is what
    makes "re-selecting the active level is a no-op" hold without a special-cased guard.
  - `NAVIGATE_BACK` is deliberately conservative: it drops now-ineligible survivors but passes
    `batchSize: 0`, so it never auto-admits new eligibility. Restoring an old view should not
    surprise the user with cards they never asked to see; Show more / an explicit scope edit are
    the only things that grow a page.
  - `RESET` reinitializes every level (used when a new snapshot loads) and populates only the
    starting level, so a stale level from a previous snapshot cannot leak forward.
- **`frontend/src/features/explorer/graphModel.ts`** refactored, not duplicated. `projectGraph` is
  now built from three reusable primitives: `getEligibleIds` (scope+level candidates, no ranking),
  `rankEligibleIds` (degree/simpleName/ID ranking, used only to order a *new batch*, never to
  re-rank survivors), and `projectDisplayed` (renders an explicit ID list — no ranking, no
  slicing). `projectGraph` itself is kept, now expressed in terms of these, purely because the
  existing `scripts/test-graph-model.mjs` suite exercises it and other future callers may want a
  single ranked/bounded view; the live application no longer calls it. A single `aggregateEdges`
  helper is shared by `projectGraph` and `projectDisplayed`, per Appendix A's "do not create two
  subtly different occurrence aggregation implementations."
- **`frontend/src/App.tsx`** rewired: `node`/`edge`/`history`/`nodeLimit`/`level` local state
  removed in favor of the reducer. `select()` and `inspectEdge()` now dispatch pure inspection
  events with no other side effect. `explore()`, the level segmented control, `openCodeMap()`,
  Show more, and Back all dispatch the appropriate membership/navigation action instead of calling
  `setNodeLimit`/`setLevel` directly. `handleScopeChange()` centralizes every scope mutation
  (checkbox, Reset to whole system, canvas "Remove from scope") so each one recomputes eligibility
  for the active level and dispatches `SCOPE_UPDATED` once. A `mapStatus` derived value
  (`OUT_OF_SCOPE` / `IN_SCOPE_NOT_DISPLAYED` / `DISPLAYED`) is computed from the inspected
  subject's own natural level (not necessarily the currently active one) and passed to the
  inspector.
- **`NavigationPane.tsx`**: `onScopeChange` gained an optional `explicitClassAddId` second
  argument; `ClassRow`'s checkbox passes the class's own ID only when it is being **added** (not
  removed), so App.tsx can tell a direct single-class add apart from a package/bulk toggle.
- **`InspectorPanel.tsx`**: new optional `mapStatus` prop renders "Outside current scope." or "In
  scope, not currently displayed." next to an inspected subject, per Story 1/Story 6.
- GraphCanvas.tsx, graphLayout.ts, nodeCard.ts: **untouched**. The canvas still calls
  `graphLayout()`/`fit()` on every `selectedId`/`topology` change — positions and camera are
  still not stable. That is Step 3.

### Why the browser harness itself needed edits

Step 2's own fix — "re-selecting the active level is a no-op" — retired the test harness's
`revealClasses()` trick of clicking the already-active level button to force the page back down to
12; under the fix that click is now a genuine no-op, so a grown page (correctly) stays grown.
`scripts/verify-stable-graph-ui.mjs` gained a `reload()` helper (fresh `Page.navigate`) used before
the three double-click sub-scenarios that need a guaranteed small starting page, and the
add-package precondition was loosened from an exact `36` to `>= 12`, because each individual
package checkbox is now its own scope edit that appends its own bounded batch (checking 4 packages
one at a time can legitimately exceed 36 before Show more is ever clicked — this is the intended
Appendix A2 behavior, not a bug). Both are mechanical consequences of the fix working, not new
application behavior.

### Baseline — 8 assertions retired, all re-verified as PASS

`python3 scripts/verify_stable_graph_pipeline.py baseline` → **PASS**, 15 scenarios (previously
crashed on a stale precondition before this session's fixes; full run after fixing it is durable
evidence). Retired exactly the assertions the real browser run showed are no longer reproducible,
replacing them with the corresponding now-true statement so the file keeps recording current
behavior instead of silently going stale:

| Scenario | Retired (no longer true) | Replaced with (now true, Step 2) | Still true (Step 3+) |
|---|---|---|---|
| `reveal-36-then-click-class` | collapses to 12; 24 dropped; canvas recreated | still 36 displayed; canvas survives | cards move; camera discarded |
| `add-package-to-scope` | evicted by degree re-ranking; page re-selected, not grown | no class evicted; page grows (38→50) | canvas recreated; cards move |
| `remove-package-from-scope` | holes refilled from hidden queue | no holes filled (38→50→38, exact) | canvas recreated; cards move |
| `real-double-click-at-36` | first tap destroys canvas; page collapses to 12 | canvas survives the first tap; still 36 displayed | gesture still lost (Step 5); no drill-down |

### Acceptance — 34 → 26 unmet assertions; every membership assertion now passes

`python3 scripts/verify_stable_graph_pipeline.py acceptance` → still **FAIL** by design (26 unmet
contract assertions across 10 scenarios; was 34 across 13 in Step 1). The remaining 26 are
exclusively position/camera/canvas-identity (Step 3) and double-click gesture reachability
(Step 5) — every single membership/level/scope assertion for every scenario now passes, including:
"still 36 displayed", "same displayed IDs in the same order", "no previously displayed class is
dropped", "a bounded first batch of newly eligible classes is appended", "the displayed page grows
rather than being re-selected", "no holes filled from the hidden queue", "level unchanged",
"displayed count unchanged", "edge set changed / node membership unchanged". Durable evidence:
`docs/evidence/stable-graph-step2/{baseline,acceptance}-report.json` plus three inspected
screenshots (`s2-reveal-36-then-click.png` — banner reads "Showing 36 of 74 in scope · show 12
more" after clicking a class, all 36 cards present; `s6-add-package.png` — banner reads "Showing 50
of 64 in scope · show 12 more" after adding a 5th package to a 38-class custom scope, all prior
classes still visible; `s7-remove-package.png`). The full run (all 12 screenshots, both modes'
complete reports, application/Chromium logs) is in `build/stable-graph/{baseline,acceptance}-*/`
(git-ignored).

### Pure tests

`node scripts/test-explorer-view-state.mjs` → **PASS, 17 checks**: inspection never touches
level/membership/revision; re-inspecting the same subject is a no-op (same object reference,
no duplicate history); history caps at 20 and never duplicates consecutive entries; a never-visited
level admits its first batch in caller-given rank order; re-navigating to an unchanged level is
provably idempotent; **the core Step 1 regression** (reveal 36 via two Show-mores, inspect one,
still exactly the same 36 IDs in the same order); an explicit single-class add appends exactly one;
a package addition appends a bounded ≤12 batch without touching survivors or leaking
already-pending classes from an unrelated package; removal drops without backfill; re-adding a
removed class lands at the end, not its old slot; Show more reveals from the full pending queue
regardless of when items became eligible; `NAVIGATE_BACK` restores the prior level/subject, drops
now-ineligible survivors, and never auto-admits new eligibility; `NAVIGATE_BACK` on empty history
and `RESET` are covered.

`node scripts/test-graph-model.mjs` → **PASS, all 7 suites**, unchanged behavior — the
`projectGraph` refactor (built from the new `getEligibleIds`/`rankEligibleIds`/`projectDisplayed`
primitives) preserves its exact external contract; no test needed updating.

### Other checks

- `npx tsc -b --force` (frontend/) — 0 errors.
- `npm run build` (frontend/) — succeeds; existing >500 kB bundle advisory unchanged.
- `./gradlew bootJar --no-daemon` — BUILD SUCCESSFUL, rebuilt jar bundles the new frontend (needed
  before re-running the browser pipeline, since it serves the packaged UI).
- `node --check scripts/verify-stable-graph-ui.mjs`, `git diff --check` — clean.
- Not run: `./gradlew test` (no backend source changed this step) and
  `python3 scripts/verify_hierarchical_pipeline.py` (explanation harness untouched; App.tsx's
  explanation-related props/effects were not modified beyond routing `onInspectEdge`/`onClose`
  through the new reducer, which changes no explanation behavior).

### Remaining known limitations (accurately not claimed fixed)

- **Positions and camera still move** on every inspection, scope edit, and filter change — Step 3.
- **Canvas identity is now stable for pure inspection** (topology unchanged ⇒ no recreation) but
  **still recreated on any real scope/edge-filter change**, since `GraphCanvas`'s creation effect
  is still keyed on `topology` — Step 3.
- **Double-click still cannot reach a node reliably** — the first tap's position-shift (Step 3)
  moves the card out from under the second press. It no longer *also* destroys the canvas at an
  expanded page (a stable topology is an emergent benefit of this step), but the gesture itself is
  Step 5's job to fix by moving arrangement off single/first-tap entirely.
- **`openCodeMap()` still unconditionally resets to Packages and clears inspection**, even when
  already there — matching prior behavior deliberately. Story 6's "Code map returns to the last
  map view; clicking it while already there does not reset" is explicitly Step 4's item, not
  claimed here.
- **The level segmented control still clears inspection on a genuine level switch** (not on
  re-selecting the same level, which is now a true no-op). Whether inspection should survive a
  deliberate level switch is left to Step 4, which owns navigation predictability end-to-end.
- **An inspected edge does not survive a relationship-filter change** that excludes its kind
  (its aggregate ID is a view-scoped computation, not a stable identity) — unaffected by this step
  either way; not a regression, not claimed fixed.
- `docs/BUILD_BRIEF.md` remains absent; `docs/BUILD.md` was read in its place, as in Step 1.

---

## Step 2 — Review fixes (`/home/sajjad/prompts/step-2-review.md`)

A four-agent read-only review (`step-2-review.md`, score 91/100, verdict "PASS WITH CAVEATS")
audited the Step 2 diff. Triaged and resolved every finding that was a genuine defect in code this
step changed; declined two that are pre-existing performance characteristics inherited unchanged
from before this step, on the grounds that fixing them would touch files/patterns outside this
step's actual diff.

### Fixed

| ID | Severity | Fix |
|---|---|---|
| **UI-01** | High | `App.tsx`'s `edge` lookup only searched `projected.edges`, which never contains unresolved relationships (`target_symbol_id IS NULL` has nothing to aggregate onto). Clicking "Inspect relationship" on an unresolved row collapsed the inspector to its idle state. Added a fallback to `graph.metadata.unresolvedRelationships`, reconstructing the exact `{...e, targetId:null, descriptiveLabel:e.unresolvedTarget}` shape `InspectorPanel` already builds for that button. **Verified live**: new permanent CDP scenario `inspect-unresolved-relationship` (`ExternalPaymentGateway extends GatewayBase`, unresolved by fixture design) — inspector shows "Relationship" content, not idle; membership count unaffected. |
| **UI-02** | Medium | `mapStatus` compared the inspected node's *own* natural level's cached page against its ID, so a method cached in `levelViews.METHOD` from an earlier visit reported `DISPLAYED` even while the active canvas showed Classes. Now requires `level === levelOf(node)` before checking `displayedIds`, matching Story 1/6's "not shown in the current map" contract. |
| **ARC-01** | Medium | `reconcileLevelView`'s explicit-add ternary fell back to a ranked batch of unrelated classes whenever the checked class wasn't a valid candidate at the active level (e.g. the tree checkbox toggled while viewing Packages). Changed so an explicit add is *always* the caller's entire intent: exactly that one class, or nothing — never a silent unrelated batch. New pure test. |
| **ARC-02** | Low | `membershipRevision` bumped unconditionally on every `NAVIGATE_LEVEL`/`SCOPE_UPDATED`/`SHOW_MORE`/`NAVIGATE_BACK`, including true no-ops. `reconcileLevelView`/`appendPendingBatch` now return `changed`, and the reducer only bumps when `displayedIds` actually changed length or content — inert today (nothing reads the field yet) but avoids handing Step 3 a signal that fires on no-op reconciliations. New pure test. |
| **ARC-03** | Low | Closing the inspector (`CLEAR_INSPECTION`) dropped the closed subject without pushing it to history, so `A → B → close → C → Back` skipped straight from C to A, silently losing B. Closing is a pane-visibility toggle, not a navigation, so the closed subject now joins history exactly as a normal `INSPECT_*` transition would. New pure test covers the full `A → B → close → C → Back → Back` chain. |
| **ARC-04** | (not in final table, fixed anyway — free) | `appendPendingBatch` assumed every ID in `view.displayedIds` was still eligible. Added the same defensive `filter(eligibleSet.has)` pruning `reconcileLevelView` already had, so Show more is correct even if ever called without an intervening reconciliation. New pure test. |
| **UI-03** | Low | `history` only dedupes *consecutive* repeats, so `A → B → A` produced a duplicate React key in the "Recently viewed" list's naive `slice(-3)`. Replaced with a walk-from-the-end loop collecting up to 3 distinct, most-recent-first `subjectId`s. |
| **MOD-03** | Low | `projectGraph` re-implemented `projectDisplayed`'s node/edge construction instead of calling it. Now delegates directly; verified byte-identical behavior against the unchanged `test-graph-model.mjs` suite. |

### Declined (pre-existing, out of this step's diff)

- **MOD-01** (`getEligibleIds` → `scopeModel.isNodeInScope` rebuilds a `Map` per candidate) and
  **MOD-02** (`decorate()`'s per-node `graph.nodes.filter(parentId===...)` scan) are both patterns
  the *original* `projectGraph` already had before Step 2 — this step extracted them into shared
  helpers without changing their complexity. Fixing them means touching `scopeModel.ts` and the
  shared node-decoration path for a performance concern with no evidence it matters at the
  fixture's current scale; left for a dedicated performance pass (the reviewer's own suggestion —
  Step 3, once real card dimensions make a natural place to also pre-index `parentId`/`nodeMap`).

### Verification after fixes

- `node scripts/test-explorer-view-state.mjs` → **PASS, 21 checks** (17 original + 4 new: explicit
  class add with an invalid target, `CLEAR_INSPECTION` history preservation across a close,
  `membershipRevision` only bumping on real change, Show more's defensive pruning).
- `node scripts/test-graph-model.mjs` → PASS, 7 suites, unchanged (confirms the `projectGraph`
  delegation change is behavior-preserving).
- `npx tsc -b --force`, `npm run build` — clean.
- `./gradlew bootJar --no-daemon` rebuilt; full baseline+acceptance browser re-run:
  **identical 26 acceptance failures, zero new ones** — the review fixes are internal correctness
  improvements the existing 15 scenarios don't otherwise exercise. Added a 16th scenario,
  `inspect-unresolved-relationship`, specifically to give UI-01 real browser evidence (screenshot:
  `docs/evidence/stable-graph-step2/s4b-inspect-unresolved-relationship.png`, inspector correctly
  shows "ExternalPaymentGateway → GatewayBase · extends · unresolved"). Evidence refreshed in
  `docs/evidence/stable-graph-step2/{baseline,acceptance}-report.json`.
- UI-02's fix has no dedicated new browser scenario (constructing the specific cross-level cached-page
  precondition cheaply within the existing harness wasn't warranted for a one-line comparison fix);
  confirmed by code inspection and `tsc` type-checking only. Flagged here so a future step can add
  one if this class of bug recurs.

---

## Step 3 — Preserve the canvas and append resources without moving survivors

### What changed

- **`frontend/src/features/explorer/graphPlacement.ts`** (new) — pure Appendix A3 placement.
  `placeAdditions(survivorBounds, additions, storedAppendWidth)` returns positions for exactly a
  new batch, packed in spaced rows below the survivors' actual bounding box, plus the `appendWidth`
  to persist and reuse. Room for **six** typical cards per row (not Appendix A3's literal "three" —
  a 3-wide strip would make a 36-class page ~12 rows / ~2100 model units tall, a visible regression
  against the pre-Step-3 grid; the wider default is recorded here as the measured deviation the
  appendix invites, `appendWidth = 6*typicalWidth + 5*48`). No React/Cytoscape/DOM imports.
- **`frontend/src/features/explorer/explorerViewState.ts`** extended, not replaced. `LevelViewState`
  gained `positions`, `camera`, `geometryRevision`, `cameraRevision`, `geometryInitialized`,
  `appendWidth` (Appendix F2); root state gained `generation` (bumped only by `RESET`, guards a
  late `SET_CAMERA`/`NODE_MOVED` from a previous snapshot). `NAVIGATE_LEVEL`/`SCOPE_UPDATED`/
  `SHOW_MORE`/`RESET` gained an optional `placement?: Record<string, {width,height,name}>` field —
  actual card dimensions (`nodeCard.ts` owns them, never duplicated in state) for every eligible ID,
  supplied by the caller in the *same* dispatch that admits membership. `reconcileLevelView`/
  `appendPendingBatch` now also reconcile geometry: survivor positions are echoed back verbatim
  (dropped if the ID left `displayedIds`), and newly admitted IDs get placed via `placeAdditions`
  using survivor bounds assembled from stored positions + the placement record. This is Appendix
  F2's first option ("attach dimension records to the relevant intent"), not the second
  (`COMMIT_GEOMETRY` action) — one dispatch, one render, every displayed ID has a position with no
  `render → effect → reducer → layout` round trip and no staleness guard to write. Two new actions:
  `SET_CAMERA` (level-scoped, strict-equality no-op guard, own `cameraRevision`) and `NODE_MOVED`
  (manual drag, ignored for an ID no longer displayed). All 21 existing Step 2 checks pass unmodified
  — `placement` is optional, so a membership-only caller (including most existing tests) still works,
  just without geometry.
- **`frontend/src/features/explorer/GraphCanvas.tsx`** rewritten around one Cytoscape core created
  on mount and destroyed only on unmount — never on a `nodes`/`edges` change. Three effects replace
  the old create-with-layout/select-with-layout pair:
  1. **Reconciliation** (`[nodes, edges, positions]`): one `cy.batch()` removes absent edges, removes
     absent nodes, adds new nodes at their given `positions[id]` (fallback `{0,0}` only if somehow
     missing), adds new edges, and refreshes every current element's `.data()`. A survivor's position
     is **never** rewritten here — only `cy.add()` for a genuinely new element sets one, and
     `dragfree` is the only other writer (via `onNodeMoved`). The endpoint-move path Appendix A2
     mentions is unreachable for this app's edges: an aggregate ID is
     `aggregate:[source,target]` (`graphModel.ts`), so a different endpoint is
     necessarily a different ID, handled by ordinary remove+add.
  2. **Selection/emphasis** (`[selectedId, nodes, edges]`): toggles `.inspected`/`.neighbor`/
     `.muted` and the `.flow-*`/`.rel-*` classes only — no `cy.layout()`/`cy.fit()` call anywhere in
     the file anymore (`graphLayout.ts` import removed; the module itself is untouched on disk for
     Step 5's Appendix B reuse). Emphasis is class-based rather than Cytoscape selection: the core
     sets `autounselectify: true`, so `:selected` matches nothing and `.inspected` carries it.
     `.neighbor` (node border) gives positive emphasis to direct neighbors per Story 1, layered so
     resolution dashes and READY coloring (which only set `line-color`) survive underneath. The
     former `.incident` rule is gone: it emphasized an edge by fixing its *width*, which would
     overwrite the occurrence strength a route's width now carries (`data(strengthWidth)`), so
     emphasis may only change colour and glow. An inspected *edge* unions `connectedNodes()` into
     its neighborhood — `closedNeighborhood()` iterates a collection's nodes and so yields only the
     edge itself, which would leave its own endpoints in the muted difference.
  3. **Camera** (`[camera]`, reference-identity trigger only): restores a saved camera via
     `cy.viewport({zoom,pan})`, or — only when `camera === null`, i.e. a level's first-ever visit —
     performs the one allowed non-user-initiated `cy.fit()` and immediately reports the result via
     `onCameraChange`. A `programmatic` ref flag (exposed as `cy.__setProgrammaticCamera`) suppresses
     the debounced capture listener during both, so a restore round-trip cannot be mistaken for a
     fresh user gesture. Real user pan/zoom/drag is captured on `'pan zoom'`, debounced 180ms, and
     reported via `onCameraChange` — this is the *only* path that persists a camera the user actually
     set (Fit map / zoom buttons / minimap click all go through it too, since they call `cy.pan`/
     `cy.zoom`/`cy.fit` directly without the programmatic guard).
  The `ResizeObserver` keeps `cy.resize()` (and its zero-size guard) but no longer calls `cy.fit()` or
  clamps zoom — a pane resize can no longer move the camera on its own. The hardcoded
  `width:280,height:148` on the `node[kind="PACKAGE"]` style rule was removed (duplicated
  `nodeCard.ts`, and placement now depends on that one source of truth agreeing with the renderer).
- **`frontend/src/App.tsx`** wired: a `placementFor(ids)` helper builds the `placement` record from
  `graph.nodes` + `nodeCard()` for every eligible ID and is passed on every `NAVIGATE_LEVEL`/
  `SCOPE_UPDATED`/`SHOW_MORE`/`RESET` dispatch (explore/openCodeMap/level-control/Show
  more/loadSnapshot). `handleCameraChange`/`handleNodeMoved` close over the current `level` and
  `viewState.generation` and dispatch `SET_CAMERA`/`NODE_MOVED`; `GraphCanvas` receives
  `positions`/`camera` read straight from `viewState.levelViews[level]`.
- `scripts/test-graph-placement.mjs` (new, 8 checks) and 13 new checks appended to
  `scripts/test-explorer-view-state.mjs` (34 total) — see `docs/TESTING.md` §7 for the full list.

### Why the browser harness needed an off-screen-click fix (not an application defect)

Several scenarios picked a click target by raw `cy.nodes()[N]` index, safe only because the canvas
used to be unconditionally re-fit to whatever was displayed. With that gone, `renderedPosition()`
for an arbitrary index can legitimately sit outside the visible canvas box (a card appended below
the initial fit, or one the last `panAndZoom()` panned away from), and a synthesized click at an
off-canvas point lands on real DOM sitting there instead — observed concretely as a spurious
`panChanged: true` with zero node taps on `reveal-36-then-click-class`, traced to the click landing
on the minimap (which pans on click) rather than the intended card. Fixed with
`pickVisibleNodeId()`/`visibleEdgeCandidates()`, which filter to elements whose
`renderedBoundingBox()`/`renderedMidpoint()` is actually inside the current canvas box before
picking a target. All ten `cy.nodes()[N]` sites and the S4 edge-click loop were switched to these
helpers; this is a mechanical harness consequence of the fix working, not new application behavior
(same category as Step 2's `reload()` addition).

### Baseline — every assertion that described the fixed defects retired, all re-verified as PASS

`python3 scripts/verify_stable_graph_pipeline.py baseline` → **PASS**, 18 scenarios (the S4b
regression-guard scenario from Step 2's review fixes and the two S9b manual-drag scenarios from the
post-review follow-up are included). Every baseline assertion that
asserted a `cy.layout()`/`cy.fit()` call, camera discard, canvas recreation, or survivor movement on
a non-arrangement interaction (S1–S9, two-spaced-single-clicks) is now false and was retired with its
now-true replacement, following Step 2's precedent exactly — see the diff in
`scripts/verify-stable-graph-ui.mjs` for each scenario's exact before/after wording. The three
real-double-click scenarios needed a different kind of rewrite: Step 3 fixing position stability
makes the double-click *gesture* reach the target card reliably for the first time (previously the
first tap's own arrangement moved the card out from under the second press before it could land) —
but the gesture is still wired to `explore()`, so it now reliably causes an unwanted level change
(Classes → Methods, count 36 → 12 unrelated method IDs) instead of Step 5's future dedicated
arrangement command. Recorded as the new baseline finding for those three, explicitly owned by
Step 5, not silently left for that session to rediscover from a green baseline.

### Acceptance — 26 → 7 unmet assertions, all 7 in the 3 scenarios Step 5 owns

`python3 scripts/verify_stable_graph_pipeline.py acceptance` → still **FAIL** by design: 7 unmet
assertions, all three in `real-double-click-at-12-human-paced`, `real-double-click-at-12-fast`, and
`real-double-click-at-36` ("exactly one arrangement" / "level unchanged" / "displayed count
unchanged" — `layoutCalls` for these will always read 0 regardless of what Step 5's dedicated
`ARRANGE_AROUND_RESOURCE` command does, since nothing in the codebase calls `cy.layout()` anymore;
that specific assertion mechanism is stale in a way Step 5 will need to address when it implements
the actual command, not something this step should reach into a future step's gate to fix). **15 of
18 scenarios pass outright**, including every stable-position/stable-camera/canvas-identity
assertion and both new drag scenarios: `click-class-card-at-12`, `reveal-36-then-click-class`, `click-package-card`,
`click-edge`, `inspect-unresolved-relationship`, `change-relationship-filter`,
`add-package-to-scope`, `remove-package-from-scope`, `close-details-pane`, `resize-pane`,
`manual-drag-persists`, `manual-drag-persists-across-level-switch`, `two-spaced-single-clicks`,
`control-double-click-empty-canvas`. Durable evidence:
`docs/evidence/stable-graph-step3/{baseline,acceptance}-report.json` plus seven inspected screenshots
(`s1-click-class-at-12.png` — selected `CatalogService` gets a filled teal highlight, direct
neighbor `OrderService` gets an outline-only `.neighbor` border, unrelated cards stay in their exact
grid positions; `s2-reveal-36-then-click.png` — all 36 cards present after a click, camera exactly
as `panAndZoom()` left it; `s5-filter-change.png` — CALLS-only edges with all 36 classes still in
their exact positions, an out-of-map inspected relationship correctly leaves nothing selected/muted
since its ID matches no displayed element; `s6-add-package.png` — the 12 newly eligible classes were
appended below the existing 38, camera untouched (still zoomed to 98% on the pre-add region, so most
of the addition is below the fold — correct per "do not automatically scroll to new cards");
`s10b-double-click-at-36.png` — the expected Step-5-owned regression, Methods level with the
inspector correctly showing "In scope, not currently displayed" for the class that was inspected
before the drill-down; `s11-narrow-map.png` — 430×900, no horizontal overflow; `s9b-manual-drag.png`
— visibly confirms two things at once: `MathTools` sits offset from its row after a real pointer
drag, and the scope banner shows a genuine "12 added below" chip next to "Showing 50 of 74 in scope").
Full run (14 screenshots, both modes' complete reports, logs) in
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored).

### Post-review fixes (four-point follow-up)

A self-review pass after the initial implementation found four gaps between the claimed and actual
state, all fixed in the same session before this step was called done:

1. **The minimap went stale on a membership change.** `updateMap()` was wired to `'pan zoom position'`
   events and the ResizeObserver, but `cy.add({data, position})` emits none of those — so after a
   Show more or package add (which touch no camera) the minimap kept showing the pre-add bounding box
   until the user's next pan/zoom. Fixed by calling `updateMap()` (now held in a ref so the
   reconciliation effect can reach it) at the end of every `cy.batch()` reconciliation. Also guarded
   `updateMap()` against a truly empty core (`cy.elements().boundingBox()` on zero elements feeds
   `Infinity` into the SVG `viewBox`) by returning early until the first elements exist.
2. **Story 4's "N resources added below" feedback did not actually exist**, despite the ledger
   initially claiming it did (it conflated the pre-existing scope-count banner with genuine
   addition-placement feedback — those are different things). Added a real one: a quiet
   `{n} added below` chip in `.scope-banner-actions`, shown from `viewState.newlyAddedIds` whenever
   it is non-empty *and* there are survivors (so it never fires on an initial population, only a
   genuine append-below). The optional Appendix H2 camera-only "Show added" pan action remains
   deferred — that part of the original claim was accurate.
3. **Manual drag persistence was reducer-verified only, never gesture-verified.** Added two browser
   scenarios (`manual-drag-persists`, `manual-drag-persists-across-level-switch`) using a real CDP
   pointer drag (press, six `mouseMoved` steps while held, release) — not a synthetic `NODE_MOVED`
   dispatch. Confirms exactly one card moves, the camera is untouched, no arrangement command fires,
   and the new position survives switching to Packages and back to Classes.
4. **`python3 scripts/verify_hierarchical_pipeline.py` was skipped** on Step 2's rationale
   ("explanation harness untouched"), which stopped holding once `GraphCanvas.tsx` was rewritten end
   to end — it is the *only* harness that exercises `cxttap` remove-from-scope, READY sparkle/hover
   styling, and pan/zoom stability across an explanation refresh, none of which the stable-graph
   harness covers. Run (see below): **PASS**, confirming the rewrite did not regress any of those
   paths and closing the gate line "verify display-only data updates without claiming the offline
   runner executed model refresh" with genuine mock-provider evidence.

Baseline/acceptance were re-run after fixes 1–3 (18 scenarios now, up from 16); numbers below are
final. `docs/evidence/stable-graph-step3/` was refreshed with the new reports and the drag
screenshot.

### Pure tests

`node scripts/test-graph-placement.mjs` → **PASS, 8 checks** (Appendix A3 fixtures: no-survivors
origin placement, bottom+64 row start, strip-width wrapping, tallest-card row height, an oversized
card forcing its own row, `appendWidth` computed once and echoed back, name/ID batch sort order,
empty-addition no-op).

`node scripts/test-explorer-view-state.mjs` → **PASS, 34 checks** (21 original + 13 new): a
placement-bearing admission produces positions and flips `geometryInitialized`; an admission with no
`placement` record admits membership but leaves new IDs unpositioned (existing membership-only tests
keep working unmodified); a later addition places new cards below the current bounding box without
touching survivor positions; removal discards geometry for removed IDs and a later re-add lands at
the new bottom, not the old hole; `geometryRevision` only bumps when a position is actually written;
`geometryInitialized` is monotonic — an empty-scope transition does not clear it; `appendWidth` is
decided once and never recomputed; `SET_CAMERA` is a strict value-equality no-op on repeat and writes
to the `level` named in the action, not `activeLevel`; a `SET_CAMERA`/`NODE_MOVED` stamped with a
stale `generation` is dropped entirely; `NODE_MOVED` updates exactly the dragged card and is ignored
for an ID no longer displayed; `RESET` gives every level fresh geometry and bumps `generation`;
`NAVIGATE_BACK` preserves the destination level's camera/positions untouched.

`node scripts/test-graph-model.mjs` → **PASS, all 7 suites**, unchanged (Step 3 touched no
`graphModel.ts` code).

### Other checks

- `npx tsc -b --force` (frontend/) — 0 errors.
- `npm run build` (frontend/) — succeeds; existing >500 kB bundle advisory unchanged.
- `./gradlew bootJar --no-daemon` — BUILD SUCCESSFUL, rebuilt jar bundles the new frontend.
- `node --check scripts/verify-stable-graph-ui.mjs`, `git diff --check` — clean.
- `python3 scripts/verify_hierarchical_pipeline.py` — **PASS** (run despite Step 2's "explanation
  harness untouched" rationale, which no longer holds once `GraphCanvas.tsx` was rewritten end to
  end — see "Post-review fixes" above). 61 bulk CLASS/METHOD subjects explained via the local mock
  provider, `cxttap` remove-from-scope, READY sparkle/hover, and pan/zoom stability across an
  explanation refresh all still pass against the rewritten canvas.
- Not run: `./gradlew test` (no backend source changed).
- Not run: any lint pass. This repository has no lint tooling configured.

### Remaining known limitations (accurately not claimed fixed)

- **Double-click still does not do what Story 2 wants.** It now reliably *reaches* the target (Step
  3's fix), but it is still wired to `explore()` — the same command as View methods/View classes —
  so it causes an unwanted level change instead of a focused arrangement. Moving arrangement to a
  dedicated `ARRANGE_AROUND_RESOURCE` command with its own keyboard/touch equivalent is entirely
  Step 5's job; nothing in that area was touched beyond what incremental reconciliation required.
- **No focused/whole-map arrangement exists yet at all.** `graphLayout.ts` is untouched on disk,
  reserved for Step 5's Appendix B reuse; positions today only ever come from initial admission
  (Appendix A3 placement) or a manual drag.
- **`appendWidth` (6 typical cards) is a recorded, deliberate deviation from Appendix A3's literal
  "three"**, not a bug — see the "What changed" section above. Revisit with measured
  overlap/readability evidence if a future step's screenshots show it is still too narrow or too wide
  at package/method-level card sizes.
- **The generation guard on `SET_CAMERA`/`NODE_MOVED` is defensive, not race-tested.** It is covered
  by a direct pure-reducer check (stale generation is dropped), but no async/interleaved-dispatch
  race harness exists yet — that level of scrutiny belongs to Step 9A's worker/cancellation
  lifecycle, which owns request-identity staleness end-to-end.
- **The optional "Show added" camera-only pan action (Appendix H2) was not implemented.** The
  `{n} added below` feedback chip itself is real (added in the post-review follow-up); only the
  optional "pan the camera to what was just added" affordance is deferred, not attempted.
- **`geometryInitialized` is written and unit-tested but not yet read by any production caller.**
  `GraphCanvas` currently decides fit-vs-restore purely from `camera === null`, which is sufficient
  today because the two states move together in practice. The flag exists per Appendix F2's explicit
  request and is exposed for a future caller that needs to distinguish "membership initialized but no
  geometry yet" from "camera not yet captured" as genuinely separate conditions — Step 4 should not
  assume it currently gates anything on its own.
- `docs/BUILD_BRIEF.md` remains absent; `docs/BUILD.md` was read in its place, as in Steps 1–2.

## Per-Step Handoff Records

```text
Step and date: Step 1 — 2026-09-10
Acceptance criterion completed: The reported resets have reproducible browser evidence, and later
  sessions can test the same interactions against an isolated fixture. Every reported failure is
  reproduced, or precisely classified as not reproduced with an inspected alternative cause.
Files changed and important interfaces:
  - docs/evidence/stable-graph-step1/** (new) — durable copy of the baseline report and the four
    cited screenshots, because build/ is git-ignored.
  - test-fixtures/stable-graph-fixture/** (new) — 74 types across 6 packages, plus README.md
    documenting verified topology and parser limits.
  - scripts/verify_stable_graph_pipeline.py (new) — isolated jar + Chromium runner.
    `python3 scripts/verify_stable_graph_pipeline.py [baseline|acceptance]`.
  - scripts/verify-stable-graph-ui.mjs (new) — CDP scenarios. Reads a config JSON with
    {base, debug, fixture, output, mode}; writes stable-graph-report.json and PNGs to `output`.
  - docs/STABLE_GRAPH_IMPLEMENTATION.md (this ledger), PROJECT_STATUS.md, docs/TESTING.md.
  - No application source changed. `git diff --stat frontend/ src/` is empty.
Actual commands and outcomes:
  - node scripts/test-graph-model.mjs                                   -> PASS (7 suites)
  - node --check scripts/verify-stable-graph-ui.mjs                     -> ok
  - python3 -m py_compile scripts/verify_stable_graph_pipeline.py       -> ok
  - (frontend/) npx tsc -b --force                                      -> exit 0
  - (frontend/) npm run build                                           -> built in 1.08s, 44 modules
  - python3 scripts/verify_stable_graph_pipeline.py baseline            -> PASS, 15 scenarios,
    12 screenshots, fixture hashes identical before/after
  - python3 scripts/verify_stable_graph_pipeline.py acceptance          -> FAIL (expected), 34 unmet
    contract assertions across 13 scenarios
  - Skipped: ./gradlew test bootJar. No backend source changed and build/libs/
    code-atlas-0.1.0-SNAPSHOT.jar was already current; the baseline run used that jar.
  - Skipped: python3 scripts/verify_hierarchical_pipeline.py and the other explanation harnesses.
    Step 1 changes no application behaviour and those harnesses were not modified.
  - Not run: any lint pass. This repository has no lint tooling configured; no lint claim is made.
Browser scenarios and screenshots inspected: see the 15-scenario table and the screenshot list above.
  s2 and s6 were opened and read directly; the rest are on disk in the evidence directory.
Unresolved failures or limitations:
  - Explanation-refresh stability and the inspector-pane resize case are classified as not
    reproduced with inspected causes (see above), not as passing tests.
  - Unresolved-target relationships never reach the canvas, so no drawn-edge scenario can cover the
    UNRESOLVED resolution state; only CANDIDATE is drawable.
  - Pure layout fixtures (guaranteed crossing, collinear overlap, self-loop clearance, mixed card
    sizes) are deliberately absent — they belong to Step 6, separate from this source fixture.
  - The narrow-layout scenario only records horizontal overflow; narrow-pane return is Step 4's gate.
Processes started, ports, output directories, and whether stopped:
  - Per run: one `java -jar build/libs/code-atlas-0.1.0-SNAPSHOT.jar` on an ephemeral loopback port
    with `--codeatlas.data-dir` inside the run directory, and one headless Chromium with an
    ephemeral CDP port and a per-run `--user-data-dir`. Both are terminated in the runner's `finally`
    block; verified stopped after each run. Nothing is left listening.
  - Output: build/stable-graph/baseline-_q7q6egb/ (final baseline) and the acceptance run beside it.
    Earlier iteration directories from the same day remain under build/stable-graph/ and can be
    deleted; build/ is git-ignored, so the exit-gate evidence is also copied to
    docs/evidence/stable-graph-step1/.
    (report JSON, PNGs, application.log, chromium.log, isolated codeatlas.db).
  - Temporary fixture copies under /tmp are removed in the same `finally` block.
What the next session must read:
  - This ledger's trigger inventory and baseline table.
  - /home/sajjad/prompts/steps.md Step 2 and Appendices A and F.
  - /home/sajjad/prompts/product-design.md Stories 1, 4 and 5.
  - frontend/src/App.tsx (select/explore/openCodeMap/Back/level control/Show more),
    frontend/src/features/explorer/graphModel.ts projectGraph(), and scopeModel.ts.
  - docs/evidence/stable-graph-step1/baseline-report.json for exact before/after state (durable);
    build/stable-graph/baseline-*/ for a full run if it still exists.
Next step / precise remaining task: Step 2 — introduce the view-state module
  (frontend/src/features/explorer/explorerViewState.ts per Appendix F), remove the display-limit and
  level resets from every inspection path listed in the trigger inventory, and separate eligibility
  from displayed membership so projectGraph() stops re-selecting the page from degree rank on every
  render. Positions may still move until Step 3; record that as a remaining failure. Add
  scripts/test-explorer-view-state.mjs and re-run the baseline and acceptance modes, updating the
  baseline expectations that Step 2 legitimately turns green.
```

```text
Step and date: Step 2 — 2026-09-10
Acceptance criterion completed: Inspecting a class or edge cannot change scope, abstraction level,
  or the set/count of displayed resources. Verified by 17 pure reducer tests and, in the real
  packaged browser, every membership/level/scope acceptance assertion across all 15 scenarios now
  passes (26 of the original 34 unmet acceptance assertions remain, all exclusively position/camera
  (Step 3) or double-click gesture reachability (Step 5)).
Files changed and important interfaces:
  - frontend/src/features/explorer/explorerViewState.ts (new) — pure reducer: ExplorerViewState,
    ExplorerAction, explorerViewReducer, initExplorerViewState. Owns activeLevel, per-level
    LevelViewState (displayedIds/priorEligibleIds/initialized), inspectedSubjectId/inspectedKind,
    and Back history. No positions/camera yet (Step 3).
  - frontend/src/features/explorer/graphModel.ts — added getEligibleIds, rankEligibleIds,
    projectDisplayed, aggregateEdges; projectGraph rebuilt on top of them (same external contract,
    verified against the existing test suite unchanged).
  - frontend/src/App.tsx — node/edge/history/nodeLimit/level local state removed; derived from the
    reducer. select()/inspectEdge() are pure inspection dispatches. explore()/level
    control/openCodeMap()/Show more/Back dispatch NAVIGATE_LEVEL/SCOPE_UPDATED/SHOW_MORE/
    NAVIGATE_BACK. handleScopeChange() centralizes every scope mutation. New mapStatus derived
    value passed to InspectorPanel.
  - frontend/src/features/explorer/NavigationPane.tsx — onScopeChange gained an optional
    explicitClassAddId second argument (ClassRow's checkbox passes it only on an add).
  - frontend/src/features/inspector/InspectorPanel.tsx — new optional mapStatus prop renders
    "Outside current scope." / "In scope, not currently displayed."
  - scripts/test-explorer-view-state.mjs (new) — 17 pure transition tests.
  - scripts/verify-stable-graph-ui.mjs — added a reload() helper and used it before the three
    double-click sub-scenarios that need a guaranteed small starting page (re-selecting the active
    level is now a genuine no-op, so the old "re-click to shrink back to 12" trick no longer works);
    loosened the add-package precondition from an exact 36 to >= 12 (each package checkbox is now
    its own scope edit with its own bounded batch, so 4 individual checks can already exceed 36);
    retired 8 now-false baseline assertions across 4 scenarios, replacing each with the
    corresponding now-true statement (see the ledger table above) — never weakened acceptance.
  - docs/evidence/stable-graph-step2/** (new) — baseline-report.json, acceptance-report.json, and
    3 inspected screenshots.
  - docs/STABLE_GRAPH_IMPLEMENTATION.md (this ledger), PROJECT_STATUS.md, docs/TESTING.md.
  - GraphCanvas.tsx, graphLayout.ts, nodeCard.ts: untouched, as intended for this step.
Actual commands and outcomes:
  - node scripts/test-graph-model.mjs                                   -> PASS (7 suites, unchanged)
  - node scripts/test-explorer-view-state.mjs                           -> PASS (17 checks)
  - node --check scripts/verify-stable-graph-ui.mjs                     -> ok
  - (frontend/) npx tsc -b --force                                      -> exit 0
  - (frontend/) npm run build                                           -> built in ~1.1s, 45 modules
  - ./gradlew bootJar --no-daemon                                       -> BUILD SUCCESSFUL (rebuilt
    jar with the new frontend, required before re-running the browser pipeline)
  - python3 scripts/verify_stable_graph_pipeline.py baseline            -> PASS, 15 scenarios,
    12 screenshots, fixture hashes identical before/after (first attempt crashed on a stale
    precondition in the add-package scenario — see verify-stable-graph-ui.mjs changes above — fixed
    before this passing run)
  - python3 scripts/verify_stable_graph_pipeline.py acceptance          -> FAIL (expected), 26 unmet
    contract assertions across 10 scenarios (down from 34 across 13 in Step 1); every remaining
    failure is position/camera/canvas-identity (Step 3) or double-click gesture reachability
    (Step 5) — zero remaining membership/level/scope failures.
  - git diff --check                                                    -> clean
  - Skipped: ./gradlew test. No backend source changed.
  - Skipped: python3 scripts/verify_hierarchical_pipeline.py and other explanation harnesses. Only
    App.tsx's onInspectEdge/onClose call sites changed (still call the same InspectorPanel
    contract); no explanation code path touched.
  - Not run: any lint pass. This repository has no lint tooling configured; no lint claim is made.
Browser scenarios and screenshots inspected: all 15 scenarios' JSON deltas read directly (see the
  ledger tables above); s2-reveal-36-then-click.png and s6-add-package.png opened and visually
  confirmed (banner text "Showing 36 of 74 in scope · show 12 more" and "Showing 50 of 64 in scope
  · show 12 more" respectively, with the full class grid present in each — not collapsed).
  s7-remove-package.png is on disk in the evidence directory (not separately opened).
Unresolved failures or limitations: see "Remaining known limitations" above. In summary: positions
  and camera still move on every interaction (Step 3); canvas is now stable for pure inspection but
  still recreated on scope/filter changes (Step 3); double-click still cannot reach a node reliably,
  though it no longer also destroys the canvas at an expanded page (Step 5); openCodeMap() and the
  level segmented control still unconditionally clear inspection on a real navigation (Step 4);
  an inspected edge does not survive a filter change that excludes its kind (unaffected either way).
Processes started, ports, output directories, and whether stopped:
  - Per run: one packaged jar on an ephemeral loopback port and one headless Chromium with an
    ephemeral CDP port and a per-run --user-data-dir, both terminated in the runner's finally block;
    verified stopped after each run. Nothing left listening.
  - Output: build/stable-graph/baseline-x09iy68i/ (final baseline) and
    build/stable-graph/acceptance-ps9gjkrb/ (final acceptance); several earlier iteration
    directories from this session remain under build/stable-graph/ and can be deleted. build/ is
    git-ignored, so the exit-gate evidence is duplicated under docs/evidence/stable-graph-step2/.
  - Temporary fixture copies under /tmp removed in the same finally block.
What the next session must read:
  - This ledger's Step 2 section (design decisions, baseline retirement table, remaining
    limitations) and docs/evidence/stable-graph-step2/*-report.json for exact before/after state.
  - /home/sajjad/prompts/steps.md Step 3 and Appendix A (A3 coordinate placement specifically).
  - frontend/src/features/explorer/explorerViewState.ts (the exact LevelViewState/ExplorerAction
    shape to extend with positions/camera/geometryRevision — do not redesign it from scratch) and
    frontend/src/features/explorer/GraphCanvas.tsx (every layout/fit/center/create call site, all
    still exactly as inventoried in Step 1).
Next step / precise remaining task: Step 3 — make GraphCanvas create Cytoscape once per mounted
  canvas and reconcile elements by stable ID in a batch (remove absent, add new with positions,
  update survivor data) instead of recreating on every topology change; eliminate layout/fit/center
  calls from selection, scope, filter, and resize; extend explorerViewState's LevelViewState with
  positions/camera/geometryRevision per Appendix A3, and implement the append-below-existing-bounds
  placement algorithm for newly admitted IDs (the reducer currently admits membership correctly but
  computes no coordinates for the new arrivals). Re-run the baseline/acceptance browser pipeline
  again afterward and retire the position/camera-related baseline assertions that Step 3 fixes,
  the same way this step retired the membership ones.
```

```text
Step and date: Step 3 — 2026-09-10
Acceptance criterion completed: Non-arrangement interactions preserve surviving node positions, pan,
  and zoom. Verified by 8 new pure placement checks, 13 new pure reducer geometry/camera checks (34
  total), and, in the real packaged browser, 15 of 18 acceptance scenarios pass outright (including
  two real-pointer manual-drag scenarios added in a post-review follow-up) — every
  stable-position/stable-camera/canvas-identity scenario. The remaining 3 (real double-click) are
  explicitly owned by Step 5, not this step: the gesture now reaches the target reliably (Step 3's
  own fix), but it is still wired to explore() rather than a dedicated arrangement command. A
  self-review pass also caught and fixed a stale minimap, a missing addition-feedback indicator, and
  an incorrectly-skipped hierarchical-explanation harness run (all detailed below).
Files changed and important interfaces:
  - frontend/src/features/explorer/graphPlacement.ts (new) — placeAdditions(survivorBounds,
    additions, storedAppendWidth): Appendix A3 append-below-bounding-box placement. Pure, no
    imports.
  - frontend/src/features/explorer/explorerViewState.ts — LevelViewState extended with positions,
    camera, geometryRevision, cameraRevision, geometryInitialized, appendWidth; root state gained
    generation. NAVIGATE_LEVEL/SCOPE_UPDATED/SHOW_MORE/RESET gained an optional `placement` field
    (actual dimensions per eligible ID); two new actions SET_CAMERA and NODE_MOVED. All 21 existing
    Step 2 checks pass unmodified.
  - frontend/src/features/explorer/GraphCanvas.tsx — rewritten: one Cytoscape core per mount, never
    destroyed on nodes/edges change; incremental cy.batch() reconciliation by stable ID (now also
    calling updateMap() at the end of the batch so the minimap reflects membership changes, not only
    camera changes); zero cy.layout() calls; cy.fit() only on a level's first-ever visit
    (camera === null) or the explicit Fit map button; debounced real-camera capture with a
    programmatic-write guard; new .neighbor/.inspected emphasis classes; dragfree reports manual
    moves via onNodeMoved.
  - frontend/src/App.tsx — placementFor(ids) helper; handleCameraChange/handleNodeMoved; positions/
    camera read from viewState.levelViews[level] and passed to GraphCanvas; placement supplied on
    every membership-admitting dispatch; a genuine "{n} added below" chip in scope-banner-actions.
  - frontend/src/styles/App.css — .added-below-chip rule for the new indicator.
  - scripts/test-graph-placement.mjs (new) — 8 pure placement checks.
  - scripts/test-explorer-view-state.mjs — 13 new geometry/camera checks appended (34 total).
  - scripts/verify-stable-graph-ui.mjs — added pickVisibleNodeId()/visibleEdgeCandidates() (harness
    fix for off-screen click targets, not an application defect); retired every baseline assertion
    the fix falsified across S1-S9 and two-spaced-single-clicks, with now-true replacements; rewrote
    the three real-double-click baseline blocks to describe the new (still Step-5-owned) finding;
    added two S9b manual-drag scenarios using real CDP pointer drag.
  - docs/evidence/stable-graph-step3/** (new) — baseline-report.json, acceptance-report.json, 7
    inspected screenshots.
  - docs/STABLE_GRAPH_IMPLEMENTATION.md (this ledger), PROJECT_STATUS.md, docs/TESTING.md.
  - graphLayout.ts, nodeCard.ts: untouched (nodeCard usage unchanged; graphLayout reserved for
    Step 5's Appendix B reuse), except GraphCanvas.tsx no longer imports graphLayout at all.
Actual commands and outcomes:
  - node scripts/test-graph-model.mjs                                   -> PASS (7 suites, unchanged)
  - node scripts/test-explorer-view-state.mjs                           -> PASS (34 checks)
  - node scripts/test-graph-placement.mjs                               -> PASS (8 checks)
  - node --check scripts/verify-stable-graph-ui.mjs                     -> ok
  - (frontend/) npx tsc -b --force                                      -> exit 0
  - (frontend/) npm run build                                           -> built, 45 modules
  - ./gradlew bootJar --no-daemon (then --rerun-tasks once, to double-check a suspiciously
    UP-TO-DATE copyFrontend after an out-of-band `npm run build`; confirmed both runs actually
    packaged the current dist -- the jar path is `BOOT-INF/classes/static/...`, not `static/...`,
    which was the actual source of the false alarm) -> BUILD SUCCESSFUL both times
  - python3 scripts/verify_stable_graph_pipeline.py baseline            -> PASS, 18 scenarios,
    14 screenshots, fixture hashes identical before/after
  - python3 scripts/verify_stable_graph_pipeline.py acceptance          -> FAIL (expected), 7 unmet
    contract assertions, all in the 3 real-double-click scenarios explicitly owned by Step 5 (down
    from 26 unmet across 10 scenarios after Step 2)
  - python3 scripts/verify_hierarchical_pipeline.py                    -> PASS (see "Post-review
    fixes" above for why this was run despite Step 2's now-stale skip rationale)
  - git diff --check                                                    -> clean
  - Skipped: ./gradlew test. No backend source changed.
  - Not run: any lint pass. This repository has no lint tooling configured.
Browser scenarios and screenshots inspected: all 18 stable-graph scenarios' JSON deltas read
  directly; seven screenshots opened and visually confirmed (see the ledger's Step 3 Acceptance
  section above for what each shows) — selection emphasis (.selected fill + .neighbor outline),
  36-card stability, the filter-change scenario's correct "nothing selected" state for an
  out-of-map inspected relationship, append-below placement with camera untouched and a genuine
  "12 added below" chip, a real pointer drag visibly offsetting one card, the expected Methods
  drill-down regression with a correct out-of-scope inspector notice, and a clean narrow 430x900
  layout. Two hierarchical-pipeline screenshots (class-ready.png, scope-context-menu.png) also
  opened and confirmed READY sparkle badges and the context-menu remove-from-scope action both
  still render correctly against the rewritten canvas. The remaining screenshots from both harnesses
  are on disk (docs/evidence/stable-graph-step3/, build/stable-graph/, build/hierarchy-smoke/) but
  not separately opened.
Unresolved failures or limitations: see "Remaining known limitations" above. In summary: double-click
  still does not implement Story 2's focused arrangement (Step 5); no focused/whole-map arrangement
  exists yet; appendWidth uses 6 typical cards rather than Appendix A3's literal 3 (recorded
  deviation, not a defect); the generation staleness guard is unit-tested but not race-tested (Step
  9A's territory); the optional Show-added camera-*pan* affordance (Appendix H2) remains deferred
  (the feedback chip itself is now real); geometryInitialized is written/tested but not yet read by
  any production caller.
Processes started, ports, output directories, and whether stopped:
  - Per run: one packaged jar on an ephemeral loopback port and one headless Chromium with an
    ephemeral CDP port and a per-run --user-data-dir, both terminated in the runner's finally block;
    verified stopped after each run. Nothing left listening.
  - Output: build/stable-graph/baseline-k54_yrbv/ (final baseline) and
    build/stable-graph/acceptance-fw8xto1t/ (final acceptance); build/hierarchy-smoke/run-veep4qtj/
    (hierarchical pipeline); earlier iteration directories from this session remain under
    build/stable-graph/ and can be deleted. build/ is git-ignored, so the
    exit-gate evidence is duplicated under docs/evidence/stable-graph-step3/.
  - Temporary fixture copies under /tmp removed in the same finally block.
What the next session must read:
  - This ledger's Step 3 section (design decisions — the placement-in-the-same-dispatch choice over
    a COMMIT_GEOMETRY action, the 6-card appendWidth deviation, the camera restore/one-time-fit
    split, the generation guard) and docs/evidence/stable-graph-step3/*-report.json.
  - /home/sajjad/prompts/steps.md Step 4 and Appendix A (F3 history extension specifically),
    /home/sajjad/prompts/product-design.md Story 6.
  - frontend/src/features/explorer/explorerViewState.ts's exact HistoryEntry/NAVIGATE_BACK shape to
    extend (view/filter/camera references and geometry revisions per F3 — do not redesign it) and
    frontend/src/App.tsx's explore()/openCodeMap()/Back/level-control call sites (all still exactly
    as inventoried: openCodeMap() unconditionally resets to Packages and clears inspection even when
    already there; the level control clears inspection on every genuine switch).
Next step / precise remaining task: Step 4 — separate class inspection, View methods/View classes,
  and Back into named navigation commands; cache each level's displayed IDs/coordinates/viewport by
  workspace/snapshot/level (mostly already true via levelViews, but Back must gain the F3 precedence
  rules: current scope > current admissions/latest geometry revision > saved historical
  inspection/level/filter/camera); verify A-to-B-to-C traversal and out-of-scope inspection with the
  real inspector; make openCodeMap()/level-control preserve inspection and the last map view per
  Story 6. Do not touch the double-click gesture (Step 5) or attempt arrangement (Steps 5-9).
```

---

## Step 4 — Make class traversal and return navigation predictable

### What changed

- **`explorerViewState.ts`** extended, not replaced. `HistoryEntry` gained `geometryRevision`
  (recorded from `state.levelViews[state.activeLevel].geometryRevision` at push time via a new
  shared `currentEntry()` helper, used by both `inspect()` and `CLEAR_INSPECTION`). This is
  deliberately inert in production: Back was already correct by construction (it reads a level's
  *live* `positions`/`camera`, never a stored snapshot, so it can never regress to an older
  geometry revision) — the field exists only so a transition test can assert that precedence
  explicitly instead of it being true "because nothing writes it wrong."
- **`SCOPE_UPDATED` gained an optional `otherLevels: Partial<Record<Level, string[]>>`** (Appendix
  F3). A scope edit changes eligibility for every level at once, not just the one on screen; without
  this, an inactive level's cached `displayedIds` only gets reconciled the next time it is actually
  visited, and by then a "removed then re-added" sequence is indistinguishable from "never left"
  (both leave the ID still eligible and still in `displayedIds`). New pure helper `shadowTrimLevel()`
  fixes this: for each named inactive level, drop now-ineligible survivors immediately (never
  deferred) and forget them from `priorEligibleIds` too, so a later re-add reads as genuinely new
  once that level is finally reconciled. It never admits anything itself (that stays deferred to an
  actual visit or Show more, exactly as before) and never calls `reconcileLevelView` — that path
  overwrites `priorEligibleIds` with the *full* eligible set and would erase the very distinction
  this exists to preserve. `membershipRevision` now also bumps when only an inactive level changed,
  even if the active level's own reconciliation was a no-op. Positions dropped by the trim do not
  bump `geometryRevision` (only a newly *placed* position does — matching `reconcileLevelView`'s
  existing rule for removals).
- 7 new pure reducer tests: remove-then-re-add while inactive (appends fresh, not into the old
  slot); an explicit class add while viewing a different level (true no-op by reference for the
  inactive view; admitted as newly eligible on the actual next visit); `membershipRevision` bumping
  from an inactive-level-only change; `shadowTrimLevel` as a true no-op on a never-visited level;
  the `geometryRevision`-at-push-time recording; Back never rewinding a level's geometry to that
  recorded value (a later drag survives Back); and the highest-value case from review — an addition
  made while away is NOT revealed by Back (`batchSize: 0`, unchanged), remains truthfully pending,
  and Show more afterward reveals both the originally-pending and the while-away addition. All 34
  existing Step 2/3 checks pass unmodified (41 total via `node scripts/test-explorer-view-state.mjs`).
- **`App.tsx`**: `explore()` split into two named commands per Story 6/H3 — `viewClasses(n)` and
  `viewMethods(n)` (both still dispatch `INSPECT_NODE` then `NAVIGATE_LEVEL`, unchanged from
  `explore()`'s prior behavior; only the naming and call sites changed). `openCodeMap()` no longer
  forces `NAVIGATE_LEVEL` to PACKAGE or `CLEAR_INSPECTION` — persisted view state already **is**
  "the last map view" regardless of which tab is showing, so it is now exactly `setTab('map');
  setMobilePane('map')`. The Classes/Methods/Packages segmented control's `onClick` no longer
  dispatches `CLEAR_INSPECTION` on a genuine switch (re-selecting the active level was already a
  no-op via the pre-existing `if(l===level)return;` guard). `handleScopeChange()` now also computes
  `otherLevels` — using `getEligibleIds` directly (not `rankEligibleIds`), since the reducer only
  does `Set` membership tests on it and paying for a rank nobody reads would be wasted work on a
  real repository's METHOD level. A new `allKindsEdges` memo (a second `projectDisplayed(...,
  'ALL')` projection of the same displayed page) lets the inspected `edge` fall back past the
  currently-filtered `projected.edges` when the active relationship filter excludes its kind —
  verified safe against `graphModel.ts`'s actual `aggregateEdges()`: the aggregate ID key is
  `[source, target]` — endpoints only, with neither kind nor resolution in it — so the filter can
  only thin or remove a line, never rename it, and the same relationship has the identical ID in
  both projections. A new
  `edgeFilteredOut` boolean (true only when the edge resolves via `allKindsEdges` but not
  `projected.edges`, and is not an unresolved relationship) drives a "Not shown with the current
  relationship filter." notice instead of the inspector silently going idle.
- **`GraphCanvas.tsx`**: removed `onExplore` from `Props` entirely and deleted the
  `cy.on('dbltap', 'node', ...)` handler that called it (Step 4 point 1: "graph double-click must
  not remain the drill-down command; it will be wired to arrangement in Step 5"). A node
  double-click is now a genuine no-op at the application level — Cytoscape's own `dbltap` event
  still fires (verified: the browser test's independent probe listener still reports `dbltaps: 1`),
  only the application's response to it was removed.
- **`NavigationPane.tsx`** / **`InspectorPanel.tsx`**: `onExplore` replaced by `onViewClasses`/
  `onViewMethods` at every call site — `PackageRow`'s ⌖ button and the inspector's package-section
  button, relabeled "Explore classes ↗" → "View classes ↗" (always a package → `onViewClasses`),
  `ClassRow`'s ⌖ button and the inspector's methods-section button, relabeled "See method call
  graph ↗" → "View methods ↗" (always a class → `onViewMethods`) — Story 6/H3 names these actions
  "View methods"/"View classes" explicitly, and the exit gate calls for inspecting screenshots of
  changed navigation labels. `InspectorPanel` gained `edgeFilteredOut` and its notice, rendered
  alongside the existing `mapStatus` node notices.
- Entry-points route cards now pick `viewClasses`/`viewMethods` by `handler.kind` (replicating
  `explore()`'s prior generic branch at that one remaining call site).

### Browser coverage added/changed (`scripts/verify-stable-graph-ui.mjs`)

- **S5b** (new) — inspect an edge, change the filter to exclude its kind: inspector stays open with
  the new notice instead of collapsing to idle. Regression guard for the exact defect Step 3's
  ledger had recorded as "correct" (it was actually the F3 gap this step closes).
- **S10 baseline retirement** — the three real-double-click scenarios (`-at-12-human-paced`,
  `-at-12-fast`, `-at-36`) previously asserted "drills down to Methods … Step 5's job." That
  assertion is now false (there is no drill-down left to describe): replaced with "double-click no
  longer drills into Methods — Step 4 disconnected it from `explore()`; no arrangement exists yet
  either (Step 5's job)," asserting `levelAfter === levelBefore` / `countAfter === countBefore`.
  Their `acceptance` checks were already forward-looking (`layoutCalls === 1`) and needed no edit —
  they still correctly fail, now for exactly one remaining reason instead of two.
- **S12** (new) — A→B→C→Back→Back through the *real* inspector "Depends on" list (not canvas
  clicks), seeded via search at `OrderController` and following the fixture's documented
  `OrderController → OrderService → PricingService` chain. Asserts the subject changes at each hop,
  Back restores exactly the prior subject (`===`, not a substring match), and zero layout/movement
  throughout.
- **S13** (new) — Classes→Methods→Classes preserves the inspected subject (through the level
  switch, not just around it) and the Classes page's exact positions/camera.
- **S14** (new) — inspecting an out-of-scope resource (search hit outside a narrowed single-package
  scope) shows "Outside current scope." without touching scope, level, membership, or camera.
- **S15** (new) — the F3 shadow-trim behavior end-to-end: remove a displayed class from scope while
  viewing Methods, re-add it while still away, return to Classes. Asserts the exact resulting ID
  order (`[...survivors, targetId]`, not just a count), every survivor's byte-identical position,
  and a demonstrably fresh (not restored) position for the re-added class.
- **S16** (new) — narrow-screen (430×900) inspect → details pane → back to map pane preserves exact
  camera/positions, and does not trip `GraphCanvas`'s `ResizeObserver` guard over the map pane's
  zero-size container while details are showing.
- **S17** (new) — the "Code map" nav item returns to the last map view (level, inspection, geometry
  all preserved) after fully unmounting/remounting `GraphCanvas` via an intervening Entry-points tab
  visit — proving the restore comes from persisted `viewState`, not canvas-instance survival.

### Actual commands and outcomes

- `node scripts/test-explorer-view-state.mjs` → PASS (41 checks, 7 new)
- `node scripts/test-graph-model.mjs` → PASS (7 suites, unchanged)
- `node scripts/test-graph-placement.mjs` → PASS (8 checks, unchanged)
- `node --check scripts/verify-stable-graph-ui.mjs` → ok
- (`frontend/`) `npx tsc -b --force` → exit 0
- (`frontend/`) `npm run build` → built, 45 modules
- `./gradlew bootJar --no-daemon` → BUILD SUCCESSFUL
- `python3 scripts/verify_stable_graph_pipeline.py baseline` → PASS, **27** scenarios (9 new), 22
  screenshots, fixture hashes identical before/after
- `python3 scripts/verify_stable_graph_pipeline.py acceptance` → FAIL (expected), **3** unmet
  assertions ("exactly one arrangement"), all in the same 3 real-double-click scenarios explicitly
  owned by Step 5 — down from 7 unmet across 3 scenarios after Step 3. Every membership/level/scope/
  inspection/history/geometry assertion across all 27 scenarios now passes.
- `git diff --check` → clean
- Skipped: `./gradlew test` (no backend source changed); `verify_hierarchical_pipeline.py` (only
  `App.tsx` navigation/edge-lookup call sites changed, still calling the same `InspectorPanel`
  contract Step 3 already re-verified this harness against — no explanation code path touched).
- Not run: any lint pass. This repository has no lint tooling configured.

### Browser scenarios and screenshots inspected

All 27 stable-graph scenarios' JSON deltas read directly from both reports. Screenshots opened and
visually confirmed: `s12b-back-to-a.png` (breadcrumb "Whole system / Classes / OrderController",
inspector showing "In scope, not currently displayed." and an enabled "← Back"); `s13-classes-
methods-classes.png` (`CatalogService` still selected — outline + `.neighbor` emphasis — after the
Classes→Methods→Classes round trip); `s14-out-of-scope-inspection.png` (`ExternalPaymentGateway`
inspected with "Outside current scope." while the tree shows only `domain` checked); `s5b-edge-
survives-filter.png` (a `UserService → CustomerRepository` relationship inspector open with "Not
shown with the current relationship filter." while the toolbar filter reads "depends on");
`s15-scope-edit-while-away.png` (scope banner's "1 added below" chip, tree showing the reconciled
5-package/24-class scope); `s17-code-map-returns-to-last-view.png` (`ShipmentService` still
selected, breadcrumb still "Whole system / Classes / ShipmentService" — not reset to Packages —
after a full Entry-points-tab round trip). `s10b-double-click-at-36.png` and the remaining 16
screenshots are on disk (`docs/evidence/stable-graph-step4/`, `build/stable-graph/`) but not
separately opened.

### Unresolved failures or limitations

Canvas double-click and an inspector "Arrange around this resource" action do not exist yet — the
gesture is now a true no-op, correctly reflecting that no arrangement command has been built (Step
5). `HistoryEntry.geometryRevision` is recorded and tested but has no other production reader; Back's
actual precedence guarantee comes from always reading a level's live state, never a stored snapshot,
not from comparing this number anywhere. The relationship filter (`kind`) remains one global
selection rather than a per-level one — this was not extended, since Story 6/F3 only require the
*current* filter to survive navigation, and it already did structurally (no reducer action touches
it). `appendWidth`'s 6-typical-card deviation from Appendix A3 (recorded in Step 3) is unchanged.
With `openCodeMap()` reduced to a tab switch, the breadcrumb's scope-crumb button (`<button
onClick={openCodeMap}>{scopeCrumb}</button>`) is now a no-op whenever the map tab is already
showing — the correct trade for Story 6's "Code map returns to the last map view," but an
intentional behavior change with no explicit assertion behind it. The inspector's "View methods ↗"
button (renamed from "See method call graph ↗") is still gated on `methods.length > 0` (pre-existing,
unchanged by this step): a class with no parsed methods has no inspector path to Methods level at
all, only the segmented control or the tree's ⌖ button.

### Processes started, ports, output directories, and whether stopped

Per run: one packaged jar on an ephemeral loopback port and one headless Chromium with an ephemeral
CDP port and a per-run `--user-data-dir`, both terminated in the runner's `finally` block; verified
stopped after each run. Output: `build/stable-graph/baseline-cmg9pdwc/` (final baseline) and
`build/stable-graph/acceptance-u5hj7stm/` (final acceptance) — the final run, after a post-review
pass relabeled the inspector's drill-down buttons ("Explore classes ↗"/"See method call graph ↗" →
"View classes ↗"/"View methods ↗", per Story 6/H3's named-command wording), fixed S5b's
edge-detection precondition (it could start already inspecting S4b's leftover unresolved edge), and
gated the `allKindsEdges` fallback projection behind "an edge is inspected and not already found",
rather than recomputing it on every graph/level/displayedIds change; earlier iteration directories from
this session remain under `build/stable-graph/` and can be deleted. `build/` is git-ignored, so the
exit-gate evidence is duplicated under `docs/evidence/stable-graph-step4/`.

### What the next session must read

- This ledger's Step 4 section (the `otherLevels`/`shadowTrimLevel` design, why `geometryRevision`
  on `HistoryEntry` is inert-by-design, the `allKindsEdges` edge-survival fix) and
  `docs/evidence/stable-graph-step4/*-report.json` for exact before/after state.
- `/home/sajjad/prompts/steps.md` Step 5 and Appendix B (focused arrangement algorithm).
- `frontend/src/features/explorer/GraphCanvas.tsx`'s `dragfree`/`tap` handlers (the exact spot the
  new `dbltap` → `ARRANGE_AROUND_RESOURCE` wiring goes) and `frontend/src/features/explorer/
  graphLayout.ts` (reserved for Appendix B reuse since Step 3, still otherwise unused by
  `GraphCanvas.tsx`).

### Next step / precise remaining task

Step 5 — create an explicit `ARRANGE_AROUND_RESOURCE(id)` command distinct from inspection and level
navigation; wire it to canvas double-click and a keyboard/touch-accessible "Arrange around this
resource" inspector action; implement the incoming-left/focus-middle/outgoing-right/unrelated-below
grouping and spacing from Appendix B; anchor the focus at its prior model coordinate and translate
the rest by the resulting delta; preserve scope/level/filter/page. This is expected to satisfy the 3
remaining acceptance failures ("exactly one arrangement") left after this step. Do not implement
whole-map optimization (Steps 6-9).

---

## Step 5 — Move focused arrangement to double-click

### What changed

- **`frontend/src/features/explorer/focusedArrangement.ts`** — renamed from `graphLayout.ts`, which
  Step 3 explicitly reserved on disk for this exact reuse ("otherwise unused by `GraphCanvas.tsx`").
  The renamed module keeps only the Appendix B focused branch, rewritten to use actual card
  rectangles and gaps instead of the old uniform point spacing (`dx`/`dy` constants keyed off
  `focused?.kind`): `arrangeAroundResource(cards, edges, focusId, anchor)` computes
  incoming-left/focus-middle/outgoing-right column positions (half-width + 96-unit gap per side,
  48-unit-gap height-aware vertical stacking within a column) and delegates the unrelated-below
  group to `graphPlacement.placeAdditions()` rather than writing a second row-packing
  implementation — its `ROW_TOP_GAP` is exactly Appendix B's "64 units below the maximum bottom of
  the three columns." The old unfocused whole-map grid branch (`columns = ceil(sqrt(n*1.2))`) was
  deleted entirely: nothing calls it anymore now that arrangement is exclusively a deliberate,
  focus-anchored command, and Step 5 explicitly excludes whole-map optimization. Returns `null` when
  `focusId` is not among the given cards, which both call sites (below) use as the disabled-state
  signal. Pure — no React/Cytoscape/DOM imports — same as `graphPlacement.ts`.
- **`frontend/src/features/explorer/explorerViewState.ts`** extended, not replaced: new
  `ARRANGE_AROUND_RESOURCE` action carries `level`, a `positions` record for exactly the currently
  displayed cards, and `generation`. The reducer case merges `positions` into that level's stored
  positions (`{...view.positions, ...action.positions}` — an ID not present in the arrangement
  result, which should not normally happen since the caller always covers every displayed card, is
  left untouched rather than dropped) and bumps `geometryRevision` **once** per dispatch, not once
  per repositioned card — matching Appendix E's "apply positions atomically." Guarded by the
  existing `generation` staleness check, exactly like `SET_CAMERA`/`NODE_MOVED`, so a late result
  computed before a snapshot `RESET` cannot land in the new snapshot's just-cleared geometry.
- **`frontend/src/features/explorer/GraphCanvas.tsx`**:
  1. New `onArrangeAroundResource: (id: string) => void` prop, invoked from a new
     `cy.on('dbltap', 'node', ...)` handler — Cytoscape's own double-tap gesture recognition (H4).
     The existing `cy.on('tap', 'node', ...)` handler is untouched: the first tap of a double-click
     still only inspects, and inspection has been idempotent since Step 2 (re-inspecting the same
     subject/kind is a same-reference no-op), so it cannot itself move a card, change level, or
     unmount the canvas — satisfying "its first tap can inspect immediately, but cannot unmount the
     target canvas or switch the level" without any debounce/delay on ordinary single clicks.
  2. The reconciliation effect (`[nodes, edges, positions]`) gained the one new case where an
     **already-displayed** survivor's position is deliberately rewritten: for an existing element,
     if its live Cytoscape position differs from the incoming `positions[id]`, `existing.position(pos)`
     is called. Before this step that branch only ever called `.data()` — survivor positions were
     never touched by reconciliation, only by `cy.add()` for a brand-new element or by `dragfree`
     (Step 3's explicit "never rewrites a survivor's position" invariant). That invariant still holds
     for every *other* action: an ordinary admission's `positions` prop only ever adds fresh entries
     for newly admitted IDs (Appendix A3 `placeAdditions`), and `NODE_MOVED`'s dispatched position
     already equals what the live drag already wrote into Cytoscape, so the diff is always zero and
     this branch is a no-op for both those paths. Only `ARRANGE_AROUND_RESOURCE`'s bulk position
     merge ever produces survivors whose stored value genuinely differs from the live canvas, so this
     is the one and only case that actually exercises the new branch.
  3. A `let arranged = false` flag set inside the batch when any such reposition actually happens,
     and `if (arranged) cy.emit('arranged')` immediately after the batch closes. This is an ordinary
     custom Cytoscape event — the same pub/sub mechanism `'dbltap'`/`'pan'`/`'zoom'` already use, not
     a debug object — that lets the browser harness observe "did an arrangement actually reach the
     canvas" as a signal independent of `dbltaps` (needed because the inspector action reaches
     `ARRANGE_AROUND_RESOURCE` without ever firing a `dbltap`). Because it is diff-based, a repeat
     arrangement of an already-arranged, unmoved focus correctly does **not** re-fire it — see
     "Remaining known limitations" below.
- **`frontend/src/App.tsx`**: new `arrangeAround(id)` builds `ArrangeCard[]`/`ArrangeEdge[]` from
  `projected.nodes`/`projected.edges` (the current displayed page and current relationship filter —
  never `graph` directly, satisfying "Use current displayed IDs and filtered edges, not the full
  backend graph"), reads the anchor from `levelGeometry.positions[id]`, calls
  `arrangeAroundResource(...)`, and — only if it returns non-null — dispatches
  `ARRANGE_AROUND_RESOURCE` with the current `level`/`generation`. Wired to both `GraphCanvas`'s
  `onArrangeAroundResource` prop and a new `InspectorPanel` `onArrangeAroundResource` prop
  (`n => arrangeAround(n.id)`).
- **`frontend/src/features/inspector/InspectorPanel.tsx`**: new `onArrangeAroundResource` prop and a
  `.full-width.arrange-action` button ("☵ Arrange around this resource") rendered for any inspected
  `node` (package, class, method, or constructor — the algorithm and this button are both
  kind-agnostic), positioned right after the existing map-status/filter notices per the H3
  wireframe. `disabled={mapStatus !== 'DISPLAYED'}` with `title="Resource is not in current map
  view"` when disabled, reusing the exact `mapStatus` value Step 2/4 already compute and pass down —
  no new state needed to know whether a subject is currently on the displayed page.

### Baseline — the three "no arrangement exists yet" assertions retired, re-verified as PASS

`python3 scripts/verify_stable_graph_pipeline.py baseline` → **PASS**, 32 scenarios (5 new: a second
double-click on a different card, the two desktop inspector-action scenarios, and the two narrow-
layout scenarios below). The three real-double-click
scenarios' baseline blocks were rewritten the same way Steps 2-4 retired assertions their own fixes
falsified: "no arrangement exists yet either (Step 5's job)" is no longer true, replaced with
"double-click now drives exactly one focused arrangement (Step 5)" plus a new anchor-preservation
check (`targetLeftPointerBy <= 1` rendered pixel, proving the focus's screen position survived the
arrangement under an unchanged camera).

### Acceptance — 3 → **0** unmet assertions: the first fully green `acceptance` run since Step 1

`python3 scripts/verify_stable_graph_pipeline.py acceptance` → **PASS**, 32/32 scenarios, **zero**
unmet assertions. This closes the acceptance contract for every stable-map story except whole-map
optimization (Steps 6-9), which was never in scope for R6's first five stories.

The three real-double-click scenarios (`real-double-click-at-12-human-paced`,
`real-double-click-at-12-fast`, `real-double-click-at-36`) each now assert `arrangeCalls === 1`
instead of the previously-forward-looking `layoutCalls === 1`, which every prior step's ledger had
already flagged as a fossil that could never be satisfied (nothing in the codebase calls
`cy.layout()` anymore — Step 3 removed the last call site). `arrangeCalls` reads a new `arranges`
counter fed by the `'arranged'` Cytoscape event described above.

One case is deliberately **not** asserted to increment `arrangeCalls`: a second, immediate
double-click on the *same*, already-arranged focus. The algorithm is deterministic and the
translation anchors the focus to its own current (unchanged) position, so re-running it recomputes
byte-for-byte identical positions for every card — correctly moving nothing. Asserting
`arrangeCalls === 1` there would have been wrong; the harness instead uses
`real-double-click-second-different-card` (a fresh focus, guaranteed distinct via an explicit
`n.id() !== target` filter rather than a positional index that could coincidentally still resolve to
the same card after the map reshuffled) to prove the command still fires on a genuinely new
interaction. `two-spaced-single-clicks` gained an explicit `arrangeCalls === 0` assertion alongside
the existing `dbltaps === 0`, making both halves of the exit gate's "two spaced single-clicks cause
zero arrangements; a double-click causes exactly one" independently checked rather than one being
implied by the other.

Two new scenarios cover the inspector's keyboard/touch-accessible equivalent end to end on desktop
(H3): `inspector-arrange-around-resource` opens the inspector on a displayed class via one real
single click (never a double-click), clicks `.arrange-action`, and asserts exactly one arrangement
with `dbltaps === 0` (proving the two entry points reach `ARRANGE_AROUND_RESOURCE` independently) and
scope/level/page/zoom/pan all unchanged; `inspector-arrange-disabled-when-not-displayed` searches for
a class that is in scope but not on the current 12-class page and asserts the button carries
`disabled` and the exact tooltip text.

Two more scenarios verify Step 5 point 5's narrow-layout requirement concretely rather than by
inspection: "Test this on narrow layouts; the explicit touch action must remain usable when a single
tap opens details." On this app's mobile layout a single tap already switches the pane to Details
(`select()` calls `setMobilePane('details')`, and `.workspace-content` — the canvas's own container —
is `display:none` while that pane shows). `narrow-double-click-gesture-observation` is a recorded,
checks-free observation (matching S11's existing pattern) confirming empirically that a real
double-click's second press does not reach the canvas at all once the first press has switched the
pane away (`taps: 1, dbltaps: 0, arrangeCalls: 0`) — this is the concrete reason the keyboard/touch
equivalent exists, not a defect to fix. `narrow-inspector-arrange-from-details-pane` then proves the
actual requirement holds: a single tap selects a card and switches to Details (as Step 4's own S16
already established), and activating "Arrange around this resource" from that same pane still drives
exactly one arrangement (`arrangeCalls === 1`, `dbltaps === 0`, scope/level/page/zoom/pan all
unchanged); returning to the Map pane shows the already-applied geometry (`GraphCanvas` stays
mounted throughout — only its container toggles `display:none` — so the reconciliation effect wrote
the new positions regardless of visibility) with the camera untouched and the canvas instance
preserved, which also exercises the zero-size `ResizeObserver` guard with a real pending geometry
write for the first time (Step 4's S16 only exercised that guard with no write queued).

Durable evidence: `docs/evidence/stable-graph-step5/{baseline,acceptance}-report.json` plus eight
inspected screenshots — before/after pairs for `s10a-double-click-at-12` and
`s10b-double-click-at-36` show `InvoiceService` as the double-clicked focus with `OrderService`
(outgoing) to its right and `OrderRepository`/`AuditService` (unrelated) in rows below, appearing
only in the "after" shot at the same 47% zoom the "before" shot already had; the
`s10d-inspector-arrange-action` before/after pair shows the identical column layout reached via the
inspector button on `AuditService`, confirming both entry points produce the product's declared
reading order; `s16b-narrow-inspector-arrange-from-details.png` shows the "Arrange around this
resource" button in the narrow Details pane for `PaymentService`, and
`s16b-narrow-arranged-map-after-return.png` shows the Map pane afterward with the arranged geometry
present and the camera exactly as the narrow layout's own initial fit left it (20%, not re-fit to the
new, wider arrangement — "Avoid automatic fit" holds on narrow layouts too). Full runs (28
screenshots, both modes' complete reports, logs) in `build/stable-graph/{baseline,acceptance}-*/`
(git-ignored).

### A regression found and fixed during this step's verification (not caused by this step)

Re-running `python3 scripts/verify_hierarchical_pipeline.py` (required because `GraphCanvas.tsx` was
touched again) crashed with `TypeError: Cannot read properties of undefined (reading 'click')` inside
`verify-hierarchical-ui.mjs`'s `scopeUnchanged('inspector exploration preserves scope', ...)`
scenario. Cause: Step 4 relabeled the inspector's "See method call graph ↗" button to "View methods
↗" (Story 6/H3's named-command wording), but its own ledger recorded skipping this exact harness that
step, reasoning that "only `App.tsx`'s navigation/edge-lookup call sites changed... no explanation
code path touched" — true for the *explanation* behavior the harness mostly covers, but the harness
also happens to click this specific button by its old text as part of one scope-preservation check,
which the reasoning did not consider. Fixed the stale selector
(`'method call graph'` → `'View methods'`) in `scripts/verify-hierarchical-ui.mjs`; re-ran and
confirmed **PASS**: 61 bulk CLASS/METHOD subjects explained via the local mock provider,
`cxttap` remove-from-scope, READY sparkle/hover, explanation-refresh camera stability, and every
scope-preservation scenario (including the now-fixed one) all still pass against this step's
`GraphCanvas.tsx`/`InspectorPanel.tsx` changes. Recorded here per the common instructions'
"resolve a newly discovered regression... without rewriting the completed step instructions or
pretending their history never happened" — Step 4's own section above is left exactly as it was
written; this is a follow-up fix to a test harness, not an application behavior change.

### Pure tests

`node scripts/test-focused-arrangement.mjs` → **PASS, 11 checks** (new file): focus-not-displayed
returns `null`; an A→focus→C chain places both neighbors at the exact half-width+96+half-width
offset; a bidirectional neighbor lands left-only; a self-loop creates no second focus card; an
isolated resource is placed exactly 64 units below the focus's bounding box (via the reused
`placeAdditions`); a reciprocal pair between two *other* cards does not touch the focus's columns;
mixed card heights stack by actual height plus a 48-unit gap, not uniform spacing; the column
x-offset uses actual card width (checked at both class and package dimensions); within-group order
is deterministic by qualified name then ID regardless of input array order; translating by a
different anchor changes only the focus's own coordinate, never the relative structure between
cards; a method/constructor-level focus is handled identically to any other card.

`node scripts/test-explorer-view-state.mjs` → **PASS, 43 checks** (41 existing + 2 new):
`ARRANGE_AROUND_RESOURCE` overwrites exactly the given IDs' positions and bumps `geometryRevision`
once per dispatch (not once per card), leaving level/scope/membership untouched and an ID absent
from the result exactly as it was; a stale-`generation` arrangement is dropped, matching
`SET_CAMERA`/`NODE_MOVED`.

`node scripts/test-graph-model.mjs` → **PASS, all 7 suites**, unchanged (Step 5 touched no
`graphModel.ts` code). `node scripts/test-graph-placement.mjs` → **PASS, 8 checks**, unchanged
(reused, not modified, by `focusedArrangement.ts`).

### Other checks

- `npx tsc -b --force` (frontend/) — 0 errors.
- `npm run build` (frontend/) — succeeds; existing >500 kB bundle advisory unchanged.
- `./gradlew bootJar --no-daemon` — BUILD SUCCESSFUL, rebuilt jar bundles the new frontend.
- `node --check scripts/verify-stable-graph-ui.mjs`, `node --check scripts/verify-hierarchical-ui.mjs`,
  `python3 -m py_compile scripts/verify_stable_graph_pipeline.py`, `git diff --check` — all clean.
- `python3 scripts/verify_hierarchical_pipeline.py` — **PASS** (after the stale-selector fix above;
  required this time because `GraphCanvas.tsx` was touched again).
- Not run: `./gradlew test` (no backend source changed). Not run: any lint pass (this repository has
  no lint tooling configured).

### Remaining known limitations (accurately not claimed fixed)

- **Whole-map optimization ("Reorder map") does not exist at all.** `graphLayout.ts`'s old unfocused
  grid branch was deleted, not migrated — Steps 6-9 build the real layered/scored solver from
  scratch per Appendix C/D/E, not by growing this step's focused-only algorithm.
- **Arrangement is instant, with no animation** — explicitly acceptable per Step 5 point 7 ("Instant
  placement is acceptable initially"). Because there is no motion, there is also nothing for
  reduced-motion preferences to disable yet; that becomes a real constraint once Step 9B's whole-map
  publish considers animating.
- **A repeat double-click on the same, already-arranged, unmoved focus is untested for "exactly one
  arrangement."** It is deterministic and anchored, so it correctly recomputes an identical layout
  and moves nothing — this is the algorithm's determinism working as intended (Appendix C9's
  determinism goal for whole-map layout applies just as naturally here), not a missed arrangement.
  The scenario that verifies "a double-click reliably fires a second time" uses a different focus
  instead.
- **The `'arranged'` Cytoscape event is diff-based**, i.e. it fires only when at least one
  already-displayed card's position actually changed. This is the correct, intentional signal for
  "did geometry change" — but it means a caller cannot use it to count "how many times
  `ARRANGE_AROUND_RESOURCE` was dispatched" if that ever needs to diverge from "how many times
  geometry actually changed" (it does not currently need to).
- **`HistoryEntry.geometryRevision` remains inert**, as recorded in Step 4 — unaffected by this step.
- `docs/BUILD_BRIEF.md` remains absent; `docs/BUILD.md` was read in its place, as in Steps 1-4.

### What the next session must read

- This ledger's Step 5 section (the diff-based `'arranged'` event design, why the same-focus repeat
  case is deliberately not asserted, the `focusedArrangement.ts` rename) and
  `docs/evidence/stable-graph-step5/*-report.json` for exact before/after state.
- `/home/sajjad/prompts/steps.md` Step 6A and Appendices C1/C2/C7 and D5 — the pure geometry/scoring
  contract for whole-map layout. Step 6A explicitly excludes the router and optimizer; it is math
  types and a scorer only.
- `frontend/src/features/explorer/graphPlacement.ts` (the append-below-bounds primitive Step 6A's
  geometry helpers should sit alongside, and that Step 5's unrelated-group placement already reuses)
  and `frontend/src/features/explorer/focusedArrangement.ts` (the sibling pure-module pattern —
  serializable inputs, no React/Cytoscape/DOM imports, independently tested — Step 6A's geometry/
  scoring module should follow the same shape, per Appendix G1).

### Next step / precise remaining task

Step 6A — build pure geometry types (`LayoutRequestV1`, drawing/route geometry, result/error types)
and an independently tested quality scorer (card-rectangle/route-length/intersection/overlap
measurement, the `Q` lexicographic tuple) per Appendix C1/C2/C7 and D5; do not implement the router
or the candidate-position optimizer yet, and do not claim any UI action or improved layout. Create
`scripts/test-graph-layout.mjs` with the hand-computable fixtures D5 lists (X crossing, shared-source
edges, intersection at a bend, T-contact, collinear overlap, unrelated-card obstruction, overlapping
labels) with expected counts computed by hand, never by the production scorer. Also create the next
available layout-policy ADR recording filtered input, semantic preservation, quality priorities, the
hard route-distinguishability guard, deterministic work budgets, and the historical Dagre discrepancy
PROJECT_STATUS.md/ARCHITECTURE.md already note.

---

## Step 5 review remediation (2026-09-11)

A review of Steps 3-5 (`/home/sajjad/prompts/step-3-4-5-review-resolve-plan.md`) surfaced five items:
three confirmed real defects (Category A), two real gaps needing a design decision (Category B), and
a Category C flagged as likely-correct-by-design (not touched -- see below). These are fixes to
already-completed work, not a new numbered plan step; Step 6A's own plan is unchanged.

### A1 [STATE-01] -- HistoryEntry stamped the wrong level after a cross-level inspection persists

**Confirmed real** and traced exactly as reported: `inspect OrderController on CLASS -> switch to
METHOD via the segmented control (inspection persists, Step 4's own design) -> inspect a method` push
the history entry via `currentEntry()`, which read `state.activeLevel` (already METHOD by then) --
never the level `OrderController` was actually inspected under. Back then restored the wrong level,
stranding the user on Methods.

**Fix:** added `inspectedLevel: Level | null` to `ExplorerViewState` (`explorerViewState.ts`),
written only by `inspect()` (to `state.activeLevel` *at that dispatch*) and by `NAVIGATE_BACK` (to
`entry.level`, or `null` for a B1 level-only entry) -- `NAVIGATE_LEVEL` never touches it, which is the
entire point. `currentEntry()` reads `inspectedLevel` instead of `activeLevel`. The invariant
`inspectedLevel` is non-null iff `inspectedSubjectId` is non-null is maintained everywhere it changes
(`inspect`, `CLEAR_INSPECTION`, `NAVIGATE_BACK`, `RESET`/`initExplorerViewState`).

Left untouched, deliberately: `inspect()`'s same-subject/kind early return does not update
`inspectedLevel` on a true no-op re-inspection. This is load-bearing, not an oversight -- Step 5's own
double-click contract (H4) depends on re-inspecting the same subject/kind being a byte-identical
no-op with zero side effects, including no `inspectedLevel` churn.

**Tests (`test-explorer-view-state.mjs`, 3 new checks):** the exact CLASS->METHOD->inspect trace from
the finding, asserting the pushed entry's level and Back's restored level; a "second lap" trace
(inspect A on CLASS -> METHOD -> inspect B -> Back -> inspect C) proving `NAVIGATE_BACK` restoring
`inspectedLevel` prevents the same defect recurring one hop later; the `CLEAR_INSPECTION`-reachable
variant (close while at a different level than the one actually inspected).

### A2 [ARC-05/ARC-07] -- locale-dependent `localeCompare` sorting

**Confirmed real**, fixed exactly as specified: `graphPlacement.ts` and `focusedArrangement.ts` both
now sort via an explicit ordinal comparator (`(a,b) => a<b?-1:a>b?1:0`) instead of `localeCompare`.

**Deviation from the task's literal instruction, recorded:** the task said duplicating the comparator
in both files is fine and explicitly said not to introduce a new shared module. `graphPlacement.ts`
now `export`s `ordinal` and `focusedArrangement.ts` imports it instead of duplicating it. Reason: both
files' compiled JS is textually concatenated into one script by the pure-test harnesses
(`test-graph-placement.mjs`, `test-focused-arrangement.mjs`, `data:` URL loader workaround for
relative imports) -- two identical top-level `const ordinal` declarations collide as a
`SyntaxError: Identifier 'ordinal' has already been declared` once concatenated. `focusedArrangement.ts`
already imports from `graphPlacement.ts` (`CardBounds`/`AdditionCard`/`Point`/`placeAdditions`), so
this extends an existing dependency edge rather than adding a new module.

**Tests (1 new check per file):** `'AirCarrier'` vs `'airCarrier'` -- ordinal sorts uppercase before
lowercase, the opposite of en-US `localeCompare` for the same pair (asserted directly, so the test
actually fails if the comparator regresses to `localeCompare`, not just under a non-C locale).

### A3 [CANVAS-02] -- `nodes.length` 0 -> >0 never triggered the initial-fit effect

**Confirmed real.** `GraphCanvas.tsx`'s camera effect was keyed on `[camera]` only. A level first
visited with zero eligible nodes gets `camera === null` and stays `null` (nothing to place); widening
scope later admits cards into that same level without `camera`'s reference ever changing
(`reconcileLevelView` echoes `camera: view.camera` verbatim), so the effect never re-ran and the
newly admitted card never got its initial fit.

**Fix:** added a `hasNodes = nodes.length > 0` boolean to the effect's dependency array (`[camera,
hasNodes]`), exactly as specified.

**Fixture change required to reach this empirically:** every package and every class in the existing
74-type fixture has at least one method (even a plain getter -- `Address.getStreet()`), so no level
could ever show 0 eligible nodes while scope stayed non-empty (the only true zero-node state is the
global empty-scope branch, which unmounts `GraphCanvas` entirely -- a fresh mount always runs the
effect once regardless of this fix, so that branch cannot exercise the bug). Added
`com.example.stable.marker.RegionTag` -- a field-only class with no methods or explicit constructor
(verified against the imported graph: no `METHOD`/`CONSTRUCTOR` node exists for it) -- giving a real,
non-empty-scope package that is genuinely empty at METHOD level. `packageCount >= 6` / `typeCount >=
60` floors and every existing scenario's assertions are unaffected (no exact-count assertions existed
for the prior 74/6 totals); `test-fixtures/stable-graph-fixture/README.md`'s shape/count tables
updated to 75 types / 7 packages.

**Browser scenario added** (`verify-stable-graph-ui.mjs`, `empty-level-then-scope-widened-triggers-
initial-fit`): reload -> Clear scope -> select `marker` alone (scope non-empty, `GraphCanvas`
remounts fresh at Packages with 1 node -- the pre-existing, already-correct mount-time case, not what
this tests) -> switch to Methods on that *same* mounted instance (0 nodes, `camera` null, `.canvas-
empty` renders) -> select `util` (0 -> 10 methods, `camera` still the same `null` reference) ->
asserts `fitCalls >= 1` and every admitted card's `renderedBoundingBox()` is inside the canvas
viewport. Added to both `baseline` and `acceptance` with identical checks (the fix was applied in the
same session, matching the existing `manual-drag-persists`-style precedent for scenarios with no
separate "broken" baseline to describe).

### B1 [STATE-02] -- no history entry pushed when a drill-down starts from a completely uninspected state

**Confirmed real.** `navigateExplicit()` dispatched `INSPECT_NODE` before `NAVIGATE_LEVEL`; when
nothing was previously inspected, `currentEntry()` returned `null` (nothing to push) both before and
after the level change, leaving `history` empty and `<- Back>` permanently disabled after the very
first "View classes"/"View methods" action from a fresh Packages view.

**Design chosen (recommended option (a), refined):** `HistoryEntry.subjectId`/`kind` became
`string | null` / `InspectedKind | null`. `NAVIGATE_LEVEL`'s reducer case now pushes a level-only
breadcrumb `{subjectId: null, kind: null, level: <the level being left>}` when `!state.inspectedSubjectId
&& action.level !== state.activeLevel` -- i.e. exactly a genuine level change starting from nothing
inspected. `pushHistory`'s dedup guard was extended: for a null-subject entry, two entries only dedup
if they also name the same `level` (otherwise two level-only breadcrumbs at different levels would
incorrectly collapse into one). `NAVIGATE_BACK` restores `inspectedLevel: null` (not `entry.level`)
when `entry.subjectId` is null, preserving A1's invariant.

**Why this needed a reducer-side push, not just a type change:** the naive fix (push from `inspect()`
via `currentEntry()`) is dead code on `navigateExplicit`'s actual call order -- by the time
`INSPECT_NODE` runs, `NAVIGATE_LEVEL` has already changed the level, but `INSPECT_NODE` was dispatched
*first* in the original code, so `inspectedSubjectId` was already about to be set regardless of
order. The reducer-side push in `NAVIGATE_LEVEL` needed `state.inspectedSubjectId` to still reflect
"nothing inspected yet" at the moment it runs, which requires `navigateExplicit` to dispatch
`NAVIGATE_LEVEL` *before* `INSPECT_NODE` -- swapped in `App.tsx`. Verified this reorder changes
nothing else: `eligibleFor`/`placementFor` close over already-computed values unrelated to dispatch
order, and React's `useReducer` applies both dispatches to the same reducer synchronously and in
order regardless of which is issued first.

**B2 uses this same mechanism** (see below): the segmented control now dispatches `NAVIGATE_LEVEL`
then, only when needed, `CLEAR_INSPECTION` -- in that order, so `CLEAR_INSPECTION`'s own history push
(via `currentEntry()`, unaffected by the level having already changed, since it reads `inspectedLevel`
per A1) records the edge under the level it was actually inspected at, and `NAVIGATE_LEVEL`'s new
guard (`!state.inspectedSubjectId`) correctly does *not* also fire a redundant level-only breadcrumb,
since something (the edge) is still inspected at the moment `NAVIGATE_LEVEL` runs.

**Known, accepted blast radius beyond `navigateExplicit`:** `NAVIGATE_LEVEL`'s breadcrumb push is in
the reducer, so it fires for every dispatch site, including the segmented control (intentional -- same
"leave a way back after an explicit navigation" property) and `loadSnapshot`'s post-`RESET`
`NAVIGATE_LEVEL` when a URL parameter selects a node in a non-Package level on initial page load. That
last case means a snapshot opened via a direct `?snapshotId=...&...` link that lands on Classes/Methods
now starts with one history entry and an enabled `<- Back>` before the user does anything -- a
user-visible first-paint difference. No existing browser scenario asserts Back's disabled state on a
fresh load (checked: no `disabled` assertion keyed to `history.length` exists in either harness), so
nothing regressed, but this is called out here rather than left for a future session to rediscover.

**Tests (`test-explorer-view-state.mjs`, 5 new checks):** `NAVIGATE_LEVEL` from a fresh state pushes
exactly the described breadcrumb and Back returns to Packages with empty history; re-navigating to the
already-active level pushes nothing; two level-only breadcrumbs at different levels both survive (the
dedup fix); once something is inspected, leaving that level pushes no extra breadcrumb; and a
mechanism-level test proving the edge-recovery sequence (`INSPECT_EDGE` -> `NAVIGATE_LEVEL` ->
`CLEAR_INSPECTION` -> one `NAVIGATE_BACK`) restores both the level and the edge inspection in a single
Back.

### B2 [UI-06] -- an inspected aggregate edge silently dangled across a level switch

**Confirmed real**, and simpler than the task's writeup implied: an aggregate edge ID is
`aggregate:[source,target]` with level-scoped endpoints (`graphModel.ts`), so it can
**never** resolve again at a different level -- no need to re-derive occurrence aggregation or probe
whether it "would" resolve (Appendix A1's "do not create two subtly different occurrence aggregation
implementations" warning is avoided entirely, per the task's own recommended option 1).

**Fix:** the segmented control's `onClick` (`App.tsx`) now also dispatches `CLEAR_INSPECTION` when
`viewState.inspectedKind === 'EDGE' && !unresolvedEdge`, *after* the `NAVIGATE_LEVEL` dispatch (order
matters -- see B1 above for why). `unresolvedEdge` is excluded because it is looked up by raw ID from
`graph.metadata.unresolvedRelationships`, not level-scoped, and already survives level switches
untouched -- the same exclusion `edgeFilteredOut` already uses.

**This converts "silently dangling" into "recoverable in one Back",** not just "closed": because
`CLEAR_INSPECTION` pushes a history entry via `currentEntry()`, which (via A1's `inspectedLevel` fix)
records the level the edge was actually inspected under, a single `NAVIGATE_BACK` both undoes the
level switch and restores the edge inspection. Verified in both the pure mechanism test above and the
new browser scenario below.

**Browser scenario added** (`verify-stable-graph-ui.mjs`,
`edge-inspection-cleared-then-recovered-across-level-switch`): inspect a real Packages-level edge via
pointer click -> switch to Classes via the segmented control -> assert the inspector actually closed
(not left pointing at a now-nonexistent aggregate) -> click Back -> assert Packages level and the same
edge inspection are both restored in that one Back.

### Category C -- not touched, per the review's own recommendation

C1 (`HistoryEntry` omitting camera/filter snapshot), C2 (missing "Show added" pan affordance), and C3
(breadcrumb no-op when already on the Map tab) were all assessed by the review as likely-correct-by-
design, backed by existing ledger text and a passing test asserting the opposite of the "fix" (C1) or
an explicit prior deferral (C2) or a genuine product-intent question rather than a code defect (C3).
No new evidence contradicting that reasoning was found this session; none were touched, per the
review's own instruction to leave them unless a fresh concrete failure surfaces. D1/D2/D3 (locale-
sorting's `typicalWidth` derivation, `arrangeAroundResource`'s `appendWidth` reuse, `placementFor`'s
per-call `Map` allocation) were left as recorded -- real-but-low-value, not urgent, no time spent on
them this session.

### Verification

- `node scripts/test-graph-model.mjs` -> PASS (7 suites, unchanged)
- `node scripts/test-explorer-view-state.mjs` -> PASS (**51** checks, 8 new: 3 for A1, 5 for B1/B2's
  shared mechanism)
- `node scripts/test-graph-placement.mjs` -> PASS (**9** checks, 1 new for A2)
- `node scripts/test-focused-arrangement.mjs` -> PASS (**12** checks, 1 new for A2)
- `npx tsc -b --force` (frontend/) -> exit 0
- `npm run build` (frontend/) -> succeeds; existing >500 kB bundle advisory unchanged
- `./gradlew bootJar --no-daemon` -> BUILD SUCCESSFUL (rebuilt before every browser run below)
- `python3 scripts/verify_stable_graph_pipeline.py baseline` -> **PASS, 34/34 scenarios** (2 new: A3's
  and B2's, both above)
- `python3 scripts/verify_stable_graph_pipeline.py acceptance` -> **PASS, 34/34 scenarios, 0 unmet**
  (up from 32/32 after Step 5 -- the 2 new scenarios pass outright, not a regression)
- `python3 scripts/verify_hierarchical_pipeline.py` -> **PASS** (required: `GraphCanvas.tsx` and
  `App.tsx`'s navigation call sites both changed) -- 61 bulk CLASS/METHOD subjects, scope
  scrolling/hierarchy/mutation, `cxttap` removal, READY badges, polling/viewport/reduced-motion/narrow
  layout all still pass against this session's changes
- `git diff --check` -> clean
- Not run: `./gradlew test` (no backend source changed). Not run: any lint pass (no lint tooling
  configured in this repository).

### Files changed

- `frontend/src/features/explorer/explorerViewState.ts` -- `inspectedLevel` (A1), nullable
  `HistoryEntry.subjectId`/`kind` and the `NAVIGATE_LEVEL` breadcrumb push + dedup fix (B1).
- `frontend/src/features/explorer/graphPlacement.ts` -- exported `ordinal` comparator (A2).
- `frontend/src/features/explorer/focusedArrangement.ts` -- imports `ordinal` instead of
  `localeCompare` (A2).
- `frontend/src/features/explorer/GraphCanvas.tsx` -- `hasNodes` added to the camera effect's
  dependency array (A3).
- `frontend/src/App.tsx` -- `navigateExplicit()`'s dispatch order swapped (B1); the segmented
  control's `onClick` gained the edge-clearing dispatch (B2); `recentHistory`'s null-subject guard
  (type-checking fallout of B1's `HistoryEntry` change).
- `test-fixtures/stable-graph-fixture/src/main/java/com/example/stable/marker/RegionTag.java` (new)
  and `test-fixtures/stable-graph-fixture/README.md` (updated counts/tables) -- A3's fixture addition.
- `scripts/test-explorer-view-state.mjs`, `scripts/test-graph-placement.mjs`,
  `scripts/test-focused-arrangement.mjs` -- new pure checks (A1/A2/B1, see above); two pre-existing
  assertions in `test-explorer-view-state.mjs` updated for B1's now-larger history (indices, not
  behavior claims -- the underlying scenarios they test are otherwise unchanged).
- `scripts/verify-stable-graph-ui.mjs` -- two new scenarios (A3, B2), both passing in baseline and
  acceptance.

### What the next session must read

- This addendum (design decisions: A1's `inspectedLevel` invariant, B1's reducer-side push and its
  dependency on dispatch order, B2's reuse of that same mechanism, A3's fixture addition) plus
  `docs/evidence/stable-graph-step5/` remains the most recent full-step evidence (this remediation
  pass did not regenerate step-level screenshot evidence -- see below).
- `/home/sajjad/prompts/steps.md` Step 6A and Appendices C1/C2/C7/D5, unchanged by this remediation
  pass -- Step 6A's plan and prerequisites are exactly as Step 5's ledger entry described them.

Durable evidence: `docs/evidence/stable-graph-step5-remediation/{baseline,acceptance}-report.json` plus
two inspected screenshots. `s18-empty-level-scope-widened-fit.png` -- Methods level, scope narrowed to
`marker, util`, showing 10 method cards (`util`'s classes) fitted in view at 47% zoom, confirming the
level that started genuinely empty (`marker` alone has none) now shows its newly admitted cards inside
the viewport rather than off-screen with no way to reach them. `s19-edge-inspection-recovered-after-
level-switch-back.png` -- after switching to Classes and back via a single Back, the inspector shows
the `com.example.stable.controller -> com.example.stable.service` relationship open again at Packages
level, confirming the edge inspection that was cleared on the level switch was genuinely recovered, not
lost. Full runs (28 screenshots, both modes' complete reports) in
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored).
