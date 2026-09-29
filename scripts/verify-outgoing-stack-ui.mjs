// Relation stack acceptance (outgoing, and the incoming mirror on the button's second press) via
// Chromium CDP (docs/OUTGOING_STACK.md §Verification).
// Requires BACKEND, APP and DEBUG (a packaged jar on an isolated data dir, and a headless Chromium).
//   node scripts/verify-outgoing-stack-ui.mjs <microservice-java copy> <git fixture> <git base oid> <chain fixture> <journey fixture>
// The Git fixture has packages app.a, app.b and app.c. At the base commit A calls B and C. In the
// working tree A no longer calls C, and B calls C, so Changes draws a->b unchanged, a->c REMOVED and
// b->c ADDED. The chain fixture is a plain source directory (no Git) reproducing the "collapsed card
// is not a hub" case:
//   app.a: class P { void m() { new app.b.Q().q(); } }
//   app.b: class Q { void q() {} void q2() { new app.c.T().t(); } }  class S { void s() { new app.d.U().u(); } }
//   app.c: class T { void t() {} }    app.d: class U { void u() {} }
// Root package app.a: b 1, c 2, d 2. Root class P: b 1, c 2 (Q -> T), d not reached. Root method
// m: b 1 only. The journey fixture is a copy of test-fixtures/journey-candidates (step 12 phase C,
// ADR 0010): SignupController.register's only call has a record-accessor argument, so the solver
// cannot resolve it and it stays UNRESOLVED (candidate calls were withdrawn, ADR 0010 amendment
// 2026-09-25 "candidate calls reverted"); that method root reaches only its parameter type.
// SignupService.register reads a Lombok getter, saves through a library-inherited repository method
// (both UNRESOLVED), calls the Notifier interface (implemented by MailNotifier, OVERRIDES) and
// constructs a record. All fixtures are only read. Run recipe (isolated data dir, model URL on a closed port,
// fixtures copied per run): see the step 12 phase C entry in PROJECT_STATUS.md.
import fs from 'node:fs/promises';
const OUT = process.env.OUT || 'build/outgoing-stack';
await fs.mkdir(OUT, { recursive: true });
const base = process.env.BACKEND || 'http://127.0.0.1:8095', app = process.env.APP || 'http://127.0.0.1:8095', debug = process.env.DEBUG || 'http://127.0.0.1:9333';
const [fixture, gitFixture, baseOid, chainFixture, journeyFixture] = process.argv.slice(2);
if (!fixture || !gitFixture || !baseOid || !chainFixture || !journeyFixture) throw Error('Usage: verify-outgoing-stack-ui.mjs <microservice fixture> <git fixture> <base oid> <chain fixture> <journey fixture>');
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
const micro = await analyze(fixture), review = await analyze(gitFixture), chainFix = await analyze(chainFixture), journey = await analyze(journeyFixture);
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
  const codes = { Escape: 27, Enter: 13, F10: 121, ContextMenu: 93, ArrowDown: 40 };
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
  badges:(o.badges||[]).map(b=>({id:b.nodeId,layer:b.layer,height:b.height,color:b.color})).sort((a,b)=>a.id.localeCompare(b.id)),
  roots:ids('.stack-root'),members:ids('.stack-member'),incomingMembers:ids('.stack-in'),chainRoutes:ids('edge.flow-out'),inRoutes:ids('edge.flow-in'),muted:ids('.muted'),
  pressed:[...document.querySelectorAll('.map-stack-button[aria-pressed=true]')].map(b=>({label:b.getAttribute('aria-label'),title:b.title,direction:b.dataset.stackDirection||null,incoming:b.classList.contains('incoming'),color:getComputedStyle(b).borderColor})),
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
// the reached entities onto the cards Cytoscape draws (each card's parent is its container). Method
// roots also reach a type through CONSTRUCTS/CALLS/USES_TYPE (a dead end) and follow OVERRIDES from
// the overridden method to its implementation. Distances are relaxed until stable (a step inside one
// card, or into the root's own cards, costs 0, any other step 1), then ranked densely.
const drawn = () => evaluate(`(()=>{const cy=${CY};return{cards:cy.nodes().map(n=>({id:n.id(),parent:n.parent().length?n.parent().id():null})),routes:cy.edges().map(e=>({id:e.id(),occ:e.data('occurrenceIds')||[]}))}})()`);
function oracle(graph, view, rootId, kind = 'ALL', direction = 'out') {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const cardParent = new Map(view.cards.map(c => [c.id, c.parent]));
  const rootKind = byId.get(rootId).kind;
  const isMethod = n => n.kind === 'METHOD' || n.kind === 'CONSTRUCTOR';
  const isTypeNode = n => !!n && !['PACKAGE', 'METHOD', 'CONSTRUCTOR', 'FIELD'].includes(n.kind);
  const methodRoot = isMethod({ kind: rootKind });
  const atGranularity = n => rootKind === 'PACKAGE' ? n.kind === 'PACKAGE' : methodRoot ? isMethod(n) : isTypeNode(n);
  const up = function* (id) { for (let n = byId.get(id), guard = 0; n && guard < 100; n = n.parentId ? byId.get(n.parentId) : undefined, guard++) yield n; };
  const owner = id => { for (const n of up(id)) if (atGranularity(n)) return n.id; return null; };
  const representative = id => { for (const n of up(id)) if (cardParent.has(n.id)) return n.id; return null; };
  const containers = id => { const out = []; for (let c = cardParent.get(id); c; c = cardParent.get(c)) out.push(c); return out; };
  const rootSet = view.cards.map(c => c.id).filter(id => id === rootId || containers(id).includes(rootId));
  const rootContainers = containers(rootId);
  const cardOf = id => { const r = representative(id); return rootSet.includes(r) || rootContainers.includes(r) ? '#root' : r; };
  const steps = new Map(), pairs = [];
  for (const e of graph.edges) {
    if (!e.targetId || (kind !== 'ALL' && e.kind !== kind) || e.reviewChange === 'REMOVED') continue;
    let u = owner(e.sourceId), v = owner(e.targetId);
    if (methodRoot && !v && ['CONSTRUCTS', 'CALLS', 'USES_TYPE'].includes(e.kind) && isTypeNode(byId.get(e.targetId))) v = e.targetId;
    if (!u || !v) continue;
    if (methodRoot && e.kind === 'OVERRIDES') [u, v] = [v, u];
    // The incoming stack is the exact mirror: every step above, reversed.
    if (direction === 'in') [u, v] = [v, u];
    steps.set(e.id, [u, v]);
    if (u !== v) pairs.push([u, v]);
  }
  const dist = new Map([[rootId, 0]]), beyond = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [u, v] of pairs) {
      if (!dist.has(u)) continue;
      if (!representative(v)) { beyond.add(v); continue; }
      const d = dist.get(u) + (cardOf(u) === cardOf(v) ? 0 : 1);
      if (!dist.has(v) || d < dist.get(v)) { dist.set(v, d); changed = true; }
    }
  }
  const raw = {};
  for (const [entity, d] of dist) {
    const card = representative(entity);
    if (cardOf(entity) === '#root') continue;
    raw[card] = Math.min(raw[card] ?? Infinity, d);
  }
  const ranks = [...new Set(Object.values(raw))].sort((a, b) => a - b);
  const layers = Object.fromEntries(Object.entries(raw).map(([card, d]) => [card, ranks.indexOf(d) + 1]));
  const covered = view.cards.map(c => c.id).filter(id => !(id in layers) && !rootSet.includes(id) && containers(id).some(c => c in layers)).sort();
  const chainRoutes = view.routes.filter(r => r.occ.some(o => steps.has(o) && dist.has(steps.get(o)[0]) && dist.has(steps.get(o)[1]))).map(r => r.id).sort();
  return { layers, rootSet: rootSet.sort(), covered, chainRoutes, beyond: beyond.size };
}
// The summary line, written from the spec: "Outgoing stack: N layers · M resources[ · K beyond the map]"
// ("Incoming stack: ..." for the mirror). The pressed toggle's tooltip appends what its next press does.
const summaryOf = (depth, count, beyond, direction = 'out') => `${direction === 'in' ? 'Incoming' : 'Outgoing'} stack: ${depth} ${depth === 1 ? 'layer' : 'layers'} · ${count} ${count === 1 ? 'resource' : 'resources'}${beyond ? ` · ${beyond} beyond the map` : ''}`;
// The API graph of the map on screen (ordinary mode only; the Changes checks use literal layers).
let currentGraph = null;
const expectedStack = async (rootId, direction = 'out') => oracle(currentGraph, await drawn(), rootId, 'ALL', direction);
const OUT_HINT = ' (click for incoming)', IN_HINT = ' (click to hide)';
const HALO_IN = 'rgb(99, 102, 241)', HALO_IN_CY = 'rgb(99,102,241)';
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
check('activating roots the stack at the card: pressed button (its next press shows incoming) with the summary tooltip',
  s.pressed.length === 1 && s.pressed[0].label === `Show incoming stack of ${controllers.simpleName}` && s.pressed[0].direction === 'out' && !s.pressed[0].incoming && /^Outgoing stack: \d+ layers? · \d+ resources?( · \d+ beyond the map)? \(click for incoming\)$/.test(s.pressed[0].title), s.pressed);
