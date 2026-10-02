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
// ADR 0016: right after a create, the quick popup asks for the intent (focused), then the kind; no modal.
const quickPopup=async label=>{
  await until(`!!document.querySelector('.design-quick-popup input')`,'quick popup after '+label);
  assert.equal(await evaluate(`document.activeElement?.matches('.design-quick-popup input')===true`),true,'the intent field is focused after '+label);
  assert.equal(await evaluate(`!!document.querySelector('dialog[open]')||!!document.querySelector('.design-popover')`),false,'no dialog or full popover after '+label);
  return rectOf('.design-quick-popup');
};
const quickKinds=()=>evaluate(`[...document.querySelectorAll('.design-quick-popup select option')].map(o=>o.value)`);
const pressEnterOnKind=async kind=>{await fill('.design-quick-popup select',kind);await evaluate(`document.querySelector('.design-quick-popup select').focus(),true`);await enter();};
/** A box's add blocks (ADR 0017), in model coordinates: its gaps, or else its one reserve. */
const blocksOf=boxId=>evaluate(`(${CY}.scratch('atlas:designBlocks')||{})[${q(boxId)}]||[]`);
const boxSize=boxId=>evaluate(`(()=>{const b=${CY}.getElementById(${q(boxId)}).boundingBox({includeLabels:false,includeOverlays:false});return {w:b.w,h:b.h};})()`);
/** Hover an expanded box's empty space (at block `index`'s centre, or at the model point `at`), then click
 * the "+" button there; returns the hovered block (model) and its drawn rect. */
