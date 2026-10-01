# Project status
Last updated: 2026-10-01 (Changes-mode review fixes: empty-comparison notice, per-workspace Base revision; before that ADRs 0014 and 0015)
Active milestone: R6 — Developer comprehension redesign (in progress)
Current revision: Step11 language-neutral Java analysis integrated with step 14 Ungroup (an expanded box's box hidden, its children kept as free cards,
ADR 0011) merged with main's step 13 (card menu Expand/Collapse + View source, cascading tree
collapse, Entry points Explore → outgoing stack, kind icons), both on top of
incoming relation stack (the stack button's second press, docs/OUTGOING_STACK.md
"Incoming stack"), on top of
step 12 follow-up (candidate calls reverted, uniform route colour, Changes-mode
source-root fix), on top of
step 12 phases B/C review fixes (analyzer visibility and lexical-receiver rules,
ADR 0010 amendment; keyboard card menu and stack focus retention), on top of
step 12 phase C (full outgoing journey from any root: candidate calls and
OVERRIDES facts, ADR 0010; type targets, dispatch, card-hop layers and the beyond-the-map count in
the stack), on top of
step 12 phase B follow-ups (fact-level stack traversal at the root's granularity,
root look for the whole root set), on top of
step 12 phase B, the outgoing relation stack (docs/OUTGOING_STACK.md), on top of
step 12 phase A review remediation, on top of selection outside undo
history (step 12 phase A, ADR 0009), on top of
selected-edge moving dashes and directional margins, with
view-only map controls excluded from undo/redo with stronger zoom steps,
on top of selection direction and change-color redesign (Step 10 backlog, step one)
and Changes-mode layout continuity (step zero),
with the package-only exploration view (Class/Method level view removed,
see below), Git review merged into the Code map as a per-tab Changes
toggle with a git-style diff code viewer, exploration tabs with per-tab undo/redo
and selection controls, the R6 change-edges slice (one line per direction,
directional selection emphasis, file-grouped evidence), in-place card details
(expand packages/classes) and resizable cards; Step 6A remains unstarted

## Changes-mode review fixes (2026-10-01, ADR 0006 amendment)

Owner report from the packaged app, data dir `/home/sajjad/projects/data`:
1. Changes mode drew no colours.
2. Nothing changed across several base commits.
3. `second-review-assist/src` "could not find .git".

Facts collected:
- Workspaces in the owner's DB (read-only queries), all JavaParser and Java:
  - `review-assist/src/main`: a module, with repository root `review-assist` set;
  - `second-review-assist/src/main`: a module, auto-detect;
  - `second-review-assist/src`: the Git root, with root = itself.
- `prompt-proof/data` holds only Sep 28 test leftovers (V011), so it was not the tested database.
- The owner compared `review-assist/src/main` against `c760d82`, `bf4f88b` and `9c2045e`. `git diff --stat <base> -- src/main`
  is empty for all three: every change was in `frontend/`, `docs/`, `scripts/` and `src/test/`. The API returned
  0 changed files, 864 UNCHANGED declarations and `CHANGES_OUTSIDE_WORKSPACE` "37 changed files … not compared". With
  `fe97bde`, 7 MODIFIED, 8 ADDED and 3 REMOVED declarations came back.
- The `second-review-assist` workspaces had no review snapshots. Replaying them on a copy of the owner's DB with the same
  jar:
  - an empty base returns 200 for both (12 MODIFIED, 124 ADDED);
  - base `9c2045e` or `main` returns 400 "Could not resolve the requested local Git base revision." (that repository's
    branch is `master`);
  - the owner confirmed that this was the error they saw.

Root causes:
1+2. Working as designed: the comparison is base versus working tree, Java only, the module subtree only (the owner
     confirmed that this is wanted). The defect was silence. The map gave no sign of an empty comparison, and the
     outside-workspace diagnostic was never shown.
3. The Base revision field outlived a workspace switch (`useReviewComparison` kept `baseRef`, and `reset()` did not
   clear it), and the error named neither the revision nor the repository. Both predate PR #5 (the same code is on
   `main`). PR #5 made case 1+2 reachable by making module workspaces reviewable.

Hypotheses tested and ruled out for problem 3:
- `.git` as a file (linked worktree): new test, passes before the fix;
- auto-detect from a module and an explicit root equal to the top level: both work through the API;
- symlinks, case and `/private/var`: not involved, because every path in the owner's DB is canonical and Linux.

Fixes (tests written first and seen failing):
- `reviewOutcomeNotice` / `reviewBaseRefFor` in `reviewModel.ts` (`scripts/test-review-model.mjs`):
  - an all-UNCHANGED comparison shows "No Java declarations or relationships changed between <base> and the working
    tree in this workspace." under the toolbar and in the popover;
  - `CHANGES_OUTSIDE_WORKSPACE` is shown in the popover;
  - Base revision is keyed by workspace.
- `ReviewService.unresolvedBase`:
  - the message is `Base revision "<ref>" is not a commit in the Git repository at <root>. Clear Base revision to compare
    with the default …`;
  - test: `ReviewApiIntegrationTest.reportsBadBaseAsClientErrorBeforeCreatingReviewSnapshots`, updated.
- `GitReviewSourceAdapter.discoverTopLevel`:
  - the errors name the checked path and say to set the repository root to the folder that contains .git;
  - tests: `GitReviewBoundaryTest.noGitAtOrAboveTheWorkspaceNamesThePathAndWhatToDo` and
    `aWorktreeWhoseGitEntryIsAFileIsItsOwnTopLevel`.

Checks run:
- `./gradlew test`: 231 tests, 1 failure, `ScipJavaLiveIndexingTest`. scip-java's `GradleBuildTool` needs a `gradle`
  on PATH, and this machine has none. Re-run with
  `PATH=~/.gradle/wrapper/dists/gradle-8.12.1-bin/…/gradle-8.12.1/bin:$PATH ./gradlew test --tests
  "dev.codeatlas.analysis.ScipJavaLiveIndexingTest"`: PASS. This is environmental and unrelated to this change.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- All 17 `node scripts/test-*.mjs`: PASS.
- `python3 scripts/verify_git_review_pipeline.py`: PASS, both before the fix and after it (0 failed checks).
- `python3 scripts/verify_diff_navigation_pipeline.py`:
  - before the fix, without Gradle on PATH: FAIL, because scip-java exited 1 on its fixture (same environmental cause);
  - after the fix, with the cached Gradle 8.12.1 on PATH: PASS (0 failed checks).
- Real check on the owner's repositories (`docs/evidence/review-fixes/real-repo-check.mjs`):
  - setup: a fresh copy of the owner's DB, the pre-fix jar versus the fixed jar, and the closed model port;
  - the journey: `review-assist/src/main` against base `HEAD` (clean tree, so nothing changed in the module), then
    Recompare `fe97bde`, then an in-app switch to `second-review-assist/src` and Changes on.
  - Before: a blank overlay with no explanation; colours on `fe97bde`; the switch carried `fe97bde` over and failed
    with the old message.
  - After: the notice is shown; colours on `fe97bde` plus "43 changed files outside this workspace"; the base is empty
    after the switch, and the overlay shows 4 MODIFIED and 1 ADDED cards with +7/−3 routes.
  - Screenshots inspected; reports in `real-*-report.json`.
- Screenshots inspected and copied to `docs/evidence/review-fixes/`: git-review 02/03/05 and diff-navigation 04/05/10.

- `python3 scripts/verify_stable_graph_pipeline.py acceptance`: FAIL, before and after this change alike. On
  `claude/diff-navigation` itself, `verify-stable-graph-ui.mjs` throws `TypeError: Cannot read properties of undefined
  (reading 'click')` at the same step. The break predates this work and was not investigated. The empty-comparison
  notice adds a row above the canvas only while an empty comparison is shown in Changes mode. That case is not
  covered by this suite.

Not run:
- the other browser suites, since the change does not touch the reducer or the placement code;
- `constrainedMemoryTest`;
- the review path was not exercised on Windows or macOS.

## Go to definition in the Changes diff and an optional repository root (2026-10-01, ADRs 0014 and 0015)

Bounded acceptance criterion:
- Ctrl/Cmd+click on a name in a Changes diff row (unified or split) jumps to its definition as it does in a plain
  file, on added files and added lines included. Deleted rows say they are not navigable, and find in file keeps
  working.
- A workspace that is a module may name its repository root (Git root plus the build's upper boundary) in the import
  form.

Decisions:
- D1–D6 were settled with the owner beforehand.
- A grilling round settled the questions found in the code (all recommendations accepted):
  - Q1: stack on PR #4, which was still open, on branch `claude/diff-navigation`;
  - Q2: a module's review covers its own subtree, keyed workspace-relative;
  - Q3: module workspaces with no root are reviewed from the detected top level;
  - Q4: the existing endpoints serve the review head;
  - Q5: the active snapshot at request time answers.
- No AGENTS.md invariant changed: review captures still never build.

Commits:
1. `feat(workspace)`, the repository root:
   - V014;
   - `RepositoryRootValidator`;
   - `AnalysisPort.locateBuildRoot` / `prepareWorkspace`, with scip-java's bounded `ScipJavaTool.find/locate`;
   - the build-marker 400 at registration;
   - review Git-root choice and top-level discovery without upward Git search, module-prefix scoping and the
     `CHANGES_OUTSIDE_WORKSPACE` diagnostic;
   - snapshot provenance.
2. `feat(graph)`, review-head navigation:
   - `NavigationService` serves `REVIEW_HEAD` from the active snapshot by per-file `content_hash`, with `stale`
     otherwise;
   - `servedFrom` on both endpoints;
   - per-location `snapshotId` / `differsFromChange`.
3. `feat(source)`, the viewer:
   - `diffNavigation.ts`;
   - `SourceDialog` navigates diff rows through the head snapshot;
   - (snapshot, path) caches, so jumps open the head diff, plain source, or the current analysis with a chip;
   - snapshot-aware `navigationStack` views;
   - the stale hint and the "Navigation from …" note;
   - the import form's Repository root field (`workspaceRequestBody`).
4. Pipeline and docs:
   - `scripts/verify_diff_navigation_pipeline.py` + `verify-diff-navigation-ui.mjs`;
   - ADRs 0014 and 0015, plus amendments to ADRs 0006, 0012 and 0013;
   - ARCHITECTURE, TESTING, GIT_REVIEW and CLAUDE.md;
   - evidence.

Checks run:
- `./gradlew installScipJava` — PASS (the tool was already in `data/tools/scip-java/lib`).
- `./gradlew test` — PASS: 229 tests, 0 failures, 0 skipped. `ScipJavaLiveIndexingTest` ran the real scip-java
  and Gradle. New tests:
  - `ReviewDiffNavigationTest` (6), with a fake non-Java engine through the real `runReviewAnalysis`: an added file
    and an unchanged file served from the active snapshot with `servedFrom`; a modified file whose hash matches; a
    target changed since the analysis opening the active snapshot with `differsFromChange`; a stale file on both
    endpoints; a deleted path as `no_file`; the active engine's capability with the base answering for itself; a
    workspace with no analysis; an ordinary snapshot naming itself.
  - `RepositoryRootIntegrationTest` (6): not an ancestor, missing, a file, a symlink escape, and equal or linked
    ancestors accepted; the build-marker 400 before any row is written; omitting keeps, the form replaces or clears,
    nothing is analyzed, snapshots record the root; module review from an explicit root with the same paths and
    hashes as the active snapshot, `build/` excluded and the outside diagnostic; auto-detected top level; a root that
    is not a Git top level, or no Git at all, gives 400.
  - Extended: `ScipJavaToolTest` (bounded search), `GitReviewBoundaryTest` (prefix scoping, `mod-two` is not
    `mod`, top-level discovery), `AnalysisServiceDispatchTest` (the root reaches a non-Java engine and is recorded).
  - `IndexerSelectionIntegrationTest` now gives its scip-java projects a `settings.gradle`, because registration
    checks for a build marker (D5).
- `./gradlew constrainedMemoryTest --no-daemon` — PASS (BUILD SUCCESSFUL in 4m 2s).
- `cd frontend && npx tsc -b --force && npm run build` — PASS.
- All 17 `node scripts/test-*.mjs` — PASS:
  - new `test-diff-navigation.mjs`: unified and split rows, added files without `oldNo`, left-only and blank cells,
    head line lengths, row and column to head line and token, jump targets, messages;
  - extended navigation-stack, code-token and import-engine suites.
- With `CHROMIUM=/opt/pw-browsers/chromium` (`/snap/bin/chromium` does not exist here), against the packaged jar:
  - `verify_language_import_pipeline.py` — PASS;
  - `verify_git_review_pipeline.py` — PASS (source tree and index unchanged);
  - `verify_code_navigation_pipeline.py` — PASS;
  - new `verify_diff_navigation_pipeline.py` — PASS.
- The new pipeline's setup: a Git repository built from a copy of `test-fixtures/scip-gradle-project`, with
  `Farewell.java` added and a `GreetingService` line edited in `app`. The module `app` was imported through the form
  with the repository root set to the copy, and with scip-java and consent. Checks, all with real CDP input:
  - the form at 390 px;
  - Ctrl+hover and click in the added file jumps into `GreetingService.java`'s diff;
  - Ctrl+click on the added line's `bye` and `Farewell` opens the added file's diff, in unified and split layouts;
  - Alt+←/→;
  - the deleted row's message in both layouts;
  - the stale hint after editing `Main.java` and Recompare;
  - an unchanged plain file still navigable;
  - the dialog at 390 px;
  - no page errors and no off-machine requests;
  - the copy unchanged except the driver's own `Main.java` edit.

  All 11 screenshots were inspected. They and `diff-navigation-report.json` are in `docs/evidence/diff-navigation/`.

Found and fixed during verification:
- Git's ceiling directory (the queried directory's parent) blocked top-level detection from a module, so the top
  level is now found by walking to `.git` and confirmed by Git there.
- The review file list includes non-Java changes under the module (as at the root before); only the capture
  excludes `build/`, and the test was corrected.
- At 375 px the indexer `<select>`'s long scip-java label pushed the import form past the screen (seen in the
  language-import mobile screenshot). Fields now take their column's width, and the separate "optional" line that
  misaligned desktop labels moved into the placeholder.
- Split-layout cells collapsed leading indentation (also visible in `docs/evidence/git-review/05-diff-split.png`, so
  it predates this work). Split code now keeps `white-space: pre`.

Not run / limits:
- The other browser pipelines (stable graph, hierarchical, change edges, ungroup, outgoing stack) were not rerun:
  they do not open the source dialog's diff navigation or the import form's root.
- The "Current analysis — differs from this change" chip is covered by `ReviewDiffNavigationTest` and the pure tests,
  not in the browser: the fixture has no definition inside a file edited after analysis.
- Navigation in the diff needs a navigation-providing engine on the workspace and an analysis newer than the change;
  otherwise the hint explains why.
- Deleted lines and the base side have no navigation.
- Review still captures Java files only (ADR 0008 gap).

## Source-viewer navigation: find in file, Ctrl/Cmd+click go to definition (2026-10-01, ADR 0013)

Bounded acceptance criterion: in the read-only source dialog, find in file works for every snapshot. For a
snapshot whose engine provides navigation, Ctrl/Cmd+click on a resolved name (from relationship evidence or any
file shown) jumps to its definition, in the same or another file, with back/forward. Navigation is a declared
engine capability with a language-neutral contract, so a future Go/Dart/TS engine lights it up by filling
`code_occurrences`. Decisions were settled with the owner in a grilling round (all recommendations accepted): no
graph side effects on a jump; Find references deferred; the capability is a port method; limits of 50,000
occurrences per file and 10,000 find matches; a jump replaces the dialog body, with a dialog-local
back/forward stack; `not_indexed` answers carry the engine labels.

Commits (each verified before the next):
1. Find in file: `findInFile.ts` and `codeTokens.ts` (pure); the dialog find bar (Ctrl/Cmd+F, "N of M",
   Enter/Shift+Enter, match case, Unicode whole word) over the plain lines or the current diff layout's rows.
2. Backend: `AnalysisPort.providesNavigation()` (scip-java true), `IndexerDescriptor.providesNavigation`,
   `AnalysisPortRegistry.find` / `navigationIndexerLabels`; `NavigationService` capability from the snapshot's
   recorded engine (rows only as a fallback for retired engines); `GET /files/occurrences` (compact symbol table
   and rows, no engine keys exposed, 50,000 cap with `truncated`/`total`); capability fields on `not_indexed`.
3. Viewer: tokens only from occurrence rows; Ctrl/Cmd hover underline; click goes to definition (one location
   jumps, several open a `path:line` picker, external shows "<name> · outside workspace", not_indexed shows
   the data-driven hint); `navigationStack.ts` back/forward (buttons, Alt+←/→) restoring scroll, never undo
   history; the dialog is focusable so keys work after a click in code; go to definition off in diff sections
   (and says so). New pipeline `scripts/verify_code_navigation_pipeline.py` + `verify-code-navigation-ui.mjs`.
4. Docs: ADR 0013, ARCHITECTURE.md (analysis boundary, `source/`), ADR 0012 note, TESTING.md, CLAUDE.md
   commands, evidence in `docs/evidence/code-navigation/`.

Checks run:
- `./gradlew installScipJava` — PASS on the second attempt (the first got HTTP 429 from Maven Central; retried
  with backoff).
- `./gradlew test` — PASS: 214 tests, 0 failures, 0 skipped (`ScipJavaLiveIndexingTest` ran the real scip-java
  and Gradle). New: `NavigationServiceTest` (5), which drives `/api/indexers`, `/files/occurrences` and
  `/files/definition` over MockMvc for a fake non-Java `fixture` language. Its two engines run through the real
  `AnalysisService`; the navigating one writes `code_occurrences` for `.fx` files. Covered: a local jump, a
  cross-file jump, external, several definitions, a comment word with no row, truncation, a source-only engine
  (`not_indexed` with labels), and a retired engine (row fallback). `ScipJavaAnalysisIntegrationTest` also
  checks the occurrences payload.
- `./gradlew constrainedMemoryTest --no-daemon` — PASS (BUILD SUCCESSFUL in 4m 6s).
- `cd frontend && npx tsc -b --force && npm run build` — PASS.
- All 16 `node scripts/test-*.mjs` — PASS. New: `test-find-in-file.mjs`, `test-code-tokens.mjs` (Go- and
  Dart-shaped files tokenized from occurrence rows; UTF-16/emoji columns; stale and nested rows; hint text),
  `test-navigation-stack.mjs`.
- `CHROMIUM=/opt/pw-browsers/chromium python3 scripts/verify_language_import_pipeline.py` — PASS. (Its default
  `/snap/bin/chromium` does not exist in this container.)
- `python3 scripts/verify_code_navigation_pipeline.py` — PASS against the packaged jar and real Chromium, with
  real CDP key and mouse input. Both fixture copies were imported through the form (scip-java with consent, and
  JavaParser) and were byte-identical afterwards. The model URL pointed at a closed port, and every page request
  stayed on the local app. Checked:
  - Ctrl+hover underlines `greet` in `greeter.greet(name)` in the app→core route's evidence;
  - Ctrl+click jumps to `core/.../Greeter.java:4` (another module);
  - Alt+← restores the evidence at the same scroll offset, and Forward returns;
  - the local `name` jumps to its `for` declaration (line 13);
  - `add` and `List` show "· outside workspace" and do not navigate;
  - find "greet": 1 of 27, Enter → 2, Shift+Enter ×2 wraps to 27; whole word plus match case → 1 of 2;
  - 390 px with the find bar: no horizontal page scroll, and the header fits;
  - on the JavaParser snapshot, Ctrl+click shows "This snapshot's indexer (JavaParser (source only)) doesn't
    provide go to definition; engines that do: scip-java (…)", and find still works.

  All nine screenshots were inspected; they are in `docs/evidence/code-navigation/` with
  `navigation-report.json`.

Found and fixed during verification:
- the hint rendered below the sticky header, out of view once the user had scrolled, so it moved into the header;
- after a click in code, focus could leave the dialog (Alt+arrows and Ctrl+F lost), so the dialog is now
  focusable;
- at 390 px the find bar wrapped awkwardly, so the input takes its own row on narrow screens.

Not run / limits: the other browser pipelines (stable graph, hierarchical, change edges, git review, ungroup) were
not rerun; they do not open the source dialog's new paths, and find/tokens leave plain lines as one text node.
The several-definitions picker is covered by the backend test (two definitions) but not exercised in the browser:
the fixture has no symbol with two definition sites. Touch devices get find but not go to definition (a modifier
key is needed). There is no virtualization for very large files. Go to definition is off inside the Changes diff.
Find references and "show on map" are deferred (ADR 0013 follow-ups).

### Review fixes (2026-10-01)

Two P2 findings from a Codex review of PR #4, both in `SourceDialog.tsx`:
- **Back did not restore an offset of 0.** A fresh entry and a view left at the very top both stored
  `scrollTop: 0`, and restoring ran only for `> 0`. So Back to a view left at the top kept the later view's
  offset (Codex reproduced 0 → 1778 → 1778). In `navigationStack.ts`, an entry not yet left now stores `null`;
  any number, 0 included, is a remembered position. The dialog restores every remembered offset and centres the
  target only for a fresh jump. The evidence view's "scroll to the highlight" also now runs only when the offset
  is `null`.
