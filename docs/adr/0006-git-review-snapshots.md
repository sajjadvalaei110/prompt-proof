# ADR 0006: Source-only Git review snapshots

- Status: Accepted
- Date: 2026-09-17
- Scope: R6 Git review view

## Decision

Compare a pinned local Git base with a captured working tree, and expose three
views: base, base plus changes, and after changes. The overlay is a presentation
of two independently parsed snapshots. Comparison output cannot create canonical
parser relationships or change their resolution status.

Use the installed Git executable through an isolated revision adapter, without a
shell or another Git library. Read raw tree/blob data; never check out, reset,
fetch, pull, evaluate builds, run filters, or execute target application code.
An empty base selection uses the common ancestor of HEAD and the locally available
upstream, falling back to HEAD with a visible diagnostic. Explicit local revision
expressions are resolved to a commit before capture. No remote update is implied.
The after side includes tracked staged and unstaged changes and nonignored
untracked files. It describes captured file content, rather than a mutable branch
name or a promise that later disk edits are included.

Do not run a working-tree diff inside the target repository: Git can execute its
clean filters even when external diff and text conversion are disabled. Instead,
compare raw blobs and filesystem bytes, then use `git diff --no-index` on private
temporary files. Git process environments discard inherited Git redirections and
disable hooks, fsmonitor, lazy fetching and transports. Raw-byte fingerprints before
and after capture detect concurrent edits independently of index flags and diff
attributes. Private diff files are removed after use.

Analysis uses temporary private copies outside the target repository, retains
snapshot source for evidence, and shares the existing serialized parser boundary.
Review snapshots do not replace the workspace's ordinary active snapshot and do
not invalidate successful explanations for that snapshot.

Compare declarations and relationship occurrences independently. A behavior change
may modify a method without changing a relationship. Parent line totals must count
physical changed lines once, even when they belong to nested declarations.
Relationship matching must preserve multiplicity and resolution, and must not
classify line-number movement alone as a topology change. Renames and ambiguous
identities are not assumed equivalent. Analysis diagnostics remain visible.

The versioned review DTO retains each side's actual symbol and relationship IDs.
The frontend remaps IDs only for display and routes source requests to the correct
snapshot. Added and removed occurrences remain separate when they share the same
displayed endpoint pair. Base and after views use ordinary graph colors; the
overlay adds yellow resources, line counts, and green/red relationship styling.
Text and line patterns accompany color.

## Consequences

Git must be installed and the selected directory must be a supported local Git
workspace. Comparison has explicit resource limits and may reject oversized
captures. Source-only Java analysis retains its existing coverage limitations;
unsupported files and partial analysis must remain visible. Static graph changes
do not prove runtime impact or correctness.

This slice does not introduce pull request hosting, generated review verdicts,
review decision persistence, or automatic model calls. Review presentation is a
page-session workflow. Retained source snapshots and comparison identity provide
the foundation for a later persistent review workflow.
