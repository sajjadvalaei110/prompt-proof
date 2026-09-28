import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/explorer/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import \{[^}]*\} from ['"]\.\/[^'"]+['"];?\n?/g, '');
const compiled = ['graphPlacement', 'scopeModel', 'graphModel', 'explorerViewState', 'explorerJourney', 'revalidateJourney'].map(name => name === 'explorerViewState'
  ? compile(name).replaceAll('HISTORY_LIMIT', 'NAVIGATION_HISTORY_LIMIT') : compile(name)).join('\n');
const { initJourneys, journeysReducer: reduce, explorerViewReducer: viewReduce, HISTORY_LIMIT, newJourney, toggleJourneyReview, initExplorerViewState, revalidateJourneyState } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS', name); };
const active = s => s.tabs.find(t => t.id === s.activeId);
const update = (s, group, fn, id = s.activeId) => reduce(s, { type: 'UPDATE', id, group, update: fn });
const inspect = (s, group, id) => update(s, group, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_NODE', id }) }));

const edit = (s, group, text) => update(s, group, j => ({ ...j, search: text }));
const selection = j => ({ subject: j.view.inspectedSubjectId, kind: j.view.inspectedKind, level: j.view.inspectedLevel, occurrence: j.view.inspectedOccurrenceId, back: j.view.history.map(e => e.subjectId), multi: j.multiIds });
const moveCard = (s, group, id, position) => update(s, group, j => ({ ...j, view: viewReduce(j.view, { type: 'NODE_MOVED', level: 'PACKAGE', id, position, generation: j.view.generation }) }));
// A small displayed map for the ADR 0009 checks: packages p1..p3 at PACKAGE level, with p1 -> p2
// and p2 -> p3 calls so the drawn routes are aggregate:["p1","p2"] and aggregate:["p2","p3"].
const fixtureGraph = { nodes: [
  { id: 'p1', kind: 'PACKAGE', simpleName: 'one' }, { id: 'p2', kind: 'PACKAGE', simpleName: 'two' }, { id: 'p3', kind: 'PACKAGE', simpleName: 'three' },
  { id: 'c1', kind: 'CLASS', simpleName: 'One', parentId: 'p1' }, { id: 'c2', kind: 'CLASS', simpleName: 'Two', parentId: 'p2' }, { id: 'c3', kind: 'CLASS', simpleName: 'Three', parentId: 'p3' },
], edges: [
  { id: 'e12', sourceId: 'c1', targetId: 'c2', kind: 'CALLS', resolution: 'RESOLVED' },
  { id: 'e23', sourceId: 'c2', targetId: 'c3', kind: 'CALLS', resolution: 'RESOLVED' },
] };
const graphFor = () => fixtureGraph;
const placed = ids => Object.fromEntries(ids.map(id => [id, { width: 220, height: 100, name: id }]));
const mapJourney = ids => newJourney(viewReduce(initExplorerViewState(), { type: 'RESET', level: 'PACKAGE', eligibleIds: ids, batchSize: Infinity, placement: placed(ids) }));
const showOnly = (s, group, ids) => update(s, group, j => ({ ...j, view: viewReduce(j.view, { type: 'SCOPE_UPDATED', eligibleIds: ids, batchSize: Infinity, placement: placed(ids) }) }));
const undo = s => reduce(s, { type: 'UNDO', graphFor });
const redo = s => reduce(s, { type: 'REDO', graphFor });

check('one user action restores scope and tree together; the selection riding along stays current', () => {
  let s = initJourneys(); const before = active(s).present;
  s = update(s, 1, j => ({ ...j, scope: { mode: 'CUSTOM', selectedPackageIds: new Set(['p']), selectedClassIds: new Set() } }));
  s = inspect(s, 1, 'c');
  s = update(s, 1, j => ({ ...j, treeOpen: { p: true } }));
  const after = active(s).present;
  assert.equal(active(s).past.length, 1);
  s = reduce(s, { type: 'UNDO' });
  assert.strictEqual(active(s).present.scope, before.scope); assert.strictEqual(active(s).present.treeOpen, before.treeOpen);
  assert.equal(active(s).present.view.inspectedSubjectId, 'c', 'undo leaves the current inspection in place');
  s = reduce(s, { type: 'REDO' }); assert.strictEqual(active(s).present, after, 'redo returns the identical present when the selection is unchanged');
});
check('a click sequence (inspect, occurrence, multi-select, clear) creates no undo entry and keeps redo', () => {
  let s = edit(edit(initJourneys(), 1, 'one'), 2, 'two'); s = reduce(s, { type: 'UNDO' });
  assert.equal(active(s).past.length, 1); assert.equal(active(s).future.length, 1);
  s = inspect(s, 3, 'a');
  s = update(s, 4, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'route' }) }));
  s = update(s, 5, j => ({ ...j, view: viewReduce(j.view, { type: 'SELECT_OCCURRENCE', occurrenceId: 'occ' }) }));
  s = update(s, 6, j => ({ ...j, multiIds: ['a', 'b'] }));
  s = update(s, 7, j => ({ ...j, view: viewReduce(j.view, { type: 'CLEAR_INSPECTION' }), multiIds: [] }));
  assert.equal(active(s).past.length, 1, 'selection never creates an undo entry');
  assert.equal(active(s).future.length, 1, 'selection never discards the redo branch');
  assert.deepEqual(active(s).present.view.history.map(e => e.subjectId), ['a', 'route'], 'the inspector Back trail still records each subject');
});
check('a selection gesture that also reveals the tree, clears search and switches the mobile pane stays outside history', () => {
  let s = edit(initJourneys(), 1, 'find me');
  s = update(s, 2, j => ({ ...j, treeOpen: { ...j.treeOpen, p: true }, search: '', mobilePane: 'details', view: viewReduce(j.view, { type: 'INSPECT_NODE', id: 'a' }) }));
  assert.equal(active(s).past.length, 1, 'the click itself adds nothing');
  s = update(s, 3, j => ({ ...j, treeOpen: { ...j.treeOpen, q: true } }));
  assert.equal(active(s).past.length, 2, 'a tree toggle on its own is still an exploration edit');
  s = update(s, 4, j => ({ ...j, mobilePane: 'map' }));
  assert.equal(active(s).past.length, 3, 'a pane switch on its own is still recorded');
});
check('undo after an inspection reverts the prior real edit and keeps selection and Back trail', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  const origin = active(s).present.view.levelViews.PACKAGE.positions.p1;
  s = moveCard(s, 1, 'p1', { x: 900, y: 900 });
  s = inspect(s, 2, 'p1'); s = inspect(s, 3, 'p2');
  s = update(s, 4, j => ({ ...j, multiIds: ['p1', 'p2'] }));
  const current = selection(active(s).present);
  assert.equal(active(s).past.length, 1);
  s = undo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.positions.p1, origin, 'the drag is what gets undone');
  assert.deepEqual(selection(active(s).present), current, 'inspection, level, occurrence, Back trail and multi-selection stay current');
  s = inspect(s, 5, 'p1');
  s = redo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.positions.p1, { x: 900, y: 900 });
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1', 'redo also keeps the selection made after the undo');
});
check('undo that removes the inspected card clears inspection, its route and multi-selected cards', () => {
  let s = initJourneys(mapJourney(['p1']));
  s = showOnly(s, 1, ['p1', 'p2', 'p3']);
  s = update(s, 2, j => ({ ...j, multiIds: ['p1', 'p2'], view: viewReduce(j.view, { type: 'INSPECT_NODE', id: 'p2' }) }));
  s = undo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.displayedIds, ['p1']);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'the inspected card left the map');
  assert.equal(active(s).present.view.inspectedLevel, null, 'the inspectedLevel invariant holds');
  assert.deepEqual(active(s).present.multiIds, ['p1'], 'only the removed card leaves the multi-selection');
  assert.deepEqual(active(s).present.view.history, [], 'pruning is not a navigation and pushes no Back entry');
  s = redo(s);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'redo does not resurrect a pruned selection');

  let e = initJourneys(mapJourney(['p1']));
  e = showOnly(e, 1, ['p1', 'p2', 'p3']);
  e = update(e, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p2","p3"]' }) }));
  e = undo(e);
  assert.equal(active(e).present.view.inspectedSubjectId, null, 'an inspected route whose endpoints left the map is dropped');

  let kept = initJourneys(mapJourney(['p1']));
  kept = showOnly(kept, 1, ['p1', 'p2', 'p3']);
  kept = update(kept, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  kept = moveCard(kept, 3, 'p1', { x: 5, y: 5 });
  kept = undo(kept);
  assert.equal(active(kept).present.view.inspectedSubjectId, 'aggregate:["p1","p2"]', 'a route still drawn after undo stays inspected');
});
check('a selection that was not on the map before undo is never pruned by it', () => {
  let s = initJourneys(mapJourney(['p1']));
  s = moveCard(s, 1, 'p1', { x: 5, y: 5 });
  // Tree/search selection of a class inside a collapsed package: in scope, not displayed.
  s = inspect(s, 2, 'c3');
  s = undo(s);
  assert.equal(active(s).present.view.inspectedSubjectId, 'c3');
});
check('undo pruning uses the graph-aware displayed set, children of expanded cards included', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, view: viewReduce(j.view, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p2', ownerId: null, childPositions: { c2: { x: 1, y: 1 } }, generation: j.view.generation }) }));
  s = moveCard(s, 2, 'p1', { x: 50, y: 50 });
  s = inspect(s, 3, 'c2');
  s = undo(s);
  assert.equal(active(s).present.view.inspectedSubjectId, 'c2', 'a child card that is still drawn survives');
  s = undo(s);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'collapsing its container by undo removes it');
});
check('undo across a Changes toggle drops review-only route identities from the carried selection', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  s = inspect(s, 2, 'p1');
  s = update(s, 3, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2","ADDED"]' }) }));
  s = undo(s);
  assert.equal(active(s).present.review, false);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'a review route cannot stay inspected on the ordinary map');
  assert.ok(active(s).present.view.history.every(entry => entry.kind !== 'EDGE'), 'review route Back entries are dropped too');
  assert.ok(active(s).present.view.history.some(entry => entry.subjectId === 'p1'), 'node Back entries that exist in the target graph remain');
});
check('inspector Back keeps its own trail and, when the map is unchanged, adds no undo entry', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = inspect(s, 1, 'p1'); s = inspect(s, 2, 'p2'); s = inspect(s, 3, 'p1');
  s = update(s, 3, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_BACK', eligibleIds: ['p1', 'p2'] }) }));
  assert.equal(active(s).present.view.inspectedSubjectId, 'p2', 'Back restores the previous subject');
  assert.equal(active(s).past.length, 0, 'a Back that leaves the map as it is is only a selection change');
  s = update(s, 4, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_BACK', eligibleIds: ['p1'] }) }));
  assert.equal(active(s).past.length, 1, 'a Back that also drops a no-longer-eligible card is recorded');
});
check('mixed edits still record the edit; the selection change rides along', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = inspect(s, 1, 'p2');
  s = update(s, 2, j => ({ ...j, multiIds: [], view: viewReduce(viewReduce(j.view, { type: 'SCOPE_UPDATED', eligibleIds: ['p1'], batchSize: Infinity }), { type: 'CLEAR_INSPECTION' }) }));
  assert.equal(active(s).past.length, 1, 'removing the selected card from scope is one undo entry');
  s = undo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.displayedIds, ['p1', 'p2'], 'undo restores the card');
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'and leaves the (cleared) selection as it is now');
});
check('new tabs start clean and switching preserves each history', () => {
  let s = edit(inspect(initJourneys(), 1, 'a'), 2, 'first'); const first = active(s);
  s = reduce(s, { type: 'NEW' }); assert.equal(active(s).present.view.inspectedSubjectId, null);
  assert.equal(active(s).past.length, 0);
  s = edit(s, 3, 'second'); const second = active(s);
  s = reduce(s, { type: 'SWITCH', id: first.id }); assert.strictEqual(active(s), first);
  s = reduce(s, { type: 'UNDO' }); assert.equal(active(s).present.search, '');
  assert.equal(active(s).present.view.inspectedSubjectId, 'a');
  assert.strictEqual(s.tabs.find(t => t.id === second.id), second);
});
check('clones branch from the complete past/present/future and copy the current selection', () => {
  let s = edit(edit(initJourneys(), 1, 'a'), 2, 'b');
  s = reduce(s, { type: 'UNDO' });
  s = update(s, 3, j => ({ ...j, multiIds: ['m'], view: viewReduce(j.view, { type: 'INSPECT_NODE', id: 'x' }) }));
  const original = active(s);
  s = reduce(s, { type: 'CLONE' }); assert.deepEqual(active(s).future, original.future);
  assert.deepEqual(selection(active(s).present), selection(original.present), 'clone copies the current selection');
  s = reduce(s, { type: 'REDO' }); assert.equal(active(s).present.search, 'b');
  assert.equal(active(s).present.view.inspectedSubjectId, 'x');
  s = update(s, 4, j => ({ ...j, scope: { ...j.scope, selectedClassIds: new Set(['c']) } }));
  assert.strictEqual(s.tabs[0], original);
  assert.equal(original.present.scope.selectedClassIds.size, 0);
});
check('new edits after undo discard only that tab’s redo branch; no-op and selection updates preserve redo', () => {
  let s = edit(initJourneys(), 1, 'a'); s = reduce(s, { type: 'UNDO' });
  s = update(s, 2, j => j); assert.equal(active(s).future.length, 1);
  s = inspect(s, 3, 'b'); assert.equal(active(s).future.length, 1);
  s = edit(s, 4, 'c'); assert.equal(active(s).future.length, 0);
});
check('close/reopen restores history and the final tab cannot close', () => {
  let s = inspect(initJourneys(), 1, 'a'); s = reduce(s, { type: 'NEW' });
  const first = s.tabs[0]; s = reduce(s, { type: 'CLOSE', id: first.id });
  assert.equal(s.tabs.length, 1); s = reduce(s, { type: 'CLOSE', id: s.activeId });
  assert.equal(s.tabs.length, 1); s = reduce(s, { type: 'REOPEN' });
  assert.strictEqual(active(s), first);
});
check('geometry, camera and source restore exactly', () => {
  let s = initJourneys(); const before = active(s).present;
  s = update(s, 1, j => ({ ...j,
    source: { node: { id: 'c' }, type: 'symbol' }, navWidth: 320,
    view: viewReduce(j.view, { type: 'SET_CAMERA', level: 'PACKAGE', generation: j.view.generation, camera: { zoom: 0.7, pan: { x: 10, y: 20 } } }),
  }));
  const after = active(s).present;
  s = reduce(s, { type: 'UNDO' }); assert.strictEqual(active(s).present, before);
  s = reduce(s, { type: 'REDO' }); assert.strictEqual(active(s).present, after);
});
check('fullscreen, map overview and button zoom stay outside undo/redo history', () => {
  let s = edit(initJourneys(), 1, 'a');
  s = edit(s, 2, 'b');
  s = reduce(s, { type: 'UNDO' });
  assert.equal(active(s).present.search, 'a');
  assert.equal(active(s).future.length, 1, 'the transient update starts with an existing redo branch');
  const transient = (state, fn) => reduce(state, { type: 'TRANSIENT_UPDATE', id: state.activeId, update: fn });
  s = transient(s, j => ({ ...j, fullscreen: true, mapOpen: false, view: viewReduce(j.view, {
    type: 'SET_CAMERA', level: 'PACKAGE', generation: j.view.generation, camera: { zoom: 1.728, pan: { x: -20, y: 15 } },
  }) }));
  assert.equal(active(s).past.length, 1, 'view-only controls do not add history entries');
  assert.equal(active(s).future.length, 1, 'view-only controls do not discard the redo branch');
  s = reduce(s, { type: 'UNDO' });
  assert.equal(active(s).present.search, '', 'undo still reaches the last semantic action');
  assert.equal(active(s).present.fullscreen, true);
  assert.equal(active(s).present.mapOpen, false);
  assert.equal(active(s).present.view.levelViews.PACKAGE.camera.zoom, 1.728);
  s = reduce(s, { type: 'REDO' });
  assert.equal(active(s).present.search, 'a');
  assert.equal(active(s).present.fullscreen, true);
  assert.equal(active(s).present.mapOpen, false);
  assert.equal(active(s).present.view.levelViews.PACKAGE.camera.zoom, 1.728);
  s = reduce(s, { type: 'REDO' });
  assert.equal(active(s).present.search, 'b', 'the pre-existing redo branch remains usable');
  assert.equal(active(s).present.fullscreen, true);
  assert.equal(active(s).present.mapOpen, false);
  assert.equal(active(s).present.view.levelViews.PACKAGE.camera.zoom, 1.728);
});
check('initial fit is baseline state, never an undo action or a redo invalidation', () => {
  let s = edit(initJourneys(), 1, 'a'); s = reduce(s, { type: 'UNDO' });
  const camera = { zoom: 0.5, pan: { x: 4, y: 8 } };
  s = reduce(s, { type: 'INITIAL_CAMERA', id: s.activeId, action: { type: 'SET_CAMERA', level: 'PACKAGE', generation: active(s).present.view.generation, camera } });
  assert.equal(active(s).past.length, 0); assert.equal(active(s).future.length, 1);
  s = reduce(s, { type: 'REDO' }); assert.deepEqual(active(s).present.view.levelViews.PACKAGE.camera, camera);
});
check('delayed callbacks stay with their originating tab', () => {
  let s = initJourneys(); const id = s.activeId;
  s = reduce(s, { type: 'NEW' }); s = update(s, 1, j => ({ ...j, search: 'old callback' }), id);
  assert.equal(active(s).present.search, ''); assert.equal(s.tabs[0].present.search, 'old callback');
});
check('snapshot replacement clears closed tabs and history, rejects old callbacks', () => {
  let s = edit(initJourneys(), 1, 'a'); const id = s.activeId;
  s = reduce(s, { type: 'NEW' }); s = reduce(s, { type: 'CLOSE', id });
  s = reduce(s, { type: 'RESET', view: initJourneys().initial.view });
  s = update(s, 2, j => ({ ...j, search: 'stale' }), id);
  assert.equal(s.tabs.length, 1); assert.equal(s.closed.length, 0);
  assert.equal(active(s).past.length, 0); assert.equal(active(s).present.search, '');
  assert.ok(s.activeId > id);
});
// Mirrors App.tsx's double-click path: click 1 inspects (a plain tap), then `dbltap` dispatches one
// ARRANGE_AROUND_RESOURCE in a fresh group (a real macrotask separates the two physical clicks).
const arrange = s => update(s, 99, j => ({ ...j, view: viewReduce(j.view, {
  type: 'ARRANGE_AROUND_RESOURCE', level: 'PACKAGE', positions: { p1: { x: 10, y: 20 } }, generation: j.view.generation,
}) }));
check('double-click arrangement is one undo entry for the arrangement only; undo keeps the selection', () => {
  let s = initJourneys(mapJourney(['p1', 'p2'])); const before = active(s).present;
  s = inspect(s, 1, 'p1');
  assert.equal(active(s).past.length, 0, 'click 1 no longer seals an undo step');
  s = arrange(s);
  assert.equal(active(s).past.length, 1, 'the arrangement is exactly one entry');
  s = undo(s);
  assert.strictEqual(active(s).present.view.levelViews, before.view.levelViews, 'one undo reverts the arrangement');
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1', 'and leaves the double-clicked card inspected');
  assert.equal(active(s).past.length, 0);
});
check('an unrelated later group still gets its own separate undo step', () => {
  let s = edit(initJourneys(), 1, 'x');
  s = edit(s, 2, 'later');
  assert.equal(active(s).past.length, 2);
});
check('Changes toggle keeps one map layout, including expansions, scope, selection and camera', () => {
  let s = initJourneys();
  let mapView = viewReduce(active(s).present.view, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['pkg'], batchSize: Infinity, placement: { pkg: { width: 220, height: 100, name: 'pkg' } } });
  mapView = viewReduce(mapView, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'pkg', ownerId: null, childPositions: { cls: { x: 180, y: 220 } }, generation: mapView.generation });
  mapView = viewReduce(mapView, { type: 'SET_CAMERA', level: 'PACKAGE', camera: { zoom: 0.62, pan: { x: 18, y: -24 } }, generation: mapView.generation });
  const scope = { mode: 'CUSTOM', selectedPackageIds: new Set(['pkg']), selectedClassIds: new Set(['cls']) };
  s = update(s, 1, j => ({ ...j, view: mapView, scope, treeOpen: { pkg: true }, multiIds: ['pkg'], search: 'pkg' }));
  const before = active(s).present;
  const freshWrongView = viewReduce(initExplorerViewState(), { type: 'INSPECT_NODE', id: 'wrong-reset' });
  s = update(s, 2, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  assert.equal(active(s).present.review, true);
  assert.equal(active(s).present.reviewKey, 'rk1');
  assert.equal(active(s).present.reviewTouched, true);
  assert.strictEqual(active(s).present.view, before.view, 'first activation must retain the existing view object');
  assert.strictEqual(active(s).present.scope, before.scope);
  assert.deepEqual(active(s).present.treeOpen, before.treeOpen);
  assert.deepEqual(active(s).present.multiIds, before.multiIds);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.expansions, before.view.levelViews.PACKAGE.expansions);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.camera, before.view.levelViews.PACKAGE.camera);
  assert.notStrictEqual(active(s).present.view, freshWrongView, 'the supplied fresh view is deliberately ignored');
  // An edit made while Changes is active mutates the same map state. Turning Changes off keeps that
  // edit, rather than restoring a parked ordinary layout from before the toggle.
  const editedView = viewReduce(active(s).present.view, { type: 'NODE_MOVED', level: 'PACKAGE', id: 'pkg', position: { x: 310, y: 275 }, generation: active(s).present.view.generation });
  s = update(s, 3, j => ({ ...j, view: editedView, scope: { ...j.scope, selectedClassIds: new Set(['cls', 'new-cls']) } }));
  const edited = active(s).present;
  s = update(s, 4, j => ({ ...j, ...toggleJourneyReview(j, false, null) }));
  assert.equal(active(s).present.review, false);
  assert.equal(active(s).present.reviewKey, null);
  assert.strictEqual(active(s).present.view, edited.view, 'toggle off must keep the current shared map');
  assert.strictEqual(active(s).present.scope, edited.scope);
  assert.equal(active(s).present.reviewTouched, true);
  // Toggling back on is still mode-only and does not restore the pre-edit geometry.
  s = update(s, 5, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  assert.strictEqual(active(s).present.view, edited.view);
  assert.equal(active(s).present.view.levelViews.PACKAGE.positions.pkg.x, 310);
});

