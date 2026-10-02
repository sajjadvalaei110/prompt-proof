# Code Atlas — Testing Strategy

## Git review views

`./gradlew test bootJar` runs backend coverage and packages the frontend. Focused
Git fixtures are `GitReviewBoundaryTest` and `ReviewApiIntegrationTest`: real local
repositories cover upstream merge bases, staged/unstaged/untracked content, raw
filter-free reads, binary files, retained source, line counts, repeated call sites,
partial parsing, failure cleanup and preservation of the active analysis snapshot.
`ReviewSourceRootParityTest` (2026-09-25) pins that the review captures find the same source roots
as the ordinary analysis: for a repository rooted at a `src` directory (`main/java`, `test/java`),
a cross-file resolved CALLS and a DEPENDS_ON inferred from a call chain's receiver type exist on
the ordinary map, on both review sides and as UNCHANGED comparison rows (the user's vanishing
`DeveloperWorkflowTest -> ExplanationResponse` edge).
`node scripts/test-review-model.mjs` checks frontend side and occurrence identities,
ordinary-map display alignment, duplicate declarations and ambiguous ancestors.
`node scripts/test-review-placement.mjs` exercises the shared geometry helper and
reducer to verify parked review cards, hidden children and target-scope placement.

Run `JAVA=/path/to/java21/bin/java python3 scripts/verify_git_review_pipeline.py`
for browser acceptance. It requires installed Chromium (override `CHROMIUM` if
needed), the packaged JAR and loopback sockets. It creates an isolated Git fixture,
application database and browser profile, opens the actual review UI and records
screenshots. Repository/index hashes and a rejecting local model endpoint check
that review leaves analyzed data unchanged and makes no model calls. Inspect the
screenshots as well as the assertions. No live model integration is claimed.

The Changes-toggle regression uses the package-only expand-in-place controls. It
compares surviving card positions and sizes, expansion ancestry and pan/zoom across
first activation and both toggle directions after edits. Review-only removed and
unknown declarations are checked separately from shared cards; their appearance
can change a compound container's bounds. The same run checks ordinary versus diff
source inspection, undo/redo, tab isolation and removal of stale review styling.

## Exploration tabs and undo/redo (R6, September 2026)

See [Exploration tabs](EXPLORATION_TABS.md) for the behavior, boundaries and browser
setup. `node scripts/test-explorer-journeys.mjs` verifies grouped updates, independent
tabs, cloned past/future branches, close/reopen, retention bounds, initial camera
baseline, stale callbacks across snapshot resets, view-only fullscreen/minimap/button-zoom
rebasing, selection outside history (ADR 0009: click sequences add no entry and keep redo,
undo/redo keep the current selection and prune only cards/routes the restored map no
longer draws, including across a Changes toggle, and a double-click is one arrangement
entry, and a Back that leaves the map unchanged or only refreshes eligibility bookkeeping
adds none; Back-trail pruning, the graph-less route fallback, companion revert on undo and
the pruning short-circuits), mode continuity, and atomic recapture for open and closed tabs,
plus the outgoing-stack root: toggling adds no entry and keeps redo, undo/redo keep it, undo
removing the root ends it without a redo revival, scope removal, collapse, level switch, the
graph-less fallback, mode revalidation and recapture end it, and Clone copies it. The phase B
review fixes add: dragging an expanded child never reprojects the map (a `graphFor` spy) and keeps
the root; entering Changes keeps a drawn child root with a layout-derived position when the review
graph is known; and `useExplorerJourneys.updateTab`, run under a synchronous React stand-in, prunes
with an explicit `graphFor` rather than the render-time one. The incoming stack (2026-09-28) adds:
the button cycle (outgoing -> incoming -> off on the root, outgoing on another card) and the menu's
direct toggles as pure functions; a direction switch adds no entry and keeps redo, and undo/redo
carry the direction; an incoming root is pruned like an outgoing one; and Clone copies the
direction (53 checks then). Step 13 adds that a sequential expand queue's renders sharing one
explicit history group form one undo step, and that the hook joins explicit-group updates across
renders (55 checks on step 13). Step 14 and its review remediation add six: ungroup is one undo
step, ends a stack rooted at the hidden card, and redo drops a carried selection of it; collapsing
(expanded or ungrouped) prunes the multi-selection in one undo entry; a rejected collapse leaves
the journey untouched (61 checks after merging step 13 into step 14).

`node scripts/test-outgoing-stack.mjs` pins the pure layer computation
(`docs/OUTGOING_STACK.md` §Traversal) over hand-computable fact graphs: an undrawn root, an empty
stack, the summary line, the collapsed-hub case (class root P does not reach C through another
class of B; package root A does), a class chain across a collapsed package, method roots (method
calls only; class-level and class-target facts ignored), layer = minimum over represented entities,
the nearest drawn ancestor as representative, entities with no drawn representative, ancestors of
the root, the kind filter, REMOVED facts, null/unknown endpoints, cycles and self-loops, an
expanded root, a reached expanded box with covered children, an out-of-scope entity inside a box,
chain routes via `occurrenceIds`, `direction: 'in'`, and order independence over 20 shuffles.
Step 12 phase C adds: a method root reaching a type through CONSTRUCTS, a CALLS fact to a type or
USES_TYPE as a terminal entity (the hand-built graphs still use CANDIDATE facts, which the analyzer
no longer emits since the 2026-09-25 revert; the helper walks any resolution alike) (a declared constructor continues; field and DECLARES_BEAN targets
do not count); dispatch through reversed OVERRIDES to one and two implementations, with no forward
walk and no implementors for class roots; card-hop layers without skips (the SubscriptionRepository
shape) and dense ranking; and the beyond-the-map count and summary. A competing-path check (a longer
path through one card against a hop chain) pins the 0-1 BFS: plain BFS fails it. The incoming
stack (2026-09-28) adds the "Incoming stack:" summary; the collapsed-hub mirror at class and package
level; reversed dispatch (impl <- interface method <- callers, no sibling implementation); no
terminal types for a method root; an interface root reaching its implementors through reverse
IMPLEMENTS; and beyond the map (41 checks then; 48 after step 14 and its review remediation).

`python3 scripts/verify_ungroup_pipeline.py` (step 14, ADR 0011) starts an isolated packaged jar
(model URL on a closed port) and a headless Chromium. It copies `test-fixtures/microservice-java`
twice, once plain and once as a Git repository whose working tree adds a method to EventService,
hashes both before and after, and runs `scripts/verify-ungroup-ui.mjs` (33 checks since the
review remediation of 2026-09-28). The checks cover:
- Ungroup from the corner button and from the box's card menu: the box has no fill, border,
  outline, underlay, label, pointer events, corner buttons, routes or minimap rect. The Ungroup
  button's rect lies left of the stack toggle's, which lies left of the collapse square's, on one
  row without overlap.
- A hidden package picked from the tree: nothing lit or muted, the inspector's "Ungrouped on the
  map" notice with Arrange disabled, and no keyboard card menu.
- A freed class dragged far away on its own, and a top-level card dropped inside the hidden area
  that still receives the click.
- "Collapse into X" in a freed card's menu, centred on its children, with undo and redo.
- A class ungrouped inside the hidden package: its methods name the class, and their menu offers
  only the nearest hidden parent.
- Double-click arrangement moving freed methods individually: at least two of them move by
  different vectors, so the hidden box did not move as one block.
- "Collapse into EventService" from a freed method: EventService returns as a collapsed card still
  inside the hidden services, its methods leave the map, and a method that was multi-selected is
  not selected again when the class is re-expanded.
- One Changes-mode pass on a MODIFIED package.
- From a fresh map, the tree's ⌖ "View methods of EventService" while services is collapsed opens
  services, then EventService, and inspects EventService.
- A `?selectedSymbol=<method id>` deep link draws the method inside its class box inside its
  package box, and inspects it.

