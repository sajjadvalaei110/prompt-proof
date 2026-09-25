// Outgoing relation stack acceptance via Chromium CDP (docs/OUTGOING_STACK.md §Verification).
// Requires BACKEND, APP and DEBUG (a packaged jar on an isolated data dir, and a headless Chromium).
//   node scripts/verify-outgoing-stack-ui.mjs <microservice-java copy> <git fixture> <git base oid> <chain fixture>
// The Git fixture has packages app.a, app.b and app.c. At the base commit A calls B and C. In the
// working tree A no longer calls C, and B calls C, so Changes draws a->b unchanged, a->c REMOVED and
// b->c ADDED. The chain fixture is a plain source directory (no Git) reproducing the "collapsed card
// is not a hub" case:
//   app.a: class P { void m() { new app.b.Q().q(); } }
//   app.b: class Q { void q() {} void q2() { new app.c.T().t(); } }  class S { void s() { new app.d.U().u(); } }
//   app.c: class T { void t() {} }    app.d: class U { void u() {} }
// Root package app.a: b 1, c 2, d 2. Root class P: b 1, c 2 (Q -> T), d not reached. Root method
// m: b 1 only. All three fixtures are only read. Run recipe (isolated data dir, model URL on a
// closed port, fixtures generated per run): see the step 12 phase B follow-ups in PROJECT_STATUS.md.
import fs from 'node:fs/promises';
const OUT = process.env.OUT || 'build/outgoing-stack';
await fs.mkdir(OUT, { recursive: true });
const base = process.env.BACKEND || 'http://127.0.0.1:8095', app = process.env.APP || 'http://127.0.0.1:8095', debug = process.env.DEBUG || 'http://127.0.0.1:9333';
const [fixture, gitFixture, baseOid, chainFixture] = process.argv.slice(2);
if (!fixture || !gitFixture || !baseOid || !chainFixture) throw Error('Usage: verify-outgoing-stack-ui.mjs <microservice fixture> <git fixture> <base oid> <chain fixture>');
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
const micro = await analyze(fixture), review = await analyze(gitFixture), chainFix = await analyze(chainFixture);
const pkg = (graph, name) => graph.nodes.find(n => n.kind === 'PACKAGE' && n.qualifiedName === name);

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
  const codes = { Escape: 27, Enter: 13 };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key], ...(key === 'Enter' ? { text: '\r' } : {}), ...extra });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] }); await pause(350);
};
const centerOf = selector => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing '+${JSON.stringify(selector)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
const clickSelector = async selector => click(await centerOf(selector));
const buttonByText = async text => click(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
const tap = async id => { await evaluate(`${CY}.getElementById(${JSON.stringify(id)}).emit('tap');0`); await pause(350); };
const selected = () => evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent||null`);
const redoEnabled = () => evaluate(`!document.querySelector('.journey-history button[title^="Redo"]').disabled`);
// Layered cards as the overlay drew them, the chain's classes, and the stack button state.
const stackState = () => evaluate(`(()=>{const cy=${CY},o=cy.scratch('atlas:directionOverlay')||{};const ids=c=>cy.elements(c).map(e=>e.id()).sort();return{
  badges:(o.badges||[]).map(b=>({id:b.nodeId,layer:b.layer,height:b.height})).sort((a,b)=>a.id.localeCompare(b.id)),
  roots:ids('.stack-root'),members:ids('.stack-member'),chainRoutes:ids('edge.flow-out'),muted:ids('.muted'),
  pressed:[...document.querySelectorAll('.map-stack-button[aria-pressed=true]')].map(b=>({label:b.getAttribute('aria-label'),title:b.title})),
  summary:document.querySelector('[data-testid=outgoing-stack-summary]')?.textContent||null}})()`);
const layers = s => Object.fromEntries(s.badges.map(b => [b.id, b.layer]));
const geometryState = () => evaluate(`(()=>{const cy=${CY};return{nodes:cy.nodes().map(n=>({id:n.id(),p:n.position(),w:n.width(),h:n.height()})).sort((a,b)=>a.id.localeCompare(b.id)),camera:{zoom:cy.zoom(),pan:cy.pan()}}})()`);
const same = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6;
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
};
const unchanged = async (label, before) => { const now = await geometryState(); check(label, same(now, before), { before, now }); };
// Independent oracle, written from the rules in docs/OUTGOING_STACK.md §Traversal (not from
// outgoingStack.ts): walk the API graph's raw relationship facts at the root's granularity, then map
// the reached entities onto the cards Cytoscape draws (each card's parent is its container).
const drawn = () => evaluate(`(()=>{const cy=${CY};return{cards:cy.nodes().map(n=>({id:n.id(),parent:n.parent().length?n.parent().id():null})),routes:cy.edges().map(e=>({id:e.id(),occ:e.data('occurrenceIds')||[]}))}})()`);
function oracle(graph, view, rootId, kind = 'ALL') {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const cardParent = new Map(view.cards.map(c => [c.id, c.parent]));
  const rootKind = byId.get(rootId).kind;
  const isMethod = n => n.kind === 'METHOD' || n.kind === 'CONSTRUCTOR';
  const atGranularity = n => rootKind === 'PACKAGE' ? n.kind === 'PACKAGE' : isMethod({ kind: rootKind }) ? isMethod(n) : !['PACKAGE', 'METHOD', 'CONSTRUCTOR', 'FIELD'].includes(n.kind);
  const up = function* (id) { for (let n = byId.get(id), guard = 0; n && guard < 100; n = n.parentId ? byId.get(n.parentId) : undefined, guard++) yield n; };
  const owner = id => { for (const n of up(id)) if (atGranularity(n)) return n.id; return null; };
  const representative = id => { for (const n of up(id)) if (cardParent.has(n.id)) return n.id; return null; };
  const containers = id => { const out = []; for (let c = cardParent.get(id); c; c = cardParent.get(c)) out.push(c); return out; };
  const rootSet = view.cards.map(c => c.id).filter(id => id === rootId || containers(id).includes(rootId));
  const rootContainers = containers(rootId);
  const steps = new Map(), out = new Map();
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && e.kind !== kind) || e.reviewChange === 'REMOVED') continue;
    const u = owner(e.sourceId), v = owner(e.targetId);
    if (!u || !v) continue;
    steps.set(e.id, [u, v]);
    if (u !== v) out.set(u, [...(out.get(u) || []), v]);
  }
  const dist = new Map([[rootId, 0]]);
  let frontier = [rootId];
  while (frontier.length) {
    const nextFrontier = [];
    for (const u of frontier) for (const v of out.get(u) || []) if (!dist.has(v) && representative(v)) { dist.set(v, dist.get(u) + 1); nextFrontier.push(v); }
    frontier = nextFrontier;
  }
  const layers = {};
  for (const [entity, d] of dist) {
    const card = representative(entity);
    if (d === 0 || rootSet.includes(card) || rootContainers.includes(card)) continue;
    layers[card] = Math.min(layers[card] ?? Infinity, d);
  }
  const covered = view.cards.map(c => c.id).filter(id => !(id in layers) && !rootSet.includes(id) && containers(id).some(c => c in layers)).sort();
  const chainRoutes = view.routes.filter(r => r.occ.some(o => steps.has(o) && dist.has(steps.get(o)[0]) && dist.has(steps.get(o)[1]))).map(r => r.id).sort();
  return { layers, rootSet: rootSet.sort(), covered, chainRoutes };
}
// The API graph of the map on screen (ordinary mode only; the Changes checks use literal layers).
let currentGraph = null;
const expectedStack = async rootId => oracle(currentGraph, await drawn(), rootId);
const openMap = async snapshot => {
  await cdp('Page.navigate', { url: `${app}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${CY}.nodes().length>0`), 'map');
  await pause(1200);
};

await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Page.bringToFront');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await openMap(micro.snapshot);

currentGraph = micro.graph;
const controllers = pkg(micro.graph, 'com.kipper.eventsmicroservice.controllers');
const services = pkg(micro.graph, 'com.kipper.eventsmicroservice.services');
// A redo branch that must survive: a recorded entry would discard it.
await clickSelector('[aria-label="Fit map"]');
await evaluate(`${CY}.panBy({x:40,y:0});0`); await pause(700);
await buttonByText('↶ Undo');
check('setup: a redo branch exists before the stack scenario', await redoEnabled());
const start = await geometryState();

// 1. Activate from the on-card button of the selected card (a real click on its square).
await tap(controllers.id);
check('the selected card shows the stack button, not pressed', await evaluate(`!!document.querySelector('.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"][aria-pressed=false]')`));
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"]`);
let s = await stackState();
const oracle1 = await expectedStack(controllers.id), expected = oracle1.layers;
const depth = Math.max(0, ...Object.values(expected));
check('activating roots the stack at the card: pressed button with the summary tooltip',
  s.pressed.length === 1 && s.pressed[0].label === `Hide outgoing stack of ${controllers.simpleName}` && /^Outgoing stack: \d+ layers? · \d+ resources?$/.test(s.pressed[0].title), s.pressed);
