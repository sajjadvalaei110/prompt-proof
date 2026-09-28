// Ungroup acceptance (step 14, ADR 0011) via Chromium CDP: an expanded package or class box can be
// ungrouped (its box hidden, its children kept as free cards) from its corner button or its card
// menu, freed cards move anywhere, and "Collapse into X" brings the parent back as a collapsed card.
// It also checks that the tree's "View methods" and a ?selectedSymbol= deep link open a class inside
// its collapsed package (review remediation, 2026-09-28).
// Requires BACKEND, APP and DEBUG (a packaged jar on an isolated data dir, and a headless Chromium);
// scripts/verify_ungroup_pipeline.py starts both and prepares the fixtures.
//   node scripts/verify-ungroup-ui.mjs <microservice-java copy> <git copy of it> <git base oid>
// The Git copy changes EventService in the working tree, so Changes marks the services package
// MODIFIED. Both fixtures are only read.
import fs from 'node:fs/promises';
const OUT = process.env.OUT || 'build/ungroup';
await fs.mkdir(OUT, { recursive: true });
const base = process.env.BACKEND, app = process.env.APP, debug = process.env.DEBUG;
const [fixture, gitFixture, baseOid] = process.argv.slice(2);
if (!base || !app || !debug || !fixture || !gitFixture || !baseOid) throw Error('Usage: BACKEND=.. APP=.. DEBUG=.. verify-ungroup-ui.mjs <fixture> <git fixture> <base oid>');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, tries = 150) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { } await pause(200); } throw Error('Timed out: ' + label); }
const results = [];
const check = (label, pass, detail) => { results.push({ label, pass: !!pass }); console.log(pass ? 'PASS' : 'FAIL', label, detail === undefined || pass ? '' : JSON.stringify(detail)); };
const api = async (p, body) => { const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw Error(p + ' ' + r.status); return r.json(); };
async function analyze(path) {
  const ws = await api('/api/workspaces', { path });
  const job = await api(`/api/workspaces/${ws.id}/analysis-jobs`, {});
  await until(async () => (await api(`/api/jobs/${job.id}`)).status === 'COMPLETED', 'analysis of ' + path);
  const snapshot = (await api(`/api/workspaces/${ws.id}`)).activeSnapshotId;
  return { snapshot, graph: await api(`/api/snapshots/${snapshot}/graph`) };
}
const micro = await analyze(fixture), review = await analyze(gitFixture);
const byName = (graph, kind, name) => graph.nodes.find(n => (kind === 'PACKAGE' ? n.kind === 'PACKAGE' : n.kind !== 'PACKAGE') && (n.qualifiedName === name || n.simpleName === name));

