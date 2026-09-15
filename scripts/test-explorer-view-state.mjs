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
// explorerViewState.ts also imports the real `placeAdditions` function (plus erased types) from
// graphPlacement.ts (Step 3). graphPlacement.ts has zero imports of its own, so it is concatenated
// ahead of explorerViewState's compiled body with its own import line stripped, producing one
// self-contained module for the data: URL loader (which cannot resolve a relative specifier).
const placementModule = compile('../frontend/src/features/explorer/graphPlacement.ts');
const viewStateModule = stripLocalImport(stripLocalImport(compile('../frontend/src/features/explorer/explorerViewState.ts'), 'graphModel'), 'graphPlacement');
const compiled = placementModule + '\n' + viewStateModule;
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
  // Leaving PACKAGE uninspected pushes a level-only breadcrumb (Step 5 review remediation B1).
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['a', 'b', 'c'], batchSize: 12 });
  assert.deepEqual(s.history.map(h => [h.subjectId, h.level]), [[null, 'PACKAGE']]);
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' }); // subject a, level CLASS pushed on next inspect
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' }); // history: [null@PACKAGE, a@CLASS]
  assert.equal(s.history.length, 2);
  // Scope shrinks (b's package is removed) and grows (d becomes eligible) while "away".
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: ['a', 'c', 'd'] });
  assert.equal(back.inspectedSubjectId, 'a');
  assert.equal(back.activeLevel, 'CLASS');
  assert.deepEqual(back.levelViews.CLASS.displayedIds, ['a', 'c'], 'ineligible survivor b dropped; newly-eligible d NOT auto-revealed');
  assert.equal(back.history.length, 1, 'the level-only breadcrumb remains for a second Back');
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

// --- Step 3: geometry (positions/camera) extension ---
const dims = (w, h, name) => ({ width: w, height: h, name });
const placementFor = (ids, w = 250, h = 128) => Object.fromEntries(ids.map((id, i) => [id, dims(w, h, `Q${String(i).padStart(3, '0')}`)]));

check('an initial batch with no survivors places the first card at the origin and marks geometryInitialized', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['c0', 'c1', 'c2'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  const view = s.levelViews.CLASS;
  assert.equal(view.geometryInitialized, true);
  assert.equal(view.camera, null, 'camera is not set by membership actions -- only SET_CAMERA sets it');
  for (const id of eligible) assert.ok(view.positions[id], `${id} must have a position`);
});

check('without a placement record, new IDs are admitted but get no position (membership-only callers keep working)', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1'], batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c1']);
  assert.deepEqual(s.levelViews.CLASS.positions, {});
  assert.equal(s.levelViews.CLASS.geometryInitialized, false);
});

check('a later addition places new cards below the current bounding box, survivor positions untouched', () => {
  let s = initExplorerViewState('PACKAGE');
  const first = ['c0', 'c1'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: first, batchSize: 12, placement: placementFor(first) });
  const before = s.levelViews.CLASS.positions;
  const bottom = Math.max(...first.map(id => before[id].y + 128 / 2));
  const grown = [...first, 'c2'];
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: grown, batchSize: 12, placement: placementFor(grown) });
  const after = s.levelViews.CLASS.positions;
  assert.deepEqual(after.c0, before.c0, 'survivor c0 keeps its exact position');
  assert.deepEqual(after.c1, before.c1, 'survivor c1 keeps its exact position');
  assert.ok(after.c2.y - 128 / 2 >= bottom + 64, 'the new card lands at or below survivor bottom + 64');
});

check('removal drops geometry for removed IDs; re-adding lands at the new bottom, not the old hole', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['c0', 'c1', 'c2'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  const originalC1 = s.levelViews.CLASS.positions.c1;
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c2'], batchSize: 12 }); // remove c1
  assert.ok(!('c1' in s.levelViews.CLASS.positions), 'removed geometry is discarded');
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1', 'c2'], explicitClassAddId: 'c1', batchSize: 12, placement: placementFor(['c0', 'c1', 'c2']) }); // re-add c1
  assert.notDeepEqual(s.levelViews.CLASS.positions.c1, originalC1, 're-added c1 gets a fresh position, not its old slot');
});