// 2. Badges 1..N.
check('badges number every reached card by its package-level fact distance (independent oracle)', same(layers(s), expected) && depth >= 2, { drawn: layers(s), expected });
check('badges cover every layer 1..N', same([...new Set(s.badges.map(b => b.layer))].sort((a, b) => a - b), Array.from({ length: depth }, (_, i) => i + 1)), s.badges);
check('the root keeps its inspected look and gets no badge; chain cards get the static outline',
  same(s.roots, [controllers.id]) && !s.badges.some(b => b.id === controllers.id) && same(s.members, Object.keys(expected).sort()), s);
check('the tooltip counts layers and resources', s.pressed[0].title === `Outgoing stack: ${depth} ${depth === 1 ? 'layer' : 'layers'} · ${Object.keys(expected).length} resources`, s.pressed[0].title);
check('the inspector shows the same summary for the inspected root', s.summary === s.pressed[0].title, s.summary);
check('cards outside the chain are muted, chain cards are not', await evaluate(`(()=>{const cy=${CY};const chain=new Set(${JSON.stringify([controllers.id, ...Object.keys(expected)])});return cy.nodes().filter(n=>!n.isParent()).every(n=>chain.has(n.id())!==n.hasClass('muted'))})()`));
check('the chain routes are exactly the drawn routes carrying a chain fact step', same(s.chainRoutes, oracle1.chainRoutes) && oracle1.chainRoutes.length > 0, { drawn: s.chainRoutes, expected: oracle1.chainRoutes });
check('every chain route runs between chain cards and moves with the selected-route dashes', s.chainRoutes.length > 0 && await evaluate(`(()=>{const cy=${CY};const chain=new Set(${JSON.stringify([controllers.id, ...Object.keys(expected)])});return cy.edges('.flow-out').every(e=>chain.has(e.source().id())&&chain.has(e.target().id())&&e.style('line-style')==='dashed')})()`));
const phase1 = await evaluate(`${CY}.scratch('atlas:dashPhase')`); await pause(400);
check('route dashes and badge borders animate while the stack is active', (await evaluate(`${CY}.scratch('atlas:dashPhase')`)) !== phase1);
check('activating the stack creates no undo entry (redo survives)', await redoEnabled());
await unchanged('activating the stack moves no card and keeps the camera', start);
await shot('01-stack-active');

