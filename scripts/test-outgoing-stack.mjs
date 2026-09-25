// Pure, hand-computable fixtures for outgoingStack.ts (docs/OUTGOING_STACK.md §Traversal).
// The helper walks parser relationship FACTS (raw graph edges) at the granularity of the root's
// kind -- package, class or method -- and maps what it reaches onto the drawn cards. Each fixture
// therefore gives a small parser graph (packages, classes, methods with parentId, raw edges), the
// cards the canvas draws (projectDisplayed's shape: `containerId` on cards inside an expanded box)
// and the drawn aggregated routes with their `occurrenceIds`. Expected values are literal and
// worked out by hand from the rules; nothing here recomputes them.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
// outgoingStack.ts reuses ownerAt/isType from graphModel.ts, which imports scopeModel.ts: compile
// all three into one module and strip the relative imports (the test-explorer-journeys.mjs pattern).
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/explorer/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import \{[^}]*\} from ['"]\.\/[^'"]+['"];?\n?/g, '');
const compiled = ['scopeModel', 'graphModel', 'outgoingStack'].map(compile).join('\n');
const { outgoingStack, stackSummary } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS', name); };

// --- fixture builders --------------------------------------------------------------------------
// Package ids are single letters (A, B, ...); classes are capitalized names (P, Q, ...); methods are
// "Class.name". parentId: method -> class -> package.
const pkg = id => ({ id, kind: 'PACKAGE', simpleName: id });
const cls = (id, parentId) => ({ id, kind: 'CLASS', simpleName: id, parentId });
const mth = (id, parentId) => ({ id, kind: 'METHOD', simpleName: id, parentId });
const fact = (id, sourceId, targetId, extra = {}) => ({ id, sourceId, targetId, kind: 'CALLS', resolution: 'RESOLVED', ...extra });
const card = (id, kind, containerId) => ({ id, kind, ...(containerId ? { containerId } : {}) });
const route = (sourceId, targetId, occurrenceIds, extra = {}) => ({ id: `${sourceId}>${targetId}${extra.reviewChange ? ':' + extra.reviewChange : ''}`, sourceId, targetId, occurrenceIds, ...extra });
const run = (graph, cards, routes, rootId, extra = {}) => outgoingStack({ graph, cards, routes, rootId, kind: 'ALL', direction: 'out', ...extra });
const layersOf = stack => Object.fromEntries([...stack.layers].sort(([a], [b]) => a.localeCompare(b)));
const sorted = set => [...set].sort();

// The user's world: packages A -> B -> C, plus D. P (in A) calls Q.q (in B). Q.q2 calls T.t (in C);
// S (also in B) calls U.u (in D). Specific checks add or drop facts from this list.
const NODES = [
  pkg('A'), pkg('B'), pkg('C'), pkg('D'),
  cls('P', 'A'), mth('P.m', 'P'), mth('P.m2', 'P'),
  cls('Q', 'B'), mth('Q.q', 'Q'), mth('Q.q2', 'Q'),
  cls('S', 'B'), mth('S.s', 'S'),
  cls('T', 'C'), mth('T.t', 'T'),
  cls('U', 'D'), mth('U.u', 'U'),
];
const graphOf = edges => ({ nodes: NODES, edges });
const PQ = fact('pq', 'P.m', 'Q.q'), QT = fact('qt', 'Q.q2', 'T.t'), ST = fact('st', 'S.s', 'T.t'), SU = fact('su', 'S.s', 'U.u');
// A expanded around class P; B, C and D collapsed.
const classPage = [card('A', 'PACKAGE'), card('P', 'CLASS', 'A'), card('B', 'PACKAGE'), card('C', 'PACKAGE'), card('D', 'PACKAGE')];
// A expanded, P expanded around its methods; B, C, D collapsed.
const methodPage = [card('A', 'PACKAGE'), card('P', 'CLASS', 'A'), card('P.m', 'METHOD', 'P'), card('P.m2', 'METHOD', 'P'), card('B', 'PACKAGE'), card('C', 'PACKAGE'), card('D', 'PACKAGE')];
const packagePage = [card('A', 'PACKAGE'), card('B', 'PACKAGE'), card('C', 'PACKAGE'), card('D', 'PACKAGE')];