Screenshots go to `build/ungroup/run-*/evidence` (inspected copy in `docs/evidence/ungroup/`).
`node scripts/test-expansion-layout.mjs`, `test-focused-arrangement.mjs`,
`test-explorer-view-state.mjs`, `test-explorer-journeys.mjs`, `test-graph-model.mjs`,
`test-outgoing-stack.mjs` and `test-node-card.mjs` pin the pure parts:
- the reducer flag and `nearestHiddenAncestor`;
- undo/redo and pruning;
- the `hiddenBox` projection;
- `roomMoves` and `arrangeDisplayed` looking through hidden boxes;
- a hidden box's layer handed to its freed cards, outgoing and incoming;
- the method-card class line.

The review remediation (2026-09-28) adds:
- `revealContainers` (graph-model): the containers to open for a target (package, then a method's
  own type, never a nested type's outer class);
- `collapseInJourney` (journeys): a collapse drops the cards drawn inside from the
  multi-selection, in one undo entry, and is a no-op when the reducer rejects it;
- a hidden box representing only itself (an undrawn member counts beyond the map, including after
  the box itself was looked up), a hidden root returning null, and incoming rule-9 cases
  (outgoing-stack);
- the top-level card past a hidden box moving by the width change (expansion-layout), and the
  focus's own stored position (focused-arrangement).

The merge with step 13 (2026-09-28) adds `collapseTargets` (view-state, 74 checks): the card menu's
"Collapse N selected" drops a target only when it is drawn inside another target, so a nested type
beside its expanded outer class in the package box is still collapsed.

`node scripts/verify-outgoing-stack-ui.mjs <microservice-java copy> <git fixture> <base oid> <chain fixture> <journey fixture>`
(BACKEND/APP/DEBUG as below) is the stack's browser acceptance (108 checks). It activates the
stack from the on-card button, checks badges 1..N and the chain routes against an independent
Node-side oracle computed from the API graph (written from the spec's rules, not from
`outgoingStack.ts`), and checks that the root stays pinned while a layer-2 card is selected. It
expands a chain card (package-level layers unchanged, the box keeps its badge, its children are
covered), expands the root and a type inside it (every layer-0 card, nested ones included, takes
the root look and gets no badge), then checks that one Escape ends the stack and a second
clears the selection. Positions, camera and the redo branch must be unchanged throughout. It
also covers the context menu (a menu-only right-click leaves no multi-selection; Deselect still acts
on the right-click set), Enter on the focused button, the keyboard menu path (Shift+F10 and the
ContextMenu key at the card, arrows, Escape returning focus, Enter on the item), focus kept on a
toggle that changes state or turns the stack off (outgoing -> incoming -> off), the minimum
badge size at low zoom,
reduced motion and 375 px. In Changes mode on a generated three-package Git fixture it checks
that the REMOVED route is not walked and that line colors and change fills stay factual. On a
generated plain-source chain fixture (app.a P -> app.b Q; Q.q2 -> app.c T; app.b S -> app.d U) it
checks package root app.a (b 1, c 2, d 2), class root P (b 1, c 2, d not reached and the drawn
b -> d route not lit) and method root m (b 1 only). The incoming stack (2026-09-28) adds, on the
microservice map: the drawn package with the deepest incoming stack (chosen by the oracle, run with
`direction: 'in'`) reached by the root's second press. It then checks the pressed indigo button and
"Hide incoming stack" label, badges 1..N against the oracle, indigo badges, outlines and route
underlays with no `flow-out` route, the teal root, the "Incoming stack: ..." tooltip and inspector
line, muting, no undo entry and unchanged geometry. Selecting a layer-1 card keeps the root, and
that card's own button starts outgoing there. The third press ends the stack. The menu's direct
"Show incoming stack" and "Show outgoing stack" items work, and Escape ends an incoming stack. On
the chain fixture it checks the collapsed-hub mirror: incoming package root app.d gives b 1, a 2,
and incoming class root U gives b 1 only. On a copy of `test-fixtures/journey-candidates`
(step 12 phase C) it checks that the controller method's call stays UNRESOLVED with no CALLS/CANDIDATE
anywhere (candidate calls reverted, ADR 0010 amendment 2026-09-25) and that the OVERRIDES fact
exists, and the journeys of package root api and class root SignupController (service 1, dto 1,
domain 2) and method root `SignupController.register` (dto 1 only: its call is unresolved) against
literal expectations and the oracle. From method root `SignupService.register` (service and
SignupService expanded) it checks Notifier/dto/domain 1 and MailNotifier 2 through dispatch, with
EventStore not reached; after domain leaves scope, it checks "2 layers · 3 resources · 1 beyond the
map" in the inspector and the tooltip. The fixture recipes are in `PROJECT_STATUS.md`.

`UnresolvedCallsAndOverridesTest` (backend, `test-fixtures/journey-candidates`; was
`CandidateCallsAndOverridesTest`) pins ADR 0010 after its 2026-09-25 "candidate calls reverted"
amendment: every call the solver cannot resolve (record-accessor arguments, supertype matches,
private methods, ambiguous overloads, record accessors, Lombok members, library-inherited methods)
stays `CALLS/UNRESOLVED` with no target and the reason "Static target unavailable in indexed
source"; no CALLS/CANDIDATE exists; a resolved interface call keeps its target; a solver-resolved
JDK call on an in-source receiver (`error.getMessage()`) stays UNRESOLVED; and OVERRIDES for one
and two implementations, excluding other-arity overloads and static hiding (14 tests).

`OverridesAndUnresolvedCallEdgeCasesTest` (backend, sources in a temp dir; was
`CandidateAndOverrideEdgeCasesTest`) pins the ADR 0010 amendments: no OVERRIDES to a
package-private method from another package (same package and protected still override); no
OVERRIDES between same-named parameter types from different packages or when only one side
resolves in source; the same type imported or qualified still overrides. The former candidate
sources (implicit calls in anonymous and local class bodies, `Outer.this.work(..)`/`work(..)` from
a member class, a shadowed implicit call) now pin that each call stays UNRESOLVED with no target,
and no CALLS/CANDIDATE exists (11 tests).

`APP=http://127.0.0.1:5198 node scripts/verify-explorer-journeys.mjs /tmp/atlas-journey-fixture`
exercises a real isolated backend and production frontend in Chromium (51 checks).
It includes exact geometry comparisons after expansion/resize/drag undo, clone
isolation, source-modal history, pending camera capture, Escape clearing without history,
selection outside undo (clicks leave undo empty, redo that removes the selected card prunes
it, double-click undo keeps the inspection),
closed-tab recovery, fullscreen/minimap/button-zoom history exclusion, the three-step zoom
factor and a 375 px layout. The geometry checks failed
before renderer coordinate copies were added; combined Escape and full-screen
restoration checks also reproduced defects before their fixes. No model is called.

Keep running the existing stable-graph and card-expansion browser checks after
changes at this adapter boundary. Final commands, outcomes and screenshot evidence
are recorded in `PROJECT_STATUS.md`.

## 1. Overview & Testing Philosophy

Code Atlas separates deterministic code facts from AI explanations. The testing strategy reflects this distinction:

- **Authoritative Fact Verification**: Parser, symbol resolution, and graph construction are tested against independently authored ground-truth fixtures.
- **Auditable AI Explanations**: Generated model outputs are tested for schema conformance, valid evidence citations, and failure handling—never by brittle exact-text snapshot assertions.
- **Safety & Non-Destructive Invariant**: Source code being analyzed is treated as untrusted, read-only data; tests verify that analysis never alters source files or executes build scripts.

---

## 2. Test Fixtures

### Small Correctness Fixture (`sample-project`)
- **Location**: `test-fixtures/sample-project/`
- **Purpose**: Precision verification for parser, symbol resolution, and Spring heuristic rules.
- **Included Constructs**:
  - Multi-module structure (`api`, `core`, `persistence`).
  - `@RestController`, `@Service`, and repository interfaces.
  - Multiple implementations of an interface with `@Qualifier` disambiguation.
  - Method overloads with distinct parameter signatures.
  - Generics and inheritance hierarchies (`extends`, `implements`).
  - Constructor injection with and without explicit `@Autowired`.
  - `@Configuration` class with `@Bean` factory methods.
  - Intentional circular dependency between components.
  - Intentionally malformed Java file (syntax error) to verify diagnostic capture without crashing.
  - Unresolved external classpath type to verify `unresolved` relationship status.

### 100-Class Scalability Fixture (`large-project`)
- **Location**: `test-fixtures/large-project/` (scheduled for milestone R2)
- **Purpose**: Validates graph navigation, layout algorithms, search, filtering, and rendering performance.
- **Characteristics**:
  - Deterministically generated 100 classes across multiple packages.
  - Realistic topology: high-in-degree hubs, cyclic dependencies, linear chains, and isolated leaf classes.
  - Used for benchmark testing: measuring indexing time, graph query latency, layout compute time, and memory usage.

---

## 3. Unit Test Categories

| Category | Target Subsystem | Key Verifications |
|---|---|---|
| **Analysis** | `dev.codeatlas.analysis` | AST symbol extraction, method signature differentiation, record/enum/interface parsing, byte and line/column coordinate calculations. |
| **Spring Model** | `dev.codeatlas.analysis` (`SpringAnnotationAnalyzer`) | Stereotype detection, candidate implementation matching, qualifier resolution, HTTP route extraction, ambiguous candidate marking. |
| **Graph** | `dev.codeatlas.graph` | Focus traversal, neighborhood depth limits, package aggregation, incoming/outgoing edge filtering, cycle detection. |
| **Explanations** | `dev.codeatlas.explanations` | Context window construction, prompt templating, response schema validation against `explanation-schema.json`, claim basis validation, cache fingerprinting. |
| **Model Client** | `dev.codeatlas.modelclient` | OpenAI-compatible HTTP request formatting, connection timeout, error classification, retry handling, synthetic ping verification. |
| **Storage** | `dev.codeatlas.storage` | SQLite WAL configuration, composite foreign key integrity, cross-snapshot isolation, transaction rollback on failure. |

---

## 4. Integration Test Approach

- **Database Lifecycle**:
  - Execute Flyway migrations from clean state.
  - Verify data integrity across restart (close and reopen SQLite datasource).
  - Verify composite foreign keys reject cross-snapshot or orphaned records.

- **Read-Only Source Guarantee**:
  - Compute SHA-256 hashes of all files in `test-fixtures/` before running analysis.
  - Run full indexing pass.
  - Re-compute file hashes to verify zero source mutation.
  - Verify no `.class` files or compiler artifacts are generated in the target directory.

- **Local Model Integration**:
  - Unit tests use deterministic mock HTTP servers for predictable JSON responses and error simulations (timeout, invalid JSON, hallucinated evidence IDs).
  - A dedicated integration smoke test executes against a live configured local model (e.g., LM Studio / Ollama) using a synthetic 3-line code snippet, measuring latency and verifying schema parsing without exposing workspace source.

- **End-to-End Vertical Slice**:
  - Execute workflow: Register workspace → parse `sample-project` → verify published snapshot → query graph API → request explanation for known relationship → verify evidence link matches exact source snippet.

---

## 5. Expected Facts Verification

To avoid self-reinforcing test bugs where parser bugs are mirrored in test expectations, tests compare extracted symbols and relationships against an independently authored ground-truth file:

- **Ground Truth**: `test-fixtures/sample-project/expected-facts.json`
- **Assertion Engine**:
  - Asserts that all declared classes, methods, and constructors are extracted with exact signatures.
  - Asserts that relationship occurrences match expected `source`, `target`, `kind`, and `resolution` status (`resolved`, `candidate`, `unresolved`).
  - Asserts that evidence line and column spans match exact token boundaries in the fixture files.

## 6. Hierarchical explanation acceptance (R6)

Run:

```bash
./gradlew test
./gradlew bootJar
node scripts/test-source-evidence.mjs   # evidence grouped one entry per file (change-edges)
node scripts/test-graph-model.mjs
python3 scripts/verify_hierarchical_pipeline.py
python3 scripts/verify_change_edges_pipeline.py   # change-edges browser suite (see below)
```

The new backend tests cover exact degree/LOC/ID ordering, excluded subject kinds,
complete synthesis validation, bounded large-context batches, cancellation/restart/resume,
document invalidation, method callers/callees and class owners, endpoint evidence,
generated-only SOURCE_FACT rejection, consumed-output freshness and migration from
V003. The frontend model check covers partial versus fully explained edge groups,
stale badge removal and escaping untrusted SVG labels.

The browser script needs Chromium (`CHROMIUM` can override `/snap/bin/chromium`),
Java, Python and Node 22. It uses Node's built-in WebSocket for CDP; it adds no test
package dependency. It launches the packaged jar and a **local mock provider** on
unused loopback ports, with an isolated database/profile in
`build/hierarchy-smoke/run-*/`. It copies the checked-in Spring fixture to an isolated
temporary directory and adds source-only package declarations for a 41-package overflow
case, checks before/after source hashes and SQLite integrity, and terminates its processes.

Twelve screenshots cover the scrollable hierarchical scope tree and graph context menu
at desktop/narrow widths, architecture drafts, class READY, method READY, edge READY,
edge hover READY, a 430px narrow inspector, large-context progress/completion and
model Settings without arbitrary context/output maxima. Browser assertions also cover live
status refresh, refreshing after READY, preserved pan/zoom, reduced-motion behavior,
no horizontal page overflow and no runtime exceptions. Scope assertions cover synthetic
namespace aggregate state, compact initial expansion, selected-package reveal, internal
overflow after expansion, explicit-only scope mutation, native context-menu prevention,
Escape/outside dismissal, and physical CDP right-click removal for package/class/method nodes.
Inspect the resulting PNGs;
a script pass alone is not visual review. This test never proves live-model quality
or substitutes for a configured real-model acceptance run.

Large-context backend coverage includes 500 classes, five methods and ten context documents (877,120 characters total, about 857 KiB) at
an 8192-token window/512-token output allowance, exact input-slice reconstruction,
complete bulk execution and stage provenance, provider rejection/truncated-response splitting, failed-batch
retry, cancellation retaining successful checkpoints, and document changes
preventing checkpoint reuse. Model adapter tests use a local HTTP fixture to
verify `finish_reason=length` rejection and context-limit classification without
an identical response-format retry. Budget tests include Unicode boundaries and
configured windows above the previous HTML maxima. No live-model quality claim
is made by these deterministic fixtures.

A delayed-provider regression uses 262 classes with a 65,536-token output setting.
It verifies that the planner still selects only classes 1–16 for the first request,
reports the exact in-flight range and UTC stage start, retains the completed context
checkpoint, and publishes no partial drafts when cancelled. The packaged browser
test holds a context request open and asserts that its spinner and elapsed seconds
advance before releasing the deterministic provider.

## 7. Bounded-memory explanation acceptance (pipeline 3.0)

Run the normal suite and the separately constrained scale fixture:

```bash
./gradlew test --no-daemon
./gradlew constrainedMemoryTest --no-daemon
./gradlew bootJar --no-daemon
node scripts/test-graph-model.mjs
python3 scripts/verify_hierarchical_pipeline.py
```

`BoundedExplanationScaleTest` runs only in `constrainedMemoryTest`, whose test worker
uses `-Xmx256m`. It inserts parser-owned facts directly into isolated SQLite: 100
packages, 10,000 classes, 50,000 methods, 100,000 relationships with evidence, and
several large project documents. It does not compile, run, or modify target code.
The deterministic mock provider verifies the memory/control-flow contract, not
semantic quality or live-provider latency.

The fixture asserts complete staged and published class coverage, fixed-fan-in
checkpoint levels, 60,000 CLASS/METHOD queue rows, zero relationship bulk rows,
degree/LOC/stable-ID order, cache reuse, stale `IN_PROGRESS` recovery, bounded
context omissions, and independent request/response caps. `BoundedWorkMetrics`
records high-water marks for rows returned by one Java query, retained symbols in
one batch/context, simultaneous provider requests, and prompt/response UTF-8 bytes.
The test asserts those counters instead of treating JVM heap sampling as its sole
proof. A lightweight heap sampler is reported as supporting evidence.

Focused tests additionally cover: incremental checkpoint reuse after failure and
restart; idempotent recovery of partially populated queues using the `total_items=-1`
marker; cancellation before checkpoint/class publication; oversized provider stream
termination; response-array limits before Java list creation; context truncation and
the `context-limits` evidence record; exact bounded edge call-site evidence; and full
snapshot cleanup while workspace notes/bookmarks survive.

The frontend polling assertion executes the shared `serialPolling.ts` module with
deferred promises and a deterministic scheduler. It proves that no next timer is
scheduled until the current request settles, maximum in-flight load is one, stop
cancels timers, and late results after stop are ignored. Packaged Chromium remains
the verification for visible phase/range/validated/elapsed/failure/cancellation state;
all generated screenshots must be visually inspected.

Final 2026-09-10 results: the normal suite passed 78/78 tests. The constrained
fixture passed with maximums of 128 rows/query, 16 symbols/batch, one simultaneous
request, 16,787 prompt bytes and 1,517 response bytes. Its sampled used heap peaked
at 71,516,008 bytes with a 268,435,456-byte maximum. The packaged mock-provider
browser run passed for 61 bulk symbols and produced nine inspected screenshots in
`build/hierarchy-smoke/run-do7c60_n/`. No live-provider claim is made.

## 7. Stable-map interaction baseline and pure state tests (R6, Steps 1-5)

The stable-map work needs browser evidence that survives refactoring: node IDs, model
coordinates, pan, zoom and displayed counts before and after **real** pointer input. A
passing scope-model test cannot establish canvas stability, and `element.emit('tap')`
cannot establish gesture handling.

```bash
python3 scripts/verify_stable_graph_pipeline.py baseline     # records today's behaviour; passes
python3 scripts/verify_stable_graph_pipeline.py acceptance   # asserts the product contract; fails today
node --check scripts/verify-stable-graph-ui.mjs
python3 -m py_compile scripts/verify_stable_graph_pipeline.py
```

`baseline` asserts the known R6 defects so they cannot silently disappear or change shape;
it is expected to start failing when Steps 2-3 land, and that failure means the baseline case
should be retired. `acceptance` encodes the stable-map contract from the product specification
and must never be weakened to accept broken behaviour.

**Fixture.** `test-fixtures/stable-graph-fixture/` holds 74 types across 6 packages. The
17-class `spring-project` fixture cannot exercise the 36 → 12 display-limit regression, because
the Classes page needs more than 36 in-scope types before two **Show more** actions reveal 36.
The fixture's verified topology and its parser limits — unresolved-target relationships never
reach the canvas, self-loops are dropped above METHOD level, field declarations produce no
relationships — are documented in that directory's `README.md`. Pure layout fixtures for
crossings, collinear overlap and self-loop clearance are deliberately separate.

**Runner.** Same Chromium/CDP approach as `verify_hierarchical_pipeline.py`, with an isolated
SQLite data directory and browser profile per run under `build/stable-graph/<mode>-*/`. The
fixture is copied to a temporary directory and SHA-256 hashed before and after, proving
source read-only. Unlike the explanation harness it starts **no** provider: the model base URL
points at a closed loopback port, which verifies that graph exploration works with the model
unavailable. The header still reads "Model configured" because a base URL string is present;
that label is not evidence of reachability.

**Instrumentation.** Counters are installed from the test side onto Cytoscape's own registry
(`.graph-canvas._cyreg.cy`). The application ships no debug object and no graph data leaves the
page. Before Step 3, the canvas was destroyed and recreated on almost every interaction, so DOM
identity proved nothing; each core is still stamped with an incrementing id and the counters
(`layouts`, `fits`, `centers`, `taps`, `dbltaps`, `anyDbltaps`, `arranges` — Step 5) still live on
`window` to survive a *genuine* recreation (which Step 3 makes rare — the canvas is created once per
mount and survives every scope/filter/selection/resize change). Clicks, double-clicks and background
drags use `Input.dispatchMouseEvent`.

Thirty-two scenarios (as of Step 5) cover: clicking a class at 12 and at 36 displayed, clicking a
package, clicking an edge, an unresolved relationship, changing the relationship filter (both for
plain membership stability and for an inspected edge's own survival — see Step 4 below), adding and
removing a package, closing the details pane, resizing the viewport, manual drag persistence, two
spaced single clicks, a double-click control on empty canvas, real double-clicks on a card at two
pacings and at two page sizes plus a second different card (Step 5), the inspector's "Arrange around
this resource" action both enabled and disabled (Step 5), A-to-B-to-C traversal and Back-to-Back
through the real inspector, a Classes→Methods→Classes round trip, out-of-scope inspection, a scope
edit made while a level is inactive, a narrow 430px layout (plain and with a real inspect/return
round trip, and via the inspector's "Arrange around this resource" action from the Details pane a
single tap already switched to — see Step 5 below), and "Code map" returning to the last view. 28
screenshots are written per run and must
be visually inspected.

Baseline results, the trigger inventory behind them, and the two cases classified as *not
reproduced* with inspected alternative causes are recorded in
`docs/STABLE_GRAPH_IMPLEMENTATION.md`.

### Pure reducer tests (Step 2)

```bash
node scripts/test-explorer-view-state.mjs
```

17 checks against `frontend/src/features/explorer/explorerViewState.ts` in isolation (same
runtime-`typescript`-transpile-to-`data:` URL approach as `test-graph-model.mjs`, no bundler). Covers:
inspection never touching level/membership; re-inspecting the same subject/kind being a true no-op;
history deduplication and its 20-entry cap; a never-visited level's first batch in caller-given rank
order; idempotent re-navigation to an unchanged level; the exact Step 1 regression (reveal 36 via two
Show-mores, inspect one, still the same 36 IDs in the same order); an explicit single-class add vs. a
bounded package-batch add; removal without backfill; re-adding a removed class landing at the end,
not its old slot; Show more's full-pending-queue semantics; `NAVIGATE_BACK`'s conservative
never-auto-admit-new-eligibility behavior; and `RESET` reinitializing every level. A passing pure
test proves the reducer's contract, not gesture handling or canvas behavior — the browser pipeline
below is still required for that.

### Step 2 browser re-verification

Re-running `verify_stable_graph_pipeline.py` after a change that fixes previously-baselined defects
requires updating the baseline scenarios whose assertions the fix falsifies — see
`docs/STABLE_GRAPH_IMPLEMENTATION.md`'s Step 2 section for the exact 8 retired assertions across 4
scenarios and their replacements. One mechanical consequence is worth noting for future steps: fixing
"re-selecting the active level is a no-op" retired the test harness's own trick of clicking the
already-active level button to shrink a grown page back down for a scenario's precondition (that
click is now correctly a no-op, so a grown page stays grown). `verify-stable-graph-ui.mjs` gained a
`reload()` helper (fresh page navigation) for scenarios that need a guaranteed small starting page —
any future step that changes navigation/membership semantics should expect similar harness
adjustments, not just application-code changes.

### Pure placement tests (Step 3)

```bash
node scripts/test-graph-placement.mjs
```

8 hand-computable checks against `frontend/src/features/explorer/graphPlacement.ts` (Appendix A3),
same transpile-to-`data:`-URL approach, no bundler: no-survivors places the first card at the
origin; a new batch starts at or below the survivors' actual bounding-box bottom plus 64 units; rows
wrap at the stored strip width, never at a size derived from the batch; row height is the tallest
card actually placed in that row; an oversized card still gets placed and forces itself (and
whatever follows) onto its own row; the stored `appendWidth` is decided once and echoed back
unchanged on every later call; the new batch is sorted by name then ID regardless of input order;
an empty addition list is a true no-op. `explorerViewState.ts`'s own geometry extension (13 new
checks in `test-explorer-view-state.mjs`, 34 total) additionally covers: a placement-bearing
admission produces positions and flips `geometryInitialized`; an admission with no `placement`
record leaves new IDs unpositioned rather than crashing (so callers that only exercise membership,
like most of the original 21 checks, keep working unmodified); removal discards geometry for
removed IDs and a later re-add lands at the new bottom, not the old hole; `geometryRevision` only
bumps when a position is actually written; `geometryInitialized` is monotonic across an
empty-scope transition; `appendWidth` is never recomputed once stored; `SET_CAMERA` is a strict
value-equality no-op on repeat and writes to the `level` named in the action rather than
`activeLevel`; a `SET_CAMERA`/`NODE_MOVED` stamped with a stale `generation` (i.e. from before the
most recent `RESET`) is dropped entirely; `NODE_MOVED` updates exactly the dragged card and is
ignored for an ID no longer displayed; `RESET` gives every level fresh (empty) geometry and bumps
`generation`; and `NAVIGATE_BACK` restores the destination level's camera/positions untouched.

