# Project status
Last updated: 2026-09-10
Active milestone: R6 — Developer comprehension redesign (in progress)
Current revision: R6 hierarchical graph scope and explicit canvas deselection

## Current acceptance slice: hierarchical graph scope and explicit canvas deselection — complete

Implemented on 2026-09-10, frontend-only:
- The navigation pane now preserves the complete flex-height chain: `.scope-tree` is a shrinking flex column, its toolbar is fixed, and `.package-tree` is the sole `flex: 1; min-height: 0; overflow: auto` region. Large trees scroll inside the pane while recent symbols and workspace controls remain visible. Shared single-child namespace paths start open, branch points start collapsed, and selecting/searching a symbol reveals its owning package path.
- `scopeModel.ts` builds a display-only trie from flat dotted PACKAGE facts. Synthetic namespaces never become graph symbols. Their checkbox state aggregates the existing real-package check states, and their batch toggle selects or removes every real descendant package. A selection that covers the whole graph normalizes to `ALL`; leaf package and class behavior remains unchanged.
- Scope changes during an open snapshot are explicitly limited to the tree controls, scope-labelled reset/select-all controls, and canvas removal. Search results, node/edge inspection, graph double-click, package/class inspector exploration, route cards, the brand, breadcrumbs, and Code map navigation preserve scope. `explore()` changes only the inspected subject and useful graph level; loading a different snapshot still initializes a valid whole-system scope.
- Cytoscape `cxttap` on an in-scope package, class, method or constructor opens a focused, keyboard-visible “Remove from scope” menu. Package/class removal uses `togglePackage`/`toggleClass`; method/constructor removal resolves the enclosing class through `ownerAt('CLASS', …)` and uses `toggleClass`. Native graph context menus are suppressed, and Escape, outside click, graph navigation, or topology changes dismiss the menu.
- The packaged browser fixture is created as a temporary read-only copy with 36 extra dotted package branches. No backend or persisted graph schema changed; parser PACKAGE facts remain flat and authoritative.