// --- root, empty stack, summary ----------------------------------------------------------------
check('a root that is not displayed has no stack', () => {
  assert.equal(run(graphOf([PQ]), packagePage, [], 'P'), null, 'P is a graph node but not a drawn card');
  assert.equal(run(graphOf([PQ]), packagePage, [], 'missing'), null);
});

check('empty stack: a drawn root with no outgoing fact has zero layers, no covered cards, no chain routes', () => {
  const stack = run(graphOf([fact('bp', 'Q.q', 'P.m')]), classPage, [route('B', 'P', ['bp'])], 'P');
  assert.deepEqual(layersOf(stack), {});
  assert.deepEqual(sorted(stack.rootSet), ['P']);
  assert.deepEqual(sorted(stack.coveredIds), []);
  assert.deepEqual(sorted(stack.chainEdgeIds), []);
  assert.equal(stack.depth, 0); assert.equal(stack.count, 0);
});

check('the summary line counts layers and resources, singular for 1', () => {
  assert.equal(stackSummary({ depth: 2, count: 3 }), 'Outgoing stack: 2 layers · 3 resources');
  assert.equal(stackSummary({ depth: 1, count: 1 }), 'Outgoing stack: 1 layer · 1 resource');
  assert.equal(stackSummary({ depth: 0, count: 0 }), 'Outgoing stack: 0 layers · 0 resources');
});

// --- the user's scenario -----------------------------------------------------------------------
check('user scenario, class root P: B is layer 1; C is NOT reached when only another class S in B calls into C', () => {
  const routes = [route('P', 'B', ['pq']), route('B', 'C', ['st'])];
  const stack = run(graphOf([PQ, ST]), classPage, routes, 'P');
  assert.deepEqual(layersOf(stack), { B: 1 }, 'the collapsed B card is not a hub: P never reaches S');
  assert.deepEqual(sorted(stack.chainEdgeIds), ['P>B'], 'the drawn B -> C route carries only S -> T, which is not a chain step');
  assert.equal(stack.depth, 1); assert.equal(stack.count, 1);
});

check('user scenario, package root A: the package-level walk gives B 1 and C 2', () => {
  const routes = [route('A', 'B', ['pq']), route('B', 'C', ['st'])];
  const stack = run(graphOf([PQ, ST]), packagePage, routes, 'A');
  assert.deepEqual(layersOf(stack), { B: 1, C: 2 });
  assert.deepEqual(sorted(stack.chainEdgeIds), ['A>B', 'B>C']);
  assert.deepEqual(sorted(stack.rootSet), ['A']);
  assert.equal(stack.depth, 2); assert.equal(stack.count, 2);
});

check('a class-level chain crossing a collapsed package: P -> Q (in B) -> T (in C) gives B 1, C 2; S -> U does not reach D', () => {
  const routes = [route('P', 'B', ['pq']), route('B', 'C', ['qt']), route('B', 'D', ['su'])];
  const stack = run(graphOf([PQ, QT, SU]), classPage, routes, 'P');
  assert.deepEqual(layersOf(stack), { B: 1, C: 2 }, 'Q.q2 -> T.t is a Q -> T step at class level');
  assert.deepEqual(sorted(stack.chainEdgeIds), ['B>C', 'P>B'], 'the drawn B -> D route is not a chain route');
});

check('package root over the same facts reaches D too (every B relation counts at package level)', () => {
  const routes = [route('A', 'B', ['pq']), route('B', 'C', ['qt']), route('B', 'D', ['su'])];
  const stack = run(graphOf([PQ, QT, SU]), packagePage, routes, 'A');
  assert.deepEqual(layersOf(stack), { B: 1, C: 2, D: 2 });
  assert.deepEqual(sorted(stack.chainEdgeIds), ['A>B', 'B>C', 'B>D']);
});