const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
socket.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id) { const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.reject(Error(JSON.stringify(m.error))) : w.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); };
const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async name => { await pause(700); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
const mouse = (type, p, button = 'left', buttons = type === 'mouseReleased' || button === 'none' ? 0 : button === 'right' ? 2 : 1) => cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons, clickCount: 1 });
const click = async p => { await mouse('mouseMoved', p, 'none'); await mouse('mousePressed', p); await mouse('mouseReleased', p); await pause(400); };
const dblclick = async p => {
  await mouse('mouseMoved', p, 'none');
  for (const clickCount of [1, 2]) {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount });
  }
  await pause(600);
};
const rightClick = async p => { await mouse('mouseMoved', p, 'none'); await mouse('mousePressed', p, 'right'); await mouse('mouseReleased', p, 'right'); await pause(400); };
const drag = async (from, to) => {
  await mouse('mouseMoved', from, 'none'); await mouse('mousePressed', from);
  for (let i = 1; i <= 12; i++) await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / 12, y: from.y + (to.y - from.y) * i / 12 }, 'left', 1);
  await mouse('mouseReleased', to); await pause(500);
};
const key = async k => { const codes = { Escape: 27, ContextMenu: 93 }; await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: codes[k] }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: codes[k] }); await pause(350); };
const CY = "document.querySelector('.graph-canvas')._cyreg.cy";
// A tree row can sit below the tree's visible area (step 13's tree toolbar and "Recently viewed" take
// room), where a click at its centre lands on whatever covers it: scroll navigation rows into view.
// Canvas overlays are never scrolled.
const centerOf = selector => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing '+${JSON.stringify(selector)});if(b.closest('.navigation'))b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const exists = selector => evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
const rectOf = selector => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)return null;const r=b.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
const clickSelector = async selector => { await until(() => exists(selector), 'visible ' + selector, 25); await click(await centerOf(selector)); };
const buttonByText = async text => click(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
const menuItems = () => evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].map(b=>b.textContent.trim())`);
// A card's on-screen point: the canvas offset plus Cytoscape's rendered position.
const screenOf = id => evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(id)});const r=document.querySelector('.graph-canvas').getBoundingClientRect(),p=n.renderedPosition();return{x:r.x+p.x,y:r.y+p.y}})()`);
const node = id => evaluate(`(()=>{const n=${CY}.getElementById(${JSON.stringify(id)});if(!n.length)return null;const bb=n.isParent()?n.boundingBox({includeLabels:false,includeOverlays:false}):{x1:n.position('x')-n.width()/2,y1:n.position('y')-n.height()/2,x2:n.position('x')+n.width()/2,y2:n.position('y')+n.height()/2};return{parent:n.parent().length?n.parent().id():null,expanded:!!n.data('expanded'),hidden:!!n.data('hiddenBox'),position:n.position(),bb:{x1:bb.x1,y1:bb.y1,x2:bb.x2,y2:bb.y2},children:n.children().map(c=>c.id()).sort(),style:{bg:n.style('background-opacity'),border:n.style('border-width'),outline:n.style('outline-opacity'),underlay:n.style('underlay-opacity'),label:n.style('label'),events:n.style('events')}}})()`);
const invisible = s => s.bg === '0' && s.border === '0px' && s.outline === '0' && s.underlay === '0' && !s.label && s.events === 'no';
const touching = id => evaluate(`${CY}.edges().filter(e=>e.source().id()===${JSON.stringify(id)}||e.target().id()===${JSON.stringify(id)}).map(e=>e.id())`);
const inspected = () => evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent||null`);
const openMap = async snapshot => {
  await cdp('Page.navigate', { url: `${app}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`), 'map');
  await pause(1200);
};
// Zoom so the whole map fits (a view-only change) and corner buttons are drawn.
const fit = async () => { await clickSelector('[aria-label="Fit map"]'); await pause(700); };
const zoomOn = async (id, level = 0.8) => { await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(id)});cy.zoom({level:${level},renderedPosition:n.renderedPosition()});cy.center(n);return 0})()`); await pause(700); };

await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Page.bringToFront');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await openMap(micro.snapshot);
const services = byName(micro.graph, 'PACKAGE', 'com.kipper.eventsmicroservice.services');
const domain = byName(micro.graph, 'PACKAGE', 'com.kipper.eventsmicroservice.domain');
const eventService = micro.graph.nodes.find(n => n.simpleName === 'EventService' && n.kind !== 'PACKAGE');
const emailClient = micro.graph.nodes.find(n => n.simpleName === 'EmailServiceClient');
check('setup: the fixture has the services package with EventService and EmailServiceClient', services && eventService && emailClient && domain);

