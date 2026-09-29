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
const { arrangeAroundResource, arrangeDisplayed } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

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


// --- Step 14 (ADR 0011): arranging the displayed map looks through ungrouped (hidden) boxes ---
const box = (x, y, w = 250, h = 128) => ({ x1: x - w / 2, y1: y - h / 2, x2: x + w / 2, y2: y + h / 2 });
const mapCard = (id, x, y, extra = {}) => ({ id, containerId: null, qualifiedName: id, box: box(x, y), position: { x, y }, ...extra });

check('arrangeDisplayed with no expansions matches arrangeAroundResource on the same cards', () => {
  const cards = [mapCard('a', 0, 0), mapCard('b', 900, 0), mapCard('c', 0, 900)];
  const edges = [{ sourceId: 'a', targetId: 'b' }];
  const result = arrangeDisplayed(cards, edges, 'a');
  const plain = arrangeAroundResource(cards.map(c => ({ id: c.id, width: 250, height: 128, qualifiedName: c.id })), edges, 'a', { x: 0, y: 0 });
  assert.deepEqual(result, { positions: plain, childPositions: {} });
});

check('freed classes of a hidden package arrange individually and are stored under it', () => {
  // Hidden package P holds A and B; top-level Q. A calls B and Q.
  const cards = [
    { id: 'P', containerId: null, expanded: true, hidden: true, qualifiedName: 'P', box: { x1: -125, y1: -64, x2: 3125, y2: 64 }, position: { x: 0, y: 0 } },
    { id: 'A', containerId: 'P', qualifiedName: 'p.A', box: box(0, 0), position: { x: 0, y: 0 } },
    { id: 'B', containerId: 'P', qualifiedName: 'p.B', box: box(3000, 0), position: { x: 3000, y: 0 } },
    mapCard('Q', 1500, 1500),
  ];
  const edges = [{ sourceId: 'A', targetId: 'B' }, { sourceId: 'A', targetId: 'Q' }];
  const result = arrangeDisplayed(cards, edges, 'A');
  assert.ok(result);
  assert.equal(result.positions.P, undefined, 'the hidden box is not a card of its own');
  assert.deepEqual(result.childPositions.P.A, { x: 0, y: 0 }, 'the focus keeps its place');
  const right = 125 + 96 + 125;
  // The right column sorts by qualified name ('Q' before 'p.B', ordinal order).
  assert.deepEqual(result.positions.Q, { x: right, y: -(128 + 48) / 2 });
  assert.deepEqual(result.childPositions.P.B, { x: right, y: (128 + 48) / 2 }, 'B stacks right of A, as a card of its own');
});

check('a visible box inside a hidden package moves as one unit, carrying its methods', () => {
  // Hidden P holds expanded class C (methods m1, m2) and class D. D calls into m1, so D -> C.
  const cards = [
    { id: 'P', containerId: null, expanded: true, hidden: true, qualifiedName: 'P', box: { x1: -500, y1: -500, x2: 2000, y2: 500 }, position: { x: 0, y: 0 } },
    { id: 'C', containerId: 'P', expanded: true, qualifiedName: 'p.C', box: { x1: -100, y1: -100, x2: 100, y2: 100 }, position: { x: 0, y: 0 } },
    { id: 'm1', containerId: 'C', qualifiedName: 'p.C.m1', box: box(-40, 0, 60, 60), position: { x: -40, y: 0 } },
    { id: 'm2', containerId: 'C', qualifiedName: 'p.C.m2', box: box(40, 0, 60, 60), position: { x: 40, y: 0 } },
    { id: 'D', containerId: 'P', qualifiedName: 'p.D', box: box(1500, 0), position: { x: 1500, y: 0 } },
  ];
  const result = arrangeDisplayed(cards, [{ sourceId: 'D', targetId: 'm1' }], 'D');
  assert.ok(result);
  // D -> m1 counts as D -> C (C's box is the unit): C is D's only outgoing card, one column right.
  const cx = 1500 + 125 + 96 + 100;
  assert.deepEqual(result.childPositions.P.C, { x: cx, y: 0 });
  assert.deepEqual(result.childPositions.C, { m1: { x: -40 + cx, y: 0 }, m2: { x: 40 + cx, y: 0 } }, 'the methods move with their class box');
  assert.deepEqual(result.childPositions.P.D, { x: 1500, y: 0 });
});

check('the focus may sit deep inside a visible box inside a hidden one: its unit is that box', () => {
  const cards = [
    { id: 'P', containerId: null, expanded: true, hidden: true, qualifiedName: 'P', box: { x1: 0, y1: 0, x2: 10, y2: 10 }, position: { x: 0, y: 0 } },
    { id: 'C', containerId: 'P', expanded: true, qualifiedName: 'p.C', box: { x1: -100, y1: -100, x2: 100, y2: 100 }, position: { x: 0, y: 0 } },
    { id: 'm1', containerId: 'C', qualifiedName: 'p.C.m1', box: box(0, 0, 60, 60), position: { x: 0, y: 0 } },
  ];
  const result = arrangeDisplayed(cards, [], 'm1');
  assert.deepEqual(result.childPositions.P, { C: { x: 0, y: 0 } });
  assert.deepEqual(result.childPositions.C, { m1: { x: 0, y: 0 } }, 'the focus itself stays where it is');
  assert.equal(arrangeDisplayed(cards, [], 'P'), null, 'a hidden box cannot be the focus');
});

check('a visible expanded box moves by its box offset: its stored anchor (not its box centre) and its children shift together', () => {
  // X's stored position is its collapse anchor (box top-left plus half its collapsed card), which is
  // not its box centre (1000, 0). F -> X puts X's box centre one column right of F: x = 125 + 96 + 100.
  const cards = [
    mapCard('F', 0, 0),
    { id: 'X', containerId: null, expanded: true, qualifiedName: 'X', box: { x1: 900, y1: -100, x2: 1100, y2: 100 }, position: { x: 1025, y: -36 } },
    { id: 'k', containerId: 'X', qualifiedName: 'X.k', box: box(1000, 0, 60, 60), position: { x: 1000, y: 0 } },
  ];
  const result = arrangeDisplayed(cards, [{ sourceId: 'F', targetId: 'k' }], 'F');
  const dx = 321 - 1000;
  assert.deepEqual(result.positions.X, { x: 1025 + dx, y: -36 }, 'the anchor keeps its offset from the box (deliberate since step 14)');
  assert.deepEqual(result.childPositions.X, { k: { x: 1000 + dx, y: 0 } });
});

console.log(`test-focused-arrangement: ${passCount} checks passed`);