// 2. Badges 1..N.
check('badges number every reached card by its package-level card-hop distance (independent oracle)', same(layers(s), expected) && depth >= 2, { drawn: layers(s), expected });
check('badges cover every layer 1..N', same([...new Set(s.badges.map(b => b.layer))].sort((a, b) => a - b), Array.from({ length: depth }, (_, i) => i + 1)), s.badges);
check('the root keeps its inspected look and gets no badge; chain cards get the static outline',
  same(s.roots, [controllers.id]) && !s.badges.some(b => b.id === controllers.id) && same(s.members, Object.keys(expected).sort()), s);
check('the tooltip counts layers and resources (and anything beyond the map)', s.pressed[0].title === summaryOf(depth, Object.keys(expected).length, oracle1.beyond) + OUT_HINT, { title: s.pressed[0].title, beyond: oracle1.beyond });
check('the inspector shows the same summary for the inspected root', s.summary === summaryOf(depth, Object.keys(expected).length, oracle1.beyond), s.summary);
check('outgoing: badges and chain outlines are cyan, and no route takes the incoming underlay', s.badges.every(b => b.color === '#0EA5E9') && !s.incomingMembers.length && !s.inRoutes.length, s);
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
check('expanded root: layers are unchanged and match the oracle; the pressed toggle stays on the root only', same(layers(s), expected) && same(rootOracle.layers, expected) && s.pressed.length === 1 && s.pressed[0].label === `Show incoming stack of ${controllers.simpleName}`, { drawn: layers(s), pressed: s.pressed });
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

