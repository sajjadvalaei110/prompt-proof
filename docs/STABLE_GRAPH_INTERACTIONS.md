# Stable graph interactions — R6 product proposal

Date: 2026-09-10. Status: **implemented** (Steps 1-5 plus the change-edges slice). The
interaction contract below is the specification the shipped behaviour is verified against by
`scripts/verify_stable_graph_pipeline.py acceptance`; a row the code contradicts is a defect in
the code, not stale prose.

The map is a working surface. Developers should be able to trace a dependency,
inspect evidence, and grow their scope without losing the locations they have
learned. Existing resources move through automatic arrangement only when the user
double-clicks a resource or activates **Reorder map**.

The bounded R6 acceptance criterion is: **inspection and incremental scope changes
preserve existing resource positions, viewport, and the user's expanded page.**
The stories below define that criterion and the two explicit arrangement actions.

## Findings from the implementation

These are code-inspection findings, not a new browser reproduction:

- `frontend/src/features/explorer/GraphCanvas.tsx`: the selection effect calls
  `graphLayout()` and fits the canvas whenever `selectedId` or topology changes.
  An edge ID is not a node focus, so edge selection falls back to the unfocused grid.
- The same component destroys and recreates Cytoscape when the node/edge topology
  changes. Scope edits and relationship filtering therefore lose positions. Its
  resize observer also fits the map, causing camera jumps independently of layout.
- `frontend/src/App.tsx`: `select()` calls `setNodeLimit(12)` for non-package
  resources. After showing 24 or 36 classes, selecting a class reduces the displayed
  set to 12. It can also change abstraction level. This directly explains a reset
  path matching the reported class workflow.
- Canvas double-click currently calls `explore()`, which changes abstraction level
  and resets the limit. This must become a separate arrangement command.
- `projectGraph()` in `graphModel.ts` ranks nodes before taking the display limit.
  Newly included high-degree classes can displace already displayed classes even
  if the canvas starts preserving coordinates. Stable page membership is required.

## Interaction contract

"Current map" means resources admitted to the current displayed page at its chosen
abstraction level, with the active scope and relationship filters applied. It
includes resources outside the viewport because the user panned or zoomed. It
excludes resources omitted by the display limit and filtered-out relationships.
Selection dimming does not make a relationship filtered out.

| Action | Result | Existing positions | Camera |
| --- | --- | --- | --- |
| Single-click a resource or tree label | Inspect; clicking the inspected resource again clears inspection | Preserved | Preserved |
| Single-click an edge | Inspect evidence; clicking the inspected edge again clears inspection | Preserved | Preserved |
| Double-click a canvas resource | Arrange the current map around that resource | May change | Keep the clicked resource at its previous screen location and preserve zoom |
| Reorder map *(not yet implemented — Steps 6-9)* | Arrange the entire current map using its displayed edges | May change | Fit the result once, capped at readable card scale |
| Check/uncheck a class or package | Add/remove eligible resources and their edges | Survivors preserved; additions below the map | Preserved |
| Show more | Append the next batch | Preserved | Preserved |
| Change a relationship filter | Update displayed edges | Preserved | Preserved |
| Fit map, zoom, pan, minimap navigation | Navigate the existing arrangement | Preserved | Changes intentionally |
| Expand tree, inspect source, close inspector, receive explanation updates, resize panes | Update the relevant UI | Preserved | Preserved |
| Toggle Changes | Switch review styling and retained-source inspection for the current map | Preserve the current scope, surviving card positions, expansion and sizes; do not restore a separate mode's old arrangement | Preserved |
| Details (⊞) on a package or class card | Expand the card in place into a box of its in-scope types or its methods; routes resolve to the deepest visible card | Cards right of / below the card shift by the box's growth (cascading through enclosing boxes), clamped against any sibling that did not itself shift on that axis so it is never crossed; others preserved | Preserved |
| Collapse (⊟) an expanded card | Return to a card at the box's top-left corner, closing nested expansions | Cards right of / below the box shift back by the shrink, with the same clamp as expand (review remediation F-01: an earlier per-card rule could pull a shifted sibling across one that stayed put) | Preserved |
| Resize a card or expanded box (corner grip) | Change its size; a card keeps its top-left corner. Escape or a cancelled gesture reverts to the pre-drag size, dispatching nothing | On release, cards right of / below it shift by the size change, clamped the same way as expand/collapse | Preserved |

Initial placement in a new snapshot or a never-visited abstraction level creates
coordinates where none exist; it is not permission to rearrange existing resources.
Preserve each visited level's page, coordinates, and viewport within the active
snapshot, including when leaving and returning to the map tab. A different snapshot
initializes its own view. Cross-restart persistence remains outside this slice.
Expansions and card sizes are kept per level like positions, and leave with their card on a scope
removal. Manual dragging remains a direct move of the dragged resource only; it must not
start an automatic layout.

