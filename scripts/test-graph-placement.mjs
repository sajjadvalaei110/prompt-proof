// Pure, hand-computable fixtures for graphPlacement.ts (Appendix A3). No survivors -> first card at
// the origin; a new batch starts below the survivors' actual bounding box; rows wrap at the stored
// strip width and never recompute it from node count; row height is the tallest card in that row;
// an oversized card still gets placed, forcing itself (and whatever follows) onto its own row.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const compiled = compile('../frontend/src/features/explorer/graphPlacement.ts');
const { placeAdditions } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

let passCount = 0;
function check(label, fn) { fn(); passCount++; }

check('no survivors: the first card is placed with its top-left corner at the origin', () => {
  const { positions } = placeAdditions([], [{ id: 'a', width: 250, height: 128, name: 'A' }], null);
  assert.equal(positions.a.x - 250 / 2, 0, 'left edge at x=0');
  assert.equal(positions.a.y - 128 / 2, 0, 'top edge at y=0');
});

check('a new batch starts at or below the survivors\' actual bounding-box bottom plus 64 units', () => {
  const survivors = [{ id: 's1', x: 100, y: 100, width: 250, height: 128 }]; // bottom edge = 100+64=164
  const { positions } = placeAdditions(survivors, [{ id: 'a', width: 250, height: 128, name: 'A' }], 900);
  const newCardTop = positions.a.y - 128 / 2;
  assert.equal(newCardTop, 164 + 64, 'new row starts exactly at survivor bottom + 64');
});

check('rows wrap at the stored strip width, never recomputed from the batch size', () => {
  const additions = [
    { id: 'a', width: 250, height: 128, name: 'A' },
    { id: 'b', width: 250, height: 128, name: 'B' },
    { id: 'c', width: 250, height: 128, name: 'C' },
  ];
  const stripWidth = 250 + 48 + 250; // room for exactly two cards
  const { positions } = placeAdditions([], additions, stripWidth);
  assert.equal(positions.a.y, positions.b.y, 'first two cards share row 0 (they fit the strip)');
  assert.notEqual(positions.b.y, positions.c.y, 'the third card wraps to a new row');
});

check('row height is the tallest card actually placed in that row', () => {
  const additions = [
    { id: 'a', width: 250, height: 128, name: 'A' },
    { id: 'b', width: 250, height: 200, name: 'B' }, // taller, shares row 0 with A
    { id: 'c', width: 250, height: 128, name: 'C' }, // forced to row 1 by the strip width
  ];
  const stripWidth = 250 + 48 + 250;
  const { positions } = placeAdditions([], additions, stripWidth);
  const row0Top = positions.a.y - 128 / 2; // 0
  const row1Top = positions.c.y - 128 / 2;
  assert.equal(row1Top, row0Top + 200 + 48, 'row 1 starts after row 0\'s tallest card (B, 200) plus the vertical gap');
});

check('an oversized card is still placed, and it (and whatever follows it) get their own row', () => {
  const additions = [
    { id: 'a', width: 250, height: 128, name: 'A' },
    { id: 'big', width: 2000, height: 128, name: 'Big' },
    { id: 'c', width: 250, height: 128, name: 'C' },
  ];
  const stripWidth = 250 + 48 + 250; // far smaller than the oversized card
  const { positions } = placeAdditions([], additions, stripWidth);
  const rows = new Set([positions.a.y, positions.big.y, positions.c.y]);
  assert.equal(rows.size, 3, 'A, Big, and C each land on a distinct row once the oversized card is involved');
  for (const id of Object.keys(positions)) assert.ok(Number.isFinite(positions[id].x) && Number.isFinite(positions[id].y), `${id} has finite coordinates`);
});

check('appendWidth is computed once from the first batch\'s typical card width and returned for the caller to persist and reuse', () => {
  const { appendWidth } = placeAdditions([], [{ id: 'a', width: 250, height: 128, name: 'A' }], null);
  assert.equal(appendWidth, 6 * 250 + 5 * 48, 'room for six typical cards plus five gaps');
  const { appendWidth: reused } = placeAdditions([], [{ id: 'a', width: 250, height: 128, name: 'A' }], appendWidth);
  assert.equal(reused, appendWidth, 'a stored width is echoed back unchanged, never rederived');
});

check('the new batch is sorted by name then ID, independent of input order (survivors are never touched by this function)', () => {
  const additions = [
    { id: 'z9', width: 250, height: 128, name: 'Zebra' },
    { id: 'a1', width: 250, height: 128, name: 'Apple' },
  ];
  const { positions } = placeAdditions([], additions, 900);
  assert.ok(positions.a1.x < positions.z9.x, 'Apple sorts before Zebra and is placed first (further left)');
});

check('with no additions, an empty positions map is returned and the stored width passes through unchanged', () => {
  const { positions, appendWidth } = placeAdditions([{ id: 's', x: 0, y: 0, width: 250, height: 128 }], [], 700);
  assert.deepEqual(positions, {});
  assert.equal(appendWidth, 700);
});

// --- Step 5 review remediation A2: sort order must be a fixed ordinal comparator, not locale-
// dependent -- names differing only by case sort differently under en-US localeCompare than under a
// plain codepoint comparator, so this case actually discriminates between the two implementations. ---
check('A2: sort order is a fixed ordinal comparator, not locale-collation-dependent (uppercase sorts before lowercase)', () => {
  const additions = [
    { id: 'lower1', width: 250, height: 128, name: 'airCarrier' },
    { id: 'upper1', width: 250, height: 128, name: 'AirCarrier' },
  ];
  const { positions } = placeAdditions([], additions, 900);
  // Ordinal ('A' = 0x41 < 'a' = 0x61): 'AirCarrier' sorts strictly before 'airCarrier'. Under
  // en-US localeCompare, 'AirCarrier'.localeCompare('airCarrier') === 1 -- the opposite order --
  // so this assertion would fail if the comparator ever regressed back to localeCompare.
  assert.ok('AirCarrier'.localeCompare('airCarrier') > 0, 'sanity check: localeCompare disagrees with ordinal for this pair under en-US');
  assert.ok(positions.upper1.x < positions.lower1.x, 'AirCarrier (ordinal-first) must be placed further left than airCarrier');
});

console.log(`PASS: ${passCount} graphPlacement checks (Appendix A3 append-below-bounding-box placement, Step 5 review remediation A2 ordinal sort)`);
