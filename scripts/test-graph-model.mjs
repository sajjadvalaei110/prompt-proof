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
const {projectGraph,projectDisplayed,childrenOf,wholeSystemScope,emptyScope,isClassInScope,getPackageCheckState,getPackageGroupCheckState,buildPackageHierarchy,togglePackages,togglePackage,toggleClass,scopeToLabel,EXPLANATION_RANK,explanationRank,dominantOccurrenceIndex,kindSummary,sortedKindCounts,routeReviewChange,revealContainers}=await import('data:text/javascript;base64,'+Buffer.from(combined).toString('base64'));

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
// USES_TYPE is a first-class extracted kind (JavaParserAdapter emits it, and a DEPENDS_ON is derived
// from type usage as well as from calls), so it must aggregate, count, label and filter exactly like
// any other kind. Scoped to a local fixture so no expectation above moves.
{
 const typed={nodes,edges:[...edges,
  {id:'u1',sourceId:'a1',targetId:'b1',kind:'USES_TYPE',resolution:'RESOLVED'},
  {id:'u2',sourceId:'a1',targetId:'b1',kind:'USES_TYPE',resolution:'RESOLVED'},
  {id:'u3',sourceId:'a',targetId:'b',kind:'USES_TYPE',resolution:'RESOLVED'},
  {id:'d1',sourceId:'a',targetId:'b',kind:'DEPENDS_ON',resolution:'RESOLVED'}]};
 for(const level of ['PACKAGE','CLASS']){
  // All of it still merges into the single route for the ordered pair, USES_TYPE occurrences included.
  const route=projectGraph(typed,level,ALL,'ALL').edges[0];
  assert.deepEqual(route.occurrenceIds,['e1','e2','e3','u1','u2','u3','d1'],'USES_TYPE occurrences join the route for their ordered pair');
  assert.deepEqual(route.occurrenceKinds,['CALLS','CALLS','INJECTS','USES_TYPE','USES_TYPE','USES_TYPE','DEPENDS_ON']);
  assert.equal(route.occurrenceCount,7);
  assert.deepEqual(route.kindCounts,{CALLS:2,INJECTS:1,USES_TYPE:3,DEPENDS_ON:1},'USES_TYPE is counted in the kind breakdown');
  assert.equal(route.kind,'USES_TYPE','the dominant kind is the most frequent one, USES_TYPE included');
  // Descending count, ties by name: uses type ×3, then calls ×2, then depends on, injects.
  assert.deepEqual(sortedKindCounts(route),[['USES_TYPE',3],['CALLS',2],['DEPENDS_ON',1],['INJECTS',1]]);
  assert.equal(kindSummary(route),'uses type ×3 · calls ×2 · depends on · injects','USES_TYPE formats as "uses type", underscore split and count suffix included');
  assert.equal(kindSummary(route,2),'uses type ×3 · calls ×2 · +2','the capped label keeps USES_TYPE first and tails the rest');
 }
 // Filtering to USES_TYPE keeps the same route identity (endpoint-only key) and thins it to its
 // USES_TYPE occurrences only; the pair still has a line because it carries that kind.
 const full=projectGraph(typed,'CLASS',ALL,'ALL').edges[0];
 const usesOnly=projectGraph(typed,'CLASS',ALL,'USES_TYPE').edges;
 assert.equal(usesOnly.length,1);
 assert.equal(usesOnly[0].id,full.id,'a filter change keeps the route ID');
 assert.equal(usesOnly[0].occurrenceCount,3);
 assert.deepEqual(usesOnly[0].occurrenceIds,['u1','u2','u3']);
 assert.deepEqual(usesOnly[0].kindCounts,{USES_TYPE:3});
 assert.equal(kindSummary(usesOnly[0]),'uses type ×3');
 assert.ok(usesOnly[0].strengthWidth<full.strengthWidth,'filtering to one kind draws a thinner line');
 // Filtering USES_TYPE away leaves the other kinds untouched, and a pair whose only kind is
 // USES_TYPE disappears entirely rather than being drawn empty.
 assert.deepEqual(projectGraph(typed,'CLASS',ALL,'CALLS').edges[0].kindCounts,{CALLS:2});
 const onlyUses={nodes,edges:[{id:'x1',sourceId:'a',targetId:'b',kind:'USES_TYPE',resolution:'RESOLVED'}]};
 assert.equal(projectGraph(onlyUses,'CLASS',ALL,'USES_TYPE').edges.length,1);
 assert.equal(projectGraph(onlyUses,'CLASS',ALL,'CALLS').edges.length,0,'filtering away the only kind removes the route');
 // Expansion resolves a USES_TYPE occurrence to the deepest visible card, same as any other kind.
 const exp=projectDisplayed(typed,'PACKAGE',['p1','p2'],'USES_TYPE',{expansions:[{id:'p1',ownerId:null}],scope:ALL});
 assert.equal(exp.edges.length,1);
 assert.equal(exp.edges[0].sourceId,'a');assert.equal(exp.edges[0].targetId,'p2');
 assert.deepEqual(exp.edges[0].kindCounts,{USES_TYPE:3},'the method-level and class-level USES_TYPE both resolve onto the expanded card');
 // A USES_TYPE occurrence carries explanation status like any other: a running one is not masked.
 const typedStatus={nodes,edges:typed.edges.map(e=>({...e,explanationStatus:e.id==='u1'?'RUNNING':'NOT_REQUESTED'}))};
 assert.equal(projectGraph(typedStatus,'CLASS',ALL,'ALL').edges[0].explanationStatus,'RUNNING');
}
console.log('PASS: USES_TYPE aggregation, kind counts, label formatting, filtering, and expansion resolution');

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
// An in-flight run must not be clobbered by an unrequested or queued sibling. The backend emits
// RUNNING for an actively generating explanation (GraphQueryService maps the queue's 'IN_PROGRESS'
// to 'RUNNING'); when RUNNING was missing from EXPLANATION_RANK it ranked 0 and tied with
// NOT_REQUESTED, so the aggregate reported the line as never requested.
const running={nodes,edges:edges.map(e=>({...e,explanationStatus:e.id==='e1'?'RUNNING':'NOT_REQUESTED'}))};
assert.equal(projectGraph(running,'CLASS',ALL,'ALL').edges[0].explanationStatus,'RUNNING','one running occurrence keeps the line marked running, never clobbered by an unrequested sibling');
running.edges[1].explanationStatus='QUEUED';
assert.equal(projectGraph(running,'CLASS',ALL,'ALL').edges[0].explanationStatus,'RUNNING','running outranks queued: an in-flight job is never demoted back to queued');
running.edges[1].explanationStatus='STALE';
assert.equal(projectGraph(running,'CLASS',ALL,'ALL').edges[0].explanationStatus,'RUNNING','running outranks stale: the run in flight is what replaces the stale text');
running.edges[1].explanationStatus='FAILED';
assert.equal(projectGraph(running,'CLASS',ALL,'ALL').edges[0].explanationStatus,'FAILED','failed still outranks running, so a failure is never masked');
running.edges[1].explanationStatus='READY';
assert.equal(projectGraph(running,'CLASS',ALL,'ALL').edges[0].explanationStatus,'READY','ready still outranks everything');

