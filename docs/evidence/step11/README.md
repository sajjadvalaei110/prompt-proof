# Step11 phases 0/1 — review remediation evidence

Scope: `/home/sajjad/prompts/step11/review-step-0.md`, the supplied phase 0/1 plan,
and the current uncommitted implementation. Java remains the only shipped language.
The historical `docs/BUILD.md` is unchanged and ADR 0008 matches the supplied copy.

## Review findings

| Finding | Resolution |
|---|---|
| 1 — invalid socket constructor | Remove the invalid socket call; shared lifecycle helpers bind the loopback HTTP stub and application directly on port zero. The actual mock explanation pipeline passed. |
| 2 — swallowed FAILED update | Let the database exception propagate to `JobService`'s fallback while retaining adapter cleanup. |
| 3 — unsupported review language | Validate the stored language before any Git operation, source capture or review snapshot creation. |
| 4 — mock target regex | Match whitespace correctly and validate that the actual target ID appears in the synthetic claim. |
| 5 — incomplete durable evidence | Inspected fixture screenshots and reports are retained here; exact commands and current outcomes are recorded below. |
| 6 — missing Java/unsupported dispatch coverage | Exercise the real Java adapter and Spring pass, plus unsupported-language failure without a staging snapshot. |
| 7 — unused compatibility paths | Remove the null-registry constructor, obsolete repository/response overloads and Java-only discovery shim. |
| 8 — duplicate language definitions | Frontend client aliases the shared Language type; backend defaults use JavaAnalysisAdapter.LANGUAGE. Migration SQL keeps its immutable `java` default. |
| 9 — duplicate registry lookup | Analysis uses the already-selected adapter for discovery; removed the unused discovery registry entry point. |
| 10 — generated caches | Ignore Python/TypeScript caches; remove the tracked generated tsbuildinfo and write future TypeScript build state under ignored build/. |

## Verification

Phases 0/1 complete as of 2026-09-30. The backend, frontend and six earlier Python
gates passed on 2026-09-24; the final stable-map gate passed on 2026-09-30.
Results below come from retained logs under `build/step11/resumed/`; interrupted
and failed runs are not counted as passes. The final three focused tests passed
after the migration seed cleanup.

| Command (from repository root unless noted) | Outcome |
|---|---|
| `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar --no-daemon` | PASS; final production package, existing Vite bundle-size advisory only. |
| `cd frontend && npx tsc -b --force && npm run build` | PASS. |
| `for test_file in scripts/test-*.mjs; do node "$test_file"; done` | PASS; all nine pure-logic suites. |
| `CODEATLAS_DATA_DIR="$PWD/build/step11/resumed/test-data-final" JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test constrainedMemoryTest --no-daemon` | PASS; 133 ordinary tests plus the constrained-memory scale test (10,000 classes, 50,000 methods, 100,000 relationships; 256 MiB heap). `backend-final.log`. |
| `CODEATLAS_DATA_DIR="$PWD/build/step11/resumed/test-data-final" JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test --no-daemon` | PASS after adding two regressions; 135 tests, zero failures/errors/skips. `backend-tests-final.log`. |
| `CODEATLAS_DATA_DIR="$PWD/build/step11/resumed/test-data-final" JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test --tests dev.codeatlas.api.LanguageMigrationExplanationIntegrationTest --tests dev.codeatlas.analysis.JavaAnalysisAdapterTest --tests dev.codeatlas.review.ReviewServiceLanguageTest --no-daemon` | PASS on final sources after seed cleanup; 3 tests, zero failures/errors/skips. `handoff-focused-tests.log`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_language_import_pipeline.py` | PASS; Java-only desktop/mobile selector, real import, re-analysis, recent workspace without snapshot, offline graph and unchanged fixture. `run-5v8ly681`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_git_review_pipeline.py` | PASS; 34 checks, zero page errors/model requests, unchanged source and Git index. `run-x1p7dvxw`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_change_edges_pipeline.py` | PASS; directional relationships and grouped source evidence; unchanged fixture. `run-2th_r3_6`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_hierarchical_pipeline.py` | PASS; 61 bulk symbols, synthesis-first order, ready/draft views, SQLite integrity, unchanged fixture; synthetic local model. `run-x43zas15`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_explanation_pipeline.py --mock build/step11/resumed/explanation-final` | PASS; real target ID, validated claim/evidence/provenance and READY inspector; synthetic local provider. `explanation-final.log`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_filtering_zoom_settings.py` | PASS; 74 nodes/102 edges and isolated profile handling through local HTTP 401 stub. Browserless bundle/API check, not browser or screenshot acceptance. `filtering-final.log`. |
| `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_stable_graph_pipeline.py acceptance` | PASS on final harness, 2026-09-30: 35 scenarios, 31 inspected screenshots, zero browser runtime errors, unchanged fixture source. S4 preserved camera and both endpoint emphasis states. `stable-final-2026-09-30.log`, `acceptance-g_rauxtj`; [report](stable/stable-graph-report.json). Prior `stable-final.log` / `acceptance-__bfunmo` remains FAILED/INCOMPLETE, not a pass. |