Verification:
- `node scripts/test-graph-model.mjs` — PASS, including dotted package-trie construction, nested ordering, synthetic aggregate checked/indeterminate/unchecked states, multi-package immutable toggles, whole-system normalization, existing scope projection, and polling checks.
- `npx tsc -b --force` (from `frontend/`) — 0 errors.
- `npm run build` (from `frontend/`) — successful production build; 44 modules transformed. The existing >500 kB bundle advisory remains.
- `./gradlew test bootJar` — BUILD SUCCESSFUL; **84 tests, 0 failures/errors/skips**, and the executable jar contains the rebuilt frontend.
- `node --check scripts/verify-hierarchical-ui.mjs`, `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, and `git diff --check` — successful.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS against the packaged jar, isolated SQLite, temporary 41-package/17-class source fixture, local mock provider, and headless Chromium. Raw CDP verified compact initial expansion, selected-package reveal, internal tree overflow/scrolling after expansion, `com > example > overflow > area00` nesting, namespace checked/indeterminate transitions, scope stability across every reported non-scope action, native context-menu prevention, Escape/outside dismissal, and real right-button removal of package/class/method nodes. Existing explanation acceptance also passed for 61 CLASS/METHOD subjects in exact SQL order, SQLite integrity, and unchanged source hashes. This is mock-provider verification, not live-provider verification.
- Captured 12 screenshots in `build/hierarchy-smoke/run-s7okddha/`. Visually inspected `scope-tree-desktop.png`, `scope-context-menu.png`, and `narrow-scope-tree.png` at 1500×980 / 430×900: hierarchy indentation and check states are legible, branch points are compact until opened, the selected package path is revealed, the scrollbar stays within the expanded tree, fixed navigation/footer controls remain accessible, the focused context action is unobscured, and there is no horizontal page overflow.

Remaining limits:
- Package hierarchy is a visual projection of dotted names. It does not invent parent PACKAGE symbols or graph relationships, and modules that deliberately reuse an identical package name remain represented by the backend's existing package identity behavior.
- Physical mouse right-clicks and the shared Cytoscape `cxttap` path were verified. A physical touch long-press was not separately emulated. No live-provider quality, latency, or tokenizer claim was made.
- `docs/BUILD_BRIEF.md` remains absent; `docs/BUILD.md` is the available build brief and was read. Unrelated untracked `.agents/`, `.claude/`, root `package.json`, `skills-lock.json`, and prior user files remain untouched.

No ADR was needed: this completes the existing frontend scope boundary without changing backend facts, schemas, dependencies, or infrastructure. The previous explicit-scope entry below is historical and superseded where it described Focus actions as scope mutations.

## Previous acceptance slice: repository-size-independent explanation memory — complete

Implemented on 2026-09-10:
- `ArchitectureBatchProcessor` pipeline 3.0 no longer accepts or returns repository-sized DTOs. Packages/types use `(qualified_name,id)` keysets; relationships/package coupling use `id` keysets with ancestry resolved only for the current page; documents use `id` plus bounded character ranges; checkpoint reductions use fixed fan-in; and classes use ID-keyset batches capped at 16. Every validated slice summary and class purpose is written transactionally to SQLite before the next batch. Downstream reduction and final publication page persisted artifacts; no complete inventory String or all-class purpose Map is reconstructed.
- Architecture run/checkpoint identity is scoped to immutable snapshot facts, document revisions, endpoint/model, prompt/pipeline versions, token/body budgets, and relevant batch settings. A failed bounded request receives at most three capped-backoff attempts. Size failures split only the current bounded input. Cancellation is checked inside checkpoint/publication transactions; incomplete staging never becomes a visible DRAFT/READY synthesis. Final publication checks exact active-class coverage and uses `INSERT … SELECT`.
- Explain All creates no Java list of the complete queue. SQLite keyset-pages active CLASS/METHOD IDs, computes indexed degree/LOC metadata, and idempotently upserts one bounded page. `jobs.total_items=-1` distinguishes incomplete population from a valid empty queue, enabling restart recovery without premature completion. Claims remain ordered by `relation_count ASC, loc ASC, subject_id ASC, id ASC`; relationships remain on-demand. One worker/semaphore limits outstanding provider requests to one and abandoned `IN_PROGRESS` work is reset safely.
- The shared `ContextBuilder` bounds related symbols/methods, relationship and call-site occurrences, source/prior-explanation characters, project documents, and global inventory rows. It fetches source/TEXT lazily with SQL `substr`, spends a combined token/body-aware budget, and adds a structured `context-limits` evidence record. Symbol, method, bulk and edge explanations all use this path; bounded edge contexts retain endpoint and exact call-site evidence subject to the occurrence cap.
- `ModelClientService` now uses Java's streaming HTTP body handler, serializes each bounded request once, reads at most `maxResponseBytes + 1`, and rejects request/response oversize independently of token settings. Response text/array/claim/ID counts are validated before publication. Logs contain neither prompts/source/responses nor credentials. There is no provider fallback.
- Flyway V006 adds reduction-plan fields, staged class purposes, and initial ordered-query indexes; V007 adds generated-work cleanup; V008 adds keyset/status indexes; V009 supplies full foreign-key-ordered snapshot cleanup while preserving workspace logical symbols, notes, bookmarks and documents. Document invalidation removes only unfinished unreferenced runs and marks successful prose stale rather than deleting it.
- Queue-status schema 2 is aggregate-only. The shared React serial poller never overlaps requests, schedules only after resolution, stops on terminal/inactive state, workspace change or unmount, and ignores late results. Inspector-only requests emit one terminal graph refresh so edge READY indicators update without reviving global polling. Current phase/range, validated count, elapsed time, failure/cancellation, and existing READY shine remain visible.

Measured root cause and bounds:
- Before this slice, code-path inspection found unbounded `queryForList`/collection growth for all architecture types/packages/couplings/documents, all summaries, every class purpose, all bulk subjects, and complete collaborator/member/relationship sets; the synthetic dimensions would have produced a 10,000-entry purpose Map and a 60,000-row Java queue list, with relationship collections able to reach 100,000. The old implementation had no bounded counters, so these are inspected cardinalities, not reconstructed measurements.
- The pre-change baseline `./gradlew test --no-daemon` had 72 tests and `/usr/bin/time -v` reported 535,372 KiB maximum RSS for the combined Gradle/test processes. The final normal suite has more tests and reports 596,876 KiB; this whole-process RSS is included for transparency and is not an isolated heap comparison.
- The final 10,000-class / 50,000-method / 100,000-relationship constrained fixture completed under a 256 MiB test-worker heap. Deterministic high-water marks were **128 rows returned by one instrumented query, 16 symbols retained in a batch, 1 simultaneous model request, 16,787 prompt UTF-8 bytes, and 1,517 response bytes**. Sampled used test-worker heap peaked at **71,516,008 bytes** of a 268,435,456-byte maximum. `/usr/bin/time -v` reported 544,544 KiB maximum RSS for the combined Gradle daemon and test JVM, so it is not presented as worker heap.

Verification:
- `./gradlew test --no-daemon` — BUILD SUCCESSFUL; **78 tests, 0 failures/errors/skips**.
- `./gradlew constrainedMemoryTest --no-daemon` — BUILD SUCCESSFUL in 2m22s with `-Xmx256m`; one synthetic scale test, metrics above, no `OutOfMemoryError`.
- `./gradlew bootJar --no-daemon` — BUILD SUCCESSFUL; packaged frontend included. Vite's existing >500 kB bundle advisory remains.
- `node scripts/test-graph-model.mjs` — PASS, including execution of the real shared polling module with deferred requests (maximum one in flight, no schedule-before-settle, late result ignored after stop).
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, `node --check scripts/verify-hierarchical-ui.mjs`, and `git diff --check` — successful.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS against the packaged jar, isolated SQLite, local mock provider and Chromium: 61 CLASS/METHOD bulk subjects in exact SQL order, zero bulk relationships, visible bounded-stage progress and stop control, READY updates, refresh/poll lifecycle, SQLite integrity, and unchanged imported-source hashes. This is mock-provider verification, not live-provider verification.
- Visually inspected all nine 1500×980 / 430×900 screenshots in `build/hierarchy-smoke/run-do7c60_n/`. Phase/range/timer/validated state fits the narrow footer without horizontal overflow; completed state reads “Explain all completed,” shows 61 explained / 0 queued, and removes the stop control; class/method/edge shine and hover remain visible; settings and evidence panels remain usable.

Remaining limits:
- **No live-provider quality, latency, streaming-protocol, or provider-tokenizer verification.** The HTTP body is consumed incrementally to a hard cap, but the OpenAI-compatible endpoint used here returns one JSON response rather than token-by-token application streaming. Summaries remain lossy generated interpretation.
- Total SQLite storage, provider calls and elapsed time grow with repository size. Sequential generation is deliberate for deterministic bottom-up ordering and a one-request memory bound. Checkpoint artifacts referenced by a synthesis remain for provenance until that snapshot is explicitly deleted.
- The document management API still returns its contract-limited set (maximum 30 × 100,000 characters) for editing; explanation construction never loads that set and instead pages metadata/content slices. The main frontend bundle warning is unchanged.
- `docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` is the available build brief and was read. Unrelated `.claude/` and `skills-lock.json` remain untouched.

Decision: [ADR 0005](docs/adr/0005-bounded-explanation-working-sets.md), with updated [architecture](docs/ARCHITECTURE.md), [schema](docs/DATA_MODEL.md), [testing](docs/TESTING.md), and prompt notes. The codebase-design deep-module vocabulary shaped the narrow `ArchitectureBatchProcessor` and shared `ContextBuilder` boundaries.

## Previous acceptance slice: 500 classes and ten context documents — complete

Implemented on 2026-09-09:
- `ArchitectureBatchProcessor` keeps small projects on a single architecture request, while large projects summarize every inventory/document/coupling slice and draft bounded class batches. Input and output limits both influence planning. Provider context rejection, truncated output and incomplete class coverage split work into smaller requests; malformed/foreign/duplicate outputs never publish partial coverage.
- Pipeline 2.1 caps architecture output batches at 16 classes even when Settings names a very large output allowance. The footer shows the exact class range or context batch in flight, an animated activity mark, elapsed request time and the independently truthful count of validated checkpoints. A slow first model response no longer looks like an idle `0/262` job.
- V005 adds durable architecture checkpoints with exact input/output provenance and job stage/count fields. Cancellation stops between requests; successful in-flight stages can be retained. Retries reuse matching checkpoints; changed documents/model inputs select new keys. Complete class drafts publish atomically before the existing sequential degree/LOC/ID queue proceeds. Relationships remain on-demand.
- Provider-neutral token estimates replace the one-byte-per-token restriction, reserving output, framing and a variance margin. Context slicing scans only the next bounded slice, preserving Unicode and every document tail. The model adapter detects output truncation before parsing JSON and classifies explicit context/payload-size rejection.
- Settings no longer impose arbitrary 1,000,000-context/32,768-output HTML maxima. They explain the configured model's finite per-request limits and automatic batching. The footer reports current preparation activity and saved batches. Individual contexts retain source/neighbor/owner purposes with disclosed omissions; prompt 3.1 emphasizes business rules, branches, state changes and collaborator responsibilities.

Verification:
- `./gradlew test bootJar` — BUILD SUCCESSFUL; **72 tests, 0 failures/errors/skips**. Frontend TypeScript/Vite compiles and the executable jar packages successfully. The existing >500 kB main-bundle advisory remains.
- The scale acceptance fixture contains **500 classes, five methods and ten documents totaling 877,120 characters (about 857 KiB)**. At **8192 context tokens / 512 output tokens**, it verifies complete reconstruction of original context slices, exact class coverage, bounded requests, provenance, and full bulk execution: **52 saved context stages, 250 class batches, 505 READY full explanations, zero relationship explanations**. These are synthetic database/model fixtures, not live semantic-quality measurements.
- Additional tests cover cancellation/resume without replaying validated batches, provider outages, document invalidation, provider context rejection, truncated class output, large individual context retaining its owner's purpose, Unicode boundaries, and model windows above the former UI caps. Existing ordering, edge exclusion, generated-evidence grounding, freshness and migration tests pass.
- `node scripts/test-graph-model.mjs` — PASS, including the user's explicit scope controls and READY aggregation.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS with packaged app, isolated database, local mock HTTP provider and Chromium. It verifies 61 fixture bulk symbols, deterministic request order, explicit edges, large-context batching, saved-stage progress, Settings maxima removal, SQLite integrity and unchanged source hashes.
- Browser assertions cover live READY updates, refresh polling, preserved viewport, reduced motion, narrow layout and no runtime exceptions. Visually inspected `narrow-context-progress.png` and `narrow-batched-ready.png` in `build/hierarchy-smoke/run-xgmstwuu/`; the progress view shows the active batch and advancing timer at 430px without horizontal overflow. The run contains nine screenshots. The selected edge correctly remains STALE after document changes because bulk does not regenerate relationships.
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, `node --check scripts/verify-hierarchical-ui.mjs`, and `git diff --check` — successful.
- Intermediate checks caught outdated oversized-input-failure expectations, a TypeScript optional-max access, a test document exceeding the existing document-size contract, and a CDP test serializing a DOM element. Each was corrected before the passing checks above.

Remaining limits:
- **No live-model quality or latency verification for this revision.** Summaries are necessarily lossy; configured context/output values must match the actual model. There is no unlimited-context claim or provider fallback. Individual source windows still disclose shortening/omission.
- Total requests, latency and local checkpoint storage grow with project size. Successful checkpoints are retained; this slice does not introduce eviction or semantic document retrieval. The existing document API permits up to 30 documents of 100,000 characters each.
- Previous successful prose is preserved under existing freshness rules. The user's committed graph scope changes and unrelated untracked `.claude/` / `skills-lock.json` are preserved.

Decision: [ADR 0004](docs/adr/0004-bounded-architecture-batches.md), with updated [architecture](docs/ARCHITECTURE.md), [schema](docs/DATA_MODEL.md) and [testing](docs/TESTING.md). The original single-request/oversized-failure statements in earlier status entries below are historical and superseded.

## Previous acceptance slice: explicit graph scope control — complete

Implemented on 2026-09-09, frontend-only:
- New `ScopeSelection` model (`frontend/src/features/explorer/scopeModel.ts`): `mode: 'ALL' | 'CUSTOM'` plus explicit `selectedPackageIds`/`selectedClassIds` sets, with pure helpers (`isClassInScope`, `isNodeInScope`, `getPackageCheckState`, `getScopeCounts`, `scopeToLabel`, `togglePackage`, `toggleClass`, `focusScopeSelection`). Packages are flat in this data model (`JavaParserAdapter` never links a `PACKAGE` to another `PACKAGE`), so package/class membership resolves via the existing `ownerAt('PACKAGE', …)` helper — no invented package-nesting concept.
- `graphModel.ts`'s `projectGraph` now takes a `ScopeSelection` instead of a single seed ID. Membership is scope-only; a focused/selected node no longer pulls in out-of-scope neighbors. Returns `scopedCount`/`visibleCount`/`omittedCount` instead of a single `omitted` count, so the UI can state an honest "showing N of M in scope."
- `frontend/src/features/explorer/NavigationPane.tsx` (previously an unused placeholder) is now the real, active package/class tree: `Select all`/`Clear` toolbar, tri-state package checkboxes (native `indeterminate`, `aria-checked="mixed"`), per-class checkboxes, and a keyboard-reachable `⌖` Focus action per row. Methods are intentionally not shown in this tree (scope is package/class granularity; methods inherit class scope) — reachable via graph level, search, or the inspector's Methods section as before.
- `App.tsx`: selecting a subject for inspection (tree label, graph node, search result, inspector related-item) no longer narrows the graph — it only updates the inspected subject and, where useful, the graph level. `explore()` is now "Focus scope": isolates the clicked package/class and moves to the next useful level. The graph-level segmented control now preserves the current scope ("View at this level") instead of resetting it. A persistent scope banner above the canvas states the exact boundary, the current level's count within it, an honest paginated count with the existing "show more," an "Inspecting …" chip for the selected subject, and "Reset to whole system" when custom. Breadcrumbs show scope / level / inspected subject. An empty custom scope shows an intentional empty state with `Select all`, instead of an empty graph.
- Deliberate omission: the previous "click a node, see it plus its collaborators" focused-neighborhood view is not reimplemented (the brief marks it optional and gates it behind explicit ghost/boundary-node styling). This is a visible behavior change from the prior revision — clicking a class no longer auto-narrows the graph to its neighborhood, by design, so scope stays exclusively user-controlled from the tree/Focus actions.

Verification for this slice:
- `node scripts/test-graph-model.mjs` — PASS. Extended with scope-projection cases (package, class, method, mixed-package, empty, all-selected scope), a "no hidden neighborhood expansion" regression check, and scope-helper unit tests (tri-state check state, immutable toggle/materialize-from-ALL behavior, `scopeToLabel`).
- `npx tsc -b --force` (frontend) — 0 errors. `npm run build` (Vite) — succeeds; existing >500 kB main-bundle advisory unchanged (pre-existing, not from this change).
- `./gradlew test bootJar` — BUILD SUCCESSFUL, all 61 backend tests pass (backend untouched by this slice), jar packaged with the new frontend bundled in.
- Live browser verification: launched the packaged jar, reused an already-indexed `test-fixtures/spring-project` snapshot (70 nodes/42 edges/5 packages/17 classes), and drove the real UI via raw Chrome DevTools Protocol (headless Chromium, no npm dependency, same approach as `scripts/verify-hierarchical-ui.mjs`) at 1500×980 and 390×844. Confirmed: fresh load starts whole-system with every checkbox checked; unchecking a package removes it from the CLASS-level graph and banner switches to "N packages selected"; "Reset to whole system" restores every checkbox; "Focus scope" on a class isolates it and jumps to METHOD level; "Clear" shows the intentional empty state and its "Select all" restores whole-system; selecting a different tree label while a custom scope is active leaves the scope banner text unchanged (selection doesn't erase scope); narrow (390px) layout has zero horizontal overflow; zero uncaught runtime exceptions during the whole run. Five screenshots captured and visually inspected (desktop whole-system, class-level after unchecking a package, focus-scope method level, empty-scope state, narrow explorer pane).
- `git diff --check` — clean.

Limits and skipped verification:
- Interactive checkbox/focus-button behavior was verified via CDP DOM clicks against the real running app (not a mocked harness), but no automated regression test captures these DOM interactions for CI; only the pure scope/projection logic has an automated (`node scripts/test-graph-model.mjs`) check. A future pass could add a lightweight CDP or component-test harness for the tree interactions themselves.
- Did not re-verify the explanation pipeline (READY sparkle, Explain all) in this session; this slice touches only scope/navigation code and the existing explanation call sites were left structurally unchanged (`InspectorPanel`/`GraphCanvas` explanation rendering untouched).
- The focused-neighborhood graph view (seed + collaborators) from the prior revision is intentionally not carried forward; see deliberate omission above.

## Previous acceptance slice: hierarchical explanations — complete

Implemented on 2026-09-09 against the actual R6 implementation:
- Explain all queues only active CLASS and METHOD symbols. Edges and other symbol kinds remain on-demand.
- Durable architecture synthesis precedes bulk symbols: complete inventory/stereotypes, all project documents and package coupling; exact CLASS JSON coverage is validated before atomic draft persistence.
- V004 stores separate class drafts, synthesis evidence/provenance/freshness, consumed explanation dependencies and queue ordering. Drafts are visible in the inspector and never count as READY.
- Sequential processing orders symbols by incoming + outgoing occurrence count, declaration LOC, then ID. The legacy concurrency hint is accepted but execution deliberately stays sequential. Matching fresh synthesis and existing READY explanations survive resume.
- Shared contexts propagate owner/member/caller/callee/collaborator explanations and drafts, including endpoint source and exact evidence for on-demand relationships. Generated-only citations cannot prove SOURCE_FACT claims. Changed consumed outputs stale downstream explanations while retaining their evidence.
- READY class/method cards and edge labels/hover cards display a glowing purple/blue sparkle; the shared inspector shows it beside Ready. Grouped edges require every occurrence to be READY. Candidate/unresolved styling remains independent.
- Graph status refresh preserves pan/zoom. Inspector polling resumes for explicit refresh and bulk status changes. Subject-scoped display prevents a previous subject's READY badge flashing on a newly selected unexplained edge. Unresolved relationships can also be opened from the inspector list.

Verification for this slice:
- `./gradlew test` and `./gradlew test bootJar` — successful; latest suite: **61 tests, 0 failures/errors/skips**, including 12 hierarchy acceptance tests and a V003→V004 upgrade test.
- `./gradlew bootJar` — successful, frontend TypeScript/Vite compiled and executable jar packaged. Vite reports its existing advisory that the main bundle exceeds 500 kB.
- `node scripts/test-graph-model.mjs` — PASS, including mixed/READY/stale edge aggregation and escaped SVG labels.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS using an isolated local mock provider, temporary database and packaged app. Verified 61 bulk symbols in exact model-request order, zero bulk relationships, explicit edge generation, SQLite integrity/foreign keys and unchanged fixture source hashes.
- Chromium assertions: live draft→READY update, class/method/edge/hover sparkle, refresh after READY, viewport preservation, reduced motion, 430px narrow layout, no horizontal overflow and no runtime exceptions.
- Visually inspected PNGs in `build/hierarchy-smoke/run-e21seu6v/`: `architecture-draft.png`, `class-ready.png`, `method-ready.png`, `edge-ready.png`, `edge-hover-ready.png`, `narrow-edge-ready.png`.
- Final browser rerun also verified and visually inspected `build/hierarchy-smoke/run-ocraw3mz/narrow-synthesis-failed.png`: the complete-input budget error remains readable at 430px without horizontal overflow. All seven final screenshots are in that run directory.
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py` — successful.
- `git diff --check` — clean. Existing untracked root `package-lock.json` preserved.

