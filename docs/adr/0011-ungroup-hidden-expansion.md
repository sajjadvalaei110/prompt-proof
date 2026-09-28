# ADR 0011: Ungroup — an expanded card whose box is hidden

- Status: Accepted
- Date: 2026-09-28
- Scope: R6 Code map (ordinary and Changes modes), step 14

## Context

Expand-in-place (ADR 0007) draws a package's classes, or a class's methods, inside a box. The user
asked for the opposite of that box: a package should be able to "vanish and give all its classes to
the higher level", and the same for a class and its methods ("click a button and take out the
methods"). The request itself suggested that this might be "just disappearing the parent".

Packages are flat parser facts (no package contains a package), so the level above a package is the
map itself. The level above a class is the map, or the package box it sits in. Two models were
possible:

1. **Hidden box.** The parent stays expanded; only its box is not drawn.
2. **True promotion.** The children become ordinary cards on the page (or in the next box up) and
   the parent leaves the map. The displayed page would then mix packages with classes and methods,
   and `aggregateEdges`, `rankEligibleIds`, scope reconciliation, Show more, Changes mode and both
   relation stacks would all have to find a card by "nearest displayed ancestor" instead of by
   level.

## Decision

1. **Ungroup hides an expanded card's box.** `ExpansionState.hidden` (reducer action
   `UNGROUP_RESOURCE`) marks it; `projectDisplayed` flags the card `hiddenBox`. The children,
   their stored positions, nested expansions and route resolution are the existing expansion
   machinery, unchanged. Only an already-expanded box can be ungrouped. It is offered by a corner
   button next to the collapse square (two slots left, beside the stack toggle's slot) and by the
   box's card menu ("Ungroup X").
2. **Free movement.** A hidden box draws nothing: no fill, border, label, outline, halo, stack look
   or corner buttons, it takes no pointer events, and the minimap skips it. It never acts as one
   block:
   - make-room (`expansionLayout.roomMoves`), double-click arrangement
     (`focusedArrangement.arrangeDisplayed`) and the relation stack (a layer it would get goes to
     each freed card, outgoing and incoming alike) look through it to its children;
   - in the relation stack a hidden box represents only the entity it is itself (a package at
     package granularity, a class reached as a type). It never stands in for an undrawn member:
     such a member (out of scope) has no representative, counts beyond the map, and the walk stops
     there. A hidden box is never a stack root (`outgoingStack` returns null);
   - its computed box has no padding and ignores a stale user minimum.

   Freed cards can be dragged anywhere, including over another box, but membership never changes
   by position. Parser facts own structure.
3. **The hidden card is not on the map.** Selection, undo/redo pruning and stack-root pruning treat
   it as gone (`revalidateJourney`). Ungrouping drops it from the inspection and the
   multi-selection in the same update, and ends a stack rooted at it. It can still be picked
   outside the canvas (tree "View classes", search, inspector Back). It then lights and mutes
   nothing, the keyboard card menu does not open on it, and the inspector says "Ungrouped on the
   map" with "Arrange around this resource" disabled and no "View classes/methods" button (its
   children are already free on the map).
4. **Restore: "Collapse into X".** Any card or inner box whose nearest hidden ancestor is X offers
   it in its card menu. X returns as an ordinary collapsed card (`COLLAPSE_RESOURCE`), centred on
   its children's current bounds. Inner expansions are dropped, as ⊟ does. Nothing else moves.
   (⊟ itself still anchors the collapsed card at the box's top-left.) Both collapses drop every
   card that was drawn inside X from the multi-selection in the same update
   (`explorerJourney.collapseInJourney`, one undo entry), so re-expanding X never brings back a
   stale selection.
5. **History.** Ungroup and Collapse into are ordinary undoable entries. A scope edit keeps a
   trimmed hidden box hidden. A hidden package that leaves scope and comes back returns as a
   collapsed card.
6. **Method cards name their class.** A method or constructor card's sub-line reads
   `OwningClass · last.two.package` on every method card, cut from the end, so a method freed from
   its class still says where it lives.

## Alternatives considered

- **True promotion** (model 2). Rejected. It changes the level/eligibility model under every
  exploration feature, which is the most regression-prone area (`docs/STABLE_GRAPH_INTERACTIONS.md`).
  It would give the user nothing the hidden box does not.
- **Offer Ungroup on collapsed cards too** (expand and hide in one click). Rejected by the user:
  only a box already open can lose its box.
- **Restore as the expanded box, or undo only.** Rejected by the user in favour of a collapsed
  card.

## Consequences

- Every method card's image changed (the class name was added). Existing screenshot evidence for
  other features was deliberately not retaken (user decision, 2026-09-28).
- `revalidateJourney.sameExpansionMembership` now compares the hidden flag, so ungrouping
  revalidates a relation stack.
- `GraphCanvas` writes `hiddenBox` on every node refresh, because Cytoscape's `data()` merges and a
  stale flag would keep a collapsed card invisible. It also strips emphasis classes from hidden
  boxes, because the pulsing halo is a style bypass that would win over the stylesheet.
- Double-click arrangement of a visible expanded top-level box now moves its stored anchor by the
  box's offset, where it used to store the box centre. This is deliberate: it matches the drag
  anchor rule.
- Browser acceptance: `scripts/verify_ungroup_pipeline.py` (`verify-ungroup-ui.mjs`, 33 checks
  since the 2026-09-28 review remediation, `docs/evidence/ungroup/`).

## Amendment: review remediation (2026-09-28)

A review of step 14 found gaps in the rules above, now part of the decision:
- the stack representative and hidden-root rules in point 2;
- the inspector button in point 3;
- the multi-selection pruning in point 4.

It also found that opening a class from outside the canvas never worked inside a package box. This
was already broken on `main`. The tree's and inspector's "View methods", an HTTP entry point and
the `?selectedSymbol=` deep link now open the containers from `graphModel.revealContainers`: the
package, then, for a method or constructor, its own type. A nested type sits in its package box,
so its outer class is never opened. Each expansion resolves the card as drawn, and a step that
cannot land ends the reveal instead of waiting.