### Step 3 browser re-verification

Step 3 removed `GraphCanvas`'s destroy/recreate-on-topology-change, its selection-triggered
`cy.layout()`/`cy.fit()`, and its resize-triggered `cy.fit()`; positions for a newly admitted batch
are now computed by the reducer (via `graphPlacement.ts`) at admission time and never overwritten
for a survivor. Re-running the pipeline surfaced a harness-side consequence, not an application
defect: several scenarios picked a click target by raw `cy.nodes()[N]` index, which used to be safe
because the canvas was always freshly re-fit to whatever was displayed. Once positions and camera
stop moving automatically, `renderedPosition()` for an arbitrary index can legitimately be outside
the visible canvas box — e.g. a card appended below the initial fit, or a card the last `panAndZoom()`
panned away from — and a synthesized click at an off-canvas point lands on whatever real DOM happens
to sit there (observed: the minimap, which has its own click-to-pan handler, producing a confusing
spurious `panChanged: true` with zero node taps). Fixed by adding `pickVisibleNodeId()` /
`visibleEdgeCandidates()`, which filter to elements whose `renderedBoundingBox()`/`renderedMidpoint()`
actually falls inside the current canvas box before picking a click target — the gesture stays a real
pointer click, it just targets a card the user could actually see and click. All ten `cy.nodes()[N]`
call sites and the edge-click loop were switched to these helpers.