### Exploration tabs (September 2026 addition)

The tab strip above the explorer, map and inspector supports **New tab**, **Clone tab**,
close and **Reopen closed tab**. Each exploration has its own scope, map geometry,
expansions, selection, filter and navigation history. A clone also inherits undo/redo
history; changing it must never change its source tab. Arrow keys, Home and End navigate
the tab strip.

**Undo** / **Redo** restores exploration actions, including scope edits, card movement,
resizing, expansion and source-dialog open/close. Ctrl/Cmd Z undoes; Ctrl/Cmd Shift Z or
Ctrl Y redoes. Selection is not an exploration action
([ADR 0009](adr/0009-selection-outside-undo-history.md)): inspecting a resource or route,
choosing an occurrence, multi-selecting and clearing selection never create an undo entry
and never discard redo. The inspector's Back keeps its own trail. A Back that also drops
cards that are no longer eligible is recorded; otherwise it is only a selection change. Undo and redo leave the current selection in place. They drop
only what the restored map no longer draws: an inspected card, an inspected route,
multi-selected cards and Back-trail entries for cards and routes that were on the map before
the step, so Back cannot return to a card that undo removed. A selection that was never on the
map, such as a tree pick inside a collapsed package, is kept. A double-click is an inspection
plus one arrangement entry, so one undo reverts the arrangement and keeps the card inspected.
When one action both edits and selects (removing the selected card from scope, say), the
edit is recorded and the selection changes alongside it. Text inputs retain their native editing shortcuts. History holds up to
200 actions per tab and ten recently closed tabs, for this page session and snapshot.
Backend work, notes/documents and model settings are outside exploration history.
Fullscreen, the Map overview disclosure and the dedicated zoom-in/zoom-out buttons are
also outside history: they remain at their current values while undoing or redoing another
action. Each dedicated zoom click is three former 1.2× steps (1.728× in, reciprocal out).
Wheel/pinch/pan and Fit map remain camera-navigation history.

**Clear selection**, clicking empty canvas, or Escape clears inspection and selected
cards without changing scope, geometry or camera, and without adding an undo entry. With
nothing selected it does nothing (it does not switch the mobile pane either).
Menus, resize cancellation and modal dialogs handle Escape first. While a relation stack
(outgoing or incoming) is shown, Escape ends the stack first and leaves the selection; the next Escape clears it. Clicking an
already-inspected resource also deselects it.

## Story 1 — Inspect without losing my place

As a developer tracing dependencies, I want to select a resource or relationship
without moving the map, so I can compare evidence while remembering the path.

Acceptance:

- Single-click immediately opens the appropriate inspector without changing scope,
  abstraction level, displayed node IDs, display limit, node coordinates, or pan/zoom.
- Selected cards get a stronger outline. Revised 2026-09-23 (ADR 0008): route
  colors and line patterns keep their ordinary or Changes meaning when a resource is
  selected. Repeated, route-width-aware arrowheads move from source to target along the
  selected resource's routes, clear labels and terminal arrows, follow compound/self-loop
  control points, and are masked off cards. Related resources get an indigo incoming halo, cyan outgoing halo, or one
  hard-split ring with indigo on the left and cyan on the right for both directions.
  Emphasis never overrides a route's strength width. Unrelated resources dim to 0.5
  opacity but remain readable and selectable. Do not resize cards to highlight. Motion
  is skipped under `prefers-reduced-motion`; direction marks and colors remain, and a
  resized card or container redraws its static ring immediately.
- Preserve terminal arrow direction, candidate/unresolved line pattern,
  resolution meaning, and explanation indicators while highlighting.
  Hidden edges never contribute neighbors.
- Edge selection highlights only that relationship and its endpoints. Clicking
  another element or clearing selection updates emphasis without layout or fitting.
- Tree labels and checkboxes have separate hit targets. Labels inspect; checkboxes
  change scope; disclosure controls only expand/collapse the tree.
- Inspecting a resource outside the current map opens its details without injecting
  it into scope or changing levels. State "Not shown in the current map" where useful.

## Story 2 — Deliberately arrange around a resource

As a developer investigating a resource, I want to double-click it to arrange its
dependencies, so the caller/dependency structure becomes easier to follow.

Acceptance:

- Move the existing single-click arrangement to double-click: incoming resources on
  the left, the chosen resource in the middle, outgoing resources on the right, and
  unrelated displayed resources below. Preserve the current deterministic treatment
  of a neighbor that has both incoming and outgoing relationships.
- Keep the same displayed nodes, scope, level, filters, and expanded count. Use only
  currently displayed edges; do not fetch or introduce hidden neighbors.
