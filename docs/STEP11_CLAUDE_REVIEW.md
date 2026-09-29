# Step11 phases 0 and 1 — independent review

Review scope: the phases 0/1 extraction and remediation of both reviews
in `/home/sajjad/prompts/step11/review-step-0.md`. Java remains the only shipped adapter.
The broader R6 milestone, Go/Dart adapters and stable-map Step 6A are outside this handoff.

Copy this prompt into Claude with the repository available:

```text
Review the Step11 phases 0 and 1 integration. Compare the merged tree with
upstream baseline e77efab (git diff e77efab), including added source/test files.
Preserve upstream Step12–14 behavior; the package-only map supersedes the historical
Step11 stable-map browser suite. See docs/evidence/step11/integration/README.md.
Do not change files or commit. Report findings first. Read both reviews in
/home/sajjad/prompts/step11/review-step-0.md and check their dispositions in
docs/evidence/step11/README.md; do not treat a previous finding as fixed merely
because a document says it is.

Read AGENTS.md, PROJECT_STATUS.md, docs/ARCHITECTURE.md,
docs/adr/0008-multi-language-support.md, and the supplied plan at
/home/sajjad/prompts/step11/implementation-plan.md. BUILD_BRIEF.md is absent;
docs/BUILD.md is the frozen historical brief and must remain unchanged.

Acceptance criteria:
1. ADR 0008, the mission/invariant update and the architecture module table
   establish the multi-language boundary. Go and Dart are not implemented here.
2. AnalysisPort and its registry dispatch discovery and both extraction passes
   by the workspace/snapshot language. JavaAnalysisAdapter delegates to the
   existing JavaParser implementation without changing Java graph facts,
   resolution, evidence, diagnostics, transactions or cache lifecycle.
3. SpringAnnotationAnalyzer remains Java-specific and is invoked only for Java.
   The shared service invokes an optional framework hook; the Java adapter owns
   Spring rules and both enrichment persistence stages. Ordinary and retained-source
   review analysis share the serialized boundary.
4. V012 adds required workspace/snapshot language, backfills existing data to
   java and preserves existing identities, active snapshots and explanation data.
5. Workspace creation defaults to Java for existing clients, persists and returns
   language, rejects unsupported languages and preserves canonical path handling.
6. The actual import form offers only Java and sends that selection to the API.
   Existing graph browsing, review and explanation workflows remain functional.

Look for concrete regressions and incomplete boundaries: unsupported-language
failure paths, wrong adapter selection, stale parser state after failures,
snapshot language drift, lost evidence/resolution, accidental Spring invocation,
workspace reuse, migration compatibility, and UI import/re-analysis/recent-project
behavior. Check that unsupported review language is rejected before Git capture,
that a failed FAILED-status write reaches the job fallback, that tests isolate
application data, and that migrated explanations retain evidence and provenance.
The port intentionally preserves the existing persistence-backed two-pass model;
do not require a new parser DTO architecture merely as a stylistic preference.

Read the exact verification commands and outcomes in PROJECT_STATUS.md and
docs/evidence/step11/README.md. Inspect screenshots, not just passing assertions.
Preserve stable-map camera assertions and real pointer dispatch when reviewing
the browser harness; renderer geometry alone cannot establish the DOM click target.
Inspect the retained minimap SVG reproduction and S4 per-click pointer traces.
The isolated diagnostic intentionally clicks an overlay; only the full acceptance
run verifies normal behavior. Check that DOM target filtering does not reset the
camera or weaken assertions across attempted clicks.

All fixture model responses are labelled synthetic; they do not prove a live
model integration. Do not contact a model endpoint or alter real source repositories.

Return findings ordered by severity with file:line, reproducible trigger,
expected/actual behavior, impact and a minimal fix. Separate introduced defects
from pre-existing limitations. List checks run and missing coverage. If no
findings remain, say so and state the limits of the review.
```
