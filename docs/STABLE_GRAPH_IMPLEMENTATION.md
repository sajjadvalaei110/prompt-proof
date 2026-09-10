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
| **Step 2** | Separate inspection from displayed-page membership (`explorerViewState.ts`) | Pending | — | Pure state tests |
| **Step 3** | Incremental canvas updates & append-below placement | Pending | — | Browser coordinate assertions |
| **Step 4** | Class traversal (A→B→C) and restorative Back navigation | Pending | — | Navigation history tests |
| **Step 5** | Double-click focused arrangement around resource | Pending | — | Single vs double click checks |
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
- `:47` — aggregate edge IDs are `aggregate:["<source>","<target>","<kind>","<resolution>"]`. This is
  **never** a node ID, which is why passing `selectedId` into `graphLayout` as a focus fails for edges.

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
