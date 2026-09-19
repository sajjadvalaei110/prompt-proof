# Review local changes

Open and analyze a local Git repository, then open **Review changes**. Leave the
base revision empty to use the common ancestor of HEAD and the locally available
upstream branch. If the branch has no usable upstream, the comparison uses HEAD
and shows a warning. You can enter a local revision such as `origin/main`, a tag,
or a commit instead. Code Atlas does not fetch or pull; remote-tracking refs have
the values already present on your machine.

Opening the review tab captures the default comparison. Enter a ref and choose
**Compare changes** to replace it, then select a view:

| View | What it contains |
| --- | --- |
| Base codebase | The code at the resolved base commit, using ordinary graph styling. |
| Base + changes | After-change resources together with removed base resources; changed resources are yellow and show added/removed line counts. Added relationships are green, removed relationships are red, and unchanged relationships retain ordinary styling. |
| After changes | The captured working tree, using ordinary graph styling. |

The working tree includes the final file content after both staged and unstaged
edits, plus nonignored untracked files. It is not a staged-only diff. Committed
branch changes relative to the base are included too. Capture again after later
edits; an existing comparison remains pinned to its captured versions.

Each view reuses the ordinary explorer: search, scope selection, package/class/method
levels, expanded and resized cards, relationship filters, exploration tabs and
undo/redo. Each side keeps its own exploration state while switching views during
the page session. The changed-resource list is a separate index; its filter does
not remove context from the relationship map.

Resource changes are based on declaration source, not whole-file hashes. An edit
to one method does not automatically mark its unchanged siblings. Class totals
cover the declaration; package totals count physical changed lines across their
files. Nested resource totals overlap, so do not add package, class and method
totals together. A changed method can have no added or removed relationship.

Source evidence opens from the selected side's retained snapshot. A removed
relationship therefore remains inspectable after its original source was deleted
from disk. Graph facts retain their parser resolution status. An unchanged static
relationship does not establish unchanged runtime behavior.

## Boundaries

- Git capture is read-only. It never checks out files, updates the index, fetches,
  pulls, runs target builds or invokes a model.
- Git objects and working-tree files are read as raw bytes. Line changes come from
  `git diff --no-index` on private temporary files, so repository clean filters,
  external diff drivers and text conversion cannot execute. Git attributes do not
  normalize captured source, and index flags cannot hide a source edit.
- Select the Git worktree root. An initial commit is required. Symlinks and
  submodules are currently rejected by the comparison, and Git filenames must be
  UTF-8. Application data must be outside the source repository.
- Captures are bounded to 20,000 files, 8 MiB per file and 128 MiB per side.
  A Git command has a 20-second process timeout and bounded output. Detected
  concurrent source edits reject the capture and ask for a retry.
- Binary files are listed with line counts explicitly unavailable. An executable
  bit change can appear in the file list with no added or removed source lines.
- Java analysis has the existing [construct support limits](SUPPORT_MATRIX.md).
  File changes outside Java do not acquire invented graph resources. Read visible
  file and analysis diagnostics before interpreting a missing graph element.
- Declaration renames and moves may appear as removal plus addition. There is no
  claim of semantic equivalence between rewritten methods.
- This slice does not save reviewer decisions, notes or a reopenable review session.
  Ordinary exploration and its successful explanations remain separate.

The version 1 API is `POST /api/workspaces/{workspaceId}/reviews` with
`{"schemaVersion":"1","baseRef":""}`. The response identifies the resolved base,
captured HEAD and working-tree fingerprint, before/after snapshot IDs, changed
files, declaration line counts, relationship occurrences and diagnostics.
See [ADR 0006](adr/0006-git-review-snapshots.md) for architecture decisions.
