// Browser verification of the review remediation (GraphCanvas / CSS findings) using Chromium CDP.
// Starts an isolated backend (scratch data dir) and headless Chromium, analyzes a copy of microservice-java.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Run from the repository root after `./gradlew bootJar`: node docs/evidence/map-usability-and-relations/remediation/browser-check.mjs
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const OUT = path.join(ROOT, 'build/remediation-check');
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function until(fn, label, tries = 150) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch { } await pause(200); } throw Error('Timed out: ' + label); }

const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'code-atlas-remediation-')), 'microservice-java');
await fs.cp(path.join(ROOT, 'test-fixtures/microservice-java'), fixture, { recursive: true });
const port = await freePort(), debugPort = await freePort();
const base = `http://127.0.0.1:${port}`, debug = `http://127.0.0.1:${debugPort}`;
const procs = [];
const log = await fs.open(path.join(OUT, 'app.log'), 'w');
procs.push(spawn('java', ['-jar', 'build/libs/code-atlas-0.1.0-SNAPSHOT.jar', `--server.port=${port}`, `--codeatlas.data-dir=${OUT}/data`,
  `--codeatlas.model.base-url=http://127.0.0.1:${await freePort()}/v1`, '--codeatlas.model.model-id=offline-unreachable'], { cwd: ROOT, stdio: ['ignore', log.fd, log.fd] }));
