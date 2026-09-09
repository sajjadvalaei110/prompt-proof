// Browser acceptance using Chromium CDP and Node's built-in WebSocket; no npm dependency.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {base,debug,model,fixture,output}=config;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(path,body){const r=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();}
async function until(fn,label){for(let i=0;i<150;i++){if(await fn())return;await pause(200);}throw Error(`Timed out: ${label}`);}
const ws=await api('/api/workspaces',{path:fixture});
const analysis=await api(`/api/workspaces/${ws.id}/analysis-jobs`,{});
await until(async()=> (await api(`/api/jobs/${analysis.id}`)).status==='COMPLETED','analysis');
const snapshot=(await api(`/api/workspaces/${ws.id}`)).activeSnapshotId;
const graph=await api(`/api/snapshots/${snapshot}/graph`);
const controller=graph.nodes.find(n=>n.simpleName==='OrderController');assert.ok(controller);
await api(`/api/workspaces/${ws.id}/documents`,{title:'Synthetic smoke-test guide',content:'This fixture demonstrates an order workflow. This document and all model responses in this run are synthetic UI test data.'});
const bulk=await api(`/api/explanation-jobs?workspaceId=${ws.id}&snapshotId=${snapshot}&concurrency=4`,{});
await until(async()=>(await api(`/api/snapshots/${snapshot}/symbols/${controller.id}/explanation`)).preExplanation,'architecture drafts');
const page=await(await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let sequence=0;const pending=new Map();const errors=[];
socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const wait=pending.get(message.id);if(wait){pending.delete(message.id);message.error?wait.reject(Error(JSON.stringify(message.error))):wait.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown'){errors.push(message.params.exceptionDetails.text);}};
function cdp(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function screenshot(name){await pause(1600);const result=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${name}.png`,Buffer.from(result.data,'base64'));}
async function navigate(symbol){await cdp('Page.navigate',{url:`${base}/?snapshotId=${snapshot}&selectedSymbol=${encodeURIComponent(symbol)}`});await until(()=>evaluate(`document.querySelector('.subject-heading h2')?.textContent.length>0`),'inspector navigation');}
const cy="document.querySelector('.graph-canvas')._cyreg.cy";
await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:980,deviceScaleFactor:1,mobile:false});
await navigate(controller.id);
await until(()=>evaluate(`document.querySelector('.architecture-draft')?.textContent.includes('Synthetic')`),'draft display');
assert.equal(await evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length`),0);
await screenshot('architecture-draft');
await fetch(model+'/release');
await until(async()=>(await api(`/api/jobs/${bulk.jobId}`)).status==='COMPLETED','bulk completion');
await until(()=>evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length===1`),'live READY inspector refresh');
await until(()=>evaluate(`${cy}.nodes().some(n=>n.data('explanationStatus')==='READY'&&decodeURIComponent(n.data('card')).includes('id="sparkle"'))`),'canvas sparkle');
const readyGraph=await api(`/api/snapshots/${snapshot}/graph`);
assert.ok(readyGraph.edges.every(e=>e.explanationStatus==='NOT_REQUESTED'));
assert.ok(readyGraph.nodes.filter(n=>['CLASS','METHOD'].includes(n.kind)).every(n=>n.explanationStatus==='READY'));
await screenshot('class-ready');
// Refresh must restart inspector polling after a terminal READY state and preserve the viewport.
const before=await evaluate(`({zoom:${cy}.zoom(),pan:${cy}.pan()})`);
await evaluate(`document.querySelector('.explanation-section button.primary').click()`);
await until(()=>evaluate(`document.querySelector('.explanation-section .tag')?.textContent==='ready'`),'refresh after READY');
await pause(2500);
const after=await evaluate(`({zoom:${cy}.zoom(),pan:${cy}.pan()})`);
assert.deepEqual(after,before,'explanation updates preserve pan and zoom');
const method=readyGraph.nodes.find(n=>n.kind==='METHOD'&&n.parentId===controller.id&&readyGraph.edges.some(e=>e.sourceId===n.id&&e.kind==='CALLS'));
assert.ok(method);await navigate(method.id);
await until(()=>evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length===1`),'method READY');
await screenshot('method-ready');
await evaluate(`${cy}.edges().filter(e=>e.data('kind')==='CALLS')[0].emit('tap');true`);
await until(()=>evaluate(`document.querySelector('.inspector-top')?.textContent.includes('Relationship')`),'edge inspector');
assert.equal(await evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length`),0);
await evaluate(`document.querySelector('.explanation-section button.primary').click()`);
await until(()=>evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length===1`),'on-demand edge READY');
// Explain remaining occurrences explicitly if this projection grouped more than one call site.
const count=await evaluate(`document.querySelector('.inspector section select')?.options.length||1`);
for(let i=1;i<count;i++){
 await evaluate(`{const s=document.querySelector('.inspector section select');s.value='${i}';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
 await until(()=>evaluate(`document.querySelector('.explanation-section .tag')?.textContent==='not requested'`),'new occurrence');
 await evaluate(`document.querySelector('.explanation-section button.primary').click()`);
 await until(()=>evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length===1`),'occurrence READY');
}
await until(()=>evaluate(`${cy}.edges().some(e=>e.data('explanationStatus')==='READY'&&e.data('label').startsWith('✦'))`),'edge canvas sparkle');
await screenshot('edge-ready');
await evaluate(`${cy}.edges().filter(e=>e.data('explanationStatus')==='READY')[0].emit('mouseover');true`);
await until(()=>evaluate(`document.querySelectorAll('.edge-hover .gemini-badge').length===1`),'edge hover sparkle');
await screenshot('edge-hover-ready');
await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.inspector-top .gemini-badge svg')).animationName`),'none');
await cdp('Emulation.setDeviceMetricsOverride',{width:430,height:900,deviceScaleFactor:1,mobile:false});
await screenshot('narrow-edge-ready');
assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'no horizontal page overflow');
// Synthesis budget failures remain readable on a narrow screen and do not hide the graph.
await api('/api/model-profiles',{contextBudget:8192});
await api(`/api/workspaces/${ws.id}/documents`,{title:'Oversized synthetic guide',content:'x'.repeat(12000)});
const failed=await api(`/api/explanation-jobs?workspaceId=${ws.id}&snapshotId=${snapshot}`,{});
await until(async()=>(await api(`/api/jobs/${failed.jobId}`)).status==='FAILED','oversized synthesis');
await until(()=>evaluate(`document.querySelector('.error-banner')?.textContent.includes('Context Budget')`),'visible budget error');
await screenshot('narrow-synthesis-failed');
assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'budget error has no horizontal overflow');
assert.deepEqual(errors,[],'browser runtime errors');
await fs.writeFile(`${output}/run.json`,JSON.stringify({snapshot,workspace:ws.id,bulk:bulk.jobId,symbolCount:readyGraph.nodes.filter(n=>['CLASS','METHOD'].includes(n.kind)).length,screenshots:7}));
socket.close();
console.log('PASS: drafts, live class/method READY badges, explicit edge generation, edge hover, refresh polling, viewport preservation, reduced motion, narrow layout, visible synthesis failure');
