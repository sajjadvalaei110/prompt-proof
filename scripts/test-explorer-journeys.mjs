import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/explorer/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import \{[^}]*\} from ['"]\.\/[^'"]+['"];?\n?/g, '');
const compiled = ['graphPlacement', 'scopeModel', 'explorerViewState', 'explorerJourney'].map(name => name === 'explorerViewState'
  ? compile(name).replaceAll('HISTORY_LIMIT', 'NAVIGATION_HISTORY_LIMIT') : compile(name)).join('\n');
const { initJourneys, journeysReducer: reduce, explorerViewReducer: viewReduce, HISTORY_LIMIT, newJourney, toggleJourneyReview, initExplorerViewState } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS', name); };
const active = s => s.tabs.find(t => t.id === s.activeId);
const update = (s, group, fn, id = s.activeId, collapse = false) => reduce(s, { type: 'UPDATE', id, group, collapse, update: fn });
const inspect = (s, group, id) => update(s, group, j => ({ ...j, view: viewReduce(j.view, { type: 'INSPECT_NODE', id }) }));

check('one user action restores scope, inspection and tree together', () => {
  let s = initJourneys(); const before = active(s).present;
  s = update(s, 1, j => ({ ...j, scope: { mode: 'CUSTOM', selectedPackageIds: new Set(['p']), selectedClassIds: new Set() } }));
  s = inspect(s, 1, 'c');
  s = update(s, 1, j => ({ ...j, treeOpen: { p: true } }));
  const after = active(s).present;
  assert.equal(active(s).past.length, 1);
  s = reduce(s, { type: 'UNDO' }); assert.strictEqual(active(s).present, before);
  s = reduce(s, { type: 'REDO' }); assert.strictEqual(active(s).present, after);
});
check('new tabs start clean and switching preserves each history', () => {
  let s = inspect(initJourneys(), 1, 'a'); const first = active(s);
  s = reduce(s, { type: 'NEW' }); assert.equal(active(s).present.view.inspectedSubjectId, null);
  assert.equal(active(s).past.length, 0);
  s = inspect(s, 2, 'b'); const second = active(s);
  s = reduce(s, { type: 'SWITCH', id: first.id }); assert.strictEqual(active(s), first);
  s = reduce(s, { type: 'UNDO' }); assert.equal(active(s).present.view.inspectedSubjectId, null);
  assert.strictEqual(s.tabs.find(t => t.id === second.id), second);
});
check('clones branch from the complete past/present/future without mutating the original', () => {
  let s = inspect(inspect(initJourneys(), 1, 'a'), 2, 'b');
  s = reduce(s, { type: 'UNDO' }); const original = active(s);
  s = reduce(s, { type: 'CLONE' }); assert.deepEqual(active(s).future, original.future);
  s = reduce(s, { type: 'REDO' }); assert.equal(active(s).present.view.inspectedSubjectId, 'b');
  s = update(s, 3, j => ({ ...j, scope: { ...j.scope, selectedClassIds: new Set(['c']) } }));
  assert.strictEqual(s.tabs[0], original);
  assert.equal(original.present.scope.selectedClassIds.size, 0);
});
check('new edits after undo discard only that tab’s redo branch; no-op updates preserve redo', () => {
  let s = inspect(initJourneys(), 1, 'a'); s = reduce(s, { type: 'UNDO' });
  s = update(s, 2, j => j); assert.equal(active(s).future.length, 1);
  s = inspect(s, 3, 'b'); assert.equal(active(s).future.length, 0);
});
check('close/reopen restores history and the final tab cannot close', () => {
  let s = inspect(initJourneys(), 1, 'a'); s = reduce(s, { type: 'NEW' });
  const first = s.tabs[0]; s = reduce(s, { type: 'CLOSE', id: first.id });
  assert.equal(s.tabs.length, 1); s = reduce(s, { type: 'CLOSE', id: s.activeId });
  assert.equal(s.tabs.length, 1); s = reduce(s, { type: 'REOPEN' });
  assert.strictEqual(active(s), first);
});
check('geometry, camera, source, selection and auxiliary controls restore exactly', () => {
  let s = initJourneys(); const before = active(s).present;
  s = update(s, 1, j => ({ ...j, multiIds: ['c'], mapOpen: false, fullscreen: true,
    source: { node: { id: 'c' }, type: 'symbol' }, navWidth: 320,
    view: viewReduce(j.view, { type: 'SET_CAMERA', level: 'PACKAGE', generation: j.view.generation, camera: { zoom: 0.7, pan: { x: 10, y: 20 } } }),
  }));
  const after = active(s).present;
  s = reduce(s, { type: 'UNDO' }); assert.strictEqual(active(s).present, before);
  s = reduce(s, { type: 'REDO' }); assert.strictEqual(active(s).present, after);
});
check('initial fit is baseline state, never an undo action or a redo invalidation', () => {
  let s = inspect(initJourneys(), 1, 'a'); s = reduce(s, { type: 'UNDO' });
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
  let s = inspect(initJourneys(), 1, 'a'); const id = s.activeId;
  s = reduce(s, { type: 'NEW' }); s = reduce(s, { type: 'CLOSE', id });
  s = reduce(s, { type: 'RESET', view: initJourneys().initial.view });
  s = update(s, 2, j => ({ ...j, search: 'stale' }), id);
  assert.equal(s.tabs.length, 1); assert.equal(s.closed.length, 0);
  assert.equal(active(s).past.length, 0); assert.equal(active(s).present.search, '');
  assert.ok(s.activeId > id);
});
// Mirrors App.tsx's real double-click path exactly (arrangeAround(id, collapse) -> a single
// ARRANGE_AROUND_RESOURCE dispatch carrying `collapse`), not a stand-in field mutation -- a prior
// version of this test drove `multiIds` by hand with `collapse:true` passed straight to `update()`,
// which passed regardless of what App.tsx actually dispatched and would not have caught the real
// defect: App.tsx used to re-dispatch INSPECT_NODE for the already-inspected node first (a no-op,
// since explorerViewState's INSPECT_NODE case returns the identical state object when the subject is
// unchanged), and journeysReducer's UPDATE case returns early on a no-op (`present === t.present`)
// *before* it records `group` -- silently dropping the `collapse` flag that no-op dispatch carried.
// The real ARRANGE_AROUND_RESOURCE dispatch that followed was then hardcoded to `collapse:false`
// (arrangeAround took no collapse parameter at all), so it always pushed its own, second, undo entry.
const arrange = (s, group, collapse) => update(s, group, j => ({ ...j, view: viewReduce(j.view, {
  type: 'ARRANGE_AROUND_RESOURCE', level: 'PACKAGE', positions: { a: { x: 10, y: 20 } }, generation: j.view.generation,
}) }), s.activeId, collapse);
check('double-click arrangement: collapse:true on the real ARRANGE_AROUND_RESOURCE dispatch joins the preceding entry so one undo reverts the whole gesture', () => {
  let s = initJourneys(); const before = active(s).present;
  s = inspect(s, 1, 'a'); // click 1: a plain single click, its own sealed undo step (group already closed by the time dbltap fires -- a real macrotask gap separates the two physical clicks)
  assert.equal(active(s).past.length, 1);
  // dbltap: App.tsx's onArrangeAroundResource recognizes this as the second half of the same
  // double-click on the same node and calls arrangeAround(id, true) -- a fresh group (simulating the
  // macrotask gap) but explicitly marked collapse, so it must extend click 1's entry, not open a new one.
  s = arrange(s, 2, true);
  assert.equal(active(s).past.length, 1, 'a collapsed arrangement dispatch must not push a second history entry');
  s = reduce(s, { type: 'UNDO' });
  assert.strictEqual(active(s).present, before, 'one undo must fully revert the whole double-click gesture');
});
check('without collapse, the same real dispatch shape still gets its own separate undo step (proves the check above is not vacuous)', () => {
  let s = initJourneys();
  s = inspect(s, 1, 'a');
  assert.equal(active(s).past.length, 1);
  s = arrange(s, 2, false);
  assert.equal(active(s).past.length, 2, 'an uncollapsed arrangement in a fresh group must push its own entry');
});
check('without collapse, an unrelated later group still gets its own separate undo step', () => {
  let s = inspect(initJourneys(), 1, 'x');
  s = update(s, 2, j => ({ ...j, search: 'later' }));
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
  s = inspect(s, 1, 'a');
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

check('history and recently closed retention are bounded', () => {
  let s = initJourneys();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = inspect(s, i, `c${i}`);
  assert.equal(active(s).past.length, HISTORY_LIMIT);
  for (let i = 0; i < 12; i++) { s = reduce(s, { type: 'NEW' }); s = reduce(s, { type: 'CLOSE', id: s.activeId }); }
  assert.equal(s.closed.length, 10);
});
console.log(`${count} journey checks passed`);