check('geometryRevision only bumps when a position is actually placed, not on every admission', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0'], batchSize: 12, placement: placementFor(['c0']) });
  const revisionAfterFirst = s.levelViews.CLASS.geometryRevision;
  assert.equal(revisionAfterFirst, 1);
  // Admitting c1 with no placement record leaves it unpositioned -- no geometry change occurred.
  const noGeometry = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['c0', 'c1'], batchSize: 12 });
  assert.equal(noGeometry.levelViews.CLASS.geometryRevision, revisionAfterFirst, 'admitting without placement data does not bump geometryRevision');
});

check('geometryInitialized is monotonic: an empty-scope transition does not clear it (empty-scope transitions must not reset cached geometry)', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0'], batchSize: 12, placement: placementFor(['c0']) });
  assert.equal(s.levelViews.CLASS.geometryInitialized, true);
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: [], batchSize: 12 }); // scope cleared
  assert.deepEqual(s.levelViews.CLASS.displayedIds, []);
  assert.equal(s.levelViews.CLASS.geometryInitialized, true, 'geometryInitialized must remain true across an empty-scope transition');
});

check('appendWidth is decided once from the first-ever batch and reused for later batches at that level', () => {
  let s = initExplorerViewState('PACKAGE');
  const first = ['c0'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: first, batchSize: 12, placement: placementFor(first, 250, 128) });
  const width = s.levelViews.CLASS.appendWidth;
  assert.ok(width && width > 0);
  const grown = ['c0', 'c1'];
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: grown, batchSize: 12, placement: placementFor(grown, 999, 999) }); // wildly different dims
  assert.equal(s.levelViews.CLASS.appendWidth, width, 'appendWidth is never recomputed once stored');
});

check('SET_CAMERA stores the camera, bumps cameraRevision, and is a strict-equality no-op on repeat', () => {
  let s = initExplorerViewState('PACKAGE');
  const camera = { zoom: 1, pan: { x: 10, y: 20 } };
  s = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'PACKAGE', camera, generation: 0 });
  assert.deepEqual(s.levelViews.PACKAGE.camera, camera);
  assert.equal(s.levelViews.PACKAGE.cameraRevision, 1);
  const again = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'PACKAGE', camera: { zoom: 1, pan: { x: 10, y: 20 } }, generation: 0 });
  assert.strictEqual(again, s, 'an identical camera value is a true no-op (same state reference)');
});

check('SET_CAMERA writes to the level named in the action, not activeLevel (a debounced event from a different level cannot land on the wrong one)', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0'], batchSize: 12 });
  assert.equal(s.activeLevel, 'CLASS');
  s = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'PACKAGE', camera: { zoom: 2, pan: { x: 0, y: 0 } }, generation: 0 });
  assert.ok(s.levelViews.PACKAGE.camera, 'PACKAGE view got the camera');
  assert.equal(s.levelViews.CLASS.camera, null, 'CLASS view (the active level) is untouched');
});

check('a SET_CAMERA/NODE_MOVED stamped with a stale generation is ignored', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0'], batchSize: Infinity, placement: placementFor(['p0']) });
  assert.equal(s.generation, 1);
  const stale = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'PACKAGE', camera: { zoom: 3, pan: { x: 1, y: 1 } }, generation: 0 });
  assert.strictEqual(stale, s, 'a camera event stamped with the previous generation is dropped entirely');
  const staleMove = explorerViewReducer(s, { type: 'NODE_MOVED', level: 'PACKAGE', id: 'p0', position: { x: 5, y: 5 }, generation: 0 });
  assert.strictEqual(staleMove, s, 'a drag event stamped with the previous generation is dropped entirely');
});