// --- method root -------------------------------------------------------------------------------
check('method root M walks method-level facts only: q2 -> t is unreachable, class-level and class-target facts are ignored', () => {
  const PT = fact('pt', 'P', 'T', { kind: 'DEPENDS_ON' });          // class -> class: no method owner
  const NEWQ = fact('newq', 'P.m', 'Q', { kind: 'CONSTRUCTS' });     // targets the class Q itself
  const routes = [route('P.m', 'B', ['pq', 'newq']), route('B', 'C', ['qt']), route('B', 'D', ['su']), route('P', 'C', ['pt'])];
  const stack = run(graphOf([PQ, QT, SU, PT, NEWQ]), methodPage, routes, 'P.m');
  assert.deepEqual(layersOf(stack), { B: 1 });
  assert.deepEqual(sorted(stack.rootSet), ['P.m']);
  assert.deepEqual(sorted(stack.chainEdgeIds), ['P.m>B'], 'P.m -> B is a chain route through pq; P -> C carries only a class-level fact');
  // The same facts with class root P: the class-level P -> T fact reaches C at layer 1.
  const asClass = run(graphOf([PQ, QT, SU, PT, NEWQ]), classPage, [route('P', 'B', ['pq', 'newq']), route('B', 'C', ['qt']), route('B', 'D', ['su']), route('P', 'C', ['pt'])], 'P');
  assert.deepEqual(layersOf(asClass), { B: 1, C: 1 });
});

check('method root: a method chain M -> q -> t does reach C; a sibling method card inside the root class is a card of its own', () => {
  const QQ = fact('qqt', 'Q.q', 'T.t'), MM2 = fact('mm2', 'P.m', 'P.m2');
  const routes = [route('P.m', 'B', ['pq']), route('B', 'C', ['qqt']), route('P.m', 'P.m2', ['mm2'])];
  const stack = run(graphOf([PQ, QQ, MM2]), methodPage, routes, 'P.m');
  assert.deepEqual(layersOf(stack), { B: 1, C: 2, 'P.m2': 1 });
  assert.deepEqual(sorted(stack.chainEdgeIds), ['B>C', 'P.m>B', 'P.m>P.m2']);
  assert.equal(stack.depth, 2); assert.equal(stack.count, 3);
});

// --- representatives ---------------------------------------------------------------------------
check("a card's layer is the minimum over the entities it represents", () => {
  // P -> Q (B, 1) -> T (C, 2) -> R (back in B, 3): B keeps 1.
  const nodes = [...NODES, cls('R', 'B'), mth('R.r', 'R')];
  const QQ = fact('qqt', 'Q.q', 'T.t'), TR = fact('tr', 'T.t', 'R.r');
  const stack = outgoingStack({ graph: { nodes, edges: [PQ, QQ, TR] }, cards: classPage, routes: [route('P', 'B', ['pq']), route('B', 'C', ['qqt']), route('C', 'B', ['tr'])], rootId: 'P', kind: 'ALL', direction: 'out' });
  assert.deepEqual(layersOf(stack), { B: 1, C: 2 });
  assert.deepEqual(sorted(stack.chainEdgeIds), ['B>C', 'C>B', 'P>B'], 'the back route C -> B joins two chain entities');
  assert.equal(stack.depth, 2);
});

check('an entity without its own card is represented by its nearest drawn ancestor (a collapsed class inside an expanded package)', () => {
  // B is expanded; Q is drawn collapsed inside it. Method root P.m reaches Q.q, represented by Q.
  const cards = [card('A', 'PACKAGE'), card('P', 'CLASS', 'A'), card('P.m', 'METHOD', 'P'), card('P.m2', 'METHOD', 'P'), card('B', 'PACKAGE'), card('Q', 'CLASS', 'B'), card('S', 'CLASS', 'B'), card('C', 'PACKAGE')];
  const stack = run(graphOf([PQ, QT]), cards, [route('P.m', 'Q', ['pq']), route('Q', 'C', ['qt'])], 'P.m');
  assert.deepEqual(layersOf(stack), { Q: 1 }, 'the B box represents no method: Q does');
  assert.deepEqual(sorted(stack.coveredIds), [], 'Q is collapsed, so nothing is drawn inside it');
  assert.deepEqual(sorted(stack.chainEdgeIds), ['P.m>Q']);
});

