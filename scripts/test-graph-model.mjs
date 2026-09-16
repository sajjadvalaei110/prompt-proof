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
const {projectGraph,projectDisplayed,childrenOf,wholeSystemScope,emptyScope,isClassInScope,getPackageCheckState,getPackageGroupCheckState,buildPackageHierarchy,togglePackages,togglePackage,toggleClass,scopeToLabel}=await import('data:text/javascript;base64,'+Buffer.from(combined).toString('base64'));

const nodes=[{id:'p1',kind:'PACKAGE',simpleName:'api'},{id:'p2',kind:'PACKAGE',simpleName:'service'}, {id:'a',kind:'CLASS',simpleName:'Controller',parentId:'p1'}, {id:'b',kind:'INTERFACE',simpleName:'Worker',parentId:'p2'}, {id:'a1',kind:'METHOD',simpleName:'handle',parentId:'a'}, {id:'b1',kind:'METHOD',simpleName:'work',parentId:'b'}, {id:'b2',kind:'METHOD',simpleName:'audit',parentId:'b'}];
const edges=[{id:'e1',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e2',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e3',sourceId:'a',targetId:'b',kind:'INJECTS',resolution:'CANDIDATE'},{id:'e4',sourceId:'b1',targetId:'b2',kind:'CALLS',resolution:'RESOLVED'},{id:'e5',sourceId:'a1',targetId:null,kind:'CALLS',resolution:'UNRESOLVED'}];
const graph={nodes,edges};
const ALL=wholeSystemScope();
const custom=(pkgs=[],cls=[])=>({mode:'CUSTOM',selectedPackageIds:new Set(pkgs),selectedClassIds:new Set(cls)});

for (const level of ['PACKAGE','CLASS']) {
 // One line per ordered pair: two CALLS plus one INJECTS between the same endpoints merge into one route.
 const view=projectGraph(graph,level,ALL,'ALL');assert.equal(view.nodes.length,2);assert.equal(view.edges.length,1);
 const route=view.edges[0];assert.deepEqual(route.occurrenceIds,['e1','e2','e3']);assert.deepEqual(route.occurrenceKinds,['CALLS','CALLS','INJECTS']);assert.equal(route.occurrenceCount,3);
 assert.equal(route.sourceId,level==='PACKAGE'?'p1':'a');assert.equal(route.targetId,level==='PACKAGE'?'p2':'b');
 assert.deepEqual(route.kindCounts,{CALLS:2,INJECTS:1});assert.equal(route.kind,'CALLS','dominant kind is representative');
 assert.equal(route.resolution,'CANDIDATE','least certain resolution present stays visible');assert.deepEqual(route.resolutions.sort(),['CANDIDATE','RESOLVED']);
 // Filtering keeps the same route identity and changes its strength; filtering every kind away removes it.
 const callsOnly=projectGraph(graph,level,ALL,'CALLS').edges;assert.equal(callsOnly.length,1);assert.equal(callsOnly[0].id,route.id);assert.equal(callsOnly[0].occurrenceCount,2);assert.equal(callsOnly[0].resolution,'RESOLVED');
 assert.ok(callsOnly[0].strengthWidth<route.strengthWidth,'fewer occurrences draw a thinner line');
 assert.equal(projectGraph(graph,level,ALL,'EXTENDS').edges.length,0);
}
// Reverse direction is its own route: A->B and B->A are exactly two lines, never more.
{
 const both={nodes,edges:[...edges,{id:'r1',sourceId:'b1',targetId:'a1',kind:'CALLS',resolution:'RESOLVED'},{id:'r2',sourceId:'b',targetId:'a',kind:'EXTENDS',resolution:'RESOLVED'}]};
 const view=projectGraph(both,'CLASS',ALL,'ALL');assert.equal(view.edges.length,2);
 const back=view.edges.find(e=>e.sourceId==='b');assert.equal(back.targetId,'a');assert.deepEqual(back.kindCounts,{CALLS:1,EXTENDS:1});
 assert.notEqual(back.id,view.edges.find(e=>e.sourceId==='a').id);
 // Method level keeps the same rule: b1 -> a1 and a1 -> b1 are separate, and the two a1 -> b1 calls merge.
 const methods=projectGraph(both,'METHOD',ALL,'ALL').edges.filter(e=>[e.sourceId,e.targetId].sort().join()==='a1,b1');assert.equal(methods.length,2);
 assert.equal(methods.find(e=>e.sourceId==='a1').occurrenceCount,2);
}
// Method scope: only methods owned by classes in the (package-level) scope, and only calls whose endpoints are both inside it.
const methodsInPkg=projectGraph(graph,'METHOD',custom(['p1']),'ALL');assert.deepEqual(new Set(methodsInPkg.nodes.map(n=>n.id)),new Set(['a1']));assert.equal(methodsInPkg.edges.length,0);
assert.equal(projectGraph(graph,'CLASS',ALL,'INJECTS').edges.length,1);
const limited=projectGraph(graph,'METHOD',ALL,'ALL',1);assert.equal(limited.nodes.length,1);assert.equal(limited.omittedCount,2);assert.equal(limited.scopedCount,3);assert.equal(limited.visibleCount,1);assert.ok(limited.edges.every(e=>limited.nodes.some(n=>n.id===e.sourceId)&&limited.nodes.some(n=>n.id===e.targetId)));
console.log('PASS: one route per ordered pair, kind breakdown, strength width, direction, occurrence counts, uncertainty, method neighbors, filters, and bounded views');

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
assert.equal(projectGraph(graph,'CLASS',mixedScope,'ALL').edges.length,1); // both a and b are the graph's only two classes, so this matches the ALL-scope case: CALLS + INJECTS merged into one a -> b route

