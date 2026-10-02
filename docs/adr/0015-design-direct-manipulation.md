# ADR 0015: Design-mode direct manipulation, the agent prompt, and Design toggles that keep geometry

- Status: Accepted; amended by [ADR 0016](0016-quick-intent-plain-prompt-design-only-projects.md) (two-click relations default to
  CALLS, a quick intent popup follows every create, the Prompt is a plain request without report-back), and by
  [ADR 0017](0017-design-add-blocks.md) (§1: add blocks fill a box's empty space, a small reserve only when none is
  left; empty packages and types expand in design mode; a new card keeps its block's corner)
- Date: 2026-10-02
- Amends: ADR 0014 (design layer); `docs/STABLE_GRAPH_INTERACTIONS.md` (double-click row)
- Scope: `GraphCanvas` (design overlays, two-click relation, double-click), `expansionLayout` /
  `placementGeometry` (add slot), `explorerViewState` (pinned placement, carried parked children),
  `features/design/` (`DesignPopover`, `DesignPromptDialog`, pure helpers in `designModel`), `App`,
  `design.DesignPromptService`, `GET /api/workspaces/{id}/design/prompt`

## Context

ADR 0014 made the design layer authorable, but only through a modal (toolbar "+ Add", card menu →
`DesignEditorDialog`) and key fields. Relations were typed as keys. Toggling **Design** dropped the
geometry of every design card: `RECONCILE_ALL` saw `design:` IDs as ineligible while hidden. The owner
asked for authoring by direct manipulation on the map and for a prompt that hands only the designed work
to an AI coding agent. The open decisions were settled in a grilling round on 2026-10-01, and every
recommendation was accepted.

## Decision

All of the following applies only in **design mode**: Design on, Changes off. With Design off, and in
the Changes overlay, behaviour is unchanged.

### 1. Add slots inside expanded containers

- An expanded package or type keeps one empty card slot: a class-sized slot in a package, a method-sized
  slot in a type.
- `expansionLayout.designSlot` places it exactly where `placeMissingChildren` would put the next child,
  so a card created there lands on the slot.
- `placementGeometry.geometryForJourney(..., { designSlots })` derives each visible box's slot and the
  inner minimum that holds it. App feeds that minimum to Cytoscape as `minW`/`minH`, which grow to the
  right and down.
- Turning Design on or off never runs `roomMoves` (Q4), so no other card moves. Expanding a box in design
  mode makes room for its slot too.
- When a new card fills the slot, the box grows by one row. The reconciliation that admits the card then
  shifts its neighbours with `roomMoves`. This happens only in the tab it was typed in, inside
  `RECONCILE_ALL`, so it stays outside undo history.
- Hovering the box shows "+ class" or "+ method" in the slot. Like the other corner buttons, it takes no
  pointer events: a click is hit-tested by `cornerHit` (`'add'`).

### 2. Instant inline creation (a local draft, Q3)

- A slot click or a card menu "Add class / interface / method" starts a draft. So does "Add package" on
  empty canvas, at the click point.
- The draft is a **DOM card** drawn where the new card will live, with its title input focused. It is not
  a Cytoscape node and is never in the journey, the history, the server or the 4 s poll.
- Enter commits one `putResource` change set:
  - a method's `name(Type, …)` sets its parameter types (`parseInlineName`, reusing `parseParameterTypes`);
  - a method named after its type becomes a CONSTRUCTOR (Q9).
- Esc, or blur with an empty name, cancels. A name the client or server rejects stays on the card as an
  inline error. A key that already exists is rejected client-side, because `putResource` would
  silently edit it.
- Placement of the committed card:
  - a top-level package lands where it was typed, through `PlacementDims.pinned`;
  - a card added under a collapsed container has no slot to fill, so its draft sits just below that card.
- The toolbar "+ Add" is removed. Other type kinds and the full field set stay in `DesignEditorDialog`
  ("Add other type…", "Add nested type…", the popover's "More…", and the inspector).

### 3. Relations by two clicks (Q1, Q2)

- Hovering any card or box shows a violet handle at the middle of its right edge, half outside the card,
  clear of the corner buttons.
- Click the handle, then click the target. Between the two clicks a dashed violet line follows the pointer.
  It is drawn on the existing direction-overlay canvas, never as a Cytoscape element, and is exposed as
  `cy.scratch('atlas:designLink')`.
- Esc or a click on empty canvas cancels. The card menu's "Draw relation from here" starts the same
  gesture from the keyboard.
- The second click creates the relation with a kind inferred from the endpoints
  (`defaultRelationKind`). The popover then opens on it, kind first:
  - member to member: CALLS;
  - type to interface: IMPLEMENTS, or EXTENDS between interfaces;
  - other type targets: USES_TYPE;
  - anything involving a package: DEPENDS_ON;
  - otherwise: CALLS.
- Changing the kind replaces the record, because kind is part of a relation's identity.

### 4. Double-click opens the design popover (a deviation from STABLE_GRAPH_INTERACTIONS.md)

- In design mode, double-clicking a card no longer arranges the map around it. It opens `DesignPopover`
  just above and to the right of the card: Intent first, then Details. The two are joined back into the
  one explanation, so ADR 0014 §3 holds.
- Double-clicking a designed route opens the same popover for its relation, with a picker when the route
  aggregates several.
- The inspector's "Arrange around this resource" still arranges. With Design off, double-click arranges
  as before.

### 5. The Prompt (Q5, Q6)

`GET /api/workspaces/{id}/design/prompt` (`DesignPromptService`) renders the **whole workspace's**
design layer as prose, with no JSON block and no parsed dependency dump. It contains:

1. A reading note: keys, what an intention is, and that the source code is authoritative.
2. **Build**: PLANNED authored resources.
3. **Change existing code**: explanations on parsed code, stated as requested behaviour changes.
4. **Relations to implement**: each `A -KIND-> B`, with the stated semantics: "the engineer wants A, or
   code inside A, to do KIND to B or to a resource inside B, for the reason given".
5. **Already implemented: verify**: IMPLEMENTED resources and relations.
6. **Needs attention**: ORPHANED and MISSING items, one line each.
7. A short **Report back** section (`AgentGuide.reportBack`) on the change-set API.

Each item carries just enough parsed context to locate it: key, kind, parent chain (each link marked
planned or existing) and signature where known. The toolbar **Prompt** button, next to Export, copies
the prompt and shows it in a dialog with Copy and Download. Export stays the full, importable brief.

### 6. Toggling Design keeps design geometry (Q7)

- The toggle stays a global, per-viewer preference.
- While Design is off, App unions the design-merged graph into the graph it parks (`unionGraphs`).
  Design IDs then stay parked through every reconciliation, exactly like the Changes overlay's hidden
  cards. Their positions, sizes and in-box positions survive, and turning Design on shows them where
  they were. Changes parks the design-merged map too.
- Exception, as asked:
  - if a box holding parked cards is dragged, arranged or shifted to make room, `carryUnreportedChildren`
    moves them by the box's delta, through nested boxes;
  - if the box is collapsed, its expansion and their positions go, and they re-enter at the default
    layout.

## Consequences

- `STABLE_GRAPH_INTERACTIONS.md`'s double-click row holds with Design off. In design mode, double-click
  is the popover.
- Box minimum sizes differ by the slot between design mode and Changes, or Design off.
  `verify_git_review_pipeline.py`, `verify_ungroup_pipeline.py`, `verify_change_edges_pipeline.py` and
  `verify_stable_graph_pipeline.py` therefore start their pages with Design off: they pin the Design-off
  contract.
- The slot is placed from the children's drawn boxes, while a new child is placed from stored card
  sizes. They differ only when a child of the box is itself expanded. Then the new card may land a row
  lower than its slot.
- A design card added under a collapsed container is not visible until that container is expanded.
  The status line says where it went.
