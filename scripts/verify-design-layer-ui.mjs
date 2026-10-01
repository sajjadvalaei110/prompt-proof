// Design-layer browser check (ADR 0014) via Chromium CDP and Node's built-in WebSocket; no npm dependency.
//
// Usage: start the packaged jar and a headless Chromium with --remote-debugging-port, analyze COPIES of
// test-fixtures/spring-project (A) and test-fixtures/stable-graph-fixture (B), then:
//   node scripts/verify-design-layer-ui.mjs <appBase> <chromiumDebugBase> <wsA> <snapshotA> <wsB> <snapshotB> <outputDir>
// Writes report.json, the exported brief and screenshots to <outputDir>; exits non-zero on the first unmet check.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const [base,debug,wsA,snapA,wsB,snapB,outDir]=process.argv.slice(2);
const downloads=path.resolve(outDir,'downloads');
await fs.mkdir(downloads,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=await (await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
let seq=0;const pending=new Map();const errors=[];
socket.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const w=pending.get(m.id);if(w){pending.delete(m.id);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value).join(' '));};
const cdp=(method,params={})=>{const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});};
const evaluate=async expr=>{const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const shot=async name=>{await pause(500);const r=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${outDir}/${name}.png`,Buffer.from(r.data,'base64'));console.log('screenshot',name);};
const until=async(expr,label,tries=140)=>{for(let i=0;i<tries;i++){if(await evaluate(expr))return;await pause(150);}throw Error('Timed out: '+label);};
const CY=`document.querySelector('.graph-canvas')._cyreg.cy`;
const q=JSON.stringify;
// React-controlled fields need the native setter plus an input event.
const fill=(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${q(selector)});if(!el)throw Error('missing '+${q(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${q(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true;})()`);
const clickText=(selector,text)=>evaluate(`(()=>{const b=[...document.querySelectorAll(${q(selector)})].find(b=>b.textContent.includes(${q(text)}));if(!b)throw Error('no '+${q(selector)}+' with '+${q(text)});b.click();return true;})()`);
const hasNode=id=>evaluate(`${CY}.getElementById(${q(id)}).length>0`);
const results={};

await cdp('Page.enable');await cdp('Runtime.enable');
await cdp('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:`${base}/?snapshotId=${snapA}`});
await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`,'graph A');
await pause(800);
await shot('01-map-before-design');

// 1. Right-click on empty canvas -> Add package (the engineer authors at the top level).
await evaluate(`${CY}.emit('cxttap'),true`);
await until(`[...document.querySelectorAll('.graph-context-menu .design-menuitem')].some(b=>b.textContent.includes('Add package'))`,'canvas design menu');
await clickText('.graph-context-menu .design-menuitem','Add package');
await until(`!!document.querySelector('dialog.design-dialog[open]')`,'design dialog');
await fill('.design-dialog input[placeholder="com.acme.billing"]','com.example.audit');
await fill('.design-explanation-input','Audit trail for order changes.\n\nEvery state change of an order is recorded once, append-only.');
await shot('02-add-package-dialog');
await evaluate(`document.querySelector('.design-dialog button[type=submit]').click()`);
await until(`!document.querySelector('dialog.design-dialog[open]')`,'dialog closes after save');
await until(`${CY}.getElementById('design:com.example.audit').length>0`,'planned package card');
results.plannedPackage=await evaluate(`(()=>{const n=${CY}.getElementById('design:com.example.audit');return {designOnly:n.data('designOnly'),border:n.style('border-style'),color:n.style('border-color')};})()`);
assert.equal(results.plannedPackage.designOnly,true);
assert.equal(results.plannedPackage.border,'dashed','a planned card is drawn dashed');

// 2. Right-click the planned package -> Add type.
await evaluate(`${CY}.getElementById('design:com.example.audit').emit('cxttap'),true`);
await until(`[...document.querySelectorAll('.graph-context-menu .design-menuitem')].some(b=>b.textContent.includes('Add type'))`,'card design menu');
await clickText('.graph-context-menu .design-menuitem','Add type');
await until(`!!document.querySelector('dialog.design-dialog[open]')`,'add type dialog');
await fill('.design-dialog input[placeholder="InvoiceService"]','AuditLog');
await fill('.design-explanation-input','Append-only store of order events.');
await evaluate(`document.querySelector('.design-dialog button[type=submit]').click()`);
await until(`!document.querySelector('dialog.design-dialog[open]')`,'type saved');
await until(`!!document.querySelector('button[aria-label="Show types inside com.example.audit"]')`,'planned package can expand');
await evaluate(`document.querySelector('button[aria-label="Show types inside com.example.audit"]').click()`);
await until(`${CY}.getElementById('design:com.example.audit.AuditLog').length>0`,'planned class inside planned package');
await shot('03-planned-package-and-class');

// 3. Explain a parsed class: the intent leads the inspector.
const servicePkg=await evaluate(`${CY}.nodes().filter(n=>n.data('kind')==='PACKAGE'&&(n.data('qualifiedName')||'').endsWith('.service'))[0].data('simpleName')`);
await evaluate(`document.querySelector(${q(`button[aria-label="Show types inside ${servicePkg}"]`)}).click()`);
await until(`${CY}.nodes().some(n=>n.data('simpleName')==='OrderService')`,'OrderService card');
await evaluate(`${CY}.nodes().filter(n=>n.data('simpleName')==='OrderService')[0].emit('tap'),true`);
await until(`!!document.querySelector('.design-section')`,'design section in inspector');
await clickText('.design-section button','Write explanation');
await until(`!!document.querySelector('dialog.design-dialog[open]')`,'explain dialog');
assert.equal(await evaluate(`document.querySelectorAll('.design-dialog select').length`),0,'parsed code offers only its explanation, not its structure');
await fill('.design-explanation-input','Owns the order lifecycle from creation to completion.\n\nPlanned change: publish an OrderCompleted event instead of calling billing directly.');
await evaluate(`document.querySelector('.design-dialog button[type=submit]').click()`);
await until(`document.querySelector('.design-section .design-intent')?.textContent==='Owns the order lifecycle from creation to completion.'`,'intent shown first');
results.inspector=await evaluate(`({intent:document.querySelector('.design-section .design-intent').textContent,detail:document.querySelector('.design-section .design-detail')?.textContent,generatedHeading:document.querySelector('.explanation-section h3')?.textContent})`);
assert.ok(results.inspector.detail.includes('OrderCompleted'));
assert.ok(results.inspector.generatedHeading.includes('Generated explanation'),'the model explanation is labelled as generated');
await shot('04-parsed-class-explained');

// 4. An AI agent applies a change set over REST while the map is open; the map picks it up.
const agent=await (await fetch(`${base}/api/workspaces/${wsA}/design/changes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({author:'claude-code',operations:[
  {op:'putResource',kind:'METHOD',parentKey:'com.example.spring.service.OrderService',name:'complete',parameterTypes:['Long'],signature:'void complete(Long orderId)',explanation:'Marks an order completed and records it in the audit trail.'},
  {op:'putRelation',sourceKey:'com.example.spring.service.OrderService',targetKey:'com.example.audit.AuditLog',kind:'CALLS',explanation:'Each completed order is appended to the audit trail.'},
]})})).json();
results.agent=agent;
assert.equal(agent.applied,2);
await until(`${CY}.edges().some(e=>e.data('designed'))`,'agent relation drawn without reload',200);
results.designedEdge=await evaluate(`(()=>{const e=${CY}.edges().filter(e=>e.data('designed'))[0];return {id:e.id(),style:e.style('line-style'),color:e.style('line-color'),label:e.data('label'),source:e.source().data('simpleName'),target:e.target().data('simpleName')};})()`);
assert.equal(results.designedEdge.style,'dashed');
assert.ok(results.designedEdge.label.startsWith('✎'),'a designed route is labelled as design');
await evaluate(`${CY}.getElementById(${q(results.designedEdge.id)}).emit('tap'),true`);
await until(`[...document.querySelectorAll('.design-section .design-intent')].some(p=>p.textContent.includes('audit trail'))`,'designed relation in inspector');
results.edgeProvenance=await evaluate(`document.querySelector('.design-section .design-provenance').textContent`);
assert.ok(results.edgeProvenance.includes('claude-code'),'the agent is named as author');
await shot('05-agent-designed-relation');
await evaluate(`${CY}.nodes().filter(n=>n.data('simpleName')==='OrderService')[0].emit('cxttap'),true`);
await until(`[...document.querySelectorAll('.graph-context-menu button')].some(b=>b.textContent.includes('Expand'))`,'card menu Expand');
await clickText('.graph-context-menu button','Expand');
await until(`${CY}.getElementById('design:com.example.spring.service.OrderService.complete(Long)').length>0`,'planned method inside parsed class');
await evaluate(`${CY}.getElementById('design:com.example.spring.service.OrderService.complete(Long)').emit('tap'),true`);
await until(`document.querySelector('.design-section .design-status')?.textContent.startsWith('planned')`,'planned status');
assert.equal(await evaluate(`!!document.querySelector('.explanation-section')`),false,'a planned method has no generated explanation to request');
await shot('06-planned-method');