// Empty scope: nothing selected renders nothing at any level, never falls back to the whole graph.
const empty=emptyScope();
assert.equal(projectGraph(graph,'PACKAGE',empty,'ALL').nodes.length,0);
assert.equal(projectGraph(graph,'CLASS',empty,'ALL').nodes.length,0);
assert.equal(projectGraph(graph,'METHOD',empty,'ALL').edges.length,0);

// All-selected (mode ALL) scope: identical to no scope restriction at all.
assert.equal(projectGraph(graph,'PACKAGE',ALL,'ALL').nodes.length,2);
assert.equal(getPackageCheckState({id:'p1'},ALL,graph),'checked');
console.log('PASS: package, class, method, mixed-package, empty, and all-selected scope projections');

// Expansion (details): a package expanded in place shows its types, whose routes resolve to the
// deepest visible card on each endpoint's own chain; unexpanded cards still collect their routes.
{
  const noExp=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL');
  const emptyExp=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[],scope:ALL});
  assert.deepEqual(emptyExp,noExp,'no expansions is exactly the plain projection, edge IDs included');
  const p1=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'p1',ownerId:null}],scope:ALL});
  assert.deepEqual(p1.nodes.map(n=>[n.id,n.containerId||null,!!n.expanded]),[['p1',null,true],['a','p1',false],['p2',null,false]]);
  // The class inside the expanded package is the deepest visible source card; p2 stays collapsed as
  // the target. Both the method calls (e1,e2) and the class-level INJECTS (e3) resolve to that same
  // ordered pair, so one-route-per-pair merges them: one line, CALLS dominant, INJECTS in the breakdown.
  assert.equal(p1.edges.length,1);
  const calls=p1.edges[0];assert.equal(calls.sourceId,'a');assert.equal(calls.targetId,'p2');
  assert.deepEqual(calls.occurrenceIds,['e1','e2','e3']);assert.equal(calls.kind,'CALLS');
  assert.deepEqual(calls.kindCounts,{CALLS:2,INJECTS:1},'the class-level INJECTS resolves to the same expanded card and joins the route');
  // Nested: the class inside the expanded package expands too, and the other package expands into its interface.
  const nested=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'p1',ownerId:null},{id:'a',ownerId:'p1'},{id:'p2',ownerId:null}],scope:ALL});
  assert.deepEqual(nested.nodes.map(n=>n.id),['p1','a','a1','p2','b']);
  assert.equal(nested.nodes.find(n=>n.id==='a1').containerId,'a');
  const nestedCalls=nested.edges.find(e=>e.kind==='CALLS'&&e.sourceId==='a1');assert.equal(nestedCalls.targetId,'b');
  // b1 -> b2 is inside the collapsed interface b: a class using itself is not drawn.
  assert.ok(!nested.edges.some(e=>e.sourceId===e.targetId),'no self routes at package/class resolution');
  // An expansion is honored only where it really sits: a nested one whose owner is not expanded is ignored.
  const orphan=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'a',ownerId:'p1'}],scope:ALL});
  assert.deepEqual(orphan.nodes.map(n=>n.id),['p1','p2']);
  // A route between a card and its own container is not drawn (INJECTS a -> b with b expanded: a is outside, so it stays; b1 -> b2 are siblings inside b and do draw).
  const cls=projectDisplayed(graph,'CLASS',['a','b'],'ALL',{expansions:[{id:'b',ownerId:null}],scope:ALL});
  assert.deepEqual(cls.nodes.map(n=>n.id),['a','b','b2','b1'],'methods inside a type are name-ordered');
  assert.ok(cls.edges.some(e=>e.sourceId==='b1'&&e.targetId==='b2'),'sibling methods inside an expanded type connect');
  assert.ok(cls.edges.some(e=>e.sourceId==='a'&&e.targetId==='b1'),'a collapsed class routes to the method inside the expanded one');
  assert.ok(cls.edges.some(e=>e.sourceId==='a'&&e.targetId==='b'&&e.kind==='INJECTS'),'a type-level route still ends at the container');
  // The details count matches what expanding shows: a type holding only a nested type has none.
  const nestedOnly={nodes:[...nodes,{id:'k',kind:'CLASS',simpleName:'Constants',parentId:'p1'},{id:'k1',kind:'ENUM',simpleName:'Kind',parentId:'k'}],edges:[]};
  const nk=projectDisplayed(nestedOnly,'CLASS',['k','a'],'ALL');
  assert.deepEqual(nk.nodes.map(n=>[n.id,n.memberCount,n.detailCount]),[['k',1,0],['a',1,1]]);
  assert.deepEqual(childrenOf(nestedOnly,nestedOnly.nodes.find(n=>n.id==='k'),ALL),[]);
  // A package's detail count matches childrenOf exactly, nested types included (F-08): p1 owns
  // Controller, Constants, and Constants' nested Kind, all three shown side by side on expand.
  assert.equal(projectDisplayed(nestedOnly,'PACKAGE',['p1'],'ALL').nodes[0].detailCount,3);
  assert.deepEqual(childrenOf(nestedOnly,nestedOnly.nodes.find(n=>n.id==='p1'),ALL).map(n=>n.id),['k','a','k1'],'name-ordered: Constants, Controller, Kind');
  // Un-scoped detail count is a silent no-op waiting to happen (F-09): scoping p1 down to just its
  // class Controller (not Constants/Kind) must drop the count to 1, matching what actually expands.
  assert.equal(projectDisplayed(nestedOnly,'PACKAGE',['p1'],'ALL',{expansions:[],scope:custom([],['a'])}).nodes[0].detailCount,1);
  // Scope applies to a package's children; METHOD pages never expand.
  assert.deepEqual(childrenOf(graph,nodes[0],custom([],['b'])).map(n=>n.id),[]);
  assert.deepEqual(projectDisplayed(graph,'METHOD',['a1'],'ALL',{expansions:[{id:'a1',ownerId:null}],scope:ALL}).nodes.map(n=>!!n.expanded),[false]);
}
console.log('PASS: in-place expansion projection (children, nested expansions, deepest-visible route resolution, container/self routes, scope)');

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

