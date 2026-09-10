// Stable-map browser observation using Chromium CDP and Node's built-in WebSocket; no npm dependency.
//
// Modes (config.mode):
//   baseline    — records current behaviour and asserts the *known broken* outcomes of R6.
//                 This is the Step 1 exit evidence. It is expected to start failing once
//                 Steps 2/3 land; that failure is the signal to retire the baseline case.
//   acceptance  — asserts the stable-map contract from the product specification. It fails
//                 today on purpose and must never be weakened to accept the broken behaviour.
//
// Instrumentation is installed from the test side onto Cytoscape's own registry
// (`.graph-canvas._cyreg.cy`). The application ships no debug object and no graph data leaves
// the page; `window.__probe` is created here and holds integer counters only.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const { base, debug, fixture, output, mode = 'baseline' } = config;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
const scenarios = [];
const screenshots = [];

async function api(path, body) {
  const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${r.status}`);
  return r.json();
}
async function until(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await pause(200); } throw Error(`Timed out: ${label}`); }

// ---------------------------------------------------------------------------
// Import the fixture and confirm it is large enough to exercise 36 -> 12.
// ---------------------------------------------------------------------------
const ws = await api('/api/workspaces', { path: fixture });
const analysis = await api(`/api/workspaces/${ws.id}/analysis-jobs`, {});
await until(async () => (await api(`/api/jobs/${analysis.id}`)).status === 'COMPLETED', 'analysis');
const snapshot = (await api(`/api/workspaces/${ws.id}`)).activeSnapshotId;
const graph = await api(`/api/snapshots/${snapshot}/graph`);
const isType = n => !['PACKAGE', 'METHOD', 'FIELD', 'CONSTRUCTOR'].includes(n.kind);
const typeCount = graph.nodes.filter(isType).length;
const packageCount = graph.nodes.filter(n => n.kind === 'PACKAGE').length;
assert.ok(typeCount >= 60, `fixture must expose at least 60 types, saw ${typeCount}`);
assert.ok(packageCount >= 6, `fixture must expose at least 6 packages, saw ${packageCount}`);
const edgeKinds = [...new Set(graph.edges.map(e => e.kind))].sort();
const resolutions = [...new Set(graph.edges.map(e => e.resolution))].sort();
const unresolvedRelationships = (graph.metadata?.unresolvedRelationships || []).length;

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0; const pending = new Map(); const errors = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) { const wait = pending.get(message.id); if (wait) { pending.delete(message.id); message.error ? wait.reject(Error(JSON.stringify(message.error))) : wait.resolve(message.result); } }
  else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
};
function cdp(method, params = {}) { const id = ++sequence; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function screenshot(name) {
  await pause(700);
  const result = await cdp('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`${output}/${name}.png`, Buffer.from(result.data, 'base64'));
  screenshots.push(`${name}.png`);
}

// ---------------------------------------------------------------------------
// Test-side instrumentation. Cytoscape is destroyed and recreated on the same
// container div, so DOM identity proves nothing: stamp each core with an id and
// keep the counters on window so they survive recreation.
// ---------------------------------------------------------------------------
const CY = `document.querySelector('.graph-canvas')._cyreg.cy`;
const PROBE = `(()=>{
  const cy=${CY};
  if(!window.__probe)window.__probe={instances:0,layouts:0,fits:0,centers:0,taps:0,dbltaps:0,anyDbltaps:0};
  if(!cy.__probeId){
    cy.__probeId=++window.__probe.instances;
    const L=cy.layout.bind(cy),F=cy.fit.bind(cy),C=cy.center.bind(cy);
    cy.layout=(...a)=>{window.__probe.layouts++;return L(...a);};
    cy.fit=(...a)=>{window.__probe.fits++;return F(...a);};
    cy.center=(...a)=>{window.__probe.centers++;return C(...a);};
    cy.on('tap','node',()=>window.__probe.taps++);
    cy.on('dbltap','node',()=>window.__probe.dbltaps++);
    cy.on('dbltap',()=>window.__probe.anyDbltaps++);
  }
  return cy.__probeId;
})()`;
const STATE = `(()=>{
  const cy=${CY};
  const round=v=>Math.round(v*10000)/10000;
  return {
    probeId:cy.__probeId??null,
    counters:{...(window.__probe||{})},
    ids:cy.nodes().map(n=>n.id()),
    positions:Object.fromEntries(cy.nodes().map(n=>[n.id(),{x:round(n.position('x')),y:round(n.position('y'))}])),
    edgeIds:cy.edges().map(e=>e.id()).sort(),
    zoom:round(cy.zoom()),
    pan:{x:round(cy.pan().x),y:round(cy.pan().y)},
    level:document.querySelector('.segmented button.active')?.textContent||null,
    banner:document.querySelector('.scope-banner-text span')?.textContent||null,
    showMore:document.querySelector('.show-more')?.textContent||null,
    inspecting:document.querySelector('.inspecting-chip')?.textContent||null,
    scopeChecks:[...document.querySelectorAll('.scope-checkbox')].map(i=>i.checked?'c':i.indeterminate?'i':'u').join(''),
    inspectorOpen:!!document.querySelector('.inspector-top'),
    inspectorSubject:(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90),
    canvasBox:(()=>{const b=document.querySelector('.graph-canvas').getBoundingClientRect();return{w:Math.round(b.width),h:Math.round(b.height)};})()
  };
})()`;

const probe = () => evaluate(PROBE);
async function state() { await probe(); return evaluate(STATE); }
const resetCounters = () => evaluate(`(()=>{const p=window.__probe;p.layouts=0;p.fits=0;p.centers=0;p.taps=0;p.dbltaps=0;p.anyDbltaps=0;return true})()`);

function delta(before, after) {
  const moved = before.ids.filter(id => after.positions[id] &&
    (Math.abs(after.positions[id].x - before.positions[id].x) > 0.01 || Math.abs(after.positions[id].y - before.positions[id].y) > 0.01));
  const maxMove = moved.reduce((max, id) => Math.max(max, Math.hypot(after.positions[id].x - before.positions[id].x, after.positions[id].y - before.positions[id].y)), 0);
  return {
    countBefore: before.ids.length, countAfter: after.ids.length,
    idOrderPreserved: JSON.stringify(before.ids) === JSON.stringify(after.ids),
    survivors: before.ids.filter(id => after.ids.includes(id)).length,
    dropped: before.ids.filter(id => !after.ids.includes(id)).length,
    added: after.ids.filter(id => !before.ids.includes(id)).length,
    survivorsMoved: moved.length,
    maxMoveModelUnits: Math.round(maxMove * 100) / 100,
    canvasRecreated: before.probeId !== after.probeId,
    layoutCalls: after.counters.layouts - before.counters.layouts,
    fitCalls: after.counters.fits - before.counters.fits,
    centerCalls: after.counters.centers - before.counters.centers,
    taps: after.counters.taps - before.counters.taps,
    dbltaps: after.counters.dbltaps - before.counters.dbltaps,
    anyDbltaps: after.counters.anyDbltaps - before.counters.anyDbltaps,
    zoomChanged: before.zoom !== after.zoom,
    panChanged: before.pan.x !== after.pan.x || before.pan.y !== after.pan.y,
    edgeCountBefore: before.edgeIds.length, edgeCountAfter: after.edgeIds.length,
    levelBefore: before.level, levelAfter: after.level,
    showMoreBefore: before.showMore, showMoreAfter: after.showMore,
    scopeChanged: before.scopeChecks !== after.scopeChecks
  };
}

/** Records a scenario. `baseline` and `acceptance` are arrays of [label, boolean]. */
function record(name, before, after, d, expectations) {
  const active = expectations[mode] || [];
  const checked = active.map(([label, ok]) => ({ label, ok }));
  for (const c of checked) if (!c.ok) failures.push(`${mode}/${name}: ${c.label}`);
  scenarios.push({ name, delta: d, before: summarize(before), after: summarize(after), checks: checked });
  console.log(`  ${checked.every(c => c.ok) ? 'ok  ' : 'FAIL'} ${name} :: ${JSON.stringify(d)}`);
}
const summarize = s => ({ count: s.ids.length, edges: s.edgeIds.length, zoom: s.zoom, pan: s.pan, level: s.level, banner: s.banner, showMore: s.showMore, inspecting: s.inspecting, inspectorSubject: s.inspectorSubject, probeId: s.probeId, canvasBox: s.canvasBox });

// ---------------------------------------------------------------------------
// Real pointer dispatch (never `.emit('tap')`).
// ---------------------------------------------------------------------------
async function pointAt(expression) {
  return evaluate(`(()=>{const p=${expression};if(!p)return null;const box=document.querySelector('.graph-canvas').getBoundingClientRect();return{x:box.left+p.x,y:box.top+p.y}})()`);
}
const nodePoint = id => pointAt(`(()=>{const n=${CY}.getElementById(${JSON.stringify(id)});return n.length?n.renderedPosition():null})()`);
const edgePoint = id => pointAt(`(()=>{const e=${CY}.getElementById(${JSON.stringify(id)});return e.length?e.renderedMidpoint():null})()`);

async function pressRelease(point, clickCount) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount });
  await pause(30);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount });
}
async function singleClick(point) { await pressRelease(point, 1); await pause(450); }
async function doubleClick(point, gap = 90) { await pressRelease(point, 1); await pause(gap); await pressRelease(point, 2); await pause(600); }

/** Real user camera movement: the app's own zoom control plus a background drag. */
async function panAndZoom() {
  await evaluate(`document.querySelector('.zoom-controls button[aria-label="Zoom in"]').click()`);
  await pause(250);
  const empty = await pointAt(`(()=>{const cy=${CY},w=cy.width(),h=cy.height();
    const occupied=cy.nodes().map(n=>n.renderedBoundingBox());
    for(let y=40;y<h-40;y+=25)for(let x=40;x<w-40;x+=25){
      if(!occupied.some(b=>x>b.x1-20&&x<b.x2+20&&y>b.y1-20&&y<b.y2+20))return{x,y};
    }
    return null})()`);
  if (!empty) return false;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty.x, y: empty.y, button: 'none', buttons: 0 });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: empty.x, y: empty.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 6; step++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: empty.x - step * 18, y: empty.y - step * 12, button: 'left', buttons: 1 });
    await pause(20);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: empty.x - 108, y: empty.y - 72, button: 'left', buttons: 0, clickCount: 1 });
  // The drag selects surrounding text in headless Chromium; clear it so screenshots stay readable.
  await evaluate(`document.getSelection()?.removeAllRanges();true`);
  await pause(400);
  return true;
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------
await cdp('Runtime.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${base}/?snapshotId=${snapshot}` });
await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy`), 'canvas mount');
await probe();

const clickLevel = name => evaluate(`[...document.querySelectorAll('.segmented button')].find(b=>b.textContent===${JSON.stringify(name)}).click()`);
async function revealClasses(target) {
  await clickLevel('Classes');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) > 1, 'class level');
  while ((await evaluate(`${CY}.nodes().length`)) < target) {
    const more = await evaluate(`!!document.querySelector('.show-more')`);
    if (!more) break;
    await evaluate(`document.querySelector('.show-more').click()`);
    await pause(500);
  }
  await probe();
  return evaluate(`${CY}.nodes().length`);
}

console.log(`fixture: ${typeCount} types, ${packageCount} packages, edge kinds ${edgeKinds.join('/')}, displayed resolutions ${resolutions.join('/')}, ${unresolvedRelationships} unresolved-target relationships (never projected onto the canvas)`);
console.log(`mode: ${mode}`);

// ---------------------------------------------------------------------------
// S1 — click a class card while only the initial 12 are displayed.
// Isolates the canvas defect from the display-limit defect.
// ---------------------------------------------------------------------------
{
  const shown = await revealClasses(12);
  assert.equal(shown, 12, 'initial class page is 12');
  await resetCounters();
  const before = await state();
  const target = await evaluate(`${CY}.nodes()[5].id()`);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  record('click-class-card-at-12', before, after, d, {
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['canvas instance survives (no topology change)', !d.canvasRecreated],
      ['selection still triggers an arrangement', d.layoutCalls >= 1],
      ['surviving cards move', d.survivorsMoved > 0],
      ['camera is re-fitted', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['inspector opened', after.inspectorOpen],
      ['same displayed IDs in the same order', d.idOrderPreserved],
      ['no arrangement command', d.layoutCalls === 0],
      ['no card moved', d.survivorsMoved === 0],
      ['zoom preserved', !d.zoomChanged],
      ['pan preserved', !d.panChanged],
      ['level unchanged', d.levelBefore === d.levelAfter]
    ]
  });
  await screenshot('s1-click-class-at-12');
}

// ---------------------------------------------------------------------------
// S2 — reveal 36 classes, then click one. The reported 36 -> 12 reset.
// ---------------------------------------------------------------------------
{
  const shown = await revealClasses(36);
  assert.equal(shown, 36, 'two Show more actions reveal 36 classes');
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  const target = await evaluate(`${CY}.nodes()[14].id()`);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  record('reveal-36-then-click-class', before, after, d, {
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['displayed page collapses back to 12', d.countBefore === 36 && d.countAfter === 12],
      ['24 classes dropped', d.dropped === 24],
      ['canvas destroyed and recreated', d.canvasRecreated],
      ['surviving cards move', d.survivorsMoved > 0],
      ['the user camera is discarded', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['inspector opened', after.inspectorOpen],
      ['still 36 displayed', d.countAfter === 36],
      ['same displayed IDs in the same order', d.idOrderPreserved],
      ['no card moved', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged],
      ['canvas instance preserved', !d.canvasRecreated],
      ['no arrangement command', d.layoutCalls === 0]
    ]
  });
  await screenshot('s2-reveal-36-then-click');
}

// ---------------------------------------------------------------------------
// S3 — click a package card at Packages level (no display-limit reset path).
// ---------------------------------------------------------------------------
{
  await clickLevel('Packages');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 6, 'package level');
  await probe(); await resetCounters();
  const before = await state();
  const target = await evaluate(`${CY}.nodes()[2].id()`);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  record('click-package-card', before, after, d, {
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['package count unchanged (no limit at PACKAGE level)', d.countBefore === d.countAfter],
      ['selection still triggers an arrangement', d.layoutCalls >= 1],
      ['surviving cards move', d.survivorsMoved > 0]
    ],
    acceptance: [
      ['inspector opened', after.inspectorOpen],
      ['no arrangement command', d.layoutCalls === 0],
      ['no card moved', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged]
    ]
  });
  await screenshot('s3-click-package');
}

// ---------------------------------------------------------------------------
// S4 — click an edge. The aggregate edge ID is not a node ID, so the focused
// layout falls back to the unfocused alphabetical grid.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  // A real user has already inspected something and moved the camera. Without that the
  // unfocused fallback grid is indistinguishable from the incumbent grid.
  const seed = await evaluate(`${CY}.nodes()[8].id()`);
  await singleClick(await nodePoint(seed));
  await pause(400);
  await probe();
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  const candidates = await evaluate(`${CY}.edges().map(e=>e.id())`);
  let clicked = null;
  for (const id of candidates.slice(0, 12)) {
    const point = await edgePoint(id);
    if (!point) continue;
    await singleClick(point);
    if (await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`)) { clicked = id; break; }
  }
  assert.ok(clicked, 'a real pointer click landed on an edge');
  const after = await state();
  const d = delta(before, after);
  d.edgeId = clicked;
  record('click-edge', before, after, d, {
    baseline: [
      ['relationship inspector opened', after.inspectorSubject.includes('Relationship')],
      ['edge selection does not reset the display limit', d.countAfter === d.countBefore],
      ['selection still triggers an arrangement', d.layoutCalls >= 1],
      ['an aggregate edge ID matches no node, so every card falls back to the alphabetical grid', d.survivorsMoved > 0],
      ['the user camera is discarded by the automatic fit', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['relationship inspector opened', after.inspectorSubject.includes('Relationship')],
      ['still 36 displayed', d.countAfter === 36],
      ['no card moved', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged],
      ['no arrangement command', d.layoutCalls === 0]
    ]
  });
  await screenshot('s4-click-edge');
}