async function openSlot(boxId,label,index=0,at=null){
  // Bring the box to the middle of the canvas so its blocks are not under the minimap or legend.
  await evaluate(`${CY}.center(${CY}.getElementById(${q(boxId)})),true`);
  await mouse('mouseMoved',5,5);
  await pause(300);
  // Hovering the box header shows no button: only empty space inside it does.
  const corner=await cardPoint(boxId,0,0);
  await mouse('mouseMoved',corner.x+14,corner.y+14);
  await until(`(${CY}.scratch('atlas:designBlocks')||{})[${q(boxId)}]?.length>0`,'add blocks of '+boxId);
  await pause(200);
  assert.equal(await evaluate(`document.querySelectorAll('.design-slot').length`),0,'no add button on the header');
  let point=at;
  if(!point){const block=(await blocksOf(boxId))[index];assert.ok(block,`block ${index} of ${boxId}`);point={x:(block.x1+block.x2)/2,y:(block.y1+block.y2)/2};}
  const client=await evaluate(`(()=>{const cy=${CY},r=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),p=cy.pan();return {x:r.left+${point.x}*z+p.x,y:r.top+${point.y}*z+p.y};})()`);
  await mouse('mouseMoved',client.x,client.y);
  await until(`document.querySelector('.design-slot.hot')?.dataset.slotFor===${q(boxId)}`,'the hovered empty space shows its add button');
  assert.equal(await evaluate(`document.querySelectorAll('.design-slot').length`),1,'only the hovered block shows a button');
  assert.ok((await evaluate(`document.querySelector('.design-slot').textContent`)).includes(label),'block says '+label);
  const block=await evaluate(`${CY}.scratch('atlas:designHover')?.box`);
  assert.ok(block&&point.x>=block.x1-1&&point.x<=block.x2+1&&point.y>=block.y1-1&&point.y<=block.y2+1,'the block is under the pointer: '+JSON.stringify({block,point}));
  const slot=await rectOf('.design-slot');
  await clickAt(client.x,client.y);
  await until(`!!document.querySelector('.design-draft-card input')`,'draft card after clicking the block');
  return {slot,block};
}
/** A card's drawn size in model coordinates (its stored card size). */
const cardSizeOf=id=>evaluate(`(()=>{const n=${CY}.getElementById(${q(id)});return {w:n.data('cardWidth'),h:n.data('cardHeight')};})()`);
/** The new card takes the block's exact shape (ADR 0017): its corner and its size. */
async function assertShape(id,block,label){
  const tl=await cardTopLeft(id),sz=await cardSizeOf(id);
  const shape={block,card:{...tl,...sz}};
  assert.ok(Math.abs(tl.x-block.x1)<2&&Math.abs(tl.y-block.y1)<2,label+': the card keeps the block\'s corner: '+JSON.stringify(shape));
  assert.ok(Math.abs(sz.w-(block.x2-block.x1))<2&&Math.abs(sz.h-(block.y2-block.y1))<2,label+': the card is the block\'s size: '+JSON.stringify(shape));
  return shape;
}
const topLevelOverlaps=()=>evaluate(`(()=>{const ns=${CY}.nodes().filter(n=>!n.parent().length&&!n.data('hiddenBox')).map(n=>({id:n.id(),b:n.boundingBox({includeLabels:false,includeOverlays:false})}));const out=[];for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const a=ns[i].b,b=ns[j].b;if(a.x1<b.x2-4&&b.x1<a.x2-4&&a.y1<b.y2-4&&b.y1<a.y2-4)out.push([ns[i].id,ns[j].id]);}return out;})()`);
/** A card's top-left corner in model coordinates (its collapsed card, as stored). */
const cardTopLeft=id=>evaluate(`(()=>{const n=${CY}.getElementById(${q(id)}),p=n.position();return {x:p.x-n.data('cardWidth')/2,y:p.y-n.data('cardHeight')/2};})()`);

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
// The quick popup: intent only (a package has one kind), next to the new card.
const pkgQuick=await quickPopup('a new package');
assert.deepEqual(await quickKinds(),[],'a package offers no kind choice');
results.packageQuickPopup={popup:pkgQuick,draft:packageDraft};
assert.ok(Math.abs(pkgQuick.left-(packageDraft.left+packageDraft.width))<60,'the popup sits next to the new card: '+JSON.stringify(results.packageQuickPopup));
await typeText('Audit trail for order changes.');
await shot('02b-quick-popup-package');
await enter();
await until(`!document.querySelector('.design-quick-popup')`,'quick popup closes on Enter');
await until(`${CY}.getElementById('design:com.example.audit').data('responsibilitySummary')==='Audit trail for order changes.'`,'quick intent saved');

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
// Intent, then kind: an interface. Enter on the kind saves both in one change set.
await quickPopup('a new class');
assert.deepEqual(await quickKinds(),['CLASS','INTERFACE','ENUM','RECORD','ANNOTATION']);
await typeText('Append-only store of audit entries.');
await pressEnterOnKind('INTERFACE');
await until(`!document.querySelector('.design-quick-popup')`,'class quick popup saved');
{const r=(await designOverlay()).resources.find(r=>r.key==='com.example.audit.AuditLog');results.quickClass={kind:r.kind,intent:r.intent};assert.equal(r.kind,'INTERFACE');assert.equal(r.intent,'Append-only store of audit entries.');}
await until(`!!document.querySelector('button[aria-label="Show types inside com.example.audit"]')`,'planned package can expand');
await evaluate(`document.querySelector('button[aria-label="Show types inside com.example.audit"]').click()`);
await until(`${CY}.getElementById('design:com.example.audit.AuditLog').length>0`,'planned class inside planned package');

// 2b. Hover the expanded package: one class inside, no empty block, so one small reserve block (ADR 0017).
{const blocks=await blocksOf('design:com.example.audit');results.auditReserve=blocks;assert.equal(blocks.length,1,'a box without a gap has one reserve block');
 assert.ok(blocks[0].x2-blocks[0].x1<250&&blocks[0].y2-blocks[0].y1<206,'the reserve is smaller than a class card: '+JSON.stringify(blocks[0]));}
const auditSlot=await openSlot('design:com.example.audit','class');
assert.equal(await draftFocused(),true,'slot draft focused');
const draftRect=await rectOf('.design-draft-card');
assert.ok(Math.abs(draftRect.left-auditSlot.slot.left)<2&&Math.abs(draftRect.top-auditSlot.slot.top)<2,'the draft sits on the slot');
await typeText('AuditQuery');
await shot('04-slot-class-draft');
await enter();
await until(`${CY}.getElementById('design:com.example.audit.AuditQuery').length>0`,'class added in the slot');
// Esc on the quick popup saves nothing and keeps the class.
await quickPopup('a slot class');
await typeText('not saved');await escape();
await until(`!document.querySelector('.design-quick-popup')`,'Esc closes the quick popup');
assert.equal((await designOverlay()).resources.find(r=>r.key==='com.example.audit.AuditQuery').explanation,'','Esc on the quick popup saves nothing');
results.slotLanding=await assertShape('design:com.example.audit.AuditQuery',auditSlot.block,'a class in the reserve');
assert.equal(await evaluate(`${CY}.getElementById('design:com.example.audit.AuditQuery').parent().id()`),'design:com.example.audit');
assert.deepEqual(await topLevelOverlaps(),[],'the package grows for a class in its reserve: no map card is overlapped');

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

