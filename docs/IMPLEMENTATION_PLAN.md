# Code Atlas — revised implementation plan

This replaces the execution plan supplied for review. Keep `docs/BUILD.md` as the product specification and `docs/pics/` as visual references. This plan refines implementation order and resolves defects; it does not claim the application or environment has been verified by this review.

## Instructions to Antigravity

Work in the existing `/home/sajjad/projects/review-assist/` application workspace. Preserve its existing documents, images and any implementation added since the previous plan. Java is already installed by the user and a local model is available. Do not reinstall Java, run package-manager installation commands, create a second application repository, or request workspace confirmation.

Read `docs/BUILD.md`, inspect the images, and inspect current code before making changes. Use this revised sequence where it supersedes the earlier plan. Start implementation after a concise preflight report. Continue through the milestones; do not stop merely because the foundation compiles. Update PROJECT_STATUS.md at verified checkpoints. If the session ends or an actual blocker occurs, leave precise resume instructions and honest status.

The first product checkpoint is: import Java source, select a real relationship, obtain a descriptive explanation from the user's local model, and open matching source evidence. A health endpoint and placeholder screens alone do not meet it.

## 1. Keep the architecture; fix the plan

Retain the modular Java/Spring backend, React/TypeScript frontend, JavaParser adapter, SQLite storage, Cytoscape graph and backend model adapter. Keep graph facts independent of generated explanations. Avoid adding microservices, another parser engine or a graph database.

Resolve these problems before copying proposed code:

| Finding in the supplied plan | Required correction |
| --- | --- |
| Java installation and workspace are presented as approval questions | Verify the existing JDK and use the already selected workspace. |
| `build.gradle.kts` leaves the `plugins` block open | Fix the syntax and verify the real build. |
| No Gradle is installed, but wrapper generation uses `gradle wrapper` | Bootstrap using a trusted official starter containing wrapper files, or a verified local Gradle distribution. Commit the wrapper scripts, JAR and properties, with distribution checksum. |
| Version table disagrees with executable snippets | Select one compatible set, record resolved versions and commit the frontend lockfile. Remove unsupported claims of verification. |
| React/TypeScript/Vite/Cytoscape versions differ across sections | Make manifests and resolved dependency output authoritative. Verify wrapper peer dependencies if using a React graph wrapper. |
| Root AGENTS.md is claimed to be always active | Configure and verify an Always On Antigravity workspace-rule bridge to it. |
| AI `descriptive_label` is stored in the canonical relationship row | Store generated labels with versioned explanations; join them when serving the graph. |
| Symbol IDs are single-column primary keys despite multi-snapshot semantics | Separate logical identities from per-snapshot symbol records. |
| Model work is deferred although a local model exists | Test the actual model early and deliver a cited edge explanation in the first product checkpoint. |
| `.env.example` implies copying to `.env` automatically configures Spring | Implement an explicit supported configuration path and document it. |
| Vite writes generated output into `src/main/resources/static` | Build to `frontend/dist`; copy assets into generated backend resources during packaging. |
| Migrations are verified only by application startup | Verify migration history, schema integrity, restart and an upgrade path. |
| A standalone `javac Order.java` check lacks annotation/dependency classpath | Use parser assertions or compile a deliberately compilable fixture with declared dependencies and isolated output. |
| User is assigned health/build checks the agent can perform | Agent runs these checks and captures screenshots; user feedback focuses on comprehension and usability. |

Do not replace the current stack with latest major releases automatically. Choose maintained, compatible versions for the installed JDK and verify them with actual dependency resolution and builds. Label proposed versions as proposed until verified.

## 2. Preflight: use what is installed

Read-only checks in the user's workspace:

```bash
pwd
git status --short
java -version
javac -version
node --version
npm --version
```

If the workspace is not a Git repository, report that normally; do not let the status check abort other discovery. Check the JDK used by the build as well as the shell. Once available, run `./gradlew --version`. If a required JDK is installed but not visible to Antigravity, configure this project's toolchain/launcher to use it without altering the user's global Java installation. If it is incompatible, report the exact requirement and installed version before proposing a remedy.

For the local model, reuse known project configuration without printing credentials. If the endpoint/model ID are absent, ask once for the base URL and model ID or provide Settings fields for them. Do not ask whether the user has a local model again. Do not assume a port or scan unrelated services. An API key, if required, is configured locally rather than pasted into chat.

Before large implementation work, perform two small integration checks:

- Fresh SQLite database: create its parent directory, migrate, write/read a row, close and reopen.
- Configured model: optional model listing followed by a small chat request using synthetic code. Record supported response modes, actual model ID and observed latency without logging secrets/source prompts.

