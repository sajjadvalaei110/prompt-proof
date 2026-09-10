# Code Atlas — Testing Strategy

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
| **Spring Model** | `dev.codeatlas.springmodel` | Stereotype detection, candidate implementation matching, qualifier resolution, HTTP route extraction, ambiguous candidate marking. |
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
node scripts/test-graph-model.mjs
python3 scripts/verify_hierarchical_pipeline.py
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