Limits and skipped verification:
- **No live-model quality/latency verification for this revision.** The browser provider is a local deterministic mock; the prior live-run claims below are historical.
- Complete global input is never silently truncated. Large inventories/documents require a sufficient Context Budget; incomplete model output fails atomically and may require a larger Output Budget. Individual source/prose context is bounded with explicit omissions.
- Ordering is the requested degree/LOC heuristic, not a topological guarantee that every method precedes its class. Explicit clicks can take priority after the relevant architecture barrier.
- Scope remains the indexed Java snapshot; source-only import still does not evaluate target builds or runtime Spring behavior.
- `docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` contains the original brief and was read along with the other documentation. Runtime inspectors live in `InspectorPanel`; the separately named legacy inspector files are unused placeholders.

Decision and contracts: [ADR 0003](docs/adr/0003-hierarchical-explanations.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [tests](docs/TESTING.md). The requested acceptance slice is complete; the next product review is explanation quality against the user's configured model.

## Earlier R6 redesign verification (historical)


The user requested a full redesign matching `docs/pics/`, project documents in explanation context, whole-codebase context for Explain All, corrected dependency navigation/layout, a compact bottom-left minimap, and explicit method-code buttons. Prior R0–R5 claims below are historical, not verification of this revision.

A prior Codex CLI session implemented the redesign but was cut off mid-task by a usage-limit error before it could visually verify the result against `docs/pics/`. This revision reviewed that work, fixed defects found, and completed the verification.

Implemented and browser-verified against `docs/pics/`:
- Light developer workspace, left package-tree sidebar, package/class/method abstraction, focused caller-left/target-right neighborhood layout, source dialogs (view-on-click only, never default), and a compact, correctly-proportioned minimap moved to bottom-left.
- Local project document CRUD with revisioned evidence and explanation invalidation.
- Codebase inventory/package coupling, documents and collaborator evidence in explanation requests; relationship prompts carry real facts.
- Earlier R6 included methods and relationship occurrences in Explain All. Superseded by the current hierarchy slice above: bulk includes CLASS/METHOD only; relationships remain on-demand.
- Parser stores overload identities, private methods, exact declaration/call evidence, and Spring relationship evidence.

Bugs fixed this revision:
- **Removed client-identity spoofing**: `ModelClientService` was sending hardcoded `claude-cli`/`anthropic-version`/`anthropic-beta` headers (documented as a deliberate attempt to pass one provider's WAF client verification) to what is supposed to be a generic local/loopback model endpoint. Removed those headers and the matching `api.agentrouter.org` hostname rewrite; added a plain, user-configurable User-Agent field to the model profile (Settings screen, backend DTO/config) instead. Anyone relying on the old spoofed identity to pass a specific provider's WAF must now set their own honest User-Agent value in Settings.
- Fixed a duplicate-`DEPENDS_ON`-edge bug: N call sites between the same two classes were creating N duplicate class-level `DEPENDS_ON` rows instead of one aggregate row with multiple evidence occurrences.
- A single file failing to parse (Pass 1/2) could throw and discard every other file's facts for the whole snapshot; both passes now catch per-file, log a diagnostic, and continue, matching the existing Spring-analysis pass's behavior.
- `Explain All`'s requested concurrency was silently ignored after startup (worker pool stuck at 1); the worker pool now actually grows to the requested size without interrupting in-flight workers.
- Halved `ExplanationService`'s per-explanation cost: mid-generation staleness detection was rebuilding the full whole-codebase context twice; it now compares a cheap documents+model-profile fingerprint instead (the only inputs that can change while a published snapshot is being explained).
- `SourceService` no longer always claims a retained snippet is `exact`; it now re-hashes the live file (when present) and compares against the hash captured at index time, surfacing "may be outdated" in the View-code dialog on mismatch.
- Frontend: fixed an inflated/double-countable "Depends on" badge count in the Inspector panel (now derived from what's actually rendered); guarded an unhandled-exception crash on the `?snapshotId=` deep-link restore path when graph metadata is missing; fixed the focus-aware graph layout not re-running for package or edge selections (only class/method selections happened to trigger it before); bounded the explanation-status polling interval to stop once status is terminal instead of polling forever; added a null-guard on source content in the View-code dialog.
- Removed dead code: an unused `AnalysisService.markSymbolsDeleted` method, three unused `apiClient` methods, and the no-longer-imported `cytoscape-dagre`/`cytoscape-navigator` npm dependencies (and their stray type declaration).

Verification performed this revision:
- `./gradlew clean test bootJar` — BUILD SUCCESSFUL, all 49 backend tests pass, single-executable jar produced.
- `npx tsc -b --force` (frontend) — 0 errors. `node scripts/test-graph-model.mjs` — PASS (aggregation, direction, repeated sites, uncertainty, method neighborhoods, filtering, bounded views).
- Fresh end-to-end run: new workspace against `test-fixtures/spring-project` with a brand-new database, analysis completed (51/51 items, 0 failures), graph API returned 70 nodes / 42 edges with deduplicated `DEPENDS_ON` edges, and the View-code endpoint returned `exact: true` for a live-hash-verified method.
- Headless-browser screenshots (`graph_canvas_preview.png`, `explanation_inspector_preview.png`, replacing the pre-redesign captures left by the prior session) confirmed against `docs/pics/`: light theme, sidebar package tree, labeled dependency edges, compact bottom-left minimap with a correctly-scaled current-viewport box, and a class Inspector panel with AI-explanation section and non-default "View class/method code" buttons.

Known remaining limitations:
- No LLM endpoint was configured in this session, so live explanation generation (the actual model round-trip) was not re-verified end-to-end; only the request pipeline up to and including the model call was exercised.
- The project-documents tab and other click-only interactions (as opposed to URL-addressable views) were verified by code review and endpoint testing, not by automated browser click simulation (no browser-automation tooling is available in this environment).
- A prior codex-session live run recorded one permanently `FAILED` relationship explanation after exhausting retries; the underlying cause was not reproduced or specifically retested here since no live model was configured.
- `scripts/verify_explanation_pipeline.py` now accepts a `CODEATLAS_USER_AGENT` environment variable to set on the model profile; since the spoofed `claude-cli` identity was removed, a provider whose WAF requires a specific client identity (e.g. the AgentRouter endpoint this script defaults to) needs that env var set, or the connection test will fail.

## Milestone mapping (Revised Plan R0-R5 to BUILD.md M0-M4)
- **R0 — Verified foundation** (maps to M0): Toolchain verification, starter docs, rule bridge, database baseline, synthetic model check, parser test fixture. [COMPLETED]
- **R1 — First complete comprehension workflow** (slices of M1 + M2): Source-only import, 2-pass parsing, snapshot persistence, graph view, node/edge evidence lookup, and cited local model explanation. [COMPLETED]
- **R2 — Whole system and 100-class traversal** (scales M1 + M4): 100-class fixture, package/module hierarchy, aggregate relationships, filtering, zoom-to-selection, minimap. [COMPLETED]
- **R3 — Spring meaning and static request exploration** (maps to M3): Stereotypes, injection candidate resolution, qualifiers, bean factories, route mappings, static call paths. [COMPLETED]
- **R4 — Complete explanation coverage and incremental updates** (combines M2 bulk explanation + M4 incremental updates): Resumable Explain All, durable item statuses, change detection, stale invalidation. [COMPLETED]
- **R5 — Packaging and release verification** (maps to M4 completion): Packaged distribution, loopback security, offline UI bundling, performance benchmarking. [COMPLETED]

## Active Milestone
**R5** - Packaging and release verification [COMPLETED]

## Verified Capabilities
- **Environment Verified**: JDK 21.0.12, Node 22.22.1, npm 9.2.0.
- **Single-Executable Distribution**:
  - Gradle task pipeline (`npmBuild` -> `copyFrontend` -> `processResources` -> `bootJar`) automatically bundles compiled React 19 / Vite assets into `BOOT-INF/classes/static/`.
  - Application packaged as self-contained standalone executable JAR (`build/libs/review-assist-0.1.0-SNAPSHOT.jar` and `code-atlas-0.1.0-SNAPSHOT.jar`, ~42 MB).
  - Browser UI served directly at `http://127.0.0.1:8085/` with zero Node.js/npm runtime requirement at execution time.
- **Loopback & Local Security Hardening**:
  - Embedded Tomcat strictly binds to `127.0.0.1:8085` (verified via socket inspection).
  - CORS policy locked down to loopback origins (`127.0.0.1:8085`, `localhost:8085`, `127.0.0.1:5173`, `localhost:5173`).
  - External and cross-network origins rejected with HTTP `403 Forbidden`.
  - `.gitignore` hardened to prevent leakage of credentials (`*.token`, `*.key`, `*.pem`), secrets (`.env`, `application-local.yml`), caches, and SQLite database files.
- **Performance & Scale Benchmarks (100 Classes)**:
  - 100-class fixture (`test-fixtures/large-project`) indexed across 10 packages in **~600 ms** (0.50s via HTTP API).
  - 310 symbols and 770 total relationships (470 internal graph edges) extracted and persisted into SQLite.
  - Graph traversal query returns 310 nodes and 470 edges in **3–4 ms**.
  - Persistent SQLite WAL mode active (`PRAGMA journal_mode = wal`) with 5000ms busy timeout.
  - Foreign key integrity validated (0 violations via `PRAGMA foreign_key_check`).
  - SQLite integrity check passes (`PRAGMA integrity_check = ok`).
  - JVM heap memory strictly bounded at **~26 MB** during 100-class indexing.
- **Spring Comprehension (R3)**:
  - Stereotype detection (`@RestController`, `@Service`, `@Repository`, `@Component`, `@Configuration`).
  - Route extraction concatenating class-level and method-level paths (7 routes verified).
  - Dependency injection analyzer with constructor and field `@Autowired` / `@Qualifier` candidate matching (7 injection points verified).
  - Relationships: `EXTENDS`, `IMPLEMENTS`, `CALLS`, `DEPENDS_ON`, `INJECTS`, `DECLARES_BEAN`.
- **Explanation Queue & Change Detection (R4)**:
  - Priority queue with user-click priority 100 ahead of bulk jobs (priority 0).
  - Durable retry tracking, restart recovery, and cancellation marking items as `SKIPPED`.
  - SHA-256 content hashing and incremental multi-snapshot diffing marking modified/deleted items `STALE`.
- **Graph Filtering & Compound Hierarchy Fix**:
  - Compound-aware filtering in `GraphCanvas.tsx` properly keeps ancestor containers (`PACKAGE`, `CLASS`) visible when filtering by `CLASS`, `METHOD`, or Spring stereotypes (`REST_CONTROLLER`, `SERVICE`, `REPOSITORY`, etc.).
  - Cytoscape parent hiding bug resolved: compound parents are visible if any descendants match and hidden only when all descendants are hidden.
- **Zoom Optimization & Floating Canvas Controls**:
  - Tuned Cytoscape options with `wheelSensitivity: 0.2`, `minZoom: 0.1`, and `maxZoom: 4.0` for responsive mouse/trackpad interaction.
  - Reduced tap-to-focus animation duration to 200 ms.
  - Added on-canvas floating zoom toolbar providing quick-access `+` (Zoom In), `-` (Zoom Out), `⛶` (Fit to View), and `1:1` (Reset Zoom) controls.
- **Optimized Graph Layout (Squarish Package Aspect Ratio & Coupling-Based Clustering)**:
  - Eliminated thin and elongated package containers by replacing 1D vertical Dagre stacking with balanced 2D multi-column distribution of child nodes inside classes and packages.
  - Dynamically calculates optimal grid dimensions `(cols, rows)` to mathematically bound package aspect ratios between ~1:1 and 4:3.
  - Implemented coupling-weighted force simulation where inter-package edge density (`INJECTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `DECLARES_BEAN`) exerts attractive spring force pulling connected packages into close proximity (e.g. controllers and services, services and repositories).
  - Bounding-box clearance repulsion prevents package container overlaps while centering gravity preserves overall graph cohesion.
  - Aligned compound parent labels (`node:parent`) to the top with dedicated padding, preventing class name text from colliding with child method nodes.
- **OpenAI & Local LLM Settings Feature**:
  - Comprehensive `SettingsScreen.tsx` modal supporting OpenAI, Ollama, LM Studio, and Custom provider presets.
  - Configurable parameters: Base URL, Model ID, API Key / Token (with Show/Hide toggle), Context Budget, Max Output Tokens, Timeout, and Temperature.
  - Backend `ModelClientService` attaches `Authorization: Bearer <token>` when `apiKey` is configured, uses configurable timeout, temperature, and tokens.
  - `ModelProfileController` connects `GET /api/model-profiles` (masking API token for security), `POST /api/model-profiles` (updating in-memory configuration), and `POST /api/model-profiles/test` (live capability ping returning real latency and status/error details).
  - Frontend persists settings to backend in-memory profile and browser `localStorage`.

- **Workspace Path Normalization & Robust API Error Handling**:
  - `WorkspaceService` normalizes repository input paths: strips enclosing double/single quotes, trims whitespace, expands `~` to `user.home`, resolves relative paths to absolute paths, and validates directory existence with clear messages.
  - Implemented `@RestControllerAdvice` `GlobalExceptionHandler` mapping `IllegalArgumentException` (400), `NoSuchElementException` (404), and unhandled `Exception` (500) to structured `ApiError` responses (`timestamp`, `status`, `error`, `message`, `path`).
  - Frontend `apiClient` wraps all fetch requests via `requestJson<T>`, safely intercepting network failures and HTTP errors before calling `res.json()`, preventing `SyntaxError: JSON.parse: unexpected character at line 1 column 1` on non-JSON or error payloads.
  - Frontend `App.tsx` guards against empty paths and validates response IDs before dispatching analysis jobs.

- **End-to-End LLM Explanation Pipeline (Milestones R1 & R4 Live Verified)**:
  - Added REST endpoint `GET /api/snapshots/{snapshotId}/symbols/{symbolId}/explanation` in `ExplanationController` returning `ExplanationResponse` (or `NOT_REQUESTED`/queue status).
  - Implemented `ContextBuilder` extracting bounded source slices, Spring stereotypes, HTTP routes, dependency injections, and incoming/outgoing relationship facts with unique evidence IDs (`ev-source`, `ev-roles`, `ev-route-n`, `ev-inj-n`, `ev-out-n`).
  - Implemented `PromptTemplate` strictly grounding explanations in parser facts (per AGENTS.md invariant: "Parser/rule facts own graph structure. Model output owns explanations only").
  - Enhanced `ModelClientService`: strips markdown code fences (```json ... ```), automatically handles `response_format` fallback when unsupported/blocked, normalizes router URLs, and sanitizes API keys from all error traces. (The `claude-cli/2.1.119` client-identity header mentioned here at the time has since been removed — see R6.)
  - Enhanced `InspectorPanel.tsx`: full explanation viewer with colored status badges (`READY`, `STALE`, `RUNNING`, `QUEUED`, `FAILED`, `NOT_REQUESTED`), short label, hover summary, structured claims classified by basis (`FACT`, `INFERRED`, `UNKNOWN`), clickable evidence pill tags, uncertainties list, and provenance details.
  - Automatic queue re-fetching: re-fetches active node explanation when queue status updates, giving instant UI feedback without full page refresh.

## Verification evidence
| Check | Command/action | Result | Date/revision |
| --- | --- | --- | --- |
| Environment preflight | `java -version`, `node -v`, `npm -v` | JDK 21.0.12, Node 22.22.1, npm 9.2.0 verified | 2026-09-07 |
| Spring unit tests | `./gradlew test --tests "dev.codeatlas.analysis.SpringAnnotationAnalyzerTest"` | 17 tests passed (0 failures, 0 errors, 0 skipped) | 2026-09-08 |
| Spring integration test | `./gradlew test --tests "dev.codeatlas.analysis.AnalysisServiceSpringIntegrationTest"` | 1 test passed (validates 9 R3/R4 checkpoints) | 2026-09-08 |
| 100-class scale benchmark | `./gradlew test --tests "dev.codeatlas.analysis.LargeProjectBenchmarkTest"` | 1 test passed (100 classes parsed in 608ms, graph query 3ms, WAL mode, 26MB heap) | 2026-09-08 |
| Context builder unit tests | `./gradlew test --tests "dev.codeatlas.explanations.ContextBuilderTest"` | 1 test passed (symbol context, evidence extraction, prompt invariants) | 2026-09-08 |
| Explanation API integration | `./gradlew test --tests "dev.codeatlas.api.ExplanationApiIntegrationTest"` | 3 tests passed (NOT_REQUESTED, QUEUED, READY status & claims mapping) | 2026-09-08 |
| Model profile unit tests | `./gradlew test --tests "dev.codeatlas.api.ModelProfileControllerTest"` | 4 tests passed (GET masking, in-memory updates, test delegation) | 2026-09-08 |
| Model client unit tests | `./gradlew test --tests "dev.codeatlas.modelclient.ModelClientServiceTest"` | 4 tests passed (fence stripping, URL normalization, unconfigured check, error reporting) | 2026-09-08 |
| Model profile API integration | `./gradlew test --tests "dev.codeatlas.api.ModelProfileApiIntegrationTest"` | 2 tests passed (MockMvc GET profile, POST update, POST test) | 2026-09-08 |
| Workspace API integration | `./gradlew test --tests "dev.codeatlas.api.WorkspaceApiIntegrationTest"` | 5 tests passed (empty path 400, missing path 400, file path 400, quotes/tilde 200) | 2026-09-08 |
| Complete test suite | `./gradlew test` | 38 tests passed across 9 suites (100% pass) | 2026-09-08 |
| Frontend compilation | `npm run build` in `frontend/` | TypeScript compile and Vite bundling succeed (0 errors) | 2026-09-08 |
| Single-executable packaging | `./gradlew bootJar` | Produces `code-atlas-0.1.0-SNAPSHOT.jar` (44.6 MB) with bundled static UI assets | 2026-09-08 |
| Live LLM explanation pipeline | `python3 scripts/verify_explanation_pipeline.py` | 100% pass: AgentRouter ping (2.9s latency), Spring workspace ingest, OrderController priority explanation generation via `deepseek-v4-flash`, DB persistence, and Inspector screenshot | 2026-09-08 |
| Headless UI inspection | `/snap/bin/chromium --headless --screenshot` | Verified `explanation_inspector_preview.png` showing OrderController explanation, claims, and evidence pills | 2026-09-08 |

## Known limitations and blockers
- Model client requires a reachable OpenAI-compatible endpoint (e.g. AgentRouter, OpenAI, Ollama, or LM Studio) to generate real LLM text; offline mode safely marks items failed/retrying without crashing.
- Source analysis is Java-only; annotation processors and bytecode weavers (Lombok, AspectJ) are not executed at import time (by design per AGENTS.md trust boundaries).

## Decisions made this session
- [ADR-0001](docs/adr/0001-technology-stack.md): Technology stack selection.
- [ADR-0002](docs/adr/0002-packaging-and-loopback-security.md): Single-executable packaging, offline static UI bundling, and loopback security.
- ~~AgentRouter compatibility headers: Attached `User-Agent: claude-cli/2.1.119 (external, cli)` and anthropic headers to pass AgentRouter WAF client verification.~~ Superseded in R6: this impersonated the Claude Code CLI's identity to a third-party service and was removed; the model profile now has a plain, user-configurable User-Agent field instead.
- Graceful `response_format` fallback: Model client attempts `json_object` format and transparently falls back to unconstrained JSON prompting if the provider returns HTTP 400 or content-blocked errors.
- Markdown fence stripping: Regex/brace extractor strips markdown code fences (```json ... ```) so models that wrap JSON in markdown are accepted cleanly.
- Grounded explanation context: ContextBuilder deterministically extracts target symbol source slices, Spring roles, HTTP routes, injection points, and graph relationships, labeling each with an evidence ID.
- Structured Inspector Viewer: InspectorPanel displays explanation status badges, short label, hover summary, structured claims grouped with BASIS (`FACT`, `INFERRED`, `UNKNOWN`) tags and evidence pills (`[ev-source]`, etc.), uncertainties, and provenance.
- Compound node filtering: Propagates visibility upward to container ancestors (`PACKAGE`, `CLASS`) so Cytoscape never inadvertently hides children of a compound parent.
- Security-hardened model settings: `GET /api/model-profiles` returns `hasApiKey: boolean` and never transmits raw API tokens back to the client; API tokens are applied in-memory and attached as `Authorization: Bearer <token>` HTTP headers.
- Zoom toolbar placement: Positioned at top-right of canvas to avoid collision with Cytoscape navigator/minimap at bottom-right.
- Squarish package layout & coupling proximity: Replaced single-column Dagre TB ranking with a 2D multi-column child distribution and a physics-driven coupling simulation, ensuring balanced package aspect ratios (~1:1 to 4:3) and proximity for strongly coupled packages.
- Safe API deserialization: Extracted a reusable `requestJson` helper in `frontend/src/api/client.ts` that checks HTTP status (`res.ok`) and `Content-Type` header, extracting error messages from structured JSON or truncating HTML/text before throwing descriptive errors instead of raw `JSON.parse` crashes.