// Undo walks exploration only; design edits are server operations and stay.
await evaluate(`[...document.querySelectorAll('.journey-history button')].find(b=>b.textContent.includes('Undo')).click()`);
await pause(600);
assert.equal((await (await fetch(`${base}/api/workspaces/${wsA}/design`)).json()).resources.length>=4,true,'undo does not reverse design edits');

// 5. Export the brief from the toolbar.
const packagePosition=await evaluate(`(()=>{const p=${CY}.getElementById('design:com.example.audit').position();return {x:p.x,y:p.y};})()`);
await clickText('.design-controls button','Export');
let briefFile=null;
for(let i=0;i<100&&!briefFile;i++){briefFile=(await fs.readdir(downloads)).find(f=>f.endsWith('-design-brief.md'));if(!briefFile)await pause(150);}
assert.ok(briefFile,'export downloaded a design brief');
const brief=await fs.readFile(path.join(downloads,briefFile),'utf8');
await fs.writeFile(`${outDir}/exported-design-brief.md`,brief);
for(const s of ['## How to read this brief','## Module structure','## Relations','## Working with this design through the Code Atlas API','json codeatlas-design','> Audit trail for order changes.','> Owns the order lifecycle','claude-code'])
  assert.ok(brief.includes(s),'brief contains '+s);
