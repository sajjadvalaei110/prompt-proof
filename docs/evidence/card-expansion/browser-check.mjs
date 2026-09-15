// Browser check for in-place expansion (details buttons) and card/container resizing, via Chromium CDP.
// Needs three things already running (none are started here):
//   BACKEND  a Code Atlas backend with an isolated data dir     (default http://127.0.0.1:8095)
//   APP      the UI served against that backend                 (default http://127.0.0.1:5199)
//            e.g. `npx vite --port 5199` with server.proxy['/api'] pointed at BACKEND
//   DEBUG    Chromium started with --remote-debugging-port      (default http://127.0.0.1:9333)
// Usage: node docs/evidence/card-expansion/browser-check.mjs <writable copy of test-fixtures/microservice-java>
// Screenshots go to OUT (default build/card-expansion-check).
import fs from 'node:fs/promises';
const OUT = process.env.OUT || 'build/card-expansion-check';
await fs.mkdir(OUT, { recursive: true });
const base = process.env.BACKEND || 'http://127.0.0.1:8095', app = process.env.APP || 'http://127.0.0.1:5199', debug = process.env.DEBUG || 'http://127.0.0.1:9333';
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, tries = 150) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { } await pause(200); } throw Error('Timed out: ' + label); }
const results = [];
const check = (label, pass, detail) => { results.push({ label, pass: !!pass }); console.log(pass ? 'PASS' : 'FAIL', label, detail === undefined ? '' : JSON.stringify(detail)); };
const api = async (p, body) => { const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw Error(p + ' ' + r.status); return r.json(); };
const fixture = process.argv[2];
const ws = await api('/api/workspaces', { path: fixture });
const job = await api(`/api/workspaces/${ws.id}/analysis-jobs`, {});
await until(async () => (await api(`/api/jobs/${job.id}`)).status === 'COMPLETED', 'analysis');
const snapshot = (await api(`/api/workspaces/${ws.id}`)).activeSnapshotId;
const graph = await api(`/api/snapshots/${snapshot}/graph`);
const byName = (name, kind) => graph.nodes.find(n => n.simpleName === name && (!kind || n.kind === kind)) || graph.nodes.find(n => n.qualifiedName === name);