check('NODE_MOVED updates exactly the dragged card and bumps geometryRevision; ignored for an ID no longer displayed', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['c0', 'c1'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  const revisionBefore = s.levelViews.CLASS.geometryRevision;
  const c1Before = s.levelViews.CLASS.positions.c1;
  s = explorerViewReducer(s, { type: 'NODE_MOVED', level: 'CLASS', id: 'c0', position: { x: 999, y: 999 }, generation: 0 });
  assert.deepEqual(s.levelViews.CLASS.positions.c0, { x: 999, y: 999 });
  assert.deepEqual(s.levelViews.CLASS.positions.c1, c1Before, 'the untouched card keeps its exact position');
  assert.equal(s.levelViews.CLASS.geometryRevision, revisionBefore + 1);
  const ignored = explorerViewReducer(s, { type: 'NODE_MOVED', level: 'CLASS', id: 'not-displayed', position: { x: 1, y: 1 }, generation: 0 });
  assert.strictEqual(ignored, s, 'a drag for an ID no longer displayed is ignored');
});

check('NODES_MOVED (review remediation F-05): several cards move in one dispatch with exactly one geometryRevision bump', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['c0', 'c1', 'c2'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'CLASS', id: 'c2', ownerId: null, childPositions: { m0: { x: 1, y: 1 } }, generation: s.generation });
  const revisionBefore = s.levelViews.CLASS.geometryRevision;
  s = explorerViewReducer(s, { type: 'NODES_MOVED', level: 'CLASS', generation: 0, moves: [
    { id: 'c0', position: { x: 111, y: 222 }, containerId: null },
    { id: 'c1', position: { x: 333, y: 444 }, containerId: null },
    { id: 'm0', position: { x: 5, y: 6 }, containerId: 'c2' },
  ] });
  assert.deepEqual(s.levelViews.CLASS.positions.c0, { x: 111, y: 222 });
  assert.deepEqual(s.levelViews.CLASS.positions.c1, { x: 333, y: 444 });
  assert.deepEqual(s.levelViews.CLASS.expansions.c2.childPositions.m0, { x: 5, y: 6 }, 'an entry with a containerId lands in that container\'s child positions, like NODE_MOVED');
  assert.equal(s.levelViews.CLASS.geometryRevision, revisionBefore + 1, 'one bump for the whole batch, not one per card');
  const stale = explorerViewReducer(s, { type: 'NODES_MOVED', level: 'CLASS', generation: -1, moves: [{ id: 'c0', position: { x: 0, y: 0 }, containerId: null }] });
  assert.strictEqual(stale, s, 'a stale generation drops the whole batch, matching NODE_MOVED/SET_CAMERA');
  const noop = explorerViewReducer(s, { type: 'NODES_MOVED', level: 'CLASS', generation: 0, moves: [
    { id: 'c0', position: { x: 111, y: 222 }, containerId: null },
    { id: 'not-displayed', position: { x: 1, y: 1 }, containerId: null },
  ] });
  assert.strictEqual(noop, s, 'every entry either unchanged or for an ID no longer displayed: no-op, exactly like NODE_MOVED');
});

check('RESET reinitializes geometry (fresh positions/camera/appendWidth) and bumps generation', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0'], batchSize: 12, placement: placementFor(['c0']) });
  s = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'CLASS', camera: { zoom: 2, pan: { x: 5, y: 5 } }, generation: 0 });
  const before = s.generation;
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0'], batchSize: Infinity, placement: placementFor(['p0']) });
  assert.equal(s.generation, before + 1);
  assert.equal(s.levelViews.CLASS.camera, null, 'a stale level from the previous snapshot has fresh (empty) geometry');
  assert.deepEqual(s.levelViews.CLASS.positions, {});
  assert.equal(s.levelViews.PACKAGE.geometryInitialized, true, 'the starting level gets its initial placement immediately in the same RESET');
});

check('NAVIGATE_BACK preserves the destination level\'s existing camera/positions untouched', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['a', 'b', 'c'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  s = explorerViewReducer(s, { type: 'SET_CAMERA', level: 'CLASS', camera: { zoom: 1.5, pan: { x: 3, y: 4 } }, generation: 0 });
  const savedPositions = s.levelViews.CLASS.positions;
  const savedCamera = s.levelViews.CLASS.camera;
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' });
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: eligible });
  assert.deepEqual(back.levelViews.CLASS.camera, savedCamera);
  assert.deepEqual(back.levelViews.CLASS.positions.a, savedPositions.a);
});

