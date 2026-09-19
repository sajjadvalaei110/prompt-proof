# Independent review prompt

Copy the following into Claude with this repository available:

```text
Review the Git change-review feature in this repository. Review the commits after
f410eee (use git diff f410eee..HEAD), and inspect the actual implementation and
tests. Do not change files or commit; report findings first. Preserve unrelated
working-tree changes, including the existing reviewer-assistance proposal.

Read AGENTS.md, PROJECT_STATUS.md, docs/GIT_REVIEW.md,
docs/adr/0006-git-review-snapshots.md and docs/ARCHITECTURE.md. BUILD_BRIEF.md is
absent; docs/BUILD.md is the existing product specification.

Required behavior:
1. Default base is merge-base(HEAD, locally available upstream), with a visible
   HEAD fallback and an explicit local-ref override. Include committed branch
   changes plus final staged/unstaged and nonignored untracked working-tree bytes.
2. Base and after views use the ordinary explorer. Overlay shows yellow changed
   packages/classes/methods with +/- physical-line counts; added routes are green,
   removed routes red, and unchanged routes retain ordinary styling.
3. Source evidence always comes from the correct retained snapshot, including
   removed resources and individual/aggregated relationship occurrences.
4. Preserve scope, navigation, search, expansion, resizing, exploration tabs,
   undo/redo and each view's state. Hidden views must not own active shortcuts,
   canvases or polling. Desktop and narrow layouts must be usable.
5. Analyzed repositories are read-only untrusted data. Do not execute their builds,
   hooks, filters, diff drivers or application code. No automatic model calls.
   Review snapshots must not replace normal active analysis or invalidate it.

Look for concrete correctness, security, data-loss, performance and interaction
bugs. Pay special attention to declaration matching, duplicate calls, line shifts,
package line totals, partial parsing, canonical IDs versus display IDs, symlinks,
Git environment/configuration, concurrent edits, resource bounds and cleanup.
Check ordinary explorer regressions too. Distinguish new defects from pre-existing
ones and documented limitations; do not assume passing tests prove completeness.

Useful checks:
- ./gradlew test bootJar
- node scripts/test-review-model.mjs
- Existing scripts/test-*.mjs explorer and graph checks
- JAVA=/path/to/java21/bin/java python3 scripts/verify_git_review_pipeline.py
  (requires installed Chromium and loopback sockets; use disposable fixtures)

Inspect the screenshots in docs/evidence/git-review and reproduce suspicious
behavior. Do not call a live model or modify a real target repository.

Return findings ordered by severity, each with file:line, a concrete reproduction,
expected versus actual behavior, user impact, and the smallest suggested fix.
List exact checks run, missing coverage and remaining uncertainty. If there are
no findings, say so explicitly and still describe the limits of your review.
```
