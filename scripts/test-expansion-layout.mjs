// Pure checks for expansionLayout.ts: child grid, placement of late children, container boxes, make-room shifts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
// Only type imports from graphPlacement.ts, which transpileModule elides.
const compiled = ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/expansionLayout.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { layoutChildren, placeMissingChildren, containerBox, roomShifts, roomMoves, boxOfCard, designSlot, designBlocks, boxWithBlocks, freeRect, addBlockAt, blockStillOpen, emptyBoxCenter, emptyBoxAnchor, containerLabelLayout, CONTAINER_BUTTON_BAND, CONTAINER_LABEL_UNLIMITED, minSizeWithSlot, CONTAINER_PADDING: PAD } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
// A single sibling with no one else to clamp against behaves exactly like the old single-card rule.
const roomShift = (card, before, after) => roomShifts([card], before, after)[0];

const card = (id, width = 250, height = 206) => ({ id, width, height });
const boxes = positions => cards => cards.map(c => boxOfCard({ ...c, ...positions[c.id] }));

// Five cards: a 3-column grid (ceil(sqrt(5))), starting PAD inside the top-left corner, with 32 gaps.
const five = ['a', 'b', 'c', 'd', 'e'].map(id => card(id));
const grid = layoutChildren({ x: 0, y: 0 }, five);
assert.deepEqual(grid.a, { x: PAD + 125, y: PAD + 103 });
assert.deepEqual(grid.c, { x: PAD + 2 * 282 + 125, y: PAD + 103 });
assert.deepEqual(grid.d, { x: PAD + 125, y: PAD + 206 + 32 + 103 });
// Never more than four columns.
assert.equal(new Set(Object.values(layoutChildren({ x: 0, y: 0 }, Array.from({ length: 30 }, (_, i) => card('n' + i)))).map(p => p.x)).size, 4);

// The container box wraps its children by PAD, so an expanded card keeps its top-left corner.
const box = containerBox(boxes(grid)(five), null);
assert.deepEqual([box.x1, box.y1], [0, 0]);
assert.deepEqual([box.x2, box.y2], [3 * 250 + 2 * 32 + 2 * PAD, 2 * 206 + 32 + 2 * PAD]);
// A user minimum (padding-free, as Cytoscape takes it) grows the box right and down only.
const grown = containerBox(boxes(grid)(five), { width: 2000, height: 10 });
assert.deepEqual([grown.x1, grown.y1, grown.x2, grown.y2], [0, 0, 2000 + 2 * PAD, box.y2]);
assert.equal(containerBox([], null), null);

// A child that joins later lands below the placed ones; placed ones do not move.
const late = placeMissingChildren({ x: 0, y: 0 }, five.map(c => ({ ...c, ...grid[c.id] })), [card('f')]);
assert.equal(late.f.x, grid.a.x);
assert.equal(late.f.y - 103, grid.d.y + 103 + 32);

// Make room: right of the old right edge shifts by the width change, below the old bottom by the height change.
const before = { x1: 0, y1: 0, x2: 280, y2: 250 }, after = { x1: 0, y1: 0, x2: 900, y2: 600 };
assert.deepEqual(roomShift({ x1: 328, y1: 0, x2: 608, y2: 250 }, before, after), { x: 620, y: 0 }, 'same row, to the right');
assert.deepEqual(roomShift({ x1: 0, y1: 298, x2: 280, y2: 548 }, before, after), { x: 0, y: 350 }, 'same column, below');
assert.deepEqual(roomShift({ x1: 328, y1: 298, x2: 608, y2: 548 }, before, after), { x: 620, y: 350 }, 'diagonal');
assert.equal(roomShift({ x1: -400, y1: 0, x2: -120, y2: 250 }, before, after), null, 'left of the card stays');
// Collapse is the same rule with negative deltas.
assert.deepEqual(roomShift({ x1: 948, y1: 0, x2: 1228, y2: 250 }, after, before), { x: -620, y: 0 });
// No shifted neighbor overlaps the grown box.
for (const n of [{ x1: 328, y1: -300, x2: 608, y2: -50 }, { x1: 328, y1: 0, x2: 608, y2: 250 }, { x1: 100, y1: 298, x2: 380, y2: 548 }, { x1: 328, y1: 298, x2: 608, y2: 548 }]) {
  const d = roomShift(n, before, after) || { x: 0, y: 0 }, m = { x1: n.x1 + d.x, y1: n.y1 + d.y, x2: n.x2 + d.x, y2: n.y2 + d.y };
  assert.ok(!(m.x1 < after.x2 && after.x1 < m.x2 && m.y1 < after.y2 && after.y1 < m.y2), JSON.stringify({ n, m }));
}
console.log('PASS: expansionLayout child grid, late-child placement, container boxes with minimums, make-room shifts');

