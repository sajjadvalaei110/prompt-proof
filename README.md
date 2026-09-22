# Code Atlas

Code Atlas is a local, privacy-first Java and Spring code understanding application. It combines deterministic static analysis with local LLM explanations to help developers explore unfamiliar codebases with navigable source evidence and honest uncertainty.

---

## Key Invariants

1. **Deterministic Parser Facts Own Graph Structure**: The JavaParser AST and symbol solver determine all nodes, relationships, and source coordinates. AI models provide natural language explanations only and cannot alter graph topology.
2. **Every Relationship Has Evidence**: Every edge links to exact line and column ranges in source files with an explicit resolution status (`resolved`, `candidate`, `unresolved`).
3. **Read-Only Repositories**: Analyzed source code is strictly read-only data; target repositories are never executed, compiled, or modified.
4. **Local Loopback Security**: The backend binds strictly to `127.0.0.1:8085` with hardened CORS rules. Zero code or telemetry is transmitted to external networks or the cloud.
5. **Offline Operation**: Graph exploration, Spring stereotype inspection, route mappings, and dependency injection analysis work 100% offline without any model server.

---

## Prerequisites

- **Runtime Execution**: Java 21 LTS (JDK or JRE)
- **Local Git reviews**: Git installed on `PATH`; see [Review local changes](docs/GIT_REVIEW.md) for the Changes overlay on the Code map.
- **Source Build** (optional): Node.js 22+ and npm 9+ (only needed when compiling the frontend from source; the packaged JAR includes all compiled assets)

---

## Single-Command Launch (Packaged JAR)

To package and run the self-contained executable with embedded UI:

```bash
# 1. Build the production executable JAR (compiles backend + UI assets)
./gradlew bootJar

# 2. Launch Code Atlas (requires only Java 21)
java -jar build/libs/review-assist-0.1.0-SNAPSHOT.jar
```

Open your browser to:
```
http://127.0.0.1:8085
```

> **Note**: Both `review-assist-0.1.0-SNAPSHOT.jar` and `code-atlas-0.1.0-SNAPSHOT.jar` are produced in `build/libs/` and can be used interchangeably.

---

## Verification Runbook

### 1. Automated Gradle Test Suite
Run the full unit, integration, and benchmark test suite:
```bash
./gradlew test
```
- **Total Tests**: 19 tests across 3 test suites (`SpringAnnotationAnalyzerTest`, `AnalysisServiceSpringIntegrationTest`, `LargeProjectBenchmarkTest`).
- **Pass Rate**: 100%.

### 2. 100-Class Performance Benchmark
Run the dedicated scale benchmark against the 100-class fixture (`test-fixtures/large-project`):
```bash
./gradlew test --tests "dev.codeatlas.analysis.LargeProjectBenchmarkTest"
```
**Benchmark Results**:
- **AST Parsing & Relationship Resolution**: ~600 ms for 100 classes across 10 packages.
- **Symbols & Relationships**: 310 symbols indexed, 770 relationships extracted (470 internal graph edges).
- **Graph Query Latency**: ~3–4 ms for 310 nodes and 470 edges.
- **Database Health**: SQLite WAL mode (`PRAGMA journal_mode = wal`), 0 foreign key violations, integrity check `ok`.
- **JVM Heap Footprint**: ~26 MB during 100-class indexing.

### 3. End-to-End Release Verification Script
Verify the live running executable over HTTP:
```bash
python3 scripts/verify_r5_release.py
```
This script validates:
- Static UI delivery (`index.html` and bundled JS/CSS) from the JAR.
- Strict loopback binding (`127.0.0.1:8085`) and CORS policy rejection of external origins.
- 100-class project indexing and graph retrieval via REST APIs.
- Spring stereotype recognition, HTTP route discovery, and dependency injection candidate resolution.
- Hierarchical Explain All: complete architecture synthesis into class drafts, then active classes/methods ordered by relation count and LOC. Processing is sequential; the legacy concurrency hint is accepted but does not increase workers. Relationships are explained on demand. Cancellation/resume preserves successful work.
- Context propagates existing explanations between classes, methods and relationship endpoints. READY elements display a sparkle; drafts and stale results do not. See [ADR 0003](docs/adr/0003-hierarchical-explanations.md).

---

## Development Mode

For rapid frontend and backend development with hot reloading:

1. **Start Backend**:
   ```bash
   ./gradlew bootRun
   ```
   Runs at `http://127.0.0.1:8085`.

2. **Start Frontend (Vite Dev Server)**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Runs at `http://localhost:5173` and proxies API requests to `127.0.0.1:8085`.

---

## Local Model Configuration

Code Atlas interfaces with locally hosted language models using standard OpenAI-compatible HTTP APIs:

- **LM Studio**: Start your local server at `http://127.0.0.1:1234/v1`, load an instruction/code model (e.g., `Qwen2.5-Coder-7B` or `DeepSeek-Coder`), and configure the model ID in the Code Atlas Settings.
- **Ollama**: Run `ollama serve` (default: `http://127.0.0.1:11434/v1`) with `ollama pull qwen2.5-coder`.
- **Offline / Model Unavailable**: When the local model server is unreachable, Code Atlas safely logs failure and displays static parser facts. The interactive graph and source navigator remain fully responsive.

---

## Architecture

Code Atlas is organized into bounded modules:
- `workspace`: Path canonicalization, include/exclude rules, and project boundaries.
- `analysis`: Two-pass JavaParser AST parsing, type solving, and source evidence coordinate mapping.
- `springmodel`: Spring stereotype extraction, route concatenation, and qualifier-based injection candidate resolution.
- `graph`: Relational storage queries for Cytoscape.js rendering, package hierarchies, and edge traversal.
- `explanations`: Priority explanation queue service, durable retry tracking, cancellation, and staleness invalidation.
- `modelclient`: OpenAI-compatible HTTP client with timeouts, token budgets, and structured response parsing.
- `storage`: SQLite 3 embedded database with Flyway migrations V001 and V002, WAL journal mode, and foreign keys.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/adr/](docs/adr/) for detailed architectural records.
