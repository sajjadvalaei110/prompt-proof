# Step11 integration with GitHub main — 2026-09-30

Upstream baseline: `e77efabe4dc4160ddcc0ef1628058b884d6640e6` (24 commits after
Step11's original baseline `7847bfe`). Completed Step11 commit: `b32093c`.
GitHub remote: `git@github.com:sajjadvalaei110/prompt-proof.git`; its default and
only mainline branch is `main` (there is no `master` branch). Integration uses a
normal merge, preserving both histories and all Step12–14 work.

Resolved conflicts retain the language boundary alongside the original workspace
layout in review capture, transactional cross-file OVERRIDES linking, the newer
package-only map, Changes toggle, stacks, history and Ungroup behavior. The Java
parser and Spring rule implementation are unchanged from upstream. Removed the
tracked generated TypeScript build cache as intended by Step11. Kept both ADR 0008
files under their distinct descriptive filenames; the supplied multi-language
ADR remains byte-identical, and existing references retain their original meanings.

Validation in the isolated integration checkout:

- `./gradlew test --no-daemon` — PASS, 166 tests, zero failures/errors/skips.
  Log: `/tmp/step11-integration-gradle.log`.
- `cd frontend && npm ci && npm run build` — PASS. Independent parent check:
  `npx tsc -b --force && npm run build` — PASS. Existing >500 kB bundle advisory remains.
- Every `node scripts/test-*.mjs` suite, invoked by a Python loop over the sorted
  paths — PASS, 13 suites. Log: `/tmp/step11-integration-node.log`. The first attempt
  started before `npm ci` finished and failed to resolve TypeScript; rerun after
  dependencies were installed passed in full.
- `./gradlew bootJar constrainedMemoryTest --no-daemon` — PASS, executable package built and one constrained-memory test passed (256 MiB heap).
  Log: `/tmp/step11-integration-package.log`.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_language_import_pipeline.py`
  — PASS: real Java import, persisted language, offline graph, re-analysis and recent
  project without snapshot; zero page errors; source unchanged. Run `run-lrggd35u`;
  log `/tmp/step11-integration-import.log`; [report](import/import-report.json).
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_ungroup_pipeline.py`
  — PASS, 33/33 checks, zero page/console errors, source fixtures unchanged and no
  model provider reachable. Run `run-c1nx0sec`; log `/tmp/step11-integration-ungroup.log`;
  [report](ungroup/report.json).
- All three import and twelve Ungroup screenshots inspected by the parent agent.
  Screenshots and reports are retained in the adjacent `import/` and `ungroup/` directories.
- `git diff --exit-code e77efab -- src/main/java/dev/codeatlas/analysis/JavaParserAdapter.java src/main/java/dev/codeatlas/analysis/SpringAnnotationAnalyzer.java docs/BUILD.md`
  — PASS. `cmp /home/sajjad/prompts/step11/0008-multi-language-support.md docs/adr/0008-multi-language-support.md`
  — PASS. `git diff --check`, `git diff --cached --check` and unresolved-conflict check — PASS.

The Step11 stable-map acceptance evidence in the parent directory describes its
original pre-integration baseline. That legacy class/method-level browser suite
was not rerun as a gate for the combined package-only UI (ADR 0007). Other historic
browser pipelines and live-model checks were not rerun; the current import and
Ungroup pipelines exercise the combined product and offline model configuration.
Java remains the only shipped language. Go/Dart work remains outside this integration.