const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
socket.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id) { const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.reject(Error(JSON.stringify(m.error))) : w.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); };
const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async name => { await pause(700); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
const mouse = (type, p, button = 'left') => cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons: type === 'mouseReleased' ? 0 : button === 'none' ? 0 : 1, clickCount: 1 });
const click = async p => { await mouse('mouseMoved', p, 'none'); await mouse('mousePressed', p); await mouse('mouseReleased', p); };
const drag = async (a, b) => { await mouse('mouseMoved', a, 'none'); await mouse('mousePressed', a); for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8 }); await mouse('mouseReleased', b); };
const CY = "document.querySelector('.graph-canvas')._cyreg.cy";
const level = async label => { await evaluate(`[...document.querySelectorAll('.segmented button')].find(b=>b.textContent==='${label}').click()`); await pause(700); };
// Page point of a card's corner button (by right offset from card's right edge, card-local px) centre.
const cornerPoint = (id, right) => evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${id}'),b=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),p=n.renderedPosition();return{x:b.left+p.x+n.renderedWidth()/2-(${right}+20)*z,y:b.top+p.y-n.renderedHeight()/2+(12+20)*z}})()`);
const collapsePoint = id => evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${id}'),b=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),bb=n.renderedBoundingBox({includeLabels:false,includeOverlays:false});return{x:b.left+bb.x2-(6+16)*z,y:b.top+bb.y1+(6+16)*z}})()`);
// Pairs of sibling cards (same container, or both top-level) whose boxes overlap.
const overlaps = () => evaluate(`(()=>{const cy=${CY},out=[];const ns=cy.nodes();for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const a=ns[i],b=ns[j];if((a.parent().id()||'')!==(b.parent().id()||''))continue;const p=a.boundingBox({includeLabels:false,includeOverlays:false}),q=b.boundingBox({includeLabels:false,includeOverlays:false});if(p.x1<q.x2-2&&q.x1<p.x2-2&&p.y1<q.y2-2&&q.y1<p.y2-2)out.push([a.data('simpleName'),b.data('simpleName')]);}return out})()`);
const gripOf = async name => evaluate(`(()=>{const el=[...document.querySelectorAll('.map-resize-grip')].find(el=>el.title.startsWith('Resize ')&&el.title.endsWith(${JSON.stringify(name)}));if(!el)return null;const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const positionsOf = ids => evaluate(`(()=>{const cy=${CY};return Object.fromEntries(${JSON.stringify(ids)}.map(id=>[id,cy.getElementById(id).position()]))})()`);
const camera = () => evaluate(`({z:${CY}.zoom(),p:${CY}.pan()})`);

await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${app}/?snapshotId=${snapshot}` });
await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`), 'map');
await pause(1200);

// ---- Package level: expand "services" via its details corner (12+40+8 = 60 from the right edge)
const services = byName('com.kipper.eventsmicroservice.services'), repos = byName('com.kipper.eventsmicroservice.repositories'), controllers = byName('com.kipper.eventsmicroservice.controllers');
await evaluate(`${CY}.zoom(0.9);${CY}.center(${CY}.getElementById('${services.id}'));0`); await pause(600);
const others = graph.nodes.filter(n => n.kind === 'PACKAGE' && n.id !== services.id).map(n => n.id);
const beforePos = await positionsOf(others), beforeCam = await camera();
check('package card has a details button overlay', await evaluate(`[...document.querySelectorAll('.map-details-button')].some(b=>b.getAttribute('aria-label')==='Show types inside ${services.simpleName}')`));
await click(await cornerPoint(services.id, 12));
await until(() => evaluate(`${CY}.getElementById('${services.id}').isParent()`), 'services expanded', 25).catch(() => { });
const svc = await evaluate(`(()=>{const n=${CY}.getElementById('${services.id}');return{parent:n.isParent(),kids:n.children().map(c=>c.data('simpleName')).sort(),edges:${CY}.edges().map(e=>[e.source().data('simpleName'),e.target().data('simpleName'),e.data('kind')])}})()`);
check('clicking details expands the package into its classes', svc.parent && JSON.stringify(svc.kids) === JSON.stringify(['EmailServiceClient', 'EventService']), svc.kids);
check('class cards inside the package connect to other packages', svc.edges.some(([a, b]) => a === 'EventService' && b.endsWith('repositories')), svc.edges.filter(([a]) => ['EventService', 'EmailServiceClient'].includes(a)));
check('the inspector did not open from the details click', !(await evaluate(`!!document.querySelector('.inspector h2')&&document.querySelector('.inspector')?.textContent.includes('services')`)));
const afterPos = await positionsOf(others), afterCam = await camera();
const svcBox = await evaluate(`(()=>{const bb=${CY}.getElementById('${services.id}').boundingBox({includeLabels:false,includeOverlays:false});return bb})()`);
const cardBefore = { x2: svcBox.x1 + 280, y2: svcBox.y1 + 250 };
check('cards left of and above the expanded card keep their positions', others.every(id => { const a = beforePos[id], b = afterPos[id]; const moved = a.x !== b.x || a.y !== b.y; return !moved || a.x - 140 >= cardBefore.x2 - 1 || a.y - 125 >= cardBefore.y2 - 1; }), { beforePos, afterPos });
check('no cards overlap after expanding', (await overlaps()).length === 0, await overlaps());
check('camera unchanged by expanding', JSON.stringify(beforeCam) === JSON.stringify(afterCam));
await shot('e1-package-expanded');

// ---- Expand a second package at the same time
await click(await cornerPoint(repos.id, 12));
await until(() => evaluate(`${CY}.getElementById('${repos.id}').isParent()`), 'repos expanded', 25).catch(() => { });
const both = await evaluate(`(()=>{const cy=${CY};return{svc:cy.getElementById('${services.id}').isParent(),repo:cy.getElementById('${repos.id}').isParent(),edges:cy.edges().map(e=>[e.source().data('simpleName'),e.target().data('simpleName')])}})()`);
check('two packages expanded at once', both.svc && both.repo);
check('no cards overlap with two expanded', (await overlaps()).length === 0, await overlaps());
check('class-to-class routes between two expanded packages', both.edges.some(([a, b]) => a === 'EventService' && ['EventRepository', 'SubscriptionRepository'].includes(b)), both.edges);
await evaluate(`${CY}.fit(undefined,40);0`); await shot('e2-two-packages-expanded');

// ---- Nested: expand EventService (a class inside services) into its methods
const eventService = byName('EventService', 'CLASS');
await evaluate(`${CY}.zoom(0.8);${CY}.center(${CY}.getElementById('${eventService.id}'));0`); await pause(500);
await click(await cornerPoint(eventService.id, 60));
await until(() => evaluate(`${CY}.getElementById('${eventService.id}').isParent()`), 'nested expanded', 25).catch(() => { });
const nested = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${eventService.id}');return{parent:n.isParent(),grand:n.parent().id(),kids:n.children().length,methodEdges:cy.edges().filter(e=>['METHOD','CONSTRUCTOR'].includes(e.source().data('kind'))).map(e=>[e.source().data('simpleName'),e.target().data('simpleName'),e.data('kind')])}})()`);
check('a class inside an expanded package expands into its methods', nested.parent && nested.grand === services.id && nested.kids > 0, nested);
check('method routes reach classes/packages outside', nested.methodEdges.length > 0, nested.methodEdges.slice(0, 6));
check('no cards overlap after a nested expansion (siblings and outer boxes made room)', (await overlaps()).length === 0, await overlaps());
await evaluate(`${CY}.fit(undefined,40);0`); await shot('e3-nested-class-methods');

