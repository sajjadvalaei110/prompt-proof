// Pure, hand-computable fixtures for focusedArrangement.ts (Appendix B). Mirrors
// test-graph-placement.mjs's compile-and-concatenate approach: focusedArrangement.ts imports the
// real placeAdditions from graphPlacement.ts (reused for the unrelated-cards row packing), so both
// compiled modules are concatenated into one self-contained script for the data: URL loader, which
// cannot resolve a relative specifier.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const stripLocalImport = (src, name) => src.replace(new RegExp(`import \\{[^}]*\\} from ['"]\\./${name}['"];?\n?`), '');
const placementModule = compile('../frontend/src/features/explorer/graphPlacement.ts');
const arrangementModule = stripLocalImport(compile('../frontend/src/features/explorer/focusedArrangement.ts'), 'graphPlacement');
const compiled = placementModule + '\n' + arrangementModule;
const { arrangeAroundResource } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

let passCount = 0;
function check(label, fn) { fn(); passCount++; }

const CLASS = { width: 250, height: 128 };
const zero = { x: 0, y: 0 };

check('focus not among the displayed cards returns null (the disabled-state contract, H3)', () => {
  const cards = [{ id: 'a', ...CLASS, qualifiedName: 'a.A' }];
  assert.equal(arrangeAroundResource(cards, [], 'missing', zero), null);
});