// ---------------------------------------------------------------------------
// S5 — change the relationship filter. Node membership must not react at all.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  const filterKind = edgeKinds.includes('CALLS') ? 'CALLS' : edgeKinds[0];
  await evaluate(`{const s=document.querySelector('select[aria-label="Relationship kind"]');s.value=${JSON.stringify(filterKind)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await pause(700);
  const after = await state();
  const d = delta(before, after);
  d.filterKind = filterKind;
  record('change-relationship-filter', before, after, d, {
    baseline: [
      ['edge set changed', d.edgeCountBefore !== d.edgeCountAfter],
      ['canvas destroyed and recreated by the topology key', d.canvasRecreated],
      ['the user camera is discarded even though only edges were filtered', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['edge set changed', d.edgeCountBefore !== d.edgeCountAfter],
      ['node membership unchanged', d.idOrderPreserved],
      ['no card moved', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged],
      ['canvas instance preserved', !d.canvasRecreated]
    ]
  });
  await screenshot('s5-filter-change');
  await evaluate(`{const s=document.querySelector('select[aria-label="Relationship kind"]');s.value='ALL';s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await pause(500);
}

// ---------------------------------------------------------------------------
// S6/S7 — add and then remove a package through the scope tree.
// ---------------------------------------------------------------------------
{
  // Start from an explicit subset so that adding a package is a real addition.
  await evaluate(`document.querySelector('.scope-toolbar button:nth-of-type(2)').click()`); // Clear
  await pause(300);
  // Deliberately start without `service`: its classes carry the highest degree, so adding it
  // later is the case where degree re-ranking can evict already displayed classes.
  for (const pkg of ['domain', 'util', 'external', 'repository']) {
    await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package>summary .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.${pkg}'));if(!label)throw Error('missing package ${pkg}');label.closest('summary').querySelector('.scope-checkbox').click();return true})()`);
    await pause(250);
  }
  const shown = await revealClasses(36);
  assert.equal(shown, 36, 'explicit four-package scope still reveals 36 classes');
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package>summary .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.service'));label.closest('summary').querySelector('.scope-checkbox').click();return true})()`);
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('add-package-to-scope', before, after, d, {
    baseline: [
      ['scope changed', d.scopeChanged],
      ['canvas destroyed and recreated', d.canvasRecreated],
      ['already displayed classes are evicted by degree re-ranking', d.dropped > 0],
      ['the displayed page does not grow, it is re-selected', d.countAfter === d.countBefore],
      ['surviving cards move', d.survivorsMoved > 0]
    ],
    acceptance: [
      ['scope changed', d.scopeChanged],
      ['no previously displayed class is dropped', d.dropped === 0],
      ['surviving cards keep their exact positions', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged],
      ['a bounded first batch of newly eligible classes is appended', d.added > 0],
      ['the displayed page grows rather than being re-selected', d.countAfter > d.countBefore]
    ]
  });
  await screenshot('s6-add-package');

  await resetCounters();
  const beforeRemove = await state();
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package>summary .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.service'));label.closest('summary').querySelector('.scope-checkbox').click();return true})()`);
  await pause(900);
  const afterRemove = await state();
  const dr = delta(beforeRemove, afterRemove);
  record('remove-package-from-scope', beforeRemove, afterRemove, dr, {
    baseline: [
      ['scope changed', dr.scopeChanged],
      ['canvas destroyed and recreated', dr.canvasRecreated],
      ['holes left by removal are refilled from the hidden queue', dr.added > 0],
      ['surviving cards move', dr.survivorsMoved > 0]
    ],
    acceptance: [
      ['scope changed', dr.scopeChanged],
      ['surviving cards keep their exact positions', dr.survivorsMoved === 0],
      ['no holes filled from the hidden queue', dr.added === 0],
      ['camera preserved', !dr.zoomChanged && !dr.panChanged]
    ]
  });
  await screenshot('s7-remove-package');
  await evaluate(`document.querySelector('.scope-toolbar button:first-child').click()`); // Select all
  await pause(400);
}

// ---------------------------------------------------------------------------
// S8 — open/close the details pane.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  const target = await evaluate(`${CY}.nodes()[3].id()`);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open');
  await probe(); await resetCounters();
  const before = await state();
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.inspector button')].find(b=>b.getAttribute('aria-label')==='Close inspector');if(!b)throw Error('no inspector close control');b.click();return true})()`);
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('close-details-pane', before, after, d, {
    baseline: [
      ['inspector closed', !after.inspectorOpen],
      ['clearing the inspection re-runs the unfocused arrangement', d.layoutCalls >= 1],
      ['cards move when details close', d.survivorsMoved > 0],
      ['camera is re-fitted', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['inspector closed', !after.inspectorOpen],
      ['no card moved', d.survivorsMoved === 0],
      ['membership preserved', d.idOrderPreserved],
      ['camera preserved', !d.zoomChanged && !d.panChanged]
    ]
  });
  await screenshot('s8-close-details');
}

// ---------------------------------------------------------------------------
// S9 — resize the viewport.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  await resetCounters();
  const before = await state();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('resize-pane', before, after, d, {
    baseline: [
      ['canvas resized', before.canvasBox.w !== after.canvasBox.w],
      ['resize observer refits the camera', d.fitCalls >= 1],
      ['camera moved without any user navigation', d.zoomChanged || d.panChanged]
    ],
    acceptance: [
      ['canvas resized', before.canvasBox.w !== after.canvasBox.w],
      ['membership preserved', d.idOrderPreserved],
      ['no card moved', d.survivorsMoved === 0],
      ['stored camera preserved', !d.zoomChanged && !d.panChanged]
    ]
  });
  await screenshot('s9-resize');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await pause(700);
}