// 3. Selecting a layer-2 card keeps the root.
const layer2 = s.badges.find(b => b.layer === 2).id;
await tap(layer2);
s = await stackState();
check('selecting a layer-2 card keeps the stack rooted at the original card', same(s.roots, [controllers.id]) && s.pressed.length === 1 && s.pressed[0].label.endsWith(controllers.simpleName) && same(layers(s), expected), s);
check('the selected layer-2 card is inspected on top of its badge', await evaluate(`${CY}.getElementById(${JSON.stringify(layer2)}).hasClass('inspected')`) && s.badges.some(b => b.id === layer2));
check('the inspector follows the selection and shows no stack summary', (await selected()) === micro.graph.nodes.find(n => n.id === layer2).simpleName && s.summary === null);
await unchanged('selecting inside the stack moves no card and keeps the camera', start);
await shot('02-layer-two-selected');

// 4. Expanding a chain card: a package root walks package-level facts, so the layers stay; the
// expanded box keeps its badge and the cards inside it are covered (lit, no badge, no outline).
await clickSelector(`[aria-label="Show types inside ${services.simpleName}"]`);
s = await stackState();
const expandedOracle = await expectedStack(controllers.id);
check('expanding a chain card keeps package-level layers identical (and the oracle agrees)', same(layers(s), expected) && same(expandedOracle.layers, expected), { drawn: layers(s), expected, oracle: expandedOracle.layers });
check('the expanded chain box carries the badge; the cards inside it carry none', s.badges.some(b => b.id === services.id) && !await evaluate(`${JSON.stringify(s.badges.map(b => b.id))}.some(id=>${CY}.getElementById(id).parent().id()===${JSON.stringify(services.id)})`), s.badges);
check('the cards inside the expanded chain box are covered: not muted, no chain outline', expandedOracle.covered.length > 0 && await evaluate(`${CY}.getElementById(${JSON.stringify(services.id)}).children().every(n=>!n.hasClass('muted')&&!n.hasClass('stack-member'))`) && same(await evaluate(`${CY}.getElementById(${JSON.stringify(services.id)}).descendants().map(n=>n.id()).sort()`), expandedOracle.covered), expandedOracle.covered);
check('after the expansion the chain routes still match the oracle', same(s.chainRoutes, expandedOracle.chainRoutes), { drawn: s.chainRoutes, expected: expandedOracle.chainRoutes });
await shot('03-chain-card-expanded');
// Undo the expansion: the stack stays (its root is still drawn) and a redo branch exists again.
await buttonByText('↶ Undo');
s = await stackState();
check('undoing the expansion keeps the stack and restores the original layers', same(s.roots, [controllers.id]) && same(layers(s), expected), layers(s));
// 4b. Expanded root, nested: every layer-0 card takes the root look (docs/OUTGOING_STACK_REVIEW.md).
const controllerType = micro.graph.nodes.find(n => n.parentId === controllers.id && !['PACKAGE', 'METHOD', 'CONSTRUCTOR', 'FIELD'].includes(n.kind));
await clickSelector(`[aria-label="Show types inside ${controllers.simpleName}"]`);
await clickSelector(`[aria-label="Show methods inside ${controllerType.simpleName}"]`);
s = await stackState();
const rootOracle = await expectedStack(controllers.id);
const nested = await evaluate(`${CY}.getElementById(${JSON.stringify(controllerType.id)}).children().map(n=>n.id())`);
check('expanded root: the root set is the root, its types and their methods', rootOracle.rootSet.includes(controllerType.id) && nested.length > 0 && nested.every(id => rootOracle.rootSet.includes(id)), rootOracle.rootSet);
check('expanded root: every layer-0 card, nested ones included, gets the root look', same(s.roots, rootOracle.rootSet), { roots: s.roots, rootSet: rootOracle.rootSet });
check('expanded root: layer-0 cards get no badge, no chain outline and are not muted', rootOracle.rootSet.every(id => !s.badges.some(b => b.id === id) && !s.members.includes(id) && !s.muted.includes(id)), s);
check('expanded root: layers are unchanged and match the oracle; the pressed toggle stays on the root only', same(layers(s), expected) && same(rootOracle.layers, expected) && s.pressed.length === 1 && s.pressed[0].label === `Hide outgoing stack of ${controllers.simpleName}`, { drawn: layers(s), pressed: s.pressed });
await shot('08-expanded-root');
await buttonByText('↶ Undo'); await buttonByText('↶ Undo');
s = await stackState();
check('undoing the root expansions keeps the stack with its original layers', same(s.roots, [controllers.id]) && same(layers(s), expected), s.roots);
const beforeEsc = await geometryState();

