// Design brief layout (ADR 0014): a tab's layout captured by stable keys re-applies to a graph with
// different snapshot IDs, keeping positions, expansions, sizes, camera and scope.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {captureLayout,applyLayout,scopeFromLayout,isMapLayout}=await import('data:text/javascript;base64,'+Buffer.from(compile('../frontend/src/features/design/designExchange.ts')).toString('base64'));

const level=(over={})=>({displayedIds:[],priorEligibleIds:[],initialized:true,positions:{},camera:null,geometryRevision:0,cameraRevision:0,geometryInitialized:true,appendWidth:null,expansions:{},sizes:{},...over});
const view=pkg=>({activeLevel:'PACKAGE',levelViews:{PACKAGE:pkg,CLASS:level(),METHOD:level()},inspectedSubjectId:null,inspectedOccurrenceId:null,inspectedKind:null,inspectedLevel:null,membershipRevision:1,newlyAddedIds:[],history:[],generation:1});

// Source graph: snapshot IDs a1.., plus a design-only planned class.
const source={nodes:[
  {id:'a1',kind:'PACKAGE',simpleName:'com.acme',qualifiedName:'com.acme'},
  {id:'a2',kind:'CLASS',simpleName:'Svc',qualifiedName:'com.acme.Svc',parentId:'a1'},
  {id:'a3',kind:'METHOD',simpleName:'run',qualifiedName:'com.acme.Svc.run()',parentId:'a2'},
  {id:'design:com.acme.Planned',kind:'CLASS',simpleName:'Planned',qualifiedName:'com.acme.Planned',parentId:'a1',design:{key:'com.acme.Planned'}},
  {id:'a9',kind:'PACKAGE',simpleName:'com.other',qualifiedName:'com.other'},
],edges:[]};
const sourceView=view(level({displayedIds:['a1','a9'],positions:{a1:{x:10,y:20},a9:{x:500,y:20}},camera:{zoom:.8,pan:{x:5,y:6}},
  expansions:{a1:{ownerId:null,childPositions:{a2:{x:30,y:40},'design:com.acme.Planned':{x:300,y:40}},minSize:{width:900,height:600}},a2:{ownerId:'a1',childPositions:{a3:{x:35,y:45}},minSize:null,hidden:true}},
  sizes:{a2:{width:300,height:220}}}));
const layout=captureLayout(sourceView,{mode:'CUSTOM',selectedPackageIds:new Set(['a1']),selectedClassIds:new Set()},'CALLS',source);
assert.ok(isMapLayout(layout));
assert.deepEqual(layout.scope,{mode:'CUSTOM',packageKeys:['com.acme'],classKeys:[]});
assert.deepEqual(layout.positions,{'com.acme':{x:10,y:20},'com.other':{x:500,y:20}});
assert.deepEqual(layout.expansions['com.acme.Svc'],{ownerKey:'com.acme',hidden:true,childPositions:{'com.acme.Svc.run()':{x:35,y:45}}});
assert.deepEqual(layout.expansions['com.acme'].childPositions['com.acme.Planned'],{x:300,y:40});
assert.deepEqual(layout.expansions['com.acme'].minSize,{width:900,height:600},'a resized box exports its size (ADR 0017 review)');
assert.deepEqual(layout.sizes,{'com.acme.Svc':{width:300,height:220}});
assert.equal(layout.kind,'CALLS');
assert.ok(JSON.stringify(layout)===JSON.stringify(JSON.parse(JSON.stringify(layout))),'a layout is plain JSON');

// Target graph: the same keys under new IDs; the planned class is design-only here too; com.other is absent.
const target={nodes:[
  {id:'b1',kind:'PACKAGE',simpleName:'com.acme',qualifiedName:'com.acme'},
  {id:'b2',kind:'CLASS',simpleName:'Svc',qualifiedName:'com.acme.Svc',parentId:'b1'},
  {id:'b3',kind:'METHOD',simpleName:'run',qualifiedName:'com.acme.Svc.run()',parentId:'b2'},
  {id:'design:com.acme.Planned',kind:'CLASS',simpleName:'Planned',qualifiedName:'com.acme.Planned',parentId:'b1',design:{key:'com.acme.Planned'}},
],edges:[]};
const scope=scopeFromLayout(layout,target);
assert.equal(scope.mode,'CUSTOM');
assert.deepEqual([...scope.selectedPackageIds],['b1']);
assert.equal(scopeFromLayout({...layout,scope:{mode:'ALL',packageKeys:[],classKeys:[]}},target).mode,'ALL');

