import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/graphModel.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {projectGraph}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const nodes=[{id:'p1',kind:'PACKAGE',simpleName:'api'},{id:'p2',kind:'PACKAGE',simpleName:'service'}, {id:'a',kind:'CLASS',simpleName:'Controller',parentId:'p1'}, {id:'b',kind:'INTERFACE',simpleName:'Worker',parentId:'p2'}, {id:'a1',kind:'METHOD',simpleName:'handle',parentId:'a'}, {id:'b1',kind:'METHOD',simpleName:'work',parentId:'b'}, {id:'b2',kind:'METHOD',simpleName:'audit',parentId:'b'}];
const edges=[{id:'e1',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e2',sourceId:'a1',targetId:'b1',kind:'CALLS',resolution:'RESOLVED'},{id:'e3',sourceId:'a',targetId:'b',kind:'INJECTS',resolution:'CANDIDATE'},{id:'e4',sourceId:'b1',targetId:'b2',kind:'CALLS',resolution:'RESOLVED'},{id:'e5',sourceId:'a1',targetId:null,kind:'CALLS',resolution:'UNRESOLVED'}];
const graph={nodes,edges};
for (const level of ['PACKAGE','CLASS']) {
 const view=projectGraph(graph,level,null,'ALL');assert.equal(view.nodes.length,2);assert.equal(view.edges.length,2);
 const calls=view.edges.find(e=>e.kind==='CALLS');assert.deepEqual(calls.occurrenceIds,['e1','e2']);assert.equal(calls.occurrenceCount,2);assert.equal(calls.sourceId,level==='PACKAGE'?'p1':'a');assert.equal(calls.targetId,level==='PACKAGE'?'p2':'b');assert.equal(view.edges.find(e=>e.kind==='INJECTS').resolution,'CANDIDATE');
}
const methods=projectGraph(graph,'METHOD','a','ALL');assert.deepEqual(new Set(methods.nodes.map(n=>n.id)),new Set(['a1','b1']));assert.equal(methods.edges.length,1);
assert.equal(projectGraph(graph,'CLASS',null,'INJECTS').edges.length,1);
const limited=projectGraph(graph,'METHOD',null,'ALL',1);assert.equal(limited.nodes.length,1);assert.equal(limited.omitted,2);assert.ok(limited.edges.every(e=>limited.nodes.some(n=>n.id===e.sourceId)&&limited.nodes.some(n=>n.id===e.targetId)));
console.log('PASS: package/class aggregation, direction, occurrence counts, uncertainty, method neighbors, filters, and bounded views');