// --- Step 4 (Appendix F3): scope edits while a level is inactive ---
check('a scope removal while a level is inactive drops the survivor immediately (shadow trim); re-adding it later appends fresh, not into its old slot', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1', 'c2'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m0'], batchSize: 12 }); // CLASS is now inactive
  // Remove c1 from scope while Methods is active.
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['m0'], batchSize: 12, otherLevels: { CLASS: ['c0', 'c2'] } });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2'], 'c1 is dropped from the inactive CLASS view immediately, not deferred to its next visit');
  assert.ok(!('c1' in s.levelViews.CLASS.positions), 'its geometry is discarded too');
  assert.ok(!s.levelViews.CLASS.priorEligibleIds.includes('c1'), 'c1 is forgotten from priorEligibleIds so a later re-add reads as genuinely new');
  // Re-add c1 while still on Methods.
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['m0'], batchSize: 12, otherLevels: { CLASS: ['c0', 'c1', 'c2'] } });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2'], 'the inactive view still does not display it -- admission stays deferred to an actual visit');
  // Now actually return to Classes.
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1', 'c2'], batchSize: 12 });
  assert.deepEqual(s.levelViews.CLASS.displayedIds, ['c0', 'c2', 'c1'], 'c1 lands at the end as a fresh addition, exactly like the same-level remove/re-add case');
});

check('an explicit class addition while viewing a different level is a true no-op for the inactive level (same state reference), and is recognized as newly eligible on the next visit', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m0'], batchSize: 12 });
  const classViewBefore = s.levelViews.CLASS;
  // c2 is checked in the tree while Methods is active (explicitClassAddId is irrelevant to Methods).
  const next = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['m0'], explicitClassAddId: 'c2', batchSize: 12, otherLevels: { CLASS: ['c0', 'c1', 'c2'] } });
  assert.strictEqual(next.levelViews.CLASS, classViewBefore, 'nothing to drop and nothing new tracked in priorEligibleIds -- the inactive view is untouched by reference');
  const backToClass = explorerViewReducer(next, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1', 'c2'], batchSize: 12 });
  assert.deepEqual(backToClass.levelViews.CLASS.displayedIds, ['c0', 'c1', 'c2'], 'c2 is admitted as newly eligible on the actual visit');
});

check('membershipRevision bumps when only an inactive level changes via otherLevels, even though the active level\'s own reconciliation was a no-op', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0', 'c1'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m0'], batchSize: 12 });
  const revisionBefore = s.membershipRevision;
  // The active (METHOD) reconciliation is an idempotent no-op; only the inactive CLASS view drops c1.
  const next = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['m0'], batchSize: 12, otherLevels: { CLASS: ['c0'] } });
  assert.equal(next.membershipRevision, revisionBefore + 1, 'an inactive-level-only membership change still bumps the shared revision counter');
});

check('shadowTrimLevel is a true no-op (same reference, initialized untouched) on a level that has never been visited', () => {
  let s = initExplorerViewState('PACKAGE');
  const classViewBefore = s.levelViews.CLASS; // never visited: displayedIds/priorEligibleIds both []
  const next = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: [], batchSize: 12, otherLevels: { CLASS: ['c0', 'c1'] } });
  assert.strictEqual(next.levelViews.CLASS, classViewBefore);
  assert.equal(next.levelViews.CLASS.initialized, false);
});

// --- Step 4: Back precedence -- latest geometry for a level always wins over its history snapshot ---
check('a HistoryEntry records the geometryRevision at push time, for a transition test to assert precedence against', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['a', 'b'], batchSize: 12, placement: placementFor(['a', 'b']) });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  assert.equal(s.levelViews.CLASS.geometryRevision, 1);
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' }); // pushes {subjectId:'a', ...}
  assert.equal(s.history[s.history.length - 1].geometryRevision, 1, 'the entry remembers the revision that was current when it was pushed');
});

