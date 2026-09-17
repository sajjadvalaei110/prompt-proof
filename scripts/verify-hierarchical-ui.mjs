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
socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const wait=pending.get(message.id);if(wait){pending.delete(message.id);message.error?wait.reject(Error(JSON.stringify(message.error))):wait.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown'){const d=message.params.exceptionDetails;errors.push(`${d.text}: ${d.exception?.description||JSON.stringify(d)}`);}};
function cdp(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function screenshot(name){await pause(1600);const result=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(`${output}/${name}.png`,Buffer.from(result.data,'base64'));}
async function navigate(symbol){await cdp('Page.navigate',{url:`${base}/?snapshotId=${snapshot}&selectedSymbol=${encodeURIComponent(symbol)}`});await until(()=>evaluate(`document.querySelector('.subject-heading h2')?.textContent.length>0`),'inspector navigation');}
const cy="document.querySelector('.graph-canvas')._cyreg.cy";
async function rightClickNode(id){
 const point=await evaluate(`(()=>{const position=${cy}.getElementById('${id}').renderedPosition(),box=document.querySelector('.graph-canvas').getBoundingClientRect();return{x:box.left+position.x,y:box.top+position.y}})()`);
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'right',buttons:2,clickCount:1});
 await pause(50);
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'right',buttons:0,clickCount:1});
}
const centerNodeId=()=>evaluate(`(()=>{const core=${cy},center={x:core.width()/2,y:core.height()/2};return [...core.nodes()].sort((a,b)=>{const ap=a.renderedPosition(),bp=b.renderedPosition();return Math.hypot(ap.x-center.x,ap.y-center.y)-Math.hypot(bp.x-center.x,bp.y-center.y)})[0].id()})()`);
await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:980,deviceScaleFactor:1,mobile:false});
await navigate(controller.id);
await until(()=>evaluate(`document.querySelector('.architecture-draft')?.textContent.includes('Synthetic')`),'draft display');
assert.equal(await evaluate(`document.querySelectorAll('.inspector-top .gemini-badge').length`),0);
// The package tree owns the remaining navigation height, renders a dotted-name trie, and scrolls.
assert.equal(await evaluate(`(()=>{const tree=document.querySelector('.scope-tree'),list=document.querySelector('.package-tree');const t=getComputedStyle(tree),l=getComputedStyle(list);return t.display==='flex'&&t.flexDirection==='column'&&t.minHeight==='0px'&&l.overflowY==='auto'&&l.minHeight==='0px'})()`),true,'scope tree flex/overflow chain');
assert.equal(await evaluate(`document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="true"]').length<document.querySelectorAll('.package-tree .tree-branch').length`),true,'branching namespaces start collapsed');
// A collapsed branch's children are not in the DOM at all (unlike native <details>, which always
// keeps them there): each click can reveal new, still-collapsed grandchildren, so clicking once and
// polling separately can never converge. Re-click on every poll attempt instead.
await until(()=>evaluate(`(()=>{[...document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="false"]')].forEach(b=>b.click());return document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="true"]').length===document.querySelectorAll('.package-tree .tree-branch').length})()`),'expand overflow fixture');
assert.equal(await evaluate(`document.querySelector('.package-tree').scrollHeight>document.querySelector('.package-tree').clientHeight`),true,'large package tree overflows panel');
assert.equal(await evaluate(`(()=>{const list=document.querySelector('.package-tree');list.scrollTop=160;return list.scrollTop>0})()`),true,'package tree scrolls internally');
assert.deepEqual(await evaluate(`(()=>{const names=[];let branch=document.querySelector('.scope-row-namespace');for(let i=0;i<4&&branch;i++){names.push(branch.querySelector(':scope > .scope-row-package-row .scope-label').textContent.trim());branch=branch.querySelector(':scope > .tree-branch-children > .scope-row-namespace, :scope > .tree-branch-children > .scope-row-package')}return names})()`),['com','example','overflow','area00'],'dotted package nesting');
await evaluate(`document.querySelector('.package-tree').scrollTop=0`);
const rootCheckbox=`document.querySelector('.scope-row-namespace .scope-row-package-row .scope-checkbox')`;
await evaluate(`document.querySelector('.scope-toolbar button:nth-of-type(2)').click()`);
assert.equal(await evaluate(`${rootCheckbox}.checked||${rootCheckbox}.indeterminate`),false,'Clear unchecks namespace');
await evaluate(`document.querySelector('.scope-label[title="com.example.spring.controller"]').closest('.scope-row-package-row').querySelector('.scope-checkbox').click()`);
assert.equal(await evaluate(`${rootCheckbox}.indeterminate`),true,'ancestor namespace becomes indeterminate');
await evaluate(`${rootCheckbox}.click()`);
assert.equal(await evaluate(`${rootCheckbox}.checked`),false,'clicking an indeterminate namespace clears descendants');
await evaluate(`${rootCheckbox}.click()`);
assert.equal(await evaluate(`${rootCheckbox}.checked`),true,'checking a synthetic namespace selects every real package beneath it');
const scopeFingerprint=()=>evaluate(`JSON.stringify([...document.querySelectorAll('.scope-checkbox')].map(input=>[input.checked,input.indeterminate]))`);
const explicitScope=await scopeFingerprint();
// Inspection, exploration, route, search, brand, and Code map navigation must preserve scope.
async function scopeUnchanged(label,action){await action();await pause(100);assert.equal(await scopeFingerprint(),explicitScope,label);}
await scopeUnchanged('search result preserves scope',async()=>{await evaluate(`{const input=document.querySelector('#global-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'OrderService');input.dispatchEvent(new Event('input',{bubbles:true}));}`);await until(()=>evaluate(`!!document.querySelector('.search-results button')`),'service search result');await evaluate(`document.querySelector('.search-results button').click()`);});
await scopeUnchanged('graph node inspection preserves scope',async()=>evaluate(`${cy}.nodes()[0].emit('tap');true`));
await scopeUnchanged('graph node exploration preserves scope',async()=>evaluate(`${cy}.nodes()[0].emit('dbltap');true`));
await scopeUnchanged('inspector exploration preserves scope',async()=>{await evaluate(`{const input=document.querySelector('#global-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'OrderController');input.dispatchEvent(new Event('input',{bubbles:true}));}`);await until(()=>evaluate(`!!document.querySelector('.search-results button')`),'controller search result');await evaluate(`document.querySelector('.search-results button').click()`);await evaluate(`[...document.querySelectorAll('.inspector .text-button')].find(button=>button.textContent.includes('View methods')).click()`);});
await scopeUnchanged('route entry point preserves scope',async()=>{await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(button=>button.textContent.includes('Entry points')).click()`);await evaluate(`document.querySelector('.route-card').click()`);});
await scopeUnchanged('brand navigation preserves scope',async()=>evaluate(`document.querySelector('.brand').click()`));
await scopeUnchanged('Code map navigation preserves scope',async()=>evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(button=>button.textContent.includes('Code map')).click()`));
await scopeUnchanged('graph edge inspection preserves scope',async()=>evaluate(`{const edge=${cy}.edges()[0];if(edge)edge.emit('tap');true}`));
await screenshot('scope-tree-desktop');
// Native menus are suppressed; Cytoscape right-click/long-press opens an accessible scope action.
assert.equal(await evaluate(`document.querySelector('.graph-canvas').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`),false,'native graph context menu prevented');
const contextNodeId=await centerNodeId();await rightClickNode(contextNodeId);
await until(()=>evaluate(`!!document.querySelector('.graph-context-menu')`),'graph context menu');
await screenshot('scope-context-menu');
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
assert.equal(await evaluate(`!!document.querySelector('.graph-context-menu')`),false,'Escape dismisses context menu');
await rightClickNode(contextNodeId);await until(()=>evaluate(`!!document.querySelector('.graph-context-menu')`),'context menu reopen');
await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
assert.equal(await evaluate(`!!document.querySelector('.graph-context-menu')`),false,'outside click dismisses context menu');
const packageNode=await evaluate(`${cy}.getElementById('${contextNodeId}').data()`);
await rightClickNode(packageNode.id);
await until(()=>evaluate(`!!document.querySelector('.graph-context-menu')`),'package remove menu');
await evaluate(`document.querySelector('.graph-context-menu button').click()`);
await until(()=>evaluate(`!${cy}.getElementById('${packageNode.id}').length`),'package removed from scope');
// Restore all explicitly, then exercise the same action for a class and a method/owner class.
await evaluate(`document.querySelector('.scope-toolbar button:first-child').click();[...document.querySelectorAll('.segmented button')].find(button=>button.textContent==='Classes').click()`);
await until(()=>evaluate(`${cy}.nodes().length>1`),'class graph');
const classNodeId=await centerNodeId(),classNode=await evaluate(`${cy}.getElementById('${classNodeId}').data()`);
await rightClickNode(classNode.id);await until(()=>evaluate(`!!document.querySelector('.graph-context-menu')`),'class remove menu');await evaluate(`document.querySelector('.graph-context-menu button').click()`);
await until(()=>evaluate(`!${cy}.getElementById('${classNode.id}').length`),'class removed from scope');
await evaluate(`document.querySelector('.scope-toolbar button:first-child').click();[...document.querySelectorAll('.segmented button')].find(button=>button.textContent==='Methods').click()`);
await until(()=>evaluate(`${cy}.nodes().length>1`),'method graph');
const methodNodeId=await centerNodeId(),methodNode=await evaluate(`${cy}.getElementById('${methodNodeId}').data()`);const methodOwner=graph.nodes.find(node=>node.id===methodNode.parentId);assert.ok(methodOwner);
await rightClickNode(methodNode.id);await until(()=>evaluate(`!!document.querySelector('.graph-context-menu')`),'method remove menu');await evaluate(`document.querySelector('.graph-context-menu button').click()`);
await until(()=>evaluate(`!${cy}.nodes().some(node=>node.data('parentId')==='${methodOwner.id}')`),'method owner class removed from scope');
await evaluate(`document.querySelector('.scope-toolbar button:first-child').click();{const input=document.querySelector('#global-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'OrderController');input.dispatchEvent(new Event('input',{bubbles:true}));}`);
await until(()=>evaluate(`!!document.querySelector('.search-results button')`),'controller search result restored');
await evaluate(`document.querySelector('.search-results button').click()`);
await until(()=>evaluate(`document.querySelector('.architecture-draft')?.textContent.includes('Synthetic')`),'draft restored after scope checks');
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
// Assert the canvas badge HERE, with only the FIRST occurrence explained. A merged line is READY
// when ANY occurrence is ready; explaining every occurrence first (as the loop below does) would
// make this pass even if the rule regressed to requiring all of them, which is unreachable in
// practice because a CALLS line almost always also carries a derived DEPENDS_ON.
await until(()=>evaluate(`${cy}.edges().some(e=>e.data('explanationStatus')==='READY'&&e.data('label').startsWith('✦'))`),'edge canvas sparkle from a single ready occurrence');
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
await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(button=>button.textContent==='explorer').click()`);
await screenshot('narrow-scope-tree');
await until(()=>evaluate(`(()=>{[...document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="false"]')].forEach(b=>b.click());return document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="true"]').length===document.querySelectorAll('.package-tree .tree-branch').length})()`),'expand narrow overflow fixture');
assert.equal(await evaluate(`document.querySelector('.package-tree').scrollHeight>document.querySelector('.package-tree').clientHeight`),true,'narrow package tree scrolls');
await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(button=>button.textContent==='map').click()`);
await screenshot('narrow-edge-ready');
assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'no horizontal page overflow');
// Large input succeeds through visible, bounded architecture stages at a modest model window.
await api('/api/model-profiles',{contextBudget:8192,outputBudget:1024});
await api(`/api/workspaces/${ws.id}/documents`,{title:'Large synthetic guide',content:'Order shipment policy. '.repeat(2800)+'DOCUMENT TAIL'});
await fetch(model+'/hold-context');
await evaluate(`document.querySelector('.queue-summary button').click();true`);
let batched;
await until(async()=>{const status=await api(`/api/workspaces/${ws.id}/queue-status`);if(status.activeJobId){batched={jobId:status.activeJobId};return true;}return false;},'second bulk start');
await until(()=>evaluate(`(()=>{const text=document.querySelector('.synthesis-progress')?.textContent||'';return text.includes('Summarizing project context · level 0 batch 1')&&text.includes('validated')})()`),'visible batch progress');
assert.equal(await evaluate(`document.querySelectorAll('.synthesis-progress>i').length`),1,'in-flight request indicator');
await until(()=>evaluate(`/ · [1-9]\\d*s ·/.test(document.querySelector('.synthesis-progress')?.textContent||'')`),'advancing request timer');
await screenshot('narrow-context-progress');
assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'batch progress has no horizontal overflow');
await fetch(model+'/release-context');
await until(async()=>(await api(`/api/jobs/${batched.jobId}`)).status==='COMPLETED','large context bulk completion');
await until(()=>evaluate(`(()=>{const footer=document.querySelector('.app-footer')?.textContent||'';const button=document.querySelector('.queue-summary button')?.textContent||'';return footer.includes('Explain all completed')&&footer.includes('61 explained')&&button.includes('Explain all')&&!button.includes('Stop')})()`),'terminal queue UI');
const queue=await api(`/api/workspaces/${ws.id}/queue-status`);
assert.ok(queue.synthesisCompleted>2,'large project used multiple durable batches');
await screenshot('narrow-batched-ready');
// Settings accept model capacities beyond the former arbitrary UI caps.
await cdp('Emulation.setDeviceMetricsOverride',{width:1500,height:980,deviceScaleFactor:1,mobile:false});
await evaluate(`document.querySelector('button[aria-label="Model settings"]').click()`);
await until(()=>evaluate(`!!document.querySelector('.settings-grid input')`),'settings');
assert.equal(await evaluate(`document.querySelector('.settings-grid input').hasAttribute('max')`),false);
assert.equal(await evaluate(`document.querySelectorAll('.settings-grid input')[1].hasAttribute('max')`),false);
await screenshot('model-context-settings');
assert.deepEqual(errors,[],'browser runtime errors');
await fs.writeFile(`${output}/run.json`,JSON.stringify({snapshot,workspace:ws.id,bulk:bulk.jobId,symbolCount:readyGraph.nodes.filter(n=>['CLASS','METHOD'].includes(n.kind)).length,screenshots:12}));
socket.close();
console.log('PASS: scope scrolling/hierarchy/explicit mutations, graph right-click removal, drafts, READY badges, edge generation/hover, polling, viewport, reduced motion, narrow layout, bounded batches, settings');