Manual model-ID entry must work when `/models` is unsupported. Keep model capability detection independent of repository indexing. A temporary model failure should not block parser and graph work, but the first checkpoint must remain explicitly incomplete until its live explanation check passes.

## 3. Data contracts before implementation

Define versioned API DTOs and a small OpenAPI contract for workspace creation, analysis jobs, graph queries, symbol/relationship/evidence details, explanation jobs and model settings. Define status enums once. Use validated configuration properties, input validation and structured API errors.

### Identity and snapshots

Use this conceptual model, adapting exact names during implementation:

| Record | Identity and rules |
| --- | --- |
| Workspace | UUID, canonical root, active snapshot ID and scope settings. |
| Logical subject | Workspace-scoped logical key for a type, callable or relationship; supports notes/navigation across unchanged snapshots. |
| Symbol version | Unique row ID plus snapshot ID and logical symbol key. Unique `(snapshot_id, logical_symbol_key)`. Include source-set/module identity and full callable signature. |
| Relationship occurrence | Snapshot-scoped row linking symbol-version rows, kind, call-site occurrence and explicit resolution. No default that silently labels an edge resolved. |
| Source file version | Snapshot ID, relative path, content hash, encoding and retained source content/reference. |
| Evidence | File-version ID and exact range. Define line/column conventions and test UTF-8, CRLF and editor-coordinate conversion. |
| Explanation | Subject version, model/prompt/schema/context provenance, generated content and freshness. |
| Job/item | Persistent job plus per-subject work records, attempt counts, status, deduplication key and failure reason. |
| Note/bookmark | Workspace and logical subject identity, with an orphan/relink state if its subject disappears. |

Enforce that relationship endpoints, parents and evidence references belong to the same snapshot using composite foreign keys or equivalent database constraints. Validate polymorphic explanation subjects transactionally, or use separate typed foreign keys with an exactly-one constraint.

Distinguish a call occurrence from a class-level aggregate. Keep occurrence IDs and evidence when aggregating. An unresolved target remains identifiable as unresolved text/location; candidate targets must not become resolved calls by default.

Include packages/modules as explicit navigable graph entities or documented deterministic projections. Represent HTTP routes explicitly when request-flow work starts; do not force routes into a schema that only recognizes Java classes/methods.

Build each snapshot in a staging state. Publish it and update `active_snapshot_id` atomically only after its facts are internally consistent. Valid partial analysis may be published with explicit diagnostics. A failed or canceled job must leave the previous active snapshot intact. Late AI results remain attached to their original snapshot.

### Storage behavior

Enable foreign-key enforcement on every connection. Configure WAL, busy timeout and a bounded write path; do not hold transactions during model requests or lengthy parsing. Run one migration owner, create the data directory before opening the datasource, and use tested connection initialization.

Use ordered versioned migrations with checksums. Do not add `IF NOT EXISTS` everywhere to conceal schema drift. Test fresh creation, restart and a representative upgrade against the selected Flyway/SQLite versions. Verify their exact dependencies instead of assuming the Boot BOM picks the listed Flyway version.

### Explanation content

One validated explanation response can contain all three presentation levels:

```json
{
  "schemaVersion": "1",
  "subjectVersionId": "relationship-occurrence-id",
  "shortLabel": "Saves the newly created order",
  "hoverSummary": "Passes the new Order to the repository save method and receives the saved entity.",
  "claims": [
    {"text": "Calls the repository save method.", "basis": "source_fact", "evidenceIds": ["ev-42"]},
    {"text": "Appears to separate persistence from orchestration.", "basis": "inferred_purpose", "evidenceIds": ["ev-42"]}
  ],
  "unknowns": ["This call does not establish database commit timing."],
  "suggestedNextSymbolIds": []
}
```

Short labels and hover summaries are also claims: validate them for unsupported certainty, and label generated content. Programmatic evidence-ID validation cannot establish semantic truth; evaluate examples manually against source. Keep deterministic facts authoritative.

Store endpoint/profile identity, model ID/revision, prompt/schema version, source/neighborhood hashes and generation options in the cache fingerprint. Set output/context budgets explicitly and disclose missing context. Do not invent certainty percentages.

## 4. Revised delivery sequence

Use R0–R5 identifiers to distinguish this reordered execution plan from BUILD.md's original M0–M4. Record that mapping in PROJECT_STATUS.md rather than having two competing active milestone systems.

### R0 — Verified foundation

Scope:
- Inspect existing environment and preserve work.
- Bootstrap a reproducible build and verify one consistent dependency set.
- Create concise AGENTS.md, PROJECT_STATUS.md, README and the initial ADR.
- Configure the Antigravity rule bridge.
- Establish backend, frontend, migrations and the model connection check.
- Create a tiny parser fixture with independently authored expected facts.

