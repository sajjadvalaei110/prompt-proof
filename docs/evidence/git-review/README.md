# Git review browser evidence

Verified 2026-09-19 using:

```sh
JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java python3 scripts/verify_git_review_pipeline.py
```

Result: **34/34 checks passed**, zero page errors and zero model-provider requests.
This runs the actual packaged application and Chromium against a disposable Git
fixture with committed base, staged/unstaged changes, a deletion, and untracked
Java/non-Java files. It is not a mocked application integration or live model test.

The full pipeline also verified these hashes remained identical before/after:

- Source tree and Git metadata: `2b41bd6f7466f68d1bd8d56c98002097667b313cff5c7fc46e3a2136b328400e`
- Git index: `65a8ceae05c37425c80b5246b9b34b3adee5db670626bc351fa22c02827161ec`

The [report](report.json) records assertions and captured facts. All four images
were visually inspected:

- [Desktop review and change list](review-overlay-desktop.png)
- [Arranged full-screen overlay](review-overlay-fullscreen.png)
- [Narrow review after fitting the map](review-overlay-narrow.png)
- [Removed relationship's retained base source](review-removed-source.png)

The full-screen image uses the ordinary **Arrange around this resource** and
**Fit map** controls. The narrow view also uses **Fit map** after resizing; camera
state is intentionally retained rather than automatically reset on a resize.
Source evidence and graphs remain navigable with the model unavailable.

Local raw run: `build/git-review/run-nm12cjxf/`; pipeline log:
`build/git-review-final.log`. Only synthetic report/screenshots are committed;
application databases, browser profiles and captured source remain excluded.
