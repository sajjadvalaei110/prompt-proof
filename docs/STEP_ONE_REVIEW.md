# Step one — Claude review handoff

Review the current working tree in `/home/sajjad/projects/review-assist`.
Read AGENTS.md, PROJECT_STATUS.md, docs/ARCHITECTURE.md and ADR 0008, including
its 2026-09-24 amendment. `docs/BUILD.md` supplies the missing BUILD_BRIEF.md.
The original prompt is `/home/sajjad/prompts/step10/step-1-handoff.md`, but the
user's later request supersedes its moving-chevron and unchanged-pattern requirements:
restore moving dashes and add thin directional glowing margins around selected
resource edges, preserving the line colors that communicate Changes state.

Step zero and subsequent undo/zoom work share this dirty tree. Preserve those
changes; review the final implementation rather than assuming every diff belongs
to this revision. No commit or independent Claude review is claimed.

## Acceptance and implementation

- Selecting a resource in ordinary or Changes mode retains factual line and
  terminal-arrow colors. Ordinary resolved lines stay light gray; review added,
  removed and unknown routes retain green, red and amber respectively.
- Attached edges animate native dashes toward their target. UNKNOWN review
  routes retain dotted uncertainty styling. Deselecting restores their original
  patterns and removes dash-offset/opacity bypasses.
- A thin two-unit underlay adds incoming indigo (`#6366F1`) or outgoing cyan
  (`#0EA5E9`) margins, matching related-resource borders. It does not change line
  width/strength or replace line colors. Related cards retain their direction
  halos, including a hard split ring for bidirectional relationships.
- Reduced-motion mode keeps static edge patterns and halos. Unrelated elements
  remain at 0.5 opacity; terminal arrows retain scale 1.4.
- ADDED/REMOVED/MODIFIED resources and visible SVG badges retain distinct
  green/red/yellow colors. Step-zero layout continuity is preserved.

## Review focus

- `frontend/src/features/explorer/GraphCanvas.tsx`: selector order keeps factual
  route colors and UNKNOWN dots, with direction affecting only the underlay.
  Native `line-dash-offset` animation replaces custom sampled-path arrowheads;
  the canvas now draws only split node rings. Inspect animation cleanup and
  reduced-motion behavior, multi-selection priority, and edge strength retention.
- `frontend/src/features/explorer/nodeCard.ts` and
  `frontend/src/features/review/reviewPalette.ts`: shared badge/card palette.
- `scripts/verify-change-edges-ui.mjs`: ordinary route colors, directional
  underlays, actual dash offsets over time, split-ring pixels, reduced-motion
  resize, deselection cleanup and source evidence.
- `scripts/verify-git-review-ui.mjs`: compares unselected and selected factual
  route colors and checks directional margins and patterns in Changes mode.
- ADR 0008's amendment supersedes its original arrowhead decision. Earlier
  status entries describe historical implementations, not the final contract.

## Verification

See the 2026-09-24 status entry for exact commands and outcomes. Production build,
TypeScript and graph-model tests passed. Both packaged-app browser pipelines
passed against isolated fixtures, with zero page errors and unchanged source;
Git-review additionally checks the unchanged index and no model requests.
Current screenshots and reports are linked in `docs/evidence/selection-halo/README.md`.

## Limits and skipped checks

Cyan's 2.65:1 contrast against the canvas remains below the 3:1 non-text target;
border patterns and terminal arrows also communicate direction. At small zoom,
thin margins become less prominent. Solid selected routes become dashed, so line
patterns are temporarily selection styling; UNKNOWN review routes remain dotted.
Full backend and live-model suites were not rerun for this frontend rendering
revision. The legacy stable-graph browser suite still targets the removed level
switcher; current package-only browser suites cover this change. No live model
integration or independent review is claimed.

### Direct edge inspection (2026-09-24)

Clicking an edge highlights its line, terminal arrow, label and underlay in black,
including in Changes mode, to avoid confusing selection with an added relation.
This temporary direct-inspection override takes precedence over review colors;
deselection restores the factual colors. Selecting a resource still preserves
its attached edges' factual colors and uses directional margins.