Exit evidence: backend/frontend build, database survives restart, configured model responds to synthetic input, actual environment and limitations recorded. Create other documents when the related contract is designed; avoid spending the entire increment generating empty documentation.

### R1 — First complete comprehension workflow

Scope:
- Register a canonical local source root with exclusions and source-only analysis.
- Parse a small repository using two passes: declarations/indexing first, relationship resolution second. Configure module/source-set roots; preserve diagnostics for missing types and malformed files.
- Persist a snapshot and show actual classes and relationships in the UI.
- Select a class/method/edge, retrieve evidence, and open retained source at the correct range.
- Use the real configured model to explain one class, one method and one relationship.
- Implement short descriptive label, hover/focus summary and click/tap pinned inspector.
- Persist explanation results and keep graph navigation working with the model offline.

Exit evidence: a browser walkthrough of import → graph → edge → local explanation → source. For three subject types, manually compare generated claims with evidence. Confirm malformed JSON, unknown evidence IDs and unavailable model yield clear failure states rather than successful explanations. No hard-coded graph data in the real import path.

This is the minimum first delivered feature. Do not finish at health checks or placeholder screens.

### R2 — Whole system and 100-class traversal

Scope:
- Generate a deterministic 100-class fixture with meaningful cross-package calls, hubs, cycles and isolated nodes; preserve a separate small correctness fixture.
- Build package/module overview, real class counts and aggregate relationships.
- Add class and method expansion, focused neighbors, search, minimap, zoom-to-selection, incoming/outgoing filters and bounded depth.
- Provide an explicit all-class view. Do not promise that all edge labels can fit simultaneously.
- Back/forward restores graph level, selected subject, filters and viewport. Collapse/expand and new explanations preserve positions.

Exit evidence: all 100 class entities are discoverable and individually selectable; counts reconcile with indexed scope; package → class → method → whole-system navigation works. Capture overview, focused graph, tooltip and inspector screenshots. Test window resizing, keyboard alternatives and pan/zoom tooltip anchoring. Graph truncation and hidden-neighbor counts must be visible.

### R3 — Spring meaning and static request exploration

Scope:
- Common stereotypes, injection points, simple bean factories and route mappings.
- Qualifier/primary handling and multiple candidates under uncertain profiles/conditions.
- Declared call target and candidate runtime implementations remain separate.
- Discover entry points and navigate possible method call paths.
- Show branch/dispatch uncertainty, unresolved exits and cycle cutoffs.

Exit evidence: dedicated fixtures cover qualifier selection, ambiguous candidates, factory-produced types, class-plus-method route mappings and known unsupported constructs. A path through a class dependency graph is not relabeled as an execution sequence. Update SUPPORT_MATRIX.md with actual supported/heuristic/unsupported behavior.

### R4 — Complete explanation coverage and incremental updates

Scope:
- Resumable Explain all across classes and methods, preceded by architectural drafts and processed sequentially by relation count and LOC. Relationships remain on-demand. This R6 change supersedes the original R4 bulk scope; see ADR 0003.
- Per-item durable status, bounded retries, cancellation, restart recovery and deduplication.
- Priority for explicit requests and visible neighbors; no model request on every hover.
- Change detection, re-resolution, stale marking and snapshot-safe completion.
- Notes/bookmarks survive unchanged identities and support orphan handling for deleted/renamed subjects.

Exit evidence: edit/delete/rename and configuration-change fixtures update facts appropriately; prior snapshots retain valid evidence; old jobs cannot overwrite new explanations. Interrupted bulk work resumes without discarding completed results. Distinguish job state, freshness and parser completeness in UI counters.

Start with correct full reindex-on-change if needed, then introduce targeted incremental work. Preserve the same snapshot contracts. Document the performance limitation until targeted invalidation is verified.

### R5 — Packaging and release verification

Scope:
- A documented development launcher and packaged local application path.
- Frontend assets built to `frontend/dist`, then copied into generated backend resources by declared build tasks.
- Monaco and required workers/fonts/scripts bundled locally; no runtime CDN dependencies for core UI.
- Actionable empty, partial, failed, canceled and stale states.
- Local request/session protection, path boundary checks, secret redaction and model endpoint controls.
- Reproducible checks, screenshots and realistic performance measurements.

Exit evidence: clean checkout builds using wrapper and lockfile; packaged application serves UI/API on loopback and works without external internet once dependencies/model are available; data and settings survive restart; documented limitations match observed behavior. Measure indexing, bounded queries, layout and model latency separately. Do not invent timings or interpret a synthetic 100-class test as proof of unlimited scale.

Defer trusted Gradle build execution, runtime traces, vector search, cloud sync and autonomous refactoring unless separately prioritized. Support manual roots/classpath input before introducing target build execution.

