// Design layer (ADR 0014): merging the design overlay onto the snapshot graph, keys, intent, and
// keeping designed relations on their own route. Zero-dependency, like the other test-*.mjs scripts.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const load=src=>import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const design=await load(compile('../frontend/src/features/design/designModel.ts'));
const stripLocalImport=(src,name)=>src.replace(new RegExp(`import \\{[^}]*\\} from ['"]\\./${name}['"];?\n?`),'');
const graphModel=await load(stripLocalImport(compile('../frontend/src/features/explorer/scopeModel.ts'),'graphModel')+'\n'+stripLocalImport(compile('../frontend/src/features/explorer/graphModel.ts'),'scopeModel'));
const {mergeDesignGraph,relationsOfRoute,childKey,childKindsFor,parseParameterTypes,intentOf,detailOf,isDesignOnly,isImported,isDesignedRelation,keyOf,designNodeId,parseInlineName,defaultRelationKind,joinExplanation,createResourceOps,explainOps,relationOps}=design;
const {projectDisplayed,childrenOf,wholeSystemScope,getEligibleIds}=graphModel;

const graph={nodes:[
  {id:'p',kind:'PACKAGE',simpleName:'com.acme.orders',qualifiedName:'com.acme.orders'},
  {id:'c',kind:'CLASS',simpleName:'OrderService',qualifiedName:'com.acme.orders.OrderService',parentId:'p'},
  {id:'m',kind:'METHOD',simpleName:'create',qualifiedName:'com.acme.orders.OrderService.create(Order)',parentId:'c'},
  {id:'q',kind:'PACKAGE',simpleName:'com.acme.web',qualifiedName:'com.acme.web'},
  {id:'w',kind:'CLASS',simpleName:'OrderController',qualifiedName:'com.acme.web.OrderController',parentId:'q'},
],edges:[{id:'e1',sourceId:'w',targetId:'c',kind:'CALLS',resolution:'RESOLVED'}],metadata:{workspaceId:'ws'}};
const base={createdBy:'claude-code',updatedBy:'user',createdAt:'t0',updatedAt:'t1',revision:1};
const overlay={schemaVersion:'1',workspaceId:'ws',snapshotId:'s',resources:[
  {...base,id:'r1',key:'com.acme.billing',kind:'PACKAGE',name:'com.acme.billing',parentKey:null,origin:'AUTHORED',status:'PLANNED',explanation:'Billing.\n\nOwns invoices.',intent:'Billing.'},
  {...base,id:'r2',key:'com.acme.billing.InvoiceService',kind:'CLASS',name:'InvoiceService',parentKey:'com.acme.billing',origin:'AUTHORED',status:'PLANNED',explanation:'',intent:''},
  {...base,id:'r3',key:'com.acme.orders.OrderService.cancel(OrderId,String)',kind:'METHOD',name:'cancel',parentKey:'com.acme.orders.OrderService',parameterTypes:['OrderId','String'],origin:'AUTHORED',status:'PLANNED',explanation:'',intent:'',parentCodeId:'c'},
  {...base,id:'r4',key:'com.acme.orders.OrderService',kind:'CLASS',name:'OrderService',parentKey:'com.acme.orders',origin:'CODE',status:'PRESENT',explanation:'Order lifecycle.',intent:'Order lifecycle.',codeId:'c',parentCodeId:'p'},
  {...base,id:'r5',key:'com.acme.legacy.Gone',kind:'CLASS',name:'Gone',parentKey:'com.acme.legacy',origin:'CODE',status:'ORPHANED',explanation:'',intent:''},
],relations:[
  {...base,id:'x1',sourceKey:'com.acme.orders.OrderService',targetKey:'com.acme.billing.InvoiceService',kind:'CALLS',resolution:'DESIGNED',status:'PLANNED',explanation:'Invoice completed orders.',intent:'Invoice completed orders.',sourceCodeId:'c'},
  {...base,id:'x2',sourceKey:'com.acme.web.OrderController',targetKey:'com.acme.orders.OrderService',kind:'CALLS',resolution:'DESIGNED',status:'IMPLEMENTED',explanation:'Delegates.',intent:'Delegates.',sourceCodeId:'w',targetCodeId:'c'},
  {...base,id:'x3',sourceKey:'nowhere.A',targetKey:'com.acme.orders.OrderService',kind:'CALLS',resolution:'DESIGNED',status:'ORPHANED',explanation:'',intent:''},
]};