// F-01 (review remediation): a collapse whose two per-axis deltas independently qualify different
// siblings for a shift can pull a moving sibling back into one that stayed put on that axis, even
// though the two never overlapped before. C1 stays (dx=0, its x1 is left of the box); C2 shifts left
// (its x1 was at the box's old right edge); both shift up by the same dy, so they remain row-mates
// throughout. roomShifts must clamp C2's dx so it stops flush against C1 instead of crossing it.
{
  const before = { x1: 0, y1: 0, x2: 240, y2: 200 }, after = { x1: 0, y1: 0, x2: 64, y2: 128 };
  const c1 = { x1: 0, y1: 220, x2: 140, y2: 360 }, c2 = { x1: 240, y1: 220, x2: 380, y2: 360 };
  const [d1, d2] = roomShifts([c1, c2], before, after);
  assert.deepEqual(d1, { x: 0, y: -72 }, 'C1 does not move in x, only pulled up with the row');
  assert.deepEqual(d2, { x: -100, y: -72 }, 'C2 is clamped flush against C1 instead of the unclamped -176');
  const m1 = { x1: c1.x1 + d1.x, y1: c1.y1 + d1.y, x2: c1.x2 + d1.x, y2: c1.y2 + d1.y };
  const m2 = { x1: c2.x1 + d2.x, y1: c2.y1 + d2.y, x2: c2.x2 + d2.x, y2: c2.y2 + d2.y };
  assert.ok(!(m1.x1 < m2.x2 && m2.x1 < m1.x2 && m1.y1 < m2.y2 && m2.y1 < m1.y2), 'C1 and C2 no longer overlap after collapse');
}
// Symmetric case on the other axis: a sibling shifted down by dy alone must not cross one that stays
// put vertically but shares its (post-dx) column.
{
  const before = { x1: 0, y1: 0, x2: 200, y2: 240 }, after = { x1: 0, y1: 0, x2: 128, y2: 64 };
  const c1 = { x1: 220, y1: 0, x2: 360, y2: 140 }, c2 = { x1: 220, y1: 240, x2: 360, y2: 380 };
  const [d1, d2] = roomShifts([c1, c2], before, after);
  assert.deepEqual(d1, { x: -72, y: 0 }, 'C1 does not move in y, only pulled left with the column');
  assert.deepEqual(d2, { x: -72, y: -100 }, 'C2 is clamped flush against C1 instead of the unclamped -176 in y');
}
console.log('PASS: expansionLayout roomShifts clamps a collapse so shifted siblings never cross a row/column-mate that stayed put (F-01)');

// Regression found while wiring roomShifts into App.tsx's makeRoom: an unshifted sibling on the FAR
// side of a moving one (behind it, not in its path) must not clamp it. The first cut of the clamp
// checked only "unshifted and row/column-overlapping", so an unrelated stationary card on the wrong
// side collapsed every genuinely-moving sibling onto its edge on an ordinary expand with nothing
// between them and the box at all.
{
  const before = { x1: 0, y1: 0, x2: 240, y2: 200 }, after = { x1: 0, y1: 0, x2: 600, y2: 200 };
  const wall = { x1: -500, y1: 0, x2: -300, y2: 100 }; // stationary, but behind the moving cards, not ahead of them
  const b = { x1: 300, y1: 0, x2: 500, y2: 100 }, c = { x1: 900, y1: 0, x2: 1100, y2: 100 };
  const [dWall, dB, dC] = roomShifts([wall, b, c], before, after);
  assert.equal(dWall, null, 'the far-side wall never moves');
  assert.deepEqual(dB, { x: 360, y: 0 }, 'B gets the full unclamped shift: the wall is behind it, not in its path');
  assert.deepEqual(dC, { x: 360, y: 0 }, 'C (already past B) also gets the full shift, keeping its spacing from B');
}
console.log('PASS: roomShifts never lets an unshifted sibling on the far side clamp a card moving away from it');

// --- Step 14 (ADR 0011): an ungrouped (hidden) box ---
{
  const kids = [{ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 400, y1: 300, x2: 500, y2: 400 }];
  assert.deepEqual(containerBox(kids, { width: 2000, height: 2000 }, true), { x1: 0, y1: 0, x2: 500, y2: 400 },
    'a hidden box is exactly its children: no padding and no stale user minimum');
  assert.deepEqual(containerBox(kids, null), { x1: -PAD, y1: -PAD, x2: 500 + PAD, y2: 400 + PAD }, 'a visible box is unchanged');
}
console.log('PASS: a hidden box has no padding or minimum size');

{
  // Top level: package Q to the right of package P grows by P's width change (the existing rule).
  const box = (x1, y1, w = 100, h = 100) => ({ x1, y1, x2: x1 + w, y2: y1 + h });
  const center = b => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
  const leaf = (id, b, containerId = null) => ({ id, containerId, box: b, position: center(b) });
  const plain = roomMoves([leaf('P', box(0, 0)), leaf('Q', box(200, 0))], 'P', box(0, 0), box(0, 0, 400));
  assert.deepEqual(plain, { positions: { Q: { x: 550, y: 50 } }, childPositions: {} });
}
console.log('PASS: roomMoves keeps the plain top-level make-room rule');

{
  // Hidden package P holds class A at the left and class B far to the right. Top-level package Q sits
  // inside P's invisible bounds, right after A; top-level R is past all of them. Expanding A by 300 in
  // width moves Q, B and R individually, as if all were top-level cards, and never uses P's bounds.
  const box = (x1, y1, w = 100, h = 100) => ({ x1, y1, x2: x1 + w, y2: y1 + h });
  const center = b => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
  const cards = [
    { id: 'P', containerId: null, expanded: true, hidden: true, box: box(0, 0, 2100, 100), position: { x: 50, y: 50 } },
    { id: 'A', containerId: 'P', box: box(0, 0), position: center(box(0, 0)) },
    { id: 'B', containerId: 'P', box: box(2000, 0), position: center(box(2000, 0)) },
    { id: 'Q', containerId: null, box: box(200, 0), position: center(box(200, 0)) },
    { id: 'L', containerId: null, box: box(-500, 0), position: center(box(-500, 0)) },
    { id: 'R', containerId: null, box: box(2500, 0), position: center(box(2500, 0)) },
  ];
  const moves = roomMoves(cards, 'A', box(0, 0), box(0, 0, 400));
  // R's centre 2550 moves by A's width change, 300: 2850. Neither P's bounds nor B's move changes that.
  assert.deepEqual(moves.positions, { Q: { x: 550, y: 50 }, R: { x: 2850, y: 50 } }, 'Q inside the invisible bounds still makes room, R past everything moves once; L on the left stays');
  assert.deepEqual(moves.childPositions, { P: { B: { x: 2350, y: 50 } } }, 'B moves by the same amount, stored under its hidden parent');
  assert.equal(moves.positions.P, undefined, 'the hidden box itself is never moved');
}
console.log('PASS: make-room looks through a hidden box to its children and stops there');

