import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = name => ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/explorer/${name}.ts`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/import \{[^}]*\} from ['"]\.\/[^'"]+['"];?\n?/g, '');
const compiled = ['graphPlacement', 'explorerViewState', 'explorerJourney'].map(name => name === 'explorerViewState'
  ? compile(name).replaceAll('HISTORY_LIMIT', 'NAVIGATION_HISTORY_LIMIT') : compile(name)).join('\n');
const { initJourneys, journeysReducer: reduce, explorerViewReducer: viewReduce, HISTORY_LIMIT } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
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
check('double-click arrangement: collapse:true joins the preceding entry so one undo reverts the whole gesture', () => {
  let s = initJourneys(); const before = active(s).present;
  s = inspect(s, 1, 'a'); // click 1: a plain single click, its own sealed undo step (group already closed by the time dbltap fires -- a real macrotask gap separates the two physical clicks)
  assert.equal(active(s).past.length, 1);
  // dbltap: a fresh group (simulating that gap) explicitly marked collapse:true by the caller, once
  // it has verified this is the second half of the same double-click on the same node -- must extend
  // click 1's entry instead of opening a new one.
  s = update(s, 2, j => ({ ...j, multiIds: ['a'] }), s.activeId, true);
  assert.equal(active(s).past.length, 1, 'a collapsed update must not push a second history entry');
  // The coalesced ARRANGE_AROUND_RESOURCE dispatch that follows in the same task/group still merges normally.
  s = update(s, 2, j => ({ ...j, multiIds: ['a', 'b'] }));
  assert.equal(active(s).past.length, 1);
  s = reduce(s, { type: 'UNDO' });
  assert.strictEqual(active(s).present, before, 'one undo must fully revert the whole double-click gesture');
});
check('without collapse, an unrelated later group still gets its own separate undo step', () => {
  let s = inspect(initJourneys(), 1, 'x');
  s = update(s, 2, j => ({ ...j, search: 'later' }));
  assert.equal(active(s).past.length, 2);
});
check('history and recently closed retention are bounded', () => {
  let s = initJourneys();
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = inspect(s, i, `c${i}`);
  assert.equal(active(s).past.length, HISTORY_LIMIT);
  for (let i = 0; i < 12; i++) { s = reduce(s, { type: 'NEW' }); s = reduce(s, { type: 'CLOSE', id: s.activeId }); }
  assert.equal(s.closed.length, 10);
});
console.log(`${count} journey checks passed`);