With that fixed, every baseline assertion that asserted layout/fit calls, camera discard, canvas
recreation, or survivor movement on a *non-arrangement* interaction is now false and was retired with
its now-true replacement (mirroring Step 2's precedent) — 15 of 18 scenarios now pass in `acceptance`
mode outright. The three real-double-click scenarios are a partial, expected exception: Step 3 fixing
position stability makes the double-click *gesture* reach the target node reliably for the first
time (previously the first tap's arrangement moved the card out from under the second press), but
the gesture is still wired to `explore()` — the same command Step 5 must separate into a dedicated
`ARRANGE_AROUND_RESOURCE` — so it now reliably causes an unwanted level change (Classes → Methods)
instead of the target arrangement contract. `layoutCalls` in these three scenarios is a fossil of the
old `cy.layout()`-based selection effect Step 3 removed entirely; it will always read 0 regardless of
what Step 5's dedicated command does, since nothing in the current codebase calls `cy.layout()`
anymore. This is recorded here rather than silently left for Step 5 to discover.

Two more scenarios (`manual-drag-persists`, `manual-drag-persists-across-level-switch`) were added
after a self-review pass found that manual-drag persistence was reducer-verified only — a pure test
can prove `NODE_MOVED` preserves state, but not that `dragfree` is actually wired to it end to end.
Both use a real CDP pointer drag (press, six held `mouseMoved` steps, release), not a synthetic
dispatch, and assert exactly one card moves, the camera is untouched, and the new position survives
a level switch away and back.

The same self-review also found that `python3 scripts/verify_hierarchical_pipeline.py` had been
skipped under Step 2's rationale ("explanation harness untouched"), which stopped holding once
`GraphCanvas.tsx` was rewritten end to end — it is the only harness exercising `cxttap`
remove-from-scope, READY sparkle/hover styling, and explanation-refresh camera stability, none of
which the stable-graph harness covers. Re-run and confirmed **PASS** against the rewritten canvas.

### Pure reducer tests (Step 4)

7 new checks appended to `test-explorer-view-state.mjs` (41 total), covering the Appendix F3
extension for a scope edit made while a level is inactive: removing then re-adding an already-
displayed class while a different level is active (appends fresh once actually revisited, not back
into its old slot — the same guarantee the Step 2/3 same-level case already had, now proven across a
level boundary); an explicit class add while away being a true same-reference no-op for the inactive
view (nothing to drop, nothing new tracked yet) and correctly admitted on the next real visit;
`membershipRevision` bumping from an inactive-level-only change even when the active level's own
reconciliation is a no-op; `shadowTrimLevel` being a true no-op (same reference, `initialized`
untouched) on a level that was never visited at all; a `HistoryEntry` recording the geometry
revision current at push time; Back never rewinding a level's geometry to that recorded value (a
drag made after the history push survives a later Back to that entry); and the case flagged by
review as highest-value — an addition made while away is *not* revealed by `NAVIGATE_BACK`
(`batchSize: 0`, unchanged from Step 2/3), stays truthfully pending, and a subsequent Show more
reveals both the originally-pending and the while-away addition together.

### Step 4 browser re-verification

Step 4 disconnected canvas double-click from `explore()` entirely (Step 4 point 1: the drill-down
command must not remain double-click's job once Step 5 needs it for arrangement). This falsified the
three real-double-click baseline assertions that described "drills down to Methods" — retired and
replaced with "double-click no longer changes level" (`levelAfter === levelBefore`), the same
retire-with-a-now-true-replacement pattern Steps 2/3 established. Their `acceptance` checks needed no
change: `layoutCalls === 1` was already forward-looking and still correctly fails, now for exactly
one reason (no arrangement command exists yet) instead of two (it also used to drill down).

Six scenarios are new for this step. Two are worth calling out for their harness technique rather
than just their assertions: **S12** drives the A→B→C traversal through the inspector's own
"Depends on" `.related-row` buttons (`onSelect`, not the canvas), so it is exercising the exact DOM
path Story 6 describes — a pure reducer test cannot prove that clicking a real relationship row
actually reaches `INSPECT_NODE` end to end. **S15** asserts the *exact* resulting ID order
(`[...survivors, targetId]`) and a demonstrably different position for the re-added card, not just a
count — a weaker "count is still 12" assertion would pass even if the shadow-trim fix silently didn't
work and the card had simply never left its slot.

`docs/evidence/stable-graph-step4/` holds the two full reports plus nine inspected screenshots;
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored) holds the complete 27-scenario run.

### Pure focused-arrangement tests (Step 5)

```bash
node scripts/test-focused-arrangement.mjs
```

11 hand-computable checks against `frontend/src/features/explorer/focusedArrangement.ts` (Appendix
B), same transpile-and-concatenate-to-`data:`-URL approach as `test-graph-placement.mjs` (this module
imports the real `placeAdditions` from `graphPlacement.ts`, so both compiled outputs are concatenated
into one self-contained script). Covers: a focus absent from the displayed cards returns `null`
(the inspector/keyboard action's disabled-state contract); an A→focus→C chain places A at exactly
`-(halfWidth+96+halfWidth)` and C at the mirrored `+` offset from the focus; a bidirectional neighbor
lands on the left only, never duplicated on the right; a self-loop does not create a second copy of
the focus card; an isolated resource (no edges at all) is placed as an unrelated card exactly 64
units below the focus's bounding-box bottom (reusing `graphPlacement.placeAdditions`, not a second
row-packing implementation); a reciprocal relationship between two *other* cards does not touch the
focus's columns; mixed card heights in one column stack by actual height plus a 48-unit gap, not a
uniform point spacing; the column x-offset uses each card's actual width (verified at both class and
package dimensions); within-group order is deterministic by qualified name then ID regardless of
input array order; translating the whole result by a different anchor changes only the focus's own
coordinate, never the relative structure between cards; and a method/constructor-level focus is
handled identically to any other card (the algorithm is kind-agnostic).