// 2d. ADR 0017: an empty class expands in design mode onto one block; "+ method" there adds its first method.
{
  const queryId='design:com.example.audit.AuditQuery';
  await until(`!!document.querySelector('button[aria-label="Show methods inside AuditQuery"]')`,'an empty planned class can expand in design mode');
  const collapsedTopLeft=await cardTopLeft(queryId);
  await evaluate(`document.querySelector('button[aria-label="Show methods inside AuditQuery"]').click(),true`);
  await until(`${CY}.getElementById(${q(queryId)}).data('expanded')===true`,'empty class expanded');
  const blocks=await blocksOf(queryId);
  const bb=await evaluate(`(()=>{const b=${CY}.getElementById(${q(queryId)}).boundingBox({includeLabels:false,includeOverlays:false});return {x1:b.x1,y1:b.y1,w:b.w,h:b.h};})()`);
  results.emptyClass={blocks,box:bb,collapsedTopLeft};
  assert.equal(blocks.length,1,'an empty box holds exactly one block');
  assert.ok(Math.abs(bb.x1-collapsedTopLeft.x)<3&&Math.abs(bb.y1-collapsedTopLeft.y)<3,'the empty box keeps the card\'s top-left corner: '+JSON.stringify(results.emptyClass));
  assert.ok(blocks[0].x1>=bb.x1&&blocks[0].x2<=bb.x1+bb.w+1&&blocks[0].y2<=bb.y1+bb.h+1,'the block lies inside the empty box');
  assert.deepEqual(await topLevelOverlaps(),[],'the package grows around its reserve: no map card is overlapped');
  await shot('05b-empty-class-expanded');
  const methodBlock=await openSlot(queryId,'method');
  await typeText('search(String)');await enter();
  const searchId='design:com.example.audit.AuditQuery.search(String)';
  await until(`${CY}.getElementById(${q(searchId)}).length>0`,'first method of the empty class');
  assert.equal(await evaluate(`${CY}.getElementById(${q(searchId)}).parent().id()`),queryId,'drawn inside the class box');
  results.firstMethod=await assertShape(searchId,methodBlock.block,'the first method');
  await quickPopup('the first method');await escape();
  await until(`!document.querySelector('.design-quick-popup')`,'quick popup closed');
  assert.deepEqual(await topLevelOverlaps(),[],'a nested box\'s growth makes room through the package around it');
  await shot('05c-empty-class-first-method');
  // Collapse it again, so the relation steps below hover the class card itself.
  await evaluate(`document.querySelector('button[aria-label="Collapse AuditQuery"]').click(),true`);
  await until(`${CY}.getElementById(${q(queryId)}).data('expanded')===false`,'class collapsed');
}

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

