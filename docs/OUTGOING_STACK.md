# Outgoing relation stack (and its incoming mirror)

Status: implemented (2026-09-24, step 12 phase B). The **incoming stack** was added 2026-09-28 (user
decisions, see "Incoming stack" below): the same button's second press shows the exact mirror in
the incoming color. Phase B built on top of
[ADR 0009](adr/0009-selection-outside-undo-history.md). Traversal revised 2026-09-25 (user
decision, see "Traversal" and the implementation notes): the walk follows parser facts at the
root's granularity, not the drawn routes. Extended 2026-09-25 (step 12 phase C, user decisions
D1–D5, [ADR 0010](adr/0010-candidate-calls-and-overrides.md)): the full journey from a method
root, with card-hop layers that never skip a number. D1 (candidate calls) was withdrawn the same
day at the user's request (ADR 0010 amendment "candidate calls reverted"): unresolved calls stay
UNRESOLVED and are not walked. See "Implementation notes" at the end for the
choices the design left open and the accepted deviations.

## Purpose

Show everything a resource (package, class or method) sets in motion on the current map, one
layer at a time:

- **Layer 1** is every card holding something the root has a relationship to (calls, depends on,
  injects, and so on).
- **Layer 2** is every new card holding something that a layer-1 resource has a relationship to.
- The layers continue until the chain reaches nothing new. A step between two things on the same
  card does not start a new layer, and the badges never skip a number.

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
  DEPENDS_ON / INJECTS edges and field edges.
- **Types reached from a method (D2, 2026-09-25):** at method granularity, a CONSTRUCTS, CALLS or
  USES_TYPE fact whose target is a type itself reaches that type as a **terminal** entity. Examples:
  `new X()` for a class with no declared constructor, a record's canonical constructor, `X::new`, or
  a parameter, return or local type. (A CALLS fact to a type came from D1 candidate calls, which
  were withdrawn; the helper still treats one as terminal, harmlessly.) The type is
  placed on its card like any entity, but the walk does not continue from it, since a type has no
  method-level facts. A `new X(..)` that resolves to a declared constructor targets that
  constructor, which does continue. Other type-targeted kinds (DECLARES_BEAN, for example) are not
  followed.
- **Dispatch (D3, 2026-09-25):** at method granularity an OVERRIDES fact (implementation ->
  overridden method, ADR 0010) is walked **reversed**: a call to an interface or abstract method
  continues to each in-source implementation as an ordinary step. At class and package
  granularity OVERRIDES is an ordinary forward fact, and class roots do not follow implementors
  (reverse IMPLEMENTS): Spring INJECTS already targets the implementation bean, and reverse
  IMPLEMENTS would fan out for widely implemented interfaces.
- **Facts walked:** every raw edge with a target, allowed by the current relationship-kind filter,
  and not `reviewChange = "REMOVED"` (a removed call does not exist in the working tree).
  Uncertain facts (`resolution != RESOLVED`) are walked like any other. Entity self-loops are not
  walked.
- **Representative card:** an entity's own card when it is drawn (even as an expanded box), else
  the nearest drawn ancestor on its parent chain (the collapsed card that contains it). An entity
  with no drawn representative (out of scope, not on the page) is not walked through, so the chain
  stops there (D5, 2026-09-25: the stack stays a lens over the map). Each distinct such entity that
  a chain entity leads to is counted as **beyond the map**.
- **Algorithm (D4, 2026-09-25):** a 0-1 breadth-first search from the root entity. A step between
  two entities with the same representative card costs 0, and so does a step between the root set
  and the root's containers, which count as one card. Any other step costs 1: a card hop. A drawn
  card's raw layer is the minimum distance over the entities it represents, and the raw layers are
  then ranked densely (1, 2, 3, ...). The badges therefore never skip a number, even when a card is
  re-entered later by a longer path. The root set (layer 0) is the root card plus every drawn card
  inside it; root-set cards and the containers of the root never get a layer, though the walk
  continues through what they represent.
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
    on hover. Since 2026-09-28 it has three states on the root: off -> outgoing -> incoming -> off.
    On any other card it starts a fresh outgoing stack there.
  - context-menu items, "Show outgoing stack" / "Hide outgoing stack" and (since 2026-09-28)
    "Show incoming stack" / "Hide incoming stack"
  - **Entry points → Explore** (step 13): reveals the route's handler method on the Code map,
    inspects it and roots an **outgoing** stack on it (sets `relationStack` to
    `{ rootId: handler, direction: 'out' }`, never toggles or cycles it; an incoming stack or a stack
    on another root is replaced)

  Both are keyboard reachable. The toggle is a focusable button. The menu opens from the keyboard
  with **Shift+F10** or the **ContextMenu** key, either on a focused corner button of the card or
  with the page focused and a card selected. It opens at the card, as a right-click on its center
  would, with focus on its first enabled item. The arrow keys, Home and End move through the items,
  Escape closes it, and focus returns to the button it was opened from, also after choosing an item
  (phase B review B1, 2026-09-25).
