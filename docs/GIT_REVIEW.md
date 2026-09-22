# Review local changes

Open and analyze a local Git repository, then open the **Code map** and turn on
**Changes** in the graph toolbar. Leave the base revision empty (the default) to
use the common ancestor of HEAD and the locally available upstream branch. If the
branch has no usable upstream, the comparison uses HEAD and shows a warning. A
small popover next to the toggle (▾) holds a base-revision field — a local
revision such as `origin/main`, a tag or a commit — and a **Recompare** action.
Code Atlas does not fetch or pull; remote-tracking refs have the values already
present on your machine.

Turning Changes on for the first time captures the default comparison and shows
the **Base + changes** overlay directly on the map: changed resources are amber
with added/removed line counts, added relationships are green, removed
relationships are red and dashed, and everything else keeps ordinary styling.
Added, removed, unknown and unchanged relationships between the same two cards are
drawn as separate lines, so a dropped call site stays visible as its own red route
beside the unchanged one; occurrences sharing a status merge into one line as usual.

If a Java file parses in one version and not in the other, its types cannot be
compared. They stay on the map with a dashed "NOT ANALYZED" badge and their
routes are drawn amber and dotted — unknown, not removed. The map footer names
such files ("1 file(s) not analyzed") in ordinary exploration too, since the types
they declare are missing from the graph entirely.
There is no separate report, file list or legend — the overlay is the only
review surface. Enter a ref and choose **Recompare** to capture a different base
or to pick up later edits; an existing comparison otherwise stays pinned to what
it captured. Recompare replaces the comparison for every tab that has Changes on
and clears their undo/redo history, since display IDs are keyed to the
comparison itself.

Changes is a **per-tab** setting. Each tab keeps one current scope, layout,
expansion state, card sizes, selection and camera across both modes. Turning Changes
on or off carries the current arrangement forward; it does not restart the map or
restore an older arrangement saved for that mode. Review-only resources can appear
when Changes is on, while surviving cards retain their positions. **+ New tab** opens a fresh tab in whichever
mode the current tab is in; **Clone tab** copies the current tab's mode along
with its layout and undo/redo history. Toggling Changes on or off is itself one
undoable step, so Ctrl/Cmd+Z restores the tab's previous mode and layout exactly.

The map-heading (breadcrumbs, title and the scope banner) can be collapsed to
give the graph more room: drag the grip below the toolbar upward, click it, or
scroll/swipe up over the heading. The toolbar itself — the relationship filter
and the Changes toggle — always stays visible, collapsed or not. The map is
package-only (ADR 0007); drilling into classes/methods is expand-in-place, not
a level switch.

The working tree includes the final file content after both staged and unstaged
edits, plus nonignored untracked files. It is not a staged-only diff. Committed
branch changes relative to the base are included too.

Resource changes are based on declaration source, not whole-file hashes. An edit
to one method does not automatically mark its unchanged siblings. Class totals
cover the declaration; package totals count physical changed lines across their
files. Nested resource totals overlap, so do not add package, class and method
totals together. A changed method can have no added or removed relationship.

Relationships are matched by their structure: source, target, kind and resolution.
Within one structural relationship, occurrences with identical evidence pair first;
any leftover occurrences then pair one-to-one as unchanged, because the relationship
still exists with the same multiplicity. Editing a call's arguments or adding another
use of the same class therefore marks the edited declaration as changed without
drawing a red and a green copy of the unchanged dependency. Only a real surplus on
one side, or a changed target, kind or resolution, is shown as removed or added. A call
moved to a different method changes its source, so it still shows as removed from
the old method and added to the new one.

### Viewing a changed file's diff

With Changes on, opening a class or method's code (the `</>` code button, or the
inspector's **View class/method code**) shows a real git-style diff whenever that
symbol's file changed — not only when the symbol's own declaration changed, since
a file can change elsewhere while a given class/method stays the same. Relationship
evidence opens the same way. The diff opens **unified** by default (one column,
+/− gutters, added lines green, removed lines red) with a **Split** toggle for a
side-by-side base/after view; both show the whole file, scrolled to the
inspected declaration, with unchanged stretches never folded. An added file
renders entirely green; a removed file (or a removed symbol's evidence) renders
entirely red. A file that did not change opens exactly as it does outside review
mode. Source evidence stays pinned to its retained snapshot, so a removed
relationship remains inspectable after its original source was deleted from disk.
Graph facts retain their parser resolution status; an unchanged static
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
- Binary files count toward the change summary with line counts explicitly
  unavailable; they never acquire a diff view since they have no parsed symbols.
  An executable bit change can contribute to the summary with no added/removed
  source lines.
- Java analysis has the existing [construct support limits](SUPPORT_MATRIX.md).
  File changes outside Java do not acquire invented graph resources or a diff view.
- Declaration renames and moves may appear as removal plus addition. There is no
  claim of semantic equivalence between rewritten methods.
- This slice does not save reviewer decisions, notes or a reopenable review session.
  Ordinary exploration and its successful explanations remain separate.

The version 1 API is `POST /api/workspaces/{workspaceId}/reviews` with
`{"schemaVersion":"1","baseRef":""}`. The response identifies the resolved base,
captured HEAD and working-tree fingerprint, before/after snapshot IDs, changed
files (each carrying its `git diff --unified=0` hunks), declaration line counts,
relationship occurrences and diagnostics. `GET /api/snapshots/{id}/files/source?path=`
returns one retained file's whole content by path, so the frontend can build a
diff between a comparison's two pinned snapshots without re-reading the
filesystem. See [ADR 0006](adr/0006-git-review-snapshots.md) for architecture
decisions, including the addendum on the map-integrated overlay.