{
  // A hidden class H inside a visible package V: H's methods count as V's own children. Expanding
  // method M grows V's box, and V's growth moves top-level W to its right as before.
  const box = (x1, y1, w = 100, h = 100) => ({ x1, y1, x2: x1 + w, y2: y1 + h });
  const center = b => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
  const cards = [
    { id: 'V', containerId: null, expanded: true, box: { x1: -PAD, y1: -PAD, x2: 300 + PAD, y2: 100 + PAD }, position: { x: 50, y: 50 } },
    { id: 'H', containerId: 'V', expanded: true, hidden: true, box: box(0, 0, 300), position: { x: 50, y: 50 } },
    { id: 'M', containerId: 'H', box: box(0, 0), position: center(box(0, 0)) },
    { id: 'N', containerId: 'H', box: box(200, 0), position: center(box(200, 0)) },
    { id: 'W', containerId: null, box: box(600, 0), position: center(box(600, 0)) },
  ];
  const moves = roomMoves(cards, 'M', box(0, 0), box(0, 0, 400));
  assert.deepEqual(moves.childPositions, { H: { N: { x: 550, y: 50 } } });
  assert.deepEqual(moves.positions, { W: { x: 950, y: 50 } }, 'V grew by 300, so W makes room');
}
console.log('PASS: a hidden box inside a visible one passes its growth to the visible container');

// ADR 0015: the design add slot is exactly where the next child will be placed.
{
  const kids = ['a', 'b', 'c'].map(id => card(id));
  const placedPos = layoutChildren({ x: 0, y: 0 }, kids);
  const placed = kids.map(c => ({ ...c, ...placedPos[c.id] }));
  const slot = designSlot({ x: 0, y: 0 }, placed, { width: 250, height: 184 });
  const next = placeMissingChildren({ x: 0, y: 0 }, placed, [card('new', 250, 184)]).new;
  assert.deepEqual(slot, boxOfCard({ id: 'new', width: 250, height: 184, ...next }), 'slot box = next placeMissingChildren cell');
  const childBoxes = placed.map(boxOfCard);
  const min = minSizeWithSlot(childBoxes, null, slot);
  const withSlot = containerBox(childBoxes, min);
  const without = containerBox(childBoxes, null);
  assert.deepEqual([withSlot.x1, withSlot.y1], [without.x1, without.y1], 'the slot only grows the box right and down');
  assert.equal(withSlot.y2, slot.y2 + PAD, 'the box holds the slot plus padding');
  assert.deepEqual(minSizeWithSlot(childBoxes, { width: 5000, height: 10 }, slot).width, 5000, 'a larger user minimum wins');
  console.log('PASS: design add slot');
}

// ADR 0017 uses the real least block and block sizes (placementGeometry), loaded through its dependency chain.
const chain = ['review/reviewPalette.ts', 'explorer/scopeModel.ts', 'explorer/graphModel.ts', 'explorer/nodeCard.ts', 'explorer/expansionLayout.ts', 'explorer/graphPlacement.ts', 'explorer/explorerViewState.ts', 'explorer/placementGeometry.ts']
  .map(f => ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/' + f, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]\.\.?\/[^'"]+['"];?\n?/g, ''))
  .join('\n');
const { DESIGN_LEAST_BLOCK, addSlotSizes, geometryForJourney, initExplorerViewState, explorerViewReducer, wholeSystemScope } = await import('data:text/javascript;base64,' + Buffer.from(chain).toString('base64'));
assert.deepEqual(DESIGN_LEAST_BLOCK, { width: 220, height: 150 }, 'the least block keeps room for a two-line name');
const CARD = addSlotSizes('PACKAGE').card, LEAST = DESIGN_LEAST_BLOCK, BLOCKS = addSlotSizes('PACKAGE');
assert.deepEqual(CARD, { width: 250, height: 206 });
assert.deepEqual(addSlotSizes('CLASS').card, { width: 250, height: 184 }, 'a method block is a method card');
const GAP = 32;
const lay = ids => { const cs = ids.map(id => card(id)); const g = layoutChildren({ x: 0, y: 0 }, cs); return cs.map(c => boxOfCard({ ...c, ...g[c.id] })); };
const clear = (b, c) => b.x2 <= c.x1 - GAP + 0.5 || c.x2 <= b.x1 - GAP + 0.5 || b.y2 <= c.y1 - GAP + 0.5 || c.y2 <= b.y1 - GAP + 0.5;
const inside = (b, o) => b.x1 >= o.x1 - 1e-9 && b.y1 >= o.y1 - 1e-9 && b.x2 <= o.x2 + 1e-9 && b.y2 <= o.y2 + 1e-9;
const size = b => [b.x2 - b.x1, b.y2 - b.y1];

