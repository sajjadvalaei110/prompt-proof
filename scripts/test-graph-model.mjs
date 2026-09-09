import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
// graphModel.ts and scopeModel.ts import each other at runtime (a real bundler resolves this fine;
// this zero-dependency script has no module resolver for data: URLs, so combine both compiled
// outputs into one module and strip their now-redundant relative imports of each other.
const stripLocalImport=(src,name)=>src.replace(new RegExp(`import \\{[^}]*\\} from ['"]\\./${name}['"];?\n?`),'');
const scopeCompiled=stripLocalImport(compile('../frontend/src/features/explorer/scopeModel.ts'),'graphModel');
const graphCompiled=stripLocalImport(compile('../frontend/src/features/explorer/graphModel.ts'),'scopeModel');
const combined=scopeCompiled+'\n'+graphCompiled;
const {projectGraph,wholeSystemScope,emptyScope,isClassInScope,getPackageCheckState,togglePackage,toggleClass,scopeToLabel}=await import('data:text/javascript;base64,'+Buffer.from(combined).toString('base64'));

const nodes=[{id:'p1',kind:'PACKAGE',simpleName:'api'},{id:'p2',kind:'PACKAGE',simpleName:'service'}, {id:'a',kind:'CLASS',simpleName:'Controller',parentId:'p1'}, {id:'b',kind:'INTERFACE',simpleName:'Worker',parentId:'p2'}, {id:'a1',kind:'METHOD',simpleName:'handle',parentId:'a'}, {id:'b1',kind:'METHOD',simpleName:'work',parentId:'b'}, {id:'b2',kind:'METHOD',simpleName:'audit',parentId:'b'}];
const edges=[{id:'e1',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e2',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e3',sourceId:'a',targetId:'b',kind:'INJECTS',resolution:'CANDIDATE'},{id:'e4',sourceId:'b1',targetId:'b2',kind:'CALLS',resolution:'RESOLVED'},{id:'e5',sourceId:'a1',targetId:null,kind:'CALLS',resolution:'UNRESOLVED'}];
const graph={nodes,edges};
const ALL=wholeSystemScope();
const custom=(pkgs=[],cls=[])=>({mode:'CUSTOM',selectedPackageIds:new Set(pkgs),selectedClassIds:new Set(cls)});

for (const level of ['PACKAGE','CLASS']) {
 const view=projectGraph(graph,level,ALL,'ALL');assert.equal(view.nodes.length,2);assert.equal(view.edges.length,2);
 const calls=view.edges.find(e=>e.kind==='CALLS');assert.deepEqual(calls.occurrenceIds,['e1','e2']);assert.equal(calls.occurrenceCount,2);assert.equal(calls.sourceId,level==='PACKAGE'?'p1':'a');assert.equal(calls.targetId,level==='PACKAGE'?'p2':'b');assert.equal(view.edges.find(e=>e.kind==='INJECTS').resolution,'CANDIDATE');
}
// Method scope: only methods owned by classes in the (package-level) scope, and only calls whose endpoints are both inside it.
const methodsInPkg=projectGraph(graph,'METHOD',custom(['p1']),'ALL');assert.deepEqual(new Set(methodsInPkg.nodes.map(n=>n.id)),new Set(['a1']));assert.equal(methodsInPkg.edges.length,0);
assert.equal(projectGraph(graph,'CLASS',ALL,'INJECTS').edges.length,1);
const limited=projectGraph(graph,'METHOD',ALL,'ALL',1);assert.equal(limited.nodes.length,1);assert.equal(limited.omittedCount,2);assert.equal(limited.scopedCount,3);assert.equal(limited.visibleCount,1);assert.ok(limited.edges.every(e=>limited.nodes.some(n=>n.id===e.sourceId)&&limited.nodes.some(n=>n.id===e.targetId)));
console.log('PASS: package/class aggregation, direction, occurrence counts, uncertainty, method neighbors, filters, and bounded views');

// Package scope: PACKAGE level shows only the selected package; its class and methods are the only ones in scope at any level.
const pkgScope=custom(['p1']);
assert.deepEqual(projectGraph(graph,'PACKAGE',pkgScope,'ALL').nodes.map(n=>n.id),['p1']);
assert.deepEqual(projectGraph(graph,'CLASS',pkgScope,'ALL').nodes.map(n=>n.id),['a']);
assert.deepEqual(projectGraph(graph,'METHOD',pkgScope,'ALL').nodes.map(n=>n.id),['a1']);

