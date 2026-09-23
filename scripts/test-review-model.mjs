import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const source = fs.readFileSync(new URL('../frontend/src/features/review/reviewModel.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { projectReviewNodes, projectReviewRelationships, projectReviewGraph, reviewSourceIdentityMaps, toReviewAtlasGraph } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

const node = (id, name, parentId) => ({ id, simpleName: name, qualifiedName: name, kind: parentId ? 'CLASS' : 'PACKAGE', ...(parentId ? { parentId } : {}) });
const review = {
  schemaVersion: '1', workspaceId: 'ws', base: { snapshotId: 'base', resolvedRef: 'origin/main' }, head: { snapshotId: 'head', ref: 'WORKING_TREE' },
  summary: { addedLines: 11, removedLines: 7, changedFiles: 2 },
  nodes: [
    { comparisonKey: 'pkg', change: 'UNCHANGED', addedLines: 0, removedLines: 0, base: node('bp', 'app'), head: node('hp', 'app') },
    { comparisonKey: 'hub', change: 'MODIFIED', addedLines: 8, removedLines: 3, base: node('bh', 'Hub', 'bp'), head: node('hh', 'Hub', 'hp') },
    { comparisonKey: 'old', change: 'REMOVED', addedLines: 0, removedLines: 4, base: node('bo', 'OldClient', 'bp') },
    { comparisonKey: 'new', change: 'ADDED', addedLines: 3, removedLines: 0, head: node('hn', 'NewClient', 'hp') }
  ],
  relationships: [
    { comparisonKey: 'stays', change: 'UNCHANGED', base: { id: 'br1', sourceId: 'bh', targetId: 'bo', kind: 'CALLS', resolution: 'RESOLVED' }, head: { id: 'hr1', sourceId: 'hh', targetId: 'hn', kind: 'CALLS', resolution: 'RESOLVED' } },
    { comparisonKey: 'gone', change: 'REMOVED', base: { id: 'br2', sourceId: 'bh', targetId: 'bo', kind: 'CALLS', resolution: 'RESOLVED' } },
    { comparisonKey: 'added', change: 'ADDED', head: { id: 'hr2', sourceId: 'hh', targetId: 'hn', kind: 'CALLS', resolution: 'RESOLVED' } },
    { comparisonKey: 'added-second-site', change: 'ADDED', head: { id: 'hr3', sourceId: 'hh', targetId: 'hn', kind: 'CALLS', resolution: 'RESOLVED' } }
  ]
};
assert.deepEqual(projectReviewNodes(review, 'BASE').map(x => x.node.id), ['bp', 'bh', 'bo']);
assert.deepEqual(projectReviewNodes(review, 'HEAD').map(x => x.node.id), ['hp', 'hh', 'hn']);
assert.equal(projectReviewNodes(review, 'OVERLAY').find(x => x.comparisonKey === 'old').snapshotId, 'base');
assert.equal(projectReviewRelationships(review, 'OVERLAY').find(x => x.comparisonKey === 'gone').snapshotId, 'base');
const overlay = projectReviewGraph(review, 'OVERLAY');
assert.equal(overlay.nodes.find(x => x.comparisonKey === 'hub').id, 'review-node:hub');
assert.equal(overlay.nodes.find(x => x.comparisonKey === 'hub').parentId, 'review-node:pkg');
assert.equal(overlay.sourceToDisplay.get('bh'), 'review-node:hub', 'base symbol IDs map to the shared display node');
assert.equal(overlay.sourceToDisplay.get('hh'), 'review-node:hub', 'head symbol IDs map to the shared display node');
assert.equal(overlay.edges.length, 4, 'every parser occurrence reaches the shared graph aggregator');
assert.ok(overlay.edges.some(x => x.change === 'REMOVED' && x.sourceId === 'review-node:hub' && x.targetId === 'review-node:old'), 'removed base edge remaps onto visible comparison nodes');
assert.ok(overlay.edges.some(x => x.change === 'ADDED' && x.sourceId === 'review-node:hub' && x.targetId === 'review-node:new'));
assert.equal(overlay.edges.filter(x => x.change === 'ADDED').length, 2, 'duplicate added occurrences retain both evidence IDs');
const overlayGraph = toReviewAtlasGraph('OVERLAY', overlay);
const identities = reviewSourceIdentityMaps(review, 'OVERLAY', overlay);
assert.equal(identities.symbols['review-node:hub'].id, 'hh', 'display nodes retain the selected side canonical ID');
assert.equal(identities.symbols['review-node:hub'].snapshotId, 'head', 'display nodes retain their source snapshot');
assert.equal(identities.displayBySymbolId.bh, 'review-node:hub');
assert.equal(identities.displayBySymbolId.hh, 'review-node:hub');
assert.equal(identities.relationships.hr2.id, 'hr2', 'raw added occurrence ID remains the source API identity');
assert.equal(overlayGraph.edges.find(x => x.id === 'hr2').sourceId, 'review-node:hub', 'graph endpoints use display IDs while occurrence identity stays raw');
const ordinary = { nodes: [node('op', 'app'), node('oh', 'Hub', 'op'), node('on', 'NewClient', 'op')], edges: [] };
const aligned = projectReviewGraph(review, 'OVERLAY', ordinary);
assert.equal(aligned.nodes.find(x => x.comparisonKey === 'pkg').id, 'op', 'unchanged package keeps the ordinary display ID');
assert.equal(aligned.nodes.find(x => x.comparisonKey === 'hub').id, 'oh', 'modified class keeps the ordinary display ID');
assert.equal(aligned.nodes.find(x => x.comparisonKey === 'new').id, 'on', 'head-only class aligns when the ordinary graph already contains it');
assert.equal(aligned.nodes.find(x => x.comparisonKey === 'old').id, 'review-node:old', 'base-only class retains a review identity');
assert.equal(aligned.sourceToDisplay.get('bh'), 'oh');
assert.equal(aligned.sourceToDisplay.get('hh'), 'oh');
assert.ok(aligned.edges.some(x => x.change === 'REMOVED' && x.sourceId === 'oh' && x.targetId === 'review-node:old'));
assert.ok(aligned.edges.some(x => x.change === 'ADDED' && x.sourceId === 'oh' && x.targetId === 'on'));
const alignedIdentity = reviewSourceIdentityMaps(review, 'OVERLAY', aligned);
assert.equal(alignedIdentity.symbols.oh.id, 'hh', 'aligned display IDs still resolve source calls to the head snapshot');
assert.equal(alignedIdentity.symbols.oh.snapshotId, 'head');
const displayOf = (comparison, graph, key) => projectReviewGraph(comparison, 'OVERLAY', graph).nodes.find(n => n.comparisonKey === key).id;
const duplicateOrdinary = { ...ordinary, nodes: [...ordinary.nodes, node('other-hub', 'Hub', 'op')] };
assert.equal(displayOf(review, duplicateOrdinary, 'hub'), 'review-node:hub', 'duplicate ordinary declarations must not be guessed');
const duplicateReview = { ...review, nodes: [...review.nodes, { comparisonKey: 'hub-copy', change: 'ADDED', head: node('hh2', 'Hub', 'hp') }] };
for (const rows of [duplicateReview.nodes, [...duplicateReview.nodes].reverse()]) {
  const comparison = { ...duplicateReview, nodes: rows };
  assert.equal(displayOf(comparison, ordinary, 'hub'), 'review-node:hub', 'duplicate review rows must not be matched by order');
  assert.equal(displayOf(comparison, ordinary, 'hub-copy'), 'review-node:hub-copy');
}
const duplicateParent = { ...ordinary, nodes: [...ordinary.nodes, node('other-pkg', 'app')] };
assert.equal(displayOf(review, duplicateParent, 'hub'), 'review-node:hub', 'a unique child of an ambiguous parent must not be falsely aligned');
assert.equal(displayOf({ ...review, nodes: [...review.nodes].reverse() }, ordinary, 'hub'), 'oh', 'parent alignment must not depend on row order');
const differentModule = { ...ordinary, nodes: ordinary.nodes.map(n => n.id === 'oh' ? { ...n, module: 'other' } : n) };
assert.equal(displayOf(review, differentModule, 'hub'), 'review-node:hub', 'declarations in different modules must not share geometry');
for (const mode of ['BASE', 'HEAD']) {
  const projection = projectReviewGraph(review, mode, ordinary);
  const identities = reviewSourceIdentityMaps(review, mode, projection);
  const included = mode === 'BASE' ? 'bh' : 'hh', excluded = mode === 'BASE' ? 'hh' : 'bh';
  assert.equal(identities.displayBySymbolId[included], 'review-node:hub');
  assert.equal(identities.displayBySymbolId[excluded], undefined, 'side-only projection must not expose the other side');
  assert.equal(projection.sourceToDisplay.has(excluded), false);
}
console.log('PASS: review base/head/overlay side selection, pinned snapshots, display remapping, and occurrence-preserving routes');