check('NEW opens a fresh tab in the requesting tab\'s current mode', () => {
  let s = initJourneys();
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  const fresh = newJourney(initExplorerViewState());
  const present = { ...fresh, review: true, reviewKey: 'rk1', reviewTouched: true };
  s = reduce(s, { type: 'NEW', present });
  assert.equal(active(s).present.review, true, 'a new tab opened from a review tab should itself start in review mode');
  assert.equal(active(s).present.reviewKey, 'rk1');
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'a new tab still starts with a clean view, not a copy of the source tab\'s inspection');
  assert.equal(active(s).past.length, 0);
});

check('CLONE copies review mode, the shared map and its full history', () => {
  let s = initJourneys();
  s = edit(s, 1, 'a');
  s = update(s, 2, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  const original = active(s);
  s = reduce(s, { type: 'CLONE' });
  const clone = active(s);
  assert.notEqual(clone.id, original.id);
  assert.equal(clone.present.review, true);
  assert.equal(clone.present.reviewKey, 'rk1');
  assert.equal(clone.present.reviewTouched, true);
  assert.deepEqual(clone.past, original.past);
  // Editing the clone must not affect the original (structural sharing is safe, not aliasing).
  s = update(s, 3, j => ({ ...j, ...toggleJourneyReview(j, false, null) }));
  assert.equal(active(s).present.review, false);
  assert.equal(original.present.review, true, 'the original tab must be unaffected by editing its clone');
});

check('REVIEW_RECAPTURED clears review history even after returning to map mode', () => {
  let s = initJourneys();
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  s = update(s, 2, j => ({ ...j, ...toggleJourneyReview(j, false, null) }));
  for(let i = 0; i < HISTORY_LIMIT + 20; i++) s = update(s, 3 + i, j => ({ ...j, search: `edit-${i}` }));
  assert.equal(active(s).present.review, false);
  assert.equal(active(s).present.reviewTouched, true, 'touch bookkeeping must outlive bounded undo history');
  const viewBefore = active(s).present.view;
  s = reduce(s, { type: 'REVIEW_RECAPTURED', reviewKey: 'rk2', reviewIds: [] });
  assert.equal(active(s).past.length, 0);
  assert.equal(active(s).future.length, 0);
  assert.strictEqual(active(s).present.view, viewBefore, 'recapture keeps the shared map geometry');
});

check('REVIEW_RECAPTURED reconciles recently closed review tabs atomically', () => {
  let s = initJourneys();
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1'), search: 'open-review', view: viewReduce(j.view, { type: 'REVIEW_IDS_AVAILABLE', level: 'PACKAGE', ids: ['review-node:old'], placement: { 'review-node:old': { width: 220, height: 100, name: 'old' } } }) }));
  const closedId = active(s).id;
  s = reduce(s, { type: 'NEW' });
  s = reduce(s, { type: 'CLOSE', id: closedId });
  assert.equal(s.closed.length, 1);
  s = reduce(s, { type: 'REVIEW_RECAPTURED', reviewKey: 'rk2', reviewIds: ['review-node:new'], reconcile: j => ({ ...j, search: `${j.search}:recaptured`, view: viewReduce(j.view, { type: 'REVIEW_IDS_AVAILABLE', level: 'PACKAGE', ids: ['review-node:new'], placement: { 'review-node:new': { width: 220, height: 100, name: 'new' } } }) }) });
  assert.equal(s.closed[0].present.search, 'open-review:recaptured', 'the closed tab receives the same recapture reconciliation');
  assert.deepEqual(s.closed[0].present.view.levelViews.PACKAGE.displayedIds, ['review-node:new'], 'the closed tab drops the old review card and admits the recaptured one');
  assert.equal(active(s).present.search, '', 'an untouched open tab remains unchanged');
});

check('ordinary recapture preserves open and closed edge inspection/source state, while Changes closes ordinary symbol source', () => {
  const ordinaryGraph = { nodes: [
    { id: 'a', simpleName: 'A', qualifiedName: 'A', kind: 'CLASS' },
    { id: 'b', simpleName: 'B', qualifiedName: 'B', kind: 'CLASS' },
  ], edges: [] };
  let edgeView = initExplorerViewState('PACKAGE');
  edgeView = viewReduce(edgeView, { type: 'INSPECT_NODE', id: 'a' });
  edgeView = viewReduce(edgeView, { type: 'INSPECT_EDGE', id: 'ordinary-edge-old' });
  edgeView = viewReduce(edgeView, { type: 'INSPECT_NODE', id: 'b' });
  edgeView = viewReduce(edgeView, { type: 'INSPECT_EDGE', id: 'ordinary-edge-current' });
  edgeView = viewReduce(edgeView, { type: 'SELECT_OCCURRENCE', occurrenceId: 'ordinary-occurrence-current' });
  const source = { node: { id: 'ordinary-edge-current', ids: ['ordinary-edge-current'], simpleName: 'A → B' }, type: 'relationships' };
  const ordinaryJourney = { ...newJourney(edgeView), reviewTouched: true, source };
  const historyBefore = edgeView.history.map(entry => `${entry.kind}:${entry.subjectId}`);
  const preserved = revalidateJourneyState(ordinaryJourney, ordinaryGraph, false);
  assert.equal(preserved.view.inspectedKind, 'EDGE');
  assert.equal(preserved.view.inspectedSubjectId, 'ordinary-edge-current');
  assert.equal(preserved.view.inspectedOccurrenceId, 'ordinary-occurrence-current');
  assert.deepEqual(preserved.view.history.map(entry => `${entry.kind}:${entry.subjectId}`), historyBefore);
  assert.strictEqual(preserved.source, source);

  let state = initJourneys(ordinaryJourney);
  state = reduce(state, { type: 'CLONE' });
  const closedId = state.tabs[0].id;
  state = reduce(state, { type: 'CLOSE', id: closedId });
  state = reduce(state, {
    type: 'REVIEW_RECAPTURED', reviewKey: 'recaptured', reviewIds: [],
    reconcile: journey => revalidateJourneyState(journey, ordinaryGraph, false),
  });
  for (const tab of [active(state), state.closed[0]]) {
    assert.equal(tab.present.view.inspectedKind, 'EDGE');
    assert.equal(tab.present.view.inspectedSubjectId, 'ordinary-edge-current');
    assert.equal(tab.present.view.inspectedOccurrenceId, 'ordinary-occurrence-current');
    assert.strictEqual(tab.present.source, source);
    assert.ok(tab.present.view.history.some(entry => entry.subjectId === 'ordinary-edge-old' && entry.kind === 'EDGE'));
  }

  const enteringChanges = revalidateJourneyState(ordinaryJourney, ordinaryGraph, true);
  assert.equal(enteringChanges.view.inspectedSubjectId, null, 'entering Changes clears an ordinary edge inspection');
  assert.equal(enteringChanges.view.inspectedKind, null);
  assert.equal(enteringChanges.view.inspectedOccurrenceId, null);
  assert.ok(enteringChanges.view.history.every(entry => entry.kind !== 'EDGE'), 'entering Changes removes ordinary edge Back entries');
  assert.equal(enteringChanges.source, null, 'entering Changes closes an ordinary relationship source');

  const reviewJourney = { ...ordinaryJourney, review: true, reviewKey: 'old-review', source: { node: { id: 'a' }, type: 'symbol', snapshotId: 'head', label: 'after-change snapshot' } };
  const leavingChanges = revalidateJourneyState(reviewJourney, ordinaryGraph, false);
  assert.equal(leavingChanges.view.inspectedSubjectId, null, 'leaving Changes clears a review edge inspection');
  assert.equal(leavingChanges.view.inspectedKind, null);
  assert.equal(leavingChanges.view.inspectedOccurrenceId, null);
  assert.ok(leavingChanges.view.history.every(entry => entry.kind !== 'EDGE'), 'leaving Changes removes review edge Back entries');
  assert.equal(leavingChanges.source, null, 'leaving Changes closes a pinned review source');

  const recapturedReview = revalidateJourneyState(reviewJourney, ordinaryGraph, true);
  assert.equal(recapturedReview.view.inspectedSubjectId, null, 'review recapture clears the stale edge inspection');
  assert.equal(recapturedReview.view.inspectedKind, null);
  assert.equal(recapturedReview.view.inspectedOccurrenceId, null);
  assert.ok(recapturedReview.view.history.every(entry => entry.kind !== 'EDGE'), 'review recapture removes stale edge Back entries');
  assert.equal(recapturedReview.source, null, 'review recapture closes a pinned review source');

  const ordinarySymbol = { ...newJourney(viewReduce(initExplorerViewState('PACKAGE'), { type: 'INSPECT_NODE', id: 'a' })), reviewTouched: true, source: { node: { id: 'a' }, type: 'symbol' } };
  const recapturedOrdinarySymbol = revalidateJourneyState(ordinarySymbol, ordinaryGraph, false);
  assert.strictEqual(recapturedOrdinarySymbol.source, ordinarySymbol.source, 'ordinary recapture keeps an ordinary symbol source');
  assert.equal(recapturedOrdinarySymbol.view.inspectedSubjectId, 'a', 'ordinary recapture keeps a valid node inspection');

  const reviewSymbol = revalidateJourneyState(ordinarySymbol, ordinaryGraph, true);
  assert.equal(reviewSymbol.source, null, 'entering Changes must close a plain ordinary symbol source');
  assert.equal(reviewSymbol.view.inspectedSubjectId, 'a', 'a matched ordinary node inspection remains valid');
});

check('history and recently closed retention are bounded', () => {
  let s = initJourneys();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = edit(s, i, `c${i}`);
  assert.equal(active(s).past.length, HISTORY_LIMIT);
  for (let i = 0; i < 12; i++) { s = reduce(s, { type: 'NEW' }); s = reduce(s, { type: 'CLOSE', id: s.activeId }); }
  assert.equal(s.closed.length, 10);
});
// Review remediation (step 12 phase A). Back navigation, Back-trail pruning, the graph-less route
// fallback, companion revert and the pruning short-circuits.
check('a Back that only refreshes eligibility bookkeeping (priorEligibleIds) adds no undo entry', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = inspect(s, 1, 'p1'); s = inspect(s, 2, 'p2');
  s = update(s, 3, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_BACK', eligibleIds: ['p1', 'p2', 'p3'] }) }));
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1');
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.displayedIds, ['p1', 'p2'], 'Back admits nothing (batch 0)');
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.priorEligibleIds, ['p1', 'p2', 'p3'], 'admission bookkeeping still advances');
  assert.equal(active(s).past.length, 0, 'no dead undo entry');
});
check('an unchanged Back returns the identical level views', () => {
  let v = viewReduce(viewReduce(mapJourney(['p1', 'p2']).view, { type: 'INSPECT_NODE', id: 'p1' }), { type: 'INSPECT_NODE', id: 'p2' });
  const back = viewReduce(v, { type: 'NAVIGATE_BACK', eligibleIds: ['p1', 'p2'] });
  assert.strictEqual(back.levelViews, v.levelViews);
  assert.equal(back.membershipRevision, v.membershipRevision);
});
check('an initial camera capture after an unchanged Back still reaches the history entry it shares', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = edit(s, 1, 'x');
  s = inspect(s, 2, 'p1'); s = inspect(s, 3, 'p2');
  s = update(s, 4, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_BACK', eligibleIds: ['p1', 'p2'] }) }));
  const camera = { zoom: 0.4, pan: { x: 7, y: 9 } };
  s = reduce(s, { type: 'INITIAL_CAMERA', id: s.activeId, action: { type: 'SET_CAMERA', level: 'PACKAGE', generation: active(s).present.view.generation, camera } });
  s = undo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.camera, camera, 'the undone-to entry shares the captured baseline camera');
});
check('undo drops Back-trail cards and routes it removes from the map', () => {
  let s = initJourneys(mapJourney(['p1']));
  s = showOnly(s, 1, ['p1', 'p2']);
  s = inspect(s, 2, 'p2'); s = inspect(s, 3, 'p1');
  assert.deepEqual(active(s).present.view.history.map(e => e.subjectId), ['p2']);
  s = undo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.displayedIds, ['p1']);
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1');
  assert.deepEqual(active(s).present.view.history, [], 'Back can no longer return to the removed card');
  s = update(s, 4, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_BACK', eligibleIds: ['p1'] }) }));
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1');

  let e = initJourneys(mapJourney(['p1']));
  e = showOnly(e, 1, ['p1', 'p2']);
  e = update(e, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  e = inspect(e, 3, 'c3'); e = inspect(e, 4, 'p1');
  e = undo(e);
  assert.deepEqual(active(e).present.view.history.map(h => h.subjectId), ['c3'], 'the removed route leaves the trail; a never-drawn subject stays');
});
check('without a graph an aggregate route counts as gone when an endpoint left the map; raw IDs are kept', () => {
  const bare = s => reduce(s, { type: 'UNDO' });
  let s = initJourneys(mapJourney(['p1']));
  s = showOnly(s, 1, ['p1', 'p2']);
  s = update(s, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  s = bare(s);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'endpoint p2 was drawn and no longer is');

  let t = initJourneys(mapJourney(['p1']));
  t = showOnly(t, 1, ['p1', 'p2']);
  t = update(t, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  t = inspect(t, 3, 'p1');
  t = bare(t);
  assert.deepEqual(active(t).present.view.history, [], 'a graph-less route Back entry follows the same rule');

  let r = initJourneys(mapJourney(['p1']));
  r = showOnly(r, 1, ['p1', 'p2']);
  r = update(r, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'unresolved-rel-7' }) }));
  r = bare(r);
  assert.equal(active(r).present.view.inspectedSubjectId, 'unresolved-rel-7', 'a raw relationship ID is never pruned by this path');

  let k = initJourneys(mapJourney(['p1', 'p2']));
  k = update(k, 1, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  k = moveCard(k, 2, 'p1', { x: 3, y: 3 });
  k = bare(k);
  assert.equal(active(k).present.view.inspectedSubjectId, 'aggregate:["p1","p2"]', 'both endpoints still drawn: kept');
});
check('undo across a Changes toggle drops a review route even without a graph', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  s = update(s, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2","ADDED"]' }) }));
  s = reduce(s, { type: 'UNDO' });
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'its endpoints are still drawn, but the identity changed with the mode');
});
check('redo into Changes drops an ordinary route identity inspected after the undo', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  s = undo(s);
  s = update(s, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  s = redo(s);
  assert.equal(active(s).present.review, true);
  assert.equal(active(s).present.view.inspectedSubjectId, null, 'the ordinary route ID means nothing on the Changes map');
});
check('undo reverts an earlier edit and restores companions from history while the selection stays', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  const origin = active(s).present;
  s = moveCard(s, 1, 'p1', { x: 400, y: 400 });
  s = update(s, 2, j => ({ ...j, treeOpen: { ...j.treeOpen, pkg: true }, search: '', mobilePane: 'details', view: viewReduce(j.view, { type: 'INSPECT_NODE', id: 'p2' }) }));
  assert.equal(active(s).past.length, 1);
  s = undo(s);
  const now = active(s).present;
  assert.deepEqual(now.view.levelViews.PACKAGE.positions.p1, origin.view.levelViews.PACKAGE.positions.p1, 'the move is reverted');
  assert.strictEqual(now.treeOpen, origin.treeOpen); assert.equal(now.search, origin.search); assert.equal(now.mobilePane, origin.mobilePane);
  assert.equal(now.view.inspectedSubjectId, 'p2', 'B stays inspected');
});
check('undo pruning skips the graph when nothing is selected or the displayed inputs are unchanged', () => {
  let calls = 0; const counting = j => { calls++; return fixtureGraph; };
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = moveCard(s, 1, 'p1', { x: 1, y: 1 });
  s = reduce(s, { type: 'UNDO', graphFor: counting });
  assert.equal(calls, 0, 'no selection, nothing to prune');
  s = reduce(s, { type: 'REDO', graphFor: counting });
  s = inspect(s, 2, 'p1');
  s = reduce(s, { type: 'UNDO', graphFor: counting });
  assert.equal(calls, 0, 'a move leaves membership, expansions and scope identical');
  assert.equal(active(s).present.view.inspectedSubjectId, 'p1');
  let reads = 0;
  const watched = { nodes: fixtureGraph.nodes, get edges() { reads++; return fixtureGraph.edges; } };
  const nodeRun = st => { reads = 0; reduce(st, { type: 'UNDO', graphFor: () => watched }); return reads; };
  let n = initJourneys(mapJourney(['p1'])); n = showOnly(n, 1, ['p1', 'p2']); n = inspect(n, 2, 'p1');
  let d = initJourneys(mapJourney(['p1'])); d = showOnly(d, 1, ['p1', 'p2']);
  d = update(d, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_EDGE', id: 'aggregate:["p1","p2"]' }) }));
  assert.ok(nodeRun(n) < nodeRun(d), 'route sets are only built when a route is selected or trailed');
});
// Outgoing relation stack (docs/OUTGOING_STACK.md): the root is a pinned pointer like selection.
// It never occupies history and ends when the map stops drawing it, whichever path removed it.
const stackOn = (s, group, id) => update(s, group, j => ({ ...j, outgoingStackRootId: id }));
const updateDrawn = (s, group, fn) => reduce(s, { type: 'UPDATE', id: s.activeId, group, update: fn, graphFor });
const root = s => active(s).present.outgoingStackRootId;
check('a new journey has no outgoing stack; turning one on and off creates no undo entry and keeps redo', () => {
  assert.equal(newJourney().outgoingStackRootId, null);
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = moveCard(s, 1, 'p1', { x: 9, y: 9 }); s = moveCard(s, 2, 'p1', { x: 19, y: 19 }); s = undo(s);
  s = stackOn(s, 3, 'p1');
  assert.equal(root(s), 'p1');
  s = stackOn(s, 4, null);
  assert.equal(root(s), null);
  assert.equal(active(s).past.length, 1, 'the stack toggle never creates an undo entry');
  assert.equal(active(s).future.length, 1, 'the stack toggle never discards redo');
});
check('undo and redo keep the stack while its root stays drawn; selection moves independently', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = moveCard(s, 1, 'p2', { x: 400, y: 0 });
  s = stackOn(s, 2, 'p1'); s = inspect(s, 3, 'p2');
  s = undo(s);
  assert.equal(root(s), 'p1', 'undo of an unrelated edit keeps the stack');
  s = redo(s);
  assert.equal(root(s), 'p1', 'redo keeps the stack');
  assert.equal(active(s).present.view.inspectedSubjectId, 'p2', 'the selection is independent of the pinned root');
});
check('undo that removes the root ends the stack, and redo does not bring it back', () => {
  let s = initJourneys(mapJourney(['p1']));
  s = showOnly(s, 1, ['p1', 'p3']);
  s = stackOn(s, 2, 'p3');
  s = undo(s);
  assert.equal(root(s), null, 'the root left the map with the undone scope edit');
  s = redo(s);
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.displayedIds, ['p1', 'p3']);
  assert.equal(root(s), null, 'the stack never silently comes back');
});
check('a scope removal that drops the root ends the stack; the removal itself stays one undo entry', () => {
  let s = initJourneys(mapJourney(['p1', 'p2', 'p3']));
  s = stackOn(s, 1, 'p2');
  s = updateDrawn(s, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'SCOPE_UPDATED', eligibleIds: ['p1', 'p3'], batchSize: Infinity, placement: placed(['p1', 'p3']) }) }));
  assert.equal(root(s), null);
  assert.equal(active(s).past.length, 1, 'the scope edit is recorded, the stack end is not a step of its own');
  s = undo(s);
  assert.ok(active(s).present.view.levelViews.PACKAGE.displayedIds.includes('p2'));
  assert.equal(root(s), null, 'undoing the removal does not restore the stack');
});
check('collapsing the container of a root child card ends the stack', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, view: viewReduce(j.view, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p2', ownerId: null, childPositions: { c2: { x: 1, y: 1 } }, generation: j.view.generation }) }));
  s = stackOn(s, 2, 'c2');
  s = updateDrawn(s, 3, j => ({ ...j, view: viewReduce(j.view, { type: 'NODE_MOVED', level: 'PACKAGE', id: 'p1', position: { x: 700, y: 0 }, generation: j.view.generation }) }));
  assert.equal(root(s), 'c2', 'an edit that leaves the display inputs alone keeps the stack');
  s = updateDrawn(s, 4, j => ({ ...j, view: viewReduce(j.view, { type: 'COLLAPSE_RESOURCE', level: 'PACKAGE', id: 'p2', position: { x: 0, y: 0 }, generation: j.view.generation }) }));
  assert.equal(root(s), null);
});
check('a level switch ends the stack rather than re-rooting it', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = stackOn(s, 1, 'p1');
  s = updateDrawn(s, 2, j => ({ ...j, view: viewReduce(j.view, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c1', 'c2'], batchSize: Infinity, placement: placed(['c1', 'c2']) }) }));
  assert.equal(root(s), null);
});
check('without a graph, an ordinary update prunes the root against the view\'s own displayed record', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = stackOn(s, 1, 'p2');
  s = showOnly(s, 2, ['p1']);
  assert.equal(root(s), null);
});
check('a mode switch and a review recapture end a stack whose root the target graph lacks', () => {
  const j = { ...mapJourney(['p1', 'p2']), outgoingStackRootId: 'p2' };
  const without = { nodes: fixtureGraph.nodes.filter(n => n.id !== 'p2'), edges: [] };
  assert.equal(revalidateJourneyState(j, without, true).outgoingStackRootId, null);
  assert.equal(revalidateJourneyState(j, fixtureGraph, false).outgoingStackRootId, 'p2', 'a root the target still has is kept');
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') }));
  s = stackOn(s, 2, 'p2');
  s = reduce(s, { type: 'NEW' }); s = stackOn(s, 3, 'p1');
  s = reduce(s, { type: 'REVIEW_RECAPTURED', reviewKey: 'rk2', graphFor, reconcile: j => ({ ...j, view: viewReduce(j.view, { type: 'SCOPE_UPDATED', eligibleIds: ['p1'], batchSize: Infinity, placement: placed(['p1']) }) }) });
  assert.equal(s.tabs[0].present.outgoingStackRootId, null, 'the recaptured review tab no longer draws its root');
  assert.equal(root(s), 'p1', 'a tab that never touched review is left alone');
});
check('dragging an expanded child with a stack active never reprojects the map and keeps the root', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = update(s, 1, j => ({ ...j, view: viewReduce(j.view, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p2', ownerId: null, childPositions: { c2: { x: 1, y: 1 } }, generation: j.view.generation }) }));
  s = stackOn(s, 2, 'c2');
  let calls = 0;
  const spy = j => { calls++; return graphFor(j); };
  const before = active(s).present.view.levelViews.PACKAGE.expansions;
  s = reduce(s, { type: 'UPDATE', id: s.activeId, group: 3, graphFor: spy, update: j => ({ ...j, view: viewReduce(j.view, { type: 'NODE_MOVED', level: 'PACKAGE', id: 'c2', containerId: 'p2', position: { x: 40, y: 60 }, generation: j.view.generation }) }) });
  assert.notStrictEqual(active(s).present.view.levelViews.PACKAGE.expansions, before, 'the move did store the child position');
  assert.deepEqual(active(s).present.view.levelViews.PACKAGE.expansions.p2.childPositions.c2, { x: 40, y: 60 });
  assert.equal(calls, 0, 'a card move changes no membership, so the stack root is not revalidated');
  assert.equal(root(s), 'c2');
  s = reduce(s, { type: 'UPDATE', id: s.activeId, group: 4, graphFor: spy, update: j => ({ ...j, view: viewReduce(j.view, { type: 'COLLAPSE_RESOURCE', level: 'PACKAGE', id: 'p2', position: { x: 0, y: 0 }, generation: j.view.generation }) }) });
  assert.equal(calls, 1, 'an expansion change still revalidates');
  assert.equal(root(s), null);
});
// Package p expanded with a stored position for c1 only; c2 is drawn by layout (derived position).
const derivedGraph = { nodes: [
  { id: 'p', kind: 'PACKAGE', simpleName: 'p' }, { id: 'q', kind: 'PACKAGE', simpleName: 'q' },
  { id: 'c1', kind: 'CLASS', simpleName: 'C1', parentId: 'p' }, { id: 'c2', kind: 'CLASS', simpleName: 'C2', parentId: 'p' },
], edges: [] };
const derivedChildRoot = () => {
  let s = initJourneys(mapJourney(['p', 'q']));
  s = update(s, 1, j => ({ ...j, view: viewReduce(j.view, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p', ownerId: null, childPositions: { c1: { x: 1, y: 1 } }, generation: j.view.generation }) }));
  return stackOn(s, 2, 'c2');
};
const enterChanges = j => ({ ...j, ...toggleJourneyReview(j, true, 'rk1') });
check('entering Changes keeps a drawn child root that has no stored position when the review graph is known', () => {
  const lost = reduce(derivedChildRoot(), { type: 'UPDATE', id: 1, group: 3, update: enterChanges, graphFor: () => null });
  assert.equal(root(lost), null, 'without the graph the fallback misses the derived child: the defect the explicit graph avoids');
  const kept = reduce(derivedChildRoot(), { type: 'UPDATE', id: 1, group: 3, update: enterChanges, graphFor: j => j.review ? derivedGraph : null });
  assert.equal(root(kept), 'c2');
});
// useExplorerJourneys under a synchronous stand-in for React: one render whose reducer state starts
// from `seed`, and a dispatch that runs the real reducer at once.
const hook = await import('data:text/javascript;base64,' + Buffer.from(`${compiled}
let __state; export const current = () => __state; export const seed = { state: null };
const useReducer = (reducer, arg, init) => { __state = seed.state ?? init(arg); return [__state, a => { __state = reducer(__state, a); }]; };
const useRef = value => ({ current: value });
${ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/useExplorerJourneys.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import \{[^}]*\} from ['"][^'"]+['"];?\n?/g, '')}`).toString('base64'));
check('the async Changes load: updateTab prunes with the explicit graph, not the one read at the last render', () => {
  hook.seed.state = derivedChildRoot();
  // The render before the comparison loaded: its lookup has no review graph yet.
  const journeys = hook.useExplorerJourneys(undefined, () => null);
  journeys.updateTab(1, enterChanges, j => j.review ? derivedGraph : null);
  const tab = hook.current().tabs.find(t => t.id === 1);
  assert.equal(tab.present.review, true);
  assert.equal(tab.present.outgoingStackRootId, 'c2', 'the load result\'s graph decides the prune');
  hook.seed.state = null;
});
check('Clone copies the stack; the copies then change independently', () => {
  let s = initJourneys(mapJourney(['p1', 'p2']));
  s = stackOn(s, 1, 'p1');
  const source = s.activeId;
  s = reduce(s, { type: 'CLONE' });
  assert.equal(root(s), 'p1');
  s = stackOn(s, 2, 'p2');
  assert.equal(s.tabs.find(t => t.id === source).present.outgoingStackRootId, 'p1');
});
check('step 13: a sequential expand queue shares one explicit group, so its renders form one undo step', () => {
  let s = { ...initJourneys(mapJourney(['p1', 'p2', 'p3'])) };
  const start = active(s).past.length;
  // Two queue steps dispatched on separate renders with the same explicit group, then the
  // selection-only completion (inspect + stack root) with that group too.
  s = moveCard(s, 7, 'p1', { x: 10, y: 10 });
  s = moveCard(s, 7, 'p2', { x: 400, y: 10 });
  s = update(s, 7, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_NODE', id: 'p2' }), outgoingStackRootId: 'p2' }));
  assert.equal(active(s).past.length, start + 1, 'the whole queue is one undo step');
  s = undo(s);
  assert.equal(active(s).past.length, start);
  assert.equal(active(s).present.outgoingStackRootId, 'p2', 'undo leaves the selection-like stack root alone');
  // Another update between two queue renders starts its own step, and the queue's next render
  // (same explicit group, but no longer the tab's last group) starts yet another.
  s = moveCard(s, 8, 'p1', { x: 20, y: 20 });
  s = moveCard(s, 9, 'p3', { x: 30, y: 30 });
  s = moveCard(s, 8, 'p2', { x: 40, y: 40 });
  assert.equal(active(s).past.length, start + 3);
});
// Step 13 review: the hook itself, not just the reducer. A queue dispatches on separate renders, so
// each dispatch comes after the microtask that closes the ordinary group; only the explicit group
// from beginGroup() keeps them one undo step. (The reducer check above cannot catch a hook that
// ignores the explicit group.) One hook instance stands for every render: the stand-in's useRef is
// not persistent, while React's is, and a render changes nothing else the hook reads here.
{
  hook.seed.state = initJourneys(mapJourney(['p1', 'p2', 'p3']));
  const journeys = hook.useExplorerJourneys(undefined, () => fixtureGraph);
  const past = () => active(hook.current()).past.length;
  const nextRender = () => Promise.resolve();
  const start = past();
  const move = (id, x) => j => ({ ...j, view: viewReduce(j.view, { type: 'NODE_MOVED', level: 'PACKAGE', id, position: { x, y: 0 }, generation: j.view.generation }) });
  const group = journeys.beginGroup();
  journeys.update(move('p1', 11), group);
  await nextRender();
  journeys.update(move('p2', 22), group);
  await nextRender();
  journeys.dispatchView({ type: 'NODE_MOVED', level: 'PACKAGE', id: 'p3', position: { x: 33, y: 0 }, generation: active(hook.current()).present.view.generation }, false, group);
  assert.equal(past(), start + 1, 'three renders sharing beginGroup() are one undo step');
  await nextRender();
  // Without an explicit group, the same pattern is one step per render.
  journeys.update(move('p1', 44));
  await nextRender();
  journeys.update(move('p2', 55));
  assert.equal(past(), start + 3, 'ordinary updates on separate renders stay separate steps');
  hook.seed.state = null;
  count++; console.log('PASS step 13 review: the hook joins explicit-group updates across renders');
}
console.log(`${count} journey checks passed`);
