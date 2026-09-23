# ADR 0008: Selection direction and change color

- Status: Accepted
- Date: 2026-09-23
- Scope: R6 Code map, ordinary and Changes modes

## Context

Selecting a resource used edge color for direction: outgoing became blue and incoming
red. In Changes mode, edge color also reports an actual addition or removal. An
incoming unchanged route was consequently overridden to navy to avoid looking like
a removal, but the selected and unselected map gave conflicting color meanings.

## Amendment — 2026-09-24

The user revised the motion treatment: selected-resource routes use native moving
dashes instead of repeated arrowheads. Their line and terminal-arrow colors remain
factual. A thin two-unit underlay uses incoming indigo or outgoing cyan, matching
related-resource borders, in both modes. UNKNOWN review routes remain dotted;
other selected routes are dashed. Deselecting restores the original line pattern.
Reduced motion keeps static dashes and margins. The canvas now draws only the
split resource ring; native Cytoscape rendering follows the actual edge curves.
This supersedes the moving-arrowhead and factual-pattern-on-selection parts below.

## Original decision

Edge color and line pattern report relationship facts. In ordinary mode, resolved
routes remain gray; in Changes mode, added routes are green and removed routes are
red and dashed. Unknown and unresolved routes retain their uncertainty styling.
Selecting a resource never recolors its routes or changes their line patterns. Ordinary
resolved lines are 10% lighter gray (`#AAB6C4`); terminal and moving arrowheads are
10% darker (`#768698`). The terminal arrowhead uses scale 1.4. Repeated arrowheads
move along selected routes from source to target and grow with rendered route width,
so a strong route cannot swallow a fixed-size direction mark. Reduced motion leaves
the arrowheads static. Unrelated elements use 0.5 opacity.

Related resources carry direction: incoming has an indigo (`#6366F1`) halo and
dashed border; outgoing has a cyan (`#0EA5E9`) halo and solid border. A resource
with both gets one ring, hard split indigo on the left and cyan on the right,
plus a double border. The chevrons and split ring share one pointer-transparent
canvas overlay beneath graph controls, menus and hover UI. Card masks keep overlay
marks off resource content; multi-selection suppresses the split ring so its purple
outline keeps priority. The overlay uses Cytoscape's public rendered edge points and
node geometry. It follows every control point, including two-control self-loops; when
a loop has finite controls but non-finite rendered endpoints, card-boundary intersections
supply the endpoints. Arrowheads reserve the edge-label interval and enough terminal
space for the scaled Cytoscape arrow. It redraws after selection, movement, pan/zoom
and resize, including reduced-motion container resize.

Sampled paths and card masks are cached until geometry changes. Animation frames reuse
them, and one `requestAnimationFrame` queue coalesces redraw requests from pan/zoom and
the animation loop. Graph facts and element identity are unchanged.

Review resources, routes, terminal arrowheads and visible card badges use one shared
palette: green for ADDED, red for REMOVED, and yellow for MODIFIED. A container with
a mix of added and removed children
continues to roll up to MODIFIED. Relationships have no MODIFIED state.

Against the `#f8fafc` canvas, WCAG 2.1 SC 1.4.11 contrast is 4.27:1 for indigo
and 2.65:1 for cyan (sRGB relative luminance). Cyan alone falls below the 3:1
non-text contrast target. Solid versus dashed/double borders and moving chevrons
also encode direction; this contrast limit remains visible for assessment.

This supersedes the red/blue/violet selection scheme formerly described in
`docs/STABLE_GRAPH_INTERACTIONS.md` and the incoming navy workaround in ADR 0006.

### Direct edge inspection (2026-09-24)

Clicking an edge highlights its line, terminal arrow, label and underlay in black,
including in Changes mode, to avoid confusing selection with an added relation.
This temporary direct-inspection override takes precedence over review colors;
deselection restores the factual colors. Selecting a resource still preserves
its attached edges' factual colors and uses directional margins.