// 3b. ADR 0017: the expanded service package (seven types, three columns) has two empty cells in its last
// row. A hover anywhere in that space offers a block under the pointer, not only at fixed spots: hovered
// 20 px right of the first cell's centre, the block sits there, and the class takes exactly its shape.
// The package does not stretch. The space left is narrower than a card but still a block, and a class
// made there takes that narrower shape.
{
  const serviceId=await evaluate(`${CY}.nodes().filter(n=>n.data('kind')==='PACKAGE'&&(n.data('qualifiedName')||'').endsWith('.service'))[0].id()`);
  const gaps=await blocksOf(serviceId);
  const sizeBefore=await boxSize(serviceId);
  results.serviceGaps={gaps,sizeBefore};
  assert.ok(gaps.length>=2,'the short last row offers gaps: '+JSON.stringify(gaps));
  const at={x:(gaps[0].x1+gaps[0].x2)/2+20,y:(gaps[0].y1+gaps[0].y2)/2};
  const opened=await openSlot(serviceId,'class',0,at);
  assert.ok(Math.abs(opened.block.x1-gaps[0].x1-20)<2,'the block follows the pointer, between the fixed spots: '+JSON.stringify({gap:gaps[0],block:opened.block}));
  assert.equal(opened.block.x2-opened.block.x1,250,'a full card where there is room');
  await shot('06b-gap-class-draft');
  await typeText('OrderAudit');await enter();
  const auditId='design:com.example.spring.service.OrderAudit';
  await until(`${CY}.getElementById(${q(auditId)}).length>0`,'class added where hovered');
  await quickPopup('a class where hovered');await escape();
  await until(`!document.querySelector('.design-quick-popup')`,'quick popup closed');
  const shape=await assertShape(auditId,opened.block,'a class where hovered');
  const sizeAfter=await boxSize(serviceId);
  const gapsAfter=await blocksOf(serviceId);
  results.gapLanding={...shape,sizeBefore,sizeAfter,gapsAfter};
  // A few pixels of border/hover outline differ; a stretch would be a whole block (130+ px).
  assert.ok(Math.abs(sizeAfter.w-sizeBefore.w)<8&&Math.abs(sizeAfter.h-sizeBefore.h)<8,'the package does not stretch: '+JSON.stringify(results.gapLanding));
  assert.equal(await evaluate(`document.querySelectorAll('.design-slot').length`),0,'no stale button after the create');
  assert.deepEqual(await topLevelOverlaps(),[],'no map card is overlapped');
  assert.equal(gapsAfter.length,1,'one narrower space is left: '+JSON.stringify(gapsAfter));
  assert.ok(gapsAfter[0].x2-gapsAfter[0].x1<250&&gapsAfter[0].x2-gapsAfter[0].x1>=220,'narrower than a card, at least the least size');
  await shot('06c-gap-class-filled');
  const narrow=await openSlot(serviceId,'class',0);
  await typeText('OrderArchive');await enter();
  const archiveId='design:com.example.spring.service.OrderArchive';
  await until(`${CY}.getElementById(${q(archiveId)}).length>0`,'class added in the narrower space');
  await quickPopup('a narrower class');await escape();
  await until(`!document.querySelector('.design-quick-popup')`,'quick popup closed');
  results.narrowLanding=await assertShape(archiveId,narrow.block,'a class in the narrower space');
  assert.ok(results.narrowLanding.card.w<250,'the class is as narrow as the space it was made in');
  assert.deepEqual(await topLevelOverlaps(),[],'no map card is overlapped');
  await shot('06d-narrow-class');
}

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
const methodSlot=await openSlot(orderServiceId,'method');
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
results.methodLanding=await assertShape('design:'+methodKey,methodSlot.block,'a method in a parsed class');
assert.deepEqual(await topLevelOverlaps(),[],'the class grows for its method without overlapping the map');
await quickPopup('a new method');
assert.deepEqual(await quickKinds(),[],'a method offers no kind choice');
await typeText('Lists the orders of one customer.');await enter();
await until(`!document.querySelector('.design-quick-popup')`,'method quick popup saved');
assert.equal((await designOverlay()).resources.find(r=>r.key===methodKey).intent,'Lists the orders of one customer.');

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
const ends={from:await cardPoint(queryId),to:logCenter};
await clickAt(logCenter.x,logCenter.y);
// ADR 0016: the quick popup opens at the relation's middle, intent focused, kind CALLS.
const relQuick=await quickPopup('a two-click relation');
results.newRelation={kind:await evaluate(`document.querySelector('.design-quick-popup select').value`),popup:relQuick,middle:{x:(ends.from.x+ends.to.x)/2,y:(ends.from.y+ends.to.y)/2}};
assert.equal(results.newRelation.kind,'CALLS','a two-click relation starts as CALLS');
assert.ok(Math.abs(relQuick.x-results.newRelation.middle.x)<4&&Math.abs(relQuick.y-results.newRelation.middle.y)<4,'the popup is centred on the relation middle: '+JSON.stringify(results.newRelation));
assert.ok((await designOverlay()).relations.some(r=>r.sourceKey==='com.example.audit.AuditQuery'&&r.targetKey==='com.example.audit.AuditLog'&&r.kind==='CALLS'),'created on the second click');
await typeText('Queries read the audit log.');
await shot('11-relation-quick-popup');
await enter();
await until(`!document.querySelector('.design-quick-popup')`,'relation quick popup saved');
const rels=(await designOverlay()).relations.filter(r=>r.sourceKey==='com.example.audit.AuditQuery');
assert.deepEqual(rels.map(r=>[r.kind,r.explanation]),[['CALLS','Queries read the audit log.']],'intent saved on the CALLS relation');
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
// ADR 0016: a plain request. Add / Change / Connect, each with its intention; nothing about this tool.
for(const s of ['## Add','## Change','## Connect',
  'Add a package `com.example.audit`. Purpose: Audit trail for order changes.','   Every state change of an order is recorded once, append-only.',
  'Add an interface `AuditLog` in package `com.example.audit`. Purpose: Append-only store of audit entries.',
  'Add a class `AuditQuery` in package `com.example.audit`.',
  '`findByCustomer(Long)` to class `OrderService` (package `com.example.spring.service`). Purpose: Lists the orders of one customer.',
  'Change class `OrderService`, in package `com.example.spring.service`. What should change: Owns the order lifecycle from creation to completion.',
  'Class `AuditQuery` (new) should call interface `AuditLog` (new). Reason: Queries read the audit log.',
  'Class `OrderService` should call interface `AuditLog` (new). Reason: Each completed order is appended to the audit trail.'])
  assert.ok(prompt.includes(s),'prompt contains '+s+'\n'+prompt);