// ADR 0017: add blocks fill the empty space a box already has; only a box without any reserves a small block.
{
  // Three classes in a 2-column grid: the short last row has one gap, right of the third card, and no reserve.
  const three = lay(['a', 'b', 'c']);
  const r3 = designBlocks({ x: 0, y: 0 }, three, null, CARD, LEAST);
  assert.equal(r3.reserve, null, 'a gap means no reserve');
  assert.equal(r3.gaps.length, 1);
  assert.deepEqual(r3.gaps[0], { x1: three[2].x2 + 32, y1: three[2].y1, x2: three[1].x2, y2: three[2].y2 }, 'the gap sits in the empty grid cell, card-sized');
  const box3 = containerBox(three, null);
  assert.ok(r3.gaps[0].x2 <= box3.x2 - PAD && r3.gaps[0].y2 <= box3.y2 - PAD, 'the gap lies inside the drawn box: it does not stretch it');
  // A full 2x2 grid: no gap, one least-sized (220x150) reserve below the cards, where the next child goes.
  const four = lay(['a', 'b', 'c', 'd']);
  const r4 = designBlocks({ x: 0, y: 0 }, four, null, CARD, LEAST);
  assert.equal(r4.gaps.length, 0);
  assert.deepEqual([r4.reserve.x1, r4.reserve.y1, ...size(r4.reserve)], [four[0].x1, four[2].y2 + 32, 220, 150], 'the reserve is 220x150 and starts the next row');
  // A box the user resized wider: gaps to the right, no reserve.
  const wide = designBlocks({ x: 0, y: 0 }, four, { width: 1200, height: 0 }, CARD, LEAST);
  assert.equal(wide.reserve, null);
  assert.ok(wide.gaps.length >= 2 && wide.gaps.every(g => g.x1 >= four[1].x2 + 32), 'gaps beside the right column');
  // A gap keeps GAP from every child: it is the exact shape its card takes.
  const blocked = [boxOfCard({ id: 'a', ...CARD, x: 169, y: 147 }), boxOfCard({ id: 'b', ...CARD, x: 169 + 282, y: 147 }), boxOfCard({ id: 'c', ...CARD, x: 169 + 282 + 100, y: 147 + 380 })];
  const rb = designBlocks({ x: 0, y: 0 }, blocked, null, CARD, LEAST);
  for (const g of rb.gaps) for (const c of blocked) assert.ok(clear(g, c), 'no gap touches a child: ' + JSON.stringify(g));
  // A sliver narrower than the least block is no gap.
  const sliver = designBlocks({ x: 0, y: 0 }, four, { width: 532 + 32 + 100, height: 0 }, CARD, LEAST);
  assert.equal(sliver.gaps.length, 0);
  assert.ok(sliver.reserve, 'too small to use: reserve instead');
  // A space exactly the least size is a gap; one pixel less is not.
  const exact = designBlocks({ x: 0, y: 0 }, four, { width: 532 + 32 + 220, height: 0 }, CARD, LEAST);
  assert.equal(exact.reserve, null); assert.ok(exact.gaps.every(g => g.x2 - g.x1 >= 220 - 1e-9 && g.y2 - g.y1 >= 150 - 1e-9));
  assert.ok(designBlocks({ x: 0, y: 0 }, four, { width: 532 + 32 + 219, height: 0 }, CARD, LEAST).reserve, '219 px is no block');
  // An empty box: one card-sized block at its top-left; its area is its inner area.
  const empty = designBlocks({ x: 10, y: 20 }, [], null, CARD, LEAST);
  const corner = { x1: 10 + PAD, y1: 20 + PAD, x2: 10 + PAD + 250, y2: 20 + PAD + 206 };
  assert.deepEqual(empty, { gaps: [], reserve: corner, area: { inner: corner, children: [], only: corner } });
  console.log('PASS: design add blocks');
}

// Review F5: a natural spot inside a child's GAP snaps to where the free space starts, and spots above
// a child count too: the open space is found, and no spurious reserve grows the box.
{
  const kids = [{ x1: 0, y1: 0, x2: 200, y2: 800 }, { x1: 200, y1: 0, x2: 400, y2: 100 }, { x1: 250, y1: 450, x2: 500, y2: 656 }];
  const r = designBlocks({ x: -PAD, y: -PAD }, kids, { width: 700, height: 800 }, CARD, LEAST);
  assert.equal(r.reserve, null, 'no reserve: there is room: ' + JSON.stringify(r));
  for (const g of r.gaps) { assert.ok(inside(g, r.area.inner)); for (const c of kids) assert.ok(clear(g, c), JSON.stringify({ g, c })); for (const o of r.gaps) if (o !== g) assert.ok(clear(g, o), 'gaps keep GAP from each other'); }
  // The reviewer's band alone (c1 runs to the right edge, so only the 468x286 band right of c0 and below
  // c1 is open). Its natural spot (c1.x1, c1.y2 + GAP) = (200, 132) lies inside c0's GAP; it snaps to 232.
  const band = [kids[0], { x1: 200, y1: 0, x2: 700, y2: 100 }, kids[2]];
  const rb = designBlocks({ x: -PAD, y: -PAD }, band, { width: 700, height: 800 }, CARD, LEAST);
  assert.equal(rb.reserve, null, 'the band is found: no spurious reserve: ' + JSON.stringify(rb));
  assert.deepEqual(rb.gaps[0], { x1: 232, y1: 132, x2: 482, y2: 338 }, 'a card-sized gap at the band corner');
  for (const g of rb.gaps) for (const c of band) assert.ok(clear(g, c), JSON.stringify({ g, c }));
  // Space above a lower child: the spot top-aligned with that child's column is a natural spot too.
  const two = [{ x1: 0, y1: 0, x2: 250, y2: 206 }, { x1: 600, y1: 300, x2: 850, y2: 506 }];
  const rt = designBlocks({ x: -PAD, y: -PAD }, two, null, CARD, LEAST);
  assert.ok(rt.gaps.some(g => g.x1 === 600 && g.y1 === 0 && g.x2 === 850 && g.y2 === 206), 'the block above the lower child, in its column: ' + JSON.stringify(rt.gaps));
  console.log('PASS: designBlocks snaps natural spots into the free space and finds space above children (F5)');
}