results.briefBytes=brief.length;

// 6. Import into workspace B (another codebase): the same map comes back in a new tab.
await cdp('Page.navigate',{url:`${base}/?snapshotId=${snapB}`});
await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0 && !!document.querySelector('.design-import input')`,'graph B');
const tabsBefore=await evaluate(`document.querySelectorAll('.journey-tab').length`);
const {root}=await cdp('DOM.getDocument',{depth:-1});
const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'.design-import input'});
await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(downloads,briefFile)]});
await until(`document.querySelectorAll('.journey-tab').length>${tabsBefore}`,'imported layout opens a new tab',200);
await until(`${CY}.getElementById('design:com.example.audit').length>0`,'imported planned package');
results.imported=await evaluate(`(()=>{const cy=${CY};const n=cy.getElementById('design:com.example.audit');return {position:{x:n.position().x,y:n.position().y},missing:cy.nodes().filter(n=>n.id().startsWith('design:com.example.spring')).map(n=>n.id()),status:document.querySelector('.app-footer')?.textContent};})()`);
assert.deepEqual(results.imported.position,packagePosition,'the imported layout keeps the card where it was exported');
assert.ok(results.imported.missing.length>0,'parsed resources absent from this code come back as placeholders');
await shot('07-imported-map-in-other-workspace');
const overlayB=await (await fetch(`${base}/api/workspaces/${wsB}/design`)).json();
const byKey=Object.fromEntries(overlayB.resources.map(r=>[r.key,r]));
assert.equal(byKey['com.example.spring.service.OrderService'].status,'MISSING');
assert.ok(byKey['com.example.spring.service.OrderService'].explanation.includes('OrderCompleted'));
assert.equal(byKey['com.example.audit.AuditLog'].status,'PLANNED');
assert.ok(overlayB.relations.some(r=>r.targetKey==='com.example.audit.AuditLog'&&r.createdBy==='claude-code'));

results.pageErrors=errors;
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(results,null,2));
assert.equal(errors.length,0,'no page errors: '+JSON.stringify(errors).slice(0,500));
console.log('design-layer UI checks passed');
socket.close();