check('Back restores the inspected subject but never rewinds a level\'s geometry to the revision recorded on its history entry: a later drag survives Back', () => {
  let s = initExplorerViewState('PACKAGE');
  const eligible = ['a', 'b'];
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'a' });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'b' }); // history: [..., {a, CLASS, rev 1}]
  const revAtPush = s.history[s.history.length - 1].geometryRevision;
  const draggedPosition = { x: 4321, y: 1234 };
  s = explorerViewReducer(s, { type: 'NODE_MOVED', level: 'CLASS', id: 'a', position: draggedPosition, generation: 0 }); // rev -> 2
  assert.equal(s.levelViews.CLASS.geometryRevision, revAtPush + 1);
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: eligible });
  assert.equal(back.inspectedSubjectId, 'a');
  assert.equal(back.levelViews.CLASS.geometryRevision, revAtPush + 1, 'Back does not roll geometryRevision back to the value recorded on the history entry');
  assert.deepEqual(back.levelViews.CLASS.positions.a, draggedPosition, 'the later drag -- the latest geometry revision for the level -- is what Back actually shows');
});

// --- Step 4 (Appendix F3): Back must not silently consume a pending admission made while away ---
check('an addition made while away from a level is NOT revealed by Back (batchSize 0), but remains truthfully pending and reachable via Show more afterward', () => {
  const original = Array.from({ length: 14 }, (_, i) => `c${i}`); // 12 shown, c12/c13 pending
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: original, batchSize: 12 });
  const displayedBefore = s.levelViews.CLASS.displayedIds.slice();
  assert.equal(displayedBefore.length, 12);
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'c0' }); // first inspect: no history push yet
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'away-marker' }); // pushes {c0, CLASS} onto history
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m0'], batchSize: 12 });
  // A package is added to scope while Methods is active: 3 brand-new classes become eligible.
  const grown = [...original, 'n0', 'n1', 'n2'];
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['m0'], batchSize: 12, otherLevels: { CLASS: grown } });
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: grown });
  assert.equal(back.inspectedSubjectId, 'c0');
  assert.equal(back.activeLevel, 'CLASS');
  assert.deepEqual(back.levelViews.CLASS.displayedIds, displayedBefore, 'Back reveals nothing new -- the page is byte-identical to how the user left it');
  const shown = explorerViewReducer(back, { type: 'SHOW_MORE', eligibleIds: grown, batchSize: 12 });
  assert.deepEqual(shown.levelViews.CLASS.displayedIds, [...displayedBefore, 'c12', 'c13', 'n0', 'n1', 'n2'], 'Show more afterward reveals both the originally-pending and the while-away additions -- nothing was silently swallowed');
});

// --- Step 5: ARRANGE_AROUND_RESOURCE applies a bulk position update in one atomic dispatch ---
check('ARRANGE_AROUND_RESOURCE overwrites exactly the given IDs\' positions and bumps geometryRevision once', () => {
  const eligible = ['a', 'b', 'c'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  const revBefore = s.levelViews.CLASS.geometryRevision;
  const untouchedBefore = s.levelViews.CLASS.positions.c;
  const positions = { a: { x: 111, y: 222 }, b: { x: 333, y: 444 } };
  const next = explorerViewReducer(s, { type: 'ARRANGE_AROUND_RESOURCE', level: 'CLASS', positions, generation: 0 });
  assert.deepEqual(next.levelViews.CLASS.positions.a, positions.a);
  assert.deepEqual(next.levelViews.CLASS.positions.b, positions.b);
  assert.deepEqual(next.levelViews.CLASS.positions.c, untouchedBefore, 'an ID absent from the arrangement result is left exactly as it was');
  assert.equal(next.levelViews.CLASS.geometryRevision, revBefore + 1, 'one bulk arrangement is one revision bump, not one per card');
  assert.equal(next.activeLevel, 'CLASS', 'arrangement never changes level, scope, or membership');
  assert.deepEqual(next.levelViews.CLASS.displayedIds, s.levelViews.CLASS.displayedIds);
});

check('ARRANGE_AROUND_RESOURCE stamped with a stale generation is ignored, matching SET_CAMERA/NODE_MOVED', () => {
  const eligible = ['a'];
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: eligible, batchSize: 12, placement: placementFor(eligible) });
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: [], batchSize: 12 }); // generation 0 -> 1
  const stale = explorerViewReducer(s, { type: 'ARRANGE_AROUND_RESOURCE', level: 'CLASS', positions: { a: { x: 9, y: 9 } }, generation: 0 });
  assert.strictEqual(stale, s, 'a late arrangement from before a snapshot reset must not land');
});

