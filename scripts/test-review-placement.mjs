// The placement records below come from the same placementForGraphs helper App uses before each
// membership reconciliation. The reducer then consumes them, so these checks cover the actual
// parked-review and expanded-container path rather than duplicating placeAdditions in the fixture.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const stripLocalImports = source => source.replace(/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]\.\.?\/[^'"]+['"];?\n?/g, '');

// These modules form the real frontend dependency chain. Their relative imports are stripped only
// because the data: URL used by this deterministic test has no filesystem module resolver.
const modules = [
  stripLocalImports(compile('../frontend/src/features/review/reviewPalette.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/scopeModel.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/graphModel.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/nodeCard.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/expansionLayout.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/graphPlacement.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/explorerViewState.ts')),
  stripLocalImports(compile('../frontend/src/features/explorer/placementGeometry.ts')),
].join('\n');
const {
  explorerViewReducer,
  initExplorerViewState,
  placementForGraphs,
  wholeSystemScope,
} = await import('data:text/javascript;base64,' + Buffer.from(modules).toString('base64'));

const pkg = { id: 'p0', kind: 'PACKAGE', simpleName: 'app', qualifiedName: 'app' };
const classNode = (id, name, parentId = 'p0') => ({ id, kind: 'CLASS', simpleName: name, qualifiedName: `app.${name}`, parentId });
const ordinary = { nodes: [pkg, classNode('c0', 'Keep'), classNode('c1', 'New')], edges: [] };
const review = {
  nodes: [pkg, classNode('c0', 'Keep'), classNode('review-node:old', 'Removed')],
  edges: [],
};
const ALL = wholeSystemScope();
const dims = (name = 'card') => ({ width: 250, height: 206, name });
const below = (position, height) => position.y + height / 2 + 64;

// A removed review-only card is hidden when Changes is off, but remains in displayedIds with its
// last position. Adding an ordinary class must clear its bottom edge, rather than the ordinary
// projection's smaller bottom edge, before placeAdditions chooses the new row.
{
  let state = initExplorerViewState('CLASS');
  state = explorerViewReducer(state, {
    type: 'RESET', level: 'CLASS', eligibleIds: ['c0'], batchSize: Infinity,
    placement: { c0: dims('Keep') },
  });
  state = explorerViewReducer(state, {
    type: 'REVIEW_IDS_AVAILABLE', level: 'CLASS', ids: ['review-node:old'],
    placement: { c0: dims('Keep'), 'review-node:old': dims('Removed') },
  });
  state = explorerViewReducer(state, {
    type: 'NODE_MOVED', level: 'CLASS', id: 'review-node:old', containerId: null,
    position: { x: 125, y: 600 }, generation: state.generation,
  });
  const placement = placementForGraphs(ordinary, state, ALL, 'ALL', ['c0', 'c1'], review);
  const next = explorerViewReducer(state, {
    type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1'], batchSize: Infinity, placement,
    preserveReviewOnly: true, reviewOnlyIds: ['review-node:old'],
  });
  const p1 = next.levelViews.CLASS.positions.c1;
  assert.ok(p1, 'new ordinary card receives a position');
  assert.ok(p1.y - 103 >= below({ x: 125, y: 600 }, 206), 'parked review card contributes its actual bottom edge');
}

// A removed child can remain inside a shared expanded package even though it is not a top-level
// displayed ID. The review projection still derives the package's compound box around that child;
// the ordinary addition must be placed below the union of both projections.
{
  const ordinaryWithChild = { nodes: [pkg, classNode('c0', 'Keep'), { id: 'p1', kind: 'PACKAGE', simpleName: 'next', qualifiedName: 'next' }], edges: [] };
  const reviewWithChild = { nodes: [pkg, classNode('c0', 'Keep'), classNode('review-node:old', 'Removed')], edges: [] };
  let state = initExplorerViewState('PACKAGE');
  state = explorerViewReducer(state, {
    type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0'], batchSize: Infinity,
    placement: { p0: { width: 280, height: 250, name: 'app' } },
  });
  state = explorerViewReducer(state, {
    type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p0', ownerId: null,
    childPositions: { c0: { x: 150, y: 150 }, 'review-node:old': { x: 150, y: 600 } },
    generation: state.generation,
  });
  const placement = placementForGraphs(ordinaryWithChild, state, ALL, 'ALL', ['p0', 'p1'], reviewWithChild);
  const next = explorerViewReducer(state, {
    type: 'SCOPE_UPDATED', eligibleIds: ['p0', 'p1'], batchSize: Infinity, placement,
    preserveReviewOnly: true, reviewOnlyIds: [], expansionChildren: { p0: ['c0', 'review-node:old'] },
  });
  const p1 = next.levelViews.PACKAGE.positions.p1;
  assert.ok(p1, 'new package receives a position');
  // The review-only child extends to y=703; container padding adds 44, then placement adds 64.
  assert.ok(p1.y - 125 >= 703 + 44 + 64, 'hidden review child enlarges the shared compound survivor bound');
}