// 1. Expand services, then ungroup it from its corner button (a real click on the square).
await zoomOn(services.id);
await clickSelector(`[aria-label="Show types inside ${services.simpleName}"]`);
await until(async () => (await node(services.id))?.expanded, 'services expanded');
await zoomOn(services.id, 0.6);
// Select the box (the tree's ⌖ on an expanded package only inspects it; a click on the box could
// land on a route crossing it) so its stack toggle is drawn too: Ungroup sits left of the toggle's
// slot, which sits left of the collapse square, all on one row and none overlapping.
await clickSelector(`[aria-label="View classes in ${services.simpleName.split('.').pop()}"]`);
await until(() => exists(`.map-stack-button[data-card-id="${services.id}"]`), 'stack toggle on the selected box', 25).catch(() => {});
const rects = { ungroup: await rectOf(`[aria-label="Ungroup ${services.simpleName}"]`), stack: await rectOf(`.map-stack-button[data-card-id="${services.id}"]`), collapse: await rectOf(`[aria-label="Collapse ${services.simpleName}"]`) };
check('an expanded box shows the Ungroup button left of its stack toggle and collapse square, without overlap', rects.ungroup && rects.stack && rects.collapse && rects.ungroup.right <= rects.stack.left && rects.stack.right <= rects.collapse.left && Math.abs(rects.ungroup.top - rects.collapse.top) < 1 && Math.abs(rects.stack.top - rects.collapse.top) < 1, { rects, inspected: await inspected() });
await buttonByText('Clear selection');
const expandedBox = await node(services.id);
check('before ungrouping, the box is drawn', !invisible(expandedBox.style), expandedBox.style);
const before = { es: await node(eventService.id), ec: await node(emailClient.id) };
await clickSelector(`[aria-label="Ungroup ${services.simpleName}"]`);
let s = await node(services.id);
check('Ungroup hides the box: no fill, border, outline, underlay or label, and no pointer events', s.hidden && invisible(s.style), s.style);
check('the freed classes stay where they were, still inside services', same((await node(eventService.id)).position, before.es.position) && (await node(eventService.id)).parent === services.id && (await node(emailClient.id)).parent === services.id);
check('the hidden box has no corner buttons of its own', !await exists(`[data-card-id="${services.id}"]`));
check('no route is drawn to the hidden box; routes attach to the freed classes', (await touching(services.id)).length === 0 && ((await touching(eventService.id)).length + (await touching(emailClient.id)).length) > 0);
check('the minimap does not draw the hidden box', await evaluate(`document.querySelectorAll('.minimap svg rect').length-1 === ${CY}.nodes().filter(n=>!n.data('hiddenBox')).length`));
await shot('01-ungrouped-package');

// 1b. The hidden card is off the map: picked from the tree ("View classes"), it lights nothing,
//     mutes nothing, stays hidden, the inspector says it is ungrouped, and the keyboard card menu
//     does not open on it.
await clickSelector('[aria-label="View classes in services"]');
await until(async () => (await inspected()) !== null, 'services inspected from the tree');
s = await node(services.id);
check('a hidden package picked from the tree stays hidden with no emphasis on the map', s.hidden && invisible(s.style) && await evaluate(`${CY}.elements('.muted, .inspected, .rel-out, .rel-in, .rel-both').length===0`), await evaluate(`${CY}.elements('.muted, .inspected').map(e=>e.id())`));
check('the inspector says the package is ungrouped and offers neither an arrangement nor "View classes"', await evaluate(`[...document.querySelectorAll('.inspector .notice')].some(p=>p.textContent.startsWith('Ungrouped on the map'))`) && await evaluate(`document.querySelector('.arrange-action').disabled`) && !await evaluate(`[...document.querySelectorAll('.inspector button')].some(b=>b.textContent.trim()==='View classes ↗')`));
await evaluate('document.activeElement?.blur();0');
await key('ContextMenu');
check('the keyboard card menu does not open on the hidden package', !await exists('.graph-context-menu'));
await shot('01b-hidden-package-picked-from-tree');
await buttonByText('Clear selection');