// Class scope: selecting a class directly (no package selection) scopes exactly that class and its methods.
const classScope=custom([],['b']);
assert.deepEqual(projectGraph(graph,'CLASS',classScope,'ALL').nodes.map(n=>n.id),['b']);
assert.deepEqual(new Set(projectGraph(graph,'METHOD',classScope,'ALL').nodes.map(n=>n.id)),new Set(['b1','b2']));
// Both endpoints (b1 -> b2) are inside the selected class, so that call is preserved; the cross-class a1 -> b1 edge is not (a1 is out of scope).
assert.equal(projectGraph(graph,'METHOD',classScope,'ALL').edges.length,1);
assert.equal(projectGraph(graph,'METHOD',classScope,'ALL').edges[0].sourceId,'b1');

// Mixed scope: one whole package plus one explicit class from a different package.
const mixedScope=custom(['p1'],['b']);
assert.deepEqual(new Set(projectGraph(graph,'CLASS',mixedScope,'ALL').nodes.map(n=>n.id)),new Set(['a','b']));
assert.equal(projectGraph(graph,'CLASS',mixedScope,'ALL').edges.length,2); // both a and b are the graph's only two classes, so this matches the ALL-scope case: CALLS (aggregated) + INJECTS

// Empty scope: nothing selected renders nothing at any level, never falls back to the whole graph.
const empty=emptyScope();
assert.equal(projectGraph(graph,'PACKAGE',empty,'ALL').nodes.length,0);
assert.equal(projectGraph(graph,'CLASS',empty,'ALL').nodes.length,0);
assert.equal(projectGraph(graph,'METHOD',empty,'ALL').edges.length,0);

// All-selected (mode ALL) scope: identical to no scope restriction at all.
assert.equal(projectGraph(graph,'PACKAGE',ALL,'ALL').nodes.length,2);
assert.equal(getPackageCheckState({id:'p1'},ALL,graph),'checked');
console.log('PASS: package, class, method, mixed-package, empty, and all-selected scope projections');

// Never expand a focused seed into out-of-scope neighbors: scoping to just p1's class must not pull in p2/b.
const focused=projectGraph(graph,'CLASS',custom([],['a']),'ALL');
assert.equal(focused.nodes.length,1);assert.equal(focused.edges.length,0);
console.log('PASS: no hidden neighborhood expansion outside the selected scope');

// Pure scope helpers: tri-state package checkboxes and immutable toggles.
assert.equal(getPackageCheckState({id:'p2'},custom([],['b']),graph),'checked');
assert.equal(getPackageCheckState({id:'p2'},empty,graph),'unchecked');
assert.equal(isClassInScope({id:'b',parentId:'p2'},custom(['p2']),graph),true);
const checkedAll=togglePackage(ALL,{id:'p1'},graph);
assert.equal(checkedAll.mode,'CUSTOM');assert.ok(!checkedAll.selectedPackageIds.has('p1'));assert.ok(checkedAll.selectedPackageIds.has('p2'));
const splitOne=toggleClass(ALL,{id:'a',parentId:'p1'},graph);
assert.equal(splitOne.mode,'CUSTOM');assert.ok(!splitOne.selectedPackageIds.has('p1'));assert.ok(!splitOne.selectedClassIds.has('a'));assert.ok(splitOne.selectedPackageIds.has('p2'));
assert.ok(scopeToLabel(graph,ALL).startsWith('Whole system'));
assert.ok(scopeToLabel(graph,empty).includes('No packages or classes selected'));
console.log('PASS: scope helper toggles are immutable and materialize ALL mode correctly on first edit');

// A grouped edge is READY only when every underlying occurrence is READY.
const mixed={nodes,edges:edges.map(e=>({...e,explanationStatus:e.id==='e1'?'READY':'NOT_REQUESTED'}))};
assert.notEqual(projectGraph(mixed,'CLASS',ALL,'CALLS').edges[0].explanationStatus,'READY');
const ready={nodes,edges:edges.map(e=>({...e,explanationStatus:'READY'}))};
assert.equal(projectGraph(ready,'CLASS',ALL,'CALLS').edges[0].explanationStatus,'READY');
ready.edges[1].explanationStatus='STALE';
assert.notEqual(projectGraph(ready,'CLASS',ALL,'CALLS').edges[0].explanationStatus,'READY');
const cardCompiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/nodeCard.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {nodeCard}=await import('data:text/javascript;base64,'+Buffer.from(cardCompiled).toString('base64'));
for(const kind of ['CLASS','METHOD']){
 const node={id:'n',kind,simpleName:'<script>&unsafe'};
 const svg=decodeURIComponent(nodeCard({...node,explanationStatus:'READY'}).image);
 assert.ok(svg.includes('id="sparkle"'));assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));
 assert.ok(!decodeURIComponent(nodeCard({...node,explanationStatus:'STALE'}).image).includes('id="sparkle"'));
}
console.log('PASS: READY aggregation, stale badge removal, escaped class/method sparkle cards');