for(const s of ['Code Atlas','127.0.0.1','/api/','design layer','PLANNED','IMPLEMENTED','key','UserServiceImpl','PaymentService','codeatlas-design','```json','Report back'])
  assert.ok(!prompt.includes(s),'prompt leaves out '+s);
assert.ok(prompt.indexOf('Owns the order lifecycle')>prompt.indexOf('## Change'),'the intention on parsed code is a requested change');
results.promptBytes=prompt.length;
await shot('14-prompt-dialog');
await clickText('dialog.design-prompt-dialog button','Done');
await until(`!document.querySelector('dialog.design-prompt-dialog[open]')`,'prompt dialog closed');

// Undo walks exploration only; design edits are server operations and stay.
await evaluate(`[...document.querySelectorAll('.journey-history button')].find(b=>b.textContent.includes('Undo')).click()`);
await pause(600);
assert.equal((await (await fetch(`${base}/api/workspaces/${wsA}/design`)).json()).resources.length>=4,true,'undo does not reverse design edits');

// 5. Export from the bottom right of the map: Import and Export sit under Fit map / Full screen; Prompt stays on top.
results.fileActions={actions:await rectOf('.map-file-actions'),zoom:await rectOf('.zoom-controls'),prompt:await rectOf('.design-controls .design-prompt-button')};
assert.ok(results.fileActions.actions.top>=results.fileActions.zoom.top+results.fileActions.zoom.height-1,'Import/Export sit below the map controls: '+JSON.stringify(results.fileActions));
assert.ok(Math.abs((results.fileActions.actions.left+results.fileActions.actions.width)-(results.fileActions.zoom.left+results.fileActions.zoom.width))<40,'right-aligned under them');
assert.equal(await evaluate(`[...document.querySelectorAll('.design-controls button,.design-controls label')].some(b=>/Export|Import/.test(b.textContent))`),false,'no Import/Export at the top');
assert.ok(results.fileActions.prompt&&results.fileActions.prompt.top<results.fileActions.zoom.top,'Prompt stays at the top');
await shot('15-file-actions');
const packagePosition=await evaluate(`(()=>{const p=${CY}.getElementById('design:com.example.audit').position();return {x:p.x,y:p.y};})()`);
// Every drawn card by key, to compare with the design-only project the export opens as (7, below).
const cardsByKey=()=>evaluate(`Object.fromEntries(${CY}.nodes().filter(n=>!n.data('hiddenBox')).map(n=>[n.data('qualifiedName'),{x:Math.round(n.position().x*100)/100,y:Math.round(n.position().y*100)/100,w:Math.round(n.width()),h:Math.round(n.height()),parent:n.parent().length?n.parent().data('qualifiedName'):null,name:n.data('simpleName'),roles:(n.data('roles')||[]).join(',')}]))`);
const exportedCards=await cardsByKey();
await clickText('.map-file-actions button','Export');
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
await shot('16-imported-map-in-other-workspace');
// 6a. ADR 0017 with parsed code: the method-less marker type RegionTag expands in design mode onto one block,
// and with Design off it is an ordinary card again; a drag lands exactly where it was dropped, either way.
{
  const dragBy=async(id,dx,dy)=>{const c=await cardPoint(id,.3,.6);await mouse('mouseMoved',c.x,c.y);await mouse('mousePressed',c.x,c.y);for(let i=1;i<=8;i++)await mouse('mouseMoved',c.x+dx*i/8,c.y+dy*i/8,{buttons:1});await mouse('mouseReleased',c.x+dx,c.y+dy);await pause(700);};
  const markerPkg=await evaluate(`${CY}.nodes().filter(n=>n.data('kind')==='PACKAGE'&&(n.data('qualifiedName')||'').endsWith('.marker'))[0]?.id()`);
  assert.ok(markerPkg,'fixture B shows the marker package');
  await evaluate(`(()=>{const cy=${CY};cy.zoom(.8);cy.center(cy.getElementById(${q(markerPkg)}));return true;})()`);
  await mouse('mouseMoved',5,5);await pause(400);
  const pkgName=await evaluate(`${CY}.getElementById(${q(markerPkg)}).data('simpleName')`);
  await until(`!!document.querySelector(${q(`button[aria-label="Show types inside ${pkgName}"]`)})`,'marker package can expand');
  await evaluate(`document.querySelector(${q(`button[aria-label="Show types inside ${pkgName}"]`)}).click(),true`);
  await until(`${CY}.nodes().some(n=>n.data('simpleName')==='RegionTag')`,'RegionTag card');
  const tagId=await evaluate(`${CY}.nodes().filter(n=>n.data('simpleName')==='RegionTag')[0].id()`);
  assert.equal(await evaluate(`${CY}.getElementById(${q(tagId)}).data('detailCount')||0`),0,'RegionTag has no methods');
  await evaluate(`(()=>{const cy=${CY};cy.center(cy.getElementById(${q(tagId)}));return true;})()`);await pause(300);
  await until(`!!document.querySelector('button[aria-label="Show methods inside RegionTag"]')`,'an empty parsed type can expand in design mode');
  await evaluate(`document.querySelector('button[aria-label="Show methods inside RegionTag"]').click(),true`);
  await until(`${CY}.getElementById(${q(tagId)}).data('emptyBox')===true`,'RegionTag opens as an empty box');
  assert.equal((await blocksOf(tagId)).length,1,'one block in the empty parsed type');
  const box0=await evaluate(`(()=>{const b=${CY}.getElementById(${q(tagId)}).boundingBox({includeLabels:false,includeOverlays:false});return {x1:b.x1,y1:b.y1};})()`);
  const z=await evaluate(`${CY}.zoom()`);
  await dragBy(tagId,120,40);
  const box1=await evaluate(`(()=>{const b=${CY}.getElementById(${q(tagId)}).boundingBox({includeLabels:false,includeOverlays:false});return {x1:b.x1,y1:b.y1};})()`);
  results.emptyParsedDrag={zoom:z,box0,box1};
  assert.ok(Math.abs(box1.x1-box0.x1-120/z)<1.5&&Math.abs(box1.y1-box0.y1-40/z)<1.5,'an empty box lands where it was dropped, no creep: '+JSON.stringify(results.emptyParsedDrag));
  await shot('16b-empty-parsed-type-design-on');
  // Design off: an ordinary card again (drawn, measured and dragged as before this change).
  await evaluate(`document.querySelector('.design-toggle').click(),true`);
  await until(`${CY}.nodes().filter(n=>n.id().startsWith('design:')).length===0`,'design hidden in B');
  const off=await evaluate(`(()=>{const n=${CY}.getElementById(${q(tagId)});return {expanded:n.data('expanded'),w:n.width(),cw:n.data('cardWidth'),x:n.position().x,y:n.position().y};})()`);
  assert.equal(off.expanded,false,'with Design off the empty expansion is drawn as its card');
  assert.equal(off.w,off.cw,'card-sized');
  await dragBy(tagId,-90,50);
  const offAfter=await evaluate(`(()=>{const n=${CY}.getElementById(${q(tagId)});return {x:n.position().x,y:n.position().y};})()`);
  results.emptyParsedDesignOff={off,offAfter};
  assert.ok(Math.abs(offAfter.x-off.x+90/z)<1.5&&Math.abs(offAfter.y-off.y-50/z)<1.5,'with Design off it lands where it was dropped: '+JSON.stringify(results.emptyParsedDesignOff));
  assert.deepEqual(await topLevelOverlaps(),[],'nothing overlaps with Design off');
  await shot('16c-empty-parsed-type-design-off');
  await evaluate(`document.querySelector('.design-toggle').click(),true`);
  await until(`${CY}.getElementById(${q(tagId)}).data('emptyBox')===true`,'the empty box returns with Design on');
}
const overlayB=await (await fetch(`${base}/api/workspaces/${wsB}/design`)).json();
const byKey=Object.fromEntries(overlayB.resources.map(r=>[r.key,r]));
assert.equal(byKey['com.example.spring.service.OrderService'].status,'MISSING');
assert.ok(byKey['com.example.spring.service.OrderService'].explanation.includes('OrderCompleted'));
assert.equal(byKey['com.example.audit.AuditLog'].status,'PLANNED');
assert.ok(overlayB.relations.some(r=>r.targetKey==='com.example.audit.AuditLog'&&r.createdBy==='claude-code'));

