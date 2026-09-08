# Project status
Last updated: 2026-09-08
Active milestone: Complete (Milestones R0 through R5 Verified)
Current revision: R5 (Packaging and Release Verification) Completed

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
- **OpenAI & Local LLM Settings Feature**:
  - Comprehensive `SettingsScreen.tsx` modal supporting OpenAI, Ollama, LM Studio, and Custom provider presets.
  - Configurable parameters: Base URL, Model ID, API Key / Token (with Show/Hide toggle), Context Budget, Max Output Tokens, Timeout, and Temperature.
  - Backend `ModelClientService` attaches `Authorization: Bearer <token>` when `apiKey` is configured, uses configurable timeout, temperature, and tokens.
  - `ModelProfileController` connects `GET /api/model-profiles` (masking API token for security), `POST /api/model-profiles` (updating in-memory configuration), and `POST /api/model-profiles/test` (live capability ping returning real latency and status/error details).
  - Frontend persists settings to backend in-memory profile and browser `localStorage`.

## Verification evidence
| Check | Command/action | Result | Date/revision |
| --- | --- | --- | --- |
| Environment preflight | `java -version`, `node -v`, `npm -v` | JDK 21.0.12, Node 22.22.1, npm 9.2.0 verified | 2026-09-07 |
| Spring unit tests | `./gradlew test --tests "dev.codeatlas.analysis.SpringAnnotationAnalyzerTest"` | 17 tests passed (0 failures, 0 errors, 0 skipped) | 2026-09-08 |
| Spring integration test | `./gradlew test --tests "dev.codeatlas.analysis.AnalysisServiceSpringIntegrationTest"` | 1 test passed (validates 9 R3/R4 checkpoints) | 2026-09-08 |
| 100-class scale benchmark | `./gradlew test --tests "dev.codeatlas.analysis.LargeProjectBenchmarkTest"` | 1 test passed (100 classes parsed in 608ms, graph query 3ms, WAL mode, 26MB heap) | 2026-09-08 |
| Model profile unit tests | `./gradlew test --tests "dev.codeatlas.api.ModelProfileControllerTest"` | 4 tests passed (GET masking, in-memory updates, test delegation) | 2026-09-08 |
| Model client unit tests | `./gradlew test --tests "dev.codeatlas.modelclient.ModelClientServiceTest"` | 2 tests passed (unconfigured check, error reporting) | 2026-09-08 |
| Model profile API integration | `./gradlew test --tests "dev.codeatlas.api.ModelProfileApiIntegrationTest"` | 2 tests passed (MockMvc GET profile, POST update, POST test) | 2026-09-08 |
| Complete test suite | `./gradlew test` | 27 tests passed across 6 suites (100% pass) | 2026-09-08 |
| Frontend compilation | `npm run build` in `frontend/` | TypeScript compile and Vite bundling succeed (0 errors) | 2026-09-08 |
| Single-executable packaging | `./gradlew bootJar` | Produces `code-atlas-0.1.0-SNAPSHOT.jar` with bundled static UI assets | 2026-09-08 |
| Filtering, zoom & settings verification | `python3 scripts/verify_filtering_zoom_settings.py` | 100% pass across UI bundling, ModelProfile API, Bearer token auth test, and compound graph structure | 2026-09-08 |
| Release regression script | `python3 scripts/verify_r5_release.py` | 100% pass across packaging, security, 100-class benchmark, routes, and queue | 2026-09-08 |
| Headless UI inspection | `/snap/bin/chromium --headless --screenshot` | Verified `ui_preview.png`, `settings_modal_preview.png`, and `graph_canvas_preview.png` | 2026-09-08 |

## Known limitations and blockers
- Model client requires a reachable OpenAI-compatible endpoint (e.g. OpenAI, Ollama, or LM Studio) to generate real LLM text; offline mode safely marks items failed/retrying without crashing.
- Source analysis is Java-only; annotation processors and bytecode weavers (Lombok, AspectJ) are not executed at import time (by design per AGENTS.md trust boundaries).

## Decisions made this session
- [ADR-0001](docs/adr/0001-technology-stack.md): Technology stack selection.
- [ADR-0002](docs/adr/0002-packaging-and-loopback-security.md): Single-executable packaging, offline static UI bundling, and loopback security.
- Compound node filtering: Propagates visibility upward to container ancestors (`PACKAGE`, `CLASS`) so Cytoscape never inadvertently hides children of a compound parent.
- Security-hardened model settings: `GET /api/model-profiles` returns `hasApiKey: boolean` and never transmits raw API tokens back to the client; API tokens are applied in-memory and attached as `Authorization: Bearer <token>` HTTP headers.
- Zoom toolbar placement: Positioned at top-right of canvas to avoid collision with Cytoscape navigator/minimap at bottom-right.

