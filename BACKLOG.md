# Code Atlas — Product Backlog

Prioritized backlog items for Code Atlas milestones.

| ID | Title | Target Milestone | Priority | Status |
|---|---|---|---|---|
| **B001** | 100-class navigation fixture | R2 | High | Ready |
| **B002** | Spring enrichment rules | R3 | High | Proposed |
| **B003** | Request flow view | R3 | Medium | Proposed |
| **B004** | Resumable Explain All | R4 | High | Proposed |
| **B005** | Incremental reindexing | R4 | Medium | Proposed |
| **B006** | Trusted Gradle import | Deferred | Low | Deferred |
| **B007** | Runtime trace overlay | Deferred | Low | Deferred |
| **B008** | Desktop launcher packaging | R5 | Medium | Proposed |

---

## Item Details

### B001: 100-Class Navigation Fixture
- **Target Milestone**: R2 (Scalability & Navigation)
- **Priority**: High
- **Description**: Synthesize a deterministic multi-package 100-class fixture with realistic topology (hubs, cycles, linear chains, isolated nodes) to validate graph performance, package hierarchy aggregation, minimap, and search responsiveness.
- **Acceptance Criteria**:
  - All 100 classes are discoverable, searchable, and selectable in the UI.
  - Package-to-class-to-method drill-down renders without layout freezes.
  - Verification harness measures query, layout, and memory benchmarks.

### B002: Spring Enrichment Rules
- **Target Milestone**: R3 (Spring Meaning & Static Exploration)
- **Priority**: High
- **Description**: Implement static heuristic rules for common Spring stereotypes (`@Service`, `@Repository`, `@RestController`, `@Component`), candidate injection resolution, `@Qualifier` matching, and factory `@Bean` definitions.
- **Acceptance Criteria**:
  - Distinguishes declared interface calls from candidate bean implementations.
  - Ambiguous candidates under multiple `@Profile` or unresolvable conditions remain visibly marked with uncertain resolution status.
  - Verified by dedicated fixture with multiple implementations and qualifiers.

### B003: Request Flow View
- **Target Milestone**: R3 (Spring Meaning & Static Exploration)
- **Priority**: Medium
- **Description**: Dedicated static request-flow visualization tracking paths from HTTP controller entry points (`@GetMapping`, `@PostMapping`, etc.) through service layers down to repository calls.
- **Acceptance Criteria**:
  - Route mapping paths display branching and candidate dispatches.
  - Unresolved call exits and cyclic loops are explicitly terminated and labeled.
  - Visual distinction ensures static candidate paths are never mislabeled as observed runtime executions.

### B004: Resumable Explain All
- **Target Milestone**: R4 (Complete Explanation Coverage)
- **Priority**: High
- **Description**: Bulk asynchronous background explanation generation across all symbols and relationships in an active snapshot, with configurable concurrency (default: 1), durable per-item progress, and pause/resume support.
- **Acceptance Criteria**:
  - Background jobs survive backend process restarts without losing completed item explanations.
  - Cancellation halts in-flight requests immediately.
  - Interactive user inspector requests take priority over background bulk queue items.

### B005: Incremental Reindexing
- **Target Milestone**: R4 (Incremental Updates)
- **Priority**: Medium
- **Description**: Detect modified, added, or deleted source files on re-index and selectively update affected symbols, relationships, and evidence while invalidating only stale explanations.
- **Acceptance Criteria**:
  - File hash comparisons accurately identify changed files.
  - Unchanged symbol versions and explanations are preserved without re-querying the model.
  - Deleted symbols transition dependent notes and bookmarks into an orphan state.

### B006: Trusted Gradle Import
- **Target Milestone**: Deferred (Post-MVP)
- **Priority**: Low
- **Description**: Optional opt-in mechanism to execute the target repository's Gradle build daemon to extract exact classpath dependencies, annotation-processed sources, and compiler configurations.
- **Acceptance Criteria**:
  - Requires explicit user consent before executing external build scripts.
  - Gracefully falls back to source-only parsing if the build environment is incompatible or untrusted.

### B007: Runtime Trace Overlay
- **Target Milestone**: Deferred (Post-MVP)
- **Priority**: Low
- **Description**: Ingest OpenTelemetry or runtime trace spans to overlay observed execution paths and frequency metrics on top of the static dependency graph.
- **Acceptance Criteria**:
  - Visual distinction between static candidate edges and empirically observed runtime invocations.
  - Missing traces do not compromise static graph visualization.

### B008: Desktop Launcher Packaging
- **Target Milestone**: R5 (Packaging & Release Verification)
- **Priority**: Medium
- **Description**: Package Code Atlas as a self-contained local executable bundle (embedded Spring Boot jar + pre-built frontend assets in `frontend/dist`) with loopback security tokens, path boundary checks, and offline UI assets (Monaco editor bundled locally).
- **Acceptance Criteria**:
  - Clean startup via single command or wrapper script without requiring internet access or CDN downloads.
  - Secure loopback binding (`127.0.0.1`) with origin validation to prevent local drive traversal.
