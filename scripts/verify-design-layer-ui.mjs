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

// Real pointer and keyboard input (CDP Input), in client pixels, for the direct-manipulation checks.
const mouse=(type,x,y,extra={})=>cdp('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:1,...extra});
const clickAt=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y);await mouse('mouseReleased',x,y);};
const dblAt=async(x,y)=>{await clickAt(x,y);await mouse('mousePressed',x,y,{clickCount:2});await mouse('mouseReleased',x,y,{clickCount:2});};
const key=async(k,code,vk)=>{await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});};
const typeText=text=>cdp('Input.insertText',{text});
const enter=()=>key('Enter','Enter',13), escape=()=>key('Escape','Escape',27);
// A card's rendered box in client pixels; fx/fy pick a point inside it.
const cardPoint=(id,fx=.5,fy=.5)=>evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${q(id)}),bb=n.renderedBoundingBox({includeLabels:false,includeOverlays:false}),r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.left+bb.x1+(bb.x2-bb.x1)*${fx},y:r.top+bb.y1+(bb.y2-bb.y1)*${fy}};})()`);
const rectOf=selector=>evaluate(`(()=>{const el=document.querySelector(${q(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
// Client pixels to model coordinates.
const toModel=p=>evaluate(`(()=>{const cy=${CY},r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:(${p.x}-r.left-cy.pan().x)/cy.zoom(),y:(${p.y}-r.top-cy.pan().y)/cy.zoom()};})()`);
const designOverlay=async()=>(await (await fetch(`${base}/api/workspaces/${wsA}/design`)).json());
const draftFocused=()=>evaluate(`document.activeElement?.matches('.design-draft-card input')===true`);
/** Hover an expanded box (its top-left padding), then click its "+" slot; returns the slot's model center. */
async function openSlot(boxId,label){
  // Bring the box to the middle of the canvas so its slot is not under the minimap or legend.
  await evaluate(`${CY}.center(${CY}.getElementById(${q(boxId)})),true`);
  await mouse('mouseMoved',5,5);
  await pause(300);
  const corner=await cardPoint(boxId,0,0);
  await mouse('mouseMoved',corner.x+14,corner.y+14);
  await until(`document.querySelector('.design-slot')?.dataset.slotFor===${q(boxId)}`,'slot shown on hover of '+boxId);
  const slot=await rectOf('.design-slot');
  assert.ok((await evaluate(`document.querySelector('.design-slot').textContent`)).includes(label),'slot says '+label);
  await mouse('mouseMoved',slot.x,slot.y);
  try{await until(`document.querySelector('.design-slot')?.classList.contains('hot')`,'slot hot under the pointer',30);}
  catch(e){await mouse('mouseMoved',slot.x+2,slot.y+2);await pause(300);console.log('DEBUG2',await evaluate(`document.querySelector('.design-slot')?.classList.contains('hot')`),JSON.stringify(await evaluate(`(()=>{const cy=${CY},r=document.querySelector('.graph-canvas').getBoundingClientRect();const m=cy.renderer().projectIntoViewport(${slot.x},${slot.y});const near=cy.renderer().findNearestElement(m[0],m[1],true,false);return {near:near&&near.id(),m};})()`)));await shot('debug-slot');console.log('DEBUG',JSON.stringify(await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${q(boxId)}),r=document.querySelector('.graph-canvas').getBoundingClientRect();const bb=n.renderedBoundingBox({includeLabels:false,includeOverlays:false});return {slot:${q(JSON.stringify(slot))},canvas:{l:r.left,t:r.top,w:r.width,h:r.height},bb,minW:n.data('minW'),minH:n.data('minH'),el:document.elementFromPoint(${slot.x},${slot.y})?.className};})()`)));throw e;}
  await clickAt(slot.x,slot.y);
  await until(`!!document.querySelector('.design-draft-card input')`,'draft card after clicking the slot');
  return {slot,center:await toModel({x:slot.x,y:slot.y})};
}

// 1. Right-click on empty canvas -> Add package: a card appears there at once, its title focused.
assert.equal(await evaluate(`[...document.querySelectorAll('.design-controls button')].some(b=>b.textContent.includes('Add'))`),false,'the toolbar Add button is gone');
// A real right-click on empty canvas, above the cards.
const emptySpot=await evaluate(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+90};})()`);
assert.equal(await evaluate(`(()=>{const cy=${CY},r=document.querySelector('.graph-canvas').getBoundingClientRect(),x=(${emptySpot.x}-r.left-cy.pan().x)/cy.zoom(),y=(${emptySpot.y}-r.top-cy.pan().y)/cy.zoom();return cy.nodes().some(n=>{const b=n.boundingBox();return x>=b.x1-150&&x<=b.x2+150&&y>=b.y1-130&&y<=b.y2+130;});})()`),false,'the right-click spot is empty');
await mouse('mouseMoved',emptySpot.x,emptySpot.y);
await mouse('mousePressed',emptySpot.x,emptySpot.y,{button:'right',buttons:2});
await mouse('mouseReleased',emptySpot.x,emptySpot.y,{button:'right',buttons:0});
await until(`[...document.querySelectorAll('.graph-context-menu .design-menuitem')].some(b=>b.textContent.includes('Add package'))`,'canvas design menu');
await clickText('.graph-context-menu .design-menuitem','Add package');
await until(`!!document.querySelector('.design-draft-card input')`,'inline package draft');
assert.equal(await draftFocused(),true,'the new card title has keyboard focus');
assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`),false,'no modal');
const packageDraft=await rectOf('.design-draft-card');
await typeText('com.example.audit');
await shot('02-inline-package-draft');
await enter();
await until(`${CY}.getElementById('design:com.example.audit').length>0`,'planned package card');
await until(`!document.querySelector('.design-draft-card')`,'draft closes on commit');
results.plannedPackage=await evaluate(`(()=>{const n=${CY}.getElementById('design:com.example.audit');return {designOnly:n.data('designOnly'),border:n.style('border-style'),color:n.style('border-color')};})()`);
assert.equal(results.plannedPackage.designOnly,true);
assert.equal(results.plannedPackage.border,'dashed','a planned card is drawn dashed');
// It lands where its draft was typed.
const landed=await evaluate(`(()=>{const cy=${CY},bb=cy.getElementById('design:com.example.audit').renderedBoundingBox({includeLabels:false,includeOverlays:false}),r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.left+(bb.x1+bb.x2)/2,y:r.top+(bb.y1+bb.y2)/2};})()`);
results.packageLanding={draft:{x:packageDraft.left+packageDraft.width/2,y:packageDraft.top+packageDraft.height/2},card:landed};
assert.ok(Math.abs(landed.x-results.packageLanding.draft.x)<40&&Math.abs(landed.y-results.packageLanding.draft.y)<40,'the package lands where it was typed: '+JSON.stringify(results.packageLanding));

// 1b. Double-click in design mode: the explanation popover, intent first (not an arrangement).
await evaluate(`window.__arranged=0;${CY}.on('arranged',()=>{window.__arranged++;}),true`);
const pkgCenter=await cardPoint('design:com.example.audit',.4,.75);
await dblAt(pkgCenter.x,pkgCenter.y);
await until(`!!document.querySelector('.design-popover')`,'design popover on double-click');
results.popover=await evaluate(`(()=>{const p=document.querySelector('.design-popover').getBoundingClientRect();return {left:p.left,bottom:p.bottom,firstLabel:document.querySelector('.design-popover label').textContent,focused:document.activeElement?.closest('.design-popover')!==null};})()`);
assert.ok(results.popover.firstLabel.startsWith('Intent'),'intent comes first');
assert.equal(results.popover.focused,true);
assert.equal(await evaluate(`window.__arranged`),0,'double-click does not arrange in design mode');
await fill('.design-popover input','Audit trail for order changes.');
await fill('.design-popover textarea','Every state change of an order is recorded once, append-only.');
await shot('03-design-popover');
await clickText('.design-popover button','Save');
await until(`!document.querySelector('.design-popover')`,'popover closes after save');
await until(`${CY}.getElementById('design:com.example.audit').data('responsibilitySummary')==='Audit trail for order changes.'`,'intent saved');

// 2. Right-click the planned package -> Add class: inline, under the collapsed card.
await evaluate(`${CY}.getElementById('design:com.example.audit').emit('cxttap'),true`);
await until(`[...document.querySelectorAll('.graph-context-menu .design-menuitem')].some(b=>b.textContent.includes('Add class'))`,'card design menu');
await clickText('.graph-context-menu .design-menuitem','Add class');
await until(`!!document.querySelector('.design-draft-card input')`,'inline class draft');
assert.equal(await draftFocused(),true);
await typeText('AuditLog');await enter();
await until(`!document.querySelector('.design-draft-card')`,'class saved');
await until(`!!document.querySelector('button[aria-label="Show types inside com.example.audit"]')`,'planned package can expand');
await evaluate(`document.querySelector('button[aria-label="Show types inside com.example.audit"]').click()`);
await until(`${CY}.getElementById('design:com.example.audit.AuditLog').length>0`,'planned class inside planned package');

// 2b. Hover the expanded package: "+ class" in its reserved slot; type a name, Enter.
const auditSlot=await openSlot('design:com.example.audit','class');
assert.equal(await draftFocused(),true,'slot draft focused');
const draftRect=await rectOf('.design-draft-card');
assert.ok(Math.abs(draftRect.left-auditSlot.slot.left)<2&&Math.abs(draftRect.top-auditSlot.slot.top)<2,'the draft sits on the slot');
await typeText('AuditQuery');
await shot('04-slot-class-draft');
await enter();
await until(`${CY}.getElementById('design:com.example.audit.AuditQuery').length>0`,'class added in the slot');
results.slotLanding={slot:auditSlot.center,card:await evaluate(`(()=>{const p=${CY}.getElementById('design:com.example.audit.AuditQuery').position();return {x:p.x,y:p.y};})()`)};
assert.ok(Math.abs(results.slotLanding.slot.x-results.slotLanding.card.x)<2&&Math.abs(results.slotLanding.slot.y-results.slotLanding.card.y)<2,'the new class lands exactly in the slot: '+JSON.stringify(results.slotLanding));
assert.equal(await evaluate(`${CY}.getElementById('design:com.example.audit.AuditQuery').parent().id()`),'design:com.example.audit');

// 2c. Esc cancels: no card, nothing on the server.
const before=(await designOverlay()).resources.length;
await openSlot('design:com.example.audit','class');
await typeText('Nope');await escape();
await until(`!document.querySelector('.design-draft-card')`,'Esc removes the draft');
await pause(400);
assert.equal((await designOverlay()).resources.length,before,'Esc creates nothing');
assert.equal(await evaluate(`${CY}.getElementById('design:com.example.audit.Nope').length`),0);
// Blur with an empty name cancels too.
await openSlot('design:com.example.audit','class');
await evaluate(`document.querySelector('.design-draft-card input').blur(),true`);
await until(`!document.querySelector('.design-draft-card')`,'empty blur removes the draft');
await shot('05-planned-package-and-classes');

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
await shot('06-parsed-class-explained');

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
await shot('07-agent-designed-relation');
await evaluate(`${CY}.nodes().filter(n=>n.data('simpleName')==='OrderService')[0].emit('cxttap'),true`);
await until(`[...document.querySelectorAll('.graph-context-menu button')].some(b=>b.textContent.includes('Expand'))`,'card menu Expand');
await clickText('.graph-context-menu button','Expand');
await until(`${CY}.getElementById('design:com.example.spring.service.OrderService.complete(Long)').length>0`,'planned method inside parsed class');
await evaluate(`${CY}.getElementById('design:com.example.spring.service.OrderService.complete(Long)').emit('tap'),true`);
await until(`document.querySelector('.design-section .design-status')?.textContent.startsWith('planned')`,'planned status');
assert.equal(await evaluate(`!!document.querySelector('.explanation-section')`),false,'a planned method has no generated explanation to request');
await shot('08-planned-method');

// 4b. "+ method" in an expanded parsed class: `name(Type)` sets the parameter types; a bad name shows inline.
const orderServiceId=await evaluate(`${CY}.nodes().filter(n=>n.data('simpleName')==='OrderService')[0].id()`);
await openSlot(orderServiceId,'method');
await typeText('find by customer');await enter();
await until(`!!document.querySelector('.design-draft-error')`,'inline error for a bad method name');
results.badNameError=await evaluate(`document.querySelector('.design-draft-error').textContent`);
assert.equal(await evaluate(`!!document.querySelector('.design-draft-card input')`),true,'the draft stays open with its error');
await shot('09-inline-error');
await fill('.design-draft-card input','findByCustomer(Long customerId)');
await evaluate(`document.querySelector('.design-draft-card input').focus(),true`);
await enter();
const methodKey='com.example.spring.service.OrderService.findByCustomer(Long)';
await until(`${CY}.getElementById(${q('design:'+methodKey)}).length>0`,'planned method added in the parsed class');
const methodRow=(await designOverlay()).resources.find(r=>r.key===methodKey);
assert.deepEqual(methodRow.parameterTypes,['Long'],'parameter types parsed from name(Long customerId)');
assert.equal(methodRow.kind,'METHOD');
assert.equal(await evaluate(`${CY}.getElementById(${q('design:'+methodKey)}).parent().id()`),orderServiceId,'drawn inside its class');

// 4c. Two-click relation: hover a card, click its handle, a dashed line follows the pointer, click the target.
const queryId='design:com.example.audit.AuditQuery',logId='design:com.example.audit.AuditLog';
await evaluate(`${CY}.center(${CY}.collection([${CY}.getElementById(${q(queryId)}),${CY}.getElementById(${q(logId)})])),true`);
await evaluate(`${CY}.emit('tap'),true`);
await mouse('mouseMoved',5,5);await pause(300);
const queryCenter=await cardPoint(queryId);
await mouse('mouseMoved',queryCenter.x,queryCenter.y);
await until(`document.querySelector('.design-link-handle')?.dataset.cardId===${q(queryId)}`,'relation handle on hover');
const handle=await rectOf('.design-link-handle');
const queryBox=await cardPoint(queryId,1,.5);
assert.ok(Math.abs(handle.x-queryBox.x)<2&&Math.abs(handle.y-queryBox.y)<2,'the handle sits on the middle of the right edge');
await mouse('mouseMoved',handle.x,handle.y);
await clickAt(handle.x,handle.y);
await until(`!!document.querySelector('.design-link-hint')`,'linking started');
const logCenter=await cardPoint(logId);
const mid={x:handle.x+220,y:handle.y-110};
await mouse('mouseMoved',mid.x,mid.y);
await pause(200);
results.rubberBand=await evaluate(`${CY}.scratch('atlas:designLink')`);
assert.equal(results.rubberBand.sourceId,queryId);
assert.ok(results.rubberBand.to&&results.rubberBand.from,'rubber band drawn');
const canvasRect=await rectOf('.graph-canvas');
assert.ok(Math.abs(results.rubberBand.to.x+canvasRect.left-mid.x)<2&&Math.abs(results.rubberBand.to.y+canvasRect.top-mid.y)<2,'the line ends at the pointer');
const cyEdgesBefore=await evaluate(`${CY}.edges().length+${CY}.nodes().length`);
await shot('10-rubber-band');
assert.equal(await evaluate(`${CY}.edges().length+${CY}.nodes().length`),cyEdgesBefore,'no Cytoscape elements for the rubber band');
await clickAt(logCenter.x,logCenter.y);
await until(`!!document.querySelector('.design-popover select')`,'relation popover after the second click');
results.newRelation={kind:await evaluate(`document.querySelector('.design-popover select').value`),title:await evaluate(`document.querySelector('.design-popover header strong').textContent`)};
assert.equal(results.newRelation.kind,'USES_TYPE','class -> class starts as uses type');
assert.ok((await designOverlay()).relations.some(r=>r.sourceKey==='com.example.audit.AuditQuery'&&r.targetKey==='com.example.audit.AuditLog'&&r.kind==='USES_TYPE'),'created on the second click');
await fill('.design-popover select','CALLS');
await fill('.design-popover input','Queries read the audit log.');
await shot('11-relation-popover');
await clickText('.design-popover button','Save');
await until(`!document.querySelector('.design-popover')`,'relation popover saved');
const rels=(await designOverlay()).relations.filter(r=>r.sourceKey==='com.example.audit.AuditQuery');
assert.deepEqual(rels.map(r=>[r.kind,r.explanation]),[['CALLS','Queries read the audit log.']],'kind changed in the popover replaces the relation');
// Esc cancels a pending relation.
await mouse('mouseMoved',queryCenter.x,queryCenter.y);
await until(`!!document.querySelector('.design-link-handle')`,'handle again');
const handle2=await rectOf('.design-link-handle');
await mouse('mouseMoved',handle2.x,handle2.y);await clickAt(handle2.x,handle2.y);
await until(`!!document.querySelector('.design-link-hint')`,'linking again');
await escape();
await until(`!document.querySelector('.design-link-hint') && ${CY}.scratch('atlas:designLink')===null`,'Esc cancels the relation');

// 4d. Double-click a designed route: the same popover, for the relation.
await until(`${CY}.edges().some(e=>e.data('designed')&&e.source().id()===${q(queryId)})`,'designed route drawn');
await evaluate(`${CY}.edges().filter(e=>e.data('designed')&&e.source().id()===${q(queryId)})[0].emit('dbltap'),true`);
await until(`document.querySelector('.design-popover input')?.value==='Queries read the audit log.'`,'route popover');
await escape();
await until(`!document.querySelector('.design-popover')`,'Esc closes the popover');

// 4e. Toggle Design off and on: every design card returns exactly where it was, inside boxes too.
const designPositions=()=>evaluate(`Object.fromEntries(${CY}.nodes().filter(n=>n.id().startsWith('design:')).map(n=>[n.id(),{x:n.position().x,y:n.position().y,parent:n.parent().id()||null,w:n.width(),h:n.height()}]))`);
const beforeToggle=await designPositions();
assert.ok(Object.keys(beforeToggle).length>=5);
assert.ok(Object.values(beforeToggle).some(p=>p.parent===orderServiceId),'includes a design card inside a parsed class box');
await evaluate(`document.querySelector('.design-toggle').click(),true`);
await until(`${CY}.nodes().filter(n=>n.id().startsWith('design:')).length===0`,'design hidden');
await shot('12-design-off');
// With Design off, double-click still arranges around the card.
await evaluate(`window.__arranged=0,true`);
const parsedTarget=await evaluate(`${CY}.nodes().filter(n=>n.data('kind')==='PACKAGE'&&(n.data('qualifiedName')||'').endsWith('.controller'))[0].id()`);
await evaluate(`${CY}.getElementById(${q(parsedTarget)}).emit('dbltap'),true`);
await until(`window.__arranged>0`,'double-click arranges with Design off');
assert.equal(await evaluate(`!!document.querySelector('.design-popover')`),false);
const arrangedBoxes=await evaluate(`(()=>{const cy=${CY};return Object.fromEntries(['design:com.example.audit',${q(orderServiceId)}].map(id=>{const n=cy.getElementById(id);return [id,n.length?{x:n.position().x,y:n.position().y}:null];}));})()`);
// Undo the arrangement so the toggle round trip compares like with like.
await evaluate(`[...document.querySelectorAll('.journey-history button')].find(b=>b.textContent.includes('Undo')).click()`);
await pause(600);
await evaluate(`document.querySelector('.design-toggle').click(),true`);
await until(`${CY}.nodes().filter(n=>n.id().startsWith('design:')).length===${Object.keys(beforeToggle).length}`,'design shown again');
await pause(500);
results.toggle={before:beforeToggle,after:await designPositions(),arrangedBoxes};
for(const [id,p] of Object.entries(results.toggle.before)){
  const a=results.toggle.after[id];
  assert.ok(a,'design card back: '+id);
  assert.ok(Math.abs(a.x-p.x)<.01&&Math.abs(a.y-p.y)<.01&&a.parent===p.parent,`design card ${id} back in place: ${JSON.stringify(p)} vs ${JSON.stringify(a)}`);
}
await shot('13-design-on-again');

// 4f. Prompt: only designed work, the relation semantics, intentions on parsed code.
await clickText('.design-controls button','Prompt');
await until(`!!document.querySelector('dialog.design-prompt-dialog[open] textarea')?.value`,'prompt dialog');
const prompt=await evaluate(`document.querySelector('dialog.design-prompt-dialog textarea').value`);
await fs.writeFile(`${outDir}/design-prompt.md`,prompt);
for(const s of ['## Report back','`com.example.audit.AuditQuery` -CALLS-> `com.example.audit.AuditLog`','means: the engineer wants A, or code inside A, to do KIND to B','> Queries read the audit log.',
  'class `com.example.spring.service.OrderService`','> Owns the order lifecycle from creation to completion.','`'+methodKey+'`','## 2. Change existing code'])
  assert.ok(prompt.includes(s),'prompt contains '+s);
for(const s of ['UserServiceImpl','PaymentService','codeatlas-design','```json'])
  assert.ok(!prompt.includes(s),'prompt leaves out '+s);
assert.ok(prompt.indexOf('Owns the order lifecycle')>prompt.indexOf('## 2. Change existing code'),'the intention on parsed code is a requested change');
results.promptBytes=prompt.length;
await shot('14-prompt-dialog');
await clickText('dialog.design-prompt-dialog button','Done');
await until(`!document.querySelector('dialog.design-prompt-dialog[open]')`,'prompt dialog closed');

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
await shot('15-imported-map-in-other-workspace');
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