check('an entity with no drawn representative stops the chain', () => {
  // X lives in package E, which is not on the page: P -> X -> T must not reach C.
  const nodes = [...NODES, pkg('E'), cls('X', 'E'), mth('X.x', 'X')];
  const edges = [fact('px', 'P.m', 'X.x'), fact('xt', 'X.x', 'T.t')];
  const stack = outgoingStack({ graph: { nodes, edges }, cards: classPage, routes: [], rootId: 'P', kind: 'ALL', direction: 'out' });
  assert.deepEqual(layersOf(stack), {});
  assert.equal(stack.depth, 0);
});

check('ancestors of the root never get a layer, but the walk continues through the entities they represent', () => {
  // P2 is in A but not drawn (out of scope), so A's box represents it. P -> P2 -> Q reaches B at 2.
  const nodes = [...NODES, cls('P2', 'A'), mth('P2.x', 'P2')];
  const edges = [fact('pp2', 'P.m', 'P2.x'), fact('p2q', 'P2.x', 'Q.q')];
  const stack = outgoingStack({ graph: { nodes, edges }, cards: classPage, routes: [route('A', 'B', ['p2q'])], rootId: 'P', kind: 'ALL', direction: 'out' });
  assert.deepEqual(layersOf(stack), { B: 2 }, 'the A box gets no layer 1; B keeps its true distance');
  assert.deepEqual(sorted(stack.chainEdgeIds), ['A>B']);
  assert.equal(stack.depth, 2); assert.equal(stack.count, 1);
});

// --- filters -----------------------------------------------------------------------------------
check('the relationship-kind filter limits the facts walked', () => {
  const PQD = fact('pqd', 'P', 'Q', { kind: 'DEPENDS_ON' });
  const graph = graphOf([PQD, QT]);
  const routesAll = [route('P', 'B', ['pqd']), route('B', 'C', ['qt'])];
  assert.deepEqual(layersOf(run(graph, classPage, routesAll, 'P')), { B: 1, C: 2 });
  assert.deepEqual(layersOf(run(graph, classPage, [route('P', 'B', ['pqd'])], 'P', { kind: 'DEPENDS_ON' })), { B: 1 }, 'Q -> T is a CALLS fact');
  const calls = run(graph, classPage, [route('B', 'C', ['qt'])], 'P', { kind: 'CALLS' });
  assert.deepEqual(layersOf(calls), {}, 'without DEPENDS_ON, P reaches nothing');
  assert.deepEqual(sorted(calls.chainEdgeIds), []);
});

check('REMOVED facts are not walked and make no chain route; ADDED and UNCHANGED ones are', () => {
  const removed = fact('pq-', 'P.m', 'Q.q', { reviewChange: 'REMOVED' });
  const added = fact('pt+', 'P.m', 'T.t', { reviewChange: 'ADDED' });
  const same = fact('qt=', 'Q.q2', 'T.t', { reviewChange: 'UNCHANGED' });
  const routes = [route('P', 'B', ['pq-'], { reviewChange: 'REMOVED' }), route('P', 'C', ['pt+'], { reviewChange: 'ADDED' }), route('B', 'C', ['qt='], { reviewChange: 'UNCHANGED' })];
  const stack = run(graphOf([removed, added, same]), classPage, routes, 'P');
  assert.deepEqual(layersOf(stack), { C: 1 });
  assert.deepEqual(sorted(stack.chainEdgeIds), ['P>C:ADDED']);
});

check('facts with a null target or unknown endpoints are skipped', () => {
  const stack = run(graphOf([fact('n', 'P.m', null), fact('u', 'P.m', 'nowhere'), PQ]), classPage, [route('P', 'B', ['pq'])], 'P');
  assert.deepEqual(layersOf(stack), { B: 1 });
});

