// Pure checks for expansionLayout.ts: child grid, placement of late children, container boxes, make-room shifts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
// Only type imports from graphPlacement.ts, which transpileModule elides.
const compiled = ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/expansionLayout.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { layoutChildren, placeMissingChildren, containerBox, roomShifts, roomMoves, boxOfCard, designSlot, minSizeWithSlot, CONTAINER_PADDING: PAD } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
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