// Dotted package names are backend facts with no parent links. The client builds visual
// namespaces and derives each synthetic checkbox from all real package descendants.
const hierarchyGraph={nodes:[
 {id:'p-root',kind:'PACKAGE',simpleName:'com.example',qualifiedName:'com.example'},
 {id:'p-orders',kind:'PACKAGE',simpleName:'com.example.orders',qualifiedName:'com.example.orders'},
 {id:'p-web',kind:'PACKAGE',simpleName:'com.example.orders.web',qualifiedName:'com.example.orders.web'},
 {id:'p-billing',kind:'PACKAGE',simpleName:'com.example.billing',qualifiedName:'com.example.billing'},
 {id:'root-class',kind:'CLASS',simpleName:'RootType',parentId:'p-root'},
 {id:'orders-class',kind:'CLASS',simpleName:'OrderService',parentId:'p-orders'},
 {id:'web-class',kind:'CLASS',simpleName:'OrderController',parentId:'p-web'},
 {id:'billing-class',kind:'CLASS',simpleName:'Invoice',parentId:'p-billing'}
],edges:[]};
const hierarchy=buildPackageHierarchy(hierarchyGraph);
assert.equal(hierarchy.length,1);assert.equal(hierarchy[0].name,'com');assert.equal(hierarchy[0].packageNode,undefined);
const example=hierarchy[0].children[0];assert.equal(example.qualifiedName,'com.example');assert.equal(example.packageNode.id,'p-root');
assert.deepEqual(example.children.map(child=>child.name),['billing','orders']);
const orders=example.children.find(child=>child.name==='orders');assert.deepEqual(orders.packageIds,['p-orders','p-web']);assert.equal(orders.children[0].name,'web');
assert.equal(getPackageGroupCheckState(hierarchy[0].packageIds,ALL,hierarchyGraph),'checked');
const webOnly=custom([],['web-class']);
assert.equal(getPackageGroupCheckState(orders.packageIds,webOnly,hierarchyGraph),'indeterminate');
assert.equal(getPackageGroupCheckState(example.children.find(child=>child.name==='billing').packageIds,webOnly,hierarchyGraph),'unchecked');
const selectedNamespace=togglePackages(emptyScope(),orders.packageIds,hierarchyGraph);
assert.deepEqual(selectedNamespace.selectedPackageIds,new Set(['p-orders','p-web']));
assert.equal(togglePackages(emptyScope(),hierarchy[0].packageIds,hierarchyGraph).mode,'ALL');
const removedNamespace=togglePackages(ALL,orders.packageIds,hierarchyGraph);
assert.ok(!removedNamespace.selectedPackageIds.has('p-orders'));assert.ok(!removedNamespace.selectedPackageIds.has('p-web'));assert.ok(removedNamespace.selectedPackageIds.has('p-root'));assert.ok(removedNamespace.selectedPackageIds.has('p-billing'));
const clearedPartialNamespace=togglePackages(webOnly,orders.packageIds,hierarchyGraph);
assert.equal(getPackageGroupCheckState(orders.packageIds,clearedPartialNamespace,hierarchyGraph),'unchecked');
console.log('PASS: dotted package trie, synthetic namespace aggregate state, and batch package toggles');

