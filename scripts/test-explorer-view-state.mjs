import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
// explorerViewState.ts only imports the `Level` *type* from graphModel.ts, which transpileModule
// elides since it is never used as a value here; strip the import defensively in case a future
// edit adds a real value import, so this script keeps working as a standalone reducer test.
const stripLocalImport = (src, name) => src.replace(new RegExp(`import \\{[^}]*\\} from ['"]\\./${name}['"];?\n?`), '');
const compiled = stripLocalImport(compile('../frontend/src/features/explorer/explorerViewState.ts'), 'graphModel');
const { explorerViewReducer, initExplorerViewState } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

let passCount = 0;
function check(label, fn) { fn(); passCount++; }

// --- Inspection never touches level/membership ---
check('INSPECT_NODE does not change activeLevel, levelViews, or membershipRevision', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c1', 'c2', 'c3'], batchSize: 12 });
  const beforeViews = s.levelViews, beforeRevision = s.membershipRevision;
  const next = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'c1' });
  assert.equal(next.activeLevel, 'CLASS');
  assert.strictEqual(next.levelViews, beforeViews, 'levelViews object identity must be unchanged by inspection');
  assert.equal(next.membershipRevision, beforeRevision);
  assert.equal(next.inspectedSubjectId, 'c1');
  assert.equal(next.inspectedKind, 'NODE');
});

check('re-inspecting the same subject/kind is a no-op (same state reference, no history push)', () => {
  let s = initExplorerViewState('CLASS');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'c1' });
  const again = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'c1' });
  assert.strictEqual(again, s);
});

check('inspecting a different subject pushes the previous one to history exactly once, no duplicate consecutive entries', () => {
  let s = initExplorerViewState('CLASS');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' });
  assert.deepEqual(s.history.map(h => h.subjectId), ['a']);
  s = explorerViewReducer(s, { type: 'INSPECT_EDGE', id: 'e1' });
  assert.deepEqual(s.history.map(h => h.subjectId), ['a', 'b']);
  assert.equal(s.history[1].kind, 'NODE');
  // Clicking the currently-inspected edge again must not duplicate history.
  s = explorerViewReducer(s, { type: 'INSPECT_EDGE', id: 'e1' });
  assert.deepEqual(s.history.map(h => h.subjectId), ['a', 'b']);
});

check('history is capped at 20 entries', () => {
  let s = initExplorerViewState('CLASS');
  for (let i = 0; i < 25; i++) s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: `n${i}` });
  assert.equal(s.history.length, 20);
  assert.equal(s.history[0].subjectId, 'n4'); // n0..n3 fell off
  assert.equal(s.history[19].subjectId, 'n23');
});

check('CLEAR_INSPECTION clears the subject and is a no-op when already clear', () => {
  let s = initExplorerViewState('CLASS');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'CLEAR_INSPECTION' });
  assert.equal(s.inspectedSubjectId, null);
  assert.equal(s.inspectedKind, null);
  const again = explorerViewReducer(s, { type: 'CLEAR_INSPECTION' });
  assert.strictEqual(again, s);
});

check('CLEAR_INSPECTION preserves the closed subject in history, so Back does not skip past it', () => {
  // A -> B -> close -> C: Back from C must land on B, not jump straight to A.
  let s = initExplorerViewState('CLASS');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' });
  s = explorerViewReducer(s, { type: 'CLEAR_INSPECTION' });
  assert.deepEqual(s.history.map(h => h.subjectId), ['a', 'b'], 'closing pushes the closed subject onto history');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'c' });
  assert.deepEqual(s.history.map(h => h.subjectId), ['a', 'b'], 'inspecting after a close does not duplicate the just-closed entry');
  const backToB = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: ['a', 'b', 'c'] });
  assert.equal(backToB.inspectedSubjectId, 'b');
  const backToA = explorerViewReducer(backToB, { type: 'NAVIGATE_BACK', eligibleIds: ['a', 'b', 'c'] });
  assert.equal(backToA.inspectedSubjectId, 'a');
});

// --- Initial admission / NAVIGATE_LEVEL ---
check('NAVIGATE_LEVEL on a never-visited level admits the first batch, in given rank order', () => {
  let s = initExplorerViewState('PACKAGE');
  const ranked = ['c5', 'c1', 'c9', 'c2']; // caller-provided rank order; reducer must not re-sort
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ranked, batchSize: 3 });
  assert.equal(s.activeLevel, 'CLASS');
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c5', 'c1', 'c9']);
  assert.deepEqual(s.newlyAddedIds, ['c5', 'c1', 'c9']);
});