// ADR 0017: make-room keeps a box's reserve block as a child grows, so the box's neighbours clear all of it.
{
  const child = boxOfCard({ id: 'c', width: 250, height: 206, x: PAD + 125, y: PAD + 103 });
  const pkg = boxWithBlocks({ x: 0, y: 0 }, [child], null, BLOCKS);
  assert.equal(pkg.y2, child.y2 + 32 + 150 + PAD, 'the 150 px reserve sits below the only child');
  const below = { id: 'n', containerId: null, box: { x1: 0, y1: pkg.y2 + 40, x2: 280, y2: pkg.y2 + 290 }, position: { x: 140, y: pkg.y2 + 165 } };
  const cards = [
    { id: 'p', containerId: null, expanded: true, box: pkg, position: { x: 140, y: 125 }, blocks: BLOCKS },
    { id: 'c', containerId: 'p', box: child, position: { x: PAD + 125, y: PAD + 103 } },
    below,
  ];
  const grown = { ...child, y2: child.y2 + 12 };
  const moves = roomMoves(cards, 'c', child, grown);
  assert.equal(moves.positions.n.y - below.position.y, 12, 'the card below moves by the growth, not up by the reserve');
  console.log('PASS: make-room keeps the reserve block');
}

// ADR 0017 round 2: a block anywhere empty, under the pointer, in the exact shape the card takes.
{
  const kids = [boxOfCard({ id: 'a', ...CARD, x: 169, y: 147 })]; // x 44..294, y 44..250
  const inner = { x1: 44, y1: 44, x2: 1244, y2: 744 };
  const a = { inner, children: kids };
  // Far from the child: a full card centred on the pointer.
  assert.deepEqual(addBlockAt(a, { x: 800, y: 400 }, CARD, LEAST), { x1: 675, y1: 297, x2: 925, y2: 503 });
  // Near the right edge: shifted left to stay inside, never past the inner area.
  const edge = addBlockAt(a, { x: 1240, y: 400 }, CARD, LEAST);
  assert.equal(edge.x2, 1244); assert.equal(edge.x2 - edge.x1, 250);
  // Near a corner: shifted inside on both axes.
  const corner = addBlockAt(a, { x: 1243, y: 743 }, CARD, LEAST);
  assert.deepEqual(corner, { x1: 994, y1: 538, x2: 1244, y2: 744 });
  // Beside the child: shifted right to keep GAP from it.
  const beside = addBlockAt(a, { x: 340, y: 150 }, CARD, LEAST);
  assert.ok(beside.x1 >= 294 + 32, 'keeps GAP from the child: ' + JSON.stringify(beside));
  // Just below the child: shifted down to keep GAP from it.
  const under = addBlockAt(a, { x: 150, y: 290 }, CARD, LEAST);
  assert.ok(under.y1 >= 250 + 32 && clear(under, kids[0]), JSON.stringify(under));
  // On the child, or within GAP of it: nothing.
  assert.equal(addBlockAt(a, { x: 150, y: 150 }, CARD, LEAST), null);
  assert.equal(addBlockAt(a, { x: 310, y: 150 }, CARD, LEAST), null);
  // Outside the inner area (the header band, the padding): nothing.
  assert.equal(addBlockAt(a, { x: 800, y: 30 }, CARD, LEAST), null);
  assert.equal(addBlockAt(a, { x: 1250, y: 400 }, CARD, LEAST), null);
  // A space smaller than a card but at least the least size: a smaller block, exactly that space.
  const narrow = { inner: { x1: 0, y1: 0, x2: 500, y2: 300 }, children: [boxOfCard({ id: 'l', width: 100, height: 300, x: 50, y: 150 }), boxOfCard({ id: 'r', width: 100, height: 300, x: 450, y: 150 })] };
  const mid = addBlockAt(narrow, { x: 250, y: 150 }, CARD, LEAST);
  assert.deepEqual([mid.x1, mid.x2 - mid.x1, mid.y2 - mid.y1], [132, 236, 206], 'fills the 236 px between the children');
  // Smaller than the least size: no block.
  const tight = { inner: narrow.inner, children: [boxOfCard({ id: 'l', width: 150, height: 300, x: 75, y: 150 }), boxOfCard({ id: 'r', width: 150, height: 300, x: 425, y: 150 })] };
  assert.equal(addBlockAt(tight, { x: 250, y: 150 }, CARD, LEAST), null);
  // The free rectangle never contains a child.
  const fr = freeRect(inner, kids, { x: 800, y: 100 });
  assert.ok(fr.x1 >= 294 + 32 || fr.y1 >= 250 + 32, JSON.stringify(fr));
  // Every gap from designBlocks lies inside the inner area, so creating in one never grows the box.
  const three = lay(['a', 'b', 'c']);
  const r = designBlocks({ x: 0, y: 0 }, three, { width: 900, height: 700 }, CARD, LEAST);
  const box = containerBox(three, { width: 900, height: 700 });
  assert.ok(r.gaps.length >= 3 && r.gaps.every(g => g.x2 <= box.x2 - PAD + 0.5 && g.y2 <= box.y2 - PAD + 0.5), 'gaps stay inside: ' + JSON.stringify(r.gaps));
  assert.ok(r.area && r.area.children.length === 3);
  console.log('PASS: add block anywhere empty, in the shape the card takes');
}