// Nothing to merge keeps graph identity.
assert.equal(mergeDesignGraph(graph,null),graph);
assert.equal(mergeDesignGraph(graph,{...overlay,resources:[],relations:[]}),graph);

const merged=mergeDesignGraph(graph,overlay);
const byId=new Map(merged.nodes.map(n=>[n.id,n]));
assert.equal(graph.nodes.length,5,'the input graph is not mutated');
assert.equal(byId.get('c').design.explanation,'Order lifecycle.','an explanation annotates the parsed card');
assert.ok(!isDesignOnly(byId.get('c')));
const pkg=byId.get(designNodeId('com.acme.billing'));
assert.ok(pkg&&isDesignOnly(pkg),'a planned package is its own card');
assert.equal(byId.get(designNodeId('com.acme.billing.InvoiceService')).parentId,designNodeId('com.acme.billing'),'a planned type sits in its planned package');
const cancel=byId.get(designNodeId('com.acme.orders.OrderService.cancel(OrderId,String)'));
assert.equal(cancel.parentId,'c','a planned method sits in its parsed class');
assert.equal(cancel.simpleName,'cancel','a planned method is named like a parsed one: its name alone (ADR 0017 round 4)');
assert.equal(cancel.qualifiedName,'com.acme.orders.OrderService.cancel(OrderId,String)','its key, with the parameter types, is its qualified name');
assert.equal(keyOf(cancel),'com.acme.orders.OrderService.cancel(OrderId,String)');
assert.equal(byId.get(designNodeId('com.acme.legacy.Gone')).parentId,undefined,'an orphan has no parent card');

// Hierarchy and eligibility see design cards like parsed ones.
assert.deepEqual(childrenOf(merged,byId.get('c'),wholeSystemScope()).map(n=>n.id).sort(),['m',cancel.id].sort());
assert.ok(getEligibleIds(merged,'PACKAGE',wholeSystemScope()).includes(pkg.id));

// Relations: resolved to cards, DESIGNED, an unresolvable endpoint is dropped.
const designEdges=merged.edges.filter(e=>e.design);
assert.equal(designEdges.length,2);
assert.ok(designEdges.every(e=>e.resolution==='DESIGNED'));
assert.equal(designEdges.find(e=>e.design.id==='x1').targetId,designNodeId('com.acme.billing.InvoiceService'));

// aggregateEdges keeps a designed relation on its own route beside the parsed one it explains.
const projected=projectDisplayed(merged,'PACKAGE',['p','q',pkg.id],'ALL',{expansions:[],scope:wholeSystemScope()});
const webToOrders=projected.edges.filter(e=>e.sourceId==='q'&&e.targetId==='p');
assert.equal(webToOrders.length,2,'parsed and designed routes between the same cards stay apart');
const designedRoute=webToOrders.find(e=>e.design);
assert.equal(designedRoute.occurrenceCount,1);
assert.deepEqual(relationsOfRoute(designedRoute,overlay).map(r=>r.id),['x2']);
assert.deepEqual(relationsOfRoute(webToOrders.find(e=>!e.design),overlay),[]);
assert.ok(projected.edges.some(e=>e.sourceId==='p'&&e.targetId===pkg.id&&e.design),'a designed relation reaches a planned package card');

// Keys mirror the backend's DesignKeys.
assert.equal(childKey('PACKAGE',null,' com.acme.x '),'com.acme.x');
assert.equal(childKey('CLASS','com.acme','Foo'),'com.acme.Foo');
assert.equal(childKey('CLASS','(default)','Foo'),'Foo');
assert.equal(childKey('METHOD','com.acme.Foo','run',[' Long','List<String>']),'com.acme.Foo.run(Long,List<String>)');
assert.equal(childKey('METHOD','com.acme.Foo','run'),'com.acme.Foo.run()');
assert.deepEqual(childKindsFor(null),['PACKAGE']);
assert.ok(childKindsFor('PACKAGE').includes('INTERFACE')&&!childKindsFor('PACKAGE').includes('METHOD'));
assert.ok(childKindsFor('CLASS').includes('METHOD'));
assert.deepEqual(childKindsFor('METHOD'),[]);
assert.deepEqual(parseParameterTypes('Long id, Map<String, List<Integer>> index, String[] names'),['Long','Map<String, List<Integer>>','String[]']);
assert.deepEqual(parseParameterTypes('OrderId, boolean'),['OrderId','boolean']);
assert.deepEqual(parseParameterTypes('  '),[]);