check('re-navigating to the same level with unchanged eligibility is idempotent (no drift)', () => {
  let s = initExplorerViewState('PACKAGE');
  const ranked = Array.from({ length: 20 }, (_, i) => `c${i}`);
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ranked, batchSize: 12 });
  const displayedBefore = s.levelViews.CLASS.displayedIds;
  const next = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ranked, batchSize: 12 });
  assert.deepEqual(next.levelViews.CLASS.displayedIds, displayedBefore);
  assert.deepEqual(next.newlyAddedIds, []);
});

// --- The core Step-1 regression: reveal 36, then inspect, must not collapse to 12 ---
check('revealing 36 classes via two Show more calls, then inspecting one, keeps all 36 displayed', () => {
  const allEligible = Array.from({ length: 74 }, (_, i) => `c${i}`); // ranked order
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: allEligible, batchSize: 12 });
  assert.equal(s.levelViews.CLASS.displayedIds.length, 12);
  s = explorerViewReducer(s, { type: 'SHOW_MORE', eligibleIds: allEligible, batchSize: 12 });
  s = explorerViewReducer(s, { type: 'SHOW_MORE', eligibleIds: allEligible, batchSize: 12 });
  assert.equal(s.levelViews.CLASS.displayedIds.length, 36);
  const displayedBefore = s.levelViews.CLASS.displayedIds.slice();
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: displayedBefore[14] });
  assert.equal(s.levelViews.CLASS.displayedIds.length, 36, 'inspecting must not reset the page to 12');
  assert.deepEqual(s.levelViews.CLASS.displayedIds, displayedBefore, 'displayed IDs and their order must be exactly preserved');
  assert.equal(s.activeLevel, 'CLASS');
});

// --- Scope growth: explicit single-class add vs. package (bounded batch) add ---
check('an explicit single-class add appends exactly that class, growing the count by one', () => {
  const eligible = ['c1', 'c2', 'c3'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c1', 'c2', 'c3']);
  const grown = [...eligible, 'c4']; // c4 just became eligible via the checkbox
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: grown, explicitClassAddId: 'c4', batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(s.newlyAddedIds, ['c4']);
});

check('an explicit class add whose target is not a valid candidate at the active level admits nothing (never falls back to an unrelated batch)', () => {
  // The class checkbox in the tree can be toggled while a different level (e.g. Packages) is
  // active; the checked class ID is then not even a candidate in the active level's eligible set.
  const eligible = ['p1', 'p2']; // PACKAGE-level candidates; 'c4' (a class ID) is not among them
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'PACKAGE', eligibleIds: eligible, batchSize: 12 });
  const before = s.levelViews.PACKAGE.displayedIds;
  const grown = ['p1', 'p2', 'p3']; // p3 also happens to have become newly eligible in this edit
  const next = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: grown, explicitClassAddId: 'c4', batchSize: 12 });
  assert.deepEqual(next.levelViews.PACKAGE.displayedIds, before, 'p3 must NOT be silently admitted just because the explicit target could not be honored');
  assert.deepEqual(next.newlyAddedIds, []);
});

check('a package addition appends a bounded first batch of up to 12 newly eligible classes, survivors untouched', () => {
  const original = Array.from({ length: 30 }, (_, i) => `o${i}`); // 30 eligible, page shows first 12
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: original, batchSize: 12 });
  const survivors = s.levelViews.CLASS.displayedIds.slice();
  assert.equal(survivors.length, 12);
  const newPackageClasses = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const grown = [...original, ...newPackageClasses]; // a new package was checked
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: grown, batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds.slice(0, 12), survivors, 'the original 12 survivors keep their exact order');
  assert.equal(s.levelViews.CLASS.displayedIds.length, 24, '12 survivors + a bounded 12-item batch, not all 20 new classes at once');
  assert.deepEqual(s.newlyAddedIds, newPackageClasses.slice(0, 12));
  // none of the un-admitted original o18..o29 (already-pending before this edit) leaked in
  for (const id of original.slice(12)) assert.ok(!s.levelViews.CLASS.displayedIds.includes(id));
});

check('an unrelated scope edit never reveals classes that were already eligible-but-pending (newlyEligible excludes them)', () => {
  const eligible = Array.from({ length: 20 }, (_, i) => `e${i}`);
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  // e12..e19 are eligible but pending (not yet shown via Show more).
  const withNewPackage = [...eligible, 'n0', 'n1'];
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: withNewPackage, batchSize: 12 });
  assert.deepEqual(s.newlyAddedIds, ['n0', 'n1'], 'only the genuinely new package classes are auto-admitted');
  assert.equal(s.levelViews.CLASS.displayedIds.length, 14);
});

check('removal drops ineligible survivors without backfilling from the hidden queue', () => {
  const eligible = Array.from({ length: 5 }, (_, i) => `c${i}`);
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c1', 'c2', 'c3', 'c4']);
  const shrunk = ['c0', 'c2', 'c4']; // c1, c3 removed from scope
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: shrunk, batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2', 'c4'], 'no hole-filling; order of survivors preserved');
});