- **A late answer could fill the new snapshot's cache with the old snapshot's file.** The whole-file and
  occurrence caches were keyed by path alone. They were cleared when `snapshot` changed, but a request still in
  flight from the earlier snapshot refilled the same path key afterwards, so OLD source showed under NEW. Both
  caches are now keyed by (snapshot, path), as on the diff-navigation branch (PR #5), so a late answer lands
  under a key nothing reads.

Checks run:
- `node scripts/test-navigation-stack.mjs`: PASS. A new case checks that a view left at the top remembers 0,
  that Back restores 0 and not the later offset, and that fresh entries remember `null`.
- All 16 `node scripts/test-*.mjs`: PASS.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- `./gradlew bootJar`, then `CHROMIUM=/opt/pw-browsers/chromium python3 scripts/verify_code_navigation_pipeline.py`:
  PASS. Step 3b is new: in a 260 px tall window, leave the evidence view at the top, go Forward, scroll the
  definition to the bottom, and press Alt+←. The view must come back at `scrollTop` 0. Run against the jar
  built before the fix, the same step failed with "back restores the top (75 -> 75)", which is the reported
  bug. It passes against the rebuilt jar.

Not run: `./gradlew test` (the change is frontend only, and no backend file changed), and the other browser
pipelines. The cache race has no browser check, because it needs a response delayed past a snapshot change.
The fix holds by construction: no key that the current snapshot reads can be written by another snapshot's
request.

Merged into the diff-navigation branch (PR #5), which already keyed both caches by (snapshot, path) and
inherited the Back defect. The conflicts were resolved by keeping PR #5's multi-snapshot cache code and adding
the `null` offset. Checks on the merge: `npx tsc -b --force && npm run build`, all 17 `node scripts/test-*.mjs`,
then `./gradlew bootJar`, `verify_code_navigation_pipeline.py` and `verify_diff_navigation_pipeline.py` (both with
`CHROMIUM=/opt/pw-browsers/chromium`): all PASS.

## scip-java: a second, opt-in Java indexer (2026-09-30, ADR 0012)

Bounded acceptance criterion: a workspace can choose scip-java instead of JavaParser; with the owner's explicit
consent it compiles the project's own Gradle build (found from a module path up to the Git root) in a private copy,
reusing the local Gradle cache offline-first, and publishes a snapshot with JavaParser-shaped graph facts plus a
navigation occurrence index answering go to definition. JavaParser stays the default; review captures never build.

Changed: engine seam (`AnalysisPort.indexer()` …, registry keyed by language + engine), V013 (`indexer` on
workspaces/snapshots, nullable = language default; `code_occurrences`; cleanup trigger), `analysis/scip/`
(dependency-free SCIP decoder, symbol grammar, Java signature reader, `ScipJavaTool` runner),
`ScipJavaAnalysisAdapter`, shared `SpringFrameworkPass`, build-consent (`trust_state = 'build_allowed'`),
`GET /api/indexers`, `GET /api/snapshots/{id}/files/definition`, import-screen engine picker + consent,
`./gradlew installScipJava` (scip-java 0.12.3, isolated from Boot's BOM), fixture
`test-fixtures/scip-gradle-project` + golden index. AGENTS.md invariant amended per ADR 0012.

Checks run:
- `./gradlew test --no-daemon` — PASS (full suite incl. `ScipJavaLiveIndexingTest`, which ran the real
  scip-java + Gradle): 197 tests, 0 failures, 0 skipped.
- `./gradlew constrainedMemoryTest --no-daemon` — PASS.
- `cd frontend && npx tsc -b --force && npm run build` — PASS; all 12 `node scripts/test-*.mjs` — PASS.
- `CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome python3 scripts/verify_language_import_pipeline.py` — PASS.
- Packaged-app browser run of the scip-java flow, screenshots inspected: `docs/evidence/scip-java-indexer/`.

Found and fixed during verification: a Java-specific `indexer` column default broke non-Java workspaces
(caught by `AnalysisServiceDispatchTest`); Re-analyze re-sent the picker state without consent; record headers and
`new Outer.Inner()` lost IMPLEMENTS/CONSTRUCTS; scip-java's two-way override links and missing record supertypes.

Not run / limits: other browser pipelines (stable graph, hierarchical, change edges, git review, ungroup) were not
rerun — they do not touch import or analysis engines. The online fallback is verified with a stand-in tool, not a
real cache miss. Gradle only (Maven/sbt not wired). scip-java 0.12.3 prints internal NullPointerException notes
while compiling records (build still succeeds, index complete for the fixture). No Ctrl+click/find UI yet — the
definition endpoint is the backend for it.

### Review fixes (2026-10-01)

Four code-review findings on the scip-java change, fixed in the working tree:
- [P1] Import form submits the engine it displays: `importEngine.ts` (`importEngineChoice`) resolves the picker's
  engine (language default from `/api/indexers`, else built-in `javaparser`); `ImportScreen` passes it to
  `onSubmit`, and `analyze()`'s default (used by `?autoPath=`) is the explicit source-only default. Omission stays
  only on Re-analyze source and Recent-project re-analysis.
- [P1] Build output out of logs: `ScipBuildFailedException` (message = build + failure only; tail in
  `buildOutputTail()`); `AnalysisService.userFacingError` puts the tail in `jobs.error_message` and the failed
  snapshot's diagnostics, while the log gets the sanitized message and stack trace.
- [P2] Indexed bytes retained: `ScipJavaTool.index` returns `IndexedBuild(index, sources)` with the workspace's
  indexed `.java` text read from the private copy after the build (`captureSources`); the adapter stores it,
  builds evidence and the Spring pass from it, and adds a "changed on disk while scip-java indexed it" diagnostic
  when the disk differs. No captured text: disk content, diagnostic, no facts.
- [P2] Multi-line constructor expressions: `ScipJavaAnalysisAdapter.constructorSite` scans tokens backwards across
  lines (whitespace, `//` and `/* */` comments, qualifiers, type arguments, type annotations); `T::new` is detected
  from the occurrence's end, since scip-java's range spans `T … ::new`. Fixture gains `app/.../Factories.java`
  (multi-line `new`, comments between, split qualifier, `T\n::new`); golden index regenerated with the real
  scip-java 0.12.3 in a scratch copy of the fixture (fixture left without `build/`).

Checks run:
- `rm -f data/codeatlas.db* && ./gradlew test --no-daemon` — PASS: 209 tests, 0 failures, 0 skipped
  (`ScipJavaLiveIndexingTest` ran the real scip-java + Gradle, 16 s). New: `ScipJavaConstructorSiteTest` (7),
  `ScipJavaToolTest` sanitized-message/log and source-capture tests, `ScipJavaAnalysisIntegrationTest`
  indexed-text-differs, no-captured-text and build-output-not-logged tests.
- `cd frontend && npx tsc -b --force && npm run build` — PASS. All 13 `node scripts/test-*.mjs` — PASS (new
  `scripts/test-import-engine.mjs`).
- Packaged app (`./gradlew bootJar`, `java -jar build/libs/code-atlas-0.1.0-SNAPSHOT.jar` with a scratch data dir):
  `test-fixtures/scip-gradle-project/app` registered via API with scip-java + consent and analyzed (snapshot
  indexer scip-java); then a fresh page, picker left at its default (shows JavaParser, no consent box), submitted
  the same path: POST body `{indexer: "javaparser", allowBuildExecution: false}`, workspace became
  `javaparser`/`source_only`, new snapshot indexer `javaparser`. An `?autoPath=` page sent the same explicit body.
- `CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome python3 scripts/verify_language_import_pipeline.py`
  — PASS (form request now carries `indexer: javaparser`; re-analysis and recent-project requests still omit it);
  screenshots in its `build/language-import/run-*` directory inspected.

Not run: `constrainedMemoryTest` and the other browser pipelines (no change to graph/explorer code). No new
screenshots were added to `docs/evidence/scip-java-indexer/` (the import screen looks unchanged).

## Step11 GitHub integration with Step12–14 (2026-09-30)

Bounded acceptance criterion: merge the completed language analysis boundary into
GitHub's current default `main` while preserving its 24 newer commits and shipped
package-only explorer, Changes mode, stacks, history and Ungroup behavior. There is
no remote `master` branch. Original Step11 work is committed as `b32093c`; upstream
baseline is `e77efab`. Conflicts combine language dispatch with original-workspace
review resolution and cross-file OVERRIDES linking. Both distinctly named ADR 0008
files are preserved; the supplied multi-language ADR is byte-identical.

Integration checks: backend 166 tests PASS; all 12 Node suites PASS; frontend build
and independent forced TypeScript/build check PASS; real language-import browser
PASS; current Ungroup browser 33/33 PASS. All 15 screenshots inspected. Packaging
and constrained-memory validation are recorded with final outcomes in
[the integration report](docs/evidence/step11/integration/README.md), along with
exact commands, artifact paths, skipped checks and limits. The historical Step11
stable-map pass is pre-integration evidence, not a current package-only UI gate.


### Post-merge review remediation (2026-09-30)

The independent post-merge review found no confirmed introduced product defect.
Corrected the current integration Node count from 13 to the actual 12 suites, and
recorded Java-specific Git capture, top-level function graph/UI decisions and
unverified native SDK/discovery/network/fixture work before a second language ships
in `docs/ARCHITECTURE.md`.

Fresh canonical `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
CODEATLAS_DATA_DIR=/home/sajjad/projects/second-review-assist/review-assist/build/postmerge-review/test-data
./gradlew test constrainedMemoryTest bootJar --no-daemon`: PASS, exit 0; 166 ordinary
tests and one 256 MiB constrained-memory test, zero failures/errors/skips. All three
previously socket-blocked ModelClientService HTTP cases passed. Forced frontend
TypeScript/build and all 12 fail-fast Node suites: PASS. Exact commands, parsed XML
counts, suite manifest and limits are in the
[remediation report](docs/evidence/step11/postmerge-review/README.md).
Parent packaged import verification and 33/33 Ungroup checks: PASS, exit 0; all
15 fresh screenshots inspected. Parent diff/XML review passed, production sources
are unchanged and real data hashes match the baseline. Remediation contains only
documentation and durable verification evidence.


## Step 14: Ungroup, an expanded box hidden (2026-09-28)

Branch `feat/step14-ungroup`. The user asked for a package to "vanish and give all its classes to
the higher level", and the same for a class and its methods. The design was settled in a grilling
session and recorded in ADR 0011: a hidden expansion, not a promotion.

- **Model.** `ExpansionState.hidden` and `UNGROUP_RESOURCE` (explorerViewState), with the pure
  helper `nearestHiddenAncestor`. `projectDisplayed` flags `hiddenBox`. A hidden card is off the
  map for undo/redo selection pruning and stack-root pruning (`revalidateJourney`), and
  `sameExpansionMembership` compares the flag.
- **Layout.** `expansionLayout.roomMoves` is the make-room cascade moved out of App as a pure
  function; it looks through hidden boxes and stops at the nearest visible container.
  `containerBox(..., hidden)` has no padding and ignores a stale minimum.
  `focusedArrangement.arrangeDisplayed` is App's arrangement moved out as a pure function, with
  freed cards as individual units.
- **Stack.** `outgoingStack` gets rule 9: a hidden box's layer goes to its freed cards.
- **Canvas.** An invisible, inert hidden-box style is declared last. There is an Ungroup corner
  button and an "Ungroup X" menu item on an expanded box, and "Collapse into X" (nearest hidden
  ancestor, centred on its children, no make-room) on anything inside one. Hidden boxes are
  skipped by the minimap, marquee and box-select, and emphasis classes are stripped from them.
- **Method cards.** They read `OwningClass · last.two.package` (`ownerName` from `decorate`).
- **Bugs found by the browser run and fixed.**
  - A collapsed card stayed invisible: Cytoscape `data()` merges, so a stale `hiddenBox` was kept.
    The flag is now always written.
  - A hidden box related to the inspected card pulsed a halo: the pulse is a style bypass. Emphasis
    classes are now stripped from hidden boxes.
- **Found in review and fixed.**
  - A hidden card picked outside the canvas (tree "View classes", search, Back) was the canvas
    selection. It lit nothing and muted every card, and the keyboard menu could open on it and
    root a stack at an invisible card. Now the canvas treats it as undrawn, the keyboard menu
    refuses it, and the inspector reports `UNGROUPED`: "Ungrouped on the map", with Arrange
    disabled.
  - The stack's layer handoff now runs on raw distances before ranking (`depth` stays
    `rank.size`), so badge numbers cannot skip.
- **Deliberate behaviour change.** Double-click arrangement of a visible expanded top-level box
  moves its stored anchor by the box offset. The old `arrangeAround` stored the box centre. This
  matches the drag anchor rule and is pinned by a focused-arrangement check where the anchor and
  the centre differ.
- **Deviation from the plan.** The plan named `verify_stable_graph_pipeline.py acceptance` for the
  browser checks. That suite is still broken by the ADR 0007 level switcher (see earlier entries),
  so a dedicated `scripts/verify_ungroup_pipeline.py` + `verify-ungroup-ui.mjs` was added instead.

Checks (this entry's tree):
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  12/12 PASS. New checks:
  - view-state 73 (7 new);
  - journeys 56 (3 new);
  - expansion-layout: 4 new blocks;
  - focused-arrangement 17 (5 new);
  - outgoing-stack 43 (2 new);
  - graph-model: 2 new blocks;
  - node-card: 1 new block.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test`: PASS, 21 classes, 150 tests, 0
  failures. No backend source changed.
- `git diff --check`: clean.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_ungroup_pipeline.py`:
  28/28 PASS (run `build/ungroup/run-rol33uhc`). Both fixture copies hashed unchanged, model URL on
  a closed port. Earlier runs failed on the two app bugs above and on three test-side issues:
  - the centre measured with halo-inclusive bounding boxes;
  - a card left over the restored package;
  - the ellipsized label expectation.
- `verify-outgoing-stack-ui.mjs` regression: 108/108 PASS, run twice (before and after the review
  fixes). It ran through the `isolated4.sh`
  harness copied to the session scratchpad and pointed at this checkout (jar on 8095, Chromium on
  9333). `stop` reported all four fixtures unchanged, 0 model requests and the ports free.
- Evidence `docs/evidence/ungroup/01..08` was inspected:
  - 01: services has no box, and its two classes stand free with their routes.
  - 01b: services picked from the tree: the "Ungrouped on the map" notice, Arrange disabled,
    nothing muted, no box.
  - 02: EventService is dragged away, and domain sits in the old area and is inspected.
  - 03: EmailServiceClient's menu shows "Collapse into com.kipper.eventsmicroservice.services".
  - 04: services is back as a collapsed card.
  - 05: after the menu Ungroup, no outline is left.
  - 06: EventService's five methods are free, reading "EventService · eventsmicros…".
  - 07: the arrangement around EmailServiceClient places the methods individually.
  - 08: in Changes, the MODIFIED services box is hidden and EventService keeps its CHANGED badge.
- Not run:
  - `verify_stable_graph_pipeline.py`: known broken by ADR 0007, see above.
  - The hierarchical, change-edges and git-review pipelines: they don't touch expansion
    geometry, arrangement or stack layers.
  - `./gradlew constrainedMemoryTest`: no backend change.
- Not retaken, by user decision: existing screenshots for other features, whose method cards now
  show the class name.

### Review remediation (2026-09-28)

Fixes for the adversarial review of step 14 (14 findings). The report's "disproved claims" in its
§7 point at the expand-in-place sentences about the tree ⌖, the inspector, entry points and the
deep link ("Repurposed the four former level-switch triggers..."). Those sentences come from the
ADR 0007-era entry "Package-only exploration view — Class/Method level view removed (2026-09-22)",
not from step 14. The defects were already on `main` (findings 1, 2, and 6's ⊟ case) and are
fixed here all the same.

- **1 (pre-existing).** `toggleExpand` dispatched `ownerId: null` for a graph node from the tree,
  inspector or reveal chain, so the reducer rejected every class. It now resolves the card as drawn
  (`projected.nodes`), does nothing for an undrawn card, and returns whether the change lands
  (checked with the pure reducer).
  - The tree ⌖ / inspector "View methods" (`revealChildren`) and entry-point cards
    (`expandToReveal`) open the containers from the new `graphModel.revealContainers`: the
    package, then, for a method or constructor, its own type. A nested type's outer class is never
    opened.
  - One pending mechanism serves both. A step that cannot land, or expansions that change without
    it, ends the reveal instead of waiting forever.
- **2 (pre-existing).** The deep link walked the raw `parentId` chain and read a class's position
  from the top-level positions. It now uses `revealContainers`, reads a type's position from its
  package's `childPositions`, and passes that package as `ownerId`.
- **3.** `outgoingStack` `repOf`: a hidden box represents only itself. This is checked before the
  representative cache, so an earlier lookup of the box cannot leak. An undrawn member counts
  beyond the map.
- **4.** The browser check for individual arrangement now requires at least two different
  displacement vectors among the freed methods.
- **5.** Incoming rule-9 unit checks (hidden package; hidden class inside a hidden package).
- **6 (⊟ pre-existing).** Both collapses go through `explorerJourney.collapseInJourney`, which
  drops every card drawn inside from `multiIds` in the same update: one undo entry.
- **7.** The inspector hides "View classes ↗" / "View methods ↗" when `mapStatus` is `UNGROUPED`.
  The browser step 1b check now also asserts that no "View classes ↗" button is offered.
- **8.** `outgoingStack` returns null for a hidden root.
- **9.** `revalidateJourney.displayedMap` passes `hidden` to `projectDisplayed`; the post-filter
  stays.
- **10.** The expansion-layout check adds R at `box(2500, 0)`, moving to x 2850.
- **11.** The focused-arrangement check asserts `childPositions.C` is `{ m1: { x: 0, y: 0 } }`.
- **12.** Browser step 6b clicks "Collapse into EventService" (after the arrangement step). It
  checks that EventService is a collapsed card inside the still-hidden services and its methods
  are gone. Re-expanding it shows that the multi-selected method did not come back selected.
- **13.** The browser check compares the rects: Ungroup is left of the stack toggle (the box is
  selected through the tree so the toggle is drawn), which is left of the collapse square, on one
  row without overlap.
- **14.** `cornerHit` returns null for a hidden box.
- **New browser coverage for 1 and 2.** From a fresh map, the tree ⌖ "View methods of
  EventService" opens services, then EventService, and inspects it. A
  `?selectedSymbol=<method id>` link draws the method inside EventService inside services, and
  inspects it.

Tests added:
- graph-model: the `revealContainers` block;
- outgoing-stack 48 (5 new): an undrawn class in a hidden package; the cache order; a hidden root;
  two incoming rule-9 cases;
- journeys 59 (3 new): collapse prunes multi-selection, expanded and ungrouped, one undo entry;
  rejected collapse unchanged;
- expansion-layout: R;
- focused-arrangement: `childPositions.C`.

The finding-3, cache-order and hidden-root checks were seen failing before the fix: the first
against the unfixed file, the other two by temporarily reverting their part of the fix. The
incoming, R and `childPositions.C` checks are coverage and passed on first run.

Checks:
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  12/12 PASS.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar -q`: PASS.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_ungroup_pipeline.py`:
  33/33 PASS (run `build/ungroup/run-oolybsdq`, copied to `docs/evidence/ungroup/`), fixtures
  hashed unchanged.
  - Earlier runs of the edited verifier failed on test-side issues, which were fixed:
    - the stack toggle is only drawn on a selected card;
    - a header click landed on a route;
    - the tree label is the short package name;
    - a button needed zoom.
  - One run showed a "1 selected" bar in 06b that the four later runs did not. The new
    multi-selection check asserts the state that the later runs showed.
- `verify-outgoing-stack-ui.mjs` through the `isolated4.sh` harness: 108/108 PASS. `stop`
  reported all four fixtures unchanged, 0 model requests and the ports free.
- `git diff --check`: clean.
- Evidence inspected (`docs/evidence/ungroup/`):
  - 01–08 were re-inspected from this run and show what the step-14 list above describes. 01 now
    lists services under "Recently viewed", because step 1 selects it through the tree;
  - 01b now has no "View classes ↗" button;
  - 06b: EventService is collapsed again, with no selection bar;
  - 09: services and EventService expanded, EventService inspected;
  - 10: createEvent inside EventService inside services, inspected.
- Not run:
  - `./gradlew test`: no backend change;
  - `verify_stable_graph_pipeline.py`: broken by ADR 0007;
  - the hierarchical, change-edges and git-review pipelines: untouched areas.
  - The new browser checks for findings 1/2 were not run against the unfixed App.tsx. That would
    need a rebuild of the old frontend; the failure was traced by code reading and the reducer
    rejection is pinned in the report's reproduction.
- Independent re-verification after the remediation, on the same tree, by the reviewing session:
  - Node tests: 12/12 PASS (journeys 59, stack 48, arrangement 17, view-state 73).
  - `npx tsc -b --force` and `npm run build`: PASS; `bootJar`: PASS.
  - `./gradlew test`: 150 tests, 0 failures. This closes the "not run" item above.
  - `verify_ungroup_pipeline.py`: 33/33 (run `build/ungroup/run-27jbhcwm`); fixtures unchanged.
  - `verify-outgoing-stack-ui.mjs`: 108/108, through the scratchpad `isolated4.sh`. All four
    fixtures unchanged, 0 model requests, ports free.
  - `git diff --check`: clean.
  - Screenshots 01b, 06b, 09 and 10 of that run were inspected and match the claims above.
  - The review glue (`toggleExpand`, `revealStep`, `collapseInJourney`) and the `repOf` hidden-box
    rule were read line by line. `collapse` via `journeys.update` is equivalent to the former
    `dispatchView` path, plus the multi-selection pruning.

### Merge with step 13 (2026-09-28)

`git merge origin/main` (`0b59123`, step 13) into `feat/step14-ungroup` after committing step 14
(`ef2a2be`). This is a merge, not a rebase. Conflicts were in `App.tsx`, `GraphCanvas.tsx`,
`nodeCard.ts`, `scripts/test-explorer-journeys.mjs`, `test-graph-model.mjs`, `test-node-card.mjs`,
`docs/TESTING.md` and this file.
- **One reveal mechanism.** Main's sequential expand queue (`startExpandQueue`/`advanceExpandQueue`,
  one explicit history group, `strict` drop, cleared on undo/redo, tab and graph change) is the
  only one. Step 14's `revealStep`/`pendingRevealRef` are gone. The queue now takes step 14's
  rules:
  - `revealChildren` and `expandToReveal` build their chain from `graphModel.revealContainers`,
    not the raw `parentId` walk, so a nested type's outer class is never opened;
  - the queue skips any card already in `expansions`, so a hidden (ungrouped) container is never
    toggled;
  - `toggleExpand` resolves the card as drawn (both sides agreed), so no nested card is sent
    with `ownerId: null`. It also keeps step 14's reducer pre-check, now for collapse too: a
    step whose action the reducer would reject returns false, and a strict queue ends then
    instead of waiting;
  - Explore keeps main's behaviour: it inspects (never `select`s) the handler and roots an
    outgoing stack. `revealChildren` keeps step 14's rule that an inspected target is
    deselected only when nothing needs opening. Main deselected it always.
  - The deep link in `loadSnapshot` is step 14's (package, then class, position read from the
    package's `childPositions`).
- **Collapse.** `toggleExpand`'s collapse goes through `collapse(action, group)` →
  `collapseInJourney`. The ⊟ square, the menu's Collapse (through the queue, in its group) and
  Collapse into therefore all prune `multiIds` in the same undo entry.
- **Card menu.** The order is: Remove, Deselect X, both stack items, Expand/Collapse, Ungroup X,
  Collapse into X, View source, Deselect. Main's `canToggle` excludes a hidden box, so Collapse
  never targets one. Collapse into uses main's `menuSingle` (the same right-click cleanup it had
  inline). Ungroup keeps its own handler, which already drops the box from `multiIds`. Collapse
  comes before Collapse into, which step 13's `menuClick('Collapse')` (`includes` match) relies
  on. The keyboard menu and the refusal on a hidden box are unchanged.
- **Cards.** Main's kind glyph (`kindGlyph`) and step 14's `placeLine` are both kept. The letter
  sits in the top-left badge and the owner line at y 166, so they don't overlap (ungroup shot 06).
- **Interaction fixed test-first.** Main's `toggleExpandMany` dropped a collapse target whose
  graph `parentId` chain held another target. A nested type is drawn beside its outer class in
  the package box, so "Collapse 2 selected" on an outer class and its nested type left the nested
  type expanded. The new pure `explorerViewState.collapseTargets` walks drawn containment
  (`containerId`) instead. Its check failed first (`collapseTargets is not a function`), then
  passed: view-state 73 → 74. No browser fixture reaches this case.
- **Verifier fix.** `verify-ungroup-ui.mjs` step 1b failed on the first merged run: "Timed out:
  services inspected from the tree". Step 13's tree toolbar (Collapse all, with the scope label
  on its own row) moves the tree down about 25 px, so the services row sat clipped under "Recently
  viewed" and the click landed there. `centerOf` now scrolls navigation elements into view
  (`block: 'nearest'`). Canvas overlays are never scrolled.
- **Docs.** `TESTING.md` (journeys 61, view-state 74), `STABLE_GRAPH_INTERACTIONS.md` (menu
  order, reveal rules), ADR 0011 (the reveal now runs through the queue). The other doc sections
  from both sides merged cleanly and are kept.

Verification (all run on the merged tree):
- `cd frontend && npm ci && npx tsc -b --force && npm run build`: PASS (the usual chunk-size
  advisory).
- `for t in scripts/test-*.mjs; …`: 12/12 PASS. Journeys 61 (53 + step 14's 6 + step 13's 2),
  view-state 74, outgoing-stack 48, focused-arrangement 17.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar test`: PASS, 21 classes, 150
  tests, 0 failures.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_ungroup_pipeline.py`:
  33/33 PASS (run `build/ungroup/run-buoz3p6l`, copied to `docs/evidence/ungroup/`); fixtures
  unchanged, model URL on a closed port.
- `isolated4.sh` harness (jar on 8095, Chromium on 9333), one start/stop per suite:
  - `verify-outgoing-stack-ui.mjs`: 108/108;
  - `verify-step13-ui.mjs`: 41/41. That is main's final count after its lead review; 38 was the
    earlier figure.
  - `verify-explorer-journeys.mjs`: 51/51 (run after the merge commit, since collapse grouping
    now goes through `journeys.update(fn, group)`).
  - After each run, `stop` reported all four fixtures unchanged, 0 model requests and the ports
    free.
- `git diff --check`: clean.
- Screenshots inspected:
  - ungroup 01: services has no box, its two classes stand free;
  - ungroup 01b: notice, Arrange disabled, no box, no "View classes";
  - ungroup 02: EventService dragged away, domain in the old area and inspected;
  - ungroup 03: menu order Remove, stacks, Expand, "Collapse into …services", View source,
    Deselect;
  - ungroup 04: services a collapsed card again;
  - ungroup 05: no outline left;
  - ungroup 06: `m` badges and "EventService · eventsmicros…" without overlap;
  - ungroup 06b: EventService collapsed, no selection bar;
  - ungroup 07: freed methods placed individually;
  - ungroup 08: EventService CHANGED, no services box;
  - ungroup 09: services and EventService expanded, EventService inspected;
  - ungroup 10: createEvent inside EventService inside services, inspected;
  - step 13 02: package menu Remove, both stacks, Expand, Deselect;
  - step 13 10: the handler inspected, "Outgoing stack: 1 layer · 2 resources";
  - step 13 12: controllers and EventController opened in place, EventController inspected.
- Not run:
  - `verify_stable_graph_pipeline.py` and the hierarchical, change-edges and git-review
    pipelines: known broken by ADR 0007, or untouched areas, as before;
  - `./gradlew constrainedMemoryTest`: no backend change.
  - `docs/evidence/step13/` was not refreshed. Its method cards predate step 14's owner line.
- Limits: main's note on a queue step whose dispatch the reducer ignores still stands. The
  pre-check reads the rendered `viewState`, so it can't see an update made earlier in the same
  tick.

## Step 13: card menu, tree collapse, entry-point stack, kind icons (2026-09-28)

Source: `~/prompts/step13/simple.txt`, four items. The design was settled in a grilling round;
"detail view" in item 1 means the read-only source viewer, since the card's "details" button
already expands it. One commit per item. No ADR: the reveal becoming one undo step refines the
undo contract (docs/STABLE_GRAPH_INTERACTIONS.md, updated) rather than departing from it.

1. **Card menu** (`GraphCanvas.tsx`): Expand/Collapse follows the right-clicked card's state and
   applies to every selected card that can make the same change; View source opens the clicked
   card's source (not on packages, which have no range). The menu is lifted to its measured height,
   so the taller menu stays inside the stage (it was clipped at the bottom before this fix).
   - Shared seam: `useExplorerJourneys.beginGroup()` plus an optional explicit group on
     `update`/`dispatchView`, and an App-level sequential expand queue (one card per render, since
     each expansion's geometry reads the previous result). The queue is one undo step. A strict
     queue (a reveal) is dropped when a card cannot be toggled and never resumes; the queue is
     also cleared on undo/redo, tab/journey switch and graph change.
   - `toggleExpand` now acts on the drawn card (so a nested reveal records the box it sits in) and
     returns whether it dispatched.
2. **Scope tree**: collapsing a branch closes every nested package (`scopeModel.collapseBranch`);
   **Collapse all** (`collapseAll`) closes the tree and is disabled while a search forces it open.
   Each is one `treeOpen` edit, so one undo step.
3. **Entry points → Explore**: switches to the Code map, expands the handler's ancestors, inspects
   the handler (`inspectNode`, never `select`, so a second Explore does not deselect) and roots
   its outgoing stack. The tab switch and expansions are one undo step; inspection and the stack
   root are selection (ADR 0009). A handler outside the current scope is disabled with
   "Outside scope"; a route whose handler is missing says "Handler not found". An ancestor that
   cannot open still inspects the handler. Undoing Explore takes the handler's card off the map,
   so its stack ends with it (checked in the browser).
   - Follow-up (review): tree `⌖` / inspector View classes/methods on a card inside collapsed
     cards opened nothing once `toggleExpand` began requiring a drawn card (before, it recorded an
     expansion for an undrawn card that never showed). It now opens the ancestors and the card
     through the same queue, and the whole reveal is one undo step.
4. **Kind icons**: the cube is replaced by a folder (packages) or an IntelliJ-style letter
   (C I E R @ m c f). The badge keeps the role tint (service/repository/default), so the role cue
   survives; the tree's type rows use the same letters.

Verification (all run in this session):
- `cd frontend && npm ci && npx tsc -b --force && npm run build`: PASS; the existing Vite
  chunk-size advisory.
- `for t in test-graph-model test-explorer-view-state test-graph-placement test-focused-arrangement
  test-explorer-journeys test-node-card test-source-evidence test-review-model test-outgoing-stack
  test-expansion-layout test-file-diff test-review-placement; do node scripts/$t.mjs; done`: PASS,
  all 12 (journeys 50, including the new explicit-group check; graph-model gains the tree-collapse
  cases; node-card gains the kind-icon cases).
- `./gradlew bootJar`: PASS.
- Browser, packaged jar on 8095 with an isolated data dir, model URL `http://127.0.0.1:9/v1`,
  headless snap Chromium on 9333, fixtures copied under the session scratchpad:
  - new `node scripts/verify-step13-ui.mjs <microservice copy>`: **PASS 36/36** on the final
    build, zero page/console errors. Earlier runs failed:
    - for script reasons: a missing CDP preamble, then a duplicate one; the tree walk assumed
      `com.kipper` was absent; the handler was looked up by a name that two methods share; and the
      Entry points tab click, which is its own undo step, was miscounted
    - for product defects, both fixed: switching to the map tab was a separate undo step from the
      reveal, and the taller card menu was clipped at the bottom of the stage (now lifted to its
      measured height and checked)
  - `node scripts/verify-explorer-journeys.mjs <microservice copy>` (APP=8095): PASS 51/51.
  - `node scripts/verify-outgoing-stack-ui.mjs <microservice copy> <gitfix> <base oid> <chainfix>
    <journey-candidates copy>` (fixtures generated per the step 12 phase B/C recipe): PASS 81/81.
  - The microservice copy's SHA-256 was unchanged and the backend log shows 0 model requests.
- Screenshots in `docs/evidence/step13/`, inspected: `01` folder icons on package cards; `02`
  package menu with Expand, no View source, fully inside the stage; `03` C and I letters in an
  expanded package; `04` View source dialog for EventService; `05` two packages expanded from one
  menu action; `07`/`08` cascade and Collapse all; `09`/`11` Entry points, all controller rows
  "Outside scope" once controllers leave the scope; `10` Explore landing with the handler
  inspected and its stack rooted (1 layer, 2 resources); `12` tree View methods opening the
  collapsed controllers package and EventController in place.

- `CHROMIUM=/snap/bin/chromium python3 scripts/verify_hierarchical_pipeline.py` (run twice): FAIL
  at `verify-hierarchical-ui.mjs:88`, clicking the removed `.segmented button` "Classes" level
  control. This is the known pre-existing breakage recorded in the package-only view entry. The
  card-menu scenarios before it passed on this build: open, reopen, outside-click dismiss, and
  Remove from scope through the menu's first item.

Not run:
- `./gradlew test`: no backend change.
- `verify_stable_graph_pipeline.py` (drives `verify-stable-graph-ui.mjs`, which uses the card
  menu): known broken on the removed level switcher, as above.
- `verify_change_edges_pipeline.py`, `verify_git_review_pipeline.py`: their UI scripts don't use
  the card menu, the scope tree's disclosure/toolbar, the route cards or the card icon (grepped).
  Their level-switcher scenarios are also known broken.

Codex ultrareview (`/home/sajjad/prompts/step13/review-report.md`): verdict SHIP, one P3 finding.
The report lists 5 mutations as caught. Each was re-run in a private `git archive` copy (the
checkout was never mutated):
- **M1 (the hook ignores the explicit group): NOT caught, contrary to the report.** The
  step-13 journeys check drives `journeysReducer` directly, so it never calls the hook's `update`.
  Added "step 13 review: the hook joins explicit-group updates across renders" to
  `scripts/test-explorer-journeys.mjs`. It uses the existing synchronous React stand-in, with
  microtask boundaries standing for renders. Result: PASS 51/51 clean; under M1 it fails with
  "three renders sharing beginGroup() are one undo step".
- **M2 (`collapseBranch` without recursion): caught** by `test-graph-model.mjs` ("nested packages
  close with their parent").
- M3–M5 were run with `verify-step13-ui.mjs`. Each got its own jar, built from the mutated copy
  (port 8096, snap Chromium on 9334, model URL on closed port 9). A clean control run of the
  unmutated copy passed first (36/36).
- **M3 (Explore's completion calls `select` instead of `inspectNode`): NOT caught, contrary to the
  report** (36/36 under the mutation). The "second Explore" check was vacuous: after the undo
  sequence before it, the handler was no longer inspected, so `select` just inspected it. The
  script now Explores, asserts the precondition that the handler is inspected, Explores the same
  row again, and waits past the 250 ms reclick window. It then checks that the handler is still
  inspected and still the stack root. Under M3: FAIL "a second Explore keeps the handler
  inspected" (37/38).
- **M4 (menu height clamp disabled): caught.** FAIL "the taller menu stays inside the map stage"
  (37/38). The report's literal `setMenuTop(null)` doesn't compile (`limit` unused, TS6133), so
  the mutation used was `setMenuTop(limit<-1e9?limit:null)`.
- **M5 (`toggleExpand` looks up `graph.nodes` instead of the drawn cards): caught.** The first
  Explore never draws the handler (no `containerId`, so `ownerId: null`), and the run fails at
  "Timed out: stack rooted" after 23 passing checks.
- Clean control with the strengthened script: `verify-step13-ui.mjs` **PASS 38/38**.
  `node scripts/test-explorer-journeys.mjs`: PASS 51. All 12 `scripts/test-*.mjs`: PASS.
- **P3 "Expand N selected" overcounts a package whose types are all out of scope: rejected after
  verification.** The report says `hasDetailsButton` ignores scope. That's wrong: the canvas cards
  come from `projectDisplayed(..., expansionInput)`, whose `decorate` computes a package's
  `detailCount` from the same in-scope types that `childrenOf` returns (`graphModel.ts`, already
  pinned at `test-graph-model.mjs` "detailCount … custom scope"). The scenario also can't occur,
  because a package whose types are all out of scope is unchecked and therefore not drawn.
  - Added an invariant check to `scripts/test-graph-model.mjs`: for every drawn card under
    whole-system and four custom scopes, `detailCount > 0` iff `childrenOf` is non-empty.
  - Mutation: dropping the scope filter from `decorate` turns the suite red. The file was restored
    and `git diff` is clean.
  - `node scripts/test-graph-model.mjs`: PASS.

Limits: a queue step whose dispatch the reducer ignores (a stale generation) stays in flight until
the next expansion change, which then drops it; no case of this was observed.

### Merge of main (incoming stack) into step13 (2026-09-28)

`git merge origin/main` (639ed08, PR #1 incoming relation stack) into `step13`, a merge and not a
rebase. Conflicts were in `App.tsx`, `GraphCanvas.tsx`, `docs/OUTGOING_STACK.md` and this file.
- The card menu keeps main's two stack items ("Show/Hide outgoing stack", "Show/Hide incoming
  stack", `onToggleStack(id, direction)`). Each one now runs through step 13's `menuSingle`, which
  does the right-click `addedId` cleanup that main had inlined, so the cleanup happens once.
  Expand/Collapse and View source follow them.
- GraphCanvas takes main's `stackRoot`/`onCycleStack`/`onToggleStack` plus step 13's
  `onToggleExpandMany`. App passes `onToggleExpandMany={toggleExpandMany}` alongside main's props.
- Entry points → Explore used to set `outgoingStackRootId`. It now sets main's
  `relationStack: { rootId, direction: 'out' }` explicitly, so it replaces an incoming stack or a
  stack on another root, and it is a no-op only when that exact outgoing stack is already shown.
- The step 13 journey check in `scripts/test-explorer-journeys.mjs` used the removed
  `outgoingStackRootId` field and was moved to `relationStack`.
- `docs/OUTGOING_STACK.md` "Activation and lifetime" keeps main's three-state button and both menu
  items, and adds the Explore bullet using `relationStack` terms.

Verification:
- `cd frontend && npx tsc -b --force && npm run build`: PASS (node_modules was present, so `npm ci`
  was not run).
- `for t in scripts/test-*.mjs; do node "$t" …; done`: all 12 PASS. `test-explorer-journeys.mjs`
  reports 55 checks.
- `./gradlew bootJar -q`: PASS.
- Browser suites ran against an isolated jar on 8097 (closed model port 9) and headless Chromium on
  9335:
  - `verify-step13-ui.mjs`: **38/38**
  - `verify-explorer-journeys.mjs`: **51/51**
  - `verify-outgoing-stack-ui.mjs` (microservice copy, generated git fixture, chain fixture, fresh
    `journey-candidates` copy): **108/108**, the same count as main's report
  - The microservice fixture's hash was unchanged afterwards. Both processes were stopped by their
    saved PIDs, and ports 8097 and 9335 were free.
- Screenshots inspected: the stack suite's `17-keyboard-menu` and `in-01-incoming-stack`, and step
  13's `02-package-menu` and `10-entry-explore-stack`. The menu shows both stack items, then
  Expand, then Deselect. The Explore stack reads "Outgoing stack: 1 layer · 2 resources".
- Not run: backend `./gradlew test` (no backend change on either side) and the Python
  `verify_*_pipeline.py` suites.

Lead review of the merge, run independently of the merge run above:
- Checked by reading: merge parents `2732813` + `639ed08`; no conflict markers; no remaining
  `outgoingStackRootId`/`onToggleOutgoingStack` in `frontend/src` or `scripts`. `relationStack` is
  still classified as selection (`explorerJourney.ts` `selectionChanged`/`isSelectionOnly`), so
  Explore stays one undo step.
- Gap closed: `verify-step13-ui.mjs` had no check on the stack's direction. Three checks were added:
  1. the first Explore's stack is outgoing (inspector summary `^Outgoing stack:`);
  2. setup: the handler's card menu "Show incoming stack" gives `^Incoming stack:`;
  3. the second Explore turns it back to outgoing.
- `npx tsc -b --force`: PASS. All 12 `scripts/test-*.mjs`: PASS (journeys 55). `./gradlew bootJar`:
  up to date with the merged source.
- Fresh isolated run (jar on 8098, closed model port 9, headless Chromium on 9336):
  `verify-step13-ui.mjs` **41/41**; `verify-explorer-journeys.mjs` **51/51**;
  `verify-outgoing-stack-ui.mjs` **108/108**. The fixture hash was unchanged, there were 0
  `chat/completions`, both processes were stopped by PID, and the ports were free.
- Evidence regenerated from this run: `docs/evidence/step13/` and
  `docs/evidence/outgoing-stack/`, with the incoming `in-*` images and report copy in
  `docs/evidence/incoming-stack/` following main's layout. Inspected `step13/02-package-menu`
  (Remove, both stack items, Expand, Deselect, all inside the stage) and
  `outgoing-stack/17-keyboard-menu` (the same items on the keyboard path).

## Incoming relation stack (2026-09-28)

User request: the mirror of the outgoing stack (a BFS over incoming edges), on the same button:
first press outgoing, second press incoming, third press off. The incoming stack uses the
incoming-selection color (`HALO.in`, `#6366F1`). Six decisions came out of a grilling round, all
recommendations accepted, and are recorded in `docs/OUTGOING_STACK.md` §"Incoming stack":
- another card's button starts outgoing there
- the menu has two direct items
- Escape ends either direction
- purple is used for the badges, outlines, route underlay and pressed button, while the root stays
  teal
- the incoming stack is an exact mirror, so an interface root reaches its implementors
- the wording is "Incoming stack: N layers · M resources"

No ADR: `docs/BUILD.md` does not mention an incoming stack, and the outgoing spec had listed it as
anticipated future work.

- **State.** `Journey.outgoingStackRootId` became `relationStack: { rootId, direction } | null`,
  one value, so the ADR 0009 selection-only classification, the undo/redo carry, pruning and Clone
  all cover the direction unchanged. `cycleRelationStack` (button) and `toggleRelationStack`
  (menu) are pure transitions in `explorerJourney.ts`.
- **Traversal.** `outgoingStack.ts` is unchanged apart from `StackDirection` and
  `stackSummary(stack, direction)`. `direction: 'in'` already reversed every kept step.
- **UI.**
  - `GraphCanvas`: the three-state button (aria-label names the next action, `data-stack-direction`)
    and two menu items (⇶ / ⇇).
  - Incoming styling: `stack-member stack-in` outlines, `flow-in` chain routes and indigo badges on
    the overlay (the overlay scratch now records each badge's color).
  - CSS: `.map-stack-button.active.incoming` and `.stack-summary.incoming`.
- **Tests.**
  - `test-explorer-journeys.mjs`: 49 → 53 checks. New: cycle and menu transitions; a direction
    switch adds no entry, keeps redo, and survives undo/redo; incoming pruning; Clone copies the
    direction.
  - `test-outgoing-stack.mjs`: 34 → 41 checks. New: the summary prefix; the collapsed-hub mirror at
    class and package level; reversed dispatch; no terminal types for a method root; an interface
    root reaching implementors; beyond the map.
  - `verify-outgoing-stack-ui.mjs`: 81 → 108 checks. The oracle takes a direction. The outgoing
    label, tooltip and focus expectations were updated for the three states. The B4 keyboard
    scenario now goes outgoing → incoming (focus kept) → off. The new incoming scenarios are
    described in `docs/TESTING.md`.
- **Docs.** `OUTGOING_STACK.md`, `STABLE_GRAPH_INTERACTIONS.md`, `ARCHITECTURE.md` §5, `TESTING.md`,
  and an ADR 0009 note on the field rename.

Checks (this entry's tree):
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  12/12 PASS.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test`: PASS, 21 classes, 150 tests, 0
  failures. No backend source changed.
- `git diff --check`: clean.
- Browser: the `isolated4.sh` harness copied to the session scratchpad, pointed at this checkout
  (jar on 8095 with its own data dir, model URL `http://127.0.0.1:9/v1`, snap Chromium on 9333,
  fixtures copied and hashed). Command: `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095
  DEBUG=http://127.0.0.1:9333 OUT=<run>/evidence node scripts/verify-outgoing-stack-ui.mjs
  <run>/fixture <run>/gitfix <base oid> <run>/chainfix <run>/journeyfix`.
  - Result: 108/108 PASS (run `run-Ydw7`). `stop` reported all four fixtures unchanged, 0 model
    requests and the ports free.
  - Two earlier runs failed in the new chain-fixture checks, for test reasons. Card app.d sat under
    the inspector panel, so the button clicks missed. After centring it, a and b were off screen,
    so their badges were not drawn (by design). The script now centres the root, then fits the map
    (view-only) before reading badges.
- Evidence:
  - `docs/evidence/incoming-stack/in-01..04` were inspected:
    - dtos root: controllers, services and domain are 1, repositories 2. Indigo badges, outlines,
      routes, pressed button and inspector line; the root stays teal.
    - The layer-1 selection keeps the root.
    - Chain package root app.d: b 1, and the a box 2 with its children covered.
    - Class root U: b 1 only, a muted.
  - `docs/evidence/outgoing-stack/` was refreshed from the same run, and these were inspected:
    - 01 and 05: the outgoing stack is still cyan, with the pressed cyan toggle.
    - 07: Changes mode, with cyan badges, change fills kept and the green ADDED route.
    - 17: the menu offers both "Show outgoing stack" and "Show incoming stack".
    - 18: after outgoing → incoming → off, the focus ring stays on the unpressed toggle while
      another card is selected.

    The other outgoing screenshots show scenarios this change did not touch and were not
    re-inspected.
- Known limits:
  - Direction is shown by colour (cyan against indigo), the tooltip, the aria-label and the
    inspector line. Badges, outlines and the pressed button have no non-colour cue, unlike the
    selection halos (outgoing solid, incoming dashed, WCAG 2.1 SC 1.4.1). `AGENTS.md` does not
    require one, and the user chose colour. A dashed incoming outline would be a small follow-up.
  - `data-testid="outgoing-stack-summary"` keeps its name for both directions, to avoid churn.
- Codex review (`/home/sajjad/prompts/incoming-stack/review-report.md`, brief
  `ultrareview-codex.md`): SHIP WITH FIXES, with no P0–P2 findings. The reviewer's own isolated
  run reproduced 108/108, 53 and 41 checks, and the gradle, build and tsc results. Two P3 doc
  findings were verified against the tree and fixed in `175b120`:
  - D-1: `OUTGOING_STACK.md` called the stack state a `TRANSIENT_UPDATE`; it is a selection-only
    `UPDATE`.
  - D-2: `ARCHITECTURE.md` still credited CANDIDATE calls.

  The same fix removed a related stale "calls candidate members of" phrase in
  `STABLE_GRAPH_INTERACTIONS.md` that the report missed.
- Not run:
  - `verify_stable_graph_pipeline.py`, `verify_hierarchical_pipeline.py`,
    `verify_change_edges_pipeline.py`, `verify_git_review_pipeline.py`: no stack coverage, and this
    change touches only the stack's state, UI and styles.
  - `verify-explorer-journeys.mjs`: it does not reference the stack field or button.
  - `constrainedMemoryTest`: backend untouched.

## Step 12 follow-up: candidate calls reverted, uniform route colour, Changes-mode edge fix (2026-09-25)

Three user-directed changes on branch `worktree-step12-bc-review-fixes`, one commit each, plus this
status/evidence commit.

- **Task 1, candidate calls reverted (`9969ab3`).** User decision: the map read as mostly yellow,
  because one CANDIDATE among a route's resolved occurrences turns the aggregate amber. ADR 0010 D1
  is withdrawn (dated amendment "candidate calls reverted"); OVERRIDES (D3) is kept unchanged. A
  call the solver cannot resolve is `CALLS/UNRESOLVED` again, with no target and reason "Static
  target unavailable in indexed source". The post-pass is `linkOverrides` in `JavaParserAdapter`
  and `AnalysisService`; `PendingCall`, the pending lists, `lexicalTypes`, `solved`,
  `lexicalReceiver`, `hasMethodNamed`, `inAnonymousOrLocalClass`, `nestHostByType`, `opaqueTypes`,
  `OBJECT_METHODS` and the unused `MethodFacts.varargs/privateMethod` are removed.
  - Tests: `CandidateCallsAndOverridesTest` → `UnresolvedCallsAndOverridesTest` (14 tests: every
    former candidate case asserts UNRESOLVED, no target, the reason, and no CALLS/CANDIDATE
    anywhere; the OVERRIDES tests are unchanged). `CandidateAndOverrideEdgeCasesTest` →
    `OverridesAndUnresolvedCallEdgeCasesTest` (11 tests): C1/C2/F1 kept; the C3 tests kept (they
    already asserted UNRESOLVED); the C4 tests converted to "stays UNRESOLVED, no target", plus a
    no-CALLS/CANDIDATE check. None dropped.
  - `scripts/verify-outgoing-stack-ui.mjs` (still 81 checks): the fixture check now asserts the
    controller call stays UNRESOLVED and no CALLS/CANDIDATE exists. Method root
    `SignupController.register` is dto 1 only ("1 layer · 1 resource"; its only call is
    unresolved). The dispatch and beyond-the-map checks, which are not about candidates, now start
    from `SignupService.register(String,String)`, whose `notifier.send` call resolves: Notifier,
    dto and domain 1, MailNotifier 2 through reversed OVERRIDES, and EventStore not reached. With
    domain out of scope, the result is "2 layers · 3 resources · 1 beyond the map". Two methods are
    named `register`, so that stack is started by `data-card-id`, after zooming in so the corner
    buttons show. `outgoingStack.ts` and `scripts/test-outgoing-stack.mjs` are unchanged.
  - Probe (packaged jar on 8097, the same fixture copies, hashed unchanged, 0 model requests):
    microservice-java 36 unresolved, 0 CALLS CANDIDATE, 0 OVERRIDES; online-book-store 247
    unresolved, 0 CALLS CANDIDATE, 29 OVERRIDES. These are the pre-phase-C unresolved counts.
- **Task 2, uniform route colour (`2564e3f`).** User decision, recorded as a dated amendment to
  ADR 0008. The `edge[resolution != "RESOLVED"]` rule in `GraphCanvas.tsx`, the "Candidate /
  unresolved" legend sample and its CSS are removed. The legend line "Package connections group
  occurrences by kind and resolution" was inaccurate: routes group by ordered endpoints, whatever
  the kind or resolution. It became "Hover a line for its kinds and resolution". The hover text and
  the inspector are untouched; so are the Changes `reviewChange` colours and the selection dashes.
  No script asserted amber/dashed unresolved routes. The git-review UNKNOWN dotted check is change
  status, so it stays.
- **Task 3, Changes-mode vanishing edge (`b0bee6f`).** The user's workspace
  `second-review-assist/src` is itself a Git repository rooted at a `src` directory, holding
  `main/java` and `test/java`. It was copied with `.git` (`cp -a`) to
  `$JOB/tmp/changes/user-src/src`. The original was never touched, and the copy is hashed unchanged
  after every probe.
  - Trace: on the ordinary map, `DeveloperWorkflowTest -> ExplanationResponse` is one class-level
    `DEPENDS_ON/RESOLVED` fact. Its six sites (`explanations.getExplanationForSymbol(snap,run).status()`,
    `response.status()`, ...) come from `receiverType`, which needs the symbol solver. Neither review
    snapshot had it. Package route `workflow -> api.dto` was missing in Changes (41 of 42 routes),
    and 539 ordinary facts were absent from the head side.
  - Root cause: `setupSymbolSolver` recognized source roots by absolute paths ending in
    `src/main/java` / `src/test/java`. The ordinary run matched `<root>/main/java` only because the
    root's own name is `src`. Review captures live under `capture-*/base|head`, so no root matched,
    the solver saw no in-source types, and every solver-dependent fact vanished. It was not the
    identity pairing in `ReviewService` nor the frontend projection: the facts never existed in the
    review snapshots.
  - Fix: `runReviewAnalysis(..., workspaceRoot)` and `setupSymbolSolver(capturedRoot,
    workspaceRoot)`, which match each captured directory as laid out under the workspace root.
    Ordinary analysis is unchanged. Recorded as a dated amendment to ADR 0006.
  - Test: `ReviewSourceRootParityTest` (temp-dir Git repo rooted at `project/src`). Red before the
    fix: "review base" lacked `FlowTest.run() -> Service.get() CALLS RESOLVED` and
    `FlowTest -> Response DEPENDS_ON RESOLVED`. Green after, with head facts equal to the ordinary
    facts and every comparison row UNCHANGED.
  - After the fix, on the user copy (data probe on 8097; 0 model requests): 0 ordinary facts
    missing from the head side, package routes 42/42, and no class-level route missing. Live canvas
    (`changes-ui.mjs`, jar on 8095, snap Chromium on 9333, both stopped after): package level 42
    ordinary routes, all present and visible in Changes (47 with added/removed); class level 167,
    all present and visible (174). No page errors.

Checks (this entry's final tree):
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test`: PASS, 21 classes, 150 tests, 0
  failures (149 after task 1, +1 `ReviewSourceRootParityTest`).
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  12/12 PASS.
- `cd frontend && npx tsc -b --force && npm run build`: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `git diff --check`: clean.
- Browser suites, one at a time, each started fresh by `$JOB/tmp/isolated4.sh start` (jar on 8095
  with its own data dir, model URL `http://127.0.0.1:9/v1`, snap Chromium on 9333, fixtures copied
  and hashed); `stop` reported every fixture unchanged, 0 model requests and the ports free:
  - `verify-outgoing-stack-ui.mjs`: 81/81 PASS (run `run-0l4y`). Its screenshots replace
    `docs/evidence/outgoing-stack/`. 14, 15 and 16 were inspected: dto 1 only, with the unresolved
    call listed in the inspector; Notifier, dto and domain 1, MailNotifier 2; "2 layers · 3
    resources · 1 beyond the map"; the new legend. 07 (Changes mode) was inspected too: the
    change fills and the green ADDED route colour are intact.
  - `verify-explorer-journeys.mjs`: 51/51 PASS (run `run-NhOk`).
  - `verify_git_review_pipeline.py` (`$JOB/tmp/run-git-review4.sh`): 41/41 PASS, 0 page errors,
    source tree and Git index SHA-256 unchanged, no model requests. `01-ordinary-layout-before-changes`
    (grey solid routes, new legend) and `02-changes-preserved-layout` (Changes fills and route
    colours intact) were inspected.
- The leftover `run-xkZA` jar and Chromium from the previous session were stopped through
  `isolated4.sh stop` (fixtures unchanged). No other process was touched.
- Rerun by the lead session on `072552a` before the Codex review handoff:
  - `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew constrainedMemoryTest --no-daemon`: PASS,
    `BoundedExplanationScaleTest` 1/1;
  - `./gradlew test`: PASS, 21 classes, 150 tests, 0 failures;
  - all 12 node suites: PASS;
  - `npx tsc -b --force && npm run build`: PASS;
  - `git diff --check 8f472f9 HEAD`: PASS.

  The review brief is `/home/sajjad/prompts/step12/followup-ultrareview-codex.md`.
- Not run: `verify_stable_graph_pipeline.py`, `verify_hierarchical_pipeline.py` and
  `verify_change_edges_pipeline.py` were not in this task's check list, and the changes do not
  touch their areas beyond the removed style rule. No browser check asserts
  that an uncertain route is drawn in the ordinary colour, because no browser fixture draws a
  non-RESOLVED route after the revert. The rule deletion is covered by inspection only.

## Step 12 phases B/C review fixes (2026-09-25)

The findings of `/home/sajjad/prompts/step12/phase-b-review-report.md` (B1–B6) and
`/home/sajjad/prompts/step12/phase-c-review-report.md` (C1–C6) are resolved, following
`/home/sajjad/prompts/step12/phase-bc-review-fixes-handoff.md`. The rejected candidates stayed
rejected. Before any code, the user answered F1–F3, choosing the recommended option each time:
- **F1:** no OVERRIDES when a parameter type resolves on one side only.
- **F2:** implicit calls inside anonymous or local class bodies are never queued.
- **F3:** implicit calls in member classes look through the enclosing types, innermost first.

The answers are recorded in the ADR 0010 amendment. The work is built on `0e131a8`, on branch
`worktree-step12-bc-review-fixes`: `057c71f` analyzer, `c08856d` helper test, `ef7a32e`
journeys, `2b5c5aa` canvas, plus this docs commit. Each finding was reproduced red before its fix.

Finding → fix → test:
- **C1** (package-private OVERRIDES across packages).
  - Fix: `MethodFacts` records `packagePrivate` and `packageName` (interface members count as
    public); the post-pass skips a package-private overridden method from another package.
  - Tests: `CandidateAndOverrideEdgeCasesTest.aPackagePrivateMethodIsNotOverriddenFromAnotherPackage`
    (red, then green); the same-package and protected cases still override.
- **C2** (simple-name erasure).
  - Fix: a parameter's identity is `#<id>` of the in-source type `resolveType` finds, else its
    erased name. F1: the two forms never match.
  - Tests: `differentInSourceTypesWithOneSimpleNameAreAnOverload` and
    `aParameterResolvedOnOneSideOnlyIsNotAnOverride` (both red, then green);
    `theSameInSourceTypeOverridesWhetherImportedOrQualified` (green before and after).
- **C3** (anonymous-class call on the outer type).
  - Fix: `inAnonymousOrLocalClass`; a scope-less call inside such a body is never queued (F2).
  - Tests: the anonymous probe and a local-class variant (both red, then green); both calls stay
    UNRESOLVED.
- **C4** (nest access).
  - Fix: `PendingCall` carries the caller type and, for implicit calls, the lexically enclosing
    types. A private method matches when it is declared by the receiver type and the caller shares
    its nest host. `lexicalReceiver` picks the innermost enclosing type with a method of that name
    (JLS 15.12.1), never looking past a type with library supertypes, a record, an enum or an
    `Object` method name.
  - Tests: `anExplicitOuterThisCallReachesThePrivateOuterMethod` (red: CANDIDATE to type `Outer`
    plus UNRESOLVED; then green: both CANDIDATE to `Outer.work(String)`);
    `theInnermostTypeDeclaringTheNameWins`. `aPrivateMethodMatchesOnlyFromItsOwnType` stays green.
- **C5** (helper passes plain BFS).
  - Fix: a competing-path check in `scripts/test-outgoing-stack.mjs` (33 → 34), expecting
    `{B:1, D:1, C:2, E:2, F:3}`.
- **C6** (no negative test for a solver-resolved JDK call).
  - Fix: `journey.pricing.PricingError` plus `Checkout.describe`, added with `git add -f`.
  - Test: `CandidateCallsAndOverridesTest.aSolverResolvedJdkCallOnAnInSourceReceiverStaysUnresolved`
    (15 → 16). It passed on the unfixed code, as expected for a test gap; its red is mutation 7
    below.
- **B1** (no keyboard path to the context menu).
  - Fix: Shift+F10 or the ContextMenu key opens the same menu at the card, either on a focused
    corner button (`data-card-id`) or with a card selected and the page focused. The browser's own
    menu is suppressed inside the stage. The menu gains ArrowUp/Down/Home/End (it had none), and
    closing it, by Escape or by an item, returns focus to the opener. The keyboard path adds
    nothing to `multiIds`.
  - Red on the pre-fix jar: Shift+F10 and ContextMenu opened nothing (`b-repro` probe, and the new
    suite's first B1 check).
- **B2** (drag reprojection).
  - Fix: `sameDisplayInputs` compares expansions by membership (IDs, `ownerId`).
  - Test: a `graphFor` spy in `test-explorer-journeys.mjs`, red with `1 !== 0`, then green; a
    collapse still revalidates.
- **B3** (async Changes graphFor).
  - Fix: `updateTab(id, fn, graphFor?)`; `toggleChanges` passes `j=>j.review?result.graph:mapGraph`.
  - Tests: a reducer check (null graph drops the derived child root, the review graph keeps it),
    and `useExplorerJourneys` run under a synchronous React stand-in. The latter is red against the
    pre-fix hook ("the load result's graph decides the prune"), then green. As the report says, the
    UI-level race is CONFIRMED only through the reducer; no browser reproduction was attempted,
    since the timing makes it flaky.
- **B4** (focus loss on keyboard deactivation).
  - Fix: `focusedStackId` (onFocus/onBlur) keeps the focused toggle in `stackButtonIds`.
  - Red: the probe showed focus on `BODY` after Enter (root unselected, pointer parked on empty
    canvas). Green: focus stays on the toggle, `aria-pressed="false"`.
- **B5** (edge tap over a collapsed card's corner): **not reproduced.** The probe placed the
  infra card's details button exactly on the midpoint of a `flow-out` chain route (the click point
  inside the route's box) and clicked it. The card expanded and no edge was inspected. Cause:
  Cytoscape's default `z-index-compare: auto` draws and hit-tests edges below nodes, so the
  route's `z-index: 20` never lifts it over a card. No change.
- **B6** (menu-only right-click left the card in `multiIds`).
  - Reproduced: after a right-click and "Show outgoing stack", controllers stayed `multi-selected`.
  - Fix: `cxttap` records `addedId` when the card was not already selected, and the menu's stack
    item removes it. Escape or click-away still keeps the right-click selection (documented
    behavior).
  - A new check confirms "Deselect" still acts on the right-click set.

Mutations (in scratch copies or with the source restored, and not committed):
- Phase C **mutation 5** (every step costs 1), `bash $JOB/tmp/mutation5.sh`: now **caught**; the new
  check fails with `C: 4` for `C: 2`.
- Phase C **mutation 7** (drop `!solved`), `bash $JOB/tmp/mutation7.sh` against
  `CandidateCallsAndOverridesTest`: now **caught**; 16 tests, 1 failed
  (`aSolverResolvedJdkCallOnAnInSourceReceiverStaysUnresolved`). The source was restored and
  checked.

Probe re-measure: a probe backend on 8097, the same fixture copies as phase C (hashed unchanged),
0 model requests.
- microservice-java: 22 unresolved, 14 CALLS CANDIDATE, 0 OVERRIDES.
- online-book-store: 221 unresolved, 26 CALLS CANDIDATE, 29 OVERRIDES.

There is **no delta**. Every edge and unresolved entry is identical by (source, target, kind,
resolution), and every measured journey is identical (`measure.mjs` output diff empty). Neither
project has a cross-package package-private override, a same-named parameter type pair, a pending
implicit call in an anonymous or local class, or a pending call to a private outer member.

Checks:
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test --tests "dev.codeatlas.analysis.CandidateAndOverrideEdgeCasesTest" --tests "dev.codeatlas.analysis.CandidateCallsAndOverridesTest"`:
  red first (26 tests, 6 failed, each for its finding's reason), then PASS 26/26.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test`: PASS, 20 classes, 150 tests,
  0 failures (139 + 10 + 1). Rerun after the Javadoc edits: PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew constrainedMemoryTest --no-daemon`:
  PASS, `BoundedExplanationScaleTest` 1/1 (137 s).
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  PASS, all 12 suites (outgoing-stack 34, journeys 49).
- `cd frontend && npx tsc -b --force && npm run build`: PASS, with the existing Vite chunk-size
  advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS
  (`build/libs/code-atlas-0.1.0-SNAPSHOT.jar`).
- **Stack browser check.** Same setup and 5-argument command as phase C: jar on 8095 with its own
  data dir, model URL `http://127.0.0.1:9/v1`, headless snap Chromium on 9333 with its profile
  under `~/snap/chromium/common/`, fixtures copied and hashed.
  - On the pre-fix jar, the extended script failed the B6 check and the first B1 check, as
    expected.
  - On the fixed jar, two fresh runs: PASS **81/81** (68 + 13). All four fixtures were unchanged,
    with 0 model requests and zero page/console errors.
- `node scripts/verify-explorer-journeys.mjs <run>/fixture`, in its own fresh isolated run: PASS
  51/51, fixtures unchanged, 0 model requests.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_git_review_pipeline.py ~/snap/chromium/common/atlas-git-review-bc-fixes`:
  PASS 41/41, 0 page errors, source tree and index unchanged.
- `git diff --check`: PASS.

Screenshots: `docs/evidence/outgoing-stack/` was replaced from the last fresh run (`01`–`18`).
Inspected:
- `01`: controllers root; domain/dtos/services 1, exceptions/repositories 2; "2 layers · 5
  resources" (unchanged).
- `16`: pricing now lists 7 types (`PricingError`); still "3 layers · 5 resources · 1 beyond the
  map".
- `17` (new): the keyboard-opened menu at the controllers card, focus ring on "Show outgoing
  stack", no multi-selection outline.
- `18` (new): services selected; the controllers toggle keeps its focus ring, unpressed, with no
  badges. Controllers' indigo outline is the selection's incoming halo (ADR 0008), not a
  multi-selection.

Not run:
- `verify_stable_graph_pipeline.py`: still broken by the ADR 0007 level switcher (known; a user
  decision).
- `verify_hierarchical_pipeline.py` and `verify_change_edges_pipeline.py`: the fixes touch neither
  the explanation pipeline nor change-edge aggregation, and the analyzer produced identical facts
  on both probe projects.
- The browser oracle was not extended for C5: the helper check pins it with literal values, and a
  browser copy would duplicate it.

Deviations:
- The menu had no arrow-key handling, although the handoff assumed it existed. ArrowUp/Down/Home/End
  were added as part of B1.
- The B3 fix is covered at the hook level (a React stand-in), not in the browser.
- Commits live on the worktree branch; `git merge --ff-only worktree-step12-bc-review-fixes` on
  master lands them unchanged.

Limits:
- The lexical lookup can still pick an outer method when a member class's own members are
  generated (Lombok) and all its supertypes are in source.
- Shift+F10 with the page focused opens the menu only for the selected card, not for an arbitrary
  card.

## Step 12 phase C: full outgoing journey from any selected resource (2026-09-25)

The outgoing stack missed most of a method root's journey. `EventController.registerParticipant`
was **empty** on microservice-java. The handoff (`/home/sajjad/prompts/step12/phase-c-full-journey-handoff.md`)
diagnosed five causes (R1–R5). The user answered D1–D5 before any code was written:
- **D1:** candidate calls, recorded in ADR 0010.
- **D2:** CONSTRUCTS, CALLS **and USES_TYPE** to a type count for a method root, as terminal
  entities. The user included USES_TYPE; the recommendation had left it out.
- **D3:** OVERRIDES facts, dispatch as a +1 step, no reverse IMPLEMENTS for class roots.
- **D4:** card-hop layers that never skip.
- **D5:** stop at entities with no drawn card and count them as "beyond the map".

Built test-first in three slices, on branch `worktree-step12-phase-c`: `7c2ffc5` analyzer, `1b70f09`
helper, `ab82065` browser acceptance, plus this docs commit.

What changed:
- **Analyzer (`JavaParserAdapter`, ADR 0010).** `parseRelationships` records, per file and only
  once the file succeeds, each type's in-source supertypes, its methods (erased simple parameter
  types, static/private) and each CALLS occurrence whose symbol resolution **threw** and whose
  receiver type is in source. The new post-pass `linkDispatchAndCandidateCalls` runs in one
  transaction after all files, in both `runAnalysis` and `runReviewAnalysis`. It:
  - upgrades such an occurrence to CANDIDATE, targeting the unique name/arity signature on the
    receiver type or its in-source supertypes (nearest declaration wins), else the receiver type
    (a generated member, a record accessor, a library-inherited method, or ambiguous overloads);
  - leaves a call on the calling type itself without a unique match UNRESOLVED;
  - leaves a call the solver resolved to a JDK method (`exception.getMessage()`) UNRESOLVED;
  - emits OVERRIDES / RESOLVED from each non-static, non-private method to every in-source
    supertype method with the same name and erased parameters. The evidence is the method name.

  `RelationshipKind` and the frontend union gain `OVERRIDES`. There is no migration (the column is
  free text). `GraphQueryService` gives it a hover summary.
- **Helper (`outgoingStack.ts`).**
  - At method granularity, CONSTRUCTS/CALLS/USES_TYPE to a type reach that type as a terminal
    entity, and OVERRIDES is walked reversed.
  - Distances come from a 0-1 BFS: a step inside one card, or between the root set and the root's
    containers, is free. Raw card layers are then ranked densely.
  - `beyond` counts distinct reached entities with no card.
  - `stackSummary` appends " · K beyond the map" when K > 0, so the tooltip and inspector pick it
    up with no UI change. No layout, fit or camera call was added.
- **Tests.**
  - `CandidateCallsAndOverridesTest` is new, over the new `test-fixtures/journey-candidates` (15
    tests).
  - `scripts/test-outgoing-stack.mjs` goes from 23 to 33 checks. Two existing checks changed by
    decision:
    - "ancestors of the root…": B goes from layer 2 to layer 1 (D4);
    - "method root M walks method-level facts…": renamed; the CONSTRUCTS-to-Q fact is now followed
      but lands on the same B card, so the layers are unchanged.
  - `scripts/verify-outgoing-stack-ui.mjs` goes from 55 to 68 checks. It takes a fifth argument (a
    copy of the journey fixture), and its independent oracle follows the new rules (fixpoint
    relaxation, not a deque).
- **Docs.** ADR 0010; `OUTGOING_STACK.md` (status line, Purpose, Traversal, Activation tooltip,
  Verification, the user-decision note; the obsolete "layers can skip" text is removed);
  `STABLE_GRAPH_INTERACTIONS.md` §Outgoing relation stack; `ARCHITECTURE.md` §5; `TESTING.md`;
  the `JavaParserAdapter` Javadoc.

Before/after journeys. This uses the handoff's §3 harness, which roots the stack at each method
with its package and class expanded (at each type with its package expanded) and every other
package collapsed. Before: the handoff's measurement at `3f1e091`. After: this build, probe backend
on 8097 (isolated data dir, model URL on closed port 9, fixture copies hashed unchanged, 0 model
requests). Package names are relative to `com.kipper.eventsmicroservice` /
`com.shashirajraja.onlinebookstore`.

| Root | Before | After |
|---|---|---|
| `EventController.registerParticipant(String,SubscriptionRequestDTO)` | (empty) | 1: dtos, services · 2: domain, exceptions, repositories |
| `EventService.getAllEvents()` | (empty) | 1: domain, repositories |
| `EventService.createEvent(EventRequestDTO)` | 1: domain | 1: domain, dtos, repositories |
| `RestExceptionHandler.eventNotFoundHandler(..)` / `eventFullErrorHandler(..)` | (empty) | 1: exceptions, infra.RestErrorMessage |
| `RestExceptionHandler.runtimeErrorHandler(..)` | (empty) | 1: infra.RestErrorMessage |
| `EventService.registerParticipant(String,String)` | 1: repositories, exceptions, EmailServiceClient, isEventFull, domain | 1: domain, dtos, exceptions, repositories, EmailServiceClient, isEventFull |
| `CustomerController.addToCart(int,Model)` (online-book-store) | 1: service, entity | 1: entity, service · 2: dao |
| type `repositories.SubscriptionRepository` | 1: domain, 3: dtos | 1: domain · 2: dtos |
| type `controllers.EventController` | good | 1: domain, dtos, services · 2: exceptions, repositories |

Fact counts on the probe:
- microservice-java: 36 → 22 unresolved relationships, 14 CALLS CANDIDATE.
- online-book-store: 247 → 221 unresolved, 26 CALLS CANDIDATE, 29 OVERRIDES.

An audit of the candidate list found:
- 24 of the 26 online-book-store candidates target a Spring Data repository interface as the
  receiver type. The other 2 are unique name/arity method matches, each checked against the
  source: `CustomerData.setPassword(String)`, and the implicit-this `viewBooks(Model)` from
  `CustomerController.customerHome(Model)` (its Spring `Model` argument cannot be typed).
- `exception.getMessage()`, `ResponseEntity.*`, `LocalDateTime.now()` and
  `SpringApplication.run` stay UNRESOLVED.

Checks (the worktree's `frontend/node_modules` were installed with `npm ci --prefer-offline`):
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test --tests "dev.codeatlas.analysis.CandidateCallsAndOverridesTest"`:
  red first (12 of 14 failing, for the expected reasons), then PASS 14/14.
- **Pre-review fix.** While writing the Codex review prompt, a gap turned up: a supertype's
  `private` method counted toward the name/arity match, so a subtype's unresolvable call could
  become a wrong unique CANDIDATE to it. A new test, `aPrivateMethodMatchesOnlyFromItsOwnType`,
  adds `journey.pricing.Coupon` / `SeasonalCoupon` to the fixture. It was red (wrong CANDIDATE
  `SeasonalCoupon.use -> Coupon.apply(String)`), then PASS 15/15 after `MethodFacts.privateMethod`
  and the "own type only" rule. The rest was then rerun:
  - `bootJar`;
  - the probe: microservice-java and online-book-store counts and every measured journey identical
    to the first measurement;
  - a fresh stack browser run: PASS 68/68, fixtures unchanged, 0 model requests; evidence replaced;
    `16` re-inspected, now showing pricing's 6 types;
  - the full `./gradlew test`, below.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test`: PASS, 19 classes, 138 tests,
  0 failures, both after the analyzer slice and on a rerun before the docs commit. After the
  pre-review fix: PASS, 19 classes, 139 tests, 0 failures. No pinned
  count changed (`LargeProjectBenchmarkTest`, `RelationshipExtractionTest` and the rest pass
  untouched).
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew constrainedMemoryTest --no-daemon`:
  PASS, `BoundedExplanationScaleTest` 1/1 (2 min 23 s).
- `node scripts/test-outgoing-stack.mjs`: red first (`beyond` undefined), then PASS 33/33.
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  PASS, all 12 suites (journeys 46, unchanged).
- `cd frontend && npx tsc -b --force && npm run build`: PASS; the existing Vite chunk-size advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS
  (`build/libs/code-atlas-0.1.0-SNAPSHOT.jar`).
- **Stack browser check.** Setup: jar on 8095 with its own data dir, model URL
  `http://127.0.0.1:9/v1`, headless snap Chromium on 9333. The profile lives under
  `~/snap/chromium/common/`, because snap Chromium cannot write under the hidden `~/.claude`.
  Fixtures are copied and hashed per run: the microservice copy, the generated Git fixture, the
  generated chain fixture and a copy of `test-fixtures/journey-candidates`.

  Command: `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095 DEBUG=http://127.0.0.1:9333
  OUT=<run>/evidence node scripts/verify-outgoing-stack-ui.mjs <run>/fixture <run>/gitfix <base oid>
  <run>/chainfix <run>/journeyfix`.

  Two earlier runs failed in the new journey section, for test reasons:
  1. 59 checks passed, then a missing "Show types inside journey.service" button stopped the run.
     The expansions had pushed cards off screen, and `GraphCanvas` draws badges and corner buttons
     only on screen, by design.
  2. 66/67. At the fitted 32% zoom the corner buttons, including the pressed toggle, are hidden by
     design, so its tooltip could not be read. The inspector already read the expected line.

  The script now clicks the view-only Fit map control after each expansion and zooms in on the
  root before reading the tooltip. Final fresh run: **PASS 68/68**, zero page/console errors. All
  four fixtures were unchanged (hashes and `git status`), and 0 model requests appear in the
  backend log.

  Screenshots in `docs/evidence/outgoing-stack/` (replaced), inspected:
  - `01`: controllers root; domain/dtos/services 1, exceptions/repositories 2.
  - `07`: Changes; b 1, c 2.
  - `11`: method m; b 1 only.
  - `12`: package root journey.api; dto 1, service 1, domain 2, pricing muted.
  - `13`: class root SignupController; the same layers.
  - `14`: method root `register`; the same layers, candidate routes dashed, inspector "2 layers ·
    3 resources".
  - `15`: service expanded; SignupService 1, EventStore/Notifier 2, MailNotifier 3, Formatter
    muted, "3 layers · 6 resources".
  - `16`: domain out of scope; the inspector reads "Outgoing stack: 3 layers · 5 resources · 1
    beyond the map".
- `node scripts/verify-explorer-journeys.mjs <run>/fixture`, in its own fresh isolated run: PASS
  51/51, fixtures unchanged. Not rerun after the pre-review fix: that fix only removes private
  supertype methods from candidate matching, and the microservice fixture this suite uses produced
  identical facts and journeys on the probe.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH
  python3 scripts/verify_git_review_pipeline.py ~/snap/chromium/common/atlas-git-review-phase-c`:
  PASS 41/41, source tree and index unchanged, no model requests. The run dir is outside the hidden
  worktree path for snap Chromium. `03-selected-change-colors-and-dashes.png` inspected (change
  fills, halos and dashed selected routes as in ADR 0008).
- `git diff --check`: PASS.

Not run:
- `python3 scripts/verify_stable_graph_pipeline.py baseline|acceptance`: still broken by the ADR
  0007 level-switcher removal (known; a user decision).
- `verify_hierarchical_pipeline.py` and `verify_change_edges_pipeline.py`: not rerun. The change
  adds relationship facts but touches neither the explanation pipeline nor the change-edge
  aggregation. The git-review pipeline, which compares facts across snapshots, was run.

Deviations and choices the decisions left open:
- **Dense ranking** on top of the 0-1 BFS. The 0-1 BFS alone can still skip a number when a card
  is re-entered later by a longer path; a helper check pins this.
- **The beyond-the-map part appears only when K > 0.** K counts distinct entities at the root's
  granularity, including terminal types.
- **Candidates only where the solver threw.** A call the symbol solver resolved to a JDK method
  stays UNRESOLVED, even on an in-source receiver. The handoff lists such calls as external.
- **OVERRIDES targets every matching in-source ancestor**, not only the nearest, so dispatch from
  any overridden declaration reaches every override in one step.
- **The browser acceptance uses a copy of the committed fixture** (the fifth argument) rather than
  a generated one.
- **Commits live on the worktree branch `worktree-step12-phase-c`.** The session's isolation
  policy forbids committing to or merging into master itself. `git merge --ff-only
  worktree-step12-phase-c` on master lands them unchanged.

Limits:
- Erasure by simple name gives no OVERRIDES fact for a generic supertype parameter (`save(T)`
  against `save(Book)`), and could in theory match two different types with the same simple name.
- Unresolved method references (`foo::bar`) are not upgraded.
- Field initializers and initializer blocks remain owned by the type (R6), so a method root never
  sees them.
- DECLARES_BEAN (method to type) is not followed by a method root. D2 named only CONSTRUCTS, CALLS
  and USES_TYPE.
- Badges and corner buttons are drawn only for on-screen cards (unchanged).

## Step 12 phase B follow-ups: fact-level stack traversal and expanded-root look (2026-09-25)

Two follow-ups to the outgoing stack. Both were built test-first.

1. **Traversal over facts at the root's granularity (user decision).** The bug: with packages A -> B
   -> C, a stack rooted at class P in an expanded A showed C at layer 2 only because another class
   in the collapsed B calls into C. The old helper walked the drawn aggregated routes, so a
   collapsed card acted as a hub. The same happened with method roots. Now:
   - `outgoingStack({ graph, cards, routes, rootId, kind, direction })` walks the tab graph's raw
     edges. Each endpoint maps to its owner at the root's granularity (`ownerAt`: package, type or
     method/constructor). A method root ignores class-level facts and facts that target a class.
   - The walk skips null targets, filtered kinds, REMOVED facts, entity self-loops, and entities
     with no drawn card.
   - A card's layer is the minimum BFS distance over the entities it represents: its own entity,
     or the members it contains when collapsed.
   - The root set and the root's containers never get a layer.
   - Cards inside a layered expanded box are covered (`coveredIds`: lit, no badge).
   - A drawn route is a chain route only if one of its `occurrenceIds` is a walked step between
     chain entities.
   - Rules are in the helper's doc comment and `docs/OUTGOING_STACK.md` §Traversal. That section
     supersedes "only the routes currently drawn" and "Out of scope: collapsed internals".
   - Consequence: for a package root, expanding a downstream package no longer changes layers. The
     reached package's box carries the badge and its children are covered.
2. **Expanded-root look** (`docs/OUTGOING_STACK_REVIEW.md` P2). `GraphCanvas.tsx` gives every
   layer-0 card `stack-root`, not only the pinned root. The pressed toggle stays on the root only.
   Note: the brief described this fix and its browser checks as already present in the working
   tree, but the tree was clean at `04cd34e` when this work started. The fix, its browser checks,
   this entry and the untracked review doc (copied from the reviewer's scratch copy) were
   (re)written here. During the session the working tree was also reverted once by an outside
   process, with no reflog or stash entry; the work was re-applied from saved patches.

What changed:
- `frontend/src/features/explorer/outgoingStack.ts`: the new signature and rules. It reuses
  `ownerAt`/`isType` from `graphModel.ts`, is pure, and runs in O(nodes + edges) with memoized
  owners and representatives.
- `App.tsx`: the stack `useMemo` passes `graph` and `kind` (deps `[graph, projected, stackRootId,
  kind]`).
- `GraphCanvas.tsx`: in the stack branch, `stack-root` goes on the whole root set and covered cards
  count as chain (unmuted). No layout, fit, position or camera call was added. Journey state and
  pruning are unchanged.
- `scripts/test-outgoing-stack.mjs`: rewritten over hand-computable fact graphs (23 checks). It
  compiles scopeModel + graphModel + outgoingStack, following the journeys test pattern.
- `scripts/verify-outgoing-stack-ui.mjs`:
  - The in-page drawn-route BFS oracle is replaced by an independent Node-side oracle over
    `/api/snapshots/<id>/graph`. It does not import product code.
  - The old expansion checks are rewritten to the new rule: layers identical, badge on the
    services box, children covered.
  - New expanded-root checks (root package plus a nested type's methods).
  - A fourth CLI argument: a generated plain-source chain fixture.
- Docs: `OUTGOING_STACK.md` (Purpose, Traversal, Visual treatment, Out of scope, Verification, two
  implementation notes), `STABLE_GRAPH_INTERACTIONS.md` §Outgoing relation stack,
  `ARCHITECTURE.md` §5, `TESTING.md` (23 stack checks, 55 browser checks), and
  `OUTGOING_STACK_REVIEW.md` (Resolution section).

Analyzer check (before writing the browser fixture): the chain fixture was analyzed on a probe
backend (port 8097, no browser) and `/api/snapshots/<id>/graph` was inspected. It has CALLS
`P.m()->Q.q()`, `Q.q2()->T.t()` and `S.s()->U.u()`. It also has CONSTRUCTS method->class
(`P.m()->Q`, `Q.q2()->T`, `S.s()->U`) and DEPENDS_ON class->class (`P->Q`, `Q->T`, `S->U`). A
method root ignores the latter two by rule, and they do not change the class-level result. The
fixture needed no adaptation. Packages have no parent package, and there are no constructor nodes.

Verification (exact commands and outcomes):
- Red: `node scripts/test-outgoing-stack.mjs` against the old helper failed at once (`cards.map is
  not a function`, interface change). A scratch shim that adapted the new call shape to the old
  helper then failed 9 of 23 checks, including the user's scenario (class root P reached C) and
  the method-root case.
- Green: `node scripts/test-outgoing-stack.mjs`: PASS, 23 checks.
- Mutation checks in a scratch copy, each caught by the suite: walking through entities without
  a drawn card, a layer on root containers, last instead of min, walking REMOVED, no covered
  cards, a method root walking classes, ignoring the kind filter. Two mutations survived, and both
  are equivalent: requiring only the chain-route source, and walking self-loops. A reached source's
  step always reaches its target unless the target has no card, and then no route to it can be
  drawn.
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  PASS, all 12 suites (journeys still 46; `test-explorer-journeys.mjs` unchanged).
- `cd frontend && npx tsc -b --force && npm run build`: PASS; existing Vite chunk-size advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS. The jar's `index.html`
  references the new bundle (it contains `coveredIds`).
- Stack browser check. Fresh isolated setup: packaged jar on 8095 with its own data dir, model URL
  on closed port 9, headless snap Chromium on 9333. The setup script is the phase B one plus a
  generated `chainfix` directory:
  - app.a `P.m()` calls `new app.b.Q().q()`
  - app.b `Q.q2()` calls `new app.c.T().t()`, and `S.s()` calls `new app.d.U().u()`
  - app.c `T.t()`, app.d `U.u()`

  Command: `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095 DEBUG=http://127.0.0.1:9333
  OUT=<run>/evidence node scripts/verify-outgoing-stack-ui.mjs <run>/fixture <run>/gitfix <base
  oid> <run>/chainfix`. Result: PASS, 55/55 on the first run, zero page/console errors. All three
  fixtures' SHA-256 (and the Git fixture's `git status`) were unchanged, and the backend log shows
  no model requests. Screenshots and `report.json` replaced the old set in
  `docs/evidence/outgoing-stack/`. Inspected:
  - `01`: controllers root; domain/dtos/services 1, repositories/exceptions 2.
  - `02`: the layer-2 exceptions card is selected; the root stays pressed.
  - `03`: the services box is expanded, keeps badge 1, and its two classes are lit with no badge.
  - `04`: 15% zoom, badges legible.
  - `06-mobile-map`: 375 px, badge and pressed toggle on the map pane.
  - `07`: Changes; b 1 through unchanged a->b, c 2 through the added b->c; the root keeps its
    CHANGED fill.
  - `08`: controllers, EventController and its 4 methods all have the teal root look and no
    badges; layers unchanged.
  - `09`: app.a root; b 1, c 2, d 2.
  - `10`: class P root inside the app.a box; b 1, c 2; d and the b->d route muted.
  - `11`: method m root; b 1 only; c and d muted.
- `node scripts/verify-explorer-journeys.mjs <run>/fixture` in its own fresh isolated setup: PASS,
  51/51, fixtures unchanged.
- `git diff --check`: PASS.

Not run:
- `python3 scripts/verify_stable_graph_pipeline.py baseline|acceptance`: still broken by the ADR
  0007 level-switcher removal (pre-existing, see phase B).
- `verify_git_review_pipeline.py`: not rerun. The change does not touch review capture, and the
  stack's Changes path is covered by the stack browser check.

Limits:
- If an entity is represented only by the root's container (for example an out-of-scope class in
  the root's own package), the walk passes through it without a card, so a layer number can be
  skipped (documented in the helper and the spec).
- Covered cards get no outline of their own; they are only unmuted.
- The incoming direction still exists only in the helper.

Lead review of this follow-up: the diff was read (helper, App, GraphCanvas, tests, docs). These
passed again independently: all 12 node suites (23 stack / 46 journey checks), `tsc -b --force`,
`npm run build`, `bootJar` and `git diff --check`. A separate fresh isolated
`verify-outgoing-stack-ui.mjs` run passed 55/55, with all three fixtures unchanged and no model
requests. `09-package-root.png`, `10-class-root.png` and `11-method-root.png` were inspected and
match the rule.

## Step 12 phase B: outgoing relation stack (2026-09-24)

Follow-ups (fact-level traversal, expanded-root look, review resolution): see "Step 12 phase B
follow-ups" above.

Implements `docs/OUTGOING_STACK.md` (now committed, status: implemented). Phase A was not
reopened. The pure helper and the journey state were built test-first. Both new suites were run
red before the code existed, or before the reducer changed.

What changed:
- `frontend/src/features/explorer/outgoingStack.ts` (new, pure): `outgoingStack(cards, routes,
  rootId, direction)` does a BFS over the drawn, aggregated and filtered routes. The root set is the
  root plus its visible descendants. REMOVED routes are skipped. It returns layers (first-seen),
  rootSet, chainEdgeIds, depth and count. `stackSummary` builds the tooltip and inspector line.
- `explorerJourney.ts`: `Journey.outgoingStackRootId` (null in `newJourney`). It is classified and
  carried like ADR 0009 selection, so toggling adds no entry and keeps redo, and undo/redo keep it.
  `UPDATE` and `REVIEW_RECAPTURED` take an optional `graphFor`. Clone copies the root; nothing had
  to change for that.
- `revalidateJourney.ts`: `pruneRestoredSelection` drops the root when undo/redo stops drawing it.
  The mode-switch/recapture revalidation drops a root the target graph lacks. The new
  `pruneStackRoot` ends the stack after any update that changes display inputs and stops drawing
  the root: scope removal, collapse, level switch, Changes toggle, recapture. This closes the
  phase A review's P3 gap inside the reducer, with no App effect.
- `useExplorerJourneys.ts`: optional `graphFor`, read at dispatch time and attached to updates.
- `App.tsx`: `useMemo` stack over `projected`. `toggleOutgoingStack` is one selection-class update.
  Escape is layered: an active stack ends first. GraphCanvas and inspector props were added, and
  recapture passes `graphFor`.
- `GraphCanvas.tsx`: a stack emphasis branch (`stack-root` with the inspected look, ordered before
  the review fills; static `stack-member` cyan outline; `flow-out` chain routes; everything else
  muted except ancestors). The animation also runs with a stack and no selection. Layer badges go on
  the direction overlay (top-left, half-overlapping, dashed `HALO.out` in route phase, at least
  20 px, wider per digit, static under reduced motion, published to `atlas:directionOverlay.badges`).
  The on-card toggle (selected/hovered/root, `aria-pressed`, summary tooltip) is canvas
  hit-tested like the other corner squares, including under a route crossing an expanded box. The
  context-menu item is "Show/Hide outgoing stack". No layout, fit, position or camera call was
  added.
- `InspectorPanel.tsx`: "Outgoing stack: N layers · M resources" when the root is inspected.
  `App.css`: button and summary styles.
- Docs: implementation notes and accepted deviations in `OUTGOING_STACK.md`, an ADR 0009 note,
  a stack section and Escape rule in `STABLE_GRAPH_INTERACTIONS.md`, `ARCHITECTURE.md` §5, and
  `TESTING.md` (46 journey checks, 14 stack checks, 39 stack browser checks).

Decisions and deviations:
- The root stays outside history through the selection carry and classification, not
  `TRANSIENT_UPDATE` (the spec's wording). With `TRANSIENT_UPDATE`, a redo after undo pruning
  would revive a stack whose root had left the map. The handoff delegated this choice; it is
  recorded in the spec notes.
- The stack is computed in App rather than GraphCanvas, so the inspector line reuses it.
  GraphCanvas still only applies classes and badges.
- Browser acceptance: **user decision** to add the standalone
  `scripts/verify-outgoing-stack-ui.mjs` instead of extending the broken
  `verify_stable_graph_pipeline.py acceptance` (it still clicks the ADR 0007-removed level switcher).
- Found through screenshot inspection and fixed: the first `stack-root` rule came after the
  Changes fills and painted a CHANGED root teal. It is now grouped with `node.inspected` before the
  fills, and a browser check asserts the root's fill is unchanged.

Verification (exact commands and outcomes):
- `node scripts/test-outgoing-stack.mjs`: first run red (module missing), then PASS, 14 checks.
- `node scripts/test-explorer-journeys.mjs`: the new checks were red first
  (`outgoingStackRootId` undefined), then PASS, 46 checks (was 37).
- Mutation checks in scratch copies. Each mutation is caught by its suite: dropping the UPDATE
  prune, the root carry, the root's selection classification, the undo/redo root prune, the
  recapture prune, the REMOVED skip, the first-seen rule, or the root-set descendants.
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  PASS, all 12 suites (11 + `test-outgoing-stack.mjs`).
- `cd frontend && npx tsc -b --force && npm run build`: PASS; existing Vite chunk-size advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095 DEBUG=http://127.0.0.1:9333 OUT=<run>/evidence node scripts/verify-outgoing-stack-ui.mjs <run>/fixture <run>/gitfix <base oid>`
  against the packaged jar (isolated data dir, model URL on closed port 9, headless snap
  Chromium, setup as in the phase A entry). The Git fixture is generated per run: `git init`
  with packages `app.a`, `app.b`, `app.c`. The base commit has `A.run()` calling `B.go()` and
  `C.done()`. The working tree has `A.run()` calling only `B.go()` and `B.go()` calling `C.done()`.
  Result: PASS, 39/39, zero page/console errors, both fixtures' SHA-256 (and `git status`)
  unchanged, no model requests in the backend log. Earlier runs in this session failed for script
  reasons that were fixed: the Enter key event lacked `text`, a double tap deselected, and the
  Escape check counted the ordinary selection emphasis as chain routes. One real product defect
  was found by screenshot (the root fill, above).
  Screenshots are in `docs/evidence/outgoing-stack/` with `report.json`. Inspected:
  `01-stack-active` (badges 1/2 on the top-left corners, the root's pressed toggle beside its
  details button, cards outside the chain muted), `02-layer-two-selected` (root still pressed, the
  selected layer-2 card inspected over its badge), `03-chain-card-expanded` (the services box has
  no badge and its classes are numbered; a child badge overlaps the box header label, which the
  spec allows), `04-low-zoom` (15%: badges legible and larger than the cards; the root's toggle
  is hidden with the other corner buttons), `05-badge-and-toggle` (badge and toggle in opposite
  corners, no overlap), `06-mobile` / `06-mobile-map` (375 px: summary in Details; badges and the
  pressed toggle on the map pane; no overflow), `07-changes-mode` (C is layer 2 via the green
  ADDED B -> C only, the REMOVED A -> C is muted, and the CHANGED root keeps its yellow fill).
  After the last code change (renaming the overlay draw's `_phase` parameter to `phase`, since it
  is now used; no behavior change), the jar was rebuilt and a fresh isolated run passed 39/39 again.
  Its screenshots are the committed evidence.
- `node scripts/verify-explorer-journeys.mjs` (same isolated setup, fresh run): PASS, 51/51,
  fixture unchanged.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_git_review_pipeline.py`:
  PASS, 41/41, zero page errors, source and Git index SHA-256 unchanged
  (`build/git-review/run-31t77zwe`). `03-selected-change-colors-and-dashes.png` inspected: the
  inspected card keeps its ordinary look and shows the stack toggle only on the selected card.
- `git diff --check`: PASS.

Not run:
- `python3 scripts/verify_stable_graph_pipeline.py baseline|acceptance`: still broken at
  `revealClasses` by the ADR 0007 level-switcher removal (pre-existing, confirmed on `24a5fa6`).
  Porting it is a separate task (user decision above).
- Esc layering has no unit harness (App keydown). It is covered only by the browser check.

Limits:
- Below the corner buttons' minimum on-screen size (14 px), the stack toggle is hidden, including
  the root's pressed state. The badges, the context menu and Escape still work.
- At low zoom, badges may overlap neighbouring cards or a box header label (allowed by the spec).
- The incoming-stack direction exists in the helper only; there is no UI for it.

## Step 12 phase A: review remediation (2026-09-24)

Resolves the verified findings of the phase A review
(`/home/sajjad/prompts/step12/phase-a-review-report.md`) without changing any ADR 0009
decision. Behavior bugs were fixed test-first: the new journey checks were red on the phase A
code for findings 3, 4, 5 and 6 before the fixes.

Findings and dispositions:
- P1 re-click timer wipes later selections: fixed. `App.tsx` has `cancelReclick()`, called at
  the start of `inspectNode`, `inspectEdge` and `clearSelection` and from an effect cleanup
  keyed on `active.id`. The timer nulls its ref before calling `clearSelection`. The
  double-click cancel in `onArrangeAroundResource` is kept, now through the helper. Verified
  by build/type check and the browser double-click checks (still pass); there is no unit
  harness for App timers.
- P1 empty-canvas tap with no selection records a pane-only entry: fixed differently from
  the report's suggestion. `clearSelection` returns the journey unchanged when nothing is
  inspected and `multiIds` is empty. Confirmed in `styles/App.css` that `pane-*` rules exist
  only under `@media(max-width:760px)`, where the canvas (`.workspace-content`) is shown only
  in `pane-map`, and that desktop ignores `mobilePane`. The inspector's close button renders
  only with a selection. Browser check "Escape clears ... without history" still passes.
- P1 Back records a dead entry when only `priorEligibleIds` changes: fixed at the
  classification layer. `explorerViewState.sameDisplayedLevelView` (next to `sameLevelView`)
  ignores `priorEligibleIds`, and `isSelectionOnly` uses it for `levelViews`. `NAVIGATE_BACK`
  output and its object reuse are unchanged. New check: the report's reproduction (past stays
  0, `priorEligibleIds` still advances). The existing "Back that drops a card is recorded"
  check still passes.
- P1 carried Back trail keeps cards/routes removed by undo: fixed. `pruneRestoredSelection`
  filters `view.history` with the same drawn-before/not-after rule: card entries by card,
  route entries by route (including the graph-less fallback). Level-only breadcrumbs and
  never-drawn subjects stay. New check: the report's scenario (add p2, inspect p2, inspect
  p1, undo: trail empty, Back stays on p1), plus a route entry dropped next to a kept
  never-drawn entry.
- P2 4x `projectDisplayed` per undo: fixed with three short-circuits: nothing
  selected or trailed; same mode, scope, level, displayed IDs and expansions by reference; and
  route sets built only for an inspected or trailed route. The `graphFor` graph is resolved lazily. New
  check counts `graphFor` calls and `edges` reads. Scratch benchmark (100 packages, 1,900
  classes, 5,000 edges, 20 undo+redo pairs, node 22): drag undo with a card inspected 15.03
  -> 0.01 ms/step, with nothing selected 13.54 -> 0.00, scope undo with a card inspected
  13.40 -> 5.94, scope undo with a route inspected 13.41 -> 13.58 (unchanged, it needs all
  four projections).
- P2 inspected route never pruned without a graph: fixed. `graphModel.aggregateRouteEndpoints`
  parses the ID next to its builder (which now shares the prefix constant). Without route
  knowledge on both sides, an aggregate route is gone when an endpoint card was drawn before
  and is not after. Raw relationship IDs are never pruned this way. New check with no
  `graphFor`: inspected route and route Back entry pruned, raw ID kept, route with both
  endpoints still drawn kept.
- P2 `expandToReveal` pane regression: rejected. `git show 24a5fa6:frontend/src/App.tsx`
  shows base doing `setTab('map');setMobilePane('map'); if(!remaining.length){revealInTree(n);select(n);return;}`
  and base `select(n)` ending in `setMobilePane('details')`. Both versions therefore end on
  `details` for a card that is not yet inspected. For an already-inspected card both end on
  `map`: the deferred `clearSelection` sets it. No code change.
- P2 breadcrumb current-node click deselects: fixed. The button stays and calls
  `inspectNode(node,'details')`, a no-op re-inspection plus tree reveal. No `scripts/verify-*`
  or pipeline script clicks the breadcrumb (grep).
- P2 vacuous redo-pruning browser check: fixed. Running the tightened check first showed
  that it really was vacuous: a ctrl-tap only toggles the multi-selection and never inspects
  (`GraphCanvas` tap handler), so after Escape the old step never re-inspected the leaf. The
  script now taps, then ctrl-taps, and asserts that the leaf is inspected and the selection
  bar is shown. The redo check then asserts that `leaf.id` is no longer drawn (was
  `services.id`), with no selection and no bar.
- P2 `ARCHITECTURE.md` contradiction: fixed. The "Each tab's history retains ..." sentence no
  longer lists inspection, occurrence or multi-selection.
- P3 `EXPLORATION_TABS.md` Back rule: fixed with the qualifying sentence.
- P3 companion revert on undo untested: added a check. Move, then one click gesture
  (inspect p2 + `treeOpen` + `search: ''` + `mobilePane: 'details'`), then undo: the move is
  reverted, the companions come from the restored entry and p2 stays inspected.
- P3 phase B root pruning after ordinary updates: no code now; see limits.
- Mutation fragility: moved to independent checks. In scratch copies under `mktemp -d`,
  dropping the `NAVIGATE_BACK` reuse (`levelView = next`) fails 2 checks: identical level
  views after an unchanged Back, and an initial camera capture after that Back reaching the
  shared history entry. The old Back check no longer catches this mutation, because the
  classification now compares structurally. Dropping the mode-crossing branch fails 3 checks:
  the old one, a graph-less review route undo, and a redo into Changes dropping an ordinary
  route. Dropping the Back-trail filter (2), the graph-less fallback (1), the identical-input
  short-circuit (1) or the route-set gate (1) is also caught.

Docs: ADR 0009 has "review remediation" implementation notes: Back-trail pruning, the graph-less
route fallback, the short-circuits and the `priorEligibleIds` classification rule.
`STABLE_GRAPH_INTERACTIONS.md` has the Back-trail pruning rule and the no-op clear with
nothing selected. `EXPLORATION_TABS.md`, `ARCHITECTURE.md` and `TESTING.md` (37 unit / 51
browser checks) are updated.

Verification (exact commands and outcomes):
- `node scripts/test-explorer-journeys.mjs`: PASS, 37 checks (was 28).
- `for t in scripts/test-*.mjs; do node "$t" >/dev/null && echo "PASS $t" || echo "FAIL $t"; done`:
  PASS, all 11 suites.
- `cd frontend && npx tsc -b --force && npm run build`: PASS; existing Vite chunk-size
  advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_git_review_pipeline.py`:
  PASS, 41/41, zero page errors, source and Git index SHA-256 unchanged
  (`build/git-review/run-octxcam3`). Screenshots `02-changes-preserved-layout.png` and
  `04-first-tab-restored.png` inspected: Hub inspected in Changes with layout preserved;
  first tab restored with Back enabled and multi-selection intact.
- `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095 DEBUG=http://127.0.0.1:9333 OUT=<scratch>/evidence node scripts/verify-explorer-journeys.mjs <scratch copy of test-fixtures/microservice-java>`
  run after the git-review pipeline finished, against the packaged jar (isolated data dir,
  model URL on closed port 9, headless snap Chromium): PASS, 51/51, zero page/console
  errors, fixture SHA-256 unchanged, no model requests in the backend log. The first run of
  the tightened script was 50/51 (the vacuous step described above). After the script fix,
  a fresh isolated run passed. `journeys-desktop.png` and `journeys-mobile.png` inspected:
  package inspected after the double-click arrangement, Undo and Redo enabled; 375 px
  Details pane with no overflow. They were copied with `report.json` into
  `docs/evidence/selection-outside-undo/`.
- `git diff --check`: PASS.

Not run:
- `python3 scripts/verify_stable_graph_pipeline.py acceptance`: not run. It is known broken
  by ADR 0007 (it stops at `revealClasses`, clicking the removed Class/Method switcher), and
  the reviewer confirmed that it fails on base `24a5fa6` as well. Porting it is a separate
  task.
- Backend tests and live-model checks: skipped, frontend-only change.

Limits: the breadcrumb's current-node button on a narrow layout (map pane) switches to
Details. That is a pane-only change, so it is recorded like a tap on the Details mobile tab.
Pruning the Back trail can leave two adjacent identical entries (for example p1, p1 after
dropping the p2 between them). Back then steps to the same subject once; `revalidateSelection`
behaves the same way. Phase B needs a prune path after ordinary `UPDATE`s too, not only undo/redo (for example an App-level
check of `outgoingStackRootId` against `projected.nodes`, or a prune hook passed to
`update`), so that a stack root removed by collapse or scope removal is cleared.

## Step 12 phase A: selection outside undo history (2026-09-24)

Bounded R6 criterion ([ADR 0009](docs/adr/0009-selection-outside-undo-history.md)):
inspecting, choosing an occurrence, multi-selecting and clearing selection never create an
undo entry or discard redo. Undo/redo walk exploration edits only and keep the current
selection. They drop an inspected card, an inspected route or multi-selected cards only when
those were drawn before the step and are not after it. This is the groundwork for the
outgoing relation stack (`docs/OUTGOING_STACK.md`, phase B, not started).

- `explorerJourney.ts`: an `UPDATE` that changes only selection fields (`inspected*`, the
  Back trail, `multiIds`) replaces `present` and nothing else. Tree reveal, search reset and
  mobile pane count as part of the gesture only when they arrive together with a selection
  change; on their own they stay recorded. `UNDO`/`REDO` carry the current selection into the
  restored entry. The double-click `collapse` flag and its gesture-window bookkeeping are
  removed: a double-click is now one arrangement entry, and undoing it keeps the card
  inspected.
- `revalidateJourney.ts`: `pruneRestoredSelection` compares what the map draws before and
  after the step, using App's `graphFor` so children of expanded cards count. It shares the
  mode-boundary rules with `revalidateJourneyState` through the extracted
  `revalidateSelection`, so undo across a Changes toggle drops review route identities and
  their Back entries.
- `explorerViewState.ts`: `NAVIGATE_BACK` keeps the existing level view when reconciliation
  leaves it identical. A Back that only changes the subject is therefore a selection change
  with no undo entry. A Back that drops ineligible cards is still recorded; otherwise undoing
  it would be a no-op step, since selection is carried.
- `App.tsx`: `select`, `inspectEdge` and `clearSelection` each issue one update, so the whole
  gesture is classified together. The redundant separate `revealInTree` calls are removed,
  and the tree reveal is folded into the inspect update. Undo/redo buttons and keys pass
  `graphFor`. Behavior is otherwise unchanged; "View classes" on the inspected card still
  deselects it, as before.
- Docs: `STABLE_GRAPH_INTERACTIONS.md` §Exploration tabs and its Escape paragraph,
  `EXPLORATION_TABS.md`, `ARCHITECTURE.md` (undo history) and `TESTING.md` are updated. ADR
  0009 has implementation notes.

Verification (exact commands and outcomes):
- `node scripts/test-explorer-journeys.mjs`: PASS, 28 checks. Selection-restoration
  assertions were rewritten to the new contract. New checks cover a click sequence with no
  entries and redo kept, a click gesture with tree/search/pane companions, undo after inspect
  reverting the prior edit, undo removing the inspected card/route/multi-selected card
  (pruned, no Back push, not resurrected by redo), selection that was never on the map kept,
  graph-aware pruning of expanded children, undo across a Changes toggle, mixed edits,
  Back with and without a map change, clone copying selection, and the double-click undo. The
  new suite was red on the old reducer before implementation.
- `for t in scripts/test-*.mjs; do node "$t"; done`: PASS, all 11 suites.
- `cd frontend && npx tsc -b --force && npm run build`: PASS; existing Vite chunk-size
  advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar`: PASS.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_git_review_pipeline.py`:
  PASS, 41/41, zero page errors, source and index unchanged, no model requests
  (`build/git-review/run-u7he6nmf`, final jar). Its undo/redo Changes-toggle checks pass
  unmodified. Screenshots `02-changes-preserved-layout` and `04-first-tab-restored` were
  inspected and retained in `docs/evidence/selection-outside-undo/`.
- `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:8095 DEBUG=http://127.0.0.1:9333 OUT=<scratch>/evidence node scripts/verify-explorer-journeys.mjs <scratch copy of test-fixtures/microservice-java>`
  against the packaged jar (isolated data dir, model URL on a closed port, headless
  Chromium): PASS, 50/50, zero page/console errors, fixture SHA-256 unchanged, no model
  requests. The script's selection-undo checks were rewritten: clicks leave undo empty,
  selection keeps redo, redo removing the selected card prunes it, undo does not resurrect
  it. A new double-click check confirms one undo reverts the arrangement and keeps the
  inspection. The desktop and 375 px screenshots were inspected and retained in
  `docs/evidence/selection-outside-undo/` with the report.
- `git diff --check`: PASS.

Not run:
- `python3 scripts/verify_stable_graph_pipeline.py acceptance` was run and stopped in its
  first scenario at `revealClasses` (`TypeError ... reading 'click'`). This is the known
  pre-existing breakage recorded below: the legacy harness still clicks the Class/Method
  level switcher removed by ADR 0007 (36 call sites). It reached no assertion, so none of its
  assertions could be checked against this change. Porting that harness to the package-only
  view is a separate task and a prerequisite for phase B's browser acceptance.
- Backend tests and live-model checks were skipped: this is a frontend-only state change.

Limits: when a selection gesture moves only the selection, it does not record its companion
tree reveal, search reset or mobile pane. A later undo therefore restores those three from
the restored entry, while the selection itself stays current.

## Direct edge selection uses black (2026-09-24)

Bounded R6 criterion: clicking an edge highlights its line, arrow, label and
underlay in black in ordinary and Changes modes. The inspection selector follows
review selectors so even ADDED routes become black while inspected. Deselecting
restores factual colors. Resource-selection directional margins are unchanged.
ADR 0008, interaction docs and the Claude handoff record this distinction.

Verification:
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar` — PASS,
  including TypeScript/Vite; existing chunk-size advisory remains.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_change_edges_pipeline.py`
  — PASS, zero page errors, source unchanged; black edge screenshot inspected at
  `build/change-edges/run-cmendzqp/req3-edge-inspector.png`.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 41/41 checks, zero page errors, source/index unchanged, no model
  requests. All four review statuses use black during inspection and restore
  factual colors afterward (`build/git-review/run-2xtljh8a`).
- `git diff --check` — PASS.
Backend tests and live-model checks skipped for this frontend style-only change.

## Selected-edge dashes and directional margins (2026-09-24)

Bounded R6 criterion: restore moving dashes when selecting a resource and give its
attached edges thin directional margins without recoloring the factual lines.

- Native dash-offset animation replaces canvas arrowheads. A two-unit underlay
  uses incoming indigo / outgoing cyan, matching related-resource borders in both
  ordinary and Changes modes. UNKNOWN review routes retain dots. Deselecting
  restores the original patterns; reduced motion keeps static styling.
- Removed custom edge sampling/arrow painting; the canvas retains the split node
  ring. Other uncommitted behavior and change-state colors are preserved.
- Updated ADR 0008, graph interaction/testing documentation and
  `docs/STEP_ONE_REVIEW.md` for Claude review. Current reports and inspected
  screenshots are retained under `docs/evidence/selection-halo/`.

Verification (exact commands and outcomes):
- `cd frontend && npx tsc -b --force` — PASS.
- `node scripts/test-graph-model.mjs` — PASS.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar` — PASS,
  including frontend production build; existing Vite chunk-size advisory remains.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_change_edges_pipeline.py`
  — PASS, zero page errors, unchanged fixture source. Verified native moving dash
  offsets, directional margin colors, resource halos and cleanup. Screenshots in
  `build/change-edges/run-hsr6mopc`; selected-flow screenshot inspected.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 40/40 checks, zero page errors, unchanged source and index, no model
  requests. Verified factual route colors survive selection. Selected Changes
  screenshot inspected in `build/git-review/run-_1vpq26m`.
- `git diff --check` — PASS.

Limits: full backend tests and live-model checks skipped because this is a frontend
rendering change. Selected solid routes temporarily become dashed; UNKNOWN stays
dotted. The earlier step-one arrowhead implementation below is historical and is
superseded by this revision. `docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` is the
repository's equivalent brief.

## View-only controls outside undo/redo; stronger zoom steps (2026-09-23)

Bounded R6 criterion: fullscreen, Map overview and the dedicated zoom buttons do not
consume undo/redo entries or change when another exploration action is restored. One
zoom-button click has the effect of three former clicks.

- `explorerJourney.ts` supports a transient update that rebases the current value across
  the active tab's past and future branches. Fullscreen and Map overview use this path,
  so an undo still reaches the preceding semantic exploration action without changing
  either control.
- Dedicated zoom clicks suppress the normal debounced camera-history callback and commit
  through the same transient path. Mouse-wheel/pinch/pan and **Fit map** remain ordinary
  camera navigation and continue to participate in history.
- Zoom in now multiplies scale by `1.2³` (1.728); zoom out uses its reciprocal. Both stay
  centered on the canvas.

Verification (exact commands and outcomes):
- `node scripts/test-explorer-journeys.mjs` — PASS, 20/20 checks, including rebasing
  fullscreen, Map overview and button zoom across both undo and redo.
- `for test in scripts/test-*.mjs; do node "$test" || exit; done` — PASS, all 11 suites.
- `cd frontend && npx tsc -b --force` — PASS.
- `cd frontend && npm run build` — PASS; Vite reported the existing chunk-size advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar` — PASS.
- `BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:5199 DEBUG=http://127.0.0.1:9333 OUT=/tmp/code-atlas-undo-zoom-sw2WR5/evidence node scripts/verify-explorer-journeys.mjs /tmp/code-atlas-undo-zoom-sw2WR5/atlas-journey-fixture`
  — PASS, 44/44 real-browser checks, zero page/console errors. Zoom measured 0.8 →
  1.3824 → 0.8. Desktop and 375 px screenshots were inspected; retained copies and the
  report are under `build/undo-zoom/`. The disposable fixture was analyzed read-only and
  no model request was made.

Limits: only the dedicated +/− zoom buttons are excluded from camera history. Existing
wheel/pinch/pan and Fit-map behavior is intentionally unchanged. No live model integration
was exercised.

## Step 10 backlog — step one: selection halo and change-state colors (2026-09-23)

Bounded R6 criterion: selecting a resource preserves every route's factual color
and pattern while showing direction with moving chevrons and resource halos in
both ordinary and Changes modes. Added, removed and modified resources have
distinct green, red and yellow card/badge colors. Step zero's layout state is
preserved. See [ADR 0008](docs/adr/0008-selection-halo-and-change-color-redesign.md)
and [the Claude review handoff](docs/STEP_ONE_REVIEW.md), including inspected
screenshots under `docs/evidence/selection-halo/`.

- `GraphCanvas.tsx` uses one pointer-transparent canvas for repeated
  source-to-target arrowheads and the left-indigo/right-cyan ring on resources
  with both directions. It is below menus, controls, minimap, tooltips and the
  selection bar; card masks and multi-select priority keep overlay marks off card
  content and the purple outline. Paths use every rendered control point. For a
  self-loop whose renderer supplies two controls before finite endpoints, card
  boundary intersections complete the loop instead of drawing a chord.
- Ordinary resolved routes are 10% lighter gray (`#AAB6C4`) and their terminal
  and moving arrowheads are 10% darker (`#768698`). Moving arrowheads scale with
  rendered route width, clear edge labels and the scaled terminal arrow, and stay
  wider than strong routes. Selection changes neither factual color nor pattern.
  Terminal arrowheads retain scale 1.4; unrelated elements use opacity 0.5.
- Sampled edge paths and card masks are cached until geometry changes. One RAF
  queue coalesces pan/zoom and animation requests. Resize invalidates geometry
  even with reduced motion, so a static split ring follows its container.
- `reviewPalette.ts`, `nodeCard.ts` and graph styles share one palette for ADDED
  green, REMOVED red, MODIFIED yellow and UNKNOWN amber/neutral presentation.
  Card labels, parser statuses, snapshot IDs and review rollup rules are unchanged.

Verification (exact commands and outcomes):
- `for test in scripts/test-*.mjs; do node "$test" || exit; done` — all 11 scripts
  PASS, including 66 view-state checks, 19 journey checks, graph/review projection,
  placement and all three node-card badge fill/stroke pairs.
- `cd frontend && npx tsc -b --force && npm run build` — PASS (run as the
  two commands); Vite reported its existing chunk-size advisory.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar` — PASS.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_change_edges_pipeline.py`
  — PASS, zero browser page errors, unchanged copied fixture source, no model
  requests. Final run `build/change-edges/run-c10q4let`. The browser script checks
  actual overlay pixels, stacking, card masks, source-to-target orientation,
  adaptive width, label/terminal clearance, two-control self-loops, cache reuse,
  reduced-motion resize, factual patterns, all three halos and source evidence.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 39/39 checks, zero browser page errors, unchanged fixture source and
  index, no model requests. Final run `build/git-review/run-ddy2cjdp`. Its route
  baseline is unselected and it checks color, darker arrow color, line style and
  dash pattern through selection. Four step-one screenshots were inspected and saved.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_stable_graph_pipeline.py acceptance`
  — stopped in the legacy browser harness at `revealClasses`: it tries to
  click the removed graph-level switcher. It did not reach a step-one assertion.
- `git diff --check` — PASS.

Limit: cyan `#0EA5E9` measures 2.65:1 against the canvas, below the 3:1
non-text contrast target. Border pattern and chevrons carry direction as well.
No live model integration was exercised.

## Changes-mode layout continuity — complete after Claude review (2026-09-23)

Claude identified three missing cases: ordinary-only geometry across mode toggles,
ordinary relationship inspection during Recompare, and open ordinary symbol
source when entering Changes. All three are corrected and covered by targeted
regressions. [Claude review handoff](docs/STEP_ZERO_REVIEW.md).

Bounded R6 criterion: turning Changes on/off preserves the current map arrangement
instead of initializing or restoring a separate layout. Step one's edge/halo
styling requests are outside this slice.

- Tabs share their current geometry, scope, expansions, sizes and camera between
  ordinary and review mode. Matching comparison declarations reuse ordinary
  display IDs, while code and evidence retain actual base/head source identities.
- Matching requires unique kind/qualified-name/module keys and aligned ancestors;
  ambiguous declarations stay separate. Review-only resources remain inspectable
  in the overlay. Expanded container bounds can grow around removed children.
- Cytoscape explicitly removes review fields on ordinary-mode updates, preventing
  stale change colors on surviving canvas elements.
- The review browser harness uses package-only expand-in-place navigation, with
  first-toggle and edited-layout round trips, undo/redo and independent tabs.
- Recapture reconciles current open and closed tabs atomically; stale comparison
  history and source identities are discarded while surviving geometry remains.

- Placement reserves the in-scope geometry of parked review-only cards and the
  union of ordinary/review compound bounds, preventing new ordinary cards from
  overlapping removed cards when Changes returns.

Verification (exact commands and outcomes):
- `for test in scripts/test-*.mjs; do node "$test" || exit; done` — all 11 scripts
  PASS, including 66 view-state checks, 19 journey checks and the new parked-card,
  compound-bound and target-scope placement regressions.
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew bootJar` — PASS, including
  TypeScript and Vite. Existing Vite advisory: output chunk exceeds 500 kB.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 39/39 browser checks, zero page errors, zero model requests, unchanged
  source tree and Git index hashes. Final combined Step Zero/Step One run:
  `build/git-review/run-wsa3ja3y`.
  The Step Zero screenshots and the Step One selection screenshot were inspected;
  [saved report and screenshots](docs/evidence/changes-toggle/README.md).
- `git diff --check` — PASS. Luna max implementation and independent review were
  supervised; the final audit's hidden-card placement collision was fixed.
- Earlier browser harness failures (obsolete compound-parent lookup, duplicate
  selection click and insertion-order comparison) were corrected before the final run.
- Full backend tests, constrained-memory and live-model suites were not rerun:
  this slice changes frontend state/projection/placement only. The real packaged
  parser/Git/API/browser path was tested. Other legacy browser suites still target
  the removed level switcher and were not run; this review harness was updated.

Limits: unambiguously matched resources retain identity; ambiguous declarations
remain distinct. Review-only children can grow container bounds. Aggregate edge
inspection clears across modes because route identities differ. Step One is recorded
in the section above; no live model integration is claimed.

## Package-only exploration view — Class/Method level view removed (2026-09-22)

Requested by the user: the explorer had two overlapping ways to drill into
classes/methods — a "Packages / Classes / Methods" segmented level switcher
that re-pointed the whole map, and expand-in-place (`⊞`) card details that stay
in context. Kept only expand-in-place; removed the level switcher. See
[ADR 0007](docs/adr/0007-package-only-exploration-view.md) for the full
rationale, including the noted deviation from `docs/BUILD.md:200`'s "abstraction
(package/class/method)" requirement.

- Removed the "Graph level" segmented control (`App.tsx`) and every UI-reachable
  `NAVIGATE_LEVEL` dispatch. Confirmed first (via a full call-site trace) that
  this is frontend-only: `GraphQueryService.java` has no `level` parameter and
  never did — level slicing is entirely client-side — and the backend
  `GraphLevel.java` enum was already dead code before this change.
- Repurposed the four former level-switch triggers to expand-in-place instead
  of deleting them: the tree's `⌖` "View classes"/"View methods" buttons and
  the inspector's "View classes ↗"/"View methods ↗" buttons now expand the
  target card in place (never collapsing an already-expanded one) and select
  it (`revealChildren`/`ensureExpanded` in `App.tsx`). An HTTP entry-point
  route card and the `?selectedSymbol=` deep link now expand every ancestor
  package/class of the target in place, one level per render via a small
  `pendingRevealRef` + effect (`expandToReveal`) — needed because
  `toggleExpand`'s box math reads state that is still stale mid-handler, so a
  two-level reveal (e.g. a method under an unexpanded class under an
  unexpanded package) cannot be dispatched in one synchronous call.
- `Level`, `levelViews` and the `NAVIGATE_LEVEL` reducer case are deliberately
  left in `explorerViewState.ts`/`graphModel.ts`: expand-in-place's edge
  routing (`ownerAt`/`aggregateEdges`) still takes a `Level` parameter
  (`activeLevel` is simply never anything but `'PACKAGE'` now), and ~55
  existing unit tests key state on `Level` values for expand/collapse
  assertions unrelated to the removed switcher. Confirmed by reading
  `aggregateEdges` directly that its deeper-than-owner resolution is driven by
  the expansion/container map, not by which `Level` value is passed.
- Deleted `frontend/src/features/explorer/GraphControls.tsx`, an unused
  Class/Method/Package `<select>` stub not imported anywhere (found while
  tracing this feature; unrelated dead code).
- Docs updated: `docs/STABLE_GRAPH_INTERACTIONS.md` (Story 2's drill-down
  acceptance bullet), `docs/GIT_REVIEW.md` (toolbar description). `docs/BUILD.md`
  intentionally left unedited — a frozen historical brief; the ADR records the
  deviation instead.

Verification (exact commands and outcomes):
- `npx tsc -b --force` (frontend) — PASS.
- `node scripts/test-graph-model.mjs`, `test-explorer-view-state.mjs`,
  `test-expansion-layout.mjs`, `test-focused-arrangement.mjs`,
  `test-explorer-journeys.mjs`, `test-node-card.mjs`, `test-graph-placement.mjs`,
  `test-source-evidence.mjs` — all PASS, unmodified (they test underlying
  primitives/reducers, not the removed UI).
- Not run, and known to need follow-up work: `scripts/verify-stable-graph-ui.mjs`,
  `verify-git-review-ui.mjs`, `verify-hierarchical-ui.mjs`, and
  `verify-change-edges-ui.mjs` all contain scenarios built around clicking the
  now-removed `.segmented button`/`[aria-label="Graph level"]` control and will
  fail as written; they need a rewrite of those specific scenarios (not
  attempted in this session — no packaged jar/Chromium harness was run). Also
  not run: the packaged-jar `verify_*_pipeline.py` suites and `./gradlew test`
  (expected unaffected, since no backend file changed, but not re-verified here).
- No manual browser walkthrough was performed in this session; the four
  repurposed trigger points (tree buttons, inspector buttons, route cards,
  deep link) have not been visually confirmed end-to-end.

## Overlay route colors: unknown vs removed, one route per pair — complete (2026-09-20)

Reported from a real review of `/home/sajjad/projects/second-review-assist/src`: routes out of
`GraphQueryService` were red for no apparent reason, and lines into the `dto` package looked gray
until the package was selected and then looked green. Both were reproduced and fixed; neither was a
palette problem.

1. **A file that does not parse was reported as a deletion.** The user's working tree has
   `return  null` without a semicolon in `GraphQueryService.java` (confirmed independently with
   `javac`: `';' expected`). The parser stores the file but indexes no declaration from it, so the
   class was absent on the after side and the comparison called it, and all 30 of its relationship
   occurrences, REMOVED — red. `ReviewService.compare` now derives each side's unanalyzed paths
   structurally (a stored file with no indexed declaration; diagnostic text is not parsed, its format
   differs per producer) and emits `UNKNOWN` for a declaration missing only there and for any
   unmatched occurrence touching one. Amber dotted route, dashed "NOT ANALYZED" card badge.
   Re-running the same comparison: 8 nodes and 30 relationships moved from REMOVED to UNKNOWN, and
   nothing is REMOVED. On a scratch copy of that repository with only the missing semicolon added,
   the same backend reports the class MODIFIED with exactly 3 REMOVED occurrences (the dropped
   `new GraphNode(...)` CONSTRUCTS, the `parseExplanationStatus` CALLS, and the class-level
   `DEPENDS_ON` on `SymbolKind`) — the change the author actually made.
2. **The same ordinary map silently hid the class.** The footer now names unparsed files
   ("1 file(s) not analyzed", with the paths in its title), from new `unanalyzedFiles` graph
   metadata, so a missing class is never silent.
3. **Merging the statuses of a pair into one route was tried and reverted.** `reviewChange` is part
   of the aggregate key, so an unchanged, an added and a removed route between the same two cards are
   three lines; merging them into one derived-status route was implemented, verified, then reverted at
   the user's direction — separated lines are the wanted behavior, because a removed relationship must
   stay visible beside the unchanged one. Occurrences sharing a status still merge into one line.
   The reported "`api → dto` turns green when dto is selected" is therefore **still open**: with the
   lines separated, the ADDED `api → dto` route is a real, separate green line, and how a selected
   card's several same-pair routes should read is being taken up in a separate session.
4. **Nothing in review mode is red unless it was removed.** Incoming-route emphasis and its glow are
   indigo for every overlay route, a change color owns its own glow, and an incoming-related card
   takes the indigo halo instead of the red one.
5. The review status of the route under the cursor is now named in its hover text.

Verification (exact commands and outcomes):
- `JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew test bootJar` — PASS, 124 tests
  (1 new: an unparsed file is UNKNOWN, a real deletion stays REMOVED), 0 failures/errors/skips.
- `npm --prefix frontend run build` — PASS; only the existing >500 kB chunk advisory.
- All 10 `node scripts/test-*.mjs` — PASS (`test-graph-model.mjs` gains the route-status table and a
  one-line-per-pair assertion).
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 29/29 checks, 0 page errors, 0 model calls, fixture tree and `.git/index` unchanged. Seven
  new checks: unparsed file named on the ordinary map and its class absent there; an unknown route is
  amber/dotted and its card is UNKNOWN; a call into it is unknown; a dropped call site draws its own
  removed line beside the unchanged one, and occurrences sharing a status still merge into one line;
  every route keeps its expected color while each card in turn is selected; deselecting restores every
  unselected color. The fixture gained `Broken.java` (parses in the base, not in the working tree),
  `BrokenClient.java`, and a second `KeepDep` call site in the base `Hub.sibling()` that the working
  tree drops — the pair that now draws an UNCHANGED and a REMOVED line.
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_change_edges_pipeline.py`
  — PASS (the run the previous session deferred), fixture source unchanged, no model provider.
- `git diff --check` — clean.
- Skipped: the live-model suite and `constrainedMemoryTest` (deterministic change, no explanation
  pipeline involved). The user's own application database was never written to; reproduction used a
  copy of it under a scratch data directory on port 8095, and the analyzed repository was read only.

Remaining limits: `UNKNOWN` is additive within schema version `1` (ADR 0006 addendum). Comparison
diagnostics are still not rendered as a list — the deliberate reduction recorded last session — so
the unparsed-file signal is the card badge, the route style and the footer count.

## Step11 Phase 1 — review remediation complete (2026-09-30)

Bounded acceptance criterion: introduce a language-neutral analysis port and workspace/
snapshot language identity without changing Java graph facts, evidence or Spring behavior.
The follow-up review is `/home/sajjad/prompts/step11/review-step-0.md`.
The review fixes and language boundary are implemented. Backend verification passed:
135 ordinary tests, the constrained-memory test, and the final three focused tests after
migration seed cleanup. Frontend build, all nine Node suites and six Python pipelines
also passed. The final stable-map acceptance gate now passes: 35 scenarios,
31 inspected screenshots, zero browser runtime errors and unchanged fixture source.
The prior incomplete S4 failure is retained as a failure. An isolated real-pointer
reproduction showed that a renderer-valid edge coordinate could hit the minimap
SVG and pan the map. The harness checks DOM targets before clicking; camera and
endpoint assertions remain intact. No application change was required.

Pre-integration final command on the Step11 baseline: `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java PYTHONDONTWRITEBYTECODE=1 python3 scripts/verify_stable_graph_pipeline.py acceptance`
— PASS; `build/step11/resumed/stable-final-2026-09-30.log`, run `acceptance-g_rauxtj`.
`node --check scripts/verify-stable-graph-ui.mjs`, `git diff --check`,
`git diff --cached --check`, the ADR byte comparison and frozen brief/parser checks
— PASS. Unaffected suites and the executable package were not rerun/rebuilt on this
continuation because only the harness and documentation changed.

Durable inspected screenshots now cover import, review, change-edges, hierarchy and
the synthetic READY explanation inspector, plus the final stable-map run and pointer
diagnostic. Exact commands, outcomes, local log paths,
review dispositions and screenshot links are recorded in
[Step11 verification evidence](docs/evidence/step11/README.md). Existing passing gates
were preserved on continuation; no live model endpoint was contacted. Phases 0/1
are complete; the broader R6 milestone remains in progress. The
[Claude review prompt](docs/STEP11_CLAUDE_REVIEW.md) is ready. The completed changes are prepared for GitHub integration.


## Step11 Phase 0 — documentation groundwork complete (2026-09-22)

Bounded acceptance criterion: record the multi-language decision before extracting the
Java analysis boundary. Copied ADR 0008 verbatim from the supplied step11 directory,
updated the mission and source-only invariant in AGENTS.md, and documented the planned
shared analysis port in the architecture module table. Java remains the sole shipped
language. Phase 1 follows; Go/Dart implementation is outside this request.

Verification: `cmp /home/sajjad/prompts/step11/0008-multi-language-support.md docs/adr/0008-multi-language-support.md`,
`git diff --exit-code -- docs/BUILD.md`, and `git diff --check` — PASS.
No runtime checks required for this documentation-only phase. `docs/BUILD_BRIEF.md`
is absent; read the existing frozen `docs/BUILD.md` instead.

## Review remediation for the Code-map review slice — complete (2026-09-19)

An external multi-agent review report (`/home/sajjad/prompts/git-review-code-map-review-report.md`)
was triaged against the actual tree before any change. Its diagnoses were checked one at a time. Its
patch blocks were not used because they target code that does not exist here: an illegal `useMemo`
inside JSX, a CSS selector that matches nothing, and a `fileDiff.ts` line that is not there. Each
finding was reproduced or re-derived first. Three Sonnet subagents fixed disjoint scopes, and their
diffs were reviewed and refined before acceptance.

Fixed (reproduced first):
- P1.1 false red/green relationship pairs: relationship matching included concatenated evidence
  text, so editing one call's arguments split the aggregated class `DEPENDS_ON` (and that `CALLS`)
  into REMOVED+ADDED. Failing integration test first, then two-phase matching in
  `ReviewService.compare` within a structural key (source, target, kind, resolution). Identical-
  evidence occurrences pair first, then leftovers pair one-to-one. Multiplicity changes still surface,
  covered by a second new test. Documented in `docs/GIT_REVIEW.md` and the ADR 0006 addendum.
- P1.2 split diff lost declaration/evidence highlighting and auto-scroll. Fixed. The browser check
  then exposed a follow-on defect: highlighted added/removed lines lost their green/red to the
  highlight background in both layouts. Change color now wins, and the highlight shows as an outline.
- P1.3 an open source dialog refetched on every App re-render (inline `reviewDiff` object). Now
  memoized; `useReviewComparison`'s derived graph/identity maps are memoized on the comparison too.
- P2.2 an inspected UNCHANGED incoming overlay route used the red dashed incoming-flow style, which
  was indistinguishable from REMOVED. Overlay-only indigo; the ordinary map is unchanged.
- P2.4 an empty file (`''`) was treated as one line, producing a phantom context row. Fixed, with 3 new
  diff tests.
- P2.5 collapsed heading controls stayed in keyboard tab order: `inert` + `aria-hidden` +
  `visibility: hidden` after the collapse transition.
- P3.1 wheel over inputs/selects/the review popover no longer collapses the heading. P3.2 a failed
  comparison is now also shown in the app error banner. P3.3 stale links to the removed
  `docs/CLAUDE_REVIEW_PROMPT.md` and a stale run folder were corrected.

Not changed, with reasons:
- P2.1 ambiguous declarations get `#base-i`/`#head-i` suffixes and never match across captures.
  This is intentional and documented (ADR 0006: ambiguous identities are not paired by guess).
- P1.1 sub-claim "provenance inversion" from sorting on `changedSite`: not separately reproduced.
  The sort already has a location and id tie-break, and phase-1 pairing by identical evidence makes
  the order irrelevant for unchanged sites.
- P2.3 "staged deletions": nothing is staged. The old screenshots and `docs/CLAUDE_REVIEW_PROMPT.md`
  are unstaged deletions, and the new PNGs, `docs/CODEX_REVIEW_PROMPT.md`, `fileDiff.ts`,
  `useReviewComparison.ts` and `scripts/test-file-diff.mjs` are untracked. Stage everything together
  when committing. Exclude `codex_handoff.md` and decide separately on `frontend/tsconfig.tsbuildinfo`
  (build output flagged in the handoff). Nothing was staged or committed here.

Verification (exact commands and outcomes):
- `./gradlew test bootJar` — PASS, 123 tests (3 new: argument edit stays UNCHANGED, a dropped
  distinct call is still REMOVED, a call moved to another method is REMOVED+ADDED), 0 failures.
- `npm --prefix frontend run build` — PASS; only the existing >500 kB chunk advisory.
- All 10 `node scripts/test-*.mjs` — PASS (`test-file-diff.mjs` 13 checks, journeys 18).
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 20/20 checks (6 new: overlay incoming-flow color, ordinary-map flow color unchanged with
  Changes off, inert collapsed heading, split highlighting, change color inside a highlighted
  declaration, no refetch on re-render), zero page
  errors, zero model requests, fixture source and Git index unchanged. Screenshots inspected.
- `git diff --check` — PASS.

## Git review merged into the Code map, per-tab mode, diff code viewer — complete (2026-09-19)

Follow-up to the Git review slice below, requested by the user: no separate
"Review changes" page, report or change legend; the Base+changes overlay draws
directly on the ordinary Code map behind a **Changes** toggle in the graph
toolbar, review mode is a per-exploration-tab setting (New tab/Clone tab both
keep working with it), the map-heading can be collapsed for more graph room, and
opening a changed file's code shows a real unified/split git diff. Base-only and
after-only views are dropped; the overlay already carries after-change resources
plus removed base-only resources. See [Git review](docs/GIT_REVIEW.md) and the
[ADR 0006 addendum](docs/adr/0006-git-review-snapshots.md#addendum-overlay-integrated-into-the-code-map-per-tab-mode).

Verification (exact commands and outcomes):

- `./gradlew test bootJar` — PASS, 120 tests (one new: review-file hunks and the
  new whole-file-by-path endpoint), zero failures/errors/skips; production
  frontend and executable JAR built.
- `npm --prefix frontend run build` — PASS, clean TypeScript build, no CSS warnings.
- `node scripts/test-explorer-journeys.mjs` — PASS, 18 checks (6 new: toggle
  round-trip preserves each mode's layout as one undo step, a stale comparison's
  stash is discarded, `NEW` opens in the requesting tab's mode, `CLONE` copies
  review mode/stash/history, `REVIEW_RECAPTURED` resets every tab that touched
  review — open or closed — and drops stale stashes).
- `node scripts/test-file-diff.mjs` — new, 10 checks: pure-insertion and
  pure-deletion unified-diff hunk edge cases, multi-hunk offset tracking, added/
  deleted whole files, and split-view pairing/padding.
- `node scripts/test-review-model.mjs`, `test-graph-model.mjs`, `test-node-card.mjs`,
  `test-explorer-view-state.mjs`, `test-expansion-layout.mjs`,
  `test-focused-arrangement.mjs`, `test-graph-placement.mjs`, `test-source-evidence.mjs`
  — all PASS, unaffected by this change.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  (rewritten for the new flow) — PASS, 14/14 checks, zero page errors, zero model
  requests, fixture source tree and Git index unchanged. Covers: prior map state
  (level/selection) preserved across turning Changes on; amber/green/red overlay
  styling with no report/legend elements present; New tab opens in the current
  tab's review mode; Clone tab copies review mode and history; collapsing the
  map-heading grows the graph stage while the toolbar stays visible; the diff
  viewer shows added and removed lines in unified layout and switches to split;
  Recompare issues a fresh comparison; a removed class's diff renders all-red
  with nothing added (the base-side counterpart to the modified-class check,
  exercising the other-snapshot fetch-404-to-null fallback). Five screenshots
  inspected.
- `git diff --check` — PASS.
- Live model and constrained-memory explanation-scale suites skipped: this change
  is deterministic and does not touch the model/explanation pipeline.

Known limitation carried over deliberately: the non-Java changed-file list and
comparison diagnostics the removed report used to show are not surfaced
elsewhere in this slice (see the ADR addendum's closing note).

## Superseded by the slice above: Git review views — complete (2026-09-19)

Bounded R6 acceptance criterion: inspect one local Git changeset in base, overlay
and after-change graphs at package/class/method level, follow evidence from the
correct captured source, and return to normal exploration without changing the
source repository or its active analysis snapshot.

The user confirmed the default base: common ancestor of HEAD and its locally
available upstream, with a visible HEAD fallback and an explicit-ref override.
Read-only raw Git capture includes staged, unstaged and nonignored untracked
content. Independent retained-source snapshots keep ordinary analysis untouched.
Overlay resources are yellow with physical +/- line counts; relationship occurrences
remain independently inspectable in green, red or their ordinary unchanged styling.
Each view reuses the full explorer and keeps independent page-session state.
See [Git review](docs/GIT_REVIEW.md) and [ADR 0006](docs/adr/0006-git-review-snapshots.md).

Verification (exact commands and outcomes):

- `./gradlew test bootJar` — PASS, 119 tests, zero failures/errors/skips; production
  frontend and executable JAR built. Existing >500 kB Vite bundle warning remains.
- `node scripts/test-review-model.mjs`, `node scripts/test-graph-model.mjs`,
  `node scripts/test-node-card.mjs`, `node scripts/test-explorer-journeys.mjs`,
  `node scripts/test-explorer-view-state.mjs`, `node scripts/test-expansion-layout.mjs`,
  `node scripts/test-focused-arrangement.mjs`, `node scripts/test-graph-placement.mjs`
  and `node scripts/test-source-evidence.mjs` — all PASS.
- `JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py`
  — PASS, 34/34 checks, zero page errors and zero model requests. Real packaged
  backend and Chromium exercised all three views, line counts/colors, retained
  evidence, independent view state, expansion, full-screen arrangement, mobile
  Details/Map switching and return to ordinary exploration. Fixture source and Git
  index hashes remained unchanged. All four screenshots inspected. Final evidence:
  [Git review browser report](docs/evidence/git-review/README.md).
- `PATH=/usr/lib/jvm/java-21-openjdk-amd64/bin:$PATH python3 scripts/verify_change_edges_pipeline.py`
  — PASS on the final packaged frontend, zero browser errors and unchanged fixture.
  Existing relationship widths, directional selection and grouped source evidence
  remain working. Screenshot inspected; artifacts: `build/change-edges/run-t6_2u6l5/`.
- Earlier focused backend run: 15/16 passed; binary-file fixture omitted its initial
  commit. Fixed fixture; full suite above includes the passing regression.
- Earlier browser startup: default Java 17 rejected Java 21 bytecode. Browser
  acceptance uses `/usr/lib/jvm/java-21-openjdk-amd64/bin/java` explicitly.
- Intermediate browser attempts exposed stale selectors, hidden mobile navigation,
  and card controls below their minimum hit size. Harness navigation now waits for
  the active side and uses visible controls; screenshot capture fits after viewport
  changes. Incomplete attempts are not counted as passing checks.
- Review-driven fixes include inactive-view listeners/polling, preserved route
  strength, expanded and multiline resource badges, scrollable review content,
  mobile pane isolation, readable relationship labels, and root/ancestor symlink
  freshness checks. Batched base/head source APIs have retained-source regression
  coverage after live files are removed.
- `git diff --check` and `git diff --cached --check` — PASS.
- Live model and constrained-memory explanation-scale suite skipped: review is
  deterministic and does not modify the model/explanation pipeline.

Limits: Java source-only analysis, supported local Git worktree root with an initial
commit; no symlinks/submodules, remote fetch, saved human decisions or persisted
review UI session. Capture limits and partial-analysis behavior are documented.
The broader R6 milestone remains in progress. The review prompt for this earlier
slice (`docs/CLAUDE_REVIEW_PROMPT.md`) has since been removed; the current
multi-agent review prompt is [CODEX_REVIEW_PROMPT.md](docs/CODEX_REVIEW_PROMPT.md).

## Reviewer assistance proposal — documentation only (2026-09-17)

Read current status, BUILD.md (BUILD_BRIEF.md remains absent), architecture, data
model, support matrix, plans, backlog, relevant ADRs and exploration docs; inspected
the implementation before proposing review features. Compared the existing design
at `/home/sajjad/code-atlas-review-designs.html` (the supplied `/home/` location was
absent). No application feature or active milestone was changed.

Deliverable: `/home/sajjad/code-atlas-review-proposal.html`, a self-contained proposal
with an interactive synthetic review, prioritized suggestions, implementation gaps,
acceptance cases and local source references. Recommendation: complete change list,
exact before/after source and persistent human decisions first; selected-change graph
context and evidence-backed signals next; optional generated walkthroughs later.
See [review direction](docs/REVIEW_DIRECTION.md) for the repository handoff.
The completion pass added a seven-step reviewer journey from revision selection
and stated intent through evidence/context inspection, test questions, human
decisions, review handoff and re-review after a new head. It includes a concrete
finding example and desktop/narrow interaction guidance.

R6 acceptance boundary considered: inspect evidence and branch/return to exploration
without losing map state or affecting another tab. The proposal assesses reuse of
that behavior; it does not claim new verification or completion of the existing R6
slice. Cross-snapshot tabs, method-level diffs and review persistence remain new work.

Verification (exact commands and outcomes):

- `node /home/sajjad/code-atlas-review-proposal-evidence/check.mjs` — PASS, 22/22
  standalone HTML checks: source links/anchors, script syntax, item selection,
  independent notes/decisions, progress categories, local Markdown export,
  literal note display, desktop and 768/390/375 px overflow, disclosure/reload
  behavior, zero runtime exceptions and zero HTTP requests from the artifact.
  Eight desktop/mobile screenshots captured; the original six and both added
  reviewer-journey views were visually inspected. The final rerun remains 22/22 PASS.
  The harness deletes the previous demo export before checking a new download.
  Evidence lives
  in `/home/sajjad/code-atlas-review-proposal-evidence/`.
- Initial harness attempts did not finish: Chromium Snap rejected a hidden-cache
  profile directory; a test expression then contained an incorrectly escaped newline.
  The harness uses a disposable Snap-accessible profile and corrected escaping. Those
  attempts are not counted as successful checks or application failures.
- `git diff --check` — PASS.
- Skipped application build, Gradle tests, application browser suites, packaging and
  live model checks: only a standalone design artifact and documentation changed.

Limits: synthetic interaction only; demo notes reset on page reload as disclosed.
No repository comparison, PR integration, real model review or backend workflow was
implemented or verified. Existing pending stable-graph verification and Step 6A
remain unchanged.

## Exploration tabs and per-tab history — final verification (2026-09-16)

Resumed the unfinished tab/history implementation already present in the worktree.
Bounded R6 acceptance criterion: branch an exploration and undo/redo its UI actions
without losing its map or changing another tab or backend data.

- Independent **New tab**, **Clone tab**, close and **Reopen closed tab** controls.
  Each tab owns scope, level pages, geometry, expanded cards, inspection/Back history,
  tree state, search, relationship filter, source-dialog subject, occurrence selection,
  multi-selection, pane controls, minimap and full-screen preference. Clones inherit
  both history branches. History is bounded to 200 actions and ten closed tabs.
- `explorerJourney.ts` wraps the existing view reducer; `useExplorerJourneys.ts` groups
  synchronous changes from one UI action. Initial fit records a baseline; camera
  debounces flush before pointer/keyboard actions and tab/history commands. Snapshot
  replacement clears history and never reuses tab IDs, rejecting stale callbacks.
- **Clear selection**, empty canvas, Escape and a repeated resource/edge click clear
  inspection. Escape clears inspection and multi-selection atomically. Undo/redo
  shortcuts leave native text editing alone. The clear button occupies a permanent
  slot above the panes, so revealing it cannot move the map between double-clicks.
- Fixed a renderer ownership defect exposed by undo: Cytoscape mutates the coordinate
  objects passed to `add()`. The adapter now copies them, preserving historical and
  cloned-tab positions through expansion, resizing and dragging. Browser fullscreen
  is owned by App above the keyed canvas, so undo inside full screen keeps it open.
- Architecture and interaction docs updated; behavior, boundaries and browser setup
  are documented in `docs/EXPLORATION_TABS.md` and `docs/TESTING.md`.

Verification (exact commands and outcomes):

- `npm run build` in `frontend/` — PASS (TypeScript + production Vite bundle).
  Existing >500 kB bundle-size warning remains.
- `node scripts/test-explorer-journeys.mjs` — PASS, 13 history checks.
- `node scripts/test-explorer-view-state.mjs` — PASS, 59 checks.
- `node scripts/test-graph-model.mjs`, `node scripts/test-expansion-layout.mjs`,
  `node scripts/test-node-card.mjs`, `node scripts/test-focused-arrangement.mjs`,
  `node scripts/test-graph-placement.mjs` — all PASS (focused arrangement 12,
  placement 9; remaining suites print named assertion groups).
- `APP=http://127.0.0.1:5198 node scripts/verify-explorer-journeys.mjs /tmp/atlas-journey-fixture`
  — 42/42 PASS on the final production frontend.
  Real isolated backend on 8095, production Vite preview on 5198 and Chromium CDP on
  9333; no model calls. Desktop and 375 px screenshots inspected. Final report and
  screenshots are retained in `docs/evidence/explorer-journeys/`.
- `APP=http://127.0.0.1:5198 OUT=build/journey-card-expansion node docs/evidence/card-expansion/browser-check.mjs /tmp/atlas-journey-fixture`
  — PASS, 35/35, including nested expansion, container dragging and Escape mid-resize.
- `node scripts/verify-stable-graph-ui.mjs /tmp/atlas-journey-stable-config.json`
  — final rerun in progress. Config points at production preview 5198, independent
  Chromium CDP 9334, a temporary copy of the 75-type fixture and output directory
  `build/journey-stable-graph/`.
- Failures used to validate fixes: expansion/resize undo corrupted stored positions;
  separate Escape listeners left inspection selected; canvas remount exited full
  screen; the clear-selection button wrapped the banner and broke two double-click
  scenarios (3 assertions). Those checks were retained. An initial temporary Vite
  dev config failed to resolve react-refresh; verification moved to the production
  build. Two earlier runs were interrupted by continuation turns and are not counted
  as completed checks. One stable-graph rerun also stopped when its existing pointer
  edge picker missed every candidate; the next run passed that scenario.
- `git diff --check` — PASS.
- Skipped `./gradlew test`, packaging, and live/hierarchical explanation verification:
  no backend, schema, provider or packaging changes; this is an exploration UI slice.
  Existing built backend JAR was used with an isolated temporary database.

Limits: page-session/snapshot history only; no persistence over reload or re-analysis.
Backend operations, settings and document edits are outside undo. Scroll offsets,
text selection, transient menus and explanation disclosures are not saved. Native
browser fullscreen may require a user gesture; the map overlay still restores.
The wider R6 milestone and stable-map Steps 6–10 remain pending. `docs/BUILD_BRIEF.md`
is absent; `docs/BUILD.md` is the product specification identified by the plan.
## Change-edges slice — complete

Requested in `/home/sajjad/prompts/change-edges.md` (2026-09-16).

1. **One line per direction.** `graphModel.ts` `aggregateEdges` now keys on the ordered
   `(source, target)` pair after roll-up instead of `(source, target, kind, resolution)`. The drawing
   is merged, the data is not: `occurrenceIds`/`occurrenceKinds` keep every row, `kindCounts` and
   `resolutions` keep the breakdown, `kind` is the dominant kind, `resolution` the least certain one
   present (uncertainty stays visible), and `strengthWidth = min(10, 1.2 + 1.5·log2(count))` drives
   Cytoscape `width`. The ID is `aggregate:[source,target]`, so a relationship-filter change keeps the
   same route (thinner) or removes it when no kind is left. Label and inspector show the kind breakdown;
   occurrence options read "calls 2 of 4".
2. **Directional selection emphasis (original implementation, superseded by ADR 0008).** The first
   change-edges pass recolored and dashed selected routes. Step 10 Step One now preserves factual route
   color/pattern and uses cached overlay arrowheads plus indigo/cyan resource halos instead. The shared
   animation loop still pulses route underlay and halo width; reduced motion keeps static direction
   marks. Edge inspection retains its teal emphasis. Edge labels remain 11px off the line.
3. **Evidence grouped by file.** Cause: a `DEPENDS_ON` occurrence stores one evidence row per call site
   (`JavaParserAdapter`), so `SourceDialog` rendered the same file once per row. New
   `POST /api/snapshots/{id}/relationships/source {ids}` (`SourceService.relationships`) returns one
   entry per file with distinct, line-ordered ranges and the kinds covering each (≤5000 IDs, chunked
   below SQLite's parameter limit, live-hash check once per file). `sourceEvidence.ts` also groups flat
   rows, so the per-occurrence endpoint never repeats a file. "View source evidence" on a merged line
   shows all its occurrences; "View selected occurrence only" keeps the single-occurrence view. The
   inspector's occurrence picker now holds the chosen occurrence by ID: with endpoint-only route IDs a
   filter change keeps the line but shrinks `occurrenceIds`, and an index would have silently switched
   (or overrun) the explained/evidenced occurrence. It opens on the first occurrence with a ready
   explanation. A merged line is badged ✦ READY when **any** occurrence is READY (previously every
   occurrence in a kind-scoped group had to be): explain-all queues symbols only and a CALLS line almost
   always also carries the derived DEPENDS_ON, so the old rule would have made the badge unreachable.
   Evidence requests are capped client-side at the backend's 5000 IDs with an explicit notice; the
   largest package-level line in the bundled fixtures has 69 occurrences (online-book-store).
4. **Teaching page** `/home/sajjad/prompts/how-code-atlas-understands-relations.html` — written from the
   extractor source; notes that only 6 of the 11 `RelationshipKind` values are produced today.

Verification: `node scripts/test-graph-model.mjs` PASS (merged-route, reverse-direction, method-level,
filter-identity and width cases replace the per-kind expectations); `node scripts/test-source-evidence.mjs`
PASS (new); `test-explorer-view-state.mjs`, `test-focused-arrangement.mjs` PASS; `npx tsc -b` and
`npm run build` PASS; `./gradlew test --tests dev.codeatlas.graph.SourceEvidenceGroupingIntegrationTest`
PASS (new; asserts the per-occurrence endpoint repeats the file and the batch endpoint does not);
`python3 scripts/verify_stable_graph_pipeline.py acceptance` PASS (34/34) after deliberately updating
`inspect-edge-survives-filter-change` to filter to a kind the clicked line does not contain (filtering
to a contained kind now correctly keeps the line drawn). Live Chromium run against the packaged jar on a
5-class flow fixture: one line per ordered pair, mutual pair = 2 lines, stronger route renders wider,
the expected directional classes and halos, animated direction phase and halo width change over time,
deselect leaves no classes or bypass styles, Hub.java shown once with lines 8/10/11/16 highlighted
for both the merged line and the single DEPENDS_ON occurrence, the chosen occurrence ("calls 4 of 4")
survives a filter to CALLS with no filtered-out notice, zero page errors (`scripts/verify-change-edges-ui.mjs`
against `test-fixtures/change-edges-fixture`). Evidence:
`docs/evidence/change-edges/`.

That browser suite is now self-contained: `python3 scripts/verify_change_edges_pipeline.py` picks its
own ports, starts the jar and Chromium, analyzes an isolated **copy** of the fixture (SHA-256 checked
before/after), and runs the suite — so change-edges regressions can fail CI instead of needing a
hand-assembled snapshot ID. It additionally asserts what the first pass only assumed: the inspected
line's endpoints are emphasized rather than dimmed, overlay arrowheads follow increasing source-to-target
path distance, leftover animation styles are detected through the public style API instead of Cytoscape's
`_private` internals, and the three direction halos differ by
`border-style` (solid / dashed / double) so direction survives a colour-vision deficiency.

Merged with the in-place card details work below: routes now resolve to the deepest visible card
inside an expanded container (upstream) *and* merge per ordered endpoint pair (this slice), so an
expanded package's class connects to a collapsed package as one line carrying every kind.
## In-place card details and resizable cards — complete (uncommitted)

User request (2026-09-14): a details button on package cards that shows their classes with every
relationship those classes have to other packages, the same on class cards for methods, and resizing for
every card. The user chose "expand inside the card" over a replacement or a separate view, with several
cards expandable at once.

- **Details** (`nodeCard.ts` `cornerButtons`, `GraphCanvas`): package and type cards with expandable children get a
  ⊞ corner button (left of `</>` on classes; hit-tested like quick code). It expands the card in place into
  a Cytoscape compound box of its children — a package's in-scope types, a type's methods/constructors —
  laid out from the card's top-left corner; ⊟ in the box's corner collapses it. Expansions nest (a class
  inside an expanded package expands into methods) and any number can be open. A route drawn across a box's collapse square does not take that tap.
- **Relationships** (`graphModel.projectDisplayed`): an endpoint resolves to its owner at the page's level,
  then down to the deepest visible card on its own ancestor chain inside expanded boxes. So a method inside
  an expanded class routes to the collapsed class or package it uses; routes between a card and its own
  container, and non-method self routes, are dropped. With no expansions the output (edge IDs included)
  is identical to before.
- **Resizing** (`GraphCanvas` grip, `nodeCard(node, size)`): every card and expanded box has a bottom-right
  grip. Cards reflow (wider lines, more member rows, lower lines dropped when short) and keep their
  top-left corner; boxes get a padding-free Cytoscape min-width/min-height growing right and down.
- **Make room** (`expansionLayout.roomShifts`, `App.makeRoom`): expand, collapse and a finished resize
  shift cards right of the old right edge by the width change and below the old bottom edge by the height
  change, cascading through enclosing boxes. A shifted card is also clamped against any sibling that did
  not shift on that axis but overlaps it on the other, so a collapse can never pull a moving card back
  across one that stayed put (review remediation F-01: the original per-card rule computed each card's
  shift independently and could not see that clash). This is a new geometry writer alongside drag and
  arrange; ordinary inspection/scope/filter/level actions still never move cards.
- **State** (`explorerViewState.ts`): per-level `expansions` (owner, child positions, box minimum) and
  `sizes`, kept across inspection and level switches, dropped with their card on scope removal; new
  `EXPAND_RESOURCE`, `COLLAPSE_RESOURCE`, `RESIZE_RESOURCE`, `RESIZE_CONTAINER` carry make-room moves
  atomically; `NODE_MOVED` takes a `containerId`; arrangement moves an expanded card as one box; new
  `NODES_MOVED` applies several cards' drag positions in one dispatch (review remediation F-05).
- **Reconciliation** (`GraphCanvas`): a card whose container changed is removed and re-added (Cytoscape's
  `move()` in a batch ignored the new position); all removals stay ahead of adds because Cytoscape removes
  by swap-with-last — adding first reordered survivors and failed 2 stable-graph acceptance checks.

Verification (exact commands, outcomes):
- `npx tsc -b --force` (frontend) — exit 0.
- `node scripts/test-explorer-view-state.mjs` (53, +2), `test-graph-model.mjs` (+expansion projection),
  `test-expansion-layout.mjs` (new), `test-node-card.mjs` (+resize/corner), `test-focused-arrangement.mjs`,
  `test-graph-placement.mjs` — all PASS.
- `node docs/evidence/card-expansion/browser-check.mjs <copy of microservice-java>` against an isolated
  backend, vite and headless Chromium — 29/29 (expand, two at once, nested, method routes, no overlaps
  after expand/nested/resize/collapse, grip resize of card and box, level round trip, container drag,
  collapse, class level, inspection inside a box, arrange around a box, no console errors). Screenshots
  inspected; four kept in `docs/evidence/card-expansion/`. After review: the route-tap rule was narrowed to
  an expanded box's collapse square (a route over an ordinary card corner inspects the route, as at HEAD —
  on the 75-class fixture Cytoscape never picks an edge inside a card corner, so that case could not be
  clicked), and the ⊞ button now follows a `detailCount` of expandable children (a class holding only
  nested types has none); re-run 29/29, pure suites PASS.
- Stable-graph acceptance (`verify_stable_graph_pipeline.py acceptance` pointed at a copy of the jar with
  this frontend, so the running jar was not overwritten): HEAD baseline PASS; first build FAIL 3 (survivor
  order, fixed above); final build FAIL 1 once (`inspect-edge-survives-filter-change` — the click
  inspected an adjacent DEPENDS_ON edge rather than the CALLS candidate, the known candidate-click
  flakiness), then PASS 34/34 twice; after the review fixes, PASS 34/34 again on the final frontend.
- Scope removal of a child inside an expanded card (found while a Codex review was probing; that review
  never completed — two runs killed for memory, the third hit the Codex usage limit): the child kept its
  stored slot, nested expansion and size, so on re-entry it could overlap a class added meanwhile.
  `SCOPE_UPDATED` now carries each expanded card's in-scope children and `pruneExpansions` drops the rest
  on every level. `test-explorer-view-state.mjs` 54 PASS, `tsc` exit 0.
- **Multi-agent review remediation (2026-09-15)**, executed against the review at
  `/home/sajjad/prompts/in-place-card-details-review.md` (12 findings: 3 P1, 6 P2, 3 P3). Every finding was
  re-verified against the real code before acting; the per-finding ledger (verdict, evidence, change,
  check) is `docs/evidence/card-expansion/remediation-plan.md`. 10 fixed (one, F-01, needed a second fix
  after the first cut broke the ordinary expand flow — see the ledger), 1 fixed narrower than claimed (F-02:
  the reported "box stretches" mechanism was wrong; the real defect was a stale stored anchor read only by
  late-child placement and make-room's own cascade), 1 not a defect (F-03: the review's own scenario
  requires a pre-existing overlap that the product does not allow to arise).
  - `roomShift` (single-card, independent per-axis threshold) replaced by `roomShifts` (batch, pairwise-
    clamped): a shifted sibling can no longer be pulled across a row/column-mate that did not shift on that
    axis (F-01), with a directional guard so an unrelated stationary sibling on the *far* side of a moving
    one is never mistaken for a wall in its path (found while wiring the first cut into `App.tsx`, which
    otherwise collapsed several genuinely-moving packages onto the same spot on an ordinary expand).
  - `GraphCanvas`'s drag reporting now includes an expanded card's own new anchor and every expanded
    descendant, not just its leaf ones, so a dragged container's nested expanded cards no longer go stale
    (F-02); a container drag or multi-card group drag now reports every moved card in one batched
    `NODES_MOVED` dispatch instead of one `NODE_MOVED` per card (F-05, fixed together with F-02 since both
    touch the same reporting path).
  - `detailCount` for a package now matches `childrenOf` exactly (nested types included, F-08) and respects
    scope when the caller has one to give (F-09), via one owner-package index built per projection instead
    of a per-card scan; `makeRoom` builds one container→children index per cascade instead of re-scanning
    per sibling per level (F-10) and stops the cascade once a container's own box stops changing (F-11).
  - The resize grip is a real, keyboard-focusable `<button>` (Arrow keys resize in 10px/40px steps, F-06);
    a resize cancels cleanly on `pointercancel` or `Escape` (reverting to the pre-drag state, no partial
    commit) and reads zoom live instead of once at pointerdown (F-07); the minimap's `setMini` now skips
    the state update when nothing actually changed, matching the overlay arrays' existing guard (F-04).
  - `node scripts/test-expansion-layout.mjs` (+2 assertion blocks), `test-graph-model.mjs` (+2),
    `test-explorer-view-state.mjs` (55, +1) — all PASS; `npx tsc -b --force` exit 0. Browser check (new F-01/F-02/F-07
    scenarios added, one check reordered) — first run, with the new scenarios already in place but before
    the fix: every pre-existing "no cards overlap ..." check FAILED (expand, two-at-once, nested,
    resize-card, resize-container, collapse, class-level — 9 distinct FAILs before the run crashed on an
    unrelated bug in the new F-01 setup, itself fixed separately), on the ordinary product flow with none
    of my new scenarios involved yet — confirming the bug reproduces outside the numeric repro; **35/35
    PASS** after the fix, repeated on three separate fixture copies. Stable-graph acceptance re-run once
    more on the final frontend (fresh jar copy, `build/libs/code-atlas-0.1.0-SNAPSHOT.jar` untouched):
    **PASS 34/34**.
- Not run: `./gradlew test` (no backend change), `verify_hierarchical_pipeline.py`.

Remaining limits:
- A box cannot be resized smaller than its children; live resize overlaps neighbors until release.
- Make room can leave gaps (e.g. cards in rows above a grown card also shift right); Arrange tidies.
- Expanding a large package shows all its in-scope types unbounded (no Show more inside a box).
- Box geometry is modeled without card border widths, so a collapse can land 2–4 model px off the box corner.
- `placeMissingChildren`'s "already placed" reference for an expanded sibling uses that sibling's collapsed
  card size, not its real (larger) box, so a genuinely late child of a container that also holds an
  expanded sibling can still land closer to that sibling's real box than intended (found while verifying
  F-02; pre-existing, not part of that review; see `docs/evidence/card-expansion/remediation-plan.md`).

## Review remediation — map usability and relationship coverage — complete

Executed on 2026-09-14 against the review `map-usability-and-relations-review.md` (32 findings). Every
finding was re-verified before acting; the per-finding ledger (verdict, how need was verified, change,
check) is `docs/evidence/map-usability-and-relations/remediation-plan.md`. 29 fixed, 2 fixed differently
(#5 `T::new` documented as type-targeted, #22 browser full screen owns Escape — comment corrected),
1 not a defect (#17: JLS 6.4.1 makes a name from two on-demand imports a compile error).

- **Analyzer** (`JavaParserAdapter`, `AnalysisService`): constructor/method key collision (`Type.<init>(..)`
  only on a clash); local classes no longer indexed; record compact constructors indexed and targeted
  (the symbol solver cannot resolve record constructors, so `new R(..)` uses the declared canonical
  constructor when its arity is unique); EXTENDS/IMPLEMENTS also yield DEPENDS_ON; no self CONSTRUCTS;
  static member-type imports; values vs type names (catch/pattern variables, earlier locals only,
  qualified chains, and a symbol-solver fallback that reported a same-named type for a variable of
  unresolvable type); one AST walk per file; lines split once; caches released after each run.
  **One transaction per file** in the declaration and relationship passes: a failed file leaves no
  partial rows, and `clients` analysis went 34 s -> 17 s on the same (heavily loaded) machine —
  thread sampling had shown 8/10 relationship-pass samples in SQLite autocommit inserts.
- **Source API** (`SourceService`, `SourceDialog`): relationship evidence is bounded by
  `codeatlas.explanations.evidence-occurrences` (12) with an additive `totalSites`; the dialog says
  "Showing the first N of M source sites". Live files are re-hashed once per response.
- **Map** (`GraphCanvas`, `App`, `nodeCard`, `App.css`, `InspectorPanel`): inspected edges keep both
  endpoints emphasized; map `</>` buttons take no pointer events — the canvas hit-tests the square, so
  drag/right-click/double-click/marquee on that corner act on the card while click and keyboard still
  open code; the menu names the class a method-card removal takes out of scope; filter changes no
  longer close the card menu; icon-only Fit/Full screen below 760 px; long inspector names wrap;
  Unicode/CJK-aware card text measurement and wrapping; small guards (#21, #28–#30).
- **Tests**: `RelationshipExtractionTest` and `LargeProjectBenchmarkTest` use a private temp database
  (analysis once per class); new `RelationshipEdgeCasesTest` (11 tests; the first 9 failed before the
  fixes, rollback/catch checks confirmed by mutation); new `scripts/test-node-card.mjs`.

Verification (exact commands, outcomes):
- `./gradlew test --offline` — BUILD SUCCESSFUL, 101 tests in 15 suites, 0 failures.
- `node scripts/test-explorer-view-state.mjs`, `test-focused-arrangement.mjs`, `test-graph-model.mjs`,
  `test-graph-placement.mjs`, `test-node-card.mjs` — all PASS. `npx tsc -b --force` exit 0.
- `./gradlew bootJar --offline` then `node docs/evidence/map-usability-and-relations/remediation/browser-check.mjs`
  — 16/16, before and after the tap guard below (report and 6 inspected screenshots in `remediation/`).
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS (its first run failed: a synthetic
  `node.emit('tap')` has no position and crashed the new hit test; guarded, rebuilt, re-run PASS).
- `python3 scripts/verify_stable_graph_pipeline.py acceptance` — 4 runs: PASS 34/34 (before the tap guard),
  then on the final jar FAIL 33/34 once (`click-edge: camera preserved` — pan moved (-346,-135) with no
  zoom, tap or layout call while the scenario tried candidate edge midpoints; consistent with a synthesized
  click landing on the minimap, which pans on click, since candidates are only checked to be inside the
  canvas; not proven), then PASS 34/34 twice.
- `clients` via the built jar (isolated data dir, 2 runs): 6,996 symbols, 33,670 relationships,
  20,721 / 20,720 resolved edges, no parsing diagnostics.

Remaining limits:
- Fields inherited from a supertype are not visible to the value-vs-type check (fields are not indexed).
- Five pre-existing `@SpringBootTest` classes outside this review (`ModelProfileApiIntegrationTest`,
  `WorkspaceApiIntegrationTest`, `ExplanationApiIntegrationTest`, `ContextBuilderTest`,
  `AnalysisServiceSpringIntegrationTest`) still use `./data/codeatlas.db`; a full `./gradlew test` still
  writes there.
- Real browser full screen cannot be entered headless, so #22 is verified by code review only.
- The second `clients` run on the same backend resolved one fewer CALLS edge than the first (20,721 vs
  20,720; every other kind identical). Not determined whether this predates this session.
- Timings are from a machine under heavy unrelated CPU load and vary run to run; the 2x is a same-session
  comparison, not a benchmark.

## Map usability, quick code, and relationship coverage — complete (reviewed; see remediation above)

Executed on 2026-09-14 as three user-requested steps, each planned, implemented and verified in turn.
Evidence: `docs/evidence/map-usability-and-relations/` (3 browser reports, 8 inspected screenshots,
before/after relationship summary for `test-fixtures/microservice-java`).

1. **Map readability and bulk actions** (`nodeCard.ts`, `GraphCanvas.tsx`, `App.tsx`, `App.css`).
   Card names are drawn at 30px (was 15px) with secondary text ~1.4x. Card widths stay 250/280px on
   purpose: placement packs six cards per row, so the fit zoom scales inversely with width — measured
   on-screen name size after the initial fit is exactly **2.0x** the previous commit on Packages,
   Classes and Methods of `microservice-java` (8-12 cards, where the fit is width-constrained). Cards
   are taller (class 128->206, method 104->184, package 148->250px), so pages with many rows become
   height-constrained and the on-screen gain there is smaller (estimated ~1.4x at 36 cards). Long names wrap to two lines at camelCase boundaries. The minimap now uses real
   card dimensions. New **Full screen** control (fixed overlay plus browser full screen on the document
   root, so modal dialogs stay on top; camera preserved; Esc or the button exits). **Right-click
   multi-selection**: right-click adds a card and opens a menu for the whole selection (remove N from
   scope, deselect, clear); a selection bar mirrors it; dragging any selected card moves the group and
   every moved position is persisted through `NODE_MOVED`; empty-canvas click or Esc clears. Bulk
   removal folds all cards into one scope edit (`removeFromScope(nodes[])`); the single-card path is the
   same function with one node. Multi-selection is a separate class, never Cytoscape's native `:selected`
   (which inspection emphasis owns), so left-click inspection keeps the selection.
2. **Quick code** (`components/CodeButton.tsx`, `InspectorPanel.tsx`, `GraphCanvas.tsx`). A `</>`
   button opens the existing source dialog, without changing inspection, from: every class listed under
   an inspected package, every method/constructor row of a class, related (called by / depends on)
   rows, the parent row, and every class/method card on the map. Map buttons are DOM buttons drawn
   over a corner the card SVG reserves, scaled with zoom, hidden when cards are too small, and updated
   once per animation frame (after remediation they take no pointer events; the canvas hit-tests them).
3. **Relationship coverage** (`JavaParserAdapter.java`). Previously only method-body calls (plus
   EXTENDS/IMPLEMENTS on classes) were extracted, so a package reached only through `new Dto(..)`,
   constructor bodies or signatures (the `dtos` package in `microservice-java`) had no connections. Now:
   explicit constructors are indexed as `CONSTRUCTOR` symbols; constructor bodies, field initializers
   and initializer blocks are scanned; `new T(..)`/`T::new` produce `CONSTRUCTS`; declared/used types
   produce `USES_TYPE`; method references produce `CALLS`; records/enums get `IMPLEMENTS`; one class-level
   `DEPENDS_ON` per pair summarizes all kinds. Type names resolve via the symbol solver, then
   deterministic Java lookup (enclosing types, single-type import, same package, unique on-demand
   import). Only indexed targets become edges; method targets are still never guessed (a Lombok getter
   call stays UNRESOLVED, its receiver's declared type still yields `DEPENDS_ON`). `microservice-java`
   package links: 3 -> 10 (controllers/services/domain -> dtos, services -> domain/exceptions,
   repositories -> domain, infra -> exceptions); resolved edges 13 -> 69.

4. **Marquee selection and one selection model** (`GraphCanvas.tsx`, `App.css`; follow-up request).
   Holding the right button and dragging draws a dashed band (built on Cytoscape's
   `cxttapstart`/`cxtdrag`/`cxttapend`; a right-drag never pans and never emits `cxttap`, so a plain
   right-click keeps its own handler). Cards the band touches are previewed while dragging, join the
   multi-selection on release (union, never removal), and the actions menu opens at the release point
   with the selection count. Esc cancels a drag in progress; an empty band does nothing.
   Ctrl/Cmd/Shift+click (toggle, without inspecting) and Ctrl/Cmd/Shift+left-drag box now feed the
   **same** selection, so remove-from-scope, clear and group move work on them too. Previously those
   gestures used Cytoscape's native selection, which had no actions and was reset by inspection.
   Native selection is now disabled (`autounselectify`); inspection emphasis moved from `:selected`
   to an `.inspected` class; native box selection uses `box-selection: overlap` so both box gestures
   select by intersection. Pressing on a DOM overlay (open menu, minimap) does not start a marquee; after
   remediation the `</>` corner is part of the card for every gesture except a plain click.

Verification (exact commands, outcomes):
- `node scripts/test-explorer-view-state.mjs`, `test-focused-arrangement.mjs`, `test-graph-model.mjs`,
  `test-graph-placement.mjs` — all PASS. `npx tsc -b --force` exit 0. `git diff --check` clean.
- `./gradlew test --offline` — BUILD SUCCESSFUL, 90 tests in 14 suites, 0 failures. New
  `RelationshipExtractionTest` (6 tests) run against the previous commit's code in a scratch worktree:
  **5 fail** there (the sixth is an invariant that is vacuous without the new kinds), all 6 pass now.
  `LargeProjectBenchmarkTest` expectations updated 770 -> 1005 relationships and 470 -> 705 graph
  edges: derived from the fixture (235 `new ClassN()` expressions, no declared constructors, each pair
  already had a `DEPENDS_ON`, no other type references), not copied from output.
- Browser checks via Chromium CDP against an isolated backend (scratch data dir) + Vite: step 1
  25/25, step 2 21/21, step 3 12/12, step 4 (marquee) 33/33 checks PASS; steps 1-2 re-run after step 4, with real mouse events for right-click, drag and
  map-button clicks.
- `./gradlew bootJar --offline` OK; `python3 scripts/verify_stable_graph_pipeline.py acceptance` PASS
  34/34; `baseline` PASS 34/34 on two runs; both modes and the hierarchical pipeline re-run PASS
  after step 4 (fresh `bootJar`) (a first baseline attempt exited after scenario 5 without
  writing a report — no application error besides the usual favicon 404; not reproduced on two
  reruns); `python3 scripts/verify_hierarchical_pipeline.py` PASS (includes graph right-click
  removal). The map-button stacking CSS fix landed after the jar build; steps 1-2 browser checks were
  re-run afterwards and PASS.
- Other fixtures analyzed with no relationship-parsing diagnostics: sample-project, spring-project,
  online-book-store, stable-graph-fixture, clients (6,996 symbols, 20,557 resolved edges).

Known limits and costs:
- Behaviour change (step 4): Ctrl/Cmd/Shift+click no longer inspects the card; it only toggles selection.
- Taller cards mean fewer cards per screen at the same zoom (see step 1).
- `./gradlew constrainedMemoryTest --offline` (256 MiB heap) PASS, `BoundedExplanationScaleTest` 1/1. It
  seeds synthetic CALLS rows rather than running the analyzer, so it proves the bounded explanation
  paths are unchanged, not that they stay within budget on the ~2x relationship rows real repositories
  now produce. With more USES_TYPE/CONSTRUCTS rows, relationship-ranked context and `relation_count`
  queue priority can shift toward type usage; not measured.
- Not run: `scripts/verify_explanation_pipeline.py` (calls a live external model and needs an API
  key); `scripts/verify_filtering_zoom_settings.py` (stale: asserts `graph-zoom-toolbar` and
  "Model & LLM Settings" in the bundle, neither of which exists in HEAD either; it also launches on the
  default port/data dir and overwrites the model profile). Both hardcode port 8085, which was occupied
  by a separately running user instance.
- Analysis was slower before remediation: `clients` 21.4s -> 27.0s (2 runs each, isolated backends),
  `large-project` benchmark ~0.56s -> ~1.07s on this machine (noisy); per-file transactions (remediation) halve it. Resolved edges roughly double on large repos,
  and unresolved CALLS grow (clients 11,470 -> 12,949) because constructor/initializer bodies are now
  scanned.
- The Classes/Packages maps can now draw several parallel kinds between one pair (e.g. calls, constructs,
  uses type, depends on); the relationship filter narrows this. No default-filter change was made.
- Constructors are not included in Explain all (`kind IN ('CLASS','METHOD')`), matching how
  interfaces/records/enums are already treated; single explanations still work for them.
- Not extracted: field reads/writes (no FIELD symbols), inherited member types, local-class and
  `var`-inferred type references, and `obj::method` receivers parsed as type expressions.
- Existing, unchanged: the Spring analyzer's single-constructor rule still labels plain entities'
  constructor parameters as `INJECTS` (e.g. `Event -> EventRequestDTO`).
- Projects analyzed before this change must be re-analyzed to get the new relationships.


## Previous revision: Step 5 review remediation — complete

Executed on 2026-09-11, after Step 5. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md#step-5-review-remediation-2026-09-11).
This is a fix-up pass to already-completed Steps 3-5 work (from a review at
`/home/sajjad/prompts/step-3-4-5-review-resolve-plan.md`), not a new numbered plan step — Step 6A's
plan and prerequisites are unchanged.

Fixed: (A1) `HistoryEntry` was stamped with the level active *at push time* instead of the level a
subject was actually inspected under, so Back could strand a user on the wrong level after a
cross-level inspection persisted across a segmented-control switch; (A2) two `localeCompare` sorts
(`graphPlacement.ts`, `focusedArrangement.ts`) were locale-dependent rather than using a fixed ordinal
comparator; (A3) `GraphCanvas.tsx`'s camera effect never re-fit a level whose node count went 0 -> >0
while `camera` itself stayed the same `null` reference (added a `com.example.stable.marker.RegionTag`
fixture class — field-only, no methods — to reach this state empirically, since every other
package/class in the existing fixture has at least one method); (B1) an explicit level change
starting from a completely uninspected state pushed no history entry, leaving Back permanently
disabled after the first such navigation (fixed with a level-only breadcrumb, pushed from the
reducer); (B2) an inspected aggregate edge dangled silently across a level switch instead of being
cleared or recoverable (fixed: cleared via the same path B1 added, so one Back now recovers it).
Category C findings (`HistoryEntry` omitting a camera/filter snapshot, the missing "Show added" pan
affordance, the breadcrumb's Map-tab no-op) were reviewed and left untouched — each is backed by
existing ledger text, a passing test asserting the opposite of the proposed "fix," or a genuine
product-intent question rather than a code defect.

Verification: `node scripts/test-explorer-view-state.mjs` PASS (51 checks, 8 new);
`node scripts/test-graph-placement.mjs` PASS (9 checks, 1 new); `node scripts/test-focused-arrangement.mjs`
PASS (12 checks, 1 new); `node scripts/test-graph-model.mjs` PASS (7 suites, unchanged); `npx tsc -b
--force` exit 0; `npm run build` PASS; `./gradlew bootJar --no-daemon` BUILD SUCCESSFUL; `python3
scripts/verify_stable_graph_pipeline.py baseline` PASS (**34/34**, 2 new scenarios); `acceptance`
**PASS (34/34, 0 unmet)** — up from 32/32 after Step 5, the 2 new scenarios pass outright, not a
regression; `python3 scripts/verify_hierarchical_pipeline.py` PASS (required: `GraphCanvas.tsx` and
`App.tsx`'s navigation call sites both changed). `git diff --check` clean. `./gradlew test` skipped —
no backend source changed. Evidence: `docs/evidence/stable-graph-step5-remediation/` (2 reports + 2
inspected screenshots).

Known, accepted side effect: `NAVIGATE_LEVEL`'s new history breadcrumb fires for every dispatch site,
not just the two call sites this fix targeted — a snapshot opened via a direct `?snapshotId=...` link
that lands on Classes/Methods now starts with one history entry and an enabled Back before the user
does anything. No existing scenario asserts Back's disabled state on fresh load, so nothing regressed,
but it is a user-visible first-paint difference worth knowing about.

## Previous acceptance slice: stable graph interactions — Step 5 of 10 complete

Executed on 2026-09-11. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md#step-5--move-focused-arrangement-to-double-click).
Acceptance criterion: double-click deliberately arranges the current map around a resource; single-click never arranges it.

Delivered:

- `frontend/src/features/explorer/focusedArrangement.ts` (renamed from `graphLayout.ts`, which Step
  3 reserved for exactly this reuse) — the Appendix B algorithm, rewritten to use actual card
  rectangles and gaps (incoming-left / focus-middle / outgoing-right / unrelated-below; the
  unrelated group reuses `graphPlacement.placeAdditions()` rather than a second row-packing
  implementation) instead of the old uniform point spacing. The old unfocused whole-map grid branch
  was dropped — out of scope for this step. Pure, independently tested:
  `scripts/test-focused-arrangement.mjs` (11 checks — chain, bidirectional neighbor, self-loop,
  isolated resource, reciprocal pair, mixed card heights, package/class/method dimensions,
  deterministic ties, anchor translation, focus-not-displayed).
- `explorerViewState.ts`: new `ARRANGE_AROUND_RESOURCE` action — one atomic dispatch that overwrites
  exactly the given IDs' positions for a level and bumps `geometryRevision` once (not once per
  card), guarded by the existing `generation` staleness check (matching `SET_CAMERA`/`NODE_MOVED`).
  2 new pure reducer tests (43 total).
- `GraphCanvas.tsx`: added a `dbltap` node handler (Cytoscape's own double-tap gesture recognition)
  wired to a new `onArrangeAroundResource` prop; the reconciliation effect now also repositions an
  *already-displayed* survivor when its stored position differs from the live Cytoscape position
  (previously only a brand-new `cy.add()` element ever got a position written). This is the one new
  case where an admitted card's position is deliberately overwritten in bulk — distinct from a drag
  (already reflected live, so no diff) or ordinary admission (new cards only, survivors untouched).
  Emits a custom `'arranged'` Cytoscape event (ordinary use of the library's own pub/sub, the same
  mechanism `'dbltap'`/`'pan'`/`'zoom'` already use) once per batch that actually repositioned
  something, letting the browser harness observe "exactly one arrangement" independently of taps.
- `App.tsx`: new `arrangeAround(id)` computes the arrangement from the current displayed page
  (`projected.nodes`/`projected.edges`, never the full graph) and current filter, anchored at the
  resource's existing stored position, and dispatches `ARRANGE_AROUND_RESOURCE`; wired to both
  `GraphCanvas`'s `onArrangeAroundResource` and `InspectorPanel`'s new action.
- `InspectorPanel.tsx`: new "Arrange around this resource" button (keyboard/touch-accessible, H3),
  rendered for any inspected node kind; disabled with a "Resource is not in current map view"
  tooltip whenever `mapStatus !== 'DISPLAYED'`.

Browser evidence: `python3 scripts/verify_stable_graph_pipeline.py acceptance` — **0 unmet
assertions**, the first fully green acceptance run since Step 1 (32/32 scenarios; down from 3 unmet
in the same 3 real-double-click scenarios after Step 4). Those three now assert `arrangeCalls === 1`
(a dedicated counter fed by the `'arranged'` event; the old `layoutCalls === 1` assertion was
retired — nothing in the codebase calls `cy.layout()` anymore, so it could never have been
satisfied). New/changed scenarios: the three real-double-click cases each show exactly one
arrangement, a screen-anchored focus (rendered position unchanged within 1px), and unchanged
level/page (before/after screenshots added for both); a new
`real-double-click-second-different-card` proves a second double-click on a *different* card also
arranges exactly once (a repeat double-click on the *same*, already-arranged, unmoved focus is
deliberately not asserted to move anything — the algorithm is deterministic and anchored to that
focus's own unchanged position, so re-running it correctly recomputes an identical layout);
`two-spaced-single-clicks` now also asserts `arrangeCalls === 0`; two new scenarios cover the
inspector action end-to-end on desktop (`inspector-arrange-around-resource`: one arrangement, no
`dbltap` involved, scope/level/page/zoom/pan all unchanged; `inspector-arrange-disabled-when-not-
displayed`: the button is disabled with the correct tooltip when the inspected subject is in scope
but not on the current page). Two more verify Step 5 point 5's narrow-layout requirement
concretely: on this app's mobile layout a single tap already switches the pane to Details (hiding
the canvas via `display:none`), so a recorded observation confirms a real double-click's second
press does not reach the canvas there at all (`dbltaps: 0`) — the actual reason the keyboard/touch
equivalent exists — while `narrow-inspector-arrange-from-details-pane` proves that equivalent works:
activating the button from that same Details pane still drives exactly one arrangement, and
returning to the Map pane shows the already-applied geometry with the camera untouched. `baseline`
mode (32/32) retired the three "no arrangement exists yet" assertions the same way prior steps
retired fixed defects. A regression surfaced and fixed during this step's verification: Step 4
relabeled the inspector's "See method call graph ↗" button to "View methods ↗" but did not re-run
`verify_hierarchical_pipeline.py` (its own ledger recorded that skip as justified at the time); that
harness's `scopeUnchanged('inspector exploration...')` scenario still searched for the old label
text and crashed on `undefined.click()`. Fixed the stale selector in
`scripts/verify-hierarchical-ui.mjs`; re-ran and confirmed **PASS**. Evidence:
`docs/evidence/stable-graph-step5/` (2 full reports + 8 screenshots — before/after pairs for both
real-double-click scenarios and the inspector action, showing incoming-left/focus-middle/outgoing-
right/unrelated-below with the focus card anchored; plus the narrow Details-pane action and its
arranged Map-pane result); full runs in `build/stable-graph/{baseline,acceptance}-*/` and
`build/hierarchy-smoke/` (git-ignored).

Verification: `node scripts/test-graph-model.mjs` PASS (7 suites, unchanged);
`node scripts/test-explorer-view-state.mjs` PASS (43 checks, 2 new); `node scripts/test-graph-placement.mjs`
PASS (8 checks, unchanged); `node scripts/test-focused-arrangement.mjs` PASS (11 new checks); `npx tsc
-b --force` exit 0; `npm run build` PASS; `./gradlew bootJar --no-daemon` BUILD SUCCESSFUL; `python3
scripts/verify_stable_graph_pipeline.py baseline` PASS (32/32); `acceptance` **PASS (32/32, 0
unmet)**; `python3 scripts/verify_hierarchical_pipeline.py` PASS (after the stale-selector fix
above). `git diff --check` clean. `./gradlew test` skipped — no backend source changed.

Remaining known limitations: whole-map optimization (`Reorder map`) does not exist yet — Steps 6–9.
Focused arrangement is instant (no animation), matching the step's "instant placement is acceptable
initially" allowance; there is no motion for reduced-motion to disable yet. A repeat double-click on
the *same*, already-arranged focus is untested for the "exactly one arrangement" count specifically
because it correctly produces zero movement (deterministic, anchored) — covered instead by a second
click on a *different* card. `HistoryEntry.geometryRevision` remains inert, as recorded in Step 4.

Remaining work: Steps 6–10. Next is Step 6A — define the pure geometry/scoring contract for
whole-map layout (Appendix C1/C2/C7, D5), without the router or optimizer yet.

## Previous acceptance slice: stable graph interactions — Step 4 of 10 complete

Executed on 2026-09-11. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md#step-4--make-class-traversal-and-return-navigation-predictable).
Acceptance criterion: developers can follow classes and return without losing the map they assembled.

Delivered:

- `explorerViewState.ts` extended (not replaced): `HistoryEntry` gained `geometryRevision` (the
  level's revision at push time, kept only so a transition test can assert Back's precedence
  explicitly — Back itself always reads a level's *current* live geometry, never a snapshot, so it
  already retains the latest revision by construction). `SCOPE_UPDATED` gained an optional
  `otherLevels` map (Appendix F3): a new `shadowTrimLevel()` helper drops now-ineligible IDs from a
  level the user is **not** currently viewing and forgets them from its `priorEligibleIds`,
  immediately (not deferred to the next visit) — the only way to tell "removed then re-added" apart
  from "never left" once that level is finally revisited. It never routes through
  `reconcileLevelView` (which would overwrite `priorEligibleIds` with the full eligible set and
  erase that distinction) and never admits anything itself. 7 new pure reducer tests cover both
  remove/re-add and explicit-add-while-away, in every active/inactive ordering, plus the
  geometry-revision precedence case and the "Back must not silently consume a pending admission"
  case. All 34 existing Step 2/3 checks pass unmodified (41 total).
- `App.tsx`: `explore()` split into two named commands, `viewClasses()`/`viewMethods()` (Story 6/H3);
  canvas double-click no longer calls either (Step 4 point 1 — arrangement is Step 5's job).
  `openCodeMap()` no longer forces a reset to Packages or clears inspection — it is now just a tab
  switch, since persisted view state already **is** "the last map view" (Story 6). The Classes/
  Methods/Packages segmented control no longer clears inspection on a genuine switch. `handleScopeChange()`
  now computes and forwards `otherLevels` (via `getEligibleIds`, not the ranked variant — only
  set-membership is needed). An inspected aggregate edge is now resolved against a second,
  always-`'ALL'`-kind projection when the active relationship filter excludes it, so a filter change
  can no longer collapse the inspector to idle; a new `edgeFilteredOut` flag drives a "Not shown with
  the current relationship filter." notice instead.
- `GraphCanvas.tsx`: the `dbltap`/`onExplore` wiring is removed entirely — a node double-click is
  now a genuine no-op pending Step 5's dedicated arrangement command.
- `NavigationPane.tsx`/`InspectorPanel.tsx`: `onExplore` replaced by `onViewClasses`/`onViewMethods`
  at every call site (tree ⌖ buttons, and the inspector's "View classes"/"View methods" buttons,
  relabeled from "Explore classes"/"See method call graph" to match Story 6/H3's named-command
  wording); `InspectorPanel`
  gained the `edgeFilteredOut` notice alongside the existing `mapStatus` ones.

Browser evidence: `python3 scripts/verify_stable_graph_pipeline.py acceptance` unmet assertions
dropped from 7 (3 scenarios, Step 3) to **3** (the same 3 real-double-click scenarios) — every other
scenario, including 9 new ones added for this step (A→B→C→Back→Back through the real inspector,
Classes→Methods→Classes preserving subject and geometry, out-of-scope inspection, a scope
remove/re-add while Classes is inactive, an edge surviving a filter change, narrow-pane
inspect/return, and Code map returning to the last view), now passes. The 3 remaining failures are
explicitly "exactly one arrangement" — Step 5's territory; Step 3 already removed every `cy.layout()`
call, so satisfying this will require Step 5 to *add* a call, not fix a leftover one. `baseline` mode
(27/27) retired the three "drills down to Methods" assertions this step deliberately removed
(double-click is now a no-op, not a broken drill-down) and replaced each with its now-true
statement; every other baseline scenario, including all 9 new ones (which have no separate "broken"
baseline to describe, so baseline and acceptance share the same checks — matching the existing
pattern for `manual-drag-persists` and `inspect-unresolved-relationship`), passes outright. Evidence:
`docs/evidence/stable-graph-step4/` (2 full reports + 9 screenshots); full runs in
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored).

Verification: `node scripts/test-graph-model.mjs` PASS (7 suites, unchanged);
`node scripts/test-explorer-view-state.mjs` PASS (41 checks, 7 new); `node scripts/test-graph-placement.mjs`
PASS (8 checks, unchanged); `npx tsc -b --force` exit 0; `npm run build` PASS; `./gradlew bootJar
--no-daemon` BUILD SUCCESSFUL; `python3 scripts/verify_stable_graph_pipeline.py baseline` PASS
(27/27); `acceptance` FAIL as intended (3 unmet, down from 7). `git diff --check` clean. `./gradlew
test` skipped — no backend source changed. Explanation harnesses not re-run this step — no
explanation code path touched (only `App.tsx`'s navigation/edge-lookup call sites, which keep the
same `InspectorPanel` contract Step 3 already re-verified against `verify_hierarchical_pipeline.py`).

Remaining known limitations: canvas double-click and the inspector's "Arrange around this resource"
equivalent do not exist yet (Step 5). `HistoryEntry.geometryRevision` is recorded and tested but has
no other production reader — Back's actual precedence comes from always reading live per-level
state, not from comparing this number. The relationship filter itself remains one global selection
(not per-level); this was not extended, since Story 6/F3 only requires the *current* filter to
survive navigation, which it already did structurally (it is untouched by any reducer dispatch).

Remaining work: Steps 5–10. Next is Step 5 — move the existing selected-resource focused-layout
behavior to a dedicated double-click `ARRANGE_AROUND_RESOURCE` command with a keyboard/touch
equivalent (Appendix B), which is what will finally satisfy the 3 remaining acceptance failures.

## Previous acceptance slice: stable graph interactions — Step 3 of 10 complete

Executed on 2026-09-10. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md#step-3--preserve-the-canvas-and-append-resources-without-moving-survivors).
Acceptance criterion: non-arrangement interactions preserve surviving node positions, pan, and zoom.

Delivered:

- `frontend/src/features/explorer/graphPlacement.ts` (new) — pure Appendix A3 placement:
  `placeAdditions()` packs a newly admitted batch in spaced rows below the survivors' actual
  bounding box, using a strip width (room for 6 typical cards, a deliberate deviation from the
  appendix's literal "3" to avoid an implausibly tall page — recorded in the ledger) decided once
  per level and reused forever after.
- `explorerViewState.ts` extended (not replaced): `LevelViewState` gained `positions`/`camera`/
  `geometryRevision`/`cameraRevision`/`geometryInitialized`/`appendWidth`; root state gained
  `generation`. Membership actions gained an optional `placement` field (actual card dimensions per
  eligible ID) so a newly admitted batch gets positioned in the *same* dispatch that admits it — no
  separate `render → effect → reducer` round trip. Two new actions, `SET_CAMERA` and `NODE_MOVED`.
  All 21 existing Step 2 reducer checks pass unmodified.
- `GraphCanvas.tsx` rewritten: one Cytoscape core created on mount and never destroyed on a
  membership/filter/selection/resize change (previously recreated on every topology change).
  Elements are reconciled by stable ID in one batch; `cy.layout()` is never called anywhere in the
  file; `cy.fit()` fires only once per level (its first-ever visit) or via the explicit Fit map
  button. New `.neighbor`/`.incident` classes give selected-resource emphasis without moving or
  resizing any card. Real user camera movement is captured, debounced, and persisted; a saved
  camera is restored (not re-fit) when returning to an already-visited level.
- `App.tsx` wired: a `placementFor()` helper supplies actual card dimensions on every membership
  dispatch; `positions`/`camera` are read from the active level's view state and handed to the
  canvas; manual drags and camera settles are dispatched back into the reducer. A genuine
  "N added below" chip (`viewState.newlyAddedIds`) now appears in the scope banner next to the
  existing scope-count banner.

Browser evidence: `python3 scripts/verify_stable_graph_pipeline.py acceptance` unmet assertions
dropped from 26 (10 scenarios, Step 2) to 7 (3 scenarios) — the 3 remaining are exclusively the
real-double-click scenarios, explicitly owned by Step 5 (the gesture now reaches its target
reliably, but is still wired to `explore()`'s level change rather than a dedicated arrangement
command). Every position/camera/canvas-identity assertion across the other 15 scenarios now passes,
including two new real-pointer manual-drag scenarios (drag persists, and survives a level switch
away and back). `baseline` mode retired every assertion Step 3 fixed (layout/fit calls, camera
discard, canvas recreation, survivor movement on non-arrangement interactions) across 9 scenarios,
replacing each with the corresponding now-true statement, and re-verified PASS (18/18 scenarios).
Fixing this also surfaced and fixed an off-screen-click-target issue in the test harness itself (not
an application defect) — see the ledger for detail. A self-review pass additionally caught and fixed
a stale minimap after a membership change (now updated at the end of every reconciliation batch) and
confirmed via `verify_hierarchical_pipeline.py` (PASS) that the `GraphCanvas.tsx` rewrite did not
regress `cxttap` remove-from-scope, READY styling, or explanation-refresh camera stability. Evidence:
`docs/evidence/stable-graph-step3/` (2 full reports + 7 screenshots); full runs in
`build/stable-graph/{baseline,acceptance}-*/` and `build/hierarchy-smoke/` (git-ignored).

Verification: `node scripts/test-graph-model.mjs` PASS (7 suites, unchanged);
`node scripts/test-explorer-view-state.mjs` PASS (34 checks, 13 new); `node scripts/test-graph-placement.mjs`
PASS (8 new checks); `npx tsc -b --force` exit 0; `npm run build` PASS; `./gradlew bootJar --no-daemon`
BUILD SUCCESSFUL; `python3 scripts/verify_stable_graph_pipeline.py baseline` PASS (18/18);
`acceptance` FAIL as intended (7 unmet, down from 26); `python3 scripts/verify_hierarchical_pipeline.py`
PASS. `git diff --check` clean. `./gradlew test` skipped — no backend source changed.

Remaining work: Steps 4–10. Next is Step 4 — predictable class traversal and restorative Back
navigation (named View methods/View classes/Back commands; F3 history precedence rules; Code map
returns to the last map view).

## Implementation-plan review — documentation only

Reviewed `/home/sajjad/prompts/steps.md` against the current reducer, graph projection,
fixture, and Step 1/2 handoff evidence. Step 1 and Step 2 instructions remain
byte-for-byte unchanged; application source and scripts were not edited in this review.
Continue at Step 3. Milestones 6–9 now have separate A/B sessions, giving 12 remaining
sessions with focused reading, implementation boundaries, and exit gates. Updated
state-extension guidance preserves the implemented `priorEligibleIds` contract;
algorithm details distinguish candidate scoring from actual renderer verification.

Verification: document structure/content checks and SHA-256 comparison of protected
steps/source files — PASS; `git diff --check` — PASS. Runtime tests, builds, and
screenshots skipped for this documentation-only review. Existing implementation
results below retain their original evidence and limitations.

## Previous acceptance slice: stable graph interactions — Step 2 of 10 complete

Executed on 2026-09-10. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md#step-2--separate-inspection-from-displayed-page-membership).
Acceptance criterion: inspecting a class or edge cannot change scope, abstraction level, or the
set/count of displayed resources.

Delivered:

- `frontend/src/features/explorer/explorerViewState.ts` (new) — a pure reducer that owns
  inspection, active level, and per-level displayed-page membership as one state machine
  (Appendix A/F). Inspection actions never touch membership; scope/level actions reconcile
  survivors by ID and append only genuinely new eligibility, bounded to a batch of 12 (or the
  explicit single class being checked). Positions/camera are deliberately not tracked yet — Step 3.
- `graphModel.ts` refactored (not duplicated): `getEligibleIds`/`rankEligibleIds`/`projectDisplayed`
  are new reusable primitives; `projectGraph` is rebuilt on top of them with its exact prior
  external contract (verified unchanged against the existing test suite).
- `App.tsx` rewired onto the reducer: `select()`/edge inspection are pure dispatches with no
  level/limit side effect; scope edits, Show more, level switches, and Back each dispatch one
  explicit membership/navigation action. A new inspector notice distinguishes an out-of-scope
  inspected subject from one that is in scope but simply not on the current page.
- `scripts/test-explorer-view-state.mjs` (new) — 17 pure reducer tests, including the exact Step 1
  regression (reveal 36 via two Show-mores, inspect one, still the same 36 IDs in the same order).

**No canvas/position changes.** `GraphCanvas.tsx`, `graphLayout.ts`, and `nodeCard.ts` are
untouched; cards and camera still move on every interaction (Step 3's job) — but node **membership**
is now provably stable, in both pure tests and the real packaged browser.

Browser evidence: `python3 scripts/verify_stable_graph_pipeline.py acceptance` unmet assertions
dropped from 34 (13 scenarios, Step 1) to 26 (10 scenarios) — every remaining failure is
position/camera/canvas-identity (Step 3) or double-click gesture reachability (Step 5); zero
membership/level/scope assertions remain unmet. `baseline` mode retired 8 assertions across 4
scenarios that Step 2 fixed (page no longer collapses 36→12; a package addition no longer evicts
displayed classes via degree re-ranking; a package removal no longer refills holes from the hidden
queue) and re-verified PASS with the corresponding now-true statements. Evidence:
`docs/evidence/stable-graph-step2/` (2 full reports + 3 screenshots); full runs in
`build/stable-graph/{baseline,acceptance}-*/` (git-ignored).

Verification: `node scripts/test-graph-model.mjs` PASS (7 suites, unchanged);
`node scripts/test-explorer-view-state.mjs` PASS (17 checks); `npx tsc -b --force` exit 0;
`npm run build` PASS; `./gradlew bootJar --no-daemon` BUILD SUCCESSFUL (rebuilt to bundle the new
frontend before the browser run); `python3 scripts/verify_stable_graph_pipeline.py baseline` PASS;
`acceptance` FAIL as intended (26 unmet, down from 34). `git diff --check` clean. `./gradlew test`
skipped — no backend source changed. Explanation harnesses skipped — no explanation code path
touched.

Remaining work: Steps 3–10 of the plan. Next is Step 3 — preserve the canvas and append resources
without moving survivors (incremental Cytoscape reconciliation, camera stability, A3 coordinate
placement for newly admitted IDs).

## Previous acceptance slice: stable graph interactions — Step 1 of 10 complete (baseline only)

Executed on 2026-09-10. Ledger: [docs/STABLE_GRAPH_IMPLEMENTATION.md](docs/STABLE_GRAPH_IMPLEMENTATION.md).
Plan: `/home/sajjad/prompts/steps.md`. Specification: `/home/sajjad/prompts/product-design.md`.
`docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` was read in its place.

**No application behaviour changed.** `git diff -- frontend src` is empty. Step 1 only captures
evidence and adds a reusable browser fixture, so every stable-map story below remains unimplemented.

Delivered:

- `test-fixtures/stable-graph-fixture/` — 74 types (72 CLASS + 2 INTERFACE) across 6 packages, with a
  visible A→B→C chain, a reciprocal pair, a three-node cycle, 21 disconnected types, parallel
  relationship kinds and 4 drawn `CANDIDATE` edges. The existing 17-class fixture cannot reach the
  36→12 case. Verified topology and parser limits: `test-fixtures/stable-graph-fixture/README.md`.
- `scripts/verify_stable_graph_pipeline.py` + `scripts/verify-stable-graph-ui.mjs` — an isolated
  Chromium/CDP runner with two explicit modes. `baseline` records today's behaviour and passes;
  `acceptance` asserts the product contract and fails today by design. All gestures are real pointer
  input; instrumentation is installed test-side onto Cytoscape's own registry, so the application
  ships no debug object.

Reproduced with browser evidence (15 scenarios, 12 screenshots, `build/stable-graph/baseline-*/`):
clicking a class at 36 displayed collapses the page to 12 and destroys the canvas; clicking a class
at 12, clicking a package and clicking an edge each run an arrangement and refit the camera; an edge
click falls back to the alphabetical grid because an aggregate edge ID is not a node ID; a
relationship-filter change destroys and recreates the canvas and loses the user's camera; adding one
package evicted 23 of 36 displayed classes through degree re-ranking and removing it refilled the
holes; closing the inspector re-runs the unfocused arrangement; a viewport resize refits the camera;
and a real double-click never reaches a card — a control double-click on empty canvas proves the
gesture synthesis works, while on a card the first tap either moves it 334 px away or destroys the
canvas outright.

Classified as not reproduced, with inspected causes: explanation-refresh reordering (the canvas
`topology` key excludes `explanationStatus`; the data effect is a `cy.batch()` with no layout) and
inspector open/close resizing the canvas (the pane stays mounted; the observed disturbance comes from
clearing `selectedId` instead).

Verification: `node scripts/test-graph-model.mjs` PASS; `npx tsc -b --force` exit 0; `npm run build`
PASS; `python3 scripts/verify_stable_graph_pipeline.py baseline` PASS; `acceptance` FAIL as intended
(34 contract assertions unmet). `./gradlew test bootJar` skipped — no backend source changed and the
existing jar was reused. No lint claim: this repository has no lint tooling configured. No model was
contacted; the runner points the provider at a closed port, so this is not a live-model verification.

Remaining work: Steps 2–10 of the plan. Next is Step 2 — separate inspection from displayed-page
membership.

## Superseded proposal record: stable graph interactions — design only

Prepared on 2026-09-10: [product design and acceptance stories](docs/STABLE_GRAPH_INTERACTIONS.md).
The expanded user-requested deliverable is `/home/sajjad/prompts/product-design.md`:
six stories, explicit design decisions, class-to-class traversal/Back behavior, and
a complete acceptance journey. The file was read back and checked for coverage;
it is a design proposal, with runtime verification deferred to implementation.
The implementation handoff is `/home/sajjad/prompts/steps.md`: ten sequential
Claude-session prompts with exit gates and detailed state, layout, routing,
worker-lifecycle, and acceptance-test specifications. This is documentation only;
the implementation steps have not been executed.
The bounded criterion is that inspection and incremental scope changes preserve
existing positions, viewport, and the expanded page. The proposal defines only two
automatic arrangement commands: double-click/Arrange around this resource and
Reorder map using the currently displayed, filtered relationships.

Code inspection identified selection-triggered layout/fit, topology-triggered canvas
recreation, resize-triggered fitting, and `select()` resetting non-package display
limits to 12. Degree-ranked page slicing can also displace existing classes on scope
addition. These are inspected causes, not a new browser reproduction or implemented fixes.

Verification: `git diff --check` — PASS; local Markdown target check for the new
proposal — PASS. Runtime tests, builds, and screenshot inspection skipped because
this change only records the requested product design; no application UI changed.
Remaining work: implement and verify the five stories. Existing completed work below
retains its original status; stable-map behavior is not yet verified.

## Previous acceptance slice: hierarchical graph scope and explicit canvas deselection — complete

Implemented on 2026-09-10, frontend-only:
- The navigation pane now preserves the complete flex-height chain: `.scope-tree` is a shrinking flex column, its toolbar is fixed, and `.package-tree` is the sole `flex: 1; min-height: 0; overflow: auto` region. Large trees scroll inside the pane while recent symbols and workspace controls remain visible. Shared single-child namespace paths start open, branch points start collapsed, and selecting/searching a symbol reveals its owning package path.
- `scopeModel.ts` builds a display-only trie from flat dotted PACKAGE facts. Synthetic namespaces never become graph symbols. Their checkbox state aggregates the existing real-package check states, and their batch toggle selects or removes every real descendant package. A selection that covers the whole graph normalizes to `ALL`; leaf package and class behavior remains unchanged.
- Scope changes during an open snapshot are explicitly limited to the tree controls, scope-labelled reset/select-all controls, and canvas removal. Search results, node/edge inspection, graph double-click, package/class inspector exploration, route cards, the brand, breadcrumbs, and Code map navigation preserve scope. `explore()` changes only the inspected subject and useful graph level; loading a different snapshot still initializes a valid whole-system scope.
- Cytoscape `cxttap` on an in-scope package, class, method or constructor opens a focused, keyboard-visible “Remove from scope” menu. Package/class removal uses `togglePackage`/`toggleClass`; method/constructor removal resolves the enclosing class through `ownerAt('CLASS', …)` and uses `toggleClass`. Native graph context menus are suppressed, and Escape, outside click, graph navigation, or topology changes dismiss the menu.
- The packaged browser fixture is created as a temporary read-only copy with 36 extra dotted package branches. No backend or persisted graph schema changed; parser PACKAGE facts remain flat and authoritative.

Verification:
- `node scripts/test-graph-model.mjs` — PASS, including dotted package-trie construction, nested ordering, synthetic aggregate checked/indeterminate/unchecked states, multi-package immutable toggles, whole-system normalization, existing scope projection, and polling checks.
- `npx tsc -b --force` (from `frontend/`) — 0 errors.
- `npm run build` (from `frontend/`) — successful production build; 44 modules transformed. The existing >500 kB bundle advisory remains.
- `./gradlew test bootJar` — BUILD SUCCESSFUL; **84 tests, 0 failures/errors/skips**, and the executable jar contains the rebuilt frontend.
- `node --check scripts/verify-hierarchical-ui.mjs`, `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, and `git diff --check` — successful.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS against the packaged jar, isolated SQLite, temporary 41-package/17-class source fixture, local mock provider, and headless Chromium. Raw CDP verified compact initial expansion, selected-package reveal, internal tree overflow/scrolling after expansion, `com > example > overflow > area00` nesting, namespace checked/indeterminate transitions, scope stability across every reported non-scope action, native context-menu prevention, Escape/outside dismissal, and real right-button removal of package/class/method nodes. Existing explanation acceptance also passed for 61 CLASS/METHOD subjects in exact SQL order, SQLite integrity, and unchanged source hashes. This is mock-provider verification, not live-provider verification.
- Captured 12 screenshots in `build/hierarchy-smoke/run-s7okddha/`. Visually inspected `scope-tree-desktop.png`, `scope-context-menu.png`, and `narrow-scope-tree.png` at 1500×980 / 430×900: hierarchy indentation and check states are legible, branch points are compact until opened, the selected package path is revealed, the scrollbar stays within the expanded tree, fixed navigation/footer controls remain accessible, the focused context action is unobscured, and there is no horizontal page overflow.

Remaining limits:
- Package hierarchy is a visual projection of dotted names. It does not invent parent PACKAGE symbols or graph relationships, and modules that deliberately reuse an identical package name remain represented by the backend's existing package identity behavior.
- Physical mouse right-clicks and the shared Cytoscape `cxttap` path were verified. A physical touch long-press was not separately emulated. No live-provider quality, latency, or tokenizer claim was made.
- `docs/BUILD_BRIEF.md` remains absent; `docs/BUILD.md` is the available build brief and was read. Unrelated untracked `.agents/`, `.claude/`, root `package.json`, `skills-lock.json`, and prior user files remain untouched.

No ADR was needed: this completes the existing frontend scope boundary without changing backend facts, schemas, dependencies, or infrastructure. The previous explicit-scope entry below is historical and superseded where it described Focus actions as scope mutations.

## Previous acceptance slice: repository-size-independent explanation memory — complete

Implemented on 2026-09-10:
- `ArchitectureBatchProcessor` pipeline 3.0 no longer accepts or returns repository-sized DTOs. Packages/types use `(qualified_name,id)` keysets; relationships/package coupling use `id` keysets with ancestry resolved only for the current page; documents use `id` plus bounded character ranges; checkpoint reductions use fixed fan-in; and classes use ID-keyset batches capped at 16. Every validated slice summary and class purpose is written transactionally to SQLite before the next batch. Downstream reduction and final publication page persisted artifacts; no complete inventory String or all-class purpose Map is reconstructed.
- Architecture run/checkpoint identity is scoped to immutable snapshot facts, document revisions, endpoint/model, prompt/pipeline versions, token/body budgets, and relevant batch settings. A failed bounded request receives at most three capped-backoff attempts. Size failures split only the current bounded input. Cancellation is checked inside checkpoint/publication transactions; incomplete staging never becomes a visible DRAFT/READY synthesis. Final publication checks exact active-class coverage and uses `INSERT … SELECT`.
- Explain All creates no Java list of the complete queue. SQLite keyset-pages active CLASS/METHOD IDs, computes indexed degree/LOC metadata, and idempotently upserts one bounded page. `jobs.total_items=-1` distinguishes incomplete population from a valid empty queue, enabling restart recovery without premature completion. Claims remain ordered by `relation_count ASC, loc ASC, subject_id ASC, id ASC`; relationships remain on-demand. One worker/semaphore limits outstanding provider requests to one and abandoned `IN_PROGRESS` work is reset safely.
- The shared `ContextBuilder` bounds related symbols/methods, relationship and call-site occurrences, source/prior-explanation characters, project documents, and global inventory rows. It fetches source/TEXT lazily with SQL `substr`, spends a combined token/body-aware budget, and adds a structured `context-limits` evidence record. Symbol, method, bulk and edge explanations all use this path; bounded edge contexts retain endpoint and exact call-site evidence subject to the occurrence cap.
- `ModelClientService` now uses Java's streaming HTTP body handler, serializes each bounded request once, reads at most `maxResponseBytes + 1`, and rejects request/response oversize independently of token settings. Response text/array/claim/ID counts are validated before publication. Logs contain neither prompts/source/responses nor credentials. There is no provider fallback.
- Flyway V006 adds reduction-plan fields, staged class purposes, and initial ordered-query indexes; V007 adds generated-work cleanup; V008 adds keyset/status indexes; V009 supplies full foreign-key-ordered snapshot cleanup while preserving workspace logical symbols, notes, bookmarks and documents. Document invalidation removes only unfinished unreferenced runs and marks successful prose stale rather than deleting it.
- Queue-status schema 2 is aggregate-only. The shared React serial poller never overlaps requests, schedules only after resolution, stops on terminal/inactive state, workspace change or unmount, and ignores late results. Inspector-only requests emit one terminal graph refresh so edge READY indicators update without reviving global polling. Current phase/range, validated count, elapsed time, failure/cancellation, and existing READY shine remain visible.

Measured root cause and bounds:
- Before this slice, code-path inspection found unbounded `queryForList`/collection growth for all architecture types/packages/couplings/documents, all summaries, every class purpose, all bulk subjects, and complete collaborator/member/relationship sets; the synthetic dimensions would have produced a 10,000-entry purpose Map and a 60,000-row Java queue list, with relationship collections able to reach 100,000. The old implementation had no bounded counters, so these are inspected cardinalities, not reconstructed measurements.
- The pre-change baseline `./gradlew test --no-daemon` had 72 tests and `/usr/bin/time -v` reported 535,372 KiB maximum RSS for the combined Gradle/test processes. The final normal suite has more tests and reports 596,876 KiB; this whole-process RSS is included for transparency and is not an isolated heap comparison.
- The final 10,000-class / 50,000-method / 100,000-relationship constrained fixture completed under a 256 MiB test-worker heap. Deterministic high-water marks were **128 rows returned by one instrumented query, 16 symbols retained in a batch, 1 simultaneous model request, 16,787 prompt UTF-8 bytes, and 1,517 response bytes**. Sampled used test-worker heap peaked at **71,516,008 bytes** of a 268,435,456-byte maximum. `/usr/bin/time -v` reported 544,544 KiB maximum RSS for the combined Gradle daemon and test JVM, so it is not presented as worker heap.

Verification:
- `./gradlew test --no-daemon` — BUILD SUCCESSFUL; **78 tests, 0 failures/errors/skips**.
- `./gradlew constrainedMemoryTest --no-daemon` — BUILD SUCCESSFUL in 2m22s with `-Xmx256m`; one synthetic scale test, metrics above, no `OutOfMemoryError`.
- `./gradlew bootJar --no-daemon` — BUILD SUCCESSFUL; packaged frontend included. Vite's existing >500 kB bundle advisory remains.
- `node scripts/test-graph-model.mjs` — PASS, including execution of the real shared polling module with deferred requests (maximum one in flight, no schedule-before-settle, late result ignored after stop).
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, `node --check scripts/verify-hierarchical-ui.mjs`, and `git diff --check` — successful.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS against the packaged jar, isolated SQLite, local mock provider and Chromium: 61 CLASS/METHOD bulk subjects in exact SQL order, zero bulk relationships, visible bounded-stage progress and stop control, READY updates, refresh/poll lifecycle, SQLite integrity, and unchanged imported-source hashes. This is mock-provider verification, not live-provider verification.
- Visually inspected all nine 1500×980 / 430×900 screenshots in `build/hierarchy-smoke/run-do7c60_n/`. Phase/range/timer/validated state fits the narrow footer without horizontal overflow; completed state reads “Explain all completed,” shows 61 explained / 0 queued, and removes the stop control; class/method/edge shine and hover remain visible; settings and evidence panels remain usable.

Remaining limits:
- **No live-provider quality, latency, streaming-protocol, or provider-tokenizer verification.** The HTTP body is consumed incrementally to a hard cap, but the OpenAI-compatible endpoint used here returns one JSON response rather than token-by-token application streaming. Summaries remain lossy generated interpretation.
- Total SQLite storage, provider calls and elapsed time grow with repository size. Sequential generation is deliberate for deterministic bottom-up ordering and a one-request memory bound. Checkpoint artifacts referenced by a synthesis remain for provenance until that snapshot is explicitly deleted.
- The document management API still returns its contract-limited set (maximum 30 × 100,000 characters) for editing; explanation construction never loads that set and instead pages metadata/content slices. The main frontend bundle warning is unchanged.
- `docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` is the available build brief and was read. Unrelated `.claude/` and `skills-lock.json` remain untouched.

Decision: [ADR 0005](docs/adr/0005-bounded-explanation-working-sets.md), with updated [architecture](docs/ARCHITECTURE.md), [schema](docs/DATA_MODEL.md), [testing](docs/TESTING.md), and prompt notes. The codebase-design deep-module vocabulary shaped the narrow `ArchitectureBatchProcessor` and shared `ContextBuilder` boundaries.

## Previous acceptance slice: 500 classes and ten context documents — complete

Implemented on 2026-09-09:
- `ArchitectureBatchProcessor` keeps small projects on a single architecture request, while large projects summarize every inventory/document/coupling slice and draft bounded class batches. Input and output limits both influence planning. Provider context rejection, truncated output and incomplete class coverage split work into smaller requests; malformed/foreign/duplicate outputs never publish partial coverage.
- Pipeline 2.1 caps architecture output batches at 16 classes even when Settings names a very large output allowance. The footer shows the exact class range or context batch in flight, an animated activity mark, elapsed request time and the independently truthful count of validated checkpoints. A slow first model response no longer looks like an idle `0/262` job.
- V005 adds durable architecture checkpoints with exact input/output provenance and job stage/count fields. Cancellation stops between requests; successful in-flight stages can be retained. Retries reuse matching checkpoints; changed documents/model inputs select new keys. Complete class drafts publish atomically before the existing sequential degree/LOC/ID queue proceeds. Relationships remain on-demand.
- Provider-neutral token estimates replace the one-byte-per-token restriction, reserving output, framing and a variance margin. Context slicing scans only the next bounded slice, preserving Unicode and every document tail. The model adapter detects output truncation before parsing JSON and classifies explicit context/payload-size rejection.
- Settings no longer impose arbitrary 1,000,000-context/32,768-output HTML maxima. They explain the configured model's finite per-request limits and automatic batching. The footer reports current preparation activity and saved batches. Individual contexts retain source/neighbor/owner purposes with disclosed omissions; prompt 3.1 emphasizes business rules, branches, state changes and collaborator responsibilities.

Verification:
- `./gradlew test bootJar` — BUILD SUCCESSFUL; **72 tests, 0 failures/errors/skips**. Frontend TypeScript/Vite compiles and the executable jar packages successfully. The existing >500 kB main-bundle advisory remains.
- The scale acceptance fixture contains **500 classes, five methods and ten documents totaling 877,120 characters (about 857 KiB)**. At **8192 context tokens / 512 output tokens**, it verifies complete reconstruction of original context slices, exact class coverage, bounded requests, provenance, and full bulk execution: **52 saved context stages, 250 class batches, 505 READY full explanations, zero relationship explanations**. These are synthetic database/model fixtures, not live semantic-quality measurements.
- Additional tests cover cancellation/resume without replaying validated batches, provider outages, document invalidation, provider context rejection, truncated class output, large individual context retaining its owner's purpose, Unicode boundaries, and model windows above the former UI caps. Existing ordering, edge exclusion, generated-evidence grounding, freshness and migration tests pass.
- `node scripts/test-graph-model.mjs` — PASS, including the user's explicit scope controls and READY aggregation.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS with packaged app, isolated database, local mock HTTP provider and Chromium. It verifies 61 fixture bulk symbols, deterministic request order, explicit edges, large-context batching, saved-stage progress, Settings maxima removal, SQLite integrity and unchanged source hashes.
- Browser assertions cover live READY updates, refresh polling, preserved viewport, reduced motion, narrow layout and no runtime exceptions. Visually inspected `narrow-context-progress.png` and `narrow-batched-ready.png` in `build/hierarchy-smoke/run-xgmstwuu/`; the progress view shows the active batch and advancing timer at 430px without horizontal overflow. The run contains nine screenshots. The selected edge correctly remains STALE after document changes because bulk does not regenerate relationships.
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py`, `node --check scripts/verify-hierarchical-ui.mjs`, and `git diff --check` — successful.
- Intermediate checks caught outdated oversized-input-failure expectations, a TypeScript optional-max access, a test document exceeding the existing document-size contract, and a CDP test serializing a DOM element. Each was corrected before the passing checks above.

Remaining limits:
- **No live-model quality or latency verification for this revision.** Summaries are necessarily lossy; configured context/output values must match the actual model. There is no unlimited-context claim or provider fallback. Individual source windows still disclose shortening/omission.
- Total requests, latency and local checkpoint storage grow with project size. Successful checkpoints are retained; this slice does not introduce eviction or semantic document retrieval. The existing document API permits up to 30 documents of 100,000 characters each.
- Previous successful prose is preserved under existing freshness rules. The user's committed graph scope changes and unrelated untracked `.claude/` / `skills-lock.json` are preserved.

Decision: [ADR 0004](docs/adr/0004-bounded-architecture-batches.md), with updated [architecture](docs/ARCHITECTURE.md), [schema](docs/DATA_MODEL.md) and [testing](docs/TESTING.md). The original single-request/oversized-failure statements in earlier status entries below are historical and superseded.

## Previous acceptance slice: explicit graph scope control — complete

Implemented on 2026-09-09, frontend-only:
- New `ScopeSelection` model (`frontend/src/features/explorer/scopeModel.ts`): `mode: 'ALL' | 'CUSTOM'` plus explicit `selectedPackageIds`/`selectedClassIds` sets, with pure helpers (`isClassInScope`, `isNodeInScope`, `getPackageCheckState`, `getScopeCounts`, `scopeToLabel`, `togglePackage`, `toggleClass`, `focusScopeSelection`). Packages are flat in this data model (`JavaParserAdapter` never links a `PACKAGE` to another `PACKAGE`), so package/class membership resolves via the existing `ownerAt('PACKAGE', …)` helper — no invented package-nesting concept.
- `graphModel.ts`'s `projectGraph` now takes a `ScopeSelection` instead of a single seed ID. Membership is scope-only; a focused/selected node no longer pulls in out-of-scope neighbors. Returns `scopedCount`/`visibleCount`/`omittedCount` instead of a single `omitted` count, so the UI can state an honest "showing N of M in scope."
- `frontend/src/features/explorer/NavigationPane.tsx` (previously an unused placeholder) is now the real, active package/class tree: `Select all`/`Clear` toolbar, tri-state package checkboxes (native `indeterminate`, `aria-checked="mixed"`), per-class checkboxes, and a keyboard-reachable `⌖` Focus action per row. Methods are intentionally not shown in this tree (scope is package/class granularity; methods inherit class scope) — reachable via graph level, search, or the inspector's Methods section as before.
- `App.tsx`: selecting a subject for inspection (tree label, graph node, search result, inspector related-item) no longer narrows the graph — it only updates the inspected subject and, where useful, the graph level. `explore()` is now "Focus scope": isolates the clicked package/class and moves to the next useful level. The graph-level segmented control now preserves the current scope ("View at this level") instead of resetting it. A persistent scope banner above the canvas states the exact boundary, the current level's count within it, an honest paginated count with the existing "show more," an "Inspecting …" chip for the selected subject, and "Reset to whole system" when custom. Breadcrumbs show scope / level / inspected subject. An empty custom scope shows an intentional empty state with `Select all`, instead of an empty graph.
- Deliberate omission: the previous "click a node, see it plus its collaborators" focused-neighborhood view is not reimplemented (the brief marks it optional and gates it behind explicit ghost/boundary-node styling). This is a visible behavior change from the prior revision — clicking a class no longer auto-narrows the graph to its neighborhood, by design, so scope stays exclusively user-controlled from the tree/Focus actions.

Verification for this slice:
- `node scripts/test-graph-model.mjs` — PASS. Extended with scope-projection cases (package, class, method, mixed-package, empty, all-selected scope), a "no hidden neighborhood expansion" regression check, and scope-helper unit tests (tri-state check state, immutable toggle/materialize-from-ALL behavior, `scopeToLabel`).
- `npx tsc -b --force` (frontend) — 0 errors. `npm run build` (Vite) — succeeds; existing >500 kB main-bundle advisory unchanged (pre-existing, not from this change).
- `./gradlew test bootJar` — BUILD SUCCESSFUL, all 61 backend tests pass (backend untouched by this slice), jar packaged with the new frontend bundled in.
- Live browser verification: launched the packaged jar, reused an already-indexed `test-fixtures/spring-project` snapshot (70 nodes/42 edges/5 packages/17 classes), and drove the real UI via raw Chrome DevTools Protocol (headless Chromium, no npm dependency, same approach as `scripts/verify-hierarchical-ui.mjs`) at 1500×980 and 390×844. Confirmed: fresh load starts whole-system with every checkbox checked; unchecking a package removes it from the CLASS-level graph and banner switches to "N packages selected"; "Reset to whole system" restores every checkbox; "Focus scope" on a class isolates it and jumps to METHOD level; "Clear" shows the intentional empty state and its "Select all" restores whole-system; selecting a different tree label while a custom scope is active leaves the scope banner text unchanged (selection doesn't erase scope); narrow (390px) layout has zero horizontal overflow; zero uncaught runtime exceptions during the whole run. Five screenshots captured and visually inspected (desktop whole-system, class-level after unchecking a package, focus-scope method level, empty-scope state, narrow explorer pane).
- `git diff --check` — clean.

Limits and skipped verification:
- Interactive checkbox/focus-button behavior was verified via CDP DOM clicks against the real running app (not a mocked harness), but no automated regression test captures these DOM interactions for CI; only the pure scope/projection logic has an automated (`node scripts/test-graph-model.mjs`) check. A future pass could add a lightweight CDP or component-test harness for the tree interactions themselves.
- Did not re-verify the explanation pipeline (READY sparkle, Explain all) in this session; this slice touches only scope/navigation code and the existing explanation call sites were left structurally unchanged (`InspectorPanel`/`GraphCanvas` explanation rendering untouched).
- The focused-neighborhood graph view (seed + collaborators) from the prior revision is intentionally not carried forward; see deliberate omission above.

## Previous acceptance slice: hierarchical explanations — complete

Implemented on 2026-09-09 against the actual R6 implementation:
- Explain all queues only active CLASS and METHOD symbols. Edges and other symbol kinds remain on-demand.
- Durable architecture synthesis precedes bulk symbols: complete inventory/stereotypes, all project documents and package coupling; exact CLASS JSON coverage is validated before atomic draft persistence.
- V004 stores separate class drafts, synthesis evidence/provenance/freshness, consumed explanation dependencies and queue ordering. Drafts are visible in the inspector and never count as READY.
- Sequential processing orders symbols by incoming + outgoing occurrence count, declaration LOC, then ID. The legacy concurrency hint is accepted but execution deliberately stays sequential. Matching fresh synthesis and existing READY explanations survive resume.
- Shared contexts propagate owner/member/caller/callee/collaborator explanations and drafts, including endpoint source and exact evidence for on-demand relationships. Generated-only citations cannot prove SOURCE_FACT claims. Changed consumed outputs stale downstream explanations while retaining their evidence.
- READY class/method cards and edge labels/hover cards display a glowing purple/blue sparkle; the shared inspector shows it beside Ready. Grouped edges require every occurrence to be READY. Candidate/unresolved styling remains independent.
- Graph status refresh preserves pan/zoom. Inspector polling resumes for explicit refresh and bulk status changes. Subject-scoped display prevents a previous subject's READY badge flashing on a newly selected unexplained edge. Unresolved relationships can also be opened from the inspector list.

Verification for this slice:
- `./gradlew test` and `./gradlew test bootJar` — successful; latest suite: **61 tests, 0 failures/errors/skips**, including 12 hierarchy acceptance tests and a V003→V004 upgrade test.
- `./gradlew bootJar` — successful, frontend TypeScript/Vite compiled and executable jar packaged. Vite reports its existing advisory that the main bundle exceeds 500 kB.
- `node scripts/test-graph-model.mjs` — PASS, including mixed/READY/stale edge aggregation and escaped SVG labels.
- `python3 scripts/verify_hierarchical_pipeline.py` — PASS using an isolated local mock provider, temporary database and packaged app. Verified 61 bulk symbols in exact model-request order, zero bulk relationships, explicit edge generation, SQLite integrity/foreign keys and unchanged fixture source hashes.
- Chromium assertions: live draft→READY update, class/method/edge/hover sparkle, refresh after READY, viewport preservation, reduced motion, 430px narrow layout, no horizontal overflow and no runtime exceptions.
- Visually inspected PNGs in `build/hierarchy-smoke/run-e21seu6v/`: `architecture-draft.png`, `class-ready.png`, `method-ready.png`, `edge-ready.png`, `edge-hover-ready.png`, `narrow-edge-ready.png`.
- Final browser rerun also verified and visually inspected `build/hierarchy-smoke/run-ocraw3mz/narrow-synthesis-failed.png`: the complete-input budget error remains readable at 430px without horizontal overflow. All seven final screenshots are in that run directory.
- `python3 -m py_compile scripts/verify_hierarchical_pipeline.py` — successful.
- `git diff --check` — clean. Existing untracked root `package-lock.json` preserved.

Limits and skipped verification:
- **No live-model quality/latency verification for this revision.** The browser provider is a local deterministic mock; the prior live-run claims below are historical.
- Complete global input is never silently truncated. Large inventories/documents require a sufficient Context Budget; incomplete model output fails atomically and may require a larger Output Budget. Individual source/prose context is bounded with explicit omissions.
- Ordering is the requested degree/LOC heuristic, not a topological guarantee that every method precedes its class. Explicit clicks can take priority after the relevant architecture barrier.
- Scope remains the indexed Java snapshot; source-only import still does not evaluate target builds or runtime Spring behavior.
- `docs/BUILD_BRIEF.md` is absent; `docs/BUILD.md` contains the original brief and was read along with the other documentation. Runtime inspectors live in `InspectorPanel`; the separately named legacy inspector files are unused placeholders.

Decision and contracts: [ADR 0003](docs/adr/0003-hierarchical-explanations.md), [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [tests](docs/TESTING.md). The requested acceptance slice is complete; the next product review is explanation quality against the user's configured model.

## Earlier R6 redesign verification (historical)


The user requested a full redesign matching `docs/pics/`, project documents in explanation context, whole-codebase context for Explain All, corrected dependency navigation/layout, a compact bottom-left minimap, and explicit method-code buttons. Prior R0–R5 claims below are historical, not verification of this revision.

A prior Codex CLI session implemented the redesign but was cut off mid-task by a usage-limit error before it could visually verify the result against `docs/pics/`. This revision reviewed that work, fixed defects found, and completed the verification.

Implemented and browser-verified against `docs/pics/`:
- Light developer workspace, left package-tree sidebar, package/class/method abstraction, focused caller-left/target-right neighborhood layout, source dialogs (view-on-click only, never default), and a compact, correctly-proportioned minimap moved to bottom-left.
- Local project document CRUD with revisioned evidence and explanation invalidation.
- Codebase inventory/package coupling, documents and collaborator evidence in explanation requests; relationship prompts carry real facts.
- Earlier R6 included methods and relationship occurrences in Explain All. Superseded by the current hierarchy slice above: bulk includes CLASS/METHOD only; relationships remain on-demand.
- Parser stores overload identities, private methods, exact declaration/call evidence, and Spring relationship evidence.

Bugs fixed this revision:
- **Removed client-identity spoofing**: `ModelClientService` was sending hardcoded `claude-cli`/`anthropic-version`/`anthropic-beta` headers (documented as a deliberate attempt to pass one provider's WAF client verification) to what is supposed to be a generic local/loopback model endpoint. Removed those headers and the matching `api.agentrouter.org` hostname rewrite; added a plain, user-configurable User-Agent field to the model profile (Settings screen, backend DTO/config) instead. Anyone relying on the old spoofed identity to pass a specific provider's WAF must now set their own honest User-Agent value in Settings.
- Fixed a duplicate-`DEPENDS_ON`-edge bug: N call sites between the same two classes were creating N duplicate class-level `DEPENDS_ON` rows instead of one aggregate row with multiple evidence occurrences.
- A single file failing to parse (Pass 1/2) could throw and discard every other file's facts for the whole snapshot; both passes now catch per-file, log a diagnostic, and continue, matching the existing Spring-analysis pass's behavior.
- `Explain All`'s requested concurrency was silently ignored after startup (worker pool stuck at 1); the worker pool now actually grows to the requested size without interrupting in-flight workers.
- Halved `ExplanationService`'s per-explanation cost: mid-generation staleness detection was rebuilding the full whole-codebase context twice; it now compares a cheap documents+model-profile fingerprint instead (the only inputs that can change while a published snapshot is being explained).
- `SourceService` no longer always claims a retained snippet is `exact`; it now re-hashes the live file (when present) and compares against the hash captured at index time, surfacing "may be outdated" in the View-code dialog on mismatch.
- Frontend: fixed an inflated/double-countable "Depends on" badge count in the Inspector panel (now derived from what's actually rendered); guarded an unhandled-exception crash on the `?snapshotId=` deep-link restore path when graph metadata is missing; fixed the focus-aware graph layout not re-running for package or edge selections (only class/method selections happened to trigger it before); bounded the explanation-status polling interval to stop once status is terminal instead of polling forever; added a null-guard on source content in the View-code dialog.
- Removed dead code: an unused `AnalysisService.markSymbolsDeleted` method, three unused `apiClient` methods, and the no-longer-imported `cytoscape-dagre`/`cytoscape-navigator` npm dependencies (and their stray type declaration).

Verification performed this revision:
- `./gradlew clean test bootJar` — BUILD SUCCESSFUL, all 49 backend tests pass, single-executable jar produced.
- `npx tsc -b --force` (frontend) — 0 errors. `node scripts/test-graph-model.mjs` — PASS (aggregation, direction, repeated sites, uncertainty, method neighborhoods, filtering, bounded views).
- Fresh end-to-end run: new workspace against `test-fixtures/spring-project` with a brand-new database, analysis completed (51/51 items, 0 failures), graph API returned 70 nodes / 42 edges with deduplicated `DEPENDS_ON` edges, and the View-code endpoint returned `exact: true` for a live-hash-verified method.
- Headless-browser screenshots (`graph_canvas_preview.png`, `explanation_inspector_preview.png`, replacing the pre-redesign captures left by the prior session) confirmed against `docs/pics/`: light theme, sidebar package tree, labeled dependency edges, compact bottom-left minimap with a correctly-scaled current-viewport box, and a class Inspector panel with AI-explanation section and non-default "View class/method code" buttons.

Known remaining limitations:
- No LLM endpoint was configured in this session, so live explanation generation (the actual model round-trip) was not re-verified end-to-end; only the request pipeline up to and including the model call was exercised.
- The project-documents tab and other click-only interactions (as opposed to URL-addressable views) were verified by code review and endpoint testing, not by automated browser click simulation (no browser-automation tooling is available in this environment).
- A prior codex-session live run recorded one permanently `FAILED` relationship explanation after exhausting retries; the underlying cause was not reproduced or specifically retested here since no live model was configured.
- `scripts/verify_explanation_pipeline.py` now accepts a `CODEATLAS_USER_AGENT` environment variable to set on the model profile; since the spoofed `claude-cli` identity was removed, a provider whose WAF requires a specific client identity (e.g. the AgentRouter endpoint this script defaults to) needs that env var set, or the connection test will fail.

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
- **Optimized Graph Layout (Squarish Package Aspect Ratio & Coupling-Based Clustering)**:
  - Eliminated thin and elongated package containers by replacing 1D vertical Dagre stacking with balanced 2D multi-column distribution of child nodes inside classes and packages.
  - Dynamically calculates optimal grid dimensions `(cols, rows)` to mathematically bound package aspect ratios between ~1:1 and 4:3.
  - Implemented coupling-weighted force simulation where inter-package edge density (`INJECTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, `DECLARES_BEAN`) exerts attractive spring force pulling connected packages into close proximity (e.g. controllers and services, services and repositories).
  - Bounding-box clearance repulsion prevents package container overlaps while centering gravity preserves overall graph cohesion.
  - Aligned compound parent labels (`node:parent`) to the top with dedicated padding, preventing class name text from colliding with child method nodes.
- **OpenAI & Local LLM Settings Feature**:
  - Comprehensive `SettingsScreen.tsx` modal supporting OpenAI, Ollama, LM Studio, and Custom provider presets.
  - Configurable parameters: Base URL, Model ID, API Key / Token (with Show/Hide toggle), Context Budget, Max Output Tokens, Timeout, and Temperature.
  - Backend `ModelClientService` attaches `Authorization: Bearer <token>` when `apiKey` is configured, uses configurable timeout, temperature, and tokens.
  - `ModelProfileController` connects `GET /api/model-profiles` (masking API token for security), `POST /api/model-profiles` (updating in-memory configuration), and `POST /api/model-profiles/test` (live capability ping returning real latency and status/error details).
  - Frontend persists settings to backend in-memory profile and browser `localStorage`.

- **Workspace Path Normalization & Robust API Error Handling**:
  - `WorkspaceService` normalizes repository input paths: strips enclosing double/single quotes, trims whitespace, expands `~` to `user.home`, resolves relative paths to absolute paths, and validates directory existence with clear messages.
  - Implemented `@RestControllerAdvice` `GlobalExceptionHandler` mapping `IllegalArgumentException` (400), `NoSuchElementException` (404), and unhandled `Exception` (500) to structured `ApiError` responses (`timestamp`, `status`, `error`, `message`, `path`).
  - Frontend `apiClient` wraps all fetch requests via `requestJson<T>`, safely intercepting network failures and HTTP errors before calling `res.json()`, preventing `SyntaxError: JSON.parse: unexpected character at line 1 column 1` on non-JSON or error payloads.
  - Frontend `App.tsx` guards against empty paths and validates response IDs before dispatching analysis jobs.

- **End-to-End LLM Explanation Pipeline (Milestones R1 & R4 Live Verified)**:
  - Added REST endpoint `GET /api/snapshots/{snapshotId}/symbols/{symbolId}/explanation` in `ExplanationController` returning `ExplanationResponse` (or `NOT_REQUESTED`/queue status).
  - Implemented `ContextBuilder` extracting bounded source slices, Spring stereotypes, HTTP routes, dependency injections, and incoming/outgoing relationship facts with unique evidence IDs (`ev-source`, `ev-roles`, `ev-route-n`, `ev-inj-n`, `ev-out-n`).
  - Implemented `PromptTemplate` strictly grounding explanations in parser facts (per AGENTS.md invariant: "Parser/rule facts own graph structure. Model output owns explanations only").
  - Enhanced `ModelClientService`: strips markdown code fences (```json ... ```), automatically handles `response_format` fallback when unsupported/blocked, normalizes router URLs, and sanitizes API keys from all error traces. (The `claude-cli/2.1.119` client-identity header mentioned here at the time has since been removed — see R6.)
  - Enhanced `InspectorPanel.tsx`: full explanation viewer with colored status badges (`READY`, `STALE`, `RUNNING`, `QUEUED`, `FAILED`, `NOT_REQUESTED`), short label, hover summary, structured claims classified by basis (`FACT`, `INFERRED`, `UNKNOWN`), clickable evidence pill tags, uncertainties list, and provenance details.
  - Automatic queue re-fetching: re-fetches active node explanation when queue status updates, giving instant UI feedback without full page refresh.

## Verification evidence
| Check | Command/action | Result | Date/revision |
| --- | --- | --- | --- |
| Environment preflight | `java -version`, `node -v`, `npm -v` | JDK 21.0.12, Node 22.22.1, npm 9.2.0 verified | 2026-09-07 |
| Spring unit tests | `./gradlew test --tests "dev.codeatlas.analysis.SpringAnnotationAnalyzerTest"` | 17 tests passed (0 failures, 0 errors, 0 skipped) | 2026-09-08 |
| Spring integration test | `./gradlew test --tests "dev.codeatlas.analysis.AnalysisServiceSpringIntegrationTest"` | 1 test passed (validates 9 R3/R4 checkpoints) | 2026-09-08 |
| 100-class scale benchmark | `./gradlew test --tests "dev.codeatlas.analysis.LargeProjectBenchmarkTest"` | 1 test passed (100 classes parsed in 608ms, graph query 3ms, WAL mode, 26MB heap) | 2026-09-08 |
| Context builder unit tests | `./gradlew test --tests "dev.codeatlas.explanations.ContextBuilderTest"` | 1 test passed (symbol context, evidence extraction, prompt invariants) | 2026-09-08 |
| Explanation API integration | `./gradlew test --tests "dev.codeatlas.api.ExplanationApiIntegrationTest"` | 3 tests passed (NOT_REQUESTED, QUEUED, READY status & claims mapping) | 2026-09-08 |
| Model profile unit tests | `./gradlew test --tests "dev.codeatlas.api.ModelProfileControllerTest"` | 4 tests passed (GET masking, in-memory updates, test delegation) | 2026-09-08 |
| Model client unit tests | `./gradlew test --tests "dev.codeatlas.modelclient.ModelClientServiceTest"` | 4 tests passed (fence stripping, URL normalization, unconfigured check, error reporting) | 2026-09-08 |
| Model profile API integration | `./gradlew test --tests "dev.codeatlas.api.ModelProfileApiIntegrationTest"` | 2 tests passed (MockMvc GET profile, POST update, POST test) | 2026-09-08 |
| Workspace API integration | `./gradlew test --tests "dev.codeatlas.api.WorkspaceApiIntegrationTest"` | 5 tests passed (empty path 400, missing path 400, file path 400, quotes/tilde 200) | 2026-09-08 |
| Complete test suite | `./gradlew test` | 38 tests passed across 9 suites (100% pass) | 2026-09-08 |
| Frontend compilation | `npm run build` in `frontend/` | TypeScript compile and Vite bundling succeed (0 errors) | 2026-09-08 |
| Single-executable packaging | `./gradlew bootJar` | Produces `code-atlas-0.1.0-SNAPSHOT.jar` (44.6 MB) with bundled static UI assets | 2026-09-08 |
| Live LLM explanation pipeline | `python3 scripts/verify_explanation_pipeline.py` | 100% pass: AgentRouter ping (2.9s latency), Spring workspace ingest, OrderController priority explanation generation via `deepseek-v4-flash`, DB persistence, and Inspector screenshot | 2026-09-08 |
| Headless UI inspection | `/snap/bin/chromium --headless --screenshot` | Verified `explanation_inspector_preview.png` showing OrderController explanation, claims, and evidence pills | 2026-09-08 |

## Known limitations and blockers
- Model client requires a reachable OpenAI-compatible endpoint (e.g. AgentRouter, OpenAI, Ollama, or LM Studio) to generate real LLM text; offline mode safely marks items failed/retrying without crashing.
- Source analysis is Java-only; annotation processors and bytecode weavers (Lombok, AspectJ) are not executed at import time (by design per AGENTS.md trust boundaries).

## Decisions made this session
- [ADR-0001](docs/adr/0001-technology-stack.md): Technology stack selection.
- [ADR-0002](docs/adr/0002-packaging-and-loopback-security.md): Single-executable packaging, offline static UI bundling, and loopback security.
- ~~AgentRouter compatibility headers: Attached `User-Agent: claude-cli/2.1.119 (external, cli)` and anthropic headers to pass AgentRouter WAF client verification.~~ Superseded in R6: this impersonated the Claude Code CLI's identity to a third-party service and was removed; the model profile now has a plain, user-configurable User-Agent field instead.
- Graceful `response_format` fallback: Model client attempts `json_object` format and transparently falls back to unconstrained JSON prompting if the provider returns HTTP 400 or content-blocked errors.
- Markdown fence stripping: Regex/brace extractor strips markdown code fences (```json ... ```) so models that wrap JSON in markdown are accepted cleanly.
- Grounded explanation context: ContextBuilder deterministically extracts target symbol source slices, Spring roles, HTTP routes, injection points, and graph relationships, labeling each with an evidence ID.
- Structured Inspector Viewer: InspectorPanel displays explanation status badges, short label, hover summary, structured claims grouped with BASIS (`FACT`, `INFERRED`, `UNKNOWN`) tags and evidence pills (`[ev-source]`, etc.), uncertainties, and provenance.
- Compound node filtering: Propagates visibility upward to container ancestors (`PACKAGE`, `CLASS`) so Cytoscape never inadvertently hides children of a compound parent.
- Security-hardened model settings: `GET /api/model-profiles` returns `hasApiKey: boolean` and never transmits raw API tokens back to the client; API tokens are applied in-memory and attached as `Authorization: Bearer <token>` HTTP headers.
- Zoom toolbar placement: Positioned at top-right of canvas to avoid collision with Cytoscape navigator/minimap at bottom-right.
- Squarish package layout & coupling proximity: Replaced single-column Dagre TB ranking with a 2D multi-column child distribution and a physics-driven coupling simulation, ensuring balanced package aspect ratios (~1:1 to 4:3) and proximity for strongly coupled packages.
- Safe API deserialization: Extracted a reusable `requestJson` helper in `frontend/src/api/client.ts` that checks HTTP status (`res.ok`) and `Content-Type` header, extracting error messages from structured JSON or truncating HTML/text before throwing descriptive errors instead of raw `JSON.parse` crashes.