// Incoming stack (2026-09-28): the root's second press shows the exact mirror in indigo; the third
// press ends it. The root is the drawn package with the deepest incoming stack (independent oracle).
const packageCards = (await drawn()).cards.filter(c => micro.graph.nodes.find(n => n.id === c.id)?.kind === 'PACKAGE').map(c => c.id).sort();
const inRootOracles = await Promise.all(packageCards.map(async id => [id, await expectedStack(id, 'in')]));
const inDepth = o => Math.max(0, ...Object.values(o.layers));
const [inRootId, inOracle] = inRootOracles.reduce((best, next) => inDepth(next[1]) > inDepth(best[1]) ? next : best);
const inRoot = micro.graph.nodes.find(n => n.id === inRootId), inExpected = inOracle.layers, inN = inDepth(inOracle);
check('setup: some drawn package has an incoming stack at least two layers deep', inN >= 2, { root: inRoot.qualifiedName, layers: inExpected });
const beforeIncoming = await geometryState();
await tap(inRoot.id);
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${inRoot.simpleName}"]`);
await clickSelector(`.map-stack-button[aria-label="Show incoming stack of ${inRoot.simpleName}"]`);
s = await stackState();
check('the second press shows the incoming stack: pressed, indigo, its next press hides it',
  s.pressed.length === 1 && s.pressed[0].label === `Hide incoming stack of ${inRoot.simpleName}` && s.pressed[0].direction === 'in' && s.pressed[0].incoming && s.pressed[0].color === HALO_IN, s.pressed);
check('incoming badges number every card that leads to the root by card-hop distance (independent oracle)', same(layers(s), inExpected), { drawn: layers(s), expected: inExpected });
check('incoming badges cover every layer 1..N', same([...new Set(s.badges.map(b => b.layer))].sort((a, b) => a - b), Array.from({ length: inN }, (_, i) => i + 1)), s.badges);
check('incoming badges, chain outlines and route underlays are indigo (HALO.in)',
  s.badges.length > 0 && s.badges.every(b => b.color === '#6366F1') && same(s.incomingMembers, Object.keys(inExpected).sort()) && same(s.members, s.incomingMembers)
  && await evaluate(`${CY}.nodes('.stack-member').every(n=>n.style('outline-color')===${JSON.stringify(HALO_IN_CY)})`)
  && await evaluate(`${CY}.edges('.flow-in').every(e=>e.style('underlay-color')===${JSON.stringify(HALO_IN_CY)}&&e.style('line-style')==='dashed')`), s);