// Guard for the *bug class*, not just the RUNNING instance: every status in the canonical
// `ExplanationStatus` union must have an explicit EXPLANATION_RANK entry, so a status added to the
// union later cannot silently rank 0 and be masked by an unrequested sibling. The union is a pure
// type declaration (it compiles to nothing), so it is sourced as text from the canonical file:
//   frontend/src/types/index.ts   -- the union itself
//   src/main/java/dev/codeatlas/graph/GraphQueryService.java -- what the backend actually emits
const typesSource=fs.readFileSync(new URL('../frontend/src/types/index.ts',import.meta.url),'utf8');
const unionMatch=/export type ExplanationStatus\s*=\s*([^;]+);/.exec(typesSource);
assert.ok(unionMatch,'ExplanationStatus union found in frontend/src/types/index.ts (if this fails the guard below would pass vacuously)');
const canonicalStatuses=[...unionMatch[1].matchAll(/'([A-Z_]+)'/g)].map(m=>m[1]);
assert.ok(canonicalStatuses.length>=7,`extracted at least the 7 known statuses, saw ${canonicalStatuses.length}: ${canonicalStatuses}`);
assert.ok(canonicalStatuses.includes('RUNNING')&&canonicalStatuses.includes('NOT_REQUESTED'),'the extracted list is ExplanationStatus, not some neighbouring union');
for(const status of canonicalStatuses){
  assert.ok(Object.prototype.hasOwnProperty.call(EXPLANATION_RANK,status),`EXPLANATION_RANK has an explicit entry for '${status}' -- without one it falls through to 0 and is masked by NOT_REQUESTED`);
  if(status!=='NOT_REQUESTED') assert.ok(explanationRank(status)>0,`'${status}' ranks above NOT_REQUESTED`);
}
// The invariants the rest of the table is built on, asserted directly rather than implied.
assert.ok(canonicalStatuses.every(s=>s==='READY'||explanationRank('READY')>explanationRank(s)),'READY stays the highest rank');
assert.ok(canonicalStatuses.every(s=>['READY','FAILED'].includes(s)||explanationRank('FAILED')>explanationRank(s)),'FAILED stays above every non-ready status');
assert.equal(explanationRank('PENDING'),explanationRank('QUEUED'),'PENDING ranks with QUEUED, the status the backend maps it to');
assert.equal(explanationRank('NO_SUCH_STATUS'),0,'a status not in the union still falls back to 0');