// --- cycles and self-loops ---------------------------------------------------------------------
check('cycles and self-loops assign nothing new; self-loops of chain entities still count for chain routes', () => {
  // Package level: A -> B, B -> A, B -> C, C -> B, and Q -> S inside B (a B -> B self-loop).
  const edges = [PQ, fact('qp', 'Q.q', 'P.m'), QT, fact('tq', 'T.t', 'Q.q'), fact('qs', 'Q.q', 'S.s')];
  const routes = [route('A', 'B', ['pq']), route('B', 'A', ['qp']), route('B', 'C', ['qt']), route('C', 'B', ['tq'])];
  const pkgStack = run(graphOf(edges), packagePage, routes, 'A');
  assert.deepEqual(layersOf(pkgStack), { B: 1, C: 2 });
  assert.deepEqual(sorted(pkgStack.chainEdgeIds), ['A>B', 'B>A', 'B>C', 'C>B']);
  // Method level: recursion m -> m and a callback q -> m.
  const rec = fact('mm', 'P.m', 'P.m'), back = fact('qm', 'Q.q', 'P.m');
  const methodStack = run(graphOf([rec, PQ, back]), methodPage, [route('P.m', 'P.m', ['mm']), route('P.m', 'B', ['pq']), route('B', 'P.m', ['qm'])], 'P.m');
  assert.deepEqual(layersOf(methodStack), { B: 1 });
  assert.deepEqual(sorted(methodStack.chainEdgeIds), ['B>P.m', 'P.m>B', 'P.m>P.m']);
  assert.equal(methodStack.depth, 1);
});

// --- expanded root and expanded reached cards --------------------------------------------------
check('expanded root: the root set is the root plus every drawn card inside it; internal facts give no layer', () => {
  const nodes = [...NODES, cls('P2', 'A'), mth('P2.x', 'P2')];
  const cards = [card('A', 'PACKAGE'), card('P', 'CLASS', 'A'), card('P.m', 'METHOD', 'P'), card('P.m2', 'METHOD', 'P'), card('P2', 'CLASS', 'A'), card('B', 'PACKAGE'), card('C', 'PACKAGE')];
  const edges = [fact('pp2', 'P.m', 'P2.x'), PQ, fact('mm2', 'P.m', 'P.m2')];
  const routes = [route('P.m', 'P2', ['pp2']), route('P.m', 'B', ['pq']), route('P.m', 'P.m2', ['mm2'])];
  const stack = outgoingStack({ graph: { nodes, edges }, cards, routes, rootId: 'A', kind: 'ALL', direction: 'out' });
  assert.deepEqual(sorted(stack.rootSet), ['A', 'P', 'P.m', 'P.m2', 'P2']);
  assert.deepEqual(layersOf(stack), { B: 1 });
  assert.deepEqual(sorted(stack.coveredIds), []);
  assert.deepEqual(sorted(stack.chainEdgeIds), ['P.m>B', 'P.m>P.m2', 'P.m>P2'], 'routes inside the root are A -> A steps of a chain entity');
  // Class root P expanded: P.m -> P.m2 is a P -> P self-loop, P -> P2 reaches P2 at layer 1.
  const asClass = outgoingStack({ graph: { nodes, edges }, cards, routes, rootId: 'P', kind: 'ALL', direction: 'out' });
  assert.deepEqual(sorted(asClass.rootSet), ['P', 'P.m', 'P.m2']);
  assert.deepEqual(layersOf(asClass), { B: 1, P2: 1 });
});

check('a reached expanded box carries the badge and its drawn children are covered; package layers ignore downstream expansion', () => {
  const edges = [PQ, ST];
  const collapsed = run(graphOf(edges), packagePage, [route('A', 'B', ['pq']), route('B', 'C', ['st'])], 'A');
  const expandedCards = [card('A', 'PACKAGE'), card('B', 'PACKAGE'), card('Q', 'CLASS', 'B'), card('S', 'CLASS', 'B'), card('Q.q', 'METHOD', 'Q'), card('Q.q2', 'METHOD', 'Q'), card('C', 'PACKAGE'), card('D', 'PACKAGE')];
  const expanded = run(graphOf(edges), expandedCards, [route('A', 'Q.q', ['pq']), route('S', 'C', ['st'])], 'A');
  assert.deepEqual(layersOf(expanded), { B: 1, C: 2 });
  assert.deepEqual(layersOf(expanded), layersOf(collapsed), 'expanding B does not change package-level layers');
  assert.deepEqual(sorted(expanded.coveredIds), ['Q', 'Q.q', 'Q.q2', 'S'], 'every drawn card inside the layered box, nested ones too');
  assert.deepEqual(sorted(expanded.chainEdgeIds), ['A>Q.q', 'S>C']);
  assert.equal(expanded.count, 2);
});

