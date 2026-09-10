# Stable graph interactions — R6 product proposal

Date: 2026-09-10. Status: design and acceptance stories; not implemented.

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
| Single-click a resource or tree label | Inspect; emphasize the resource and its visible direct relationships and neighbors | Preserved | Preserved |
| Single-click an edge | Inspect evidence; emphasize that edge and both endpoints | Preserved | Preserved |
| Double-click a canvas resource | Arrange the current map around that resource | May change | Keep the clicked resource at its previous screen location and preserve zoom |
| Reorder map | Arrange the entire current map using its displayed edges | May change | Fit the result once, capped at readable card scale |
| Check/uncheck a class or package | Add/remove eligible resources and their edges | Survivors preserved; additions below the map | Preserved |
| Show more | Append the next batch | Preserved | Preserved |
| Change a relationship filter | Update displayed edges | Preserved | Preserved |
| Fit map, zoom, pan, minimap navigation | Navigate the existing arrangement | Preserved | Changes intentionally |
| Expand tree, inspect source, close inspector, receive explanation updates, resize panes | Update the relevant UI | Preserved | Preserved |

Initial placement in a new snapshot or a never-visited abstraction level creates
coordinates where none exist; it is not permission to rearrange existing resources.
Preserve each visited level's page, coordinates, and viewport within the active
snapshot, including when leaving and returning to the map tab. A different snapshot
initializes its own view. Cross-restart persistence remains outside this slice.
Manual dragging remains a direct move of the dragged resource only; it must not
start an automatic layout.

## Story 1 — Inspect without losing my place

As a developer tracing dependencies, I want to select a resource or relationship
without moving the map, so I can compare evidence while remembering the path.

Acceptance:

- Single-click immediately opens the appropriate inspector without changing scope,
  abstraction level, displayed node IDs, display limit, node coordinates, or pan/zoom.
- Selected cards get a stronger outline. Their visible incident edges get thicker
  strokes, and direct neighbors get stronger outlines. Unrelated resources may be
  gently dimmed but remain readable and selectable. Do not resize cards to highlight.
- Preserve arrow direction, candidate/unresolved dashes, resolution meaning, and
  explanation indicators while highlighting. Hidden edges never contribute neighbors.
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
- Keep drill-down separate and clearly named, such as **View methods** or **View
  classes**. These navigate to a level while preserving scope and restoring that
  level's existing arrangement if available.

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
- Do not remove evidence, merge distinct relationship kinds/resolution states, or
  hide awkward edges to improve the result. Count an aggregate as one displayed
  route, not as one line per underlying call site.
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