// --- Step 5 review remediation A1: a HistoryEntry must record the level a subject was actually
// inspected under, not whatever activeLevel happens to be when the entry is finally pushed ---
check('A1: inspecting a class on CLASS, switching to METHOD (inspection persists), then inspecting a method pushes the CLASS-level entry, not METHOD', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['OrderController'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'OrderController' }); // inspected under CLASS
  // Switching to METHOD leaves inspectedSubjectId/inspectedLevel untouched (Step 4's cross-level
  // inspection persistence) -- activeLevel changes underneath the still-inspected subject.
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['createOrder'], batchSize: 12 });
  assert.equal(s.inspectedSubjectId, 'OrderController');
  assert.equal(s.activeLevel, 'METHOD');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'createOrder' });
  const pushed = s.history[s.history.length - 1];
  assert.equal(pushed.subjectId, 'OrderController');
  assert.equal(pushed.level, 'CLASS', 'the entry must record CLASS -- the level OrderController was actually inspected under -- not METHOD');
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: ['OrderController'] });
  assert.equal(back.activeLevel, 'CLASS', 'Back must return to Classes, not stay stuck on Methods');
  assert.equal(back.inspectedSubjectId, 'OrderController');
});

check('A1 second lap: after Back restores the CLASS-level entry, inspecting a third subject pushes CLASS again, not the stale METHOD', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A', 'B'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'A' }); // inspected under CLASS
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'B' }); // pushes {A, CLASS}; inspected under METHOD
  s = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: ['A', 'B'] }); // restores A, activeLevel CLASS, inspectedLevel CLASS
  assert.equal(s.activeLevel, 'CLASS');
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'C' }); // pushes {A, ...}
  const pushed = s.history[s.history.length - 1];
  assert.equal(pushed.subjectId, 'A');
  assert.equal(pushed.level, 'CLASS', 'NAVIGATE_BACK must restore inspectedLevel, or this second lap regresses to the same defect one hop later');
});

check('A1: CLEAR_INSPECTION also uses the level actually inspected under, not activeLevel at close time', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'A' }); // inspected under CLASS
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'CLEAR_INSPECTION' }); // closes A while activeLevel is METHOD
  const pushed = s.history[s.history.length - 1];
  assert.equal(pushed.subjectId, 'A');
  assert.equal(pushed.level, 'CLASS', 'closing at METHOD must still record CLASS, the level A was actually inspected under');
});

// --- Step 5 review remediation B1: an explicit level change from a completely uninspected state
// must still leave a way back, instead of silently leaving history empty and Back disabled ---
check('B1: NAVIGATE_LEVEL from a completely uninspected state pushes a level-only breadcrumb naming the level left', () => {
  let s = initExplorerViewState('PACKAGE');
  const next = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A'], batchSize: 12 });
  assert.deepEqual(next.history.map(h => [h.subjectId, h.kind, h.level]), [[null, null, 'PACKAGE']]);
  const back = explorerViewReducer(next, { type: 'NAVIGATE_BACK', eligibleIds: [] });
  assert.equal(back.activeLevel, 'PACKAGE', 'Back returns to Packages');
  assert.equal(back.inspectedSubjectId, null);
  assert.equal(back.history.length, 0);
});

check('B1: re-navigating to the already-active level (a no-op elsewhere) must not push a breadcrumb', () => {
  let s = initExplorerViewState('PACKAGE');
  const next = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'PACKAGE', eligibleIds: [], batchSize: 12 });
  assert.equal(next.history.length, 0);
});