// A merged line is READY when any underlying occurrence has a ready explanation (explanations are
// per occurrence; requiring all of them would leave a CALLS + derived DEPENDS_ON line never badged).
const mixed={nodes,edges:edges.map(e=>({...e,explanationStatus:e.id==='e3'?'READY':'NOT_REQUESTED'}))};
assert.equal(projectGraph(mixed,'CLASS',ALL,'ALL').edges[0].explanationStatus,'READY','one ready occurrence of any kind badges the line');
assert.notEqual(projectGraph(mixed,'CLASS',ALL,'CALLS').edges[0].explanationStatus,'READY','filtering the ready occurrence away removes the badge');
const stale={nodes,edges:edges.map(e=>({...e,explanationStatus:'STALE'}))};
assert.equal(projectGraph(stale,'CLASS',ALL,'ALL').edges[0].explanationStatus,'STALE','a uniform non-ready status is kept');
stale.edges[1].explanationStatus='QUEUED';
assert.equal(projectGraph(stale,'CLASS',ALL,'ALL').edges[0].explanationStatus,'STALE','among non-ready statuses the least settled one wins, never a fallback that hides it');
// A failure must never be masked by an unrequested sibling occurrence (AGENTS.md: keep failed
// explanations visible). FAILED outranks STALE, QUEUED and NOT_REQUESTED; READY still outranks all.
const failed={nodes,edges:edges.map(e=>({...e,explanationStatus:e.id==='e1'?'FAILED':'NOT_REQUESTED'}))};
assert.equal(projectGraph(failed,'CLASS',ALL,'ALL').edges[0].explanationStatus,'FAILED','one failed occurrence keeps the line marked failed');
failed.edges[1].explanationStatus='STALE';
assert.equal(projectGraph(failed,'CLASS',ALL,'ALL').edges[0].explanationStatus,'FAILED','failed outranks stale');
failed.edges[2].explanationStatus='READY';
assert.equal(projectGraph(failed,'CLASS',ALL,'ALL').edges[0].explanationStatus,'READY','a ready occurrence still badges the line');
const cardCompiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/nodeCard.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {nodeCard}=await import('data:text/javascript;base64,'+Buffer.from(cardCompiled).toString('base64'));
for(const kind of ['CLASS','METHOD']){
 const node={id:'n',kind,simpleName:'<script>&unsafe'};
 const svg=decodeURIComponent(nodeCard({...node,explanationStatus:'READY'}).image);
 assert.ok(svg.includes('id="sparkle"'));assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));
 assert.ok(!decodeURIComponent(nodeCard({...node,explanationStatus:'STALE'}).image).includes('id="sparkle"'));
}
console.log('PASS: READY aggregation, stale badge removal, escaped class/method sparkle cards');

// Exercise the shared polling module with a deterministic scheduler: no timer is
// scheduled while a request is unresolved, and stop prevents a late response from
// updating state or scheduling another request.
const pollingCompiled=compile('../frontend/src/utils/serialPolling.ts');
const {startSerialPolling}=await import('data:text/javascript;base64,'+Buffer.from(pollingCompiled).toString('base64'));
let resolveFirst,resolveSecond,activeRequests=0,maxRequests=0,updates=0;
const pending=[new Promise(resolve=>{resolveFirst=resolve}),new Promise(resolve=>{resolveSecond=resolve})];
const scheduled=[];
const stop=startSerialPolling({
 load:()=>{activeRequests++;maxRequests=Math.max(maxRequests,activeRequests);return pending.shift().finally(()=>activeRequests--);},
 onValue:()=>updates++,shouldContinue:value=>value.active,intervalMs:2000,
 schedule:callback=>{scheduled.push(callback);return scheduled.length;},cancel:()=>{}
});
await Promise.resolve();assert.equal(maxRequests,1);assert.equal(scheduled.length,0);
resolveFirst({active:true});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(updates,1);assert.equal(scheduled.length,1);
scheduled.shift()();await Promise.resolve();assert.equal(maxRequests,1);stop();resolveSecond({active:true});await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(updates,1);assert.equal(scheduled.length,0);
console.log('PASS: queue/inspector polling is non-overlapping and stops when inactive');
