// Step 13 acceptance (card menu Expand/Collapse + View source, cascading tree collapse, Entry
// points Explore → reveal + outgoing stack, kind icons).
//   node scripts/verify-step13-ui.mjs <microservice-java copy>
// Requires BACKEND, APP and DEBUG (a packaged jar on an isolated data dir, and a headless Chromium).
// Every scenario reloads the map, so a fresh journey starts with Undo disabled: "exactly one undo
// step" is then checked as "one Undo restores the start and disables Undo again".
import fs from 'node:fs/promises';
const OUT = process.env.OUT || 'build/step13';
await fs.mkdir(OUT, { recursive: true });
const base = process.env.BACKEND || 'http://127.0.0.1:8095', app = process.env.APP || 'http://127.0.0.1:8095', debug = process.env.DEBUG || 'http://127.0.0.1:9333';
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

const [fixtureDir] = process.argv.slice(2);
if (!fixtureDir) throw Error('Usage: verify-step13-ui.mjs <microservice fixture>');
const { snapshot, graph } = await analyze(fixtureDir);
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
socket.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id) { const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.reject(Error(JSON.stringify(m.error))) : w.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); };
const cdp = (method, params = {}) => { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); };
const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async name => { await pause(700); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
const mouse = (type, p, button = 'left') => cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons: type === 'mouseReleased' ? 0 : button === 'none' ? 0 : 1, clickCount: 1 });
const click = async p => { await mouse('mouseMoved', p, 'none'); await mouse('mousePressed', p); await mouse('mouseReleased', p); await pause(350); };
const CY = "document.querySelector('.graph-canvas')._cyreg.cy";
const key = async (key, extra = {}) => {
  const codes = { Escape: 27, Enter: 13, F10: 121, ContextMenu: 93, ArrowDown: 40 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}), ...extra });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] }); await pause(350);
};
const centerOf = selector => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing '+${JSON.stringify(selector)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const clickSelector = async selector => click(await centerOf(selector));
const buttonByText = async text => click(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
const tap = async id => { await evaluate(`${CY}.getElementById(${JSON.stringify(id)}).emit('tap');0`); await pause(350); };
const byName = (kind, q) => graph.nodes.find(n => n.kind === kind && (n.qualifiedName === q || n.simpleName === q));
const undoDisabled = () => evaluate(`document.querySelector('.journey-history button[title^="Undo"]').disabled`);
const undo = () => buttonByText('↶ Undo');
const drawnIds = () => evaluate(`${CY}.nodes().map(n=>n.id())`);
const expandedIds = () => evaluate(`${CY}.nodes().filter(n=>n.data('expanded')).map(n=>n.id()).sort()`);
const menuItems = () => evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].map(b=>b.textContent.trim())`);
const menuClick = async text => click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('no menu item '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
const rightClick = async id => { await evaluate(`(()=>{const n=${CY}.getElementById(${JSON.stringify(id)});n.emit('cxttap',[{position:n.position()}]);return 0})()`); await pause(350); };
const openMap = async () => {
  await cdp('Page.navigate', { url: `${app}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`), 'map');
  await pause(1200);
};
const waitFor = (expr, label) => until(() => evaluate(expr), label, 50);

await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Page.bringToFront');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
const services = byName('PACKAGE', 'com.kipper.eventsmicroservice.services');
const repositories = byName('PACKAGE', 'com.kipper.eventsmicroservice.repositories');
const eventService = byName('CLASS', 'com.kipper.eventsmicroservice.services.EventService');

// 4. Kind icons: packages draw the folder; expanded types draw their letter.
await openMap();
check('fresh journey: Undo disabled', await undoDisabled());
const cardSvg = id => evaluate(`decodeURIComponent(${CY}.getElementById(${JSON.stringify(id)}).data('card'))`);
check('package card draws the folder, not the cube', (s => s.includes('M1.8 4.3') && !s.includes('M8 7l7-4 7 4'))(await cardSvg(services.id)));
await shot('01-packages-folder-icons');

// 1. Right-click menu on a package: Expand, no View source (packages have no source range).
await rightClick(services.id);
let items = await menuItems();
check('package menu offers Expand', items.some(t => t.endsWith('Expand')), items);
check('package menu has no View source', !items.some(t => t.includes('View source')), items);
check('the taller menu stays inside the map stage', await evaluate(`(()=>{const m=document.querySelector('.graph-context-menu').getBoundingClientRect(),s=document.querySelector('.graph-stage').getBoundingClientRect();return m.bottom<=s.bottom+1&&m.top>=s.top})()`));
await shot('02-package-menu');
await menuClick('Expand');
await waitFor(`${CY}.getElementById(${JSON.stringify(services.id)}).data('expanded')`, 'services expanded');
check('Expand opens the package in place', (await drawnIds()).includes(eventService.id));
check('the right-click did not leave the card multi-selected', await evaluate(`document.querySelectorAll('.graph-context-menu').length===0`));
const letterOf = async id => (await cardSvg(id)).match(/font-weight="700" fill="#[0-9a-f]+">([^<]+)<\/text>/)?.[1];
check('a class card draws C', (await letterOf(eventService.id)) === 'C', await letterOf(eventService.id));
await shot('03-expanded-class-letter');
// Class menu: View source opens the source dialog for that class.
await rightClick(eventService.id);
items = await menuItems();
check('class menu offers Expand and View source', items.some(t => t.endsWith('Expand')) && items.some(t => t.includes('View source')), items);
await menuClick('View source');
await waitFor(`!!document.querySelector('dialog[open]')`, 'source dialog');
check('View source opens the source dialog for the class', await evaluate(`document.querySelector('dialog[open]').textContent.includes('EventService')`));
await shot('04-view-source');
await key('Escape'); await pause(300);
// Collapse from the menu of the expanded package.
await rightClick(services.id);
items = await menuItems();
check('expanded package menu offers Collapse', items.some(t => t.endsWith('Collapse')), items);
await menuClick('Collapse');
await waitFor(`!${CY}.getElementById(${JSON.stringify(services.id)}).data('expanded')`, 'services collapsed');
check('Collapse closes the package', !(await drawnIds()).includes(eventService.id));

// Multi-selection: right-click two packages, Expand both as one undo step.
await openMap();
await rightClick(services.id); await key('Escape');
await rightClick(repositories.id);
items = await menuItems();
check('with two selected, the menu offers "Expand 2 selected"', items.some(t => t.endsWith('Expand 2 selected')), items);
await menuClick('Expand 2 selected');
await waitFor(`${CY}.getElementById(${JSON.stringify(services.id)}).data('expanded')&&${CY}.getElementById(${JSON.stringify(repositories.id)}).data('expanded')`, 'both expanded');
check('both selected packages expand', (await expandedIds()).length === 2);
const repoInterface = graph.nodes.find(n => n.kind === 'INTERFACE' && n.parentId === repositories.id);
check('an interface card draws I', repoInterface && (await letterOf(repoInterface.id)) === 'I', repoInterface && await letterOf(repoInterface.id));
await shot('05-multi-expand');
await undo();
check('one Undo reverts the multi-expand entirely', (await expandedIds()).length === 0);
check('...and that was the only undo step', await undoDisabled());

// 2. Tree: collapse cascades, Collapse all.
await openMap();
const treeOpen = q => evaluate(`(()=>{const b=document.querySelector('[aria-controls=${JSON.stringify('tree-branch-' + q)}]');return b?b.getAttribute('aria-expanded'):null})()`);
const toggleTree = q => clickSelector(`[aria-controls="tree-branch-${q}"]`);
const root = await evaluate(`document.querySelector('.package-tree .tree-disclosure').getAttribute('aria-controls').replace('tree-branch-','')`);
await shot('06-tree-before');
check('the scope tree shows kind badges for types', await evaluate(`document.querySelectorAll('.tree-kind-badge').length>0`) || (await treeOpen('com.kipper.eventsmicroservice.services')) === 'false');
const inner = 'com.kipper.eventsmicroservice.services';
if ((await treeOpen(inner)) !== 'true') await toggleTree(inner);
check('setup: an inner package is open', (await treeOpen(inner)) === 'true');
await toggleTree(root);
check('collapsing the root closes it', (await treeOpen(root)) === 'false');
await toggleTree(root);
// Walk back down from the root to the inner package's parent: each level must be closed again.
const parts = inner.split('.'), path = parts.slice(1, -1).map((_, i) => parts.slice(0, i + 2).join('.'));
const states = [];
for (const q of path) { states.push([q, await treeOpen(q)]); await toggleTree(q); }
check('reopening the root shows every nested package collapsed', states.every(([, v]) => v === 'false'), states);
check('...down to the package that was open before', (await treeOpen(inner)) === 'false');
await shot('07-tree-cascade');
await buttonByText('Collapse all');
check('Collapse all closes every branch', await evaluate(`[...document.querySelectorAll('.package-tree .tree-disclosure')].every(b=>b.getAttribute('aria-expanded')==='false')`));
await shot('08-tree-collapse-all');

// 3. Entry points: Explore reveals the handler, inspects it and roots the outgoing stack; one undo step.
await openMap();
await buttonByText('▷ Entry points' ) .catch(async () => clickSelector('.workspace-nav button:nth-child(2)'));
await waitFor(`!!document.querySelector('.route-card')`, 'entry points');
await shot('09-entry-points');
const route = await evaluate(`(()=>{const b=[...document.querySelectorAll('.route-card')].find(b=>!b.disabled);return b?{path:b.querySelector('strong').textContent,handler:b.querySelector('span:nth-of-type(2)').textContent}:null})()`);
await clickSelector('.route-card:not(:disabled)');
await waitFor(`document.querySelectorAll('.stack-root').length>0 || ${CY}.nodes('.stack-root').length>0`, 'stack rooted');
const routes = await api(`/api/snapshots/${snapshot}/spring/routes`).catch(() => null);
const routeRow = Array.isArray(routes) ? routes.find(r => r.path === route.path) : null;
const handler = routeRow ? graph.nodes.find(n => n.id === routeRow.symbol_version_id) : null;
check('Explore switches to the Code map', await evaluate(`!!document.querySelector('.graph-canvas')`));
check('Explore reveals the handler method card', handler && (await drawnIds()).includes(handler.id), route);
check('Explore inspects the handler', (await evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent||''`)).includes(route.handler));
check('Explore roots the outgoing stack on the handler', handler && (await evaluate(`${CY}.nodes('.stack-root').map(n=>n.id())`)).includes(handler.id));
const stackSummaryText = () => evaluate(`document.querySelector('[data-testid=outgoing-stack-summary]')?.textContent||''`);
check('...and that stack is outgoing', /^Outgoing stack:/.test(await stackSummaryText()), await stackSummaryText());
await shot('10-entry-explore-stack');
await undo();
check('one Undo reverts every ancestor expansion of the reveal and returns to Entry points', !(await evaluate(`!!document.querySelector('.graph-canvas')`)) && await evaluate(`!!document.querySelector('.route-card')`));
// Undo took the handler's card off the map, so its stack must have ended with it.
await clickSelector('.workspace-nav button:nth-child(1)');
await waitFor(`!!document.querySelector('.graph-canvas')?._cyreg?.cy`, 'map after undo');
check('after undoing Explore, the stack has ended (its root is no longer drawn)', await evaluate(`${CY}.nodes('.stack-root').length===0`));
await undo();
// The only earlier step is opening the Entry points tab itself; undoing it lands on the fresh map.
await undo();
check('...the reveal was one step: the next Undo is the tab switch, back to the unexpanded map', await undoDisabled() && (await expandedIds()).length === 0);
// Explore again on an already-inspected handler must not deselect it. Re-selecting an inspected card
// is a deselect after 250 ms (App's reclick guard), so the reveal must inspect, never select. Explore
// once, confirm the precondition, then Explore the same row again and read past that window.
const inspectedTitle = () => evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent||''`);
const exploreFirstRoute = async label => {
  await clickSelector('.workspace-nav button:nth-child(2)');
  await waitFor(`!!document.querySelector('.route-card')`, label);
  await clickSelector('.route-card:not(:disabled)');
  await waitFor(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes('.stack-root').length>0`, label + ': stack rooted');
};
await exploreFirstRoute('entry points again');
await pause(600);
check('precondition: after one Explore the handler is inspected', (await inspectedTitle()).includes(route.handler));
// Flip the handler's stack to incoming from its card menu: Explore must root an outgoing stack
// explicitly, not toggle or cycle whatever stack the handler already has.
await rightClick(handler.id);
await menuClick('Show incoming stack');
await pause(400);
check('setup: the handler now shows its incoming stack', /^Incoming stack:/.test(await stackSummaryText()), await stackSummaryText());
await exploreFirstRoute('entry points, second Explore');
await pause(600);
check('a second Explore keeps the handler inspected', (await inspectedTitle()).includes(route.handler));
check('...and keeps its stack rooted', handler && (await evaluate(`${CY}.nodes('.stack-root').map(n=>n.id())`)).includes(handler.id));
check('...and Explore turned the incoming stack back to outgoing', /^Outgoing stack:/.test(await stackSummaryText()), await stackSummaryText());

