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