- **While active:** the button stays shown in a pressed state **on the root card**, whatever is
  selected. Its tooltip reads "Outgoing stack: N layers · M resources", with " · K beyond the map"
  appended when K > 0 (D5). The same line appears in the inspector when the root is inspected.
  Since 2026-09-28 the tooltip also says what the next press does: " (click for incoming)" or
  " (click to hide)". The inspector line has no such suffix.
- **Pinned root:** selecting another card (or clearing selection) does not re-root or end the
  stack. The inspector follows the selection. The selected card gets the normal `inspected`
  outline on top of its badge, but not its own neighborhood emphasis.
- **Ends only when:**
  - the button (or menu item) is pressed again. Since 2026-09-28 the root's button needs two more
    presses (outgoing -> incoming -> off), and a menu item ends only its own direction.
  - **Esc** is pressed. Esc is layered: open menus and resize cancellation take it first, then the
    stack. A second Esc performs today's clear-selection/fullscreen behavior.
  - the root card is no longer displayed: removed from scope, its container collapsed, a level
    switch, undo, or a Changes recapture. The stack never silently re-roots to a container.
- **State:** `outgoingStackRootId: string | null` on the per-tab `Journey`. Since 2026-09-28 this is
  `relationStack: { rootId, direction: 'out' | 'in' } | null`, one value, so switching direction on
  the same root is a selection-only change like re-rooting. It is **outside undo
  history** as a selection-only `UPDATE` (no history entry, redo kept), carried and pruned on
  undo/redo like selection (ADR 0009); see the implementation note "Outside undo history (accepted
  deviation ...)" below. Clone tab copies it, and `revalidateJourney.ts` prunes it.

## Visual treatment

These are applied on top of the ADR 0008 palette (`HALO.out` = `#0EA5E9`). An incoming stack
(2026-09-28) uses `HALO.in` = `#6366F1` instead wherever `HALO.out` appears below, and its chain
routes take `flow-in` instead of `flow-out` (see "Incoming stack", decision 4):

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

- ~~An incoming stack (the mirror image).~~ Added 2026-09-28, see "Incoming stack".
- Reordering, arranging or fitting the map to the chain.
- Traversing through filtered kinds or cards out of scope or off the page. (Collapsed internals
  *are* walked since 2026-09-25: the walk runs over facts, see Traversal.)

## Incoming stack (2026-09-28)

User request: "exact thing we have on outgoing stack but for incoming edges bfs", on the same
button, colored like the incoming halo when a resource is selected. Decisions from the grilling
round, all recommendations accepted:

1. **Button cycle.** On the root the button goes outgoing -> incoming -> off. On any other card,
   including while an incoming stack is shown elsewhere, it starts a fresh outgoing stack there,
   as the phase B re-root did. The aria-label names what a press does: "Show outgoing stack of X",
   then "Show incoming stack of X", then "Hide incoming stack of X". `aria-pressed` is true in both
   active states.
2. **Context menu.** Two direct items, "Show/Hide outgoing stack" (⇶) and "Show/Hide incoming
   stack" (⇇). Each roots its own direction on the card, or ends the stack when that direction is
   the one shown. Neither item cycles. The keyboard path and the right-click multi-selection cleanup
   (B1, B6) apply to both.
3. **Escape** ends the stack whatever its direction, with the same layering: menus and resize first,
   then the stack, then the selection.
4. **Color.** The incoming stack uses `HALO.in` (`#6366F1`) where the outgoing one uses `HALO.out`:
   the badge border (and a dark indigo number), the static chain-card outline (`stack-member
   stack-in`), the chain-route underlay (chain routes take `flow-in` instead of `flow-out`), the
   pressed button (`.map-stack-button.active.incoming`) and the inspector line
   (`.stack-summary.incoming`). The root keeps its teal `inspected` / `stack-root` look. Routes keep
   their factual line color, arrow and source-to-target dash motion, so in an incoming stack the
   dashes flow toward the root.
5. **Exact mirror.** `outgoingStack({ direction: 'in' })` reverses every step the outgoing walk
   keeps (Traversal, after the method-level rules), with the same granularity, representatives,
   0-1 BFS, dense ranking, covered cards, chain routes and beyond-the-map count. Consequences:
   - A type root reaches its implementors and subclasses (reverse IMPLEMENTS/EXTENDS). The outgoing
     stack deliberately does not follow implementors from a class root; the incoming one does,
     because "who depends on this interface" includes its implementations.
   - At method level, reversed dispatch gives `Impl.run` <- `Iface.run` <- the callers of
     `Iface.run`. A sibling implementation of `Iface.run` is not reached.
   - A method root's incoming stack never shows terminal types. Constructing or using a type is
     not a call of one of its methods.
   - "Beyond the map" counts callers or dependents with no drawn card, where the chain stops.