const results = [];
const check = (label, pass, detail) => { results.push({ label, pass: !!pass, detail }); console.log(pass ? 'PASS' : 'FAIL', label, detail === undefined ? '' : JSON.stringify(detail)); };
try {
  await until(async () => (await fetch(base + '/api/health')).ok, 'backend');
  procs.push(spawn('/snap/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${OUT}/chrome`, 'about:blank'], { stdio: 'ignore' }));
  await until(async () => (await fetch(debug + '/json/version')).ok, 'chromium');

  const api = async (p, body) => { const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw Error(p + ' ' + r.status); return r.json(); };
  const ws = await api('/api/workspaces', { path: fixture });
  const job = await api(`/api/workspaces/${ws.id}/analysis-jobs`, {});
  await until(async () => (await api(`/api/jobs/${job.id}`)).status === 'COMPLETED', 'analysis');
  const snapshot = (await api(`/api/workspaces/${ws.id}`)).activeSnapshotId;
  const graph = await api(`/api/snapshots/${snapshot}/graph`);
  const byName = (name, kind) => graph.nodes.find(n => n.simpleName === name && (!kind || n.kind === kind));

  const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  let seq = 0; const pending = new Map(); const errors = [];
  socket.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id) { const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.reject(Error(JSON.stringify(m.error))) : w.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  const cdp = (method, params = {}) => { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); };
  globalThis.__cdp = cdp;
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const shot = async name => { await pause(900); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
  const mouse = (type, p, button = 'left', extra = {}) => cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons: type === 'mouseReleased' || type === 'mouseMoved' && button === 'none' ? 0 : button === 'right' ? 2 : 1, clickCount: 1, ...extra });
  const CY = "document.querySelector('.graph-canvas')._cyreg.cy";
  const level = async label => { await evaluate(`[...document.querySelectorAll('.segmented button')].find(b=>b.textContent==='${label}').click()`); await until(() => evaluate(`${CY}.nodes().length>1`), label + ' graph'); await pause(600); };
  // Page coordinates of a card's quick-code square centre, and of the card centre.
  const corner = id => evaluate(`(()=>{const cy=${CY},n=cy.getElementById('${id}'),b=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),p=n.renderedPosition();return{x:b.left+p.x+n.renderedWidth()/2-(12+20)*z,y:b.top+p.y-n.renderedHeight()/2+(12+20)*z}})()`);
  const centre = id => evaluate(`(()=>{const cy=${CY},p=cy.getElementById('${id}').renderedPosition(),b=document.querySelector('.graph-canvas').getBoundingClientRect();return{x:b.left+p.x,y:b.top+p.y}})()`);

  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy`), 'map');
  await evaluate(`document.querySelector('.scope-toolbar button:first-child')?.click()`); await pause(300);
  await level('Classes');
  await evaluate(`${CY}.zoom(1);${CY}.center(${CY}.getElementById('${byName('EventService', 'CLASS').id}'));0`); await pause(500);

  // ---- #12 edge inspection keeps both endpoints emphasized
  const svc = byName('EventService', 'CLASS').id;
  // A point that Cytoscape's own hit test resolves to an edge (not a card or another edge's label).
  const picked = await evaluate(`(()=>{const cy=${CY},r=cy.renderer(),b=document.querySelector('.graph-canvas').getBoundingClientRect(),z=cy.zoom(),pan=cy.pan();for(const e of cy.edges()){const s=e.sourceEndpoint(),t=e.targetEndpoint();for(const f of [.2,.3,.4,.6,.7,.8]){const mx=s.x+(t.x-s.x)*f,my=s.y+(t.y-s.y)*f,hit=r.findNearestElement(mx,my,true,false);const rx=mx*z+pan.x,ry=my*z+pan.y;if(hit&&hit.id()===e.id()&&rx>20&&ry>20&&rx<cy.width()-20&&ry<cy.height()-20)return{id:e.id(),x:b.left+rx,y:b.top+ry};}}return null})()`);
  const edgeId = picked.id, mid = picked;
  await mouse('mouseMoved', mid, 'none'); await mouse('mousePressed', mid); await mouse('mouseReleased', mid);
  await until(() => evaluate(`${CY}.getElementById('${edgeId}').hasClass('inspected')`), 'edge inspected', 25).catch(() => { });
  const emph = await evaluate(`(()=>{const e=${CY}.getElementById('${edgeId}');return{inspected:e.hasClass('inspected'),source:e.source().classes(),target:e.target().classes(),mutedOthers:${CY}.nodes('.muted').length,nodes:${CY}.nodes().length}})()`);
  check('#12 inspected edge: both endpoints are neighbors and not muted', emph.inspected && emph.source.includes('neighbor') && emph.target.includes('neighbor') && !emph.source.includes('muted') && !emph.target.includes('muted'), emph);
  await shot('r12-edge-inspection-endpoints');
  await evaluate(`document.querySelector('.inspector .icon-button')?.click()`); await pause(300);

  // ---- #13 quick-code corner: canvas owns the pointer; click opens code, right-click/drag act on the card
  const svcCorner = await corner(svc);
  const hit = await evaluate(`(()=>{const el=document.elementFromPoint(${svcCorner.x},${svcCorner.y});return{tag:el.tagName,cls:el.className,inCanvas:!!el.closest('.graph-canvas')}})()`);
  check('#13 element under the </> square is the canvas, not the DOM button', hit.inCanvas, hit);
  await mouse('mouseMoved', { x: svcCorner.x - 60, y: svcCorner.y + 60 }, 'none'); await pause(100);
  await mouse('mouseMoved', svcCorner, 'none');
  await until(() => evaluate(`!!document.querySelector('.map-code-button.hot')`), 'hot', 15).catch(() => { });
  check('#13 hovering the square highlights the button', await evaluate(`document.querySelector('.map-code-button.hot')?.getAttribute('aria-label')==='View code for EventService'`));
  await shot('r13-code-corner-hover');
  const inspectedBefore = await evaluate(`document.querySelector('.subject-heading h2')?.textContent||null`);
  await mouse('mousePressed', svcCorner); await mouse('mouseReleased', svcCorner);
  await until(() => evaluate(`!!document.querySelector('dialog.source-dialog[open]')`), 'source dialog', 25).catch(() => { });
  const dialog = await evaluate(`(()=>{const d=document.querySelector('dialog.source-dialog[open]');return d?{title:d.querySelector('h2').textContent}:null})()`);
  check('#13 left click on the square opens that card\'s code without inspecting it', dialog?.title === 'EventService' && await evaluate(`(document.querySelector('.subject-heading h2')?.textContent||null)`) === inspectedBefore, { dialog, inspectedBefore });
  await evaluate(`document.querySelector('dialog.source-dialog[open] header button')?.click()`); await until(() => evaluate(`!document.querySelector('dialog.source-dialog[open]')`), 'dialog closed');
  await evaluate(`window.__ctx=null;window.addEventListener('contextmenu',e=>{window.__ctx=e.defaultPrevented},{once:true})`);
  await mouse('mousePressed', svcCorner, 'right'); await pause(40); await mouse('mouseReleased', svcCorner, 'right');
  await until(() => evaluate(`!!document.querySelector('.graph-context-menu')`), 'menu', 25).catch(() => { });
  const menu = await evaluate(`(()=>{const m=document.querySelector('.graph-context-menu');return{open:!!m,heading:m?.querySelector('.graph-context-menu-heading')?.textContent,nativePrevented:window.__ctx}})()`);
  check('#13 right click on the square opens the card actions menu (native menu suppressed)', menu.open && menu.heading === 'EventService' && menu.nativePrevented === true, menu);
  // ---- #20 a relationship-filter change with unchanged cards keeps the menu open
  const nodesBefore = await evaluate(`${CY}.nodes().map(n=>n.id()).sort().join()`);
  await evaluate(`(()=>{const s=document.querySelector('select[aria-label="Relationship kind"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,[...s.options].find(o=>o.value==='DEPENDS_ON').value);s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await pause(600);
  const after = await evaluate(`({menu:!!document.querySelector('.graph-context-menu'),nodes:${CY}.nodes().map(n=>n.id()).sort().join(),edges:${CY}.edges().length})`);
  check('#20 filter change that keeps the same cards keeps the menu open', after.nodes !== nodesBefore || after.menu, { sameCards: after.nodes === nodesBefore, menuOpen: after.menu, edges: after.edges });
  await evaluate(`(()=>{const s=document.querySelector('select[aria-label="Relationship kind"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'ALL');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pause(300);
  await evaluate(`document.querySelector('.selection-bar button:last-child')?.click()`); await pause(300);

  const beforeDrag = await evaluate(`({...${CY}.getElementById('${svc}').position()})`);
  const c2 = await corner(svc);
  await mouse('mouseMoved', c2, 'none'); await mouse('mousePressed', c2);
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', { x: c2.x + i * 12, y: c2.y + i * 6 }); await pause(16); }
  await mouse('mouseReleased', { x: c2.x + 96, y: c2.y + 48 }); await pause(400);
  const afterDrag = await evaluate(`({...${CY}.getElementById('${svc}').position(),zoom:${CY}.zoom(),dialog:!!document.querySelector('dialog.source-dialog[open]')})`);
  check('#13 dragging from the square moves the card and opens no dialog', Math.abs((afterDrag.x - beforeDrag.x) * afterDrag.zoom - 96) < 8 && Math.abs((afterDrag.y - beforeDrag.y) * afterDrag.zoom - 48) < 8 && !afterDrag.dialog, { beforeDrag, afterDrag });

  await evaluate(`[...document.querySelectorAll('.map-code-button')].find(b=>b.getAttribute('aria-label')==='View code for EventService').focus()`);
  const focused = await evaluate(`document.activeElement?.getAttribute('aria-label')`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await until(() => evaluate(`!!document.querySelector('dialog.source-dialog[open]')`), 'keyboard dialog', 25).catch(() => { });
  check('#13 keyboard: focused map </> button still opens code with Enter', await evaluate(`document.querySelector('dialog.source-dialog[open] h2')?.textContent==='EventService'`), { focused });
  await evaluate(`document.querySelector('dialog.source-dialog[open] header button')?.click()`); await pause(300);

  // ---- #25 method card removal names its class
  await level('Methods');
  const method = await evaluate(`${CY}.nodes().filter(n=>n.data('kind')==='METHOD')[0].data()`);
  const owner = graph.nodes.find(n => n.id === method.parentId);
  await evaluate(`${CY}.center(${CY}.getElementById('${method.id}'));0`); await pause(400);
  const mc = await centre(method.id);
  await mouse('mousePressed', mc, 'right'); await pause(40); await mouse('mouseReleased', mc, 'right');
  await until(() => evaluate(`!!document.querySelector('.graph-context-menu')`), 'method menu', 25).catch(() => { });
  const label = await evaluate(`({menu:document.querySelector('.graph-context-menu button.danger')?.textContent.trim(),title:document.querySelector('.graph-context-menu button.danger')?.title,bar:document.querySelector('.selection-bar button.danger')?.textContent})`);
  check('#25 method card menu names the class that leaves scope', label.menu === `− Remove class ${owner.simpleName} from scope` && label.bar === `Remove class ${owner.simpleName} from scope`, label);
  await shot('r25-method-remove-label');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pause(200);
  await evaluate(`document.querySelector('.selection-bar button:last-child')?.click()`); await pause(200);
  await level('Classes');
  const cc = await centre(svc);
  await evaluate(`${CY}.center(${CY}.getElementById('${svc}'));0`); await pause(300);
  const cc2 = await centre(svc);
  await mouse('mousePressed', cc2, 'right'); await pause(40); await mouse('mouseReleased', cc2, 'right');
  await until(() => evaluate(`!!document.querySelector('.graph-context-menu')`), 'class menu', 25).catch(() => { });
  check('#25 class card keeps the plain label', await evaluate(`document.querySelector('.graph-context-menu button.danger')?.textContent.trim()`) === '− Remove from scope');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await pause(200);
  await evaluate(`document.querySelector('.selection-bar button:last-child')?.click()`); await pause(200);

  // ---- #24 inspector rows with long names never overflow the panel
  await cdp('Page.navigate', { url: `${base}/?snapshotId=${snapshot}&selectedSymbol=${encodeURIComponent(svc)}` });
  await until(() => evaluate(`document.querySelector('.subject-heading h2')?.textContent==='EventService'`), 'inspector');
  await pause(800);
  const LONG = 'EventRegistrationNotificationDispatchCoordinatorFactoryImplementation';
  // Row text must end before its </> button (no overlap), and the button must stay inside the panel.
  // Visible extent of a row's content: every child element and text node, clipped by overflow:hidden ancestors.
  const overflow = () => evaluate(`(()=>{const i=document.querySelector('.inspector'),r=i.getBoundingClientRect();
    const visibleRight=node=>{const range=document.createRange();range.selectNodeContents(node);let right=range.getBoundingClientRect().right;for(let el=node.nodeType===1?node:node.parentElement;el&&el!==i;el=el.parentElement){if(getComputedStyle(el).overflowX!=='visible')right=Math.min(right,el.getBoundingClientRect().right);}return right;};
    const rows=[...i.querySelectorAll('.symbol-row')].filter(row=>row.querySelector('.code-button'));
    const overlaps=rows.filter(row=>{const b=row.querySelector('.code-button').getBoundingClientRect(),button=row.querySelector('.related-row');return [...button.childNodes].filter(n=>n.nodeType===3||!n.matches('span:last-child')).some(n=>visibleRight(n)>b.left+0.5);}).map(row=>row.closest('section').querySelector('h3').firstChild.textContent.trim());
    return{rows:rows.length,overlaps,scroll:i.scrollWidth,client:i.clientWidth,buttonsInside:rows.every(row=>row.querySelector('.code-button').getBoundingClientRect().right<=r.right+0.5)}})()`);
  await evaluate(`(()=>{for(const s of document.querySelectorAll('.inspector .symbol-row .related-row > span:first-child')){const t=[...s.childNodes].find(n=>n.nodeType===3);if(t)t.textContent='${LONG}';}})()`);
  const fixed = await overflow();
  await evaluate(`(()=>{const h=[...document.querySelectorAll('.inspector section h3')].find(x=>x.textContent.startsWith('Called or used by'));h.scrollIntoView({block:'start'})})()`);
  await shot('r24-inspector-long-names');
  // Previous CSS and markup: first span clipped, and the "Belongs to" name as a bare text node.
  await evaluate(`(()=>{const st=document.createElement('style');st.id='old-css';st.textContent='.related-row span:first-child{min-width:auto!important;overflow-wrap:normal!important;overflow:hidden;text-overflow:ellipsis}';document.head.appendChild(st);const h=[...document.querySelectorAll('.inspector section h3')].find(x=>x.textContent==='Belongs to');const span=h?.parentElement.querySelector('.related-row > span:first-child');if(span)span.replaceWith(document.createTextNode(span.textContent));})()`);
  const old = await overflow();
  await shot('r24-inspector-long-names-previous-css');
  check('#24 long names: no overlap with row </> buttons and no horizontal overflow (previous CSS/markup overflowed)', fixed.rows > 0 && fixed.overlaps.length === 0 && fixed.buttonsInside && fixed.scroll <= fixed.client + 1 && (old.scroll > old.client + 1 || old.overlaps.length > 0), { fixed, previousCss: old });

  // ---- #23 narrow screens: minimap and zoom controls do not overlap
  for (const width of [360, 375, 390, 420]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
    await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent.toLowerCase()==='map')?.click()`);
    await pause(500);
    const box = await evaluate(`(()=>{const m=document.querySelector('.minimap').getBoundingClientRect(),z=document.querySelector('.zoom-controls').getBoundingClientRect(),s=document.querySelector('.graph-stage').getBoundingClientRect();return{minimapRight:m.right,zoomLeft:z.left,zoomRight:z.right,stageRight:s.right,labels:[...document.querySelectorAll('.zoom-controls button')].map(b=>b.getAttribute('aria-label'))}})()`);
    check(`#23 ${width}px: minimap and zoom controls do not overlap`, box.minimapRight <= box.zoomLeft && box.zoomRight <= box.stageRight, box);
    if (width === 375) await shot('r23-mobile-375-controls');
  }
  check('no page exceptions', errors.length === 0, errors);
} catch (e) {
  check('script completed', false, String(e.stack || e));
  try { const r = await globalThis.__cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(OUT + '/failure.png', Buffer.from(r.data, 'base64')); } catch {}
} finally {
  await fs.writeFile(`${OUT}/report.json`, JSON.stringify(results, null, 2));
  for (const p of procs) p.kill();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Output: ${OUT}`);
  process.exitCode = failed ? 1 : 0;
}