- A double-click causes exactly one arrangement. Its constituent single-click events
  may update inspection but cannot cause extra layout or level navigation.
- Keep the selected resource visually anchored and retain zoom. Respect reduced
  motion; any transition must settle without continued movement.
- Provide **Arrange around this resource** as a keyboard/touch-accessible equivalent
  in the inspector or resource action menu. It invokes this same command, not a third
  arrangement mode. Disable it when the resource is absent from the current map.
- There is no separate class/method level to drill into (ADR 0007): the map is
  package-only. **View methods**/**View classes** (tree `⌖`, inspector buttons, entry-
  point route cards, deep links) expand the target's card in place instead of
  switching levels, then select it.

## Story 3 — Reorder the map I am actually viewing

As a developer who has assembled a useful scope, I want to reorder its displayed
resources on demand, so I can read the relationships with less visual interference.

Acceptance:

- Put a text-labelled **Reorder map** button beside the graph's relationship filter.
  Tooltip: "Arrange displayed resources to reduce edge crossings. Uses current filters."
  Keep **Fit map** beside zoom controls; it changes only the camera.
- The input is the displayed node set and filtered, displayed edges, including their
  visible aggregation. Hidden dependencies and off-page resources have no influence.
  A selected resource does not bias this whole-map command.
- Prevent overlapping resource cards first. Then minimize edges running through
  unrelated cards, edge crossings, and overlapping edge labels; prefer shorter
  routes and less movement when candidates have equivalent readability.
- Do not remove evidence or hide awkward edges to improve the result. Count an
  aggregate as one displayed route, not as one line per underlying call site.
  Revised 2026-09-16 (change-edges): a displayed route is one line per ordered
  (source, target) pair at the active level, carrying every kind and resolution
  state between them; width follows occurrence count (log-scaled), the line is
  dashed if any occurrence is uncertain, and the kind breakdown stays in the label
  and inspector. A→B and B→A remain two routes. (Revised 2026-09-25, ADR 0008
  amendment: uncertain routes are no longer dashed or amber; resolution stays in
  the hover text and the inspector.)
- With the same displayed graph and starting positions, results are deterministic.
  Repeated activation after settling must not make the map drift or oscillate.
- Keep the previous arrangement if computation fails. Show "Couldn't reorder the
  map. Your layout is unchanged." Discard results if scope, filters, or snapshot
  changed while computation was running. Disable for fewer than two nodes and while
  that command is already running.
- On an established fixture with avoidable crossings, demonstrate fewer crossings
  after arranging, with no card overlaps. Record the scoring rules and limits.
  Product copy promises reduced crossings, not an unverified absolute minimum or
  a crossing-free drawing for every graph.

## Story 4 — Grow or shrink scope without disturbing existing work

As a developer building a working set, I want additions below the map and removals
to leave other resources alone, so I control when the whole map is reorganized.

Acceptance:

- Append newly displayed resources in spaced rows below the existing cards' bounding
  box in graph coordinates, not at the bottom of the current screen. Sort within a
  new batch consistently. Consider card dimensions to avoid overlaps.
- Keep every surviving resource's exact position, including manual placement. Do
  not compact holes on removal or silently fit/scroll the map on addition.
- Use a quiet message such as "6 resources added below". An optional **Show added**
  action pans to those resources without layout; it never runs automatically.
- Scope additions must not displace already displayed resources through degree
  ranking. Retain the existing page, append new eligible resources within its display
  budget, and explicitly report additional in-scope resources waiting for **Show
  more**. Keep the current bounded rendering policy; do not load an entire large
  package implicitly. The message distinguishes added-to-scope from displayed counts.
- Removed resources' incident edges disappear. If the inspected resource is removed,
  retain its inspector with an out-of-scope indicator rather than reset the map.
- Removing and explicitly re-adding a resource treats it as an addition below the
  current map. Merely changing an edge filter preserves all card coordinates.
- Clearing the scope leaves an empty map. Adding resources afterward must not cause
  a delayed arrangement of surviving resources or reset other view settings.

## Story 5 — Keep the classes I already revealed

As a developer comparing many classes, I want inspection to preserve my expanded
page, so selecting a class does not undo **Show more** or my scope choices.

Acceptance:

- Given 36 displayed classes after two **Show more** actions, clicking a class on the
  canvas or in the left tree leaves those same 36 class IDs displayed, with unchanged
  coordinates, zoom, pan, scope, filters, and level.
- Selecting an edge, another class, a recent item, or an inspector relationship does
  not reset the display limit to 12. Re-selecting the active Classes control is a no-op.
- Explicit navigation to Methods followed by Classes restores the Classes page and
  arrangement. Returning from source, settings, or project context also preserves it.
- Explanation polling updates text and badges without changing membership or layout.

### Outgoing relation stack (2026-09-24)

A card's stack button, shown on the selected and hovered card, or its "Show outgoing stack" menu
item roots a stack at that card (`docs/OUTGOING_STACK.md`). The walk follows parser relationship
facts at the root's own granularity (a package root package relations, a class root class
relations, a method root method calls; user decision 2026-09-25), so a collapsed card never joins
unrelated relationships of its members. A method root also reaches the types it constructs, calls
candidate members of or uses (as dead ends), and follows a call to an interface or abstract method
on to its in-source implementations (step 12 phase C, ADR 0010). Every drawn card holding something
the root reaches gets a layer badge at its top-left: its card-hop distance, where a step inside one
card is free, ranked so the numbers never skip. REMOVED facts are not walked in Changes. Chain routes (drawn routes carrying a chain relationship) get the
selected-route dashes and cyan underlay with their factual colors, chain cards a static cyan
outline, cards inside a reached expanded box stay lit without a badge, every card of the root set
takes the root look, and everything else is muted. The root stays pinned
while the selection moves, and its button stays pressed with the tooltip "Outgoing stack: N layers
· M resources" (plus "· K beyond the map" when the chain leads to K things with no card on the map,
where it stops), which the inspector repeats for the root. Layers recompute live on filter or scope
changes; expanding a downstream card does not change them. The stack ends on the button or menu item, on Escape (after menus and
before clearing selection), or when the root leaves the map (scope removal, collapse, level switch,
undo, Changes recapture), and it never comes back on its own. Turning it on or off adds no undo
entry and never moves cards or the camera.

Incoming stack (2026-09-28): the root's button has three states, outgoing, then incoming, then off;
another card's button always starts outgoing there. The card menu offers "Show/Hide outgoing stack"
and "Show/Hide incoming stack" directly. The incoming stack is the exact mirror over reversed facts
(so an interface root reaches its implementors, and a method is reached from the callers of the
method it overrides). It uses the same badges, outlines, route dashes and muting, in the incoming
halo's indigo instead of cyan; the root keeps its teal look. Its line reads "Incoming stack: N
layers · M resources". Switching direction adds no undo entry, and Escape ends either direction.

Keyboard: the stack toggle is a focusable button (Enter or Space), and it keeps focus when it
changes state or turns the stack off, even on a card that is no longer selected or hovered. Shift+F10 or the
ContextMenu key opens the card menu, either on a focused corner button or with a card selected
and the page focused. The menu opens at the card with focus on its first item; the arrow keys,
Home and End move through it, and Escape or an action returns focus to where it was opened. A
keyboard-opened menu adds nothing to the multi-selection, and a card that a right-click added only
to open the menu leaves the multi-selection when the menu roots the stack.

## Delivery and validation

Implement stable selection/page state first, incremental canvas updates second, then
the two arrangement commands and crossing-quality checks. Keep semantic graph facts,
scope, inspected subject, displayed membership, coordinates, and viewport distinct.
No new backend schema, model calls, or graph-library replacement is proposed.

Use browser regressions that capture node IDs, graph coordinates, pan, zoom, and
displayed counts before and after real pointer actions. A passing scope-model test
alone does not establish canvas stability. Required scenarios include the 36-class
regression, edge inspection, package batch addition/removal, filtered relationships,
two single-clicks versus double-click, source/inspector resizing, tab return, empty
scope, and explanation refresh. Add deterministic layout fixtures for bidirectional
neighbors, disconnected nodes, cycles, parallel edges, and filtered-out edges.

Visually inspect desktop and narrow screenshots for emphasized paths, retained
uncertainty styling, additions below existing nodes, and post-reorder crossings.
Keyboard/touch equivalents and reduced motion need explicit verification.

This proposal was checked against the existing R6 scope boundary, build brief
(`docs/BUILD.md`; `docs/BUILD_BRIEF.md` is absent), architecture, and ADRs 0001/0003.
Runtime tests and screenshots are deferred to implementation: no UI code changed.

### Selection motion revision (2026-09-24)

Selected-resource routes now animate native dashes toward the target, with thin
incoming indigo / outgoing cyan margins matching related-resource borders. Line
and terminal-arrow colors retain their factual meanings, including Changes colors.
UNKNOWN review routes stay dotted. Deselecting restores the original pattern;
reduced motion leaves static patterns. See ADR 0008's amendment.

### Direct edge inspection (2026-09-24)

Clicking an edge highlights its line, terminal arrow, label and underlay in black,
including in Changes mode, to avoid confusing selection with an added relation.
This temporary direct-inspection override takes precedence over review colors;
deselection restores the factual colors. Selecting a resource still preserves
its attached edges' factual colors and uses directional margins.