// ---- Resize a leaf card (controllers) via its grip
await evaluate(`${CY}.zoom(1);${CY}.center(${CY}.getElementById('${controllers.id}'));0`); await pause(600);
const cPristine = await evaluate(`(()=>{const n=${CY}.getElementById('${controllers.id}'),bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{w:n.width(),h:n.height(),x1:bb.x1,y1:bb.y1}})()`);
const grip = await gripOf('controllers');
check('leaf card has a resize grip', !!grip);

// ---- F-07 regression: Escape mid-resize reverts to the pre-drag size instead of committing
// whatever partial size the pointer last reached (docs/evidence/card-expansion/remediation-plan.md).
// Run before the real resize below, on the grip's pristine, never-yet-dragged position.
if (grip) {
  await mouse('mouseMoved', grip, 'none');
  await mouse('mousePressed', grip);
  const midPoint = { x: grip.x + 80, y: grip.y + 60 };
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', { x: grip.x + (midPoint.x - grip.x) * i / 8, y: grip.y + (midPoint.y - grip.y) * i / 8 });
  await pause(150);
  // Read the data fields the live drag writes directly (n.width() mirrors data(cardWidth) but is
  // not guaranteed to recompute before the next Cytoscape render tick).
  const midSize = await evaluate(`(()=>{const n=${CY}.getElementById('${controllers.id}');return{w:n.data('cardWidth'),h:n.data('cardHeight')}})()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pause(150);
  await mouse('mouseReleased', midPoint);
  await pause(400);
  const cCancelled = await evaluate(`(()=>{const n=${CY}.getElementById('${controllers.id}'),bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{w:n.width(),h:n.height(),x1:bb.x1,y1:bb.y1}})()`);
  check('the drag was actually in progress when Escape was pressed', midSize.w !== cPristine.w, { midSize, cPristine });
  check('F-07: Escape mid-resize reverts to the pre-drag size and position, no partial commit', Math.abs(cCancelled.w - cPristine.w) < 1 && Math.abs(cCancelled.h - cPristine.h) < 1 && Math.abs(cCancelled.x1 - cPristine.x1) < 1 && Math.abs(cCancelled.y1 - cPristine.y1) < 1, { cPristine, cCancelled });
} else check('F-07: Escape mid-resize reverts to the pre-drag size and position, no partial commit', false, 'no grip found to test');

const cBefore = await evaluate(`(()=>{const n=${CY}.getElementById('${controllers.id}'),bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{w:n.width(),h:n.height(),x1:bb.x1,y1:bb.y1}})()`);
if (grip) await drag(grip, { x: grip.x + 120, y: grip.y + 150 });
await pause(400);
const cAfter = await evaluate(`(()=>{const n=${CY}.getElementById('${controllers.id}'),bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{w:n.width(),h:n.height(),x1:bb.x1,y1:bb.y1}})()`);
check('no cards overlap after resizing a card (neighbors made room)', (await overlaps()).length === 0, await overlaps());
check('dragging the grip resizes the card', Math.abs(cAfter.w - cBefore.w - 120) < 3 && Math.abs(cAfter.h - cBefore.h - 150) < 3, { cBefore, cAfter });
check('resize keeps the top-left corner', Math.abs(cAfter.x1 - cBefore.x1) < 1.5 && Math.abs(cAfter.y1 - cBefore.y1) < 1.5);
await shot('e4-resized-package-card');

// ---- Resize an expanded container via its grip; model box must match expansionLayout.containerBox
await evaluate(`${CY}.zoom(0.7);${CY}.center(${CY}.getElementById('${repos.id}'));0`); await pause(600);
const rBefore = await evaluate(`(()=>{const bb=${CY}.getElementById('${repos.id}').boundingBox({includeLabels:false,includeOverlays:false});return{w:bb.w,h:bb.h,x1:bb.x1,y1:bb.y1}})()`);
const rGrip = await gripOf('repositories');
if (rGrip) await drag(rGrip, { x: rGrip.x + 140, y: rGrip.y + 70 });
await pause(400);
const rAfter = await evaluate(`(()=>{const bb=${CY}.getElementById('${repos.id}').boundingBox({includeLabels:false,includeOverlays:false});return{w:bb.w,h:bb.h,x1:bb.x1,y1:bb.y1}})()`);
check('no cards overlap after resizing a container', (await overlaps()).length === 0, await overlaps());
check('dragging a container grip grows its box right/down', Math.abs(rAfter.w - rBefore.w - 200) < 4 && Math.abs(rAfter.h - rBefore.h - 100) < 4 && Math.abs(rAfter.x1 - rBefore.x1) < 1.5, { rBefore, rAfter });
await shot('e5-resized-container');

// ---- Everything survives a level round trip (stored state, not just Cytoscape)
const snap = () => evaluate(`(()=>{const cy=${CY};const pick=id=>{const n=cy.getElementById(id);const bb=n.boundingBox({includeLabels:false,includeOverlays:false});return n.length?{parent:n.isParent(),x1:Math.round(bb.x1),y1:Math.round(bb.y1),w:Math.round(bb.w),h:Math.round(bb.h)}:null};return{svc:pick('${services.id}'),repo:pick('${repos.id}'),ctrl:pick('${controllers.id}'),es:pick('${eventService.id}')}})()`);
const beforeTrip = await snap();
await level('Classes'); await level('Packages'); await pause(500);
const afterTrip = await snap();
check('expansions, sizes and positions survive a level switch', JSON.stringify(beforeTrip) === JSON.stringify(afterTrip), { beforeTrip, afterTrip });

// ---- Drag an expanded container: its children move and persist
const esKidsBefore = await evaluate(`${CY}.getElementById('${repos.id}').children().map(c=>c.position())`);
const hdr = await evaluate(`(()=>{const cy=${CY},b=document.querySelector('.graph-canvas').getBoundingClientRect(),bb=cy.getElementById('${repos.id}').renderedBoundingBox({includeLabels:false,includeOverlays:false});return{x:b.left+bb.x1+60,y:b.top+bb.y1+12}})()`);
await drag(hdr, { x: hdr.x - 420, y: hdr.y + 40 }); await pause(400);
await level('Classes'); await level('Packages'); await pause(500);
const esKidsAfter = await evaluate(`${CY}.getElementById('${repos.id}').children().map(c=>c.position())`);
check('dragging an expanded card moves and stores its children', esKidsAfter.length && esKidsAfter.every((p, i) => Math.abs(p.x - esKidsBefore[i].x) > 200), { esKidsBefore, esKidsAfter });

// ---- F-02 regression: dragging a container that itself holds a NESTED expanded card (services ->
// EventService, still expanded into methods from the "Nested" step) must not corrupt or crash the
// nested card's own subtree -- previously reportMoved dropped an expanded descendant entirely,
// leaving its stored anchor stale (docs/evidence/card-expansion/remediation-plan.md).
const esMethodsBefore = await evaluate(`${CY}.getElementById('${eventService.id}').children().map(c=>c.position())`);
const esBoxBefore = await evaluate(`(()=>{const bb=${CY}.getElementById('${eventService.id}').boundingBox({includeLabels:false,includeOverlays:false});return{x1:bb.x1,y1:bb.y1}})()`);
// A manual drag is free placement (not make-room), so it may legitimately land on top of another
// card -- that is not what this check is about. Drag into open space, well clear of the current
// bounding box of everything, so any overlap found afterward is a real consequence of the drag/round
// trip and not just two cards colliding because the target point was picked blind.
const svcHdr = await evaluate(`(()=>{const cy=${CY},b=document.querySelector('.graph-canvas').getBoundingClientRect(),bb=cy.getElementById('${services.id}').renderedBoundingBox({includeLabels:false,includeOverlays:false});return{x:b.left+bb.x1+60,y:b.top+bb.y1+12}})()`);
const clearTarget = await evaluate(`(()=>{const cy=${CY},b=document.querySelector('.graph-canvas').getBoundingClientRect(),whole=cy.elements().boundingBox(),z=cy.zoom(),pan=cy.pan();return{x:b.left+(whole.x2+700)*z+pan.x,y:b.top+(whole.y1+150)*z+pan.y}})()`);
await drag(svcHdr, clearTarget); await pause(400);
check('dragging services into open space did not collide with anything (setup, not the regression itself)', (await overlaps()).length === 0, await overlaps());
await level('Classes'); await level('Packages'); await pause(500);
const esMethodsAfter = await evaluate(`${CY}.getElementById('${eventService.id}').children().map(c=>c.position())`);
const esBoxAfter = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${eventService.id}');return n.isParent()?(()=>{const bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{x1:bb.x1,y1:bb.y1}})():null})()`);
check('F-02: a nested expanded card and its own children survive dragging its container and a level round trip', !!esBoxAfter && esMethodsAfter.length === esMethodsBefore.length && (await overlaps()).length === 0, { esBoxBefore, esBoxAfter, esMethodsBefore, esMethodsAfter, overlaps: await overlaps() });

// ---- Collapse returns a card at the box's top-left
const boxTL = await evaluate(`(()=>{const bb=${CY}.getElementById('${services.id}').boundingBox({includeLabels:false,includeOverlays:false});return{x1:bb.x1,y1:bb.y1}})()`);
await evaluate(`${CY}.zoom(0.5);${CY}.center(${CY}.getElementById('${services.id}'));0`); await pause(500);
await click(await collapsePoint(services.id));
await until(() => evaluate(`!${CY}.getElementById('${services.id}').isParent()`), 'collapsed', 25).catch(() => { });
const col = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${services.id}'),bb=n.boundingBox({includeLabels:false,includeOverlays:false});return{parent:n.isParent(),x1:bb.x1,y1:bb.y1,es:cy.getElementById('${eventService.id}').length}})()`);
check('no cards overlap after collapsing', (await overlaps()).length === 0, await overlaps());
check('collapse turns the box back into a card at its top-left', !col.parent && col.es === 0 && Math.abs(col.x1 - boxTL.x1) < 6 && Math.abs(col.y1 - boxTL.y1) < 6, { boxTL, col });

// ---- Class level: expand a class to see method relations to other classes
await level('Classes'); await pause(400);
await evaluate(`${CY}.zoom(0.9);${CY}.center(${CY}.getElementById('${eventService.id}'));0`); await pause(500);
await click(await cornerPoint(eventService.id, 60));
await until(() => evaluate(`${CY}.getElementById('${eventService.id}').isParent()`), 'class expanded', 25).catch(() => { });
const cls = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${eventService.id}');return{parent:n.isParent(),kids:n.children().map(c=>c.data('simpleName')),edges:cy.edges().filter(e=>e.source().parent().id()==='${eventService.id}').map(e=>[e.source().data('simpleName'),e.target().data('simpleName'),e.data('kind')])}})()`);
check('class level: a class expands into its methods', cls.parent && cls.kids.length > 0, cls.kids);
check('class level: methods route to other classes', cls.edges.some(([, b]) => b !== 'EventService'), cls.edges);
check('class level: no cards overlap after expanding', (await overlaps()).length === 0, await overlaps());
await evaluate(`${CY}.fit(undefined,40);0`); await shot('e6-class-level-methods');

// ---- Inspect a method inside the container: container not muted, inspector opens
const mId = await evaluate(`${CY}.getElementById('${eventService.id}').children()[0].id()`);
await evaluate(`${CY}.getElementById('${mId}').emit('tap');0`); await pause(500);
const insp = await evaluate(`(()=>{const cy=${CY};return{containerMuted:cy.getElementById('${eventService.id}').hasClass('muted'),inspected:cy.getElementById('${mId}').hasClass('inspected')}})()`);
check('inspecting a card inside a container keeps the container unmuted', insp.inspected && !insp.containerMuted, insp);
await shot('e7-inspect-method-inside');

// ---- Double-click arrange around the expanded class keeps it as one box
await evaluate(`${CY}.getElementById('${eventService.id}').emit('dbltap');0`); await pause(600);
const arr = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${eventService.id}');return{parent:n.isParent(),kids:n.children().length}})()`);
check('arrange around an expanded card keeps its children inside', arr.parent && arr.kids > 0, arr);
await evaluate(`${CY}.fit(undefined,40);0`); await shot('e8-arranged-around-expanded');

// ---- A route crossing an ordinary card's corner square still inspects the route (only an expanded
// box's collapse square takes a tap from a route drawn over it).
await evaluate(`${CY}.fit(undefined,40);0`); await pause(500);
const crossing = await evaluate(`(()=>{const cy=${CY},r=cy.renderer(),b=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),pan=cy.pan();
  const squares=[];cy.nodes().forEach(n=>{if(n.data('expanded'))return;const c=n.position(),kinds=n.data('kind')==='PACKAGE'?[12]:(n.data('detailCount')>0?[12,60]:[12]);for(const right of kinds){const x2=c.x+n.width()/2-right,y1=c.y-n.height()/2+12;squares.push({id:n.id(),x1:x2-40,x2,y1,y2:y1+40});}});
  for(const e of cy.edges()){const s=e.sourceEndpoint(),t=e.targetEndpoint();for(let f=.02;f<.98;f+=.01){const x=s.x+(t.x-s.x)*f,y=s.y+(t.y-s.y)*f;const sq=squares.find(q=>x>q.x1+4&&x<q.x2-4&&y>q.y1+4&&y<q.y2-4);if(!sq)continue;const hit=r.findNearestElement(x,y,true,false);const rx=x*z+pan.x,ry=y*z+pan.y;if(hit&&hit.isEdge()&&hit.id()===e.id()&&rx>20&&ry>20&&rx<cy.width()-20&&ry<cy.height()-20)return{edge:e.id(),card:sq.id,x:b.left+rx,y:b.top+ry};}}return null})()`);
if (crossing) {
  await evaluate(`document.querySelector('.inspector .icon-button')?.click()`); await pause(300);
  await click(crossing); await pause(600);
  const after = await evaluate(`({relationship:(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship'),dialog:!!document.querySelector('dialog[open]'),expanded:${CY}.getElementById(${JSON.stringify(crossing.card)}).isParent()})`);
  check('a route crossing a card corner square inspects the route, not the card button', after.relationship && !after.dialog && !after.expanded, { crossing, after });
  await evaluate(`document.querySelector('dialog[open] button')?.click()`); await pause(200);
} else console.log('INFO no route crosses an ordinary card corner square in this view; that case was not exercised');

// ---- F-01 regression: collapsing a box must not pull a row-mate that qualified for a shift back
// across a row-mate that stayed put on that axis (docs/evidence/card-expansion/remediation-plan.md).
// Two independent, previously untouched packages (domain has classes to expand; dtos/exceptions do
// not need to) are dragged into the exact shape that broke the old per-card roomShift: C1 stays left
// of the box's right edge (dx = 0), C2 sits flush against it (dx != 0), both in the same row below.
{
  const domain = byName('com.kipper.eventsmicroservice.domain', 'PACKAGE'), dtos = byName('com.kipper.eventsmicroservice.dtos', 'PACKAGE'), exceptions = byName('com.kipper.eventsmicroservice.exceptions', 'PACKAGE');
  if (domain && dtos && exceptions) {
    await level('Packages'); await pause(400); // the class-level tests above left the map on Classes, where package cards do not exist
    const dragToModel = async (id, target) => {
      const start = await evaluate(`(()=>{const cy=${CY},b=document.querySelector('.graph-canvas').getBoundingClientRect(),p=cy.getElementById('${id}').renderedPosition();return{x:b.left+p.x,y:b.top+p.y}})()`);
      const end = await evaluate(`(()=>{const b=document.querySelector('.graph-canvas').getBoundingClientRect(),cy=${CY},pan=cy.pan(),z=cy.zoom();return{x:b.left+${target.x}*z+pan.x,y:b.top+${target.y}*z+pan.y}})()`);
      await drag(start, end);
    };
    await evaluate(`${CY}.zoom(0.6);${CY}.center(${CY}.getElementById('${domain.id}'));0`); await pause(500);
    await click(await cornerPoint(domain.id, 12));
    await until(() => evaluate(`${CY}.getElementById('${domain.id}').isParent()`), 'domain expanded', 25).catch(() => { });
    const dBefore = await evaluate(`(()=>{const bb=${CY}.getElementById('${domain.id}').boundingBox({includeLabels:false,includeOverlays:false});return{x1:bb.x1,y1:bb.y1,x2:bb.x2,y2:bb.y2}})()`);
    // C1 (dtos): well left of the box's right edge, same row below it -- must stay put in x on collapse.
    await dragToModel(dtos.id, { x: dBefore.x1 - 220, y: dBefore.y2 + 150 });
    // C2 (exceptions): flush against the box's right edge, same row as C1 -- qualifies for the full
    // collapse shift, which the old unclamped rule would have pulled straight across C1.
    await dragToModel(exceptions.id, { x: dBefore.x2 + 90, y: dBefore.y2 + 150 });
    await pause(300);
    check('C1/C2 placed in the same row, C1 left of the box, C2 flush against its right edge (setup, not the regression itself)', (await overlaps()).length === 0, await overlaps());
    await click(await collapsePoint(domain.id));
    await until(() => evaluate(`!${CY}.getElementById('${domain.id}').isParent()`), 'domain collapsed', 25).catch(() => { });
    await pause(300);
    check('F-01: collapsing the box does not pull the flush-against-the-edge card across the one that stayed put', (await overlaps()).length === 0, await overlaps());
    await shot('e9-f01-collapse-no-overlap');
  } else check('F-01: collapsing the box does not pull the flush-against-the-edge card across the one that stayed put', false, 'fixture packages domain/dtos/exceptions not found');
}

const known = e => /custom wheel sensitivity/.test(e), overlap = e => /invalid endpoints/.test(e);
console.log('INFO overlap warnings (cards drawn on top of each other):', errors.filter(overlap).length);
check('no page errors or console errors', errors.filter(e => !known(e) && !overlap(e)).length === 0, errors.filter(e => !known(e) && !overlap(e)).slice(0, 5));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
socket.close();
process.exit(results.every(r => r.pass) ? 0 : 1);