6. **Wording.** "Incoming stack: N layers · M resources", plus " · K beyond the map" when K > 0, in
   the tooltip and the inspector (`stackSummary(stack, 'in')`).

Implementation: `relationStack` on the `Journey` (see State). `cycleRelationStack` and
`toggleRelationStack` in `explorerJourney.ts` are the pure button and menu transitions. App computes
the stack with the root's direction, and `GraphCanvas` colors it by direction. The traversal code
did not change: `direction: 'in'` existed since phase B.

## Verification

- `node scripts/test-outgoing-stack.mjs` covers:
  - the collapsed-hub case at class, package and method granularity
  - method roots ignoring class-level facts; CONSTRUCTS/CALLS/USES_TYPE to a type as a terminal
    entity, a declared constructor continuing, field and other type targets ignored
  - dispatch through reversed OVERRIDES (one and two implementations), no forward OVERRIDES at
    method level, no implementors for class roots
  - layer = minimum over represented entities; nearest drawn ancestor as representative
  - card-hop layers without skips (the SubscriptionRepository shape) and dense ranking
  - entities with no drawn representative and the beyond-the-map count; ancestors of the root
  - cycles and self-loops, an expanded root, a reached expanded box with covered cards
  - removed-fact exclusion, the kind filter, chain routes via `occurrenceIds`
  - `direction: 'in'`, an empty stack, order independence
  - incoming (2026-09-28): the summary prefix, the collapsed-hub mirror at class and package level,
    reversed dispatch (impl <- interface method <- callers, no sibling implementation), no terminal
    types for a method root, an interface root reaching implementors (and an empty outgoing stack
    for it), beyond the map
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
- **Focus and selection (phase B review, 2026-09-25):**
  - A toggle that holds keyboard focus stays drawn while it has focus, even after it turns the
    stack off on a card that is neither selected nor hovered. It stays drawn unpressed, so focus is
    never dropped to the page (B4).
  - A right-click adds the card to the multi-selection, so a right-click and "Show outgoing stack"
    used to leave the root outlined as multi-selected. The menu now removes a card that this very
    right-click added when its action roots or ends the stack (B6). Closing the menu with Escape
    or a click elsewhere keeps the right-click selection, as before, so right-clicks can still
    build a multi-selection. Opening the menu from the keyboard never adds to it.
  - A tap on an unexpanded card's corner square that a chain route crosses still acts on the card:
    Cytoscape's default `z-index-compare: auto` draws and hit-tests edges below nodes. The review's
    B5 did not reproduce.
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
  fixture, the context menu, keyboard activation, the keyboard menu path and focus retention,
  low zoom, reduced motion and 375 px.
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
- **Full journey from any root (user decisions D1–D5, 2026-09-25, step 12 phase C,
  [ADR 0010](adr/0010-candidate-calls-and-overrides.md)).** Measured on real analyzer output,
  method roots missed most of their journey. `EventController.registerParticipant` was empty.
  - D1 (analyzer): an in-source call the symbol solver cannot resolve becomes an explicit
    CANDIDATE: to the unique name/arity match, else to the in-source receiver type. A call with no
    in-source receiver stays UNRESOLVED. **Withdrawn (2026-09-25, user decision, ADR 0010
    amendment "candidate calls reverted"):** one CANDIDATE among many resolved facts turned a whole
    route amber, and the map read as mostly yellow. Unresolved calls are back to `CALLS/UNRESOLVED`
    with no target, so a method root whose only call is unresolvable (the journey fixture's
    `SignupController.register`) again reaches only its parameter and local types. D2–D5 and the
    OVERRIDES facts are kept.
  - D2: CONSTRUCTS, CALLS **and USES_TYPE** to a type count for a method root, as terminal
    entities (the user chose to include USES_TYPE; the recommendation had left it out).
  - D3: a new OVERRIDES fact, walked reversed at method granularity, as an ordinary +1 step. Class
    roots do not follow reverse IMPLEMENTS.
  - D4: a card-hop distance (0-1 BFS). This supersedes the old "(so, rarely, a layer number can be
    skipped)" note, which was not rare: `SubscriptionRepository` showed badges 1 and 3.
  - D5: keep stopping at entities with no drawn card and count them: "· K beyond the map".

  Two choices the decisions left open:
  - Dense ranking. The 0-1 BFS alone can still skip a number when a card is re-entered by a longer
    path, so raw layers are ranked densely. This keeps "badges never skip" unconditional.
  - The beyond-the-map part is shown only when K > 0, so the existing summary line is unchanged
    for a stack that stays on the map. K counts distinct entities at the root's granularity
    (including terminal types), reached by a kept fact from a chain entity.

  The helper result gains `beyond`. `stackSummary` takes it, and the tooltip and inspector show
  it through the same function, so no UI code changed.