check('membershipRevision only bumps when displayed membership actually changes, not on every dispatch', () => {
  const eligible = ['c0', 'c1'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  const revisionAfterFirstPopulate = s.membershipRevision;
  // Re-navigating with unchanged eligibility admits nothing new and drops no survivors.
  const idempotent = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  assert.equal(idempotent.membershipRevision, revisionAfterFirstPopulate, 'a no-op reconciliation must not bump the revision');
  // Show more with nothing left pending is likewise a genuine no-op.
  const noMore = explorerViewReducer(idempotent, { type: 'SHOW_MORE', eligibleIds: eligible, batchSize: 12 });
  assert.equal(noMore.membershipRevision, revisionAfterFirstPopulate, 'Show more with an empty pending queue must not bump the revision');
  // A genuine admission does bump it.
  const grown = explorerViewReducer(noMore, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1', 'c2'], batchSize: 12 });
  assert.equal(grown.membershipRevision, revisionAfterFirstPopulate + 1, 'an actual membership change must bump the revision');
});

check('SHOW_MORE also drops any survivor that fell out of eligibility, defensively (not just admits new ones)', () => {
  const eligible = ['c0', 'c1', 'c2', 'c3'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 2 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c1']);
  // c1 fell out of scope in the interim without an intervening SCOPE_UPDATED reconciliation.
  const next = explorerViewReducer(s, { type: 'SHOW_MORE', eligibleIds: ['c0', 'c2', 'c3'], batchSize: 2 });
  assert.ok(!next.levelViews.CLASS.displayedIds.includes('c1'), 'a now-ineligible survivor must not persist through Show more');
  assert.deepEqual(next.levelViews.CLASS.displayedIds, ['c0', 'c2', 'c3']);
});

check('re-adding a removed class appends it below the current map, not back into its old slot', () => {
  const eligible = ['c0', 'c1', 'c2'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c2'], batchSize: 12 }); // remove c1
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2']);
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1', 'c2'], explicitClassAddId: 'c1', batchSize: 12 }); // re-add c1
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2', 'c1'], 'c1 lands at the end, not restored to index 1');
});

// --- Show more ---
check('SHOW_MORE reveals the next batch from everything eligible-but-undisplayed, independent of when it became eligible', () => {
  const eligible = Array.from({ length: 25 }, (_, i) => `c${i}`);
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12 });
  s = explorerViewReducer(s, { type: 'SHOW_MORE', eligibleIds: eligible, batchSize: 12 });
  assert.equal(s.levelViews.CLASS.displayedIds.length, 24);
  s = explorerViewReducer(s, { type: 'SHOW_MORE', eligibleIds: eligible, batchSize: 12 });
  assert.equal(s.levelViews.CLASS.displayedIds.length, 25); // only 1 left pending
  assert.deepEqual(s.newlyAddedIds, ['c24']);
});

// --- Back navigation: purely restorative ---
check('NAVIGATE_BACK restores the prior inspection/level and drops now-ineligible survivors, but never auto-admits new eligibility', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['a', 'b', 'c'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' }); // subject a, level CLASS pushed on next inspect
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' }); // history: [a@CLASS]
  assert.equal(s.history.length, 1);
  // Scope shrinks (b's package is removed) and grows (d becomes eligible) while "away".
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: ['a', 'c', 'd'] });
  assert.equal(back.inspectedSubjectId, 'a');
  assert.equal(back.activeLevel, 'CLASS');
  assert.deepEqual(back.levelViews.CLASS.displayedIds, ['a', 'c'], 'ineligible survivor b dropped; newly-eligible d NOT auto-revealed');
  assert.equal(back.history.length, 0);
});

check('NAVIGATE_BACK on empty history is a no-op', () => {
  const s = initExplorerViewState('PACKAGE');
  const next = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: [] });
  assert.strictEqual(next, s);
});

// --- Reset (new snapshot) ---
check('RESET reinitializes every level and populates only the starting level', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['a', 'b'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p1', 'p2'], batchSize: Infinity });
  assert.equal(s.activeLevel, 'PACKAGE');
  assert.equal(s.inspectedSubjectId, null);
  assert.equal(s.history.length, 0);
  assert.deepEqual(s.levelViews.PACKAGE.displayedIds, ['p1', 'p2']);
  assert.deepEqual(s.levelViews.CLASS.displayedIds, [], 'a stale level from the previous snapshot must not leak forward');
});

console.log(`PASS: ${passCount} explorerViewState reducer checks (inspection/membership separation, append-only scope growth, show more, back navigation, reset)`);