// Review F4: fractional bounds. The block stays strictly inside the free space: no rounding pushes it past
// the box's inner edge or into a child's GAP.
{
  const a = { inner: { x1: 0, y1: 0, x2: 400.7, y2: 300.3 }, children: [{ x1: 0, y1: 0, x2: 100.3, y2: 100 }] };
  for (const p of [{ x: 400.7, y: 150 }, { x: 132.3, y: 50 }, { x: 140, y: 290 }, { x: 260.25, y: 200.6 }]) {
    for (const snap of [0, 8]) {
      const b = addBlockAt(a, p, CARD, LEAST, snap);
      assert.ok(b, JSON.stringify(p));
      assert.ok(inside(b, a.inner), 'inside the inner area: ' + JSON.stringify({ p, snap, b }));
      assert.ok(clear(b, a.children[0]) && (b.x1 >= 132.3 - 1e-9 || b.y1 >= 132 - 1e-9), 'keeps GAP from the child: ' + JSON.stringify({ p, snap, b }));
      assert.ok(b.x2 - b.x1 >= 220 - 1e-9 && b.y2 - b.y1 >= 150 - 1e-9, 'never below the least block');
    }
  }
  assert.equal(addBlockAt(a, { x: 400.7, y: 150 }, CARD, LEAST).x2, 400.7, 'clamped exactly to the edge');
  console.log('PASS: fractional bounds keep the block strictly inside (F4)');
}

// Review F6/F24: the free rectangle is exact, not greedy. A nearer diagonal child must not cut away the only
// direction where a block fits; equal choices never flip.
{
  const inner = { x1: 0, y1: 0, x2: 1000, y2: 600 }, p = { x: 400, y: 300 };
  const kids = [{ x1: 396.8, y1: 75.6, x2: 548.5, y2: 194.8 }, { x1: 481.7, y1: 339.4, x2: 644.0, y2: 484.4 }];
  const b = addBlockAt({ inner, children: kids }, p, CARD, LEAST);
  assert.ok(b, 'a block fits around the pointer');
  assert.ok(b.x1 <= p.x && p.x <= b.x2 && b.y1 <= p.y && p.y <= b.y2 && kids.every(c => clear(b, c)), JSON.stringify(b));
  assert.deepEqual(size(b), [250, 206], 'a full card fits there');
  // Feasibility first: a wide but short space never wins over one where the least block fits.
  const f = freeRect(inner, kids, p, { card: CARD, least: LEAST });
  assert.ok(f.x2 - f.x1 >= 220 && f.y2 - f.y1 >= 150, JSON.stringify(f));
  // Symmetric layout, pointer on the axis between two children: the same answer on every call and on
  // either side of the tie (no flicker from sort-order crossovers).
  const twin = [{ x1: 200, y1: 100, x2: 300, y2: 200 }, { x1: 700, y1: 100, x2: 800, y2: 200 }];
  const at = x => addBlockAt({ inner, children: twin }, { x, y: 400 }, CARD, LEAST, 8);
  assert.deepEqual(at(500), at(500));
  assert.deepEqual(size(at(499.9)), size(at(500.1)), 'the same shape on both sides of the tie');
  assert.ok(Math.abs(at(499.9).x1 - at(500.1).x1) <= 8, 'it moves by at most one snap step');
  console.log('PASS: the free rectangle is exact and stable (F6, F24)');
}

// Fuzz: random children and pointers. A block never meets a child's GAP, contains the pointer, stays inside
// the inner area, is at least the least block and at most a card; and when a least-plus-2 px block around
// the pointer exists (brute force on a 4 px grid), one is found.
{
  let seed = 17;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let found = 0, missed = 0;
  for (let t = 0; t < 400; t++) {
    const inner = { x1: 0, y1: 0, x2: 600 + rnd() * 900, y2: 400 + rnd() * 700 };
    const kids = Array.from({ length: Math.floor(rnd() * 9) }, () => { const x = rnd() * inner.x2, y = rnd() * inner.y2; return { x1: x, y1: y, x2: x + 60 + rnd() * 250, y2: y + 60 + rnd() * 220 }; });
    const p = { x: rnd() * inner.x2, y: rnd() * inner.y2 };
    const b = addBlockAt({ inner, children: kids }, p, CARD, LEAST, t % 2 ? 8 : 0);
    if (b) {
      found++;
      assert.ok(inside(b, inner), 'inside: ' + JSON.stringify({ inner, b }));
      assert.ok(b.x1 <= p.x + 1e-9 && p.x <= b.x2 + 1e-9 && b.y1 <= p.y + 1e-9 && p.y <= b.y2 + 1e-9, 'contains the pointer: ' + JSON.stringify({ p, b }));
      for (const c of kids) assert.ok(clear(b, c), 'keeps GAP: ' + JSON.stringify({ b, c }));
      const [w, h] = size(b);
      assert.ok(w >= 220 - 1e-9 && h >= 150 - 1e-9 && w <= 250 + 1e-9 && h <= 206 + 1e-9, 'least to card: ' + JSON.stringify(b));
    } else {
      // Brute force: is there a 222x152 box containing p, inside inner, clear of every child's GAP?
      const W = 222, H = 152;
      let exists = false;
      for (let x = Math.max(0, p.x - W); x <= Math.min(p.x, inner.x2 - W) && !exists; x += 4)
        for (let y = Math.max(0, p.y - H); y <= Math.min(p.y, inner.y2 - H) && !exists; y += 4)
          if (kids.every(c => clear({ x1: x, y1: y, x2: x + W, y2: y + H }, c))) exists = true;
      if (exists) missed++;
    }
  }
  assert.equal(missed, 0, 'never misses a block that fits');
  assert.ok(found > 100, 'the fuzz exercises real blocks: ' + found);
  for (let t = 0; t < 200; t++) {
    const inner = { x1: 0, y1: 0, x2: 500 + rnd() * 900, y2: 400 + rnd() * 700 };
    const kids = Array.from({ length: Math.floor(rnd() * 8) }, () => { const x = rnd() * inner.x2, y = rnd() * inner.y2; return { x1: x, y1: y, x2: x + 60 + rnd() * 250, y2: y + 60 + rnd() * 220 }; });
    const p = { x: rnd() * inner.x2, y: rnd() * inner.y2 };
    const f = freeRect(inner, kids, p);
    if (!f) continue;
    assert.ok(inside(f, inner) && f.x1 <= p.x && p.x <= f.x2 && f.y1 <= p.y && p.y <= f.y2, 'freeRect contains p inside inner');
    for (const c of kids) assert.ok(clear(f, c), 'freeRect keeps GAP: ' + JSON.stringify({ f, c }));
  }
  console.log(`PASS: fuzz (${found} blocks found, none missed)`);
}