// 5. Esc ends the stack only.
const before5 = await selected();
await key('Escape');
s = await stackState();
// Any dashed route left is the ordinary selection emphasis of the still-selected card.
const onlySelectionRoutes = await evaluate(`${JSON.stringify(s.chainRoutes)}.every(id=>${CY}.getElementById(id).source().id()===${JSON.stringify(layer2)})`);
check('Escape ends the stack: no badges, stack classes, pressed button or chain routes', !s.badges.length && !s.roots.length && !s.members.length && !s.pressed.length && onlySelectionRoutes, s);
check('the first Escape keeps the selection', (await selected()) === before5 && before5 !== null);
check('ending the stack creates no undo entry (redo survives)', await redoEnabled());
await unchanged('ending the stack moves no card and keeps the camera', beforeEsc);
// 6. Esc again clears the selection.
await key('Escape');
check('a second Escape clears the selection', (await selected()) === null);

// Context menu and keyboard entry points.
await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).emit('cxttap');0`); await pause(350);
check('the context menu offers "Show outgoing stack"', await evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].some(b=>b.textContent.trim()==='⇶ Show outgoing stack')`));
await click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.includes('Show outgoing stack'));const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
s = await stackState();
check('the context-menu item starts the stack', same(s.roots, [controllers.id]) && s.badges.length > 0);
await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).emit('cxttap');0`); await pause(350);
check('the context menu then offers "Hide outgoing stack"', await evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].some(b=>b.textContent.trim()==='⇶ Hide outgoing stack')`));
await key('Escape'); // closes the menu first
check('Escape closes an open menu before it ends the stack', (await stackState()).roots.length === 1);
await key('Escape'); await key('Escape'); // stack, then selection
await tap(controllers.id);
await evaluate(`document.querySelector('.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"]').focus()`);
await key('Enter');
check('the stack button is keyboard operable (focus + Enter)', (await stackState()).pressed.length === 1);

