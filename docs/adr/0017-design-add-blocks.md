# ADR 0017: Add blocks fill a box's empty space; empty packages and types expand in design mode

- Status: Accepted. "Round 2" below supersedes §2 and §3 and amends §1 (the least block is 220×150, and the
  natural spots are scanned with more edges). "Round 3" (review fixes) amends §1, §4, §6 and §7. "Round 4"
  (2026-10-03) replaces the reserve of §1/§7 with a growth band, makes a hovered box always show a block
  (amends §2, §6, §9, §10), draws the draft at the true zoom (supersedes `DRAFT_MIN_SCALE` and the external
  error of §9) and names planned members by their name alone. Where a section and a later round disagree, the
  later round holds.
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
- The box's own right and bottom edges may clip a gap, down to `least` (`MIN_CARD_SIZE`, 180×130; 220×150
  since Round 2, `DESIGN_LEAST_BLOCK`).
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
- `cy.scratch('atlas:designBlocks')` exposes the blocks in model coordinates for the browser checks. (Since
  Round 2 it holds a box's fixed blocks only, its gaps or its reserve. The block under the pointer is
  `atlas:designHover`, and the empty space a hover may use is `atlas:designAreas`.)
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
- A drag reads its anchor back with the exact inverse of that position (`cardMove`). The bounding box
  includes the border, so reading the anchor from it would move the box 2 px on every drag.
- Outside design mode (Design off, or Changes), App's projection draws a childless expansion as its
  card (`expanded: false`). That covers both one opened empty in design mode and one emptied by a
  scope edit. Geometry already gives such an expansion no box, so drawing, room-making and drag agree.
  The card looks and behaves exactly as an unexpanded one. Before this, a childless expansion was drawn
  as a padded dashed node, and every drag stored its anchor 44 px off.

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

## Round 2 (owner feedback, same day): a block anywhere empty, in the card's exact shape

The owner found that a box with plenty of empty space offered only two fixed places to add a class or
method. They asked for a resource to be created **anywhere empty**. They also asked that the card, once
created, be **no bigger than the shape the block promised**. This round supersedes §2 and §3.

### 6. Hover anywhere empty

- `expansionLayout.freeRect(inner, children, p)` is the largest empty rectangle around the pointer
  inside the box's inner area that keeps GAP from every child. It starts from the whole inner area. Each
  child in the way, nearest first, cuts the rectangle on the side away from the pointer, and the cut that
  leaves the most room is kept.
- `addBlockAt(area, p, card, least)` is a card-sized block centred on the pointer. It is shifted and
  shrunk to stay inside that free rectangle, and never made smaller than `least`. It returns null on a
  child, within GAP of one, or where less than `least` fits.
- `JourneyGeometry.areas` (`{ inner, children }` per expanded box, design mode only) goes to
  `DesignCanvas.areas`. `GraphCanvas` calls the pure `addBlockAt` on mousemove and click; it computes no
  geometry of its own.
- A reserve, or an empty box's single block, is still offered where it is.
- `designBlocks.gaps` keeps two jobs: it tells whether the box has room at all (otherwise a reserve
  appears), and its first gap is where a card menu "Add …" puts its card. Gaps are now as large as the
  free space allows, up to a card, instead of requiring room for a full card.
- A block a card now covers, such as the one just used, is dropped until the pointer moves again. A stale
  "+" therefore never shows on the new card.

### 7. The card takes the block's exact shape

- The draft is drawn at the block's model size, scaled by the zoom like a card, so it is exactly the
  shape that will be created.
- On commit, `Growth.child` carries the block's centre and size. The reconciliation that admits the card
  applies `RESIZE_RESOURCE` (position and size together, inside `RECONCILE_ALL`, outside undo history).
- Every block lies inside the box's inner area, so the card created in a block never grows the box itself.
  Requirement 4 still applies after that card exists. If the card took the box's last free space (the first
  card of an empty box, or the last gap), the box now has no gap left, so it keeps one 220×150 reserve, and
  that reserve grows it right and down. This is by design, not a broken shape promise: the growth is for the
  next card's reserve, never for the card just made.
- The smallest block (`DESIGN_LEAST_BLOCK`) is 220×150, up from 180×130. A card made in a small space
  takes that size, and 180×130 cut a two-line name ("AuditQuery" showed as "Audit").

## Round 3 (review fixes, same day)

An external review (`docs/review/design-add-blocks-review.md`, 35 findings) found real defects, false doc
claims and some wrong findings. The full per-finding answer is
`docs/reviews/design-add-blocks-review-response.md`. This round records the decisions that change the
contract above.

### 8. The free rectangle is exact, and blocks never leave it