// 7. The first page's Import (ADR 0016): the export opens as a new design-only project, exactly as it was.
await cdp('Page.navigate',{url:base+'/'});
await until(`!!document.querySelector('.import-map-button input')`,'first page offers Import');
await shot('17-first-page-import');
{
  const {root}=await cdp('DOM.getDocument',{depth:-1});
  const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'.import-map-button input'});
  await cdp('DOM.setFileInputFiles',{nodeId,files:[path.join(downloads,briefFile)]});
}
await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.getElementById('design:com.example.audit').length>0`,'design-only project opened',300);
await pause(1200);
const importedCards=await cardsByKey();
const diffs=Object.keys(exportedCards).filter(k=>JSON.stringify(exportedCards[k])!==JSON.stringify(importedCards[k])).map(k=>({key:k,exported:exportedCards[k],imported:importedCards[k]}));
results.designOnlyImport={cards:Object.keys(exportedCards).length,extra:Object.keys(importedCards).filter(k=>!(k in exportedCards)),diffs:diffs.slice(0,10)};
assert.equal(diffs.length,0,'every card comes back exactly as exported: '+JSON.stringify(results.designOnlyImport));
assert.equal(results.designOnlyImport.extra.length,0,'and nothing else');
const projectInfo=await evaluate(`({summary:document.querySelector('.workspace-summary')?.textContent,changes:document.querySelector('.review-toggle')?.disabled,design:document.querySelector('.design-toggle')?.getAttribute('aria-pressed')})`);
results.designOnlyImport.project=projectInfo;
assert.ok(projectInfo.summary.includes('Design only'),'the project says it has no source folder');
assert.equal(projectInfo.changes,true,'Changes is off for a project with no code');
assert.equal(projectInfo.design,'true','Design is on');
// Imported code looks like the original: no design badge, ordinary grey routes; designed items stay violet.
results.designOnlyImport.look=await evaluate(`(()=>{const cy=${CY};const svc=cy.nodes().filter(n=>n.data('qualifiedName')==='com.example.spring.service.OrderService')[0];return {serviceDesignOnly:svc.data('designOnly'),serviceBorder:svc.style('border-color'),serviceExpanded:!!svc.data('expanded'),auditDesignOnly:cy.getElementById('design:com.example.audit').data('designOnly'),plain:cy.edges().filter(e=>!e.data('designed')).length,designed:cy.edges().filter(e=>e.data('designed')).length};})()`);
assert.equal(results.designOnlyImport.look.serviceDesignOnly,false,'an imported class is not drawn as a plan');
assert.notEqual(results.designOnlyImport.look.serviceBorder.replace(/\s/g,''),'rgb(124,92,196)','not drawn in the violet design tone');
assert.equal(results.designOnlyImport.look.auditDesignOnly,true,'a planned package is still a plan');
assert.ok(results.designOnlyImport.look.plain>0&&results.designOnlyImport.look.designed>0,'imported dependencies are ordinary routes, designed ones violet: '+JSON.stringify(results.designOnlyImport.look));
await shot('18-design-only-project');

results.pageErrors=errors;
await fs.writeFile(`${outDir}/report.json`,JSON.stringify(results,null,2));
assert.equal(errors.length,0,'no page errors: '+JSON.stringify(errors).slice(0,500));
console.log('design-layer UI checks passed');
socket.close();