check('an out-of-scope entity inside an expanded box is represented by the box', () => {
  // B expanded shows only Q (S is out of scope). Class root P reaches S only: the B box gets layer 1.
  const cards = [card('A', 'PACKAGE'), card('P', 'CLASS', 'A'), card('B', 'PACKAGE'), card('Q', 'CLASS', 'B'), card('C', 'PACKAGE')];
  const edges = [fact('ps', 'P.m', 'S.s'), ST];
  const stack = run(graphOf(edges), cards, [route('P', 'B', ['ps']), route('B', 'C', ['st'])], 'P');
  assert.deepEqual(layersOf(stack), { B: 1, C: 2 });
  assert.deepEqual(sorted(stack.coveredIds), ['Q']);
});

// --- chain routes ------------------------------------------------------------------------------
check('a drawn route is a chain route only if one of its occurrences is a step between chain entities', () => {
  const graph = graphOf([PQ, QT, ST]);
  const mixed = run(graph, classPage, [route('P', 'B', ['pq']), route('B', 'C', ['st', 'qt'])], 'P');
  assert.deepEqual(sorted(mixed.chainEdgeIds), ['B>C', 'P>B'], 'qt is a Q -> T chain step even though st is not');
  assert.deepEqual(layersOf(mixed), { B: 1, C: 2 });
  const onlyOther = run(graphOf([PQ, ST]), classPage, [route('P', 'B', ['pq']), route('B', 'C', ['st'])], 'P');
  assert.deepEqual(sorted(onlyOther.chainEdgeIds), ['P>B']);
  const filtered = run(graph, classPage, [route('P', 'B', ['pq']), route('B', 'C', ['st', 'qt'])], 'P', { kind: 'DEPENDS_ON' });
  assert.deepEqual(sorted(filtered.chainEdgeIds), [], 'a filtered-out occurrence is never a chain step');
});

// --- direction and determinism -----------------------------------------------------------------
check("direction 'in' walks the same facts reversed", () => {
  const cards = [card('A', 'PACKAGE'), card('B', 'PACKAGE'), card('C', 'PACKAGE'), card('T', 'CLASS', 'C'), card('D', 'PACKAGE')];
  const edges = [PQ, QT, SU];
  const stack = run(graphOf(edges), cards, [route('A', 'B', ['pq']), route('B', 'T', ['qt']), route('B', 'D', ['su'])], 'T', { direction: 'in' });
  assert.deepEqual(layersOf(stack), { A: 2, B: 1 }, 'T <- Q (B) <- P (A); S -> U does not lead into T');
  assert.deepEqual(sorted(stack.chainEdgeIds), ['A>B', 'B>T']);
});

check('the result does not depend on the order of nodes, facts, cards or routes', () => {
  const edges = [PQ, QT, SU, ST, fact('qp', 'Q.q', 'P.m')];
  const routes = [route('P', 'B', ['pq']), route('B', 'C', ['qt', 'st']), route('B', 'D', ['su']), route('B', 'P', ['qp'])];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shuffle = list => list.map(v => [rnd(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  for (let i = 0; i < 20; i++) {
    const stack = outgoingStack({ graph: { nodes: shuffle(NODES), edges: shuffle(edges) }, cards: shuffle(classPage), routes: shuffle(routes), rootId: 'P', kind: 'ALL', direction: 'out' });
    assert.deepEqual(layersOf(stack), { B: 1, C: 2 });
    assert.deepEqual(sorted(stack.chainEdgeIds), ['B>C', 'B>P', 'P>B']);
    assert.equal(stack.depth, 2); assert.equal(stack.count, 2);
  }
});

console.log(`${count} outgoing-stack checks passed`);