check('B1: two level-only breadcrumbs at different levels do not collapse into one via the dedup guard', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A'], batchSize: 12 }); // pushes {null,null,PACKAGE}
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m'], batchSize: 12 }); // pushes {null,null,CLASS}
  assert.deepEqual(s.history.map(h => h.level), ['PACKAGE', 'CLASS'], 'both breadcrumbs survive -- they name different levels, so the dedup guard must not treat them as the same entry');
});

check('B1: once something is inspected, leaving that level pushes no extra breadcrumb (only the ordinary inspection entry applies)', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A'], batchSize: 12 }); // pushes {null,null,PACKAGE}
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'A' });
  const next = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'METHOD', eligibleIds: ['m'], batchSize: 12 });
  assert.equal(next.history.length, 1, 'NAVIGATE_LEVEL must never push while something is inspected -- that stays INSPECT_NODE/CLEAR_INSPECTION\'s job');
});

check('B1 mechanism: an inspected EDGE survives a level switch that clears it, recoverable via a single Back (App.tsx dispatches NAVIGATE_LEVEL then CLEAR_INSPECTION)', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'INSPECT_EDGE', id: 'e1' }); // inspected under PACKAGE
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['A'], batchSize: 12 }); // level changes; edge inspection untouched
  s = explorerViewReducer(s, { type: 'CLEAR_INSPECTION' }); // App.tsx's B2 fix: the aggregate edge cannot resolve at CLASS
  assert.equal(s.inspectedSubjectId, null);
  const back = explorerViewReducer(s, { type: 'NAVIGATE_BACK', eligibleIds: [] });
  assert.equal(back.inspectedSubjectId, 'e1');
  assert.equal(back.inspectedKind, 'EDGE');
  assert.equal(back.activeLevel, 'PACKAGE', 'one Back both undoes the level switch and restores the edge inspection');
});

check('EXPAND/COLLAPSE: expansions nest, apply make-room moves atomically, and collapse drops nested ones', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0', 'p1'], batchSize: Infinity, placement: { p0: { width: 280, height: 250, name: 'p0' }, p1: { width: 280, height: 250, name: 'p1' } } });
  const g = s.generation, p1Before = s.levelViews.PACKAGE.positions.p1;
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p0', ownerId: null, childPositions: { c0: { x: 1, y: 2 } }, generation: g, moves: { positions: { p1: { x: 999, y: p1Before.y } }, childPositions: {} } });
  assert.deepEqual(s.levelViews.PACKAGE.expansions.p0, { ownerId: null, childPositions: { c0: { x: 1, y: 2 } }, minSize: null });
  assert.equal(s.levelViews.PACKAGE.positions.p1.x, 999, 'the neighbor made room in the same dispatch');
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'c0', ownerId: 'p0', childPositions: { m0: { x: 3, y: 4 } }, generation: g });
  assert.ok(s.levelViews.PACKAGE.expansions.c0, 'a card inside an expanded card expands too');
  assert.equal(explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'zz', ownerId: 'nope', childPositions: {}, generation: g }), s, 'ignored when its owner is not expanded');
  assert.equal(explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p9', ownerId: null, childPositions: {}, generation: g }), s, 'ignored for a card not on the page');
  s = explorerViewReducer(s, { type: 'NODE_MOVED', level: 'PACKAGE', id: 'm0', containerId: 'c0', position: { x: 7, y: 8 }, generation: g });
  assert.deepEqual(s.levelViews.PACKAGE.expansions.c0.childPositions.m0, { x: 7, y: 8 }, 'a drag inside a container lands in its child positions');
  s = explorerViewReducer(s, { type: 'RESIZE_RESOURCE', level: 'PACKAGE', id: 'm0', containerId: 'c0', size: { width: 300, height: 200 }, position: { x: 30, y: 20 }, generation: g });
  assert.deepEqual(s.levelViews.PACKAGE.sizes.m0, { width: 300, height: 200 });
  s = explorerViewReducer(s, { type: 'COLLAPSE_RESOURCE', level: 'PACKAGE', id: 'p0', position: { x: 50, y: 60 }, generation: g });
  assert.deepEqual(Object.keys(s.levelViews.PACKAGE.expansions), [], 'collapsing the outer card drops the nested expansion too');
  assert.deepEqual(s.levelViews.PACKAGE.positions.p0, { x: 50, y: 60 });
  assert.deepEqual(s.levelViews.PACKAGE.sizes, {}, 'sizes of cards that are no longer shown go with them');
});