// 2. Freed cards move anywhere; the invisible parent never catches a click.
const esPoint = await screenOf(eventService.id);
await drag(esPoint, { x: esPoint.x + 420, y: esPoint.y + 260 });
s = await node(eventService.id);
check('a freed class is dragged far away on its own', Math.abs(s.position.x - before.es.position.x) > 100 && same((await node(emailClient.id)).position, before.ec.position) && s.parent === services.id, s.position);
const hiddenBox = (await node(services.id)).bb;
// Drag domain into the middle of the hidden box's (now large) area, then click it there.
const middle = await evaluate(`(()=>{const cy=${CY},r=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),p=cy.pan();const b=${JSON.stringify(hiddenBox)};return{x:r.x+p.x+z*(b.x1+b.x2)/2,y:r.y+p.y+z*(b.y1+b.y2)/2}})()`);
await drag(await screenOf(domain.id), middle);
const dm = await node(domain.id);
check('a top-level card can sit inside the hidden box area and stays top-level', dm.parent === null && dm.bb.x1 < hiddenBox.x2 && dm.bb.x2 > hiddenBox.x1 && dm.bb.y1 < hiddenBox.y2 && dm.bb.y2 > hiddenBox.y1, { dm: dm.bb, hiddenBox });
await click(await screenOf(domain.id));
check('a click there reaches that card, not the hidden box', await inspected() === domain.simpleName.split('.').pop() || (await inspected() || '').includes('domain'), await inspected());
await shot('02-freed-card-moved');
// Put domain back (one undo step: the drag), so it does not cover services when that returns.
await buttonByText('↶ Undo');
check('undoing the domain drag leaves the freed class where it was dragged', same((await node(eventService.id)).position, s.position) && (await node(services.id)).hidden);

// 3. "Collapse into services" from a freed class's menu brings services back as a collapsed card,
//    centred on its children's current bounds; undo/redo walk it.
const kids = [await node(eventService.id), await node(emailClient.id)];
const bounds = { x1: Math.min(...kids.map(k => k.bb.x1)), y1: Math.min(...kids.map(k => k.bb.y1)), x2: Math.max(...kids.map(k => k.bb.x2)), y2: Math.max(...kids.map(k => k.bb.y2)) };
await rightClick(await screenOf(emailClient.id));
let items = await menuItems();
check('a freed class menu offers "Collapse into services" (and no Ungroup, since it is not a box)', items.some(t => t.endsWith(`Collapse into ${services.simpleName}`)) && !items.some(t => t.includes('Ungroup')), items);
await shot('03-collapse-into-menu');
await buttonByText(`⊟ Collapse into ${services.simpleName}`);
s = await node(services.id);
const centre = { x: (bounds.x1 + bounds.x2) / 2, y: (bounds.y1 + bounds.y2) / 2 };
check('services is a collapsed card again, centred on where its classes were', s && !s.expanded && !s.hidden && Math.abs(s.position.x - centre.x) < 1 && Math.abs(s.position.y - centre.y) < 1 && !await node(eventService.id), { position: s?.position, centre });
check('the right-clicked class did not stay in the multi-selection', !await exists('.selection-bar'));
await buttonByText('↶ Undo');
check('undo brings back the hidden box with its classes where they were', (await node(services.id)).hidden && same((await node(eventService.id)).position, kids[0].position));
await buttonByText('↷ Redo');
check('redo collapses it again', !(await node(services.id)).expanded);
await shot('04-collapsed-again');