The 2 new checks appended to `test-explorer-view-state.mjs` (43 total) cover the new
`ARRANGE_AROUND_RESOURCE` action: it overwrites exactly the given IDs' positions for a level (an ID
absent from the result is left untouched) and bumps `geometryRevision` exactly once per dispatch, not
once per repositioned card; and it is dropped when stamped with a stale `generation`, matching
`SET_CAMERA`/`NODE_MOVED`.

### Step 5 browser re-verification

Step 5 gives canvas double-click and a new inspector action their own dedicated
`ARRANGE_AROUND_RESOURCE` command via Cytoscape's own `dbltap` gesture recognition (the first tap
still only inspects, idempotently — a repeat inspect of the same subject is a no-op by construction
since Step 2, so it cannot itself move or unmount anything). This is the **first fully green
`acceptance` run since Step 1**: all three real-double-click scenarios now assert `arrangeCalls === 1`
instead of the retired `layoutCalls === 1` (a fossil noted since Step 3 — nothing in the codebase
calls `cy.layout()` anymore, so that assertion could never have been satisfied by any future step).
`arrangeCalls` is fed by a new `arranges` counter wired to a custom `'arranged'` Cytoscape event the
application now emits (ordinary use of the library's own pub/sub, the same mechanism `'dbltap'`/
`'pan'`/`'zoom'` already use — not a debug object) exactly once per batch in which
`GraphCanvas`'s reconciliation effect actually repositioned an already-displayed survivor, which only
happens for an `ARRANGE_AROUND_RESOURCE` dispatch: an ordinary admission only ever calls `cy.add()`
for a genuinely new element (never rewrites a survivor's position) and a manual drag's position is
already reflected live in Cytoscape by the drag itself (so the diff is zero and nothing re-fires).

One case is deliberately *not* asserted to produce a further arrangement count: a second, immediate
double-click on the exact same already-arranged focus. The algorithm is deterministic and the
translation anchors the focus to its own current (already-unchanged) position, so re-running it
recomputes byte-identical positions for every card — correctly moving nothing. `real-double-click-
second-different-card` proves the command still fires on a genuinely new interaction (a different
focus), and `two-spaced-single-clicks` was extended with `arrangeCalls === 0` to keep the "two
single-clicks cause zero arrangements" half of the acceptance criterion explicit rather than
implied by `dbltaps === 0` alone.

Two new scenarios exercise the inspector's "Arrange around this resource" action — the
keyboard/touch-accessible equivalent required alongside the canvas gesture (H3):
`inspector-arrange-around-resource` opens the inspector on a displayed class via a real single click,
clicks the button, and asserts exactly one arrangement with `dbltaps === 0` (proving the two entry
points are independent paths to the same command) and scope/level/page/zoom/pan all unchanged;
`inspector-arrange-disabled-when-not-displayed` searches for a class that is in scope but not on the
current page and asserts the button is `disabled` with the exact tooltip text ("Resource is not in
current map view").

Re-running the full pipeline surfaced one regression predating this step, not caused by it: Step 4
relabeled the inspector's "See method call graph ↗" button to "View methods ↗" but its own ledger
recorded skipping `verify_hierarchical_pipeline.py` as justified at the time (only navigation/
edge-lookup call sites had changed, it reasoned) — that harness's `scopeUnchanged('inspector
exploration...')` scenario still searched DOM text for the old label and crashed on
`undefined.click()` the first time it was actually re-run against Step 4's change. Fixed the stale
selector in `scripts/verify-hierarchical-ui.mjs` (`'method call graph'` → `'View methods'`); re-ran
and confirmed **PASS**. This is recorded here as the concrete argument for re-running every harness
whose DOM assertions could be affected by a label change, rather than reasoning from "no explanation
code path touched" alone.

A narrow-layout pass (430×900) verifies Step 5 point 5's "the explicit touch action must remain
usable when a single tap opens details" concretely rather than by inspection. On this app's mobile
layout a single tap already switches the pane to Details (`select()` calls `setMobilePane('details')`,
and `.workspace-content` — the canvas's container — is `display:none` while that pane shows), so a
recorded (checks-free, observational) scenario confirms a real double-click's second press does not
reach the canvas there at all (`dbltaps: 0`, only the first tap registers) — empirical evidence for
*why* the keyboard/touch equivalent exists, not a defect. `narrow-inspector-arrange-from-details-pane`
then proves the actual requirement: tapping "Arrange around this resource" from that same Details
pane still drives exactly one arrangement (`arrangeCalls === 1`), and returning to the Map pane shows
the already-applied geometry (GraphCanvas stays mounted — only its container toggles `display:none` —
so the reconciliation effect wrote the new positions regardless of visibility) with the camera
untouched and the canvas instance preserved, exercising `GraphCanvas`'s zero-size `ResizeObserver`
guard with a real pending geometry write for the first time (Step 4's narrow scenario only exercised
that guard with no write queued).

`docs/evidence/stable-graph-step5/` holds the two full reports plus eight inspected screenshots
(before/after pairs for the two real-double-click cases and the inspector action, plus the narrow
Details-pane action and its arranged Map-pane result);
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored) holds the complete 30-scenario run.

## 8. Change-edges acceptance (one line per direction, flow emphasis, grouped evidence)

```bash
./gradlew bootJar
CHROMIUM=/snap/bin/chromium python3 scripts/verify_change_edges_pipeline.py
node --check scripts/verify-change-edges-ui.mjs
python3 -m py_compile scripts/verify_change_edges_pipeline.py
```

**Runner.** `scripts/verify-change-edges-ui.mjs` previously had no launcher: it took four positional
arguments (`<appBase> <chromiumDebugBase> <snapshotId> <outputDir>`) and required the operator to
start the jar, start Chromium, analyze a fixture and read a snapshot ID out by hand. That made it
the one browser suite nothing could run unattended, so change-edges regressions could not fail CI.
`scripts/verify_change_edges_pipeline.py` closes that gap with the same shape as
`verify_stable_graph_pipeline.py`: free ports, an isolated SQLite data directory and browser profile
under `build/change-edges/run-*/`, a temporary **copy** of `test-fixtures/change-edges-fixture/`
SHA-256 hashed before and after to prove analysis stayed source read-only, and a model base URL
pointed at a closed loopback port so this can never be mistaken for a live-model verification.

**What the suite asserts.** One line per ordered pair (a mutual relation draws exactly two), width
following occurrence count, `.flow-out`/`.flow-in` direction classes and `.rel-out`/`.rel-in`/
`.rel-both` halos on the right cards, the inspected line's own endpoints emphasized rather than
dimmed, and native dash offsets advancing with selection. Selected edges retain their
line/terminal-arrow colors and receive incoming indigo or outgoing cyan underlays.
Pixel checks verify the left-indigo/right-cyan split ring, transparent card content
and controls above the overlay. Reduced-motion resize keeps the split ring aligned.
The suite also checks no animated style remains after deselection, evidence grouped one section per
file with several highlighted lines, and a chosen occurrence surviving a relationship-filter change.

**Non-colour differentiation.** Direction is carried by `border-style` as well as hue — solid for
output-only, dashed for input-only, double for mutual — so the three halos remain distinguishable
under a colour-vision deficiency (WCAG 2.1 SC 1.4.1). The suite asserts all three styles differ.

`docs/evidence/change-edges/` holds the report and the inspected screenshots from a full run.

## Design layer (ADR 0014)

- Backend: `./gradlew test --tests "dev.codeatlas.design.DesignLayerIntegrationTest"` — MockMvc over the analyzed
  `spring-project` fixture in a private SQLite directory: authoring at every level and parser-shaped keys;
  status against parser facts (a designed CALLS between parsed classes whose methods call each other is
  IMPLEMENTED); atomic change sets (a bad second operation saves nothing, `dryRun` never persists); rejected
  kinds, parents, endpoints and renames of parsed code; rename re-keys children (a constructor follows its type)
  and relations; delete cascades without touching unrelated explanations; the engineer explanation reaches the
  model context as an untrusted `design-` block and stales a READY generated explanation; export → import into
  another workspace yields MISSING placeholders, PLANNED resources, preserved authors, layout, and an idempotent
  second import; a brief without the JSON block is a 400.
- Frontend pure logic: `node scripts/test-design-model.mjs` (overlay merge, design-only vs annotated cards,
  designed routes kept apart by `aggregateEdges`, keys mirroring `DesignKeys`, parameter parsing, intent) and
  `node scripts/test-design-exchange.mjs` (layout capture by key and re-application to other snapshot IDs:
  positions, nested/ungrouped expansions, sizes, camera, scope; copies, never aliases).
- Browser: `python3 scripts/verify_design_layer_pipeline.py` (packaged jar, headless Chromium, COPIES of
  `spring-project` and `stable-graph-fixture` hashed before/after, model URL on a closed port). Adds a package
  from the empty-canvas menu and a class from the card menu, explains a parsed class (intent shown first,
  generated explanation labelled), applies an agent change set over REST while the map is open (picked up
  without reload, author shown), checks a planned method and that Undo leaves design edits alone, exports the
  brief from the toolbar, imports it into the second workspace and checks the same card position in the new
  tab. Screenshots: `docs/evidence/design-layer/`.

### Design-mode direct manipulation (ADR 0015)

- Backend: `DesignLayerIntegrationTest.promptListsOnlyDesignedWork` covers `GET /design/prompt`:
  - an empty layer gives one line, and the response is `no-store` Markdown;
  - sections come in order;
  - planned resources show their parent chain;
  - an intention on parsed code sits under "Change existing code";
  - the relation semantics sentence is present, and implemented relations are listed only under "verify";
  - ORPHANED items are under "Needs attention";
  - no undesigned parsed class, and no JSON block.
- Pure:
  - `test-design-model.mjs`: inline names, default relation kinds, intent/details join, change-set builders.
  - `test-expansion-layout.mjs`: the slot is the next `placeMissingChildren` cell, and it only grows the box
    right and down. ADR 0017 (`designBlocks`): a short last row gives a card-sized gap inside the box and no
    reserve; a full grid gives one 220×150 reserve (`DESIGN_LEAST_BLOCK`, ADR 0017 round 2); a resized box gives gaps on the right; no full card in a
    gap touches a child; a sliver below the least size is no gap; an empty box is one card-sized block; and
    `roomMoves` keeps a box's reserve as a child grows.
  - `test-explorer-view-state.mjs`:
    - design IDs parked through Design off and on keep top-level and in-box geometry;
    - a collapsed parent drops them;
    - drag and arrange carry parked children, nested too;
    - a pinned new card lands where it was typed.
- Browser: `verify_design_layer_pipeline.py` now drives real pointer and keyboard input (CDP `Input`):
  - an inline package from a real right-click lands where it was typed;
  - double-click opens the popover in design mode (no arrangement);
  - "+ class" on hover of an expanded package: the draft sits on the slot, and the card lands exactly there;
  - ADR 0017: only the block under the pointer shows a button. A one-class package has one small reserve.
    The service package's short last row has gaps: a class made in one keeps the gap's corner, the package
    does not stretch, one gap fewer remains, and no stale button shows. An empty planned class expands onto
    one block at its own corner, and its first method lands there. No top-level card overlaps another after
    any of these;
  - ADR 0017 round 2: hovering 20 px off a fixed spot puts the block under the pointer; every created card
    has exactly its block's corner and size; a space narrower than a card still makes a (narrower) card;
  - ADR 0017 in fixture B: the method-less parsed type `RegionTag` expands onto one block, and a drag moves
    it exactly (no creep). With Design off it is an unexpanded card that lands where it was dropped;
  - Esc and empty-blur cancel with nothing on the server;
  - "+ method" in a parsed class: a bad name shows the inline error, then `findByCustomer(Long customerId)`
    gives key `…findByCustomer(Long)`;
  - two-click relation: the handle sits on the right edge, the rubber band ends at the pointer (screenshot),
    and no Cytoscape elements are added;
  - the popover preselects USES_TYPE and a kind change replaces the relation; Esc cancels a pending relation;
  - double-click on a designed route opens its popover;
  - Design off then on returns every design card to identical positions, including inside a parsed class box;
  - with Design off, double-click arranges;
  - Prompt dialog contents.
- Screenshots: `docs/evidence/design-layer-ux/`. The git-review, ungroup, change-edges and stable-graph browser
  scripts start with Design off, because they pin the Design-off contract.

### Add-block review fixes (ADR 0017 round 3)

- Pure:
  - `test-expansion-layout.mjs` loads the real `DESIGN_LEAST_BLOCK` and `addSlotSizes` through
    `placementGeometry` (220×150; class card 250×206, method card 250×184). It covers:
    - the reviewer's counter-examples: F5, a band whose natural spot lies inside a child's GAP, now a
      250×206 gap with no reserve; F6, a diagonal child that the greedy cut used to lose, now a full card;
    - fractional bounds (F4): the block stays inside the inner area and keeps GAP, with and without the 8 px snap;
    - exact 220 px gaps, and no gap at 219 px;
    - hovers at the inner corner, below and beside a child, and on the header band or padding;
    - a stable answer across a tie;
    - fuzz: 400 random layouts, where every block keeps GAP, contains the pointer, stays inside the inner area,
      and is between the least block and a card in size, and none is missed when a brute-force 222×152 box
      exists; 200 more for `freeRect`;
    - `blockStillOpen` (F9);
    - a resized empty box (F17): it offers its card-sized corner block for any hover; with that block as its
      first child the box keeps its corner and size; a block elsewhere would move it; through
      `geometryForJourney` it keeps its resized size;
    - `emptyBoxCenter` / `emptyBoxAnchor` are inverses (F32);
    - a 100-child benchmark (F8): it prints its timings, and fails above 200 ms.
  - `test-graph-model.mjs`: `childlessExpansionsAsCards`. An empty expansion is a `drawnAsCard` card
    outside design mode; an ungrouped empty box is a card in every mode; boxes with children are untouched;
    with nothing to change it returns the same object (F11, F12).
  - `test-design-model.mjs`: `takeAdmitted` keeps a pending pin or growth until the graph holds its card (F3).
  - `test-explorer-journeys.mjs`: `RECONCILE_ALL` passes every open and closed tab its own id, with no history
    entry (F3, F10).
  - `test-node-card.mjs`: design mode is an explicit `hasDetailsButton` / `cornerButtons` parameter; a stray
    `designExpandable` field no longer counts (F35).
  - `test-design-exchange.mjs`: a resized box's `minSize` is exported and imported.
- Browser (`verify-design-layer-ui.mjs`, real CDP mouse input):
  - exact sizes: the reserve is 220×150, an empty class opens on a 250×184 block, an empty package on a
    250×206 block, the draft outline equals the block, and the narrow card is at least 220 wide;
  - F1, on the empty class: a double-click inside it opens the popover and drops the draft; a real click on its
    collapse square collapses it, and a real click on its details square expands it again; there is no Ungroup
    square and no Ungroup menu item (F11);
  - 2e, an empty package:
    - expand, then undo and redo onto the same block;
    - a draft at zoom 0.3: its outline equals the block, its content is at 0.6 scale, and its input is at least
      20 px tall;
    - a pointer resize, then a hover far away offers the corner block, and the first class keeps the box's model
      area exactly and its drawn box within 2.5 px;
    - hovers clamp exactly at the inner corner, keep GAP beside a child, and give nothing within GAP or on the
      header band;
    - F3: the create request is held back 9 s while an agent change lands through the 4 s overlay poll. The poll
      is asserted to land while the class is still absent, and the class still takes its block's 250×172 shape.
      Negative control, one run: with every pending entry consumed on every reconciliation (the old rule), this
      step fails with 250×206;
    - F10: a cloned tab shows the class at the same 250×172;
  - 6a, on `RegionTag` (F12): collapse, type a design class `MarkerNote` into its package, expand with Design
    on (3 cards and `MarkerNote` make room), Design off, then menu Collapse. Every other leaf card is back within
    1 px, and so is the parked design class; the round trip adds no overlap, and Design on then shows a plain card.
    Negative control, one run: measured on the raw graph, `MarkerNote` stays 66 px off;
  - overlap checks run among siblings inside every container as well as on the map, with 1 px tolerance (F14).
  - F27(5): NoteIndex is dragged 300 px right, a hover in the space it left (straight off the dragged card) offers a
    block, and the class made there takes its exact shape, with no sibling overlapped;
  - `test-expansion-layout.mjs`: `containerLabelLayout` leaves a label that fits unchanged, and otherwise keeps it
    inside the box and 10 px clear of the corner squares.

### Quick intent popup, plain prompt, design-only projects (ADR 0016)

- Backend (`DesignLayerIntegrationTest`):
  - `promptIsAPlainRequestForOutstandingWork`: Add / Change / Connect lines with their wording; an explained
    parsed relation is stored with origin CODE and appears under Change; nothing about the tool, keys,
    statuses or the API; implemented and orphaned items are left out.
  - `designOnlyProjectHoldsAnImportedMap`: `POST /api/workspaces/design-only` gives an empty published
    snapshot whose graph loads; analysis is a 400; an imported brief stores parsed dependencies as CODE
    (MISSING, resolution CODE) and designed ones as AUTHORED; only designed work reaches the prompt; a
    re-export keeps `layer: CODE`; the workspace list says `designOnly`.
  - `authoringAtEveryLevelComputesStatusAgainstTheCode` now expects an explained parsed relation as CODE/PRESENT.
- Pure:
  - `test-design-model.mjs`: two-click relations are always CALLS; CODE relations merge with the parser route
    and never worsen its resolution, designed ones stay apart; imported cards are `isImported`.
  - `test-design-exchange.mjs`: an exported layout re-applies by key onto a design-only graph (all `design:`
    IDs) with identical positions, expansions, sizes and camera, and captures back to the same layout.
  - `test-node-card.mjs`: imported cards have no design badge and say "imported"; `noSource` hides the code button.
- Browser (`verify_design_layer_pipeline.py`):
  - the quick popup follows a new package (no kind), a class (kind INTERFACE saved with the intent in one
    set), a method (no kind) and a two-click relation (CALLS, centred on the relation's middle), always with
    the intent focused and no dialog; Esc saves nothing;
  - Import/Export sit under the zoom controls, right-aligned; Prompt stays at the top;
  - the Prompt has the plain Add / Change / Connect lines and none of the product words;
  - first-page Import opens the export as a design-only project: every card at identical position, size and
    parent, nothing extra, Changes disabled, Design on, imported code not violet, routes grey.

## 9. On linting

There is deliberately no lint step. `frontend/package.json` previously declared
`"lint": "eslint src/"`, but ESLint was never in `devDependencies` and no `eslint.config.*`
ever existed, so the script could not run — `npx` silently fetched a transient ESLint 10,
which then failed with exit code 2 for want of a flat config. A script that has never
executed is worse than no script: it implies a gate that was not there.

The script has been removed rather than made to work. Adding ESLint plus a TypeScript
plugin and a config is new infrastructure, and AGENTS.md requires a concrete need and an
ADR for that. The concrete need is not yet established: `tsc -b --noEmit` runs on every
build (`npm run build` and `./gradlew bootJar` both invoke it) and already rejects the
type errors that matter here. If a lint gate is wanted later, it should arrive with an
ADR naming the rules it enforces and wired into `bootJar` so it can actually fail CI.

## Language boundary regression checks

`AnalysisPortRegistryTest`, `AnalysisServiceDispatchTest`, `JavaAnalysisAdapterTest`,
`LanguageMigrationTest`, `LanguageMigrationExplanationIntegrationTest`,
`ReviewServiceLanguageTest`, `WorkspaceLanguageIntegrationTest`, and the updated
`ReviewApiIntegrationTest` cover adapter dispatch, duplicate registrations,
V011-to-V012 backfill/non-null constraints, backwards-compatible Java workspace reuse,
rejection of unshipped languages before snapshots/Git capture, workspace-language propagation
to both retained review snapshots, Java framework-pass execution,
visible diagnostics when Spring analysis skips a malformed file, and propagation when recording
a failed job also fails. The migrated-explanation integration test seeds V011 data, verifies
its preservation through V012, regenerates with the actual ExplanationService and a synthetic
mocked ModelClientService, and reads READY/evidence/provenance through MockMvc. It does not
verify live transport; the separate mock HTTP pipeline exercises local transport. The workspace language API test
uses its own temporary database. Existing Java
parser, evidence, review and explanation tests retain their original expectations.

Run `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_language_import_pipeline.py`
after `./gradlew bootJar`. This runner starts an isolated packaged backend and Chromium,
imports a copied fixture through the real form, checks the Java-only selector and request
payload, re-analysis, recent projects without snapshots, and graph loading with an unreachable model endpoint. Desktop/mobile
screenshots and the report are written under `build/language-import/`; inspect them.

Source-viewer navigation (ADR 0013) has three pure suites: `scripts/test-find-in-file.mjs` (literal matching,
Unicode whole word, cap, stepping), `scripts/test-code-tokens.mjs` (tokenizing Go- and Dart-shaped files from
occurrence rows, UTF-16 columns, stale rows, the data-driven hint) and `scripts/test-navigation-stack.mjs`
(back/forward with scroll offsets). `NavigationServiceTest` drives `/files/occurrences` and `/files/definition`
over HTTP with a fake non-Java `fixture` language whose engine writes `code_occurrences`.
`python3 scripts/verify_code_navigation_pipeline.py` (after `./gradlew bootJar` and `./gradlew installScipJava`,
with a `gradle` on PATH) imports two copies of `test-fixtures/scip-gradle-project` through the real form, one with
scip-java and consent and one with JavaParser. It drives Ctrl/Cmd+hover and click, Alt+arrows, Ctrl/Cmd+F,
Enter and Shift+Enter with real CDP input. It checks that the copies stay byte-identical and that every page
request stayed on the local app. Screenshots and `navigation-report.json` go under `build/code-navigation/`;
inspect them. The accepted set is in `docs/evidence/code-navigation/`.

`verify_filtering_zoom_settings.py` uses a local rejecting HTTP stub to verify profile
handling; `verify_hierarchical_pipeline.py` uses synthetic explanation responses. Neither
is a live-model check. `verify_explanation_pipeline.py --mock` runs its end-to-end
checks with a deterministic loopback provider, including validated evidence and
provenance. Without `--mock`, it requires explicitly configured
`CODEATLAS_MODEL_BASE_URL` and `CODEATLAS_MODEL_MODEL_ID` (and credentials in the environment
if needed); it has no public-provider fallback. Its source fixture and database are isolated.
Both explanation and filtering runners use `verification_support.py` for HTTP requests,
fixture hashes and server lifecycle. Spring and the local stubs bind port zero directly;
the runner reads the actual Tomcat port and waits for health before making API requests.

When running the broader backend suite locally, set `CODEATLAS_DATA_DIR` to a disposable
directory because older integration test classes still use the default application property.
Create that directory first. Step11's exact verification commands and screenshot evidence
are recorded in [the remediation evidence](evidence/step11/README.md).

The stable-map browser harness checks both Cytoscape renderer hits and
`document.elementFromPoint` before sending real CDP edge clicks. Renderer geometry
alone can select a point covered by the minimap or another DOM overlay. The S4
report records actual pointer targets and camera state for each dispatched click;
its original before/after camera assertion spans all attempts, without resetting
the camera. The separate `s4-diagnostic` Node configuration intentionally clicks
an intercepted minimap SVG point to investigate this failure mode; it is not an
acceptance pass. Run the normal Python runner with `acceptance` for the full gate.