- `freeRect(inner, children, p, fit?)` no longer cuts greedily, nearest child first. It scores every maximal
  empty rectangle that contains `p`:
  - left edges: the inner edge, or a child's right edge plus GAP;
  - right edges: the inner edge, or a child's left edge minus GAP;
  - top and bottom: set for each such column by the children in it.

  The best one wins, in this order: a `fit.least` block fits; then the largest area capped at `fit.card`;
  then the largest raw area; then the first found (nearest edges first). The same geometry therefore always
  gives the same answer: no flips across a tie (review F6, F24).
- `addBlockAt` looks only at children within a card's reach of the pointer.
  - The block's corner snaps to `ADD_BLOCK_SNAP` (8 model px).
  - Where the block is clamped to the free space, it sits exactly on that edge. Nothing is rounded after the
    clamp, so fractional bounds never push it past the inner edge or into a child's GAP (F4).
  - A block is never smaller than `least`, within float precision; it no longer gets the 0.5 px tolerance.
- `designBlocks` builds a gap at a natural spot even when that spot lies inside a child's GAP or above the free
  space: the gap starts where the free space starts. Spots at the top of each child's column are natural
  spots too. Open space is found, and no spurious reserve grows the box (F5).
- Cost, measured in `test-expansion-layout.mjs` with 100 children:
  - `designBlocks`: about 1 ms, down from 5–10 ms;
  - 1000 hovers: about 3 ms, down from about 23 ms (F8).

### 9. Hover, click and draft in the canvas

- `hitAt` returns the hit and its block, so a mousemove computes the block once.
- The hover key names the snapped corner, so React re-renders only when the block moves, not on every
  pointer pixel (F7, F19).
- A click creates in the block that is drawn (`addHoverRef`).
- The corner squares are hit-tested before the blocks.
  - F1 claimed that a block covers an empty box's collapse square. That is not reproducible: the squares sit
    in the 44 px header band, and every block lies inside the inner area.
  - The real defect nearby: a double-click on an empty box's inner area was swallowed. It now opens the
    design popover, which replaces the draft the first click opened.
- `blockStillOpen` drops a hover block once its box moved or shrank away from it (F9).
- The draft's outline is the block's exact shape at the zoom.
  - Its content is drawn at the card's model size, scaled by the zoom but never below 0.6 (`DRAFT_MIN_SCALE`).
    Zoomed far out it spills over the outline and stays usable.
  - A rejected name is a label attached under the outline, unscaled (F16, F18).
- An empty box getting its first child is no compound yet in that batch. Its position is left alone, so there
  is no spurious write and no `arranged` event (F20).
- `emptyBoxCenter` / `emptyBoxAnchor` (pure) draw an empty box and read a drag back (F32).
- Design mode is an explicit parameter of `hasDetailsButton` / `cornerButtons` / `nodeCard`, not a field set
  on the node (F35).

### 10. An empty box's first card goes at its corner (amends §4 and §6)

- An empty box resized larger keeps one **card-sized** block at its top-left corner, not one block as large
  as the box. A hover anywhere in its inner area offers that block (`AddArea.only`), and the box keeps its
  resized size (F17).
- The first card is not placed under the pointer.
  - Cytoscape derives a box from its children, and min-size grows it right and down only.
  - A first card anywhere else would therefore move the box's corner to that card and grow the box by the
    same offset, breaking §3 and the box's anchor.
  - Once the first card is in, the rest of the resized box offers blocks anywhere, as §6 says. This is a
    deliberate exception to "under the pointer" for the first card only.

### 11. Pending pins and growth wait for their card; every tab gets the shape (amends §7)

- `pendingPins` and `pendingGrowth` are keyed by the new card's node id. `takeAdmitted` hands an entry only to
  the reconciliation in which that card is in the graph. An unrelated reconciliation, such as the 4 s agent
  overlay poll landing while the create is in flight, keeps the entry for the next one. A failed create
  removes its entry (F3).
- `RECONCILE_ALL` passes each tab its id. `Growth.tabId` names the tab the card was typed in:
  - that tab only pins the card where it was typed and makes room around the box (ADR 0015);
  - every other tab whose box shows the card gives it the block's shape too, placed below the box's other
    children like any new card, with the place stored alongside the size (F10).

  Other tabs do not make room, as in ADR 0015, so their box may then overlap a neighbour until it is
  arranged.

### 12. Childless expansions outside design mode (amends §4)

- `graphModel.childlessExpansionsAsCards` (pure) draws an expansion with nothing drawn inside as its card,
  marked `drawnAsCard`. This applies:
  - outside design mode: one opened empty in design mode, or one emptied by a scope edit;
  - in any mode: an ungrouped box with nothing left inside, which would otherwise draw nothing, take no
    events and be lost (F11).
