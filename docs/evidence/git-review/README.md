# Git review browser evidence

Verified 2026-09-20 using the rewritten pipeline (Changes toggle on the Code map,
per-tab review mode, collapsible map-heading, git-style diff code viewer):

```sh
JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py
```

Result: **29/29 checks passed**, zero page errors and zero model-provider requests.
This runs the actual packaged application and Chromium against a disposable Git
fixture with committed base, staged/unstaged changes, a deletion, a file that
parses in the base and not in the working tree, and untracked Java/non-Java files. It is not a mocked application integration or live model test.

The full pipeline also verified the fixture's source tree and Git index hashes
remained identical before/after (each run reports its own hashes; the check, not
one fixed digest, is what is asserted — see `verify_git_review_pipeline.py`).

The [report](report.json) records assertions and captured facts. All five images
were visually inspected:

- [Before turning Changes on](01-before-changes.png) — ordinary map, Classes level,
  `Hub` selected; proves entering review mode does not disturb existing exploration.
  The footer reads "1 file(s) not analyzed" and `Broken` is absent from the map and
  the scope tree: an unparsed file's types are missing, and the map says so.
- [Changes overlay](02-changes-overlay.png) — amber changed class with +/− counts,
  a green added route, a red dashed removed route, and the unparsed `Broken` class
  carrying a dashed "NOT ANALYZED" badge; no report, file list or legend.
- [New tab opened from a review tab](03-new-tab-review-mode.png) — starts in the
  same review mode, tagged "CHANGES", with a fresh (Package-level) layout.
- [Map-heading collapsed](04-heading-collapsed.png) — breadcrumbs/title/scope
  banner hidden, the level/relationship/Changes toolbar still visible, more room
  for the graph.
- [Diff viewer, split layout](05-diff-split.png) — `Hub.java`'s changed line shown
  side by side, red on the left (base) and green on the right (after).

Checks without a screenshot: the ordinary map names the file that could not be
parsed (footer, "1 file(s) not analyzed") and that class is genuinely absent there;
a relationship that only lost one of two call sites draws its own removed line beside the
unchanged one, while occurrences sharing a status still merge into one line; a route whose
declaring file no longer parses is amber
and dotted (unknown), never red/removed, and a call into that class is unknown too;
every route keeps its
expected color while each card in turn is selected, and deselecting restores every
unselected color; with Changes off the ordinary incoming-flow color is unchanged; an inspected UNCHANGED incoming overlay route is not drawn
in the removed-route red; collapsed heading wrappers are `inert`; split layout keeps the
declaration highlighting and an added line inside it keeps its green change color; an open
diff dialog issues no further source requests when the app re-renders. Another opens `OldDep` (a removed class) and confirms its
diff renders as all-removed lines with none added -- the base-side counterpart to
the Hub check above, exercising the fetch-404-to-null fallback when the other
snapshot has no file at that path.

Local raw run: `build/git-review/run-zxc_dfx1/`. Only synthetic report/screenshots
are committed; application databases, browser profiles and captured source remain
excluded.