const baseView=view(level({displayedIds:['b1'],positions:{b1:{x:0,y:0}},geometryRevision:3,cameraRevision:2}));
const applied=applyLayout(baseView,layout,target);
const lv=applied.levelViews.PACKAGE;
assert.deepEqual(lv.positions,{b1:{x:10,y:20}},'saved positions apply by key; absent cards are skipped');
assert.deepEqual(lv.expansions.b1,{ownerId:null,childPositions:{b2:{x:30,y:40},'design:com.acme.Planned':{x:300,y:40}},minSize:{width:900,height:600}},'a resized box keeps its size (ADR 0017 review)');
assert.deepEqual(lv.expansions.b2,{ownerId:'b1',childPositions:{b3:{x:35,y:45}},minSize:null,hidden:true},'a nested expansion keeps its owner and ungrouped state');
assert.deepEqual(lv.sizes,{b2:{width:300,height:220}});
assert.deepEqual(lv.camera,{zoom:.8,pan:{x:5,y:6}});
assert.equal(lv.geometryRevision,4);
assert.equal(baseView.levelViews.PACKAGE.positions.b1.x,0,'the base view is not modified');
assert.notEqual(lv.positions.b1,layout.positions['com.acme'],'coordinates are copied, never aliased');

// An expansion whose card is not displayed (or whose owner is not expanded) is dropped.
const narrow=applyLayout(view(level({displayedIds:[],positions:{}})),layout,target);
assert.deepEqual(narrow.levelViews.PACKAGE.expansions,{});
assert.ok(!isMapLayout(null)&&!isMapLayout({version:2})&&!isMapLayout('x'));
// ADR 0016: a design-only project has no parsed code. Every card is a design card (imported references and
// planned ones alike); the exported layout re-applies by key, so the map comes back exactly as it was.
const designOnly={nodes:[
  {id:'design:com.acme',kind:'PACKAGE',simpleName:'com.acme',qualifiedName:'com.acme',design:{key:'com.acme',origin:'CODE'}},
  {id:'design:com.acme.Svc',kind:'CLASS',simpleName:'Svc',qualifiedName:'com.acme.Svc',parentId:'design:com.acme',design:{key:'com.acme.Svc',origin:'CODE'}},
  {id:'design:com.acme.Svc.run()',kind:'METHOD',simpleName:'run()',qualifiedName:'com.acme.Svc.run()',parentId:'design:com.acme.Svc',design:{key:'com.acme.Svc.run()',origin:'CODE'}},
  {id:'design:com.acme.Planned',kind:'CLASS',simpleName:'Planned',qualifiedName:'com.acme.Planned',parentId:'design:com.acme',design:{key:'com.acme.Planned',origin:'AUTHORED'}},
  {id:'design:com.other',kind:'PACKAGE',simpleName:'com.other',qualifiedName:'com.other',design:{key:'com.other',origin:'CODE'}},
],edges:[]};
const fresh=view(level({displayedIds:['design:com.acme','design:com.other'],positions:{'design:com.acme':{x:0,y:0},'design:com.other':{x:0,y:400}}}));
const whole=captureLayout(sourceView,{mode:'ALL',selectedPackageIds:new Set(),selectedClassIds:new Set()},'ALL',source);
const rebuilt=applyLayout(fresh,whole,designOnly).levelViews.PACKAGE;
assert.deepEqual(rebuilt.positions,{'design:com.acme':{x:10,y:20},'design:com.other':{x:500,y:20}},'top-level cards land where they were exported');
assert.deepEqual(rebuilt.expansions['design:com.acme'].childPositions,{'design:com.acme.Svc':{x:30,y:40},'design:com.acme.Planned':{x:300,y:40}});
assert.deepEqual(rebuilt.expansions['design:com.acme.Svc'],{ownerId:'design:com.acme',childPositions:{'design:com.acme.Svc.run()':{x:35,y:45}},minSize:null,hidden:true});
assert.deepEqual(rebuilt.sizes,{'design:com.acme.Svc':{width:300,height:220}});
assert.deepEqual(rebuilt.camera,{zoom:.8,pan:{x:5,y:6}});
// Capturing the rebuilt map exports the same layout again (a round trip changes nothing).
assert.deepEqual(captureLayout({...fresh,levelViews:{...fresh.levelViews,PACKAGE:rebuilt}},{mode:'ALL',selectedPackageIds:new Set(),selectedClassIds:new Set()},'ALL',designOnly),whole);
console.log('design exchange tests passed');