- Toggling Design still moves nothing.
- A box with nothing drawn inside offers no Ungroup, neither the square nor the menu item (F11).
- A `drawnAsCard` card is still an expansion, so its card menu offers **Collapse** (F12, F22, F28). The collapse
  is measured in design-mode geometry (`collapseRoomAsInDesign`):
  - its box is its empty box;
  - every box around it keeps its add blocks as the cascade goes up, exactly as when it expanded.

  It is measured on the design-merged graph (outside Changes), so a design card parked while Design is off counts
  as it did in design mode, and moves with the room given back. A round trip (expand with Design on, Design off,
  Collapse) therefore puts every other card back, parked design cards included; the browser check asserts it to
  1 px. Measured against the Design-off boxes instead, the cascade stopped at the package
  around it, and the cards below kept the 66 px the expansion had pushed them.
- For an expansion emptied by a scope edit with Design off, the same rule gives back the room of its empty box
  in design mode. The room its children took was already left in place by the scope edit.

### 13. Layout export keeps a resized box's size

- The design brief's layout block (ADR 0016) did not carry an expansion's `minSize`. A resized box came back at
  its children's size, and the design-only import check found it.
- It now carries `minSize` (`designExchange.captureLayout` / `applyLayout`), so a resized box comes back at its
  size, with the blocks its cards were made in.

### 14. Header labels stop short of the corner squares

- `containerLabelLayout` (pure) leaves an expanded box's header label as it was when it fits between the corner
  squares' bands; wide boxes are unchanged.
- Otherwise the label moves left by half the band and is limited to the space left of the squares. The renderer
  ellipsizes the rest.
- A card's `mouseout` drops the hover block only when it leaves the box that owns the block. A pointer moving
  from a card onto its box's empty space keeps the block that space's `mousemove` set.

### Limits kept

- The keyboard "Add …" (card menu) creates in the box's first gap; there is no keyboard way to pick another
  gap (F23).
- A drawn compound sits up to 2 px further out than its model box where a card meets a user-resized inner edge.
  Cytoscape pads its children's bounding boxes, which include their borders. The model box, which room-making
  uses, does not change.
- Undo past a design create restores a history entry that never had the new card's size or place. Design edits
  stay outside undo history (ADR 0015), and `RECONCILE_ALL` updates only each tab's present, so the card is
  then placed like any new card. Redo brings the present back.
- The journey layout (positions, sizes) is not persisted across a page reload at all. That is not specific to
  add blocks.