// View methods from the tree on a class inside a collapsed package opens the package and the
// class in place, inspects the class, and is one undo step.
await openMap();
const eventCtrl = byName('CLASS', 'com.kipper.eventsmicroservice.controllers.EventController');
const controllersPkg = byName('PACKAGE', 'com.kipper.eventsmicroservice.controllers');
if ((await treeOpen('com.kipper.eventsmicroservice.controllers')) !== 'true') await toggleTree('com.kipper.eventsmicroservice.controllers');
const undoBefore = await undoDisabled();
await clickSelector('[aria-label="View methods of EventController"]');
await waitFor(`${CY}.getElementById(${JSON.stringify(eventCtrl.id)}).data('expanded')===true`, 'EventController expanded');
check('tree View methods opens the collapsed package and the class in place', (await expandedIds()).join() === [controllersPkg.id, eventCtrl.id].sort().join(), await expandedIds());
check('...and inspects the class', (await evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent||''`)).includes('EventController'));
await shot('12-tree-view-methods');
await undo();
check('...as one undo step', (await expandedIds()).length === 0 && (await undoDisabled()) === undoBefore);
// A handler outside the current scope cannot be revealed: its row says so and Explore is disabled.
await openMap();
await clickSelector('[aria-label="Remove package com.kipper.eventsmicroservice.controllers from scope"]');
await clickSelector('.workspace-nav button:nth-child(2)');
await waitFor(`!!document.querySelector('.route-card')`, 'entry points, scoped');
check('with controllers out of scope, every controller route is disabled and labelled', await evaluate(`[...document.querySelectorAll('.route-card')].filter(b=>b.querySelector('span:nth-of-type(2)').textContent!=='sendEmail').every(b=>b.disabled&&b.textContent.includes('Outside scope')&&b.title==='Handler is outside the current scope')`));
await shot('11-entry-outside-scope');
check('no page or console errors', errors.filter(e => !/custom wheel sensitivity|invalid endpoints/.test(e)).length === 0, errors);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify({ results }, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
socket.close(); await fetch(debug + '/json/close/' + page.id);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
