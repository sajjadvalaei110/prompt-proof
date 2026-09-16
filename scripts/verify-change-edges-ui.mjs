// Change-edges browser check (one line per direction, directional selection emphasis, file-grouped
// evidence) via Chromium CDP and Node's built-in WebSocket; no npm dependency.
//
// Usage: start the packaged jar and a headless Chromium with --remote-debugging-port, analyze a COPY of
// test-fixtures/change-edges-fixture through the API, then:
//   node scripts/verify-change-edges-ui.mjs <appBase> <chromiumDebugBase> <snapshotId> <outputDir>
// Writes report.json and screenshots to <outputDir>; exits non-zero on the first unmet check.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base,debug,snapshot,outDir]=process.argv.slice(2);
await fs.mkdir(outDir,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const page=await (await fetch(debug+'/json/new?about:blank',{method:'PUT'})).json();
const socket=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
let seq=0;const pending=new Map();const errors=[];
socket.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id){const w=pending.get(m.id);if(w){pending.delete(m.id);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value).join(' '));};
const cdp=(method,params={})=>{const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});};
const evaluate=async expr=>{const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const shot=async(name,clip)=>{await pause(400);const r=await cdp('Page.captureScreenshot',{format:'png',...(clip?{clip:{...clip,scale:1}}:{})});await fs.writeFile(`${outDir}/${name}.png`,Buffer.from(r.data,'base64'));console.log('screenshot',name);};
const until=async(expr,label)=>{for(let i=0;i<100;i++){if(await evaluate(expr))return;await pause(150);}throw Error('Timed out: '+label);};
const click=async(x,y,count=1)=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await cdp('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:count});};
await cdp('Page.enable');await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:`${base}/?snapshotId=${snapshot}`});
const CY=`document.querySelector('.graph-canvas')._cyreg.cy`;
await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`,'graph');
await evaluate(`[...document.querySelectorAll('.segmented button')].find(b=>b.textContent==='Classes').click()`);
await until(`${CY}.nodes().some(n=>n.data('kind')!=='PACKAGE')`,'classes level');
await pause(600);
const results={};
const nodePoint=async name=>evaluate(`(()=>{const cy=${CY};const n=cy.nodes().filter(n=>n.data('simpleName')===${JSON.stringify(name)})[0];const p=n.renderedPosition();const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y,id:n.id()};})()`);
// Requirement 1: at most one line per ordered pair; reverse direction is its own line; width follows strength.
results.edges=await evaluate(`${CY}.edges().map(e=>({s:e.source().data('simpleName'),t:e.target().data('simpleName'),w:e.data('strengthWidth'),rendered:parseFloat(e.style('width')),n:e.data('occurrenceCount'),kinds:e.data('kindCounts'),label:e.data('label')}))`);
const pairKeys=results.edges.map(e=>e.s+'->'+e.t);
assert.equal(new Set(pairKeys).size,pairKeys.length,'no ordered pair has more than one line');
assert.ok(pairKeys.includes('Hub->Peer')&&pairKeys.includes('Peer->Hub'),'mutual relation draws exactly two lines');
const hubDep=results.edges.find(e=>e.s==='Hub'&&e.t==='Dep'),peerHub=results.edges.find(e=>e.s==='Peer'&&e.t==='Hub');
assert.ok(hubDep.rendered>peerHub.rendered,'stronger relation renders thicker');
// Arrange around Hub for a readable picture (double-click), then single-click to inspect.
let hub=await nodePoint('Hub');
await click(hub.x,hub.y,1);await click(hub.x,hub.y,2);await pause(800);
await evaluate(`document.querySelector('.zoom-controls button:last-child').click()`);await pause(700);
hub=await nodePoint('Hub');
await click(hub.x,hub.y,1);await pause(700);
results.selection=await evaluate(`(()=>{const cy=${CY};const cls=c=>['flow-out','flow-in','rel-out','rel-in','rel-both','muted'].filter(k=>c.hasClass(k));return {nodes:cy.nodes().map(n=>({n:n.data('simpleName'),c:cls(n),outline:n.style('outline-color'),border:n.style('border-color'),borderStyle:n.style('border-style')})),edges:cy.edges().map(e=>({e:e.source().data('simpleName')+'->'+e.target().data('simpleName'),c:cls(e),color:e.style('line-color')}))};})()`);
const nodeCls=n=>results.selection.nodes.find(x=>x.n===n).c, edgeCls=e=>results.selection.edges.find(x=>x.e===e).c;
assert.ok(edgeCls('Hub->Dep').includes('flow-out')&&edgeCls('Hub->Peer').includes('flow-out'),'outgoing lines are flow-out');
assert.ok(edgeCls('Caller->Hub').includes('flow-in')&&edgeCls('Peer->Hub').includes('flow-in'),'incoming lines are flow-in');
assert.ok(nodeCls('Dep').includes('rel-out'),'output-only resource gets the blue halo');
assert.ok(nodeCls('Caller').includes('rel-in'),'input-only resource gets the red halo');
assert.ok(nodeCls('Peer').includes('rel-both'),'input-and-output resource gets the purple halo');
assert.ok(nodeCls('Loner').includes('muted')&&!nodeCls('Loner').some(c=>c.startsWith('rel')),'unrelated resource gets no halo');
// Direction must not be carried by hue alone (WCAG 2.1 SC 1.4.1): border-style separates the three
// halo kinds, so the picture still reads for a viewer with a colour-vision deficiency.
const borderStyle=n=>results.selection.nodes.find(x=>x.n===n).borderStyle;
const haloStyles=['Dep','Caller','Peer'].map(borderStyle);
assert.equal(new Set(haloStyles).size,3,'output-only, input-only and mutual halos differ by border style, not only by colour: '+JSON.stringify(haloStyles));
assert.equal(borderStyle('Peer'),'double','the mutual halo is the double border');
// Animation: dash offset and halo width change over time on related elements only.
const sample=()=>evaluate(`(()=>{const cy=${CY};const e=cy.edges().filter(e=>e.hasClass('flow-out'))[0];const n=cy.nodes('.rel-both')[0];return {dash:parseFloat(e.style('line-dash-offset')),outline:parseFloat(n.style('outline-width')),glow:parseFloat(e.style('underlay-opacity'))};})()`);
const a1=await sample();await pause(160);const a2=await sample();await pause(160);const a3=await sample();
results.animation={a1,a2,a3};
assert.notEqual(a1.dash,a2.dash,'dashes move');assert.notEqual(a1.outline,a2.outline,'halo pulses');
// Direction, not just movement: the pattern must travel source -> target, which Cytoscape draws as a
// DECREASING line-dash-offset. Flipping the sign in the animation loop would run the dashes backwards
// against the arrowhead while still changing every frame, so an inequality check alone cannot see it.
// Samples are ~160ms apart (~7px at .045px/ms), well inside the 21px dash period, so one step can
// never be mistaken for a backwards move; the phase itself wraps only every ~513s, far beyond this run.
assert.ok(a1.dash-a2.dash>0&&a2.dash-a3.dash>0,`dashes travel source -> target, offset decreasing (got ${a1.dash} -> ${a2.dash} -> ${a3.dash})`);
await shot('req2-node-selected-flow');
const canvasRect=await evaluate(`(()=>{const r=document.querySelector('.graph-stage').getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};})()`);
await shot('req2-node-selected-flow-canvas',canvasRect);await pause(250);await shot('req2-node-selected-flow-canvas-later',canvasRect);
// Deselect: close the inspector; animation bypass styles must be gone.
await evaluate(`document.querySelector('[aria-label="Close inspector"]').click()`);await pause(400);
// Assert the observable result through the public style API rather than reaching into
// `_private.style` for bypass flags: a leaked animation bypass is exactly a computed value that no
// longer matches the stylesheet default (line-dash-offset 0, outline-width 0), which is what the
// user would actually see, and it does not break on a Cytoscape patch that moves internal storage.
results.afterClose=await evaluate(`(()=>{const cy=${CY};const leaked=cy.elements().filter(e=>parseFloat(e.style('line-dash-offset'))!==0||parseFloat(e.style('outline-width'))!==0);return {classes:cy.elements('.flow-out,.flow-in,.rel-out,.rel-in,.rel-both').length,leaked:leaked.length,offenders:leaked.map(e=>({id:e.id(),dash:e.style('line-dash-offset'),outline:e.style('outline-width')})).slice(0,3)};})()`);
assert.deepEqual({classes:results.afterClose.classes,leaked:results.afterClose.leaked},{classes:0,leaked:0},'deselect clears highlight classes and leaves no animated style behind: '+JSON.stringify(results.afterClose.offenders));
// Requirement 3: click the Hub -> Dep line, open its evidence.
const edgeMid=await evaluate(`(()=>{const cy=${CY};const e=cy.edges().filter(e=>e.source().data('simpleName')==='Hub'&&e.target().data('simpleName')==='Dep')[0];const p=e.renderedMidpoint();const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};})()`);
await click(edgeMid.x,edgeMid.y);await until(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`,'edge inspector');
// Inspecting a line must emphasize its two endpoint cards, not dim them with the rest of the map.
results.edgeEndpoints=await evaluate(`(()=>{const cy=${CY};const e=cy.edges().filter(e=>e.source().data('simpleName')==='Hub'&&e.target().data('simpleName')==='Dep')[0];const ns=e.connectedNodes();return {names:ns.map(n=>n.data('simpleName')),neighbor:ns.every(n=>n.hasClass('neighbor')),muted:ns.some(n=>n.hasClass('muted'))};})()`);
assert.deepEqual(results.edgeEndpoints.names.sort(),['Dep','Hub'],'the inspected line reports both endpoints');
assert.ok(results.edgeEndpoints.neighbor,'both endpoint cards are emphasized as neighbors');
assert.ok(!results.edgeEndpoints.muted,'neither endpoint card is dimmed as unrelated');
results.edgeInspector=await evaluate(`(()=>{const i=document.querySelector('.inspector');return {heading:i.querySelector('.subject-heading').innerText,kinds:[...i.querySelectorAll('.kind-breakdown li')].map(l=>l.innerText.replace(/\\s+/g,' ')),options:[...i.querySelectorAll('select option')].map(o=>o.textContent),button:[...i.querySelectorAll('button')].map(b=>b.textContent).filter(t=>t.includes('evidence')||t.includes('occurrence'))};})()`);
await shot('req3-edge-inspector');
await evaluate(`[...document.querySelectorAll('.inspector button')].find(b=>b.textContent.startsWith('View source evidence')).click()`);
await until(`document.querySelectorAll('.source-dialog section').length>0`,'evidence dialog');
results.evidenceAll=await evaluate(`(()=>{const d=document.querySelector('.source-dialog');return {sub:d.querySelector('header p').textContent,files:[...d.querySelectorAll('section')].map(s=>({path:s.querySelector('.source-path').textContent,highlighted:[...s.querySelectorAll('.code-line.highlighted')].map(l=>l.querySelector('span').textContent+':'+l.title)}))};})()`);
assert.equal(results.evidenceAll.files.length,new Set(results.evidenceAll.files.map(f=>f.path)).size,'no file repeated');
assert.equal(results.evidenceAll.files.length,1,'Hub.java appears once');
assert.ok(results.evidenceAll.files[0].highlighted.length>=4,'several lines highlighted in the one file');
await shot('req3-evidence-one-file-many-lines');
await evaluate(`document.querySelector('[aria-label="Close source"]').click()`);await pause(300);
// The single DEPENDS_ON occurrence (the original bug: its rows repeated the file) is grouped too.
const depIndex=await evaluate(`[...document.querySelectorAll('.inspector select option')].findIndex(o=>o.textContent.startsWith('depends on'))`);
await evaluate(`(()=>{const s=document.querySelector('.inspector select');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,String(${depIndex}));s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(300);
await evaluate(`[...document.querySelectorAll('.inspector button')].find(b=>b.textContent==='View selected occurrence only').click()`);
await until(`document.querySelectorAll('.source-dialog section').length>0`,'single occurrence dialog');
results.evidenceSingleDependsOn=await evaluate(`[...document.querySelectorAll('.source-dialog section')].map(s=>({path:s.querySelector('.source-path').textContent,highlighted:s.querySelectorAll('.code-line.highlighted').length}))`);
assert.equal(results.evidenceSingleDependsOn.length,1,'single DEPENDS_ON occurrence shows its file once');
await shot('req3-single-depends-on-occurrence');
// A filter change keeps the merged line's ID but shrinks its occurrences: the chosen occurrence must
// stay the same occurrence (held by ID), not whatever now sits at the old index.
await evaluate(`document.querySelector('[aria-label="Close source"]').click()`);await pause(300);
const setSelect=async(selector,value)=>evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,${JSON.stringify(String(value))});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const lastCalls=await evaluate(`[...document.querySelectorAll('.inspector select option')].findIndex(o=>o.textContent==='calls 4 of 4')`);
await setSelect('.inspector label select',lastCalls);await pause(300);
await setSelect('select[aria-label="Relationship kind"]','CALLS');await pause(600);
results.occurrenceAfterFilter=await evaluate(`(()=>{const s=document.querySelector('.inspector label select');return {selected:s.options[s.selectedIndex].textContent,options:[...s.options].map(o=>o.textContent),notice:document.querySelector('.inspector .notice')?.textContent||''};})()`);
assert.equal(results.occurrenceAfterFilter.selected,'calls 4 of 4','chosen occurrence survives a filter change that removes other kinds');
assert.ok(!results.occurrenceAfterFilter.options.some(o=>o.startsWith('depends on')),'filtered kinds leave the occurrence list');
assert.equal(results.occurrenceAfterFilter.notice,'','line containing the filtered kind stays drawn, so no filtered-out notice');
results.pageErrors=errors;
assert.equal(errors.length,0,'no page errors: '+JSON.stringify(errors));
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(results,null,1));
console.log(JSON.stringify(results,null,1));
console.log('ALL CHECKS PASSED');
socket.close();