- A grip dragged off the canvas is unmounted, ending the resize there.
- Changes mode with a childless expansion is covered by the pure projection test only, not by a browser run
  (the design pipeline's fixtures have no Git history).

## Round 4 (owner feedback, 2026-10-03): a growth band, a block always shown, the draft inside its block

The owner reported three problems:
- a full box grew by a fixed bottom-left block, which read as the old "+ class" button, and hover creation did
  not work in the space it added;
- the name-entry draft was larger than its dashed outline, and larger than the package;
- planned methods read `search()` or `find(Long)`, unlike parsed methods.

They chose the band rule below, and added one requirement: while the pointer is over an expanded package or
class, a "+ class" / "+ method" block is always shown, under the pointer wherever a card fits there.

### 15. A growth band replaces the reserve (supersedes the reserve of §1 and §7)

- When `designBlocks` finds no gap, it returns a **band**:
  - **position:** a strip `GAP` below the lowest child, from the inner left edge;
  - **width:** the inner width, at least one card;
  - **height:** one card (`card.height`: 206 for a class, 184 for a method).
- The box grows to hold it, right and down only (`geometryForJourney` through `minSizeWithSlot`, and
  `boxWithBlocks` for `toggleExpand`, `resizeContainer` and `roomMoves`).
- `AddArea.inner` is the old inner area plus the band. So `addBlockAt` offers a block under the pointer
  anywhere in it, with no special case and no fixed block.
- `JourneyGeometry.slots` keeps one job: the block a card menu "Add …" uses. That is the first gap, or the
  card-sized start of the band.
- Gaps are still searched on the box without the band, so the band never counts as its own gap:
  - **Room left in the row:** a card made in the band leaves gaps, so the band goes. The box keeps its height,
    because the band was one card tall and the card fills it.
  - **No room left:** a new band appears below.
- **Why below, as wide as the box (the owner's choice):**
  - it follows the grid's own growth (`placeMissingChildren` adds rows);
  - the box never widens by itself;
  - in a band at least a card wide, every block is a whole card, clamped at the band's ends and never shrunk.
- **Consequence:** a one-column box keeps growing as one column; its band is a single card. The box is
  widened with the resize grip, and that width is ordinary free space.

### 16. A hovered box always shows a block (amends §2, §6 and §9)

- **Where the pointer counts as over a box:** anywhere in it, including:
  - its header band and padding;
  - the slivers between cards;
  - over its collapsed child cards.
- **Nested boxes:** the innermost expanded box holding the pointer wins ("+ method" inside a class box that
  sits in a package).
- **Which block is shown:** `expansionLayout.addBlockNear` (pure) decides.
  - Where `addBlockAt` finds a block at the pointer, that block is shown with `under: true`.
  - Anywhere else, the block nearest the pointer is shown, with `under: false`. It comes from
    `AddArea.regions` (the gaps, else the band, else the empty box's corner block): it is the first region
    nearest the pointer, and in it the block nearest the pointer.
  - A box in design mode always has a region, so the result is never null. The unit fuzz checks that it stays
    inside the add area and keeps GAP from every child.
- **Shown is not the same as clickable.**
  - Only a block under the pointer is hit (`hitAt` → `'add'`). A click on the header, a corner square or a
    child card does exactly what it did before.
  - The nearest block is drawn calmer (`.design-slot.near`); a block under the pointer is `.hot`
    (`data-under`).
- **When no block is drawn:**
  - while a draft, quick popup or popover is open (`DesignCanvas.suppressBlocks`);
  - during a two-click relation, a card drag or a resize drag;
  - once the pointer leaves the canvas (onto a button over it, such as the relation handle, or off it);
  - with Design off, or in Changes.
- `blockStillOpen(area, block)` loses its `slots` argument: the band lies inside `area.inner`.
- `mouseout` keeps the block while the pointer is still inside the box that owns it, so crossing its cards
  never makes it flicker.

### 17. An empty box (amends §10)

- An empty box's add area **is** its card-sized corner block, and that block is its one region. `AddArea.only`
  is gone.
- In a box the user resized larger, a hover elsewhere shows the corner block as its nearest block, and only a
  click inside the block creates. The first card still keeps the box's corner (F17). The pointer now has to be
  on the block, not anywhere in the box.

### 18. The draft is the block (supersedes `DRAFT_MIN_SCALE` and the external error of §9)

- The draft's content is laid out at the block's model size and scaled by the **true** zoom, so content and
  outline always coincide.
- The layout fits the smallest block (220×150 model px):
  - kind line, 13 px;
  - name field, 26 px, larger than before so it reads at the usual zoom;
  - hint, 13 px.
- **Camera move.** When a draft opens below `DRAFT_READABLE_ZOOM` (0.5, where the name field's text would
  render under 13 px), the camera centres on the block at `DRAFT_FOCUS_ZOOM` (0.8). It zooms less if the block
  would not fit, and never zooms out.
  - At a readable zoom the user's zoom is kept. The camera only pans, and only if the block is partly off
    screen.
  - `expansionLayout.draftCamera` (pure) computes it.
  - It applies to every draft: blocks, the canvas "Add package" draft, and the draft below a collapsed card.
  - It is view-only state outside undo (ADR 0009), written as the zoom buttons write it
    (`__setProgrammaticCamera`, then `onCameraChange(…, transient)`).
- **Rejected name.** The error replaces the hint inside the outline: at most two lines, with the full text as
  its `title`, and the outline turns red.
  - **Why inside:** it stays with the block, never covers the package or its neighbours, and never makes the
    draft look larger than the card it will become.
  - The duplicate-name message names what was typed and its owner (`search already exists in AuditQuery`), not
    the full key, so it fits.

### 19. Planned members are named like parsed ones (supersedes Round 2's `displayName`)

- A planned method or constructor's card reads its name alone (`search`), as parsed members do.
- Its key, `Owner.search(String)`, is unchanged: it is the identity the API, export/import and agents use, the
  node id, and the `qualifiedName` the inspector shows under the name.
- Parameter types stay where parsed members show them:
  - the inspector's subtitle;
  - a class inspector's method list;
  - the design section's signature;
  - the Prompt text.
- **Overloads:** two planned overloads (`find(Long)`, `find(String)`) both read `find`, exactly as parsed
  overloads do.

## Consequences

- An expanded box with a gap does not change size when Design turns on. A full box grows by a band one
  card tall, as wide as the box, where a hover offers a block anywhere (Round 4, §15).
- A one-column box grows as one column. Space beside its cards appears when the box is resized larger or a
  child is dragged, and a block can then be made anywhere in it.
- A card made in a small space is smaller than a default card. It can be resized like any card.
- A narrow or empty box's header label is ellipsized before its corner buttons (Round 3, §14).
- An empty box opened in design mode keeps its expansion when Design is turned off, but it is drawn as
  its card until Design is on again. It then reopens on its block, at the same corner. Meanwhile its card
  menu offers Collapse, which gives back the room its box took (Round 3, §12).
- When a card fills a box's last free space, the box grows a new band below it (Round 4, §15).
- A hovered expanded box always shows a block, so the pointer never has to hunt for where a card can go
  (Round 4, §16).