// Review F9: a hovered block is dropped once a card covers it or its box moved or shrank; a reserve stays.
{
  const kids = [{ x1: 44, y1: 44, x2: 294, y2: 250 }];
  const a = { inner: { x1: 44, y1: 44, x2: 1244, y2: 744 }, children: kids };
  const b = addBlockAt(a, { x: 800, y: 400 }, CARD, LEAST);
  assert.equal(blockStillOpen(a, [], b), true);
  assert.equal(blockStillOpen({ ...a, children: [...kids, b] }, [], b), false, 'a card now covers it');
  const moved = { inner: { x1: 44, y1: 244, x2: 1244, y2: 944 }, children: kids.map(c => ({ ...c, y1: c.y1 + 200, y2: c.y2 + 200 })) };
  assert.equal(blockStillOpen(moved, [], { x1: 675, y1: 100, x2: 925, y2: 306 }), false, 'the box moved away under it');
  assert.equal(blockStillOpen(undefined, [], b), false, 'the box is gone');
  const reserve = { x1: 44, y1: 282, x2: 264, y2: 432 };
  assert.equal(blockStillOpen({ inner: { x1: 44, y1: 44, x2: 294, y2: 250 }, children: kids }, [reserve], reserve), true, 'a reserve outside the inner area is still offered');
  assert.equal(blockStillOpen({ inner: { x1: 44, y1: 44, x2: 294, y2: 250 }, children: kids }, [], reserve), false, 'a reserve no longer offered');
  console.log('PASS: a stale hover block is dropped (F9)');
}

// Review F17: an empty box resized larger keeps a card-sized block at its corner (not one block the size of
// the whole box), and a hover anywhere in it offers that block. Not one under the pointer: a box's corner is
// derived from its children, so a first card anywhere else would move the box and grow it.
{
  const min = { width: 1000, height: 800 };
  const r = designBlocks({ x: 0, y: 0 }, [], min, CARD, LEAST);
  assert.deepEqual(r.reserve, { x1: PAD, y1: PAD, x2: PAD + 250, y2: PAD + 206 }, 'the reserve is one card at the corner');
  assert.deepEqual(r.area.inner, { x1: PAD, y1: PAD, x2: PAD + 1000, y2: PAD + 800 });
  for (const p of [{ x: 700, y: 600 }, { x: PAD + 1, y: PAD + 1 }, { x: PAD + 999, y: PAD + 799 }])
    assert.deepEqual(addBlockAt(r.area, p, CARD, LEAST, 8), r.reserve, 'a hover anywhere offers the corner block: ' + JSON.stringify(p));
  assert.equal(addBlockAt(r.area, { x: 20, y: 20 }, CARD, LEAST, 8), null, 'not on the header or padding');
  // The invariant itself: with the block as its only child, the box keeps its corner and its size.
  const before = containerBox([r.reserve], min), after = containerBox([addBlockAt(r.area, { x: 700, y: 600 }, CARD, LEAST, 8)], min);
  assert.deepEqual(after, before, 'the first card keeps the box where it was, at its size');
  // A block anywhere else (what a hover under the pointer would give) would move the box: the reason for `only`.
  const elsewhere = { x1: 576, y1: 496, x2: 826, y2: 702 };
  assert.notDeepEqual(containerBox([elsewhere], min), before, 'a first card away from the corner would move the box');
  assert.deepEqual(addBlockAt(designBlocks({ x: 0, y: 0 }, [], null, CARD, LEAST).area, { x: 200, y: 200 }, CARD, LEAST, 8), { x1: PAD, y1: PAD, x2: PAD + 250, y2: PAD + 206 }, 'an unresized empty box: the block is the whole inner area, exactly card-sized');
  // Once it has its first card at the corner, the rest of the resized box offers blocks anywhere.
  const first = designBlocks({ x: 0, y: 0 }, [r.reserve], min, CARD, LEAST);
  assert.equal(first.reserve, null);
  const far = addBlockAt(first.area, { x: PAD + 995, y: PAD + 795 }, CARD, LEAST, 8);
  assert.deepEqual(far, { x1: PAD + 1000 - 250, y1: PAD + 800 - 206, x2: PAD + 1000, y2: PAD + 800 }, 'clamped into the bottom-right corner');
  assert.deepEqual(containerBox([r.reserve, far], min), before, 'and it does not grow the box');
  // Through geometryForJourney: the box keeps the user's size, and its blocks are the corner block.
  const graph = { nodes: [{ id: 'p', kind: 'PACKAGE', simpleName: 'p', qualifiedName: 'p' }], edges: [] };
  let view = initExplorerViewState();
  view = explorerViewReducer(view, { type: 'SCOPE_UPDATED', eligibleIds: ['p'], batchSize: Infinity, placement: { p: { width: 280, height: 250, name: 'p', center: { x: 140, y: 125 } } }, generation: view.generation });
  view = explorerViewReducer(view, { type: 'EXPAND_RESOURCE', level: view.activeLevel, id: 'p', ownerId: null, childPositions: {}, generation: view.generation });
  view = explorerViewReducer(view, { type: 'RESIZE_CONTAINER', level: view.activeLevel, id: 'p', minSize: { width: 1000, height: 800 }, generation: view.generation });
  const projected = { nodes: [{ ...graph.nodes[0], expanded: true }], edges: [] };
  const g = geometryForJourney(graph, view, wholeSystemScope(graph), 'ALL', projected, undefined, { designSlots: true });
  const tl = { x: g.positions.p.x - 140, y: g.positions.p.y - 125 };
  assert.deepEqual(g.slotMinSizes.p, { width: 1000, height: 800 }, 'a resized empty box keeps its size');
  assert.deepEqual(size(g.boxes.p), [1000 + 2 * PAD, 800 + 2 * PAD]);
  assert.deepEqual(g.slots.p, [{ x1: tl.x + PAD, y1: tl.y + PAD, x2: tl.x + PAD + 250, y2: tl.y + PAD + 206 }]);
  assert.ok(g.areas.p && g.areas.p.inner.x2 - g.areas.p.inner.x1 === 1000);
  console.log('PASS: a resized empty box offers its card-sized corner block, then blocks anywhere once it has a card (F17)');
}