check('incoming chain routes are exactly the drawn routes carrying a reversed chain step; none take the outgoing underlay', same(s.inRoutes, inOracle.chainRoutes) && inOracle.chainRoutes.length > 0 && !s.chainRoutes.length, { drawn: s.inRoutes, expected: inOracle.chainRoutes, out: s.chainRoutes });
check('incoming: the root keeps its teal root look and gets no badge', same(s.roots, inOracle.rootSet) && !s.badges.some(b => b.id === inRoot.id) && await evaluate(`${CY}.getElementById(${JSON.stringify(inRoot.id)}).style('border-color')==='rgb(7,136,140)'`), s.roots);
check('incoming: the tooltip and inspector read "Incoming stack: ..."', s.pressed[0].title === summaryOf(inN, Object.keys(inExpected).length, inOracle.beyond, 'in') + IN_HINT && s.summary === summaryOf(inN, Object.keys(inExpected).length, inOracle.beyond, 'in'), { title: s.pressed[0].title, summary: s.summary });
check('incoming: cards outside the chain are muted, chain cards are not', await evaluate(`(()=>{const cy=${CY};const chain=new Set(${JSON.stringify([...inOracle.rootSet, ...Object.keys(inExpected), ...inOracle.covered])});return cy.nodes().filter(n=>!n.isParent()).every(n=>chain.has(n.id())!==n.hasClass('muted'))})()`));
check('switching to incoming creates no undo entry (redo survives)', await redoEnabled());
await unchanged('switching to incoming moves no card and keeps the camera', beforeIncoming);
await shot('in-01-incoming-stack');
// Selecting a chain card keeps the incoming root; another card's own button starts outgoing there.
const inLayer1 = s.badges.find(b => b.layer === 1).id, inLayer1Node = micro.graph.nodes.find(n => n.id === inLayer1);
await tap(inLayer1);
s = await stackState();
check('incoming: selecting a layer-1 card keeps the incoming stack pinned to its root', same(layers(s), inExpected) && s.pressed.length === 1 && s.pressed[0].direction === 'in' && s.pressed[0].label.endsWith(inRoot.simpleName), s.pressed);
await shot('in-02-layer-one-selected');
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${inLayer1Node.simpleName}"]`);
s = await stackState();
check('the button of another card starts a fresh outgoing stack there, even while incoming is shown', same(s.roots, [inLayer1]) && s.pressed.length === 1 && s.pressed[0].direction === 'out' && s.badges.every(b => b.color === '#0EA5E9'), s.pressed);
// Back to the incoming root: out, in, then the third press ends it.
await tap(inRoot.id);
await clickSelector(`.map-stack-button[aria-label="Show outgoing stack of ${inRoot.simpleName}"]`);
await clickSelector(`.map-stack-button[aria-label="Show incoming stack of ${inRoot.simpleName}"]`);
check('the cycle reaches incoming again on the root', (await stackState()).pressed[0]?.direction === 'in');
await clickSelector(`.map-stack-button[aria-label="Hide incoming stack of ${inRoot.simpleName}"]`);
s = await stackState();
check('the third press ends the stack: no badges, stack classes or pressed button; the toggle offers outgoing again',
  !s.badges.length && !s.roots.length && !s.members.length && !s.pressed.length && await evaluate(`!!document.querySelector('.map-stack-button[aria-label="Show outgoing stack of ${inRoot.simpleName}"][aria-pressed=false]')`), s);
check('the whole cycle created no undo entry (redo survives)', await redoEnabled());
await unchanged('the whole cycle moved no card and kept the camera', beforeIncoming);
// The menu offers incoming directly; Escape ends an incoming stack like an outgoing one.
await evaluate(`${CY}.getElementById(${JSON.stringify(inRoot.id)}).emit('cxttap');0`); await pause(350);
const menuItems = () => evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].map(b=>b.textContent.trim())`);
check('the context menu offers both directions directly', (await menuItems()).includes('⇶ Show outgoing stack') && (await menuItems()).includes('⇇ Show incoming stack'), await menuItems());
await click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.trim()==='⇇ Show incoming stack');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
s = await stackState();
check('"Show incoming stack" roots the incoming stack straight from off', same(layers(s), inExpected) && s.pressed[0]?.direction === 'in' && !await evaluate(`${CY}.getElementById(${JSON.stringify(inRoot.id)}).hasClass('multi-selected')`), s.pressed);
await evaluate(`${CY}.getElementById(${JSON.stringify(inRoot.id)}).emit('cxttap');0`); await pause(350);
check('the menu then offers "Hide incoming stack" and "Show outgoing stack"', (await menuItems()).includes('⇇ Hide incoming stack') && (await menuItems()).includes('⇶ Show outgoing stack'), await menuItems());
await click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.trim()==='⇶ Show outgoing stack');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
check('"Show outgoing stack" switches the same root to outgoing directly', (await stackState()).pressed[0]?.direction === 'out');
await evaluate(`${CY}.getElementById(${JSON.stringify(inRoot.id)}).emit('cxttap');0`); await pause(350);
await click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.trim()==='⇇ Show incoming stack');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
const beforeInEsc = await selected();
await key('Escape');
s = await stackState();
check('Escape ends an incoming stack and keeps the selection', !s.badges.length && !s.roots.length && !s.pressed.length && (await selected()) === beforeInEsc && beforeInEsc !== null, s);
await key('Escape');
check('a second Escape clears the selection after an incoming stack', (await selected()) === null);

// Context menu and keyboard entry points.
await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).emit('cxttap');0`); await pause(350);
check('the context menu offers "Show outgoing stack"', await evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].some(b=>b.textContent.trim()==='⇶ Show outgoing stack')`));
await click(await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>b.textContent.includes('Show outgoing stack'));const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
s = await stackState();
check('the context-menu item starts the stack', same(s.roots, [controllers.id]) && s.badges.length > 0);
check('rooting the stack from the menu leaves no multi-selection behind (the right-click added the card only to open the menu)',
  !await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).hasClass('multi-selected')`) && !await evaluate(`!!document.querySelector('.selection-bar')`));