// Inspector occurrence choice shares this rank (dominantOccurrenceIndex), so opening a line never
// hides a FAILED occurrence behind an unrequested sibling at index 0.
const occ=id=>({id,sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'});
const occGraph=statuses=>({nodes,edges:statuses.map((s,i)=>({...occ('o'+i),explanationStatus:s}))});
const occEdge=statuses=>({id:'agg',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED',occurrenceIds:statuses.map((_,i)=>'o'+i)});
const pick=statuses=>dominantOccurrenceIndex(occEdge(statuses),occGraph(statuses));
assert.equal(pick(['NOT_REQUESTED','FAILED']),1,'a FAILED occurrence is opened, not the unrequested sibling at index 0');
assert.equal(pick(['NOT_REQUESTED','RUNNING']),1,'a RUNNING occurrence is opened, not the unrequested sibling at index 0');
assert.equal(pick(['NOT_REQUESTED','FAILED','READY']),2,'READY still wins, matching the line badge');
assert.equal(pick(['QUEUED','STALE','FAILED']),2,'the highest-ranked occurrence wins across several non-ready statuses');
assert.equal(pick(['NOT_REQUESTED','NOT_REQUESTED']),0,'an all-equal line opens on the first occurrence, as before');
assert.equal(pick(['READY','READY']),0,'ties resolve to the earliest occurrence, so a stable line keeps its first-occurrence default');
assert.equal(dominantOccurrenceIndex(null,graph),0,'no edge falls back to index 0');
assert.equal(dominantOccurrenceIndex({id:'x',occurrenceIds:[]},graph),0,'an empty occurrence list falls back to index 0');
const paletteSource=fs.readFileSync(new URL('../frontend/src/features/review/reviewPalette.ts',import.meta.url),'utf8');
const cardSource=fs.readFileSync(new URL('../frontend/src/features/explorer/nodeCard.ts',import.meta.url),'utf8').replace("import { REVIEW_CHANGE_PALETTE } from '../review/reviewPalette';",'');
const cardCompiled=ts.transpileModule(`${paletteSource}\n${cardSource}`,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
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

// Review overlay: added, removed, unknown and unchanged routes between the same two cards stay
// separate lines -- the aggregate key carries reviewChange, so a removed route can never be
// cancelled out by an unchanged one that happens to share its endpoints.
const reviewGraph={nodes:[
 {id:'ra',simpleName:'A',kind:'CLASS',parentId:'rp1'},{id:'rb',simpleName:'B',kind:'CLASS',parentId:'rp2'},
 {id:'rp1',simpleName:'p1',kind:'PACKAGE'},{id:'rp2',simpleName:'p2',kind:'PACKAGE'}],
 edges:[
 {id:'e1',sourceId:'ra',targetId:'rb',kind:'CALLS',resolution:'RESOLVED',reviewChange:'UNCHANGED'},
 {id:'e2',sourceId:'ra',targetId:'rb',kind:'CALLS',resolution:'RESOLVED',reviewChange:'ADDED'},
 {id:'e3',sourceId:'ra',targetId:'rb',kind:'DEPENDS_ON',resolution:'RESOLVED',reviewChange:'REMOVED'},
 {id:'e4',sourceId:'ra',targetId:'rb',kind:'USES_TYPE',resolution:'RESOLVED',reviewChange:'UNKNOWN'}]};
const reviewRoutes=projectDisplayed(reviewGraph,'CLASS',['ra','rb'],'ALL').edges;
assert.equal(reviewRoutes.length,4,'each review status between the same pair keeps its own line');
assert.deepEqual(reviewRoutes.map(e=>e.reviewChange).sort(),['ADDED','REMOVED','UNCHANGED','UNKNOWN']);
assert.equal(new Set(reviewRoutes.map(e=>e.id)).size,4,'each separated route has its own aggregate id');
const twoUnchanged=projectDisplayed({...reviewGraph,edges:[reviewGraph.edges[0],{...reviewGraph.edges[0],id:'e1b',kind:'USES_TYPE'}]},'CLASS',['ra','rb'],'ALL').edges;
assert.equal(twoUnchanged.length,1,'occurrences sharing a status still merge into one line');
assert.equal(twoUnchanged[0].occurrenceIds.length,2);
assert.equal(projectDisplayed(graph,'CLASS',['a','b'],'ALL').edges[0].reviewChange,undefined,'the ordinary map carries no review status');
console.log('PASS: review overlay keeps one line per ordered pair and change status');

// Step 14 (ADR 0011): an ungrouped (hidden) box is flagged for the canvas; lines land on its children.
{
  const hidden=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'p2',ownerId:null,hidden:true}],scope:ALL});
  const p2=hidden.nodes.find(n=>n.id==='p2');
  assert.equal(p2.hiddenBox,true,'the ungrouped card is flagged');
  assert.equal(p2.expanded,true,'and is still an expanded container');
  assert.equal(hidden.nodes.find(n=>n.id==='p1').hiddenBox,undefined,'other cards carry no flag');
  assert.deepEqual(hidden.edges.map(e=>[e.sourceId,e.targetId]),[['p1','b']],'the route lands on the freed class');
  const visible=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'p2',ownerId:null}],scope:ALL});
  assert.equal(visible.nodes.find(n=>n.id==='p2').hiddenBox,undefined);
  console.log('PASS: an ungrouped box is flagged and its lines land on its children');
}
{
  const methods=projectDisplayed(graph,'PACKAGE',['p1','p2'],'ALL',{expansions:[{id:'p2',ownerId:null},{id:'b',ownerId:'p2'}],scope:ALL});
  assert.equal(methods.nodes.find(n=>n.id==='b1').ownerName,'Worker','a method card carries its class name');
  assert.equal(methods.nodes.find(n=>n.id==='b').ownerName,undefined,'a class card does not');
  console.log('PASS: method cards carry their owning class name');
}
{
  // The containers to open, in order, so a target is drawn: its package box, then (for a method or
  // constructor) its type's box. A package box holds nested types side by side with their outer type,
  // so a nested type never needs its outer class opened.
  const nodes=[{id:'p',kind:'PACKAGE',simpleName:'p'},{id:'C',kind:'CLASS',simpleName:'C',parentId:'p'},{id:'N',kind:'CLASS',simpleName:'N',parentId:'C'},
    {id:'C.m',kind:'METHOD',simpleName:'m',parentId:'C'},{id:'C.<init>',kind:'CONSTRUCTOR',simpleName:'C',parentId:'C'},{id:'N.n',kind:'METHOD',simpleName:'n',parentId:'N'}];
  const all=new Map(nodes.map(n=>[n.id,n]));
  const ids=id=>revealContainers(all.get(id),all).map(n=>n.id);
  assert.deepEqual(ids('p'),[],'a package is drawn on the map itself');
  assert.deepEqual(ids('C'),['p'],'a class needs its package');
  assert.deepEqual(ids('N'),['p'],'a nested type sits in its package box, not in its outer class');
  assert.deepEqual(ids('C.m'),['p','C'],'a method needs its package, then its class');
  assert.deepEqual(ids('C.<init>'),['p','C'],'so does a constructor');
  assert.deepEqual(ids('N.n'),['p','N'],'a method of a nested type needs the nested type, not the outer class');
  console.log('PASS: revealContainers lists the package, then the owning type of a method');
}
