# Outgoing relation stack

Status: implemented (2026-09-24, step 12 phase B), on top of
[ADR 0009](adr/0009-selection-outside-undo-history.md). Traversal revised 2026-09-25 (user
decision, see "Traversal" and the implementation notes): the walk follows parser facts at the
root's granularity, not the drawn routes. See "Implementation notes" at the end for the choices the
design left open and the accepted deviations.

## Purpose

Show everything a resource (package, class or method) sets in motion on the current map, one
layer at a time:

- **Layer 1** is every card holding something the root has a relationship to (calls, depends on,
  injects, and so on).
- **Layer 2** is every new card holding something that a layer-1 resource has a relationship to.
- The layers continue until the chain reaches nothing new.

"Something" is measured at the root's own granularity (see Traversal): a class root follows
class-to-class relationships, a method root method-to-method calls. A collapsed card only shows
where the chain goes; it never joins relationships of different members into one chain. A card
reached from several layers keeps the **first** (lowest) layer it was reached at.

The stack is a viewing lens. It never changes graph facts, card positions, sizes, camera or
layout.

## Traversal

User decision (2026-09-25): the traversal granularity is set by the **root's kind**, and the walk
runs over parser relationship **facts** (the graph's raw edges), not over the drawn aggregated
routes. The earlier rule ("only the routes currently drawn") made a collapsed card a hub: with
packages A -> B -> C, a stack rooted at class P in A reached C only because some other class in B
calls into C.

- **Granularity:** a PACKAGE root walks package-level relations, a type root (class, interface,
  enum, record, ...) class-level relations, a METHOD or CONSTRUCTOR root method-level relations.
  Each raw edge is mapped to its endpoints' owners at that granularity (`ownerAt`). An edge whose
  source or target has no owner there is ignored: for a method root that drops class-level
  DEPENDS_ON / INJECTS / field edges and `new X()` facts that target the class X.
- **Facts walked:** every raw edge with a target, allowed by the current relationship-kind filter,
  and not `reviewChange = "REMOVED"` (a removed call does not exist in the working tree).
  Uncertain facts (`resolution != RESOLVED`) are walked like any other. Entity self-loops are not
  walked.
- **Representative card:** an entity's own card when it is drawn (even as an expanded box), else
  the nearest drawn ancestor on its parent chain (the collapsed card that contains it). An entity
  with no drawn representative (out of scope, not on the page) is not walked through, so the chain
  stops there.
- **Algorithm:** breadth-first from the root entity; an entity keeps its first distance. A drawn
  card's layer is the minimum distance over the entities it represents. The root set (layer 0) is
  the root card plus every drawn card inside it; root-set cards and the containers of the root never
  get a layer, though the walk continues through what they represent (so, rarely, a layer number
  can be skipped).
- **Expanded cards:** a reached card that is an expanded box carries the badge; the drawn cards
  inside it are **covered**: part of the chain (not muted) but without badge or outline. Because the
  walk is at the root's granularity, expanding a downstream card does not change any layer (for a
  package root, the reached package's own box keeps its badge). Expanding the root adds its inner
  cards to the root set.
- **Chain routes:** a drawn route is a chain route iff one of its `occurrenceIds` is a walked fact
  whose mapped source and target are both in the chain (the root entity or reached entities,
  self-loops included). A drawn B -> C route that carries only another class's call is therefore
  not lit.
- **Live recompute:** layers are recomputed whenever the graph, displayed nodes, edges, filter,
  scope or expansion change, as long as the root is still displayed.
- **Implementation home:** a pure helper `frontend/src/features/explorer/outgoingStack.ts`,
  `outgoingStack({ graph, cards, routes, rootId, kind, direction })`, with the rules in its doc
  comment. It is covered by `scripts/test-outgoing-stack.mjs`. `GraphCanvas.tsx` only applies the
  result.

## Activation and lifetime

- **Entry points:**
  - an on-card overlay button next to the details/expand toggle, shown on the selected card and
    on hover
  - a context-menu item, "Show outgoing stack" / "Hide outgoing stack"

  Both are keyboard reachable.
- **While active:** the button stays shown in a pressed state **on the root card**, whatever is
  selected. Its tooltip reads "Outgoing stack: N layers · M resources". The same line appears in
  the inspector when the root is inspected.
- **Pinned root:** selecting another card (or clearing selection) does not re-root or end the
  stack. The inspector follows the selection. The selected card gets the normal `inspected`
  outline on top of its badge, but not its own neighborhood emphasis.
- **Ends only when:**
  - the button (or menu item) is pressed again
  - **Esc** is pressed. Esc is layered: open menus and resize cancellation take it first, then the
    stack. A second Esc performs today's clear-selection/fullscreen behavior.
  - the root card is no longer displayed: removed from scope, its container collapsed, a level
    switch, undo, or a Changes recapture. The stack never silently re-roots to a container.
- **State:** `outgoingStackRootId: string | null` on the per-tab `Journey`. It is **outside undo
  history** (a `TRANSIENT_UPDATE`, like `fullscreen`). Clone tab copies it, and
  `revalidateJourney.ts` prunes it.

## Visual treatment

These are applied on top of the ADR 0008 palette (`HALO.out` = `#0EA5E9`):

- **Replaces the selection emphasis** while active: no `flow-in` / `rel-in` / `rel-both`. The root
  keeps its `inspected` look.
- **Muted:** everything outside the chain (root set, layered and covered cards). Ancestors
  (containers) of chain cards stay unmuted, as today.
- **Root look:** every layer-0 card (the root and, for an expanded root, every drawn card inside
  it) takes the root's `inspected` look; the pressed toggle stays on the root card only.
- **Routes:** every drawn chain route (see Traversal): forward, cross-layer and back edges alike.
  They get the selected-route treatment: moving dashes plus the `HALO.out` underlay, with their
  factual line color and pattern kept. A drawn route that only carries relationships outside the
  chain stays muted, even between two chain cards.
- **Chain cards:** a thin, **static** `HALO.out` outline (not the pulsing `rel-out` halo).
- **Layer badge:**
  - a rounded square containing the layer number, anchored to the card's **top-left** corner and
    overlapping the card edge by half
  - `HALO.out` border with a **moving dashed** stroke, in phase with the route dashes (shared
    `animationPhase`)
  - widens for two or more digits
  - drawn on the existing direction overlay canvas (`drawDirectionRef`), not in the card SVG
  - keeps a **minimum on-screen size** at low zoom (it may overlap neighbours but stays legible)
- **Reduced motion:** badges and routes stay dashed but static.

## Out of scope

- An incoming stack (the mirror image). The helper should take a direction parameter so this is
  cheap later, but no UI is added for it.
- Reordering, arranging or fitting the map to the chain.
- Traversing through filtered kinds or cards out of scope or off the page. (Collapsed internals
  *are* walked since 2026-09-25: the walk runs over facts, see Traversal.)

## Verification

- `node scripts/test-outgoing-stack.mjs` covers:
  - the collapsed-hub case at class, package and method granularity
  - method roots ignoring class-level and class-target facts
  - layer = minimum over represented entities; nearest drawn ancestor as representative
  - entities with no drawn representative; ancestors of the root
  - cycles and self-loops, an expanded root, a reached expanded box with covered cards
  - removed-fact exclusion, the kind filter, chain routes via `occurrenceIds`
  - `direction: 'in'`, an empty stack, order independence
- Journey tests cover the transient root, clone copying, pruning on removal, and Esc layering (at
  the App level, if testable).
- `cd frontend && npx tsc -b --force && npm run build`
- `python3 scripts/verify_stable_graph_pipeline.py acceptance`, extended with a stack scenario:
  1. activate the stack
  2. badges 1..N present
  3. select a layer-2 card (root stays)
  4. expand a chain card (package root: layers unchanged, the box keeps its badge, its children
     are covered)
  5. Esc (stack ends and the selection remains)
  6. Esc again (selection cleared)

  Also assert that no card positions or camera changed. Screenshots go to
  `docs/evidence/outgoing-stack/` and are inspected.

## Implementation notes (2026-09-24)

- **Helper (original signature, superseded by the 2026-09-25 note below):**
  `outgoingStack(cards, routes, rootId, direction = 'out')` in `outgoingStack.ts`
  takes `projectDisplayed`'s output directly. Its nodes carry `containerId`, so the container map
  comes from the same input as the card IDs. It returns `null` when the root is not drawn, and
  otherwise `{ layers, rootSet, chainEdgeIds, depth, count }`. `count` is the number of layered cards,
  so the root set is not counted. `stackSummary` builds the "Outgoing stack: N layers · M resources"
  line, singular for 1. `direction: 'in'` walks the same routes reversed, but no UI uses it.
- **Where it is computed:** App computes the stack once with `useMemo` over the projected nodes, edges
  and root. It passes the result to `GraphCanvas`, which only applies classes and draws badges, and the
  inspector line uses the same result. The plan had `GraphCanvas` computing it. Moving it up avoids a
  second computation for the inspector.
- **Outside undo history (accepted deviation from "a `TRANSIENT_UPDATE`"):** `outgoingStackRootId` is
  kept out of history the same way ADR 0009 keeps selection out. Toggling it is a selection-only
  `UPDATE` (no entry, redo kept). `UNDO`/`REDO` carry the current root into the restored entry and
  prune it. A `TRANSIENT_UPDATE` writes the root into every past and future entry. If an undo then
  pruned the root, a redo would restore an entry that still carries it, so the stack could come back
  after its root left the map. That breaks "never silently re-roots". The phase B handoff allowed
  either approach, provided the choice was justified here.
- **Ending when the root leaves the map:** `revalidateJourney.pruneStackRoot` runs inside the
  reducer on every `UPDATE` and on `REVIEW_RECAPTURED`. It projects the map only when a stack is
  shown and the display inputs changed (mode, scope, level, displayed IDs or expansions). The hook
  passes `graphFor`, the same lookup undo/redo use, so children of expanded cards count as drawn.
  Without a graph it falls back to the view's own displayed record. This covers scope removal,
  collapse, level switch, a Changes toggle and a recapture, with no App-level effect and no extra
  render. The mode-switch revalidation also drops a root that the target graph lacks.
- **Button:** the toggle sits in the card's top button row, immediately left of the leftmost corner
  button, or left of an expanded box's collapse square. Like the other corner buttons it takes no
  pointer events: the canvas hit-tests it, so hovering and dragging the card still work. It is
  hit-testable only where it is drawn (selected card, hovered card, root). Below the corner
  buttons' minimum on-screen size it is hidden, including the pressed state on the root. The
  context-menu item stays available at any zoom.
- **Root look:** the root takes the `inspected` style as a class of its own (`stack-root`). Like
  inspection, it sits before the Changes fills, so a changed root keeps its factual change color.
- **Badges:** they are drawn above the cards on the direction overlay: height 30 model units, at least
  20 px on screen, 50% wider per extra digit. The dash pattern is the route's [8, 5], scaled to the
  badge, with the same phase. Every draw publishes `atlas:directionOverlay.badges` to Cytoscape
  scratch for the browser check.
- **Browser acceptance (user decision, 2026-09-24):** the legacy
  `verify_stable_graph_pipeline.py acceptance` still clicks the Class/Method switcher that ADR 0007
  removed. The scenario therefore lives in the standalone
  `scripts/verify-outgoing-stack-ui.mjs`, which also covers Changes mode on a small generated Git
  fixture, the context menu, keyboard activation, low zoom, reduced motion and 375 px.
- **Fact-level traversal (user decision, 2026-09-25):** supersedes "Graph: only the routes
  currently drawn on the canvas" and the "Out of scope: ... collapsed internals" bullet. The walk
  follows raw relationship facts at the root's granularity (Traversal). The helper's signature
  became `outgoingStack({ graph, cards, routes, rootId, kind, direction })`, where `graph` is the
  full graph the tab renders (ordinary or Changes) and `cards`/`routes` are `projectDisplayed`'s
  output. The result gains `coveredIds` (cards inside a layered expanded box). `depth`, `count`,
  `null` for an undrawn root and `stackSummary` are unchanged. Consequence: for a package root,
  expanding a downstream package no longer changes layers; the reached package's own box carries
  the badge and its children are covered.
- **Root look for the whole root set (review follow-up, 2026-09-25):** `stack-root` is applied to
  every layer-0 card, not only the pinned root, so the inside of an expanded root no longer reads
  as muted-but-unmarked (`docs/OUTGOING_STACK_REVIEW.md`).