await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).emit('cxttap');0`); await pause(350);
check('the context menu then offers "Hide outgoing stack" (and "Show incoming stack")', await evaluate(`(()=>{const t=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].map(b=>b.textContent.trim());return t.includes('⇶ Hide outgoing stack')&&t.includes('⇇ Show incoming stack')})()`));
await key('Escape'); // closes the menu first
check('Escape closes an open menu before it ends the stack', (await stackState()).roots.length === 1);
await key('Escape'); await key('Escape'); // stack, then selection
await tap(controllers.id);
await evaluate(`document.querySelector('.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"]').focus()`);
await key('Enter');
check('the stack button is keyboard operable (focus + Enter)', (await stackState()).pressed.length === 1);

// Keyboard path to the card menu (phase B review B1): Shift+F10 or the ContextMenu key on a focused
// corner button opens the same menu at the card; arrows move, Escape returns focus to the button.
await key('Escape'); await key('Escape'); // stack, then selection
await tap(controllers.id);
const showToggle = `.map-stack-button[aria-label="Show outgoing stack of ${controllers.simpleName}"]`;
const menuState = () => evaluate(`(()=>{const m=document.querySelector('.graph-context-menu');const a=document.activeElement;return{open:!!m,items:m?[...m.querySelectorAll('[role=menuitem]')].map(b=>b.textContent.trim()):[],focus:a===document.body?'BODY':(a.getAttribute('aria-label')||a.textContent.trim()),inMenu:!!m&&m.contains(a),pressed:a.getAttribute('aria-pressed'),rect:m?{x:m.getBoundingClientRect().x,y:m.getBoundingClientRect().y}:null}})()`);
await evaluate(`document.querySelector(${JSON.stringify(showToggle)}).focus()`);
await key('F10', { modifiers: 8 });
let m = await menuState();
const firstEnabled = await evaluate(`[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>!b.disabled)?.textContent.trim()`);
check('Shift+F10 on a focused corner button opens the card menu with "Show outgoing stack", focus on its first item',
  m.open && m.items.includes('⇶ Show outgoing stack') && m.inMenu && m.focus === firstEnabled, m);
const cardAt = await evaluate(`(()=>{const cy=${CY},c=document.querySelector('.graph-canvas').getBoundingClientRect(),p=cy.getElementById(${JSON.stringify(controllers.id)}).renderedPosition();return{x:c.x+Math.max(8,Math.min(p.x,cy.width()-238)),y:c.y+Math.max(8,Math.min(p.y,cy.height()-150))}})()`);
check('the keyboard-opened menu sits at the card, as a right-click on it would place it', !!m.rect && Math.abs(m.rect.x - cardAt.x) < 2 && Math.abs(m.rect.y - cardAt.y) < 2, { menu: m.rect, card: cardAt });
check('opening the menu from the keyboard adds nothing to the multi-selection', !await evaluate(`${CY}.nodes('.multi-selected').length`));
await shot('17-keyboard-menu');
await key('ArrowDown');
const afterArrow = await menuState();
check('ArrowDown moves focus to the next menu item', afterArrow.inMenu && afterArrow.focus !== m.focus, { before: m.focus, after: afterArrow.focus });
await key('Escape');
m = await menuState();
check('Escape closes the keyboard-opened menu and returns focus to the corner button', !m.open && m.focus === `Show outgoing stack of ${controllers.simpleName}`, m);
check('that Escape closed only the menu: the card stays selected', (await selected()) === controllers.simpleName);
await key('ContextMenu');
m = await menuState();
check('the ContextMenu key opens the same menu', m.open && m.items.includes('⇶ Show outgoing stack') && m.inMenu, m);
for (let i = 0; i < m.items.length && (await menuState()).focus !== '⇶ Show outgoing stack'; i++) await key('ArrowDown');
await key('Enter');
s = await stackState(); m = await menuState();
check('Enter on "Show outgoing stack" starts the stack from the keyboard menu', same(s.roots, [controllers.id]) && s.badges.length > 0 && !m.open, { roots: s.roots, menu: m.open });
check('after the menu action focus is back on the card\'s toggle, now pressed', m.focus === `Show incoming stack of ${controllers.simpleName}` && m.pressed === 'true', m);

// Keyboard deactivation keeps focus (phase B review B4): the root is neither selected nor hovered.
// The pressed toggle now goes outgoing -> incoming -> off, so it takes two presses.
await tap(services.id);
const emptyPoint = await evaluate(`(()=>{const cy=${CY};const c=document.querySelector('.graph-canvas').getBoundingClientRect();for(let y=40;y<c.height-40;y+=20)for(let x=40;x<c.width-40;x+=20){const p={x:(x-cy.pan().x)/cy.zoom(),y:(y-cy.pan().y)/cy.zoom()};if(!cy.elements().some(e=>{const b=e.boundingBox();return p.x>=b.x1-20&&p.x<=b.x2+20&&p.y>=b.y1-20&&p.y<=b.y2+20}))return{x:c.x+x,y:c.y+y}}return null})()`);
await mouse('mouseMoved', await centerOf(`.map-stack-button[aria-label="Show incoming stack of ${controllers.simpleName}"]`), 'none'); await pause(200);
await mouse('mouseMoved', emptyPoint, 'none'); await pause(400);
await evaluate(`document.querySelector('.map-stack-button[aria-label="Show incoming stack of ${controllers.simpleName}"]').focus()`);
await key('Enter');
m = await menuState(); s = await stackState();
check('Enter on the focused outgoing toggle switches to incoming and keeps focus on it',
  same(s.roots, [controllers.id]) && s.pressed[0]?.direction === 'in' && m.focus === `Hide incoming stack of ${controllers.simpleName}` && m.pressed === 'true', { focus: m.focus, pressed: s.pressed });
await key('Enter');
m = await menuState(); s = await stackState();
check('keyboard deactivation on an unselected, unhovered root keeps focus on its toggle, now unpressed',
  !s.roots.length && m.focus === `Show outgoing stack of ${controllers.simpleName}` && m.pressed === 'false', { focus: m.focus, pressed: m.pressed, roots: s.roots });
await shot('18-keyboard-deactivation-focus');
await key('Enter'); // on again, from the same focused toggle
check('the retained toggle turns the stack back on', same((await stackState()).roots, [controllers.id]));
// The menu's multi-selection actions still act on the set the right-clicks built.
await evaluate(`${CY}.getElementById(${JSON.stringify(services.id)}).emit('cxttap');0`); await pause(350);
await key('Escape');
await evaluate(`${CY}.getElementById(${JSON.stringify(controllers.id)}).emit('cxttap');0`); await pause(350);
await buttonByText(`○ Deselect ${controllers.simpleName}`);
check('"Deselect" from the menu removes only that card; the other right-clicked card stays selected',
  same(await evaluate(`${CY}.nodes('.multi-selected').map(n=>n.id()).sort()`), [services.id]));
await clickSelector('.selection-bar button:last-child');
await tap(controllers.id);

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
// The incoming mirror of the collapsed-hub case: at package level d <- b <- a, but at class level only
// S calls into U, and nothing leads to S, so a class root U reaches b and never a.
const typeU = chainFix.graph.nodes.find(n => n.qualifiedName === 'app.d.U');
// The map has grown to the right by now: center the root (a view-only camera move) so its corner
// buttons are not under the inspector panel.
const centerOn = async id => { await evaluate(`(()=>{const cy=${CY};cy.center(cy.getElementById(${JSON.stringify(id)}));return 0})()`); await pause(700); };
const startIncoming = async n => { await tap(n.id); await centerOn(n.id); await clickSelector(`.map-stack-button[data-card-id="${n.id}"]`); await clickSelector(`.map-stack-button[data-card-id="${n.id}"]`);
  // Badges are drawn only on screen: fit the map (view-only) before reading them.
  await clickSelector('[aria-label="Fit map"]'); await pause(700); return stackState(); };
s = await startIncoming(cd);
o = await expectedStack(cd.id, 'in');
check('chain fixture, incoming package root app.d: b 1, a 2 (package-level mirror; oracle agrees)', s.pressed[0]?.direction === 'in' && same(layers(s), { [cb.id]: 1, [ca.id]: 2 }) && same(o.layers, layers(s)) && same(s.inRoutes, o.chainRoutes), { drawn: layers(s), oracle: o.layers, routes: s.inRoutes, expected: o.chainRoutes });
await shot('in-03-chain-package-root');
await endStack();
await centerOn(cd.id);
await clickSelector(`[aria-label="Show types inside ${cd.simpleName}"]`);
s = await startIncoming(typeU);
o = await expectedStack(typeU.id, 'in');
check('chain fixture, incoming class root U: b 1 only; a is not reached through the collapsed b card (oracle agrees)', s.pressed[0]?.direction === 'in' && same(layers(s), { [cb.id]: 1 }) && same(o.layers, layers(s)) && same(s.inRoutes, o.chainRoutes), { drawn: layers(s), oracle: o.layers });
await shot('in-04-chain-class-root');
await endStack();

// Step 12 phase C: the full journey of a controller method (the user's report) on the journey fixture.
await openMap(journey.snapshot);
currentGraph = journey.graph;
const [jApi, jService, jDto, jDomain, jPricing] = ['journey.api', 'journey.service', 'journey.dto', 'journey.domain', 'journey.pricing'].map(n => pkg(journey.graph, n));
const jNode = q => journey.graph.nodes.find(n => n.qualifiedName === q);
const [jController, registerMethod, signupService, eventStore, notifier, mailNotifier] = ['journey.api.SignupController', 'journey.api.SignupController.register(String,SignupRequest)', 'journey.service.SignupService', 'journey.service.EventStore', 'journey.service.Notifier', 'journey.service.MailNotifier'].map(jNode);
check('journey fixture: the controller method\'s call stays UNRESOLVED (no CALLS/CANDIDATE anywhere) and MailNotifier has an OVERRIDES fact',
  journey.graph.edges.every(e => !(e.kind === 'CALLS' && e.resolution === 'CANDIDATE'))
  && !journey.graph.edges.some(e => e.sourceId === registerMethod.id && e.targetId === jNode('journey.service.SignupService.register(String,String)').id)
  && journey.graph.edges.some(e => e.sourceId === jNode('journey.service.MailNotifier.send(String)').id && e.targetId === jNode('journey.service.Notifier.send(String)').id && e.kind === 'OVERRIDES'));
const journeyLiteral = { [jService.id]: 1, [jDto.id]: 1, [jDomain.id]: 2 };
// Badges and corner buttons are only drawn for cards on screen, and expansions grow the map: the
// view-only Fit map control (outside undo) brings every card back into view before reading them.
const fitMap = async () => { await clickSelector('[aria-label="Fit map"]'); await pause(700); };
s = await startStack(jApi);
o = await expectedStack(jApi.id);
check('journey, package root api: service 1, dto 1, domain 2; pricing is not reached (literal and oracle)', same(layers(s), journeyLiteral) && same(o.layers, journeyLiteral) && s.muted.includes(jPricing.id), { drawn: layers(s), oracle: o.layers });
check('journey, package root api: chain routes match the oracle', same(s.chainRoutes, o.chainRoutes) && s.chainRoutes.length > 0, { drawn: s.chainRoutes, oracle: o.chainRoutes });
await shot('12-journey-package-root');
await endStack();
await clickSelector(`[aria-label="Show types inside ${jApi.simpleName}"]`);
await fitMap();
s = await startStack(jController);
o = await expectedStack(jController.id);
check('journey, class root SignupController: service 1, dto 1, domain 2 (literal and oracle)', same(layers(s), journeyLiteral) && same(o.layers, journeyLiteral) && same(s.chainRoutes, o.chainRoutes), { drawn: layers(s), oracle: o.layers });
await shot('13-journey-class-root');
await endStack();
await clickSelector(`[aria-label="Show methods inside ${jController.simpleName}"]`);
await fitMap();
s = await startStack(registerMethod);
o = await expectedStack(registerMethod.id);
const registerLiteral = { [jDto.id]: 1 };
check('journey, method root register: only its parameter type, dto 1; the unresolved call is not walked (literal and oracle)', same(layers(s), registerLiteral) && same(o.layers, registerLiteral), { drawn: layers(s), oracle: o.layers });
check('journey, method root register: chain routes match the oracle; the summary counts 1 layer and 1 resource', same(s.chainRoutes, o.chainRoutes) && s.pressed[0]?.title === summaryOf(1, 1, 0) + OUT_HINT, { drawn: s.chainRoutes, oracle: o.chainRoutes, title: s.pressed[0]?.title });
await shot('14-journey-method-root');
await endStack();
// Dispatch from the service method: the Notifier interface 1 (a resolved call), MailNotifier 2
// through the reversed OVERRIDES fact; the Receipt record (dto) and the Event local type (domain) 1.
// The repository is not reached: its library-inherited methods stay UNRESOLVED.
const serviceRegister = jNode('journey.service.SignupService.register(String,String)');
// Corner buttons are hidden at low zoom by design: zoom in on a card, as a user would, to use them.
const zoomTo = async id => { await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(id)});cy.zoom({level:1,renderedPosition:n.renderedPosition()});cy.center(n);return 0})()`); await pause(700); };
await clickSelector(`[aria-label="Show types inside ${jService.simpleName}"]`);
await fitMap();
await zoomTo(signupService.id);
await clickSelector(`[aria-label="Show methods inside ${signupService.simpleName}"]`);
await fitMap();
// Both methods are named register: start this stack by the card id, not the shared label.
await tap(serviceRegister.id);
await zoomTo(serviceRegister.id);
await clickSelector(`.map-stack-button[data-card-id="${serviceRegister.id}"]`);
await fitMap();
s = await stackState();
o = await expectedStack(serviceRegister.id);
const dispatchLiteral = { [notifier.id]: 1, [jDto.id]: 1, [jDomain.id]: 1, [mailNotifier.id]: 2 };
check('journey, method root SignupService.register: Notifier/dto/domain 1, MailNotifier 2; EventStore not reached (literal and oracle)', same(layers(s), dispatchLiteral) && same(o.layers, dispatchLiteral) && !(eventStore.id in layers(s)), { drawn: layers(s), oracle: o.layers });
const dispatchRoute = await routeIds(mailNotifier.id, notifier.id);
check('journey: the drawn MailNotifier -> Notifier (OVERRIDES) route is a chain route, and all chain routes match the oracle', dispatchRoute.length === 1 && s.chainRoutes.includes(dispatchRoute[0]) && same(s.chainRoutes, o.chainRoutes), { dispatchRoute, drawn: s.chainRoutes, oracle: o.chainRoutes });
check('journey: badges cover every layer 1..2 with no gap', same([...new Set(s.badges.map(b => b.layer))].sort(), [1, 2]), s.badges);
await shot('15-journey-dispatch');
// D5: taking domain off the map ends the chain there; the summary counts what lies beyond it.
await tap(jDomain.id);
await evaluate(`${CY}.getElementById(${JSON.stringify(jDomain.id)}).emit('cxttap');0`); await pause(350);
await click(await evaluate(`(()=>{const b=document.querySelector('.graph-context-menu [role=menuitem].danger');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
await until(async () => !(await evaluate(`${CY}.getElementById(${JSON.stringify(jDomain.id)}).length`)), 'domain removed from scope');
await fitMap();
await tap(serviceRegister.id);
s = await stackState();
o = await expectedStack(serviceRegister.id);
const beyondLiteral = { [notifier.id]: 1, [jDto.id]: 1, [mailNotifier.id]: 2 };
check('journey, domain out of scope: the stack stays rooted and layers drop domain (literal and oracle)', same(s.roots, [serviceRegister.id]) && same(layers(s), beyondLiteral) && same(o.layers, beyondLiteral), { drawn: layers(s), oracle: o.layers });
check('journey, domain out of scope: the oracle counts one entity beyond the map (the Event type)', o.beyond === 1, o.beyond);
check('journey, domain out of scope: the inspector reads "2 layers · 3 resources · 1 beyond the map"', s.summary === summaryOf(2, 3, 1), s.summary);
await shot('16-journey-beyond-the-map');
// Fitted this far out, the corner buttons (and so the pressed toggle) are hidden by design: zoom in
// on the root, as a user would, to read the toggle's tooltip.
await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(serviceRegister.id)});cy.zoom({level:1,renderedPosition:n.renderedPosition()});return 0})()`); await pause(700);
s = await stackState();
check('journey, domain out of scope: the pressed toggle tooltip reads the same line', s.pressed.length === 1 && s.pressed[0].title === summaryOf(2, 3, 1) + OUT_HINT, s.pressed);
await endStack();

check('no page or console errors', errors.filter(e => !/custom wheel sensitivity|invalid endpoints/.test(e)).length === 0, errors);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify({ results }, null, 2));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
socket.close(); await fetch(debug + '/json/close/' + page.id);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