check('Expansions and sizes survive inspection and level switches, and leave with their card on a scope removal', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p0', 'p1'], batchSize: Infinity, placement: { p0: { width: 280, height: 250, name: 'p0' }, p1: { width: 280, height: 250, name: 'p1' } } });
  const g = s.generation;
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p0', ownerId: null, childPositions: { c0: { x: 1, y: 2 } }, generation: g });
  s = explorerViewReducer(s, { type: 'RESIZE_RESOURCE', level: 'PACKAGE', id: 'p1', containerId: null, size: { width: 400, height: 300 }, position: { x: 5, y: 5 }, generation: g });
  s = explorerViewReducer(s, { type: 'RESIZE_CONTAINER', level: 'PACKAGE', id: 'p0', minSize: { width: 900, height: 500 }, generation: g });
  assert.deepEqual(s.levelViews.PACKAGE.expansions.p0.minSize, { width: 900, height: 500 });
  const kept = s.levelViews.PACKAGE;
  s = explorerViewReducer(s, { type: 'INSPECT_NODE', id: 'p1' });
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'CLASS', eligibleIds: ['c0'], batchSize: 12 });
  s = explorerViewReducer(s, { type: 'NAVIGATE_LEVEL', level: 'PACKAGE', eligibleIds: ['p0', 'p1'], batchSize: Infinity });
  assert.deepEqual(s.levelViews.PACKAGE.expansions, kept.expansions);
  assert.deepEqual(s.levelViews.PACKAGE.sizes, kept.sizes);
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['p1'], batchSize: Infinity });
  assert.deepEqual(s.levelViews.PACKAGE.expansions, {}, 'removing p0 from scope drops its expansion');
  assert.deepEqual(Object.keys(s.levelViews.PACKAGE.sizes), ['p1']);
});

check('A child that leaves scope while its container stays takes its slot, nested expansion and size with it', () => {
  let s = initExplorerViewState('PACKAGE');
  s = explorerViewReducer(s, { type: 'RESET', level: 'PACKAGE', eligibleIds: ['p'], batchSize: Infinity });
  const g = s.generation;
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'p', ownerId: null, childPositions: { c: { x: 1, y: 2 }, d: { x: 3, y: 4 } }, generation: g });
  s = explorerViewReducer(s, { type: 'EXPAND_RESOURCE', level: 'PACKAGE', id: 'c', ownerId: 'p', childPositions: { m: { x: 5, y: 6 } }, generation: g });
  s = explorerViewReducer(s, { type: 'RESIZE_RESOURCE', level: 'PACKAGE', id: 'c', containerId: 'p', position: { x: 7, y: 8 }, size: { width: 400, height: 300 }, generation: g });
  const unchanged = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['p'], batchSize: Infinity, expansionChildren: { p: ['c', 'd'], c: ['m'] } });
  assert.equal(unchanged.levelViews.PACKAGE.expansions, s.levelViews.PACKAGE.expansions, 'nothing left scope: same object');
  s = explorerViewReducer(s, { type: 'SCOPE_UPDATED', eligibleIds: ['p'], batchSize: Infinity, expansionChildren: { p: ['d'], c: [] } });
  assert.deepEqual(s.levelViews.PACKAGE.expansions, { p: { ownerId: null, childPositions: { d: { x: 3, y: 4 } }, minSize: null } });
  assert.deepEqual(s.levelViews.PACKAGE.sizes, {});
});

console.log(`PASS: ${passCount} explorerViewState reducer checks (inspection/membership separation, append-only scope growth, show more, back navigation, reset, Step 3 geometry/camera, Step 4 inactive-level scope reconciliation and Back precedence, Step 5 focused arrangement, Step 5 review remediation A1/B1)`);