check('A -> focus -> C chain: A lands left, C lands right, both centered on the focus row', () => {
  const cards = [
    { id: 'a', ...CLASS, qualifiedName: 'p.A' },
    { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' },
    { id: 'c', ...CLASS, qualifiedName: 'p.C' },
  ];
  const edges = [{ sourceId: 'a', targetId: 'focus' }, { sourceId: 'focus', targetId: 'c' }];
  const anchor = { x: 500, y: 300 };
  const positions = arrangeAroundResource(cards, edges, 'focus', anchor);
  assert.deepEqual(positions.focus, anchor, 'focus lands exactly on its prior coordinate');
  // half-width(125) + 96-unit gap + half-width(125) = 346 on each side (Appendix B).
  assert.deepEqual(positions.a, { x: 500 - 346, y: 300 });
  assert.deepEqual(positions.c, { x: 500 + 346, y: 300 });
  assert.equal(Object.keys(positions).length, 3, 'every displayed card appears exactly once');
});

check('a bidirectional neighbor lands on the left only, not duplicated on the right', () => {
  const cards = [{ id: 'a', ...CLASS, qualifiedName: 'p.A' }, { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' }];
  const edges = [{ sourceId: 'a', targetId: 'focus' }, { sourceId: 'focus', targetId: 'a' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  assert.equal(positions.a.x, -346, 'placed in the left column');
  assert.equal(Object.keys(positions).length, 2, 'no second card was created for the same neighbor');
});

check('a self-loop on the focus does not create a second copy of the focus card', () => {
  const cards = [{ id: 'focus', ...CLASS, qualifiedName: 'p.Focus' }];
  const edges = [{ sourceId: 'focus', targetId: 'focus' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  assert.deepEqual(Object.keys(positions), ['focus']);
  assert.deepEqual(positions.focus, zero);
});

check('an isolated resource (no incoming/outgoing edges) is placed as an unrelated card below the focus', () => {
  const cards = [{ id: 'focus', ...CLASS, qualifiedName: 'p.Focus' }, { id: 'x', ...CLASS, qualifiedName: 'p.X' }];
  const positions = arrangeAroundResource(cards, [], 'focus', zero);
  // graphPlacement's own append-below-bounds packing: bottom(64) + ROW_TOP_GAP(64) = 128 row top,
  // then + half the new card's height(64) = 192; left edge (-125) + half width(125) = 0.
  assert.deepEqual(positions.x, { x: 0, y: 192 });
});

check('a reciprocal relationship between two unrelated cards does not touch the focus columns', () => {
  const cards = [
    { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' },
    { id: 'p', ...CLASS, qualifiedName: 'p.P' },
    { id: 'q', ...CLASS, qualifiedName: 'p.Q' },
  ];
  const edges = [{ sourceId: 'p', targetId: 'q' }, { sourceId: 'q', targetId: 'p' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  assert.deepEqual(positions.focus, zero);
  assert.equal(Object.keys(positions).length, 3);
  assert.notEqual(positions.p.y, 0);
  assert.notEqual(positions.q.y, 0);
});

check('mixed card heights in one column stack by actual height, not a uniform gap', () => {
  const cards = [
    { id: 'a', width: 250, height: 100, qualifiedName: 'p.A' },
    { id: 'b', width: 250, height: 200, qualifiedName: 'p.B' },
    { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' },
  ];
  const edges = [{ sourceId: 'a', targetId: 'focus' }, { sourceId: 'b', targetId: 'focus' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  // totalHeight = 100+200+48(gap) = 348, centered on 0 -> starts at -174.
  assert.equal(positions.a.y, -124, 'A (100-tall, sorted first) centered in its own slice');
  assert.equal(positions.b.y, 74, 'B (200-tall) starts exactly 48 units after A ends');
  assert.equal(positions.a.x, positions.b.x, 'both share the same column x');
});

check('the left/right column x offset uses the actual card widths (package vs class dimensions)', () => {
  const PACKAGE = { width: 280, height: 148 };
  const cards = [{ id: 'a', ...PACKAGE, qualifiedName: 'p.A' }, { id: 'focus', ...PACKAGE, qualifiedName: 'p.Focus' }];
  const edges = [{ sourceId: 'a', targetId: 'focus' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  // half-width(140) + 96 + half-width(140) = 376.
  assert.equal(positions.a.x, -376);
});

check('within-group order is deterministic by qualified name then ID, independent of input order', () => {
  const cards = [
    { id: 'z2', width: 250, height: 100, qualifiedName: 'p.Same' },
    { id: 'z1', width: 250, height: 100, qualifiedName: 'p.Same' },
    { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' },
  ];
  const edges = [];
  const first = arrangeAroundResource(cards, edges, 'focus', zero);
  const second = arrangeAroundResource([...cards].reverse(), edges, 'focus', zero);
  assert.deepEqual(first, second, 'array order of equally-ranked cards must not change the result');
  assert.ok(first.z1.x < first.z2.x, 'the lower ID (tie-break) is placed first in the unrelated row');
});

check('translation preserves relative structure: only the focus anchor changes between two calls', () => {
  const cards = [{ id: 'a', ...CLASS, qualifiedName: 'p.A' }, { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' }];
  const edges = [{ sourceId: 'a', targetId: 'focus' }];
  const at1000 = arrangeAroundResource(cards, edges, 'focus', { x: 1000, y: -500 });
  const at0 = arrangeAroundResource(cards, edges, 'focus', zero);
  assert.equal(at1000.a.x - at1000.focus.x, at0.a.x - at0.focus.x, 'A stays the same distance from focus regardless of anchor');
  assert.equal(at1000.a.y - at1000.focus.y, at0.a.y - at0.focus.y);
  assert.deepEqual(at1000.focus, { x: 1000, y: -500 });
});

check('a method/constructor-level focus is handled the same as any other card (kind-agnostic)', () => {
  const METHOD = { width: 250, height: 104 };
  const cards = [
    { id: 'caller', ...METHOD, qualifiedName: 'p.C#caller()' },
    { id: 'focus', ...METHOD, qualifiedName: 'p.C#focus()' },
    { id: 'ctor', ...METHOD, qualifiedName: 'p.C#<init>()' },
  ];
  const edges = [{ sourceId: 'caller', targetId: 'focus' }, { sourceId: 'focus', targetId: 'ctor' }];
  const positions = arrangeAroundResource(cards, edges, 'focus', zero);
  assert.equal(positions.caller.x, -346, 'caller (incoming) placed left using its actual width');
  assert.equal(positions.ctor.x, 346, 'constructor (outgoing) placed right using its actual width');
});

// --- Step 5 review remediation A2: sort order must be a fixed ordinal comparator, not locale-
// dependent. Names differing only by case sort differently under en-US localeCompare, so this case
// actually discriminates between the two implementations (unlike plain-ASCII names). ---
check('A2: within-group sort order is a fixed ordinal comparator, not locale-collation-dependent', () => {
  const cards = [
    { id: 'lower1', width: 250, height: 100, qualifiedName: 'p.airCarrier' },
    { id: 'upper1', width: 250, height: 100, qualifiedName: 'p.AirCarrier' },
    { id: 'focus', ...CLASS, qualifiedName: 'p.Focus' },
  ];
  const positions = arrangeAroundResource(cards, [], 'focus', zero);
  assert.ok('p.AirCarrier'.localeCompare('p.airCarrier') > 0, 'sanity check: localeCompare disagrees with ordinal for this pair under en-US');
  assert.ok(positions.upper1.x < positions.lower1.x, 'AirCarrier (ordinal-first, uppercase sorts before lowercase) must be placed further left in the unrelated row');
});

console.log(`test-focused-arrangement: ${passCount} checks passed`);