// Low zoom legibility (zoom buttons stay outside history).
await clickSelector('[aria-label="Zoom out"]'); await clickSelector('[aria-label="Zoom out"]');
s = await stackState();
check('badges keep a legible minimum size at low zoom', s.badges.length > 0 && s.badges.every(b => b.height >= 20) && await evaluate(`${CY}.zoom()*30<20`), { zoom: await evaluate(`${CY}.zoom()`), badges: s.badges });
await shot('04-low-zoom');
await clickSelector('[aria-label="Zoom in"]'); await clickSelector('[aria-label="Zoom in"]');
await shot('05-badge-and-toggle');

// Reduced motion: dashes stay, movement stops.
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await key('Escape'); await key('Escape'); await tap(controllers.id); // end the stack, clear, reselect
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"]`);
const still = await evaluate(`${CY}.scratch('atlas:dashPhase')`); await pause(500);
check('reduced motion keeps the stack dashed but static', (await stackState()).badges.length > 0 && (await evaluate(`${CY}.scratch('atlas:dashPhase')`)) === still && await evaluate(`${CY}.edges('.flow-out').every(e=>e.style('line-style')==='dashed')`));
await cdp('Emulation.setEmulatedMedia', { features: [] });

await cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false }); await pause(600);
check('narrow screen has no page overflow with a stack active', await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
await shot('06-mobile');
await clickSelector('.mobile-tabs button:nth-child(2)');
check('the 375 px map pane still draws the layer badges', (await stackState()).badges.length > 0);
await shot('06-mobile-map');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

// Changes mode: REMOVED routes are not traversed; factual line colors stay.
await openMap(review.snapshot);
const a = pkg(review.graph, 'app.a'), b = pkg(review.graph, 'app.b'), c = pkg(review.graph, 'app.c');
await clickSelector('.review-options summary');
await evaluate(`(()=>{const e=document.querySelector('input[placeholder="Default merge base, or origin/main"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,${JSON.stringify(baseOid)});e.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
await clickSelector('.review-options summary');
await evaluate(`document.querySelector('.review-toggle').click();0`);
await until(() => evaluate(`${CY}.edges().some(e=>e.data('reviewChange')==='REMOVED')`), 'Changes overlay');
await pause(800);
const routeColors = () => evaluate(`Object.fromEntries(${CY}.edges().map(e=>[e.source().id()+'>'+e.target().id()+':'+(e.data('reviewChange')||''),e.style('line-color')]))`);
const colorsBefore = await routeColors();
const fill = id => evaluate(`${CY}.getElementById(${JSON.stringify(id)}).style('background-color')`);
const rootFillBefore = await fill(a.id);
await tap(a.id);
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${a.simpleName}"]`);
s = await stackState();
check('Changes: a REMOVED route is not walked (C is reached through the added B -> C only)', same(layers(s), { [b.id]: 1, [c.id]: 2 }), layers(s));
check('Changes: the REMOVED route is not a chain route and is muted', await evaluate(`${CY}.edges().filter(e=>e.data('reviewChange')==='REMOVED').every(e=>!e.hasClass('flow-out')&&e.hasClass('muted'))`));
check('Changes: chain routes keep their factual line colors (ADR 0008), direction lives in the cyan underlay',
  same(await routeColors(), colorsBefore) && await evaluate(`${CY}.edges('.flow-out').every(e=>e.style('underlay-color')==='rgb(14,165,233)')`), { before: colorsBefore, after: await routeColors() });
check('Changes: a changed root keeps its factual change fill under the stack-root look', await evaluate(`${CY}.getElementById(${JSON.stringify(a.id)}).data('reviewChange')`) === 'MODIFIED' && (await fill(a.id)) === rootFillBefore, { before: rootFillBefore, after: await fill(a.id) });
await shot('07-changes-mode');

// A collapsed card is not a hub: the traversal granularity follows the root's kind.
await openMap(chainFix.snapshot);
currentGraph = chainFix.graph;
const [ca, cb, cc, cd] = ['app.a', 'app.b', 'app.c', 'app.d'].map(n => pkg(chainFix.graph, n));
const typeP = chainFix.graph.nodes.find(n => n.qualifiedName === 'app.a.P'), methodM = chainFix.graph.nodes.find(n => n.qualifiedName === 'app.a.P.m()');
const routeIds = (from, to) => evaluate(`${CY}.edges().filter(e=>e.source().id()===${JSON.stringify(from)}&&e.target().id()===${JSON.stringify(to)}).map(e=>e.id())`);
const startStack = async n => { await tap(n.id); await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${n.simpleName}"]`); return stackState(); };
const endStack = async () => { await key('Escape'); await key('Escape'); };
s = await startStack(ca);
let o = await expectedStack(ca.id);
check('chain fixture, package root app.a: b 1, c 2, d 2 (package-level walk)', same(layers(s), { [cb.id]: 1, [cc.id]: 2, [cd.id]: 2 }) && same(o.layers, layers(s)), { drawn: layers(s), oracle: o.layers });
const bc = await routeIds(cb.id, cc.id), bd = await routeIds(cb.id, cd.id);
check('chain fixture, package root: b -> c and b -> d are both chain routes', bc.length === 1 && bd.length === 1 && s.chainRoutes.includes(bc[0]) && s.chainRoutes.includes(bd[0]) && same(s.chainRoutes, o.chainRoutes), s.chainRoutes);
await shot('09-package-root');
await endStack();
await clickSelector(`[aria-label="Show types inside ${ca.simpleName}"]`);
s = await startStack(typeP);
o = await expectedStack(typeP.id);
check('chain fixture, class root P: b 1 and c 2 through Q.q2 -> T.t at class level (oracle agrees)', same(layers(s), { [cb.id]: 1, [cc.id]: 2 }) && same(o.layers, layers(s)), { drawn: layers(s), oracle: o.layers });
check('chain fixture, class root P: d is not reached (the old collapsed-hub false positive is gone)', !(cd.id in layers(s)) && s.muted.includes(cd.id), layers(s));
const bc2 = await routeIds(cb.id, cc.id), bd2 = await routeIds(cb.id, cd.id);
check('chain fixture, class root P: the drawn b -> d route is muted and not a chain route; b -> c is one', bd2.length === 1 && !s.chainRoutes.includes(bd2[0]) && s.muted.includes(bd2[0]) && bc2.length === 1 && s.chainRoutes.includes(bc2[0]) && same(s.chainRoutes, o.chainRoutes), { chain: s.chainRoutes, oracle: o.chainRoutes });
check('chain fixture, class root P: the root look is on P only, inside the unmuted app.a box', same(s.roots, [typeP.id]) && !s.muted.includes(ca.id) && !(ca.id in layers(s)), s.roots);
await shot('10-class-root');
await endStack();
await clickSelector(`[aria-label="Show methods inside ${typeP.simpleName}"]`);
s = await startStack(methodM);
o = await expectedStack(methodM.id);
check('chain fixture, method root m: b 1 only; c and d are not reached (oracle agrees)', same(layers(s), { [cb.id]: 1 }) && same(o.layers, layers(s)), { drawn: layers(s), oracle: o.layers });
const bc3 = await routeIds(cb.id, cc.id), bd3 = await routeIds(cb.id, cd.id);
check('chain fixture, method root m: neither b -> c nor b -> d is a chain route', [...bc3, ...bd3].length === 2 && ![...bc3, ...bd3].some(id => s.chainRoutes.includes(id)) && s.chainRoutes.length > 0 && same(s.chainRoutes, o.chainRoutes), { chain: s.chainRoutes, oracle: o.chainRoutes });
await shot('11-method-root');
await endStack();

check('no page or console errors', errors.filter(e => !/custom wheel sensitivity|invalid endpoints/.test(e)).length === 0, errors);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify({ results }, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
socket.close(); await fetch(debug + '/json/close/' + page.id);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