// Scope filtering is part of the helper contract: a parked card outside the new target scope is
// excluded before survivor bounds are calculated and cannot keep pushing later additions downward.
{
  const custom = { mode: 'CUSTOM', selectedPackageIds: new Set(), selectedClassIds: new Set(['c0', 'c1']) };
  let state = initExplorerViewState('CLASS');
  state = explorerViewReducer(state, {
    type: 'RESET', level: 'CLASS', eligibleIds: ['c0'], batchSize: Infinity,
    placement: { c0: dims('Keep') },
  });
  state = explorerViewReducer(state, {
    type: 'REVIEW_IDS_AVAILABLE', level: 'CLASS', ids: ['review-node:old'],
    placement: { c0: dims('Keep'), 'review-node:old': dims('Removed') },
  });
  state = explorerViewReducer(state, {
    type: 'NODE_MOVED', level: 'CLASS', id: 'review-node:old', containerId: null,
    position: { x: 125, y: 600 }, generation: state.generation,
  });
  const placement = placementForGraphs(ordinary, state, custom, 'ALL', ['c0', 'c1'], review);
  const next = explorerViewReducer(state, {
    type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1'], batchSize: Infinity, placement,
    preserveReviewOnly: true, reviewOnlyIds: [],
  });
  const p1 = next.levelViews.CLASS.positions.c1;
  assert.equal(p1.y - 103, 103 + 103 + 64, 'out-of-scope parked review geometry is ignored');
}

// The same placement contract applies in Changes mode. Here c1 exists only in the ordinary graph,
// so it is parked while the review graph is active; a newly admitted review-only card must still
// be appended below c1's user-moved bounds.
{
  const reviewGraph = { nodes: [pkg, classNode('c0', 'Keep'), classNode('review-node:new', 'Added')], edges: [] };
  let state = initExplorerViewState('CLASS');
  state = explorerViewReducer(state, {
    type: 'RESET', level: 'CLASS', eligibleIds: ['c0', 'c1'], batchSize: Infinity,
    placement: { c0: dims('Keep'), c1: dims('Orphan') },
  });
  state = explorerViewReducer(state, {
    type: 'NODE_MOVED', level: 'CLASS', id: 'c1', containerId: null,
    position: { x: 125, y: 600 }, generation: state.generation,
  });
  const placement = placementForGraphs(reviewGraph, state, ALL, 'ALL', ['c0', 'review-node:new'], ordinary);
  const next = explorerViewReducer(state, {
    type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'review-node:new'], batchSize: Infinity, placement,
    parkedIds: ['c1'], expansionChildren: {},
  });
  assert.deepEqual(next.levelViews.CLASS.positions.c1, { x: 125, y: 600 }, 'ordinary-only survivor remains parked in Changes');
  const added = next.levelViews.CLASS.positions['review-node:new'];
  assert.ok(added, 'new review card receives a position');
  assert.ok(added.y - 103 >= 600 + 103 + 64, 'parked ordinary card contributes its actual bottom edge in Changes');
}

// A hidden ordinary child can enlarge a compound survivor in the reverse direction too. The
// review projection has only c0 inside p0; c1 remains in the parked ordinary projection at y=600.
{
  const ordinaryExpanded = { nodes: [pkg, classNode('c0', 'Keep'), classNode('c1', 'Orphan')], edges: [] };
  const reviewExpanded = { nodes: [pkg, classNode('c0', 'Keep'), { id: 'review-node:added-package', kind: 'PACKAGE', simpleName: 'next', qualifiedName: 'next' }], edges: [] };
  let state = initExplorerViewState('PACKAGE');
  state = explorerViewReducer(state, {
    type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0'], batchSize: Infinity,
    placement: { p0: { width: 280, height: 250, name: 'app' } },
  });
  state = explorerViewReducer(state, {
    type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p0', ownerId: null,
    childPositions: { c0: { x: 150, y: 150 }, c1: { x: 150, y: 600 } }, generation: state.generation,
  });
  const placement = placementForGraphs(reviewExpanded, state, ALL, 'ALL', ['p0', 'review-node:added-package'], ordinaryExpanded);
  const next = explorerViewReducer(state, {
    type: 'SCOPE_UPDATED', eligibleIds: ['p0', 'review-node:added-package'], batchSize: Infinity, placement,
    parkedIds: ['p0'], expansionChildren: { p0: ['c0', 'c1'] },
  });
  const added = next.levelViews.PACKAGE.positions['review-node:added-package'];
  assert.ok(added, 'new review package receives a position');
  assert.ok(added.y - 125 >= 703 + 44 + 64, 'hidden ordinary child enlarges the shared compound bound in Changes');
}

console.log('PASS: review placement union keeps parked cards and removed expanded children out of addition overlaps, with target-scope filtering');