// Review F32: the empty box's drawn centre and the anchor a drag reads back are exact inverses.
{
  const anchor = { x: 123.4, y: -56.7 }, cardSize = { width: 250, height: 206 }, min = { width: 1000.5, height: 800.25 };
  const c = emptyBoxCenter(anchor, cardSize, min);
  assert.deepEqual(c, { x: anchor.x - 125 + PAD + 500.25, y: anchor.y - 103 + PAD + 400.125 });
  const back = emptyBoxAnchor(c, cardSize, min);
  assert.ok(Math.abs(back.x - anchor.x) < 1e-9 && Math.abs(back.y - anchor.y) < 1e-9);
  console.log('PASS: empty box centre and anchor are inverses (F32)');
}

// Review F8: a box with 100 children. designBlocks and 1000 hovers stay well inside a frame.
{
  const cs = Array.from({ length: 100 }, (_, i) => card('n' + i, 250, i % 3 ? 206 : 160));
  const g = layoutChildren({ x: 0, y: 0 }, cs);
  const kids = cs.map(c => boxOfCard({ ...c, ...g[c.id] }));
  const min = { width: 4 * 282 + 600, height: 25 * 238 + 400 };
  const t0 = performance.now();
  const r = designBlocks({ x: 0, y: 0 }, kids, min, CARD, LEAST);
  const t1 = performance.now();
  let hits = 0;
  for (let i = 0; i < 1000; i++) if (addBlockAt(r.area, { x: PAD + (i * 37) % (min.width), y: PAD + (i * 101) % (min.height) }, CARD, LEAST, 8)) hits++;
  const t2 = performance.now();
  assert.ok(r.gaps.length > 0 && hits > 0);
  console.log(`PASS: 100 children: designBlocks ${(t1 - t0).toFixed(1)} ms, 1000 addBlockAt ${(t2 - t1).toFixed(1)} ms (${hits} blocks) (F8)`);
  assert.ok(t1 - t0 < 200 && t2 - t1 < 200, 'fast enough for a render and for pointer moves');
}

// Coordinator follow-up: an expanded box's header label never runs under its corner squares.
{
  assert.equal(CONTAINER_BUTTON_BAND, 114, 'collapse, stack and Ungroup squares: 6 + 3 x 32 + 2 x 6');
  const wide = containerLabelLayout(900, 'com.example.spring.service  ·  9 types');
  assert.deepEqual(wide, { maxWidth: CONTAINER_LABEL_UNLIMITED, shiftX: 0 }, 'a label that fits between the bands is unchanged');
  const empty = containerLabelLayout(342, 'com.example.notes  ·  0 types');
  assert.deepEqual(empty, { maxWidth: 342 - 114 - 20, shiftX: -57 }, 'an empty box: moved left, limited to the space left of the squares');
  // The limited label stays inside the box and 10 px clear of the squares, whatever the width.
  for (const w of [250, 342, 500, 700]) {
    const l = containerLabelLayout(w, 'x'.repeat(80));
    const centre = w / 2 + l.shiftX;
    assert.ok(centre + l.maxWidth / 2 <= w - CONTAINER_BUTTON_BAND - 10 + 1e-9 && centre - l.maxWidth / 2 >= 10 - 1e-9, JSON.stringify({ w, l }));
  }
  assert.equal(containerLabelLayout(100, 'long label here').maxWidth, 0, 'never negative');
  console.log('PASS: an expanded box header label stops short of its corner squares');
}
