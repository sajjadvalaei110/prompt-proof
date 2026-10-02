# ADR 0017: Add blocks fill a box's empty space; empty packages and types expand in design mode

- Status: Accepted
- Date: 2026-10-02
- Amends: ADR 0015 §1 (the add slot) and its consequence "a new card may land a row lower than its slot"
- Scope: `expansionLayout` (`designBlocks`, `boxWithBlocks`, `RoomCard.blocks`), `placementGeometry`
  (`addSlotSizes`, `expandsWhenEmpty`, `slots` as a list), `nodeCard.hasDetailsButton`, `GraphCanvas`
  (block hover and click, the empty box), `App` (`toggleExpand`, `startInlineAdd`, `Growth`,
  `makeRoomForGrowth`, `resizeContainer`)

## Context

ADR 0015 gave every expanded package or type in design mode one full-size empty slot, always placed in
a new row below its children. Every expanded box therefore grew by a whole card row the moment Design
was on, even when it already had empty space: a short last row in a parsed package, or a box the user
had resized larger. The owner asked that:

1. a box should not stretch just to fit the "+ class" button;
2. hovering any empty block in an expanded package should show "+ class" (and "+ method" in an expanded
   class);
3. the box should grow only when no empty block is left, and that block may be smaller than a card;
4. an empty package or class should expand in design mode onto a single block for its first class or
   method. Before this, it could not expand at all.

## Decision

All of this applies only in design mode (Design on, Changes off). With Design off, and in Changes, the
geometry and the expand rules are unchanged.

### 1. Gaps first, a reserve only when there is none

`expansionLayout.designBlocks(topLeft, children, minSize, card, least)` is pure and returns
`{ gaps, reserve }`. It is the only rule; `geometryForJourney`, `toggleExpand`, `resizeContainer` and
`roomMoves` all use it, through `boxWithBlocks`.

- A **gap** is a spot inside the box's current inner area (children plus the user minimum, padding
  excluded) where a full card (`card`: a class card in a package, a method card in a type) fits beside
  its children. The card must not touch any child, keeping the grid's 32 px gap.
- Candidate spots are the inner top-left corner, the spot right of each child, and the spot below each
  child. They are scanned top to bottom, then left to right.
- The box's own right and bottom edges may clip a gap, down to `least` (`MIN_CARD_SIZE`, 180×130).
  A child may never clip it. A card created in a clipped gap grows the box right or down. It never
  overlaps a sibling: nothing reflows the children inside a box.
- Gaps are searched on the box **without** the reserve. This way the reserve's own row can never count
  as a gap and flip the result back and forth.
- Only when there is no gap is there a **reserve**: a `least`-sized block where `placeMissingChildren`
  puts the next child, in a new row at the left. The box grows to hold it, right and down only, as before.
  The reserve is smaller than a card, so the stretch is smaller than in ADR 0015.

### 2. Hover shows the one block under the pointer

- `JourneyGeometry.slots` and `DesignCanvas.slots` are now a list of blocks per box: its gaps, or its
  one reserve.
- `cornerHit` reports `'add'` inside any block. The hover key names the block by its model corner
  (`blockKey`), not by its index. A key left over after the blocks change can then never light the block
  that moved into that place.
- Only the hovered block is drawn, as the "＋ class" / "＋ method" button. Hovering elsewhere in the box
  shows nothing.
- `cy.scratch('atlas:designBlocks')` exposes the blocks in model coordinates for the browser checks.
- A card menu "Add …" on an expanded box uses its first block.

### 3. A card created in a block keeps the block's top-left corner

- Blocks are top-left anchored. The draft is drawn full-size from the block's corner.
- On commit, `pendingGrowth` carries the new card's stored centre. The reconciliation that admits the
  card stores that centre in the parent's `childPositions` with `ARRANGE_AROUND_RESOURCE`, then makes
  room.
- This runs only in the tab the card was typed in, inside `RECONCILE_ALL`, so it stays outside undo
  history.
- This replaces "placed below the others by `placeMissingChildren`". The ADR 0015 limit "a new card may
  land one row lower than its slot" is gone.

### 4. Empty packages and types expand in design mode

- `hasDetailsButton` also accepts `designExpandable`. `GraphCanvas` sets that flag on a package or type
  with no children, only while design mode is on. The flag therefore changes the card image (its corner
  button) only in design mode.
- The card menu's Expand, and `toggleExpand`, follow the same rule. Outside design mode an empty box
  still does not open.
- An empty expanded box is one **card-sized** block at the card's top-left corner. The first card fills
  that block exactly, and the header has room for its label.
- Cytoscape has no compound for a node without children, so the box is drawn as a plain node:
  - `node[?expanded][?emptyBox]` takes `minW`/`minH` (the block, or a larger user minimum) as its size;
  - the reconciliation positions it so that its top-left corner is the card's own corner. `cardMove`
    reads the same anchor back on a drag.
- When its first child arrives, it becomes an ordinary compound.

### 5. Room-making keeps the reserve and measures nested growth against the boxes before the change

- `RoomCard.blocks` lets `roomMoves` recompute an ancestor box with its reserve (`boxWithBlocks`) as the
  cascade goes up. Before this, the cascade dropped the reserve, and the map card below an expanded box
  moved **up** into it when a child inside grew.
- `Growth.boxes` snapshots every expanded box when the card is committed. `makeRoomForGrowth` measures
  the cascade against those boxes. Before this, a box inside a box was measured against the outer box
  as it was after the change, so the cascade stopped at once. The outer package then overlapped the
  cards below it.
- Both are fixes to ADR 0015 behaviour that this change made visible. Neither changes Design-off
  geometry: with Design off and in Changes, `blocks` is null, and the growth path runs only for design
  creates.

## Consequences

- An expanded box with a gap does not change size when Design turns on. A full box grows by one small
  block, not by a card row.
- Gaps follow the stored layout. Cards created in reserves stack in a column at the box's left, so
  gaps mostly come from parsed packages with a short last row, from boxes the user resized larger, and
  from dragged children.
- An empty box's header label shares its width with the corner buttons, as in any narrow box. A long
  name can run under them.
- An empty expanded box stays expanded when Design is turned off. It is then drawn as before: a
  childless dashed node the size of its card. Design-only cards are parked anyway.