// 4. Ungroup from the expanded box's own card menu; the box is right-clicked (so multi-selected) and
//    still shows nothing afterwards. Redo restored the camera; let it settle before zooming.
await pause(800);
await zoomOn(services.id);
await clickSelector(`[aria-label="Show types inside ${services.simpleName}"]`);
await until(async () => (await node(services.id))?.expanded, 'services expanded again');
await zoomOn(services.id, 0.6);
const boxHeader = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(services.id)}),r=document.querySelector('.graph-canvas').getBoundingClientRect(),b=n.renderedBoundingBox({includeLabels:false});return{x:r.x+(b.x1+b.x2)/2,y:r.y+b.y1+14}})()`);
await rightClick(boxHeader);
items = await menuItems();
check('the expanded box menu offers "Ungroup services"', items.some(t => t.endsWith(`Ungroup ${services.simpleName}`)), items);
await buttonByText(`⬚ Ungroup ${services.simpleName}`);
s = await node(services.id);
check('Ungroup from the menu hides the box, with no selection outline left on it', s.hidden && invisible(s.style) && !await evaluate(`${CY}.getElementById(${JSON.stringify(services.id)}).hasClass('multi-selected')`), s.style);
await shot('05-ungrouped-from-menu');

// 5. Ungroup a class inside the hidden package: its methods stand free and name their class.
await zoomOn(eventService.id, 0.8);
await clickSelector(`[aria-label="Show methods inside ${eventService.simpleName}"]`);
await until(async () => (await node(eventService.id))?.expanded, 'EventService expanded');
await zoomOn(eventService.id, 0.6);
await clickSelector(`[aria-label="Ungroup ${eventService.simpleName}"]`);
s = await node(eventService.id);
const methods = s.children;
check('the class box is hidden and its methods stay inside it', s.hidden && invisible(s.style) && methods.length > 0, s);
const cardText = await evaluate(`decodeURIComponent(${CY}.getElementById(${JSON.stringify(methods[0])}).data('card'))`);
// At the default card width the package tail is cut from the end; the class name always survives.
check('a freed method card names its class first: "EventService · <package tail>"', /> *EventService · eventsmicro[^<]*</.test(cardText), cardText.match(/>[^<]*·[^<]*</)?.[0]);
await rightClick(await screenOf(methods[0]));
items = await menuItems();
check('a freed method menu offers only its nearest hidden parent', items.some(t => t.endsWith(`Collapse into ${eventService.simpleName}`)) && !items.some(t => t.endsWith(`Collapse into ${services.simpleName}`)), items);
await key('Escape');
await shot('06-methods-freed');

// 6. Double-click arrangement moves freed cards one by one around the focus.
const methodPositions = Object.fromEntries(await Promise.all(methods.map(async id => [id, (await node(id)).position])));
const focusBefore = (await node(emailClient.id)).position;
await dblclick(await screenOf(emailClient.id));
const focusAfter = (await node(emailClient.id)).position;
// Moved as one block, every method would shift by the same vector; arranged one by one, they do not.
const shifts = [];
for (const id of methods) { const p = (await node(id)).position; shifts.push({ id, dx: p.x - methodPositions[id].x, dy: p.y - methodPositions[id].y }); }
const distinctShifts = new Set(shifts.map(v => `${Math.round(v.dx)},${Math.round(v.dy)}`));
check('arranging around a freed class keeps it in place and moves freed methods individually, not the hidden box as one block', same(focusAfter, focusBefore) && methods.length >= 2 && distinctShifts.size >= 2, { focusBefore, focusAfter, shifts });
await shot('07-arranged-around-freed-class');

// 6b. "Collapse into EventService" from a freed method: the class returns as a collapsed card, still
//     a freed card inside the hidden services, its methods leave the map, and services stays hidden.
await zoomOn(methods[0], 0.8);
const multiSelected = () => evaluate(`${CY}.nodes('.multi-selected').map(n=>n.id())`);
await rightClick(await screenOf(methods[0]));
const selectedBefore = await multiSelected();
await buttonByText(`⊟ Collapse into ${eventService.simpleName}`);
const selectedCollapsed = await multiSelected();
s = await node(eventService.id);
const methodsLeft = (await Promise.all(methods.map(node))).filter(Boolean).length;
const sv = await node(services.id);
check('Collapse into EventService brings it back as a collapsed card inside the still-hidden services, and its methods leave the map', s && !s.expanded && !s.hidden && s.parent === services.id && methodsLeft === 0 && sv.hidden && invisible(sv.style), { es: s && { expanded: s.expanded, hidden: s.hidden, parent: s.parent }, methodsLeft, services: sv.hidden });
await shot('06b-collapsed-into-class');
// Review finding 6: the right-clicked method was multi-selected; collapsing took it off the map, so
// expanding the class again must not bring it back selected.
await zoomOn(eventService.id, 0.8);
await clickSelector(`[aria-label="Show methods inside ${eventService.simpleName}"]`);
await until(async () => (await node(eventService.id))?.expanded, 'EventService expanded again');
const selectedAfter = await multiSelected();
check('a method multi-selected before the collapse is not selected again when its class re-expands', selectedBefore.includes(methods[0]) && same(selectedCollapsed, selectedBefore.filter(id => !methods.includes(id))) && !selectedAfter.some(id => methods.includes(id)), { selectedBefore, selectedCollapsed, selectedAfter });

// 7. Changes mode: a MODIFIED package ungroups the same way; its change fill does not show.
await openMap(review.snapshot);
const rServices = byName(review.graph, 'PACKAGE', 'com.kipper.eventsmicroservice.services');
await clickSelector('.review-options summary');
await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Default merge base, or origin/main"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,${JSON.stringify(baseOid)});e.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await clickSelector('.review-options summary');
await evaluate(`document.querySelector('.review-toggle').click();0`);
await until(() => evaluate(`${CY}.getElementById(${JSON.stringify(rServices.id)}).data('reviewChange')==='MODIFIED'`), 'Changes overlay marks services MODIFIED');
await zoomOn(rServices.id);
await clickSelector(`[aria-label="Show types inside ${rServices.simpleName}"]`);
await until(async () => (await node(rServices.id))?.expanded, 'Changes: services expanded');
await zoomOn(rServices.id, 0.6);
await clickSelector(`[aria-label="Ungroup ${rServices.simpleName}"]`);
s = await node(rServices.id);
check('Changes: a MODIFIED package ungroups and its change fill and border are hidden too', s.hidden && invisible(s.style), s.style);
await shot('08-changes-mode-ungrouped');

// 8. From a fresh map, the tree's ⌖ "View methods" on a class whose package is collapsed opens the
//    package, then the class, and inspects the class (review findings 1 and 2).
await openMap(micro.snapshot);
check('fresh map: services is a collapsed card', !(await node(services.id)).expanded && !await node(eventService.id));
const branch = `[aria-controls="tree-branch-${services.qualifiedName}"]`;
if (await evaluate(`document.querySelector(${JSON.stringify(branch)})?.getAttribute('aria-expanded')!=='true'`)) await clickSelector(branch);
const viewMethods = `[aria-label="View methods of ${eventService.simpleName}"]`;
await until(() => exists(viewMethods), 'tree row for EventService', 25);
await evaluate(`document.querySelector(${JSON.stringify(viewMethods)}).scrollIntoView({block:'center'});0`);
await clickSelector(viewMethods);
await until(async () => (await node(eventService.id))?.expanded, 'EventService expanded from the tree', 50).catch(() => {});
s = await node(eventService.id);
const svTree = await node(services.id);
check('tree ⌖ on a class in a collapsed package expands the package, then the class, and inspects the class', svTree.expanded && !svTree.hidden && s?.expanded && s.parent === services.id && s.children.length > 0 && await inspected() === eventService.simpleName, { services: svTree.expanded, es: s && { expanded: s.expanded, parent: s.parent }, inspected: await inspected() });
await zoomOn(eventService.id, 0.6);
await shot('09-tree-view-methods-reveals-class');

// 9. A deep link to a method draws it inside its class box inside its package box, and inspects it.
const method = micro.graph.nodes.find(n => n.kind === 'METHOD' && n.parentId === eventService.id);
await cdp('Page.navigate', { url: `${app}/?snapshotId=${micro.snapshot}&selectedSymbol=${encodeURIComponent(method.id)}` });
await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`), 'deep-linked map');
await pause(1200);
const m = await node(method.id), mClass = await node(eventService.id), mPkg = await node(services.id);
check('a ?selectedSymbol= deep link to a method draws it inside its class box inside its package box, inspected', m && m.parent === eventService.id && mClass?.expanded && mClass.parent === services.id && mPkg?.expanded && !mPkg.hidden && await inspected() === method.simpleName, { method: m?.parent, cls: mClass && { expanded: mClass.expanded, parent: mClass.parent }, pkg: mPkg?.expanded, inspected: await inspected() });
await zoomOn(method.id, 0.8);
await shot('10-deep-link-method');

check('no page or console errors', errors.filter(e => !/custom wheel sensitivity|invalid endpoints/.test(e)).length === 0, errors);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify({ results }, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
socket.close(); await fetch(debug + '/json/close/' + page.id);
process.exitCode = results.every(r => r.pass) ? 0 : 1;

function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6;
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}