// ---------------------------------------------------------------------------
// S10 — two spaced single clicks versus one real double-click.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  await resetCounters();
  const before = await state();
  const first = await evaluate(`${CY}.nodes()[2].id()`);
  await singleClick(await nodePoint(first));
  await pause(700);
  await probe();
  const second = await evaluate(`${CY}.nodes()[4].id()`);
  await singleClick(await nodePoint(second));
  await pause(700);
  const after = await state();
  const d = delta(before, after);
  record('two-spaced-single-clicks', before, after, d, {
    baseline: [
      ['two taps dispatched', d.taps >= 2],
      ['no double-click gesture', d.dbltaps === 0],
      ['level unchanged by single clicks', d.levelAfter === 'Classes'],
      ['single clicks still arranged the map', d.layoutCalls >= 1]
    ],
    acceptance: [
      ['two taps dispatched', d.taps >= 2],
      ['no double-click gesture', d.dbltaps === 0],
      ['zero arrangements', d.layoutCalls === 0],
      ['level unchanged', d.levelAfter === 'Classes']
    ]
  });

  // (a0) Control: a real double-click on empty canvas. Cytoscape's core `dbltap` fires here,
  // which proves the CDP gesture synthesis is sound and isolates the node cases below.
  await revealClasses(12);
  await resetCounters();
  const beforeEmpty = await state();
  const emptyPoint = await pointAt(`(()=>{const cy=${CY},w=cy.width(),h=cy.height();
    const occupied=cy.nodes().map(n=>n.renderedBoundingBox());
    for(let y=30;y<h-30;y+=20)for(let x=30;x<w-30;x+=20){
      if(!occupied.some(b=>x>b.x1-25&&x<b.x2+25&&y>b.y1-25&&y<b.y2+25))return{x,y};
    }
    return null})()`);
  assert.ok(emptyPoint, 'found an empty canvas point for the gesture control');
  await doubleClick(emptyPoint, 90);
  const afterEmpty = await state();
  const de = delta(beforeEmpty, afterEmpty);
  record('control-double-click-empty-canvas', beforeEmpty, afterEmpty, de, {
    baseline: [
      ['CDP synthesises a double-click Cytoscape recognises', de.anyDbltaps === 1],
      ['no node double-click', de.dbltaps === 0]
    ],
    acceptance: [
      ['CDP synthesises a double-click Cytoscape recognises', de.anyDbltaps === 1]
    ]
  });

  // (a) Human-paced double-click (90 ms) on the initial 12-class page. The limit reset is a
  // no-op here, so the canvas survives — but the first tap's automatic arrangement moves the
  // card out from under the pointer before the second press lands.
  const shown12 = await revealClasses(12);
  assert.equal(shown12, 12, 'page restored before the 12-class double-click case');
  await resetCounters();
  const before12 = await state();
  const target12 = await evaluate(`${CY}.nodes()[6].id()`);
  const point12 = await nodePoint(target12);
  await doubleClick(point12, 90);
  const after12 = await state();
  const d12 = delta(before12, after12);
  const settled12 = await nodePoint(target12);
  d12.targetLeftPointerBy = settled12 ? Math.round(Math.hypot(settled12.x - point12.x, settled12.y - point12.y)) : null;
  record('real-double-click-at-12-human-paced', before12, after12, d12, {
    baseline: [
      ['canvas instance survives the first tap', !d12.canvasRecreated],
      ['the first tap arranges the map', d12.layoutCalls >= 1],
      ['cards move under the pointer', d12.survivorsMoved > 0],
      ['the card travels away from the pointer', (d12.targetLeftPointerBy ?? 0) > 20],
      ['the second press misses the moved card, so no double-click gesture', d12.dbltaps === 0],
      ['no drill-down occurs', d12.levelAfter === 'Classes']
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', d12.dbltaps === 1],
      ['exactly one arrangement', d12.layoutCalls === 1],
      ['level unchanged', d12.levelAfter === d12.levelBefore],
      ['displayed count unchanged', d12.countAfter === d12.countBefore]
    ]
  });
  await screenshot('s10a-double-click-at-12');

  // (a2) Same page, minimal 15 ms gap: establishes whether the gesture is reachable at all
  // when the second press arrives before React re-renders and re-arranges the map.
  const shownFast = await revealClasses(12);
  assert.equal(shownFast, 12, 'page restored before the fast double-click case');
  await resetCounters();
  const beforeFast = await state();
  const targetFast = await evaluate(`${CY}.nodes()[6].id()`);
  await doubleClick(await nodePoint(targetFast), 15);
  const afterFast = await state();
  const df = delta(beforeFast, afterFast);
  record('real-double-click-at-12-fast', beforeFast, afterFast, df, {
    baseline: [
      ['the first tap still arranges the map before the second press', df.layoutCalls >= 1],
      ['cards move under the pointer', df.survivorsMoved > 0],
      ['no node double-click gesture even at minimal separation', df.dbltaps === 0],
      ['no drill-down occurs', df.levelAfter === 'Classes']
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', df.dbltaps === 1],
      ['exactly one arrangement', df.layoutCalls === 1],
      ['level unchanged', df.levelAfter === df.levelBefore]
    ]
  });

  // (b) On an expanded page the first tap resets the limit, which changes the topology key and
  // destroys the Cytoscape instance. The second tap lands on a new core, so `dbltap` never fires.
  const shown36 = await revealClasses(36);
  assert.equal(shown36, 36, 'page restored before the 36-class double-click case');
  await resetCounters();
  const beforeDouble = await state();
  const target = await evaluate(`${CY}.nodes()[6].id()`);
  await doubleClick(await nodePoint(target));
  const afterDouble = await state();
  const dd = delta(beforeDouble, afterDouble);
  record('real-double-click-at-36', beforeDouble, afterDouble, dd, {
    baseline: [
      ['the first tap destroys the canvas', dd.canvasRecreated],
      ['the double-click gesture is lost', dd.dbltaps === 0],
      ['level does not change, so the drill-down is lost too', dd.levelAfter === 'Classes'],
      ['the page still collapses to 12', dd.countAfter === 12]
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', dd.dbltaps === 1],
      ['exactly one arrangement', dd.layoutCalls === 1],
      ['level unchanged', dd.levelAfter === dd.levelBefore],
      ['displayed count unchanged', dd.countAfter === dd.countBefore],
      ['canvas instance preserved', !dd.canvasRecreated]
    ]
  });
  await screenshot('s10b-double-click-at-36');
}

// ---------------------------------------------------------------------------
// S11 — narrow layout, for the details-pane return case.
// ---------------------------------------------------------------------------
{
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  await screenshot('s11-narrow-map');
  const narrowOverflow = await evaluate('document.documentElement.scrollWidth>innerWidth');
  scenarios.push({ name: 'narrow-layout', delta: { horizontalOverflow: narrowOverflow }, checks: [] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await pause(600);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const report = {
  mode, snapshot, workspace: ws.id,
  fixture: { path: fixture, typeCount, packageCount, edgeKinds, displayedResolutions: resolutions, unresolvedRelationships },
  browserErrors: errors,
  scenarios, screenshots, failures
};
await fs.writeFile(`${output}/stable-graph-report.json`, JSON.stringify(report, null, 2));
socket.close();
assert.deepEqual(errors, [], `browser runtime errors: ${errors.join(' | ')}`);
if (failures.length) {
  console.error(`\n${mode} expectations not met:\n - ` + failures.join('\n - '));
  process.exit(1);
}
console.log(`\nPASS (${mode}): ${scenarios.length} scenarios, ${screenshots.length} screenshots in ${output}`);
