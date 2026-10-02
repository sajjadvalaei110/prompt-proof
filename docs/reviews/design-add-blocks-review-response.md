# Response to the add-blocks review (ADR 0017)

This answers `docs/review/design-add-blocks-review.md`: 35 findings and 7 "false claims". It covers the code at
`1b52fae`.

Each item gets one status:
- **fixed**: changed in code or docs, with a test that pins it;
- **disputed**: the claim is wrong, and the evidence is given;
- **documented limit**: kept on purpose, and written down;
- **deferred**: not done now, with the reason.

The commits:
- `bea15be`: pure geometry;
- `14de86f`: canvas and App;
- `8d42f2a`: browser checks;
- the docs commit after them.

The decisions are in ADR 0017 "Round 3". Test outcomes are in `PROJECT_STATUS.md` ("Design layer round 4c").

Browser steps are those of `scripts/verify-design-layer-ui.mjs`. Its evidence is in
`docs/evidence/design-layer-ux/` (`report.json` holds every measured value quoted below).

## Findings

| # | Status | What changed / why | Pinned by |
|---|---|---|---|
| 1 | **disputed as described; hardened; a real neighbouring defect fixed** | See [F1](#f1). | Browser 2d: a real CDP click on the collapse square collapses it; a double-click inside the box opens the popover |
| 2 | **disputed as a behaviour defect; wording fixed** | See [F2](#f2). | Unit "design add blocks" (a full grid gives one 220×150 reserve); browser 2b, 2d |
| 3 | **fixed** | Pending pins and growth are keyed by the new card's node id (`App.tsx` `pendingGrowth`, `commitInlineDraft`). `designModel.takeAdmitted` (`designModel.ts:235`) releases an entry only to the reconciliation whose graph holds that card (`App.tsx:929`). An unrelated reconciliation keeps it. A failed create deletes its entry (`App.tsx:1012`). | `test-design-model.mjs` (takeAdmitted). Browser 2e: the create request is held back 9 s while an agent change lands through the 4 s poll. The class is asserted absent when the poll lands, and still takes its 250×172 block shape. **Negative control:** with the old consume-always rule this step fails (250×206). |
| 4 | **fixed** (by a different mechanism than proposed) | See [F4](#f4). | Unit "fractional bounds keep the block strictly inside (F4)": 4 pointers × snap 0/8 on `inner.x2 = 400.7`, child `x2 = 100.3` |
| 5 | **fixed** | `designBlocks` (`expansionLayout.ts:183`) snaps a natural spot to where the free space starts (`max(x, free.x1)`, `max(y, free.y1)`). It adds column-top spots `(c.x1, inner.y1)`. | Unit "designBlocks snaps natural spots… (F5)": the reviewer's layout gives no reserve. The band alone (c1 to the right edge) gives the exact gap `{232,132,482,338}`; space above a lower child gives `{600,0,850,206}`. |
| 6 | **fixed** (not with the suggested heuristic) | See [F6](#f6). | Unit "the free rectangle is exact and stable (F6, F24)": the reviewer's p=(400,300) case gives a full 250×206 block. Fuzz: 400 layouts with a brute-force completeness check, 0 missed. |
| 7 | **fixed** | `hitAt` (`GraphCanvas.tsx:541`) returns the hit and its block, computed once per mousemove (`:570`). The block's corner snaps to `ADD_BLOCK_SNAP` = 8 model px, so the key and the drawn "+" change only when the block moves; `updateDesignView` / `setDesignView` run only then. Geometry stays pure (`addBlockAt(..., snap)`). | Unit (snap cases, tie stability); browser 3b ("follows the pointer to within 4 px") |
| 8 | **fixed** (the severity was overstated) | Measured with the same 100-child benchmark. At HEAD: `designBlocks` 5.1–9.5 ms and 1000 hovers 22.7–24.9 ms, not "20–50+ ms". Now `addBlockAt` and the gap probes look only at children within a card's reach (`windowAround`), and `freeRect` sorts once per call: 0.6–2.6 ms and 2.2–3.1 ms. | Unit "100 children: …" (prints its timings; fails above 200 ms) |
| 9 | **fixed** | `blockStillOpen` (`expansionLayout.ts:165`) keeps a hover block only while it lies inside its box's current inner area with no card on it, or is still one of the box's fixed blocks. `updateDesignView` uses it (`GraphCanvas.tsx:491`). | Unit "a stale hover block is dropped (F9)": covered, moved box, vanished area, reserve kept |
| 10 | **fixed (multi-tab); disputed (reload)** | See [F10](#f10). | `test-explorer-journeys.mjs` (RECONCILE_ALL tab ids); browser 2e (cloned tab: 250×172) |
| 11 | **fixed** | No Ungroup square (`GraphCanvas.tsx:449`, `n.isParent()`) and no Ungroup menu item (`:1249`) for a box with nothing drawn inside. `graphModel.childlessExpansionsAsCards` (`graphModel.ts:313`) draws an ungrouped box left with nothing inside as its card in every mode. Previously it drew nothing and took no events, so it was lost. | `test-graph-model.mjs` (hidden empty box → `drawnAsCard`, `hiddenBox:false`, both modes); browser 2d (no Ungroup square or item on an empty box) |
| 12 | **fixed** | See [F12](#f12). | Browser 6a (RegionTag, with a design class typed into its package first): 3 parsed cards made room on expand, then Design off, then menu Collapse; 0 off by more than 1 px; the parked design class 767.5 → 833.5 → 767.5; no overlap added. Negative control: measured on the raw graph, the design class stays at 833.5. |
| 13 | **fixed** | `test-expansion-layout.mjs` loads the real `DESIGN_LEAST_BLOCK` / `addSlotSizes` through `placementGeometry`. It asserts `{220,150}` and the 220×150 reserve. | Unit "design add blocks", "make-room keeps the reserve block" (150 px) |
| 14 | **fixed** | `topLevelOverlaps` now groups cards by parent and checks siblings inside every container as well as on the map, with 1 px tolerance (not 4). | Every overlap assertion of the browser run |
| 15 | **disputed** | See [F15](#f15). | — |
| 16 | **fixed** | `DesignDraftInput`: the outline is the block's exact stage rect. Its content is drawn at model size, scaled by `max(zoom, DRAFT_MIN_SCALE = 0.6)` and anchored at the outline's corner; zoomed far out it spills over the outline. | Browser 2e: at zoom 0.3 the outline equals the block (75×61.8), the content scale is 0.6 and the input is ≥ 20 px tall (`05f-draft-zoomed-out.png`). Browser 2b: the outline equals the block, corner and size. |
| 17 | **fixed, with one deliberate exception** | See [F17](#f17). | Unit "a resized empty box offers its card-sized corner block…"; browser 2e (resize, a far hover offers the corner block, the first class keeps the model area) |
| 18 | **fixed** | A rejected name is a label attached under the outline: absolute, unscaled, `min-width: max(100%, 240px)`. It no longer overflows the fixed-height card unseen. | Browser 4b screenshot `09-inline-error.png` (inspected) |
| 19 | **fixed** | Same change as F7: one `hitAt` per mousemove. | as F7 |
| 20 | **fixed** | The reconciliation leaves the position alone for an expanded node that is no compound yet but gets its first child in this batch (`GraphCanvas.tsx:933`). No position write, no `arranged`. | Browser 1b / 4e `arranged` counters keep passing. Not asserted on its own: no step counts `arranged` across a first-child create. |
| 21 | **disputed** | See [F21](#f21). | `test-graph-model.mjs` (projection rule) |
| 22 | **fixed / documented** | Redo of an empty expansion with Design off restores the expansion, drawn as its card (F12): toggling Design moves nothing. The card is now collapsible from its menu, and the collapse gives the room back. ADR 0017 §12, Consequences. | Browser 2e (undo/redo with Design on); 6a (Design-off collapse) |
| 23 | **documented limit** | The keyboard "Add …" uses the box's first gap. A keyboard gap picker is new UI outside this round. ADR 0017 "Limits kept". | — |
| 24 | **fixed** | Same change as F6: exact enumeration with deterministic tie-breaking, so no sort-order crossover remains. | Unit "the free rectangle is exact and stable" (`at(499.9)` vs `at(500.1)`) |
| 25 | **fixed** | 2b asserts the reserve is exactly 220×150; 3b asserts the narrow card is 220–249 wide (measured 234). 2d and 2e assert the empty-box blocks are exactly 250×184 and 250×206. | browser |
| 26 | **fixed** | 2e hovers clamp exactly at the inner corner (`x2 = inner.x2`, `y2 = inner.y2`), keep GAP beside a child, give none within GAP of a child or on the header band, and give a shorter block below a child. Unit tests cover corners and edges as well. | browser 2e; unit |
| 27 | **fixed except (3)** | (1) Container resize, then add: done (2e). (2) Empty package: done (2e). (4) Undo/redo of an empty-box expansion: done (2e). (5) Dragging children to make new gaps: done (2e). NoteIndex is dragged 300 px right; a hover in the space it left, moving straight off the dragged card, offers a 250×172 block; NoteDraft takes exactly that shape, and no sibling overlaps (`05j-dragged-child-opens-a-block.png`). That step found a real ordering bug: a card's `mouseout`, firing after its box's `mousemove`, dropped the box's hover block. Now `mouseout` drops it only when leaving the node that owns it. (3) Changes mode with a childless expansion: covered by the pure projection test only; the design pipeline's fixtures have no Git history, so it is **deferred**. | as listed |
| 28 | **fixed** | Documented in ADR 0017 §12. The card menu offers Collapse for a `drawnAsCard` card (`menuExpand`, `canToggle`). | Browser 6a (menu lists Collapse, no Ungroup, no Expand) |
| 29 | **fixed (doc), reviewer's cause disputed** | See [F29](#f29). | Ungroup pipeline 33/33 on HEAD `1b52fae` (`build/ungroup/run-udjoru55`) and on the final jar (`run-ru8dkox1`) |
| 30 | **fixed** | TESTING.md says 220×150 and has a new "Add-block review fixes" section. | — |
| 31 | **fixed** | ADR 0017 header: Round 2 supersedes §2–§3 and amends §1; Round 3 amends §1, §4, §6 and §7. §1 notes the 220×150 least block. | — |
| 32 | **fixed** | `emptyBoxCenter` / `emptyBoxAnchor` (`expansionLayout.ts:225`) are used by the reconciliation and by `cardMove`. | Unit "empty box centre and anchor are inverses"; browser 6a (a drag lands with no creep) |
| 33 | **deferred** | See [F33](#f33). | — |
| 34 | **fixed** | The stale comment is gone. The new comment says the hover key names the block's snapped corner. | — |
| 35 | **fixed** | `hasDetailsButton(node, designMode)`, `cornerButtons(node, designMode)` and `nodeCard(node, size, designMode)` take design mode explicitly. `expandsWhenEmpty` moved to `nodeCard.ts`. `designExpandable` is gone from the node and from Cytoscape data. | `test-node-card.mjs` (explicit parameter; a stray `designExpandable` field no longer counts) |

## Findings that need more than a table row

### F1

**Disputed as described.**
- The collapse and ungroup squares sit at `y1 + 6 … y1 + 38`, inside the 44 px header band.
- Every block lies inside the inner area. The 1b52fae evidence shows the empty `AuditQuery` box at
  `x1 = 697.1, y1 = -13.2`, with its block starting at `743.1 / 32.8`: 46 px in, below the squares.
- So `blockAt` could not return a block over a square. The squares were clickable.

**Hardened anyway.** `hitAt` (`GraphCanvas.tsx:541`) tests the squares first.

**The real neighbouring defect.**
- A double-click anywhere in an empty box's inner area was swallowed: `cornerHit` returned `'add'`, so the
  popover never opened.
- `dbltap` now ignores `'add'` (`:623`) and opens the popover, which drops the draft the first click opened.

### F2

Requirement 3 says the box never grows *for the card made in a block*. Requirement 4 says a box with no block left
keeps one small reserve, which grows it.
- When a card fills the box's last free space (the first card of an empty box, or the last gap), the box has no
  block left. Requirement 4 then gives it a 220×150 reserve, and that reserve grows the box.
- That growth is for the next card, by design.
- The ADR sentence "creating a card in one never grows the box" was imprecise. ADR 0017 §7 now spells this out.

### F4

**Fixed, by a different mechanism than proposed.**
- The block is no longer rounded after the clamp. Its corner snaps to the 8 px grid, and only the clamp then
  applies, so a clamped block sits exactly on the free edge.
- The size is never floored, so a full card stays exactly 250 wide.

**Deviation from the owner's "ceil/floor" instruction.** Ceil and floor would also stay inside, but they lose up to
2 px of an exactly card-sized space. A card-sized empty box at fractional coordinates would then produce a 249 px
card instead of a card.

### F6

**Fixed, but not with the suggested heuristic.** That heuristic still fails the reviewer's own case: both cuts
from the nearer child leave at least the least block.

`freeRect` (`expansionLayout.ts:101`) is now exact. It enumerates every maximal empty rectangle containing p and
scores it:
1. a least block fits;
2. area capped at a card;
3. raw area;
4. the first found, nearest edges first.

### F10

**Fixed: multi-tab.** `RECONCILE_ALL` passes each tab its id (`explorerJourney.ts`), and `Growth.tabId` names the
typed tab.
- The typed tab pins the card and makes room, as in ADR 0015.
- Every other tab whose box shows the card gives it the block's size. It is placed below the box's other children,
  with the place stored so the size is not pruned.

**Disputed: reload.**
- No journey layout (positions, sizes, expansions) survives a reload at all. The only `localStorage` keys are view
  preferences (`showDesign`, `navWidth`, the diff layout, the heading).
- So the reload claim is not about add blocks.

### F12

`childlessExpansionsAsCards` keeps toggling Design a no-op. A `drawnAsCard` card's menu offers **Collapse**.

`toggleExpand` measures that collapse in design-mode geometry (`collapseRoomAsInDesign`, `App.tsx:592`):
- the box is the expansion's empty box;
- every box around it keeps its add blocks as the cascade goes up, exactly as when it expanded.

It is measured on the design-merged graph, outside Changes. With Design off the active graph has no design
cards, so a design card parked in a box would otherwise be left out, and would stay displaced.

Two earlier versions were found wrong by the browser round trip:
- measured against the Design-off boxes, the cascade stopped at once, and the 3 cards below kept 66 px of
  displacement;
- measured on the raw graph, a parked design class stayed 66 px off.

### F15

**Disputed.** At `1b52fae`, `commitInlineDraft`'s catch already ran `pendingGrowth.current = null`
(`App.tsx:986` then). Re-checked after the F3 refactor: the catch deletes the card's own entry
(`App.tsx:1012`).

### F17

**Fixed.** A resized empty box keeps one **card-sized** block at its corner (there is no giant card any more), and
a hover anywhere in it offers that block (`AddArea.only`). Geometry keeps the resized size
(`placementGeometry` `slotMinSizes`).

**The deliberate exception.** The first card is not placed under the pointer.
- Cytoscape derives a compound's box from its children (min-size biases grow it right and down only).
- A first card away from the corner would move the box's corner to that card and grow the box by the offset.
- Once that first card exists, the rest of the box offers blocks anywhere.

### F21

**Disputed.** An expansion whose children were scoped out is still an expansion: the user opened it, and nothing
collapsed it.
- In design mode it shows as an empty box with its block, consistent with requirement 5 (a box can hold a first
  designed card).
- Outside design mode it is drawn as a collapsible card (F12).
- No concrete harm was found. Pruning it would silently undo the user's expansion.

### F29

**Fixed (doc); the reviewer's cause is disputed.**
- `verify_ungroup_pipeline.py` passes 33/33 on HEAD `1b52fae`, rerun unchanged (`build/ungroup/run-udjoru55`), and
  on the final jar (`run-ru8dkox1`).
- The reviewer's mechanism cannot hang the harness. `until` (`verify-ungroup-ui.mjs:18`) catches a failed
  `evaluate` and retries it, so a destroyed context means a retry, not a hang.
- The most likely real cause was the tmpfs /tmp per-user quota running out that day ("Disk quota exceeded"). That
  is consistent with the crashpad and "Unable to capture screenshot" errors. It is not proven.
- PROJECT_STATUS is corrected. The harness is unchanged.

### F33

**Deferred.** `slots` / `slotMinSizes` / `addSlotSizes` / `designSlots` / `.design-slot` / `data-slot-for` are
names in ADR 0015, in four modules, in CSS, and in the browser tests' selectors.

The rename is cosmetic, and it is not contained. The current meanings are documented in ADR 0017 and
ARCHITECTURE §8.

## "False or unverifiable documentation claims"

| # | Status | What changed |
|---|---|---|
| 1 | **imprecise, not false in behaviour; fixed** | See F2. ADR 0017 §7 now distinguishes the created card (never grows the box) from the reserve that requirement 4 then keeps. |
| 2 | **correct; fixed** | PROJECT_STATUS round 4b now says "every create in a block", and names the two creates that are not in blocks (the package of step 1, the class under the collapsed package in step 2). |
| 3 | **correct; fixed** | 230 → 231 in round 4b (that run's `report.json`). Round 4c quotes measured values only: the narrow class is now 234, after the 8 px snap. |
| 4 | **the status entry was wrong, and so is the review's alternative; fixed** | See F29. |
| 5 | **correct; fixed** | ADR 0017 header. |
| 6 | **correct; fixed** | ADR 0017 §2 notes that, since Round 2, `atlas:designBlocks` holds only the fixed blocks; the hovered block is `atlas:designHover` and the areas are `atlas:designAreas`. |
| 7 | **correct; fixed** | TESTING.md now says 220×150. |

## Found while fixing (not in the review)

**The layout export dropped a resized box's size (ADR 0016 fidelity).**
- The design brief's layout block did not carry an expansion's `minSize`, so a resized box came back at its
  children's size.
- The new 2e resize step made the design-only import check fail.
- `designExchange` now exports and applies `minSize`. It is pinned by `test-design-exchange.mjs` and the browser
  import check.

**Harness artifacts, fixed in the test, not in the product.**
- A CDP mouse move must carry `button: 'left'` for a grip's pointer capture to hold.
- A grip dragged off the canvas is unmounted. A real user who drags the grip past the canvas edge also ends the
  resize there; this is recorded as a limit.
- Switching journey tabs mounts a new canvas, so test listeners are bound again.

**Header labels ran under the corner squares** (coordinator follow-up, screenshot 05e).
- `expansionLayout.containerLabelLayout` (pure) leaves a label that fits between the button bands unchanged.
- Otherwise the label moves left by half the band and is limited to the space left of the squares; Cytoscape
  ellipsizes the rest (`text-wrap: ellipsis`).
- Pinned by `test-expansion-layout.mjs`. Wide ordinary boxes are unchanged in the ungroup, change-edges and
  git-review screenshots (inspected).

**Drawn compounds sit 2 px further out.** Where a card meets a user-resized inner edge, a drawn compound sits up to
2 px further out than its model box. Cytoscape pads children's bounding boxes, which include their borders. The
model box, which room-making uses, does not change. The browser checks assert the model area exactly and the drawn
box within 2.5 px. This is a documented limit (ADR 0017 "Limits kept").