The isolated backend directory was created with
`mkdir -p build/step11/resumed/test-data-final` before the Gradle commands.
The final focused run replaced ordinary test XML with its three-test result. The
133/135 full-suite counts were inspected in XML during the previous session and
recorded in its handoff; retained Gradle logs confirm success but do not print those
counts. The current XML confirms the three focused tests and one constrained-memory
test. The standalone forced frontend build was reported passing in that session;
`package-final.log` independently retains the successful packaged `tsc -b && vite build`
run, but there is no separate retained log for the forced command.

Additional checks on 2026-09-30: `node --check scripts/verify-stable-graph-ui.mjs`,
`git diff --check`, `git diff --cached --check`,
`cmp /home/sajjad/prompts/step11/0008-multi-language-support.md docs/adr/0008-multi-language-support.md`,
and `git diff --exit-code -- docs/BUILD.md src/main/java/dev/codeatlas/analysis/JavaParserAdapter.java src/main/java/dev/codeatlas/analysis/SpringAnnotationAnalyzer.java`
— PASS. No executable JAR rebuild was needed for documentation or browser-harness-only
changes; unaffected passing suites were not repeated on continuation.

## Second review

- Corrected the port-registry import and test constructor signatures after the framework-hook extraction.
- `WorkspaceLanguageIntegrationTest` now owns a temporary database. Broader checks use an isolated
  data directory. Two confirmed orphaned test workspaces were removed from the local application
  database after making a backup under ignored `build/`; no user workspace was removed.
- Shared analysis invokes an optional adapter-owned framework pass. Java retains Spring roles/routes/
  beans before injection resolution. Review found and corrected a lost skipped-file warning.
- Registry validation owns normalization and supported languages. Workspace registration only supplies
  the backwards-compatible Java default; review reads workspace identity through `WorkspaceRepository`.
- Removed the unused discovery wrapper, request overload, optional snapshot language type and dead
  persisted-language fallbacks. Analysis status text is language-neutral.
- The explanation/filtering runners share HTTP, fixture-hash and server lifecycle helpers; both
  application and mock server bind port zero instead of releasing a port before startup.

## Stable-map pointer investigation

The original incomplete acceptance run remains a failed run: S4 selected an edge
but changed pan across its candidate-click attempts. A later run on September 25
passed 35 scenarios, but further harness edits followed it, so it was not used as
verification of the final script.

Renderer hit testing alone does not account for HTML/SVG overlays. The isolated
September 30 reproduction found a renderer-valid edge coordinate whose actual
CDP pointerdown target was the minimap SVG. The corrected diagnostic changed pan from
`(-144.1393, 53.0264)` to `(-843.9653, 168.9638)` without inspecting an edge or
changing zoom. This reproduces the camera-change failure mode; the original
failed run did not retain per-click DOM telemetry. An earlier minimap-title
probe intercepted the pointer but did **not** change pan and is not causal proof.

The harness now accepts only points whose DOM target is a Cytoscape canvas.
It still dispatches real CDP pointer events, checks actual edge selection and
both endpoint emphasis states, and preserves the original camera assertion
across every attempted click. It does not reset pan or weaken the assertions.
The SVG diagnostic also required a case-insensitive tag-name check (`svg` is
lowercase in Chromium); its first run failed that assertion after recording the
pan change. No application code changed for this investigation.

Diagnostic command (PASS, exit 0):
`JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 build/step11/resumed/run-s4-svg-diagnostic-2026-09-30.py`.
The local startup wrapper launches the packaged application and Chromium with
isolated data, a copied synthetic fixture, an unreachable model endpoint, and
Node configuration `mode: "s4-diagnostic"`. Its successful run directory is
`build/step11/resumed/s4-diagnostic-current-yyptvapr/`. Retained evidence:
[actual pointer and camera trace](stable/s4-minimap-svg-interception-reproduction.json)
and [inspected reproduction screenshot](stable/s4-minimap-svg-interception-after.png).

## Inspected screenshots

The final runs' three [import screenshots](import/), four [review screenshots](review/),
six [relationship screenshots](change-edges/) and twelve [hierarchy screenshots](hierarchy/)
were visually inspected. They cover desktop/mobile import fit, offline graph browsing,
review overlays and retained source, relationship direction/evidence, and synthetic
explanation ready/draft states. The [synthetic READY inspector](explanation/explanation_inspector_preview.png)
was also inspected at full size: actual target ID, source evidence, uncertainty and model/prompt
provenance are visible. All 31 final [stable-map screenshots](stable/) were inspected
using contact sheets, with edge selection and mobile Details also inspected at full
size. They cover camera preservation, scope and filter changes, explicit arrangement,
navigation history and narrow layouts. The map intentionally preserves the user's
camera, so cards may extend outside the viewport. The separate SVG reproduction
screenshot was inspected and is labelled diagnostic, not acceptance evidence.

Java is the only shipped adapter. Live-model verification is not run because no live endpoint
was configured for this task. Deterministic local responses do not establish live-model quality.

## Review handoff

Use [the Claude review prompt](../../STEP11_CLAUDE_REVIEW.md). Inspect untracked
source/tests as well as the tracked diff. All model output in these fixtures is synthetic;
no result here establishes live-model quality or integration.
