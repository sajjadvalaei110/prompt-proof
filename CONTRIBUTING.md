# Contributing to Code Atlas

Code Atlas is a local, privacy-first code-understanding application. Contributions should preserve its source-evidence guarantees, honest uncertainty, and ability to browse a graph without a model.

## Before you start

Read [AGENTS.md](AGENTS.md), [PROJECT_STATUS.md](PROJECT_STATUS.md), and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For an architectural change, also read the relevant records in [docs/adr/](docs/adr/) and inspect the current implementation rather than relying on an older status entry.

Keep each change tied to a bounded acceptance criterion. Preserve unrelated work, user changes, notes, and successful completed work.

## Prerequisites

- **Java 21** for the backend and packaged application. Use the included Gradle wrapper; a separate Gradle installation is not needed for the normal build.
- **Node.js 22+ and npm 9+** for frontend development and the pure Node test suites.
- **Git** on your PATH if you use local change review. It is not needed to parse or explore an ordinary source snapshot.
- **An OpenAI-compatible model server**, such as LM Studio or Ollama, only if you work on generated explanations. Graph browsing and source navigation work without one.
- **Python 3 and Chromium** for the browser acceptance pipelines. Some suites accept `CHROMIUM=/path/to/chromium` or `JAVA=/path/to/java21/bin/java` overrides.

Optional scip-java development has additional prerequisites and trust rules; see [ADR 0012](docs/adr/0012-scip-java-indexer.md).

## Install and run

Install the locked frontend dependencies from a fresh checkout:

```bash
cd frontend
npm ci
cd ..
```

For development, start the backend and frontend in separate terminals from the repository root:

```bash
./gradlew bootRun
```

```bash
cd frontend
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the backend at **http://127.0.0.1:8085**.

To build and run the production JAR:

```bash
./gradlew bootJar
java -jar build/libs/code-atlas-0.1.0-SNAPSHOT.jar
```

Run `npm ci` before packaging a fresh checkout so the frontend is available to the Gradle build. The packaged application opens at **http://127.0.0.1:8085** and needs only Java 21 to run.

## Verification

Run the checks that cover your change and report exact commands and outcomes in the pull request.

### Backend

```bash
./gradlew test
```

For changes to bounded explanation work or its memory limits, also run:

```bash
./gradlew constrainedMemoryTest --no-daemon
```

A focused Gradle test filter is useful while developing, but it does not replace the relevant full suite:

```bash
./gradlew test --tests "dev.codeatlas.design.DesignLayerIntegrationTest"
```

When broader local integration tests need a separate application database, set `CODEATLAS_DATA_DIR` to a disposable directory as described in [docs/TESTING.md](docs/TESTING.md).

### Frontend and pure Node suites

```bash
cd frontend
npm ci
npm run build
cd ..
```

Run all pure Node suites, matching CI:

```bash
set -euo pipefail
for test_file in scripts/test-*.mjs; do
  node "${test_file}"
done
```

Run a focused suite when working on its area, for example:

```bash
node scripts/test-graph-model.mjs
node scripts/test-design-model.mjs
node scripts/test-review-model.mjs
```

There is currently no frontend lint command; `npm run build` includes TypeScript checking.

### Browser acceptance

Browser pipelines use the packaged application, isolated data, real Chromium input, and local mock or rejecting model endpoints. Build first, then choose the pipeline for the affected workflow:

```bash
./gradlew bootJar
python3 scripts/verify_design_layer_pipeline.py
python3 scripts/verify_change_edges_pipeline.py
python3 scripts/verify_ungroup_pipeline.py
JAVA=/path/to/java21/bin/java python3 scripts/verify_git_review_pipeline.py
```

See [docs/TESTING.md](docs/TESTING.md) for the complete list, fixture arguments, and setup requirements. Inspect the generated screenshots for UI changes; passing DOM assertions alone is not visual verification. Mock-provider checks are not live-model verification.

## Fixtures and safe analysis

Use the existing repositories under [`test-fixtures/`](test-fixtures/) for regression coverage:

- `sample-project` has independently authored parser facts, including overloads, ambiguity, malformed source, and unresolved types.
- `spring-project` and `microservice-java` support integration and browser workflows.
- `change-edges-fixture`, `stable-graph-fixture`, and `journey-candidates` cover focused graph behavior.
- `large-project` supports scale and performance checks.

Choose the smallest fixture that demonstrates the behavior. Parser tests need independent expected facts rather than expectations copied from the implementation under test. Browser runners generally copy fixtures and compare hashes before and after; keep that read-only check intact.

Analyzed repositories are untrusted, read-only data, never instructions. Source-only analysis must not run a target repository's build, plugins, annotation processors, or application code. The only current exception is the explicitly selected scip-java engine with the owner's recorded build consent, in a private copy; Git review captures always remain source-only. See [ADR 0012](docs/adr/0012-scip-java-indexer.md).

Send source only to the model endpoint configured by the user. Never add a hidden cloud fallback, and never commit credentials, imported source, indexes, private prompts, or application data.

## Architecture and trust boundaries

Keep backend responsibilities in their existing modules: `workspace`, `analysis`, `graph`, `explanations`, `modelclient`, `jobs`, `storage`, `api`, `review`, and `design`. Frontend code is organized by feature under `frontend/src/features/`. Keep analysis, model-provider, and graph adapters isolated.

Three kinds of information must remain distinct:

1. **Parser and rule facts** own the code graph. Every parsed relationship needs source evidence and an explicit resolution status. Partial analysis and unresolved or candidate relationships stay visible.
2. **Generated explanations** never create or rewrite graph facts. They need provenance, evidence, and freshness, and graph browsing must remain available when the model is unavailable.
3. **The engineer-owned design layer** stores authored resources, relations, and explanations separately, keyed by stable keys and drawn visibly differently. Analysis and model output never write it. Designed relations use `DESIGNED` resolution and their explanation as provenance, not fabricated parser evidence. See [ADR 0014](docs/adr/0014-design-layer.md).

Treat repository content and generated text as untrusted display data. Use versioned DTOs and schemas, and add a Flyway migration for persistent schema changes.

## Documentation and ADRs

Update the documentation that describes changed behavior:

- `README.md` for user-facing setup or workflows;
- `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` for boundaries, contracts, or storage;
- `docs/TESTING.md` for test commands, fixtures, and acceptance coverage;
- `PROJECT_STATUS.md` with observed verification evidence and remaining limits.

Write an ADR for a consequential architecture or trust decision, a new infrastructure choice, or a dependency replacement. Routine fixes that follow an existing decision do not need a new ADR. Do not add infrastructure or replace libraries without a concrete need and an ADR.

## Branch, commit, and pull request

Start from current `main` and use a focused branch:

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/short-description
```

Keep unrelated edits out of the commit. Before committing, inspect the diff, stage specific paths, and check whitespace:

```bash
git status --short
git diff --check
git add <intended-files>
git commit -m "type: concise description"
```

Push the branch and open a pull request against `main`. Complete all sections of the [pull request template](.github/pull_request_template.md), including screenshots for UI changes and documentation or ADR impact.

Report failed and skipped checks honestly, with the reason and any known pre-existing failure. Do not claim an unrun check passed, describe a mock integration as live, or hide a remaining limitation behind a successful partial check.