// Intent is the first paragraph.
assert.equal(intentOf('Issues invoices\nfor orders.\n\nIdempotent.'),'Issues invoices for orders.');
assert.equal(detailOf('Issues invoices.\n\nIdempotent.\n\nRetries.'),'Idempotent.\n\nRetries.');
assert.equal(intentOf(''),'');
assert.equal(detailOf('Only intent.'),'');

// ADR 0015: inline names.
assert.deepEqual(parseInlineName(' findById(Long) ','METHOD','OrderService'),{name:'findById',kind:'METHOD',parameterTypes:['Long']});
assert.deepEqual(parseInlineName('run','METHOD','X'),{name:'run',kind:'METHOD',parameterTypes:[]});
assert.deepEqual(parseInlineName('put(Map<String, List<Long>> m, int)','METHOD','X'),{name:'put',kind:'METHOD',parameterTypes:['Map<String, List<Long>>','int']});
assert.deepEqual(parseInlineName('OrderService(OrderRepository)','METHOD','OrderService'),{name:'OrderService',kind:'CONSTRUCTOR',parameterTypes:['OrderRepository']});
assert.equal(typeof parseInlineName('find by id','METHOD','X'),'string');
assert.equal(typeof parseInlineName('','CLASS'),'string');
assert.deepEqual(parseInlineName('Refunds','CLASS'),{name:'Refunds',kind:'CLASS',parameterTypes:[]});
assert.equal(typeof parseInlineName('com.acme.Refunds','CLASS'),'string','a type name is one identifier');
assert.deepEqual(parseInlineName('com.acme.billing','PACKAGE'),{name:'com.acme.billing',kind:'PACKAGE',parameterTypes:[]});
assert.equal(typeof parseInlineName('com..billing','PACKAGE'),'string');
// Default relation kinds from the endpoints.
// ADR 0016: a two-click relation is always CALLS until the quick popup changes it.
for(const [a,b] of [['METHOD','METHOD'],['CLASS','INTERFACE'],['CLASS','CLASS'],['PACKAGE','CLASS'],['PACKAGE','PACKAGE']])assert.equal(defaultRelationKind(a,b),'CALLS');
// Explanation join is the inverse of intentOf/detailOf.
const joined=joinExplanation(' Issues  invoices. ','Idempotent.\n\nRetries.');
assert.equal(intentOf(joined),'Issues invoices.');assert.equal(detailOf(joined),'Idempotent.\n\nRetries.');
assert.equal(joinExplanation('',' Only details. '),'Only details.');
assert.equal(joinExplanation('Only intent.',''),'Only intent.');
// Change sets.
assert.deepEqual(createResourceOps('com.acme.Foo',{name:'run',kind:'METHOD',parameterTypes:['Long']}),[{op:'putResource',kind:'METHOD',parentKey:'com.acme.Foo',name:'run',parameterTypes:['Long'],explanation:''}]);
assert.deepEqual(createResourceOps(null,{name:'com.acme',kind:'PACKAGE',parameterTypes:[]}),[{op:'putResource',kind:'PACKAGE',parentKey:null,name:'com.acme',explanation:''}]);
const parsedCard=merged.nodes.find(n=>n.id==='w'),authoredCard=merged.nodes.find(n=>n.id===designNodeId('com.acme.billing'));
assert.deepEqual(explainOps(parsedCard,'Why.'),[{op:'putResource',key:'com.acme.web.OrderController',explanation:'Why.'}]);
assert.deepEqual(explainOps(authoredCard,'Why.'),[{op:'updateResource',key:'com.acme.billing',explanation:'Why.'}]);
assert.deepEqual(relationOps('A','B','CALLS','x'),[{op:'putRelation',sourceKey:'A',targetKey:'B',kind:'CALLS',explanation:'x'}]);
assert.deepEqual(relationOps('A','B','INJECTS','x','CALLS').map(o=>o.op),['deleteRelation','putRelation']);
assert.equal(relationOps('A','B','CALLS','x','CALLS').length,1);
// ADR 0016: a parsed dependency carried along (origin CODE) is an ordinary route. Explained on code the map
// has, it merges with the parser's route; imported between cards the code lacks, it is a grey route between
// imported cards, which are drawn like the original and are not designed work.
const carriedOverlay={...overlay,resources:[
  ...overlay.resources,
  {...base,id:'i1',key:'com.other',kind:'PACKAGE',name:'com.other',parentKey:null,origin:'CODE',status:'MISSING',explanation:'',intent:''},
  {...base,id:'i2',key:'com.other.Repo',kind:'CLASS',name:'Repo',parentKey:'com.other',origin:'CODE',status:'MISSING',explanation:'',intent:'',roles:['REPOSITORY']},
  {...base,id:'i3',key:'com.other.Repo.find(Long)',kind:'METHOD',name:'find',parentKey:'com.other.Repo',parameterTypes:['Long'],origin:'CODE',status:'MISSING',explanation:'',intent:''},
],relations:[
  {...base,id:'k1',sourceKey:'com.acme.web.OrderController',targetKey:'com.acme.orders.OrderService',kind:'CALLS',resolution:'CODE',origin:'CODE',status:'PRESENT',explanation:'Validate first.',intent:'Validate first.',sourceCodeId:'w',targetCodeId:'c'},
  {...base,id:'k2',sourceKey:'com.acme.orders.OrderService',targetKey:'com.other.Repo',kind:'USES_TYPE',resolution:'CODE',origin:'CODE',status:'MISSING',explanation:'',intent:'',sourceCodeId:'c'},
  {...base,id:'k3',sourceKey:'com.acme.orders.OrderService',targetKey:'com.other.Repo',kind:'CALLS',resolution:'DESIGNED',origin:'AUTHORED',status:'PLANNED',explanation:'',intent:'',sourceCodeId:'c'},
]};
const carried=mergeDesignGraph(graph,carriedOverlay);
const repo=carried.nodes.find(n=>n.id===designNodeId('com.other.Repo'));
assert.ok(isImported(repo)&&isDesignOnly(repo),'an imported reference is design-only data drawn as imported code');
assert.deepEqual(repo.roles,['REPOSITORY'],'an imported card keeps its Spring roles');
assert.equal(carried.nodes.find(n=>n.id===designNodeId('com.other.Repo.find(Long)')).simpleName,'find','an imported member is named as the parser names it');
assert.equal(carried.nodes.find(n=>n.id===designNodeId('com.acme.orders.OrderService.cancel(OrderId,String)')).simpleName,'cancel','a planned member reads like a parsed one; overloads read alike, as parsed ones do');
assert.ok(!isImported(carried.nodes.find(n=>n.id===designNodeId('com.acme.billing'))),'a planned card is not imported');
const k1=carried.edges.find(e=>e.id==='design-rel:k1'),k3=carried.edges.find(e=>e.id==='design-rel:k3');
assert.equal(k1.resolution,'CODE');assert.ok(!isDesignedRelation(k1));assert.ok(isDesignedRelation(k3));
const routes=projectDisplayed(carried,'PACKAGE',['p','q',designNodeId('com.other')],'ALL').edges;
const qp=routes.filter(r=>r.sourceId==='q'&&r.targetId==='p');
assert.equal(qp.length,1,'an explained parsed relation merges with the parser route');
assert.ok(qp[0].occurrenceIds.includes('design-rel:k1')&&qp[0].occurrenceIds.includes('e1'));
assert.equal(qp[0].resolution,'RESOLVED','a carried relation never worsens the resolution');
const toOther=routes.filter(r=>r.sourceId==='p'&&r.targetId===designNodeId('com.other'));
assert.equal(toOther.length,2,'the carried dependency and the designed relation stay separate routes');
assert.equal(toOther.filter(r=>isDesignedRelation(r)).length,1);
// Review F3: a pending pin or growth is used only by the reconciliation that admits its card. An unrelated
// reconciliation (the overlay poll landing while the create is in flight) keeps it for the next one.
{
  const pending={'design:a.B':{size:1},'design:a.C':{size:2}};
  const early=design.takeAdmitted(pending,id=>id==='design:a.Other');
  assert.deepEqual(early,{taken:{},kept:pending},'the card is not in the graph yet: nothing is used, nothing is lost');
  const admitted=design.takeAdmitted(early.kept,id=>id==='design:a.B');
  assert.deepEqual(admitted.taken,{'design:a.B':{size:1}},'used by the reconciliation that admits it');
  assert.deepEqual(admitted.kept,{'design:a.C':{size:2}},'the other one waits for its own card');
  assert.deepEqual(design.takeAdmitted({},()=>true),{taken:{},kept:{}});
}
console.log('design model tests passed');