## 5. UI implementation details that need explicit design

Keep the supplied visual hierarchy: navigation, canvas, inspector. Use a small direct React-owned Cytoscape adapter unless a wrapper has verified value/compatibility. Cytoscape nodes are not arbitrary React DOM cards; decide which details are canvas labels and which require synchronized HTML overlays. Prototype selected class cards and multiline descriptive labels before committing to a rendering strategy.

For an edge tooltip:
- Use a generous hit area for thin edges; hover/focus opens cached details after a short delay.
- Position using rendered edge coordinates and the canvas bounding rectangle.
- Reposition on pan/zoom/resize or dismiss transient details intentionally.
- Permit movement into interactive tooltip content without immediate disappearance.
- Escape closes it; touch/click opens a pinned inspector; keyboard-accessible relationship lists expose equivalent actions.
- Avoid a label or tooltip covering its own target or overflowing the viewport.

For the pinned inspector:
- Preserve selection until another subject is selected or the inspector is closed.
- Explain behavior, inferred purpose, call sites and unknowns separately.
- A call-site list opens exact snapshot source; do not merely jump to the class file start.
- Distinguish generated explanations from user notes and parser metadata.

For the whole-system view:
- Summarize dependencies at package scale and expose counts of underlying occurrences.
- Preserve different relationship kinds rather than combining everything into an undifferentiated line.
- Let users switch level without losing which subject they were investigating.
- Show descriptive labels for the active neighborhood and selected edges; provide optional broader labels where space permits.

## 6. Configuration, API and operational corrections

Choose an explicit backend configuration path: exported environment variables, an external Spring properties/YAML file, or a tested application settings flow. A `.env` file is not automatically loaded by the supplied Spring configuration. Do not introduce a launcher that executes arbitrary `.env` contents as shell code. If using a file importer, specify its format and precedence and verify loading.

Bind both backend and dev server to loopback. Use a dev proxy with a documented host/origin policy, and same-origin packaged assets. Protect state-changing/local-file APIs with a local session token and appropriate Origin/Host validation. Canonicalize registered roots, reject outside-root traversal and symlink escapes, and avoid model credentials in API responses.

Analysis/explanation APIs return asynchronous job IDs. Add cancellation and progress polling first; SSE can supplement polling with defined reconnection behavior. Use bounded queues and persist item states. On restart, recover abandoned running work explicitly. Final commits must check job cancellation and snapshot identity.

Define artifact retention and workspace removal: removing an index never deletes the target source repository. Retain source snapshots only within configured analysis scope, with exclusions and bounded storage.

## 7. Tests and status reporting

Agent-owned verification:
- Build and dependency resolution; report actual versions.
- Migration history, foreign-key rejection and cross-snapshot reference rejection.
- Two identical logical symbols in different snapshots coexist; overloads remain distinct.
- Exact source spans, repeated call occurrences and explicit unresolved targets.
- Invalid/oversized model output, invented IDs, timeout, cancellation and staleness races.
- Browser flow using the live local model; record if access is unavailable rather than treating a mock as equivalent.
- Offline graph behavior, persisted settings, navigation history and screenshots.
- Hash all analyzed fixture files before and after import to establish read-only behavior. Keep any compilation outputs outside the fixture; do not compile imported repositories during source-only indexing.

The intentionally broken fixture must be outside Code Atlas's build source sets. Include the actually named implementation files for both payment candidates. Use declared annotation dependencies or explicitly documented test stubs, and distinguish heuristic recognition from resolved Spring annotation identities.

Use PROJECT_STATUS.md fields: active R milestone, verified capabilities, exact commands/outcomes, screenshots, local model test status, blockers, known limitations and next concrete action. Do not put unverified version claims or future features under completed work.

User review should answer: Are the explanations understandable? Can you find a class and explain why it depends on another? Can you return to the whole-system picture? The agent should already have performed routine build, health and browser checks.

## 8. Documentation checked for this review

- [Antigravity rules](https://antigravity.google/docs/rules-workflows/): documented workspace rule folders and Always On activation; use a bridge instead of assuming automatic root AGENTS.md activation.
- [Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html): wrapper generation, required files and checksum verification.
- [Spring externalized configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html): supported configuration sources; implement/document the selected path.
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html): enable enforcement on each connection and design matching parent keys.
- [Flyway SQLite support](https://documentation.red-gate.com/flyway/reference/database-driver-reference/sqlite): database-specific migration limitations; verify the selected version combination.
- [Vite build options](https://vite.dev/config/build-options.html): generated output and empty-directory behavior; keep outputs separate from authored backend resources.

The schema and milestone changes above are design recommendations based on the supplied plan. No commands have been run on the user's workstation as part of this review.
