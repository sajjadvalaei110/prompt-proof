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
  if(!window.__probe)window.__probe={instances:0,layouts:0,fits:0,centers:0,taps:0,dbltaps:0,anyDbltaps:0,arranges:0};
  if(!cy.__probeId){
    cy.__probeId=++window.__probe.instances;
    const L=cy.layout.bind(cy),F=cy.fit.bind(cy),C=cy.center.bind(cy);
    cy.layout=(...a)=>{window.__probe.layouts++;return L(...a);};
    cy.fit=(...a)=>{window.__probe.fits++;return F(...a);};
    cy.center=(...a)=>{window.__probe.centers++;return C(...a);};
    cy.on('tap','node',()=>window.__probe.taps++);
    cy.on('dbltap','node',()=>window.__probe.dbltaps++);
    cy.on('dbltap',()=>window.__probe.anyDbltaps++);
    // Step 5: the app emits this custom Cytoscape event (ordinary use of the library's own pub/sub,
    // the same mechanism 'pan'/'zoom'/'dbltap' already use -- not a debug object) exactly once per
    // atomic ARRANGE_AROUND_RESOURCE application, distinct from a drag or an ordinary admission.
    cy.on('arranged',()=>window.__probe.arranges++);
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
    // Keyed by each row's stable qualified name (its .scope-label title), not DOM order/position: a
    // collapsed branch's rows are not in the DOM at all (unlike the native <details> this tree used
    // to render, whose rows always existed there regardless of open state), so inspecting a search
    // result can reveal(open) an unrelated branch and change which checkboxes exist in the page --
    // a tree-visibility side effect, not a scope change. delta() below only compares rows present in
    // both snapshots, so a newly-revealed or newly-hidden row is ignored rather than read as a change.
    scopeChecks:Object.fromEntries([...document.querySelectorAll('.scope-row-class, .scope-row-package-row')].map(row=>{
      const label=row.querySelector('.scope-label'), cb=row.querySelector('.scope-checkbox');
      return [label.getAttribute('title'), cb.checked?'c':cb.indeterminate?'i':'u'];
    })),
    inspectorOpen:!!document.querySelector('.inspector-top'),
    inspectorSubject:(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90),
    canvasBox:(()=>{const b=document.querySelector('.graph-canvas').getBoundingClientRect();return{w:Math.round(b.width),h:Math.round(b.height)};})()
  };
})()`;

const probe = () => evaluate(PROBE);
async function state() { await probe(); return evaluate(STATE); }
const resetCounters = () => evaluate(`(()=>{const p=window.__probe;p.layouts=0;p.fits=0;p.centers=0;p.taps=0;p.dbltaps=0;p.anyDbltaps=0;p.arranges=0;return true})()`);

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
    arrangeCalls: after.counters.arranges - before.counters.arranges,
    zoomChanged: before.zoom !== after.zoom,
    panChanged: before.pan.x !== after.pan.x || before.pan.y !== after.pan.y,
    edgeCountBefore: before.edgeIds.length, edgeCountAfter: after.edgeIds.length,
    levelBefore: before.level, levelAfter: after.level,
    showMoreBefore: before.showMore, showMoreAfter: after.showMore,
    scopeChanged: Object.keys(before.scopeChecks).some(k => Object.hasOwn(after.scopeChecks, k) && after.scopeChecks[k] !== before.scopeChecks[k])
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

/**
 * Step 3 changed what "a node to click" means: the camera is no longer auto-fit to whatever is
 * currently displayed (that was exactly the instability under test), so `cy.nodes()[N]` can now be
 * a card well outside the visible canvas -- e.g. appended below the initial fit, or past whatever
 * panAndZoom() last framed. `renderedPosition()`/`renderedMidpoint()` are canvas-relative
 * coordinates regardless of visibility, so a synthesized click at an off-screen point lands on
 * whatever real DOM happens to sit there (the minimap, zoom controls, or nothing), producing a
 * confusing failure rather than a real pointer test. Pick from cards that are actually visible.
 */
async function pickVisibleNodeId(preferredIndex = 0) {
  return evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    const within=cy.nodes().filter(n=>{const b=n.renderedBoundingBox();return b.x1>=4&&b.y1>=4&&b.x2<=w-4&&b.y2<=h-4;});
    const pool=within.length?within:cy.nodes();
    const idx=Math.min(${preferredIndex},pool.length-1);
    return idx>=0?pool[idx].id():null;
  })()`);
}
async function visibleEdgeCandidates(limit = 12) {
  return evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    const within=cy.edges().filter(e=>{const p=e.renderedMidpoint();return p.x>=4&&p.y>=4&&p.x<=w-4&&p.y<=h-4;});
    const pool=within.length?within:cy.edges();
    return pool.slice(0,${limit}).map(e=>e.id());
  })()`);
}

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
/** Fresh page load. Re-selecting an already-active level is now a genuine no-op (Step 2), so a
 * level's displayed page persists once grown; the only reliable way back to a small starting page
 * for a scenario that needs one is a real reload, not clicking the same level again. */
async function reload() {
  await cdp('Page.navigate', { url: `${base}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy`), 'canvas mount (reload)');
  await probe();
}
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
  const target = await pickVisibleNodeId(5);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  record('click-class-card-at-12', before, after, d, {
    // Step 3 fixed selection-triggered arrangement/refit: a single click no longer calls
    // cy.layout()/cy.fit(), moves a survivor, or touches the camera.
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['canvas instance survives (no topology change)', !d.canvasRecreated],
      ['no arrangement command (Step 3 fixed)', d.layoutCalls === 0],
      ['no card moves (Step 3 fixed)', d.survivorsMoved === 0],
      ['camera is preserved (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
  const target = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  record('reveal-36-then-click-class', before, after, d, {
    // Step 2 fixed the membership/canvas-identity half of this regression: inspection no longer
    // resets the display limit, and a stable topology means the canvas is no longer torn down.
    // Step 3 fixed the remaining position/camera half: the click no longer moves any of the 36
    // cards or discards the user's pan/zoom.
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['still 36 displayed (Step 2 fixed)', d.countAfter === 36],
      ['canvas instance survives (Step 2 fixed)', !d.canvasRecreated],
      ['no card moves (Step 3 fixed)', d.survivorsMoved === 0],
      ['the user camera is preserved (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
  const target = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  record('click-package-card', before, after, d, {
    baseline: [
      ['inspector opened', after.inspectorOpen],
      ['package count unchanged (no limit at PACKAGE level)', d.countBefore === d.countAfter],
      ['no arrangement command (Step 3 fixed)', d.layoutCalls === 0],
      ['no card moves (Step 3 fixed)', d.survivorsMoved === 0]
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
  const seed = await pickVisibleNodeId(8);
  await singleClick(await nodePoint(seed));
  await pause(400);
  await probe();
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  const candidates = await visibleEdgeCandidates(12);
  let clicked = null;
  for (const id of candidates) {
    const point = await edgePoint(id);
    if (!point) continue;
    await singleClick(point);
    if (await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`)) { clicked = id; break; }
  }
  assert.ok(clicked, 'a real pointer click landed on an edge');
  // The inspected line's own endpoints must be emphasized (.neighbor), never dimmed with the rest of
  // the map. closedNeighborhood() on an edge yields only the edge, so this regressed silently once:
  // the endpoints landed in the muted difference instead. Assert the classes, not just the inspector.
  // The canvas runs with autounselectify:true, so Cytoscape's own selection never fires and
  // ':selected' matches nothing; inspection is carried by the .inspected class instead.
  // Anchor on the edge the canvas actually has selected, not on `clicked`: bezier lines overlap, so a
  // click aimed at one candidate can legitimately land on another, and the loop above only checks
  // that *a* relationship opened.
  const endpointEmphasis = await evaluate(`(()=>{const sel=${CY}.edges('.inspected');if(sel.length!==1)return {selectedEdges:sel.length};const e=sel[0];const ns=e.connectedNodes();return {selectedEdges:1,id:e.id(),count:ns.length,neighbor:ns.every(n=>n.hasClass('neighbor')),muted:ns.some(n=>n.hasClass('muted')),classes:ns.map(n=>({id:n.id(),neighbor:n.hasClass('neighbor'),muted:n.hasClass('muted')}))};})()`);
  assert.equal(endpointEmphasis.selectedEdges, 1, `inspecting a relationship selects exactly one line on the canvas (saw ${endpointEmphasis.selectedEdges})`);
  assert.equal(endpointEmphasis.count, 2, 'the inspected line has both endpoints on the map');
  assert.ok(endpointEmphasis.neighbor, 'both endpoint cards are emphasized as neighbors: ' + JSON.stringify(endpointEmphasis.classes));
  assert.ok(!endpointEmphasis.muted, 'no endpoint card is dimmed as unrelated: ' + JSON.stringify(endpointEmphasis.classes));
  const after = await state();
  const d = delta(before, after);
  d.edgeId = clicked;
  d.endpointEmphasis = endpointEmphasis;
  record('click-edge', before, after, d, {
    // Step 3 removed the layout/fit call from edge selection entirely, so the aggregate-edge-ID
    // focus mismatch that used to fall back to the alphabetical grid no longer matters: nothing is
    // rearranged on any selection, node or edge.
    baseline: [
      ['relationship inspector opened', after.inspectorSubject.includes('Relationship')],
      ['edge selection does not reset the display limit', d.countAfter === d.countBefore],
      ['no arrangement command (Step 3 fixed)', d.layoutCalls === 0],
      ['no card moves, since selection never arranges the map (Step 3 fixed)', d.survivorsMoved === 0],
      ['the user camera is preserved (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
// S4b — inspect an unresolved relationship from the inspector's "Depends on" list.
// Regression guard for a defect found in review: the aggregate-edge-only lookup
// used for an inspected edge initially missed unresolved relationships (which
// never reach projectDisplayed's edge aggregation, since a null target has
// nothing to aggregate onto), collapsing the inspector back to its idle state.
// ---------------------------------------------------------------------------
{
  await revealClasses(12);
  const typeInto = (id, text) => evaluate(`(()=>{
    const input = document.getElementById(${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // ExternalPaymentGateway extends GatewayBase, an external supertype the source-only parser
  // cannot resolve — an inspectable unresolved EXTENDS relationship by fixture design.
  await typeInto('global-search', 'ExternalPaymentGateway');
  await pause(300);
  await until(() => evaluate(`!![...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('ExternalPaymentGateway'))`), 'search result for ExternalPaymentGateway');
  await evaluate(`[...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('ExternalPaymentGateway')).click()`);
  await until(() => evaluate(`!!document.querySelector('.unresolved-row')`), 'inspector shows an unresolved relationship row');
  const before = await state();
  await evaluate(`[...document.querySelectorAll('.unresolved-row button')].find(b=>b.textContent==='Inspect relationship').click()`);
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  const inspectorIdle = await evaluate(`!!document.querySelector('.inspector.idle')`);
  const relationshipShown = await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`);
  const checks = [
    ['inspector stays open, not idle', !inspectorIdle],
    ['relationship content is shown', relationshipShown],
    ['displayed page count unaffected', d.countAfter === d.countBefore]
  ];
  record('inspect-unresolved-relationship', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s4b-inspect-unresolved-relationship');
  await typeInto('global-search', ''); // clear so later scenarios are not affected by leftover results
  await pause(200);
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
    // Step 3 replaced destroy/recreate-on-topology-change with incremental ID-based reconciliation,
    // so a filter change (which only changes the edge set) no longer tears down the canvas or
    // discards the camera.
    baseline: [
      ['edge set changed', d.edgeCountBefore !== d.edgeCountAfter],
      ['canvas instance preserved (Step 3 fixed)', !d.canvasRecreated],
      ['the user camera is preserved (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
// S5b — inspect an edge, then change the filter to exclude its kind. Step 3's
// baseline recorded this as the inspector correctly going idle ("nothing
// selected"); that was actually the F3 defect this step fixes: the inspected
// relationship must survive with a "not shown" notice instead of collapsing,
// resolved from its retained semantic identity independently of the currently
// filtered `projected.edges` (Step 4, Appendix F3).
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  // S4b (immediately before this scenario) leaves an unresolved relationship inspected, and
  // nothing in between clears selection (there is no background-tap-deselect handler). Force the
  // pre-state to a NODE first so "Relationship" appearing in the inspector below is a true signal
  // that OUR click landed on an edge, not a stale artifact of the previous scenario.
  await singleClick(await nodePoint(await pickVisibleNodeId(0)));
  await pause(300);
  await resetCounters();
  const candidates = await visibleEdgeCandidates(12);
  // One line now carries every kind between its ordered pair (kindCounts), so filtering to any kind
  // the line contains keeps it drawn (thinner). This case needs a kind the clicked line does NOT
  // contain, so only a line with such a kind available is an eligible candidate.
  let clickedId = null, clickedKind = null, otherKind = null;
  for (const id of candidates) {
    const lineKinds = await evaluate(`Object.keys(${CY}.getElementById(${JSON.stringify(id)}).data('kindCounts')||{})`);
    const absent = edgeKinds.find(k => !lineKinds.includes(k));
    if (!absent) continue;
    const point = await edgePoint(id);
    if (!point) continue;
    await singleClick(point);
    if (await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`)) {
      // Overlapping bezier lines mean the click can land on a neighbour of the intended candidate,
      // so take the line the canvas actually selected as the subject and re-derive its kinds from
      // that. Only accept it if it still has an absent kind to filter to; otherwise keep looking.
      const landed = await evaluate(`(()=>{const sel=${CY}.edges('.inspected');if(sel.length!==1)return null;const e=sel[0];return {id:e.id(),kind:e.data('kind'),kinds:Object.keys(e.data('kindCounts')||{})};})()`);
      if (!landed) continue;
      const absentOnLanded = edgeKinds.find(k => !landed.kinds.includes(k));
      if (!absentOnLanded) continue;
      clickedId = landed.id; clickedKind = landed.kind; otherKind = absentOnLanded;
      break;
    }
  }
  assert.ok(clickedId, 'a real pointer click landed on an edge (with at least one kind it does not contain) for the filter-survival case');
  const before = await state();
  await evaluate(`{const s=document.querySelector('select[aria-label="Relationship kind"]');s.value=${JSON.stringify(otherKind)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await pause(700);
  const inspectorSubject = await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim()`);
  const notice = await evaluate(`(document.querySelector('.inspector .notice')?.textContent||'')`);
  const inspectorIdle = await evaluate(`!!document.querySelector('.inspector.idle')`);
  const after = await state();
  const d = delta(before, after);
  d.clickedKind = clickedKind; d.filteredToKind = otherKind; d.notice = notice;
  const checks = [
    ['inspector stays open, not idle', !inspectorIdle],
    ['relationship content is still shown', inspectorSubject.includes('Relationship')],
    ['a "not shown with the current filter" notice appears', notice.includes('current relationship filter')],
    ['node membership unaffected by a filter change', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('inspect-edge-survives-filter-change', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s5b-edge-survives-filter');

  // Companion case, the other half of the same rule: filtering to a kind the inspected line DOES
  // contain must keep the line drawn (thinner, fewer occurrences) and must NOT show the
  // filtered-out notice. Without this, a regression that hid contained lines -- or raised a
  // spurious notice -- would pass, because the case above only ever filters to an absent kind.
  const containedBefore = await state();
  await evaluate(`{const s=document.querySelector('select[aria-label="Relationship kind"]');s.value=${JSON.stringify(clickedKind)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await pause(700);
  const contained = await evaluate(`(()=>{const e=${CY}.getElementById(${JSON.stringify(clickedId)});return {drawn:e.length>0,occurrences:e.length?e.data('occurrenceCount'):0,width:e.length?parseFloat(e.style('width')):0,selected:e.length?e.hasClass('inspected'):false,notice:document.querySelector('.inspector .notice')?.textContent||'',idle:!!document.querySelector('.inspector.idle'),subject:(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim()};})()`);
  const containedAfter = await state();
  const cd = delta(containedBefore, containedAfter);
  cd.filteredToKind = clickedKind; cd.line = contained;
  const containedChecks = [
    ['the line keeps its identity and stays drawn', contained.drawn],
    ['the same line is still the selected one', contained.selected],
    ['it still carries at least one occurrence of the kind filtered to', contained.occurrences >= 1],
    ['no filtered-out notice, because the line is still shown', !contained.notice.includes('current relationship filter')],
    ['inspector stays open, not idle', !contained.idle && contained.subject.includes('Relationship')],
    ['no card moved', cd.survivorsMoved === 0],
    ['camera preserved', !cd.zoomChanged && !cd.panChanged]
  ];
  record('inspect-edge-survives-filter-to-contained-kind', containedBefore, containedAfter, cd, { baseline: containedChecks, acceptance: containedChecks });
  await screenshot('s5c-edge-survives-filter-to-contained-kind');

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
    await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.${pkg}'));if(!label)throw Error('missing package ${pkg}');label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
    await pause(250);
  }
  const shown = await revealClasses(36);
  // Each package checkbox is now its own scope edit that appends its own bounded batch (Step 2
  // Appendix A2), so checking 4 packages one at a time can already exceed 36 before Show more is
  // ever clicked; the exact count is no longer load-bearing here, only that a substantial,
  // `service`-excluding page exists before the addition below.
  assert.ok(shown >= 12, `expected a substantial class page before the add-package test, saw ${shown}`);
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.service'));label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('add-package-to-scope', before, after, d, {
    // Step 2 fixed the membership half: survivors are never evicted and the page grows
    // append-only. Step 3 fixed the rest: the canvas is reconciled by ID instead of torn down,
    // and the new batch is placed below the existing cards without moving any survivor.
    baseline: [
      ['scope changed', d.scopeChanged],
      ['canvas instance preserved (Step 3 fixed)', !d.canvasRecreated],
      ['no previously displayed class is evicted (Step 2 fixed)', d.dropped === 0],
      ['the displayed page grows rather than being re-selected (Step 2 fixed)', d.countAfter > d.countBefore],
      ['no survivor moves; new cards are appended below (Step 3 fixed)', d.survivorsMoved === 0]
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
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.service'));label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(900);
  const afterRemove = await state();
  const dr = delta(beforeRemove, afterRemove);
  record('remove-package-from-scope', beforeRemove, afterRemove, dr, {
    // Step 2 fixed the refill-from-hidden-queue defect: removal only drops now-ineligible IDs.
    // Step 3 fixed the rest: the canvas is reconciled by ID (removed nodes/edges just drop out)
    // instead of torn down, and no surviving card is repositioned.
    baseline: [
      ['scope changed', dr.scopeChanged],
      ['canvas instance preserved (Step 3 fixed)', !dr.canvasRecreated],
      ['no holes filled from the hidden queue (Step 2 fixed)', dr.added === 0],
      ['no survivor moves (Step 3 fixed)', dr.survivorsMoved === 0]
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
  const target = await pickVisibleNodeId(3);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open');
  await probe(); await resetCounters();
  const before = await state();
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.inspector button')].find(b=>b.getAttribute('aria-label')==='Close inspector');if(!b)throw Error('no inspector close control');b.click();return true})()`);
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('close-details-pane', before, after, d, {
    // Step 3 removed the layout/fit call from the clear-selection path (closing the inspector
    // clears selectedId, which used to re-run the unfocused arrangement).
    baseline: [
      ['inspector closed', !after.inspectorOpen],
      ['no arrangement command (Step 3 fixed)', d.layoutCalls === 0],
      ['no card moves when details close (Step 3 fixed)', d.survivorsMoved === 0],
      ['camera is preserved (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
    // Step 3's ResizeObserver calls cy.resize() only (renderer dimensions stay in sync); it no
    // longer calls cy.fit(), so a pane resize cannot move the camera on its own.
    baseline: [
      ['canvas resized', before.canvasBox.w !== after.canvasBox.w],
      ['resize observer no longer refits the camera (Step 3 fixed)', d.fitCalls === 0],
      ['camera unchanged by a resize alone (Step 3 fixed)', !d.zoomChanged && !d.panChanged]
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
// S9b — manual drag: only the dragged card moves, the camera is untouched, and
// the new position survives leaving the level and returning (Appendix A3.8:
// "Preserve manual drag positions on drag completion"). A real CDP pointer drag,
// not a synthetic position write, since a pure reducer test can prove NODE_MOVED
// preserves state but cannot prove the gesture is actually wired to it.
// ---------------------------------------------------------------------------
{
  await revealClasses(12);
  await resetCounters();
  const before = await state();
  const draggedId = await pickVisibleNodeId(4);
  const start = await nodePoint(draggedId);
  const dx = 120, dy = 80;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', buttons: 0 });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 6; step++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (dx * step) / 6, y: start.y + (dy * step) / 6, button: 'left', buttons: 1 });
    await pause(20);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + dx, y: start.y + dy, button: 'left', buttons: 0, clickCount: 1 });
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  d.draggedId = draggedId;
  const dragChecks = [
    ['exactly the dragged card moved', d.survivorsMoved === 1],
    ['the dragged card actually moved a meaningful distance', d.maxMoveModelUnits > 10],
    ['camera untouched by a node drag', !d.zoomChanged && !d.panChanged],
    ['no arrangement command', d.layoutCalls === 0]
  ];
  record('manual-drag-persists', before, after, d, { baseline: dragChecks, acceptance: dragChecks });
  await screenshot('s9b-manual-drag');

  const draggedPosition = after.positions[draggedId];
  await clickLevel('Packages');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 6, 'package level (drag persistence check)');
  await pause(300);
  await clickLevel('Classes');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) > 1, 'class level restored (drag persistence check)');
  await pause(300);
  const restored = await state();
  const restoredPosition = restored.positions[draggedId];
  const persistCheck = [
    ['the dragged position survives a level switch away and back', Boolean(restoredPosition)
      && Math.abs(restoredPosition.x - draggedPosition.x) < 0.5 && Math.abs(restoredPosition.y - draggedPosition.y) < 0.5]
  ];
  record('manual-drag-persists-across-level-switch', after, restored, delta(after, restored), { baseline: persistCheck, acceptance: persistCheck });
}

// ---------------------------------------------------------------------------
// S10 — two spaced single clicks versus one real double-click.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  await resetCounters();
  const before = await state();
  const first = await pickVisibleNodeId(0);
  await singleClick(await nodePoint(first));
  await pause(700);
  await probe();
  const second = await pickVisibleNodeId(1);
  await singleClick(await nodePoint(second));
  await pause(700);
  const after = await state();
  const d = delta(before, after);
  record('two-spaced-single-clicks', before, after, d, {
    baseline: [
      ['two taps dispatched', d.taps >= 2],
      ['no double-click gesture', d.dbltaps === 0],
      ['level unchanged by single clicks', d.levelAfter === 'Classes'],
      ['single clicks no longer arrange the map (Step 3 fixed)', d.layoutCalls === 0],
      ['single clicks cause zero focused arrangements (Step 5 fixed)', d.arrangeCalls === 0]
    ],
    acceptance: [
      ['two taps dispatched', d.taps >= 2],
      ['no double-click gesture', d.dbltaps === 0],
      ['zero arrangements', d.layoutCalls === 0],
      ['two spaced single clicks cause zero focused arrangements', d.arrangeCalls === 0],
      ['level unchanged', d.levelAfter === 'Classes']
    ]
  });

  // (a0) Control: a real double-click on empty canvas. Cytoscape's core `dbltap` fires here,
  // which proves the CDP gesture synthesis is sound and isolates the node cases below. A previously
  // grown page now persists (Step 2), so start from a fresh reload rather than relying on
  // re-clicking the active level to shrink it back down.
  await reload();
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

  // (a) Human-paced double-click (90 ms) on the initial 12-class page. Step 3 fixed the
  // position-shift-away defect (the first tap no longer arranges/moves the card), so the second
  // press now reliably lands and the gesture reaches Cytoscape. Step 4 disconnected the node
  // dbltap handler from explore() entirely (Step 4 point 1: "graph double-click must not remain
  // the drill-down command"). Step 5 gives it its own dedicated ARRANGE_AROUND_RESOURCE command
  // (Appendix B/Story 2): the first tap still only inspects (idempotently -- a repeat inspect of
  // the same subject is a no-op), and `dbltap` now drives exactly one focused arrangement.
  await reload();
  const shown12 = await revealClasses(12);
  assert.equal(shown12, 12, 'page restored before the 12-class double-click case');
  await resetCounters();
  const before12 = await state();
  const target12 = await pickVisibleNodeId(6);
  const point12 = await nodePoint(target12);
  await screenshot('s10a-double-click-at-12-before');
  await doubleClick(point12, 90);
  const after12 = await state();
  const d12 = delta(before12, after12);
  const settled12 = await nodePoint(target12);
  d12.targetLeftPointerBy = settled12 ? Math.round(Math.hypot(settled12.x - point12.x, settled12.y - point12.y)) : null;
  record('real-double-click-at-12-human-paced', before12, after12, d12, {
    baseline: [
      ['canvas instance survives the first tap', !d12.canvasRecreated],
      ['the first tap no longer arranges the map by itself (Step 3 fixed)', d12.layoutCalls === 0],
      ['the second press reliably reaches the card and the gesture fires (Step 3 fixed the position-shift-away defect)', d12.dbltaps === 1],
      ['double-click no longer drills into Methods -- Step 4 disconnected it from explore()', d12.levelAfter === d12.levelBefore],
      ['double-click now drives exactly one focused arrangement (Step 5)', d12.arrangeCalls === 1],
      ['the focus card is anchored at its prior model coordinate (screen anchor stays fixed)', d12.targetLeftPointerBy !== null && d12.targetLeftPointerBy <= 1]
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', d12.dbltaps === 1],
      ['exactly one arrangement', d12.arrangeCalls === 1],
      ['no whole-map layout call (out of scope for this step)', d12.layoutCalls === 0],
      ['level unchanged', d12.levelAfter === d12.levelBefore],
      ['displayed count unchanged', d12.countAfter === d12.countBefore]
    ]
  });
  await screenshot('s10a-double-click-at-12');

  // (a2) Same page, minimal 15 ms gap: establishes whether the gesture is reachable at all
  // when the second press arrives before React re-renders.
  await reload();
  const shownFast = await revealClasses(12);
  assert.equal(shownFast, 12, 'page restored before the fast double-click case');
  await resetCounters();
  const beforeFast = await state();
  const targetFast = await pickVisibleNodeId(6);
  await doubleClick(await nodePoint(targetFast), 15);
  const afterFast = await state();
  const df = delta(beforeFast, afterFast);
  record('real-double-click-at-12-fast', beforeFast, afterFast, df, {
    baseline: [
      ['the first tap no longer arranges the map by itself (Step 3 fixed)', df.layoutCalls === 0],
      ['the gesture reaches Cytoscape even at minimal separation (Step 3 fixed)', df.dbltaps === 1],
      ['double-click no longer drills into Methods (Step 4)', df.levelAfter === df.levelBefore],
      ['double-click drives exactly one focused arrangement even at minimal separation (Step 5)', df.arrangeCalls === 1]
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', df.dbltaps === 1],
      ['exactly one arrangement', df.arrangeCalls === 1],
      ['level unchanged', df.levelAfter === df.levelBefore]
    ]
  });

  // (b) On an expanded page: Step 2 fixed the membership collapse and canvas survival across the
  // first tap; Step 3 fixed the position-shift defect that used to move the card out from under
  // the second press. Together they made the gesture reach the node reliably. Step 5 wires it to
  // the dedicated arrangement command.
  await reload();
  const shown36 = await revealClasses(36);
  assert.equal(shown36, 36, 'page restored before the 36-class double-click case');
  await resetCounters();
  const beforeDouble = await state();
  const target = await pickVisibleNodeId(6);
  await screenshot('s10b-double-click-at-36-before');
  await doubleClick(await nodePoint(target));
  const afterDouble = await state();
  const dd = delta(beforeDouble, afterDouble);
  record('real-double-click-at-36', beforeDouble, afterDouble, dd, {
    baseline: [
      ['canvas instance survives the first tap (Step 2 fixed)', !dd.canvasRecreated],
      ['the double-click gesture reaches the node (Step 3 fixed the position-shift-away defect)', dd.dbltaps === 1],
      ['no drill-down to Methods -- Step 4 disconnected double-click from explore()', dd.levelAfter === dd.levelBefore],
      ['the same 36 classes remain displayed', dd.countAfter === 36],
      ['double-click drives exactly one focused arrangement at 36 displayed classes too (Step 5)', dd.arrangeCalls === 1]
    ],
    acceptance: [
      ['double-click gesture reaches Cytoscape', dd.dbltaps === 1],
      ['exactly one arrangement', dd.arrangeCalls === 1],
      ['level unchanged', dd.levelAfter === dd.levelBefore],
      ['displayed count unchanged', dd.countAfter === dd.countBefore],
      ['canvas instance preserved', !dd.canvasRecreated]
    ]
  });
  await screenshot('s10b-double-click-at-36');

  // (c) A second, immediately following double-click on a DIFFERENT card still causes exactly one
  // more arrangement (the command is deliberate and re-runnable), and must not touch scope/level/
  // page/zoom either. A repeat double-click on the SAME already-arranged focus is deliberately not
  // asserted here: the algorithm is deterministic and anchored to that focus's own (unchanged)
  // position, so re-running it recomputes the identical layout and correctly moves nothing -- that
  // is Appendix B determinism working as intended, not a missed arrangement.
  await resetCounters();
  const secondTarget = await evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    const within=cy.nodes().filter(n=>{const b=n.renderedBoundingBox();return b.x1>=4&&b.y1>=4&&b.x2<=w-4&&b.y2<=h-4;});
    const pool=(within.length?within:cy.nodes()).filter(n=>n.id()!==${JSON.stringify(target)});
    return pool.length?pool[0].id():null;
  })()`);
  assert.ok(secondTarget, 'a second, different visible card exists for the repeat double-click case');
  const beforeRepeat = await state();
  await doubleClick(await nodePoint(secondTarget));
  const afterRepeat = await state();
  const dr = delta(beforeRepeat, afterRepeat);
  record('real-double-click-second-different-card', beforeRepeat, afterRepeat, dr, {
    baseline: [
      ['a double-click on a different card also drives exactly one arrangement', dr.arrangeCalls === 1],
      ['zoom untouched', !dr.zoomChanged],
      ['pan untouched', !dr.panChanged]
    ],
    acceptance: [
      ['exactly one arrangement', dr.arrangeCalls === 1],
      ['level/page unchanged', dr.levelAfter === dr.levelBefore && dr.countAfter === dr.countBefore],
      ['zoom untouched', !dr.zoomChanged],
      ['pan untouched', !dr.panChanged]
    ]
  });
}

// ---------------------------------------------------------------------------
// S10d — the inspector's "Arrange around this resource" action: the keyboard/touch-accessible
// equivalent of canvas double-click (Appendix B / H3). Also verifies its disabled state and
// tooltip when the inspected subject is in scope but not on the current displayed page.
// ---------------------------------------------------------------------------
{
  await reload();
  const shown12b = await revealClasses(12);
  assert.equal(shown12b, 12, 'page restored before the inspector-action case');
  const displayedIds10d = await evaluate(`${CY}.nodes().map(n=>n.id())`);
  const displayedNode = graph.nodes.find(n => displayedIds10d.includes(n.id) && isType(n));
  assert.ok(displayedNode, 'a displayed class exists to inspect');
  await singleClick(await nodePoint(displayedNode.id));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open on a displayed class');
  const enabled = await evaluate(`!document.querySelector('.arrange-action')?.disabled`);
  assert.ok(enabled, 'Arrange around this resource is enabled for a displayed subject');
  await resetCounters();
  const before10d = await state();
  await screenshot('s10d-inspector-arrange-action-before');
  await evaluate(`document.querySelector('.arrange-action').click()`);
  await pause(300);
  const after10d = await state();
  const d10d = delta(before10d, after10d);
  const checks10d = [
    ['no double-click gesture involved -- this is the keyboard/touch equivalent', d10d.dbltaps === 0],
    ['exactly one arrangement from the inspector action', d10d.arrangeCalls === 1],
    ['level/page unchanged', d10d.levelAfter === d10d.levelBefore && d10d.countAfter === d10d.countBefore],
    ['scope unaffected', !d10d.scopeChanged],
    ['zoom untouched', !d10d.zoomChanged],
    ['pan untouched', !d10d.panChanged]
  ];
  record('inspector-arrange-around-resource', before10d, after10d, d10d, { baseline: checks10d, acceptance: checks10d });
  await screenshot('s10d-inspector-arrange-action');

  // Disabled state: inspect a class that exists in scope but is not on the current displayed page.
  const pending10d = graph.nodes.find(n => isType(n) && !displayedIds10d.includes(n.id));
  if (pending10d) {
    const typeIntoSearch = text => evaluate(`(()=>{
      const input = document.getElementById('global-search');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await typeIntoSearch(pending10d.simpleName);
    await pause(300);
    await evaluate(`[...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes(${JSON.stringify(pending10d.simpleName)}))?.click()`);
    await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open on a not-displayed class');
    const disabled = await evaluate(`!!document.querySelector('.arrange-action')?.disabled`);
    const title = await evaluate(`document.querySelector('.arrange-action')?.title`);
    const notDisplayedChecks = [
      ['disabled for a not-currently-displayed subject', disabled],
      ['tooltip explains why', title === 'Resource is not in current map view']
    ];
    record('inspector-arrange-disabled-when-not-displayed', after10d, after10d, {}, { baseline: notDisplayedChecks, acceptance: notDisplayedChecks });
    await typeIntoSearch('');
  }
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
// S12 — A-to-B-to-C traversal and Back-to-Back through the REAL inspector
// relationship lists (not canvas clicks). Story 6's central acceptance
// journey: following a class's "Depends on" list twice, then returning
// twice, must restore each prior subject exactly, without ever invoking
// layout or moving a card/camera.
// ---------------------------------------------------------------------------
{
  await revealClasses(36);
  await panAndZoom();
  await probe();
  const typeInto = (id, text) => evaluate(`(()=>{
    const input = document.getElementById(${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // Fixture design (test-fixtures/stable-graph-fixture/README.md): a visible
  // OrderController -> OrderService -> PricingService dependency chain.
  await typeInto('global-search', 'OrderController');
  await pause(300);
  await until(() => evaluate(`!![...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('OrderController'))`), 'search result for OrderController');
  await evaluate(`[...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('OrderController')).click()`);
  await pause(400);
  const subjectOf = () => evaluate(`(document.querySelector('.subject-heading h2')?.textContent||'')`);
  const followDependsOn = () => evaluate(`(()=>{
    const sections=[...document.querySelectorAll('.inspector section')];
    const target=sections.find(s=>s.querySelector('h3')?.textContent.startsWith('Depends on'));
    const row=target?.querySelectorAll('.related-row')[0];
    if(!row) return false;
    row.click();
    return true;
  })()`);
  const subjectA = await subjectOf();
  assert.ok(subjectA.includes('OrderController'), 'seeded at OrderController');
  const before = await state();
  const wentToB = await followDependsOn();
  assert.ok(wentToB, 'OrderController has at least one outgoing relationship to follow (fixture chain)');
  await pause(400);
  const subjectB = await subjectOf();
  assert.notEqual(subjectB, subjectA, 'following a relationship changes the inspected subject');
  const wentToC = await followDependsOn();
  assert.ok(wentToC, 'the second hop of the fixture chain is followable');
  await pause(400);
  const subjectC = await subjectOf();
  assert.notEqual(subjectC, subjectB, 'the second hop changes the inspected subject again');
  const afterTraverse = await state();
  const dTraverse = delta(before, afterTraverse);
  const traverseChecks = [
    ['the level did not change while following relationships', dTraverse.levelBefore === dTraverse.levelAfter],
    ['the displayed 36 classes are unaffected', dTraverse.idOrderPreserved],
    ['no card moved while following relationships', dTraverse.survivorsMoved === 0],
    ['camera preserved while following relationships', !dTraverse.zoomChanged && !dTraverse.panChanged]
  ];
  record('traverse-a-to-b-to-c-via-inspector', before, afterTraverse, dTraverse, { baseline: traverseChecks, acceptance: traverseChecks });
  await screenshot('s12a-traverse-a-b-c');

  const clickBack = () => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='← Back');if(!b||b.disabled)return false;b.click();return true})()`);
  await resetCounters();
  const beforeBack1 = await state();
  assert.ok(await clickBack(), 'Back control is enabled after two hops');
  await pause(400);
  const subjectAfterBack1 = await subjectOf();
  const afterBack1 = await state();
  const dBack1 = delta(beforeBack1, afterBack1);
  const back1Checks = [
    ['Back restores exactly the previous subject (B)', subjectAfterBack1 === subjectB],
    ['Back does not invoke layout', dBack1.layoutCalls === 0],
    ['no card moved on Back', dBack1.survivorsMoved === 0],
    ['membership unchanged by Back', dBack1.idOrderPreserved],
    ['camera preserved by Back', !dBack1.zoomChanged && !dBack1.panChanged]
  ];
  record('back-restores-b', beforeBack1, afterBack1, dBack1, { baseline: back1Checks, acceptance: back1Checks });

  const beforeBack2 = await state();
  const back2Available = await clickBack();
  await pause(400);
  const subjectAfterBack2 = await subjectOf();
  const afterBack2 = await state();
  const dBack2 = delta(beforeBack2, afterBack2);
  const back2Checks = [
    ['a second Back is available', back2Available],
    ['Back restores exactly the original subject (A)', subjectAfterBack2 === subjectA],
    ['Back does not invoke layout', dBack2.layoutCalls === 0],
    ['no card moved on the second Back', dBack2.survivorsMoved === 0],
    ['membership unchanged by the second Back', dBack2.idOrderPreserved],
    ['camera preserved by the second Back', !dBack2.zoomChanged && !dBack2.panChanged]
  ];
  record('back-restores-a', beforeBack2, afterBack2, dBack2, { baseline: back2Checks, acceptance: back2Checks });
  await screenshot('s12b-back-to-a');
  await typeInto('global-search', '');
  await pause(200);
}

// ---------------------------------------------------------------------------
// S13 — Classes -> Methods -> Classes preserves the inspected subject and the
// Classes page's exact positions/camera. Story 6: "switching from Classes to
// Methods never destroys the saved Classes arrangement"; Step 4 also stopped
// the level segmented control from clearing inspection on a genuine switch.
// ---------------------------------------------------------------------------
{
  await reload();
  await revealClasses(12);
  await panAndZoom();
  await probe();
  const target = await pickVisibleNodeId(3);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open before level switch');
  const before = await state();
  await clickLevel('Methods');
  await until(async () => (await evaluate(`document.querySelector('.segmented button.active')?.textContent`)) === 'Methods', 'level switched to Methods');
  await pause(400);
  const atMethods = await state();
  await clickLevel('Classes');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) > 1 && (await evaluate(`document.querySelector('.segmented button.active')?.textContent`)) === 'Classes', 'level restored to Classes');
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  const checks = [
    ['inspection survives switching to Methods (not cleared by the level control)', !!before.inspecting && atMethods.inspecting === before.inspecting],
    ['inspection is still shown after returning to Classes', after.inspecting === before.inspecting],
    ['the Classes page is byte-identical after the round trip', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged],
    ['canvas instance preserved throughout', !d.canvasRecreated]
  ];
  record('classes-methods-classes-preserves-subject-and-geometry', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s13-classes-methods-classes');
}

// ---------------------------------------------------------------------------
// S14 — inspecting a resource outside the current scope opens its details
// without adding it to scope, changing level, or touching the displayed page
// (Story 1/6: "Outside current scope").
// ---------------------------------------------------------------------------
{
  await reload();
  await evaluate(`document.querySelector('.scope-toolbar button:nth-of-type(2)').click()`); // Clear
  await pause(300);
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.domain'));label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(400);
  await clickLevel('Classes');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 1, 'domain-only classes displayed');
  await panAndZoom();
  await probe();
  const before = await state();
  const typeInto = (id, text) => evaluate(`(()=>{
    const input = document.getElementById(${JSON.stringify(id)});
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // ExternalPaymentGateway lives in the `external` package (fixture README), which is excluded now.
  await typeInto('global-search', 'ExternalPaymentGateway');
  await pause(300);
  const hasResult = await evaluate(`!![...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('ExternalPaymentGateway'))`);
  assert.ok(hasResult, 'search finds a class outside the narrowed scope');
  await evaluate(`[...document.querySelectorAll('.search-results button')].find(b=>b.textContent.includes('ExternalPaymentGateway')).click()`);
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  const notice = await evaluate(`(document.querySelector('.inspector .notice')?.textContent||'')`);
  const checks = [
    ['inspector opens for the out-of-scope subject', after.inspectorOpen],
    ['the "Outside current scope" notice is shown', notice.includes('Outside current scope')],
    ['scope checkboxes are unaffected', !d.scopeChanged],
    ['displayed membership is unaffected', d.idOrderPreserved],
    ['level unchanged', d.levelBefore === d.levelAfter],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('inspect-out-of-scope-resource', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s14-out-of-scope-inspection');
  await typeInto('global-search', '');
  await pause(200);
  await evaluate(`document.querySelector('.scope-toolbar button:first-child').click()`); // Select all
  await pause(400);
}

// ---------------------------------------------------------------------------
// S15 — a scope edit made while Classes is inactive is reconciled correctly
// once the user actually returns (Step 4, Appendix F3): removing an already-
// displayed class while viewing Methods drops it immediately from the cached
// Classes page (not deferred), and re-adding it while still away lands it as
// a fresh addition at the end -- not restored to its old slot -- once Classes
// is actually revisited.
// ---------------------------------------------------------------------------
{
  await reload();
  const shown = await revealClasses(12);
  assert.equal(shown, 12, 'a 12-class page exists before leaving Classes');
  await panAndZoom();
  await probe();
  const before12 = await state();
  const targetId = before12.ids[5];
  const targetNode = graph.nodes.find(n => n.id === targetId);
  assert.ok(targetNode, 'the target displayed class resolves to a real fixture node');
  // A collapsed branch's children are not in the DOM at all (unlike the native <details> this tree
  // used to render, whose children always existed there regardless of the `open` attribute), so the
  // target class row may not exist yet. Expand every branch first; a click can reveal further
  // still-collapsed grandchildren, so re-click on every poll attempt until none remain.
  await until(() => evaluate(`(()=>{
    [...document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="false"]')].forEach(b=>b.click());
    return document.querySelectorAll('.package-tree .tree-disclosure[aria-expanded="false"]').length===0;
  })()`), 'expand package tree to reach the target class');
  const toggleClassCheckbox = () => evaluate(`(()=>{
    const label=[...document.querySelectorAll('.scope-row-class .scope-label')].find(b=>b.getAttribute('title')===${JSON.stringify(targetNode.qualifiedName)});
    if(!label) return false;
    label.closest('.scope-row-class').querySelector('.scope-checkbox').click();
    return true;
  })()`);

  await clickLevel('Methods');
  await until(async () => (await evaluate(`document.querySelector('.segmented button.active')?.textContent`)) === 'Methods', 'switched to Methods');
  await pause(300);
  assert.ok(await toggleClassCheckbox(), 'found the target class checkbox to remove it while away');
  await pause(400);
  assert.ok(await toggleClassCheckbox(), 'found the target class checkbox to re-add it while still away');
  await pause(400);

  await clickLevel('Classes');
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 12, 'Classes page restored');
  await pause(400);
  const after = await state();
  const survivors = before12.ids.filter(id => id !== targetId);
  const expectedOrder = [...survivors, targetId];
  const survivorPositionsPreserved = survivors.every(id => after.positions[id] && before12.positions[id]
    && Math.abs(after.positions[id].x - before12.positions[id].x) < 0.01 && Math.abs(after.positions[id].y - before12.positions[id].y) < 0.01);
  const freshPosition = after.positions[targetId] && before12.positions[targetId]
    ? (Math.abs(after.positions[targetId].x - before12.positions[targetId].x) > 0.01 || Math.abs(after.positions[targetId].y - before12.positions[targetId].y) > 0.01)
    : false;
  const checks = [
    ['the page count is restored (11 survivors + the re-added class)', after.ids.length === 12],
    ['the re-added class lands at the end, not back in its old slot', JSON.stringify(after.ids) === JSON.stringify(expectedOrder)],
    ['every other survivor keeps its exact position', survivorPositionsPreserved],
    ['the re-added class gets a fresh position, not its old one', freshPosition],
    ['level is Classes again', after.level === 'Classes']
  ];
  record('scope-remove-readd-while-away', before12, after, delta(before12, after), { baseline: checks, acceptance: checks });
  await screenshot('s15-scope-edit-while-away');
}

// ---------------------------------------------------------------------------
// S16 — narrow-screen details-pane return: inspecting a card and returning to
// the map pane must restore the exact camera/positions (Story 6: "returning
// to the map restores its previous camera and positions"), and must not trip
// the ResizeObserver over the map pane's zero-size container while the
// details pane is showing instead.
// ---------------------------------------------------------------------------
{
  await reload();
  await revealClasses(12);
  await panAndZoom();
  await probe();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  await resetCounters();
  const before = await state();
  const target = await pickVisibleNodeId(0);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open on narrow screen');
  const paneAfterSelect = await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.className.includes('active'))?.textContent`);
  await pause(300);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  const after = await state();
  const d = delta(before, after);
  const checks = [
    ['selecting a card auto-switches to the details pane', paneAfterSelect === 'details'],
    ['membership unaffected by the narrow inspect/return round trip', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved across the pane switch', !d.zoomChanged && !d.panChanged],
    ['canvas instance preserved (no zero-size resize corruption)', !d.canvasRecreated]
  ];
  record('narrow-inspect-return-preserves-geometry', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s16-narrow-inspect-return');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await pause(600);
}

// ---------------------------------------------------------------------------
// S16b — Step 5 point 5: "the explicit touch action must remain usable when a
// single tap opens details." On this app's narrow layout, a single tap on a
// card already switches the mobile pane to Details (`select()` calls
// `setMobilePane('details')`), and `.workspace-content` -- the canvas's own
// container -- is `display:none` while that pane is showing. That almost
// certainly keeps a second press from ever reaching the canvas to complete a
// double-click gesture there, which is exactly why the keyboard/touch
// equivalent exists: it must work from the details pane a single tap already
// switched to, not merely alongside the canvas gesture. This also exercises
// GraphCanvas's zero-size ResizeObserver guard with a real geometry write
// pending (Step 4's S16 only exercised the guard with no such write queued).
// ---------------------------------------------------------------------------
{
  await reload();
  await revealClasses(12);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);

  // Observe (do not assert either way) whether a real double-click still reaches the canvas once
  // the first press has already switched the pane away from the map -- informational, matching S11's
  // existing pattern of a checks-free recorded observation.
  await resetCounters();
  const beforeGesture = await state();
  const gestureTarget = await pickVisibleNodeId(1);
  const gesturePoint = await nodePoint(gestureTarget);
  await doubleClick(gesturePoint, 90);
  const afterGesture = await state();
  const gestureDelta = delta(beforeGesture, afterGesture);
  scenarios.push({ name: 'narrow-double-click-gesture-observation', delta: gestureDelta, checks: [] });

  // The touch/keyboard equivalent: single-tap a card (switches to Details, as S16 already proves),
  // then activate "Arrange around this resource" from that same pane.
  await reload();
  await revealClasses(12);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  const target16b = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target16b));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open on narrow screen');
  const paneAfterSelect16b = await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.className.includes('active'))?.textContent`);
  const enabled16b = await evaluate(`!document.querySelector('.arrange-action')?.disabled`);
  assert.ok(enabled16b, 'the resource just selected is displayed, so the action must be enabled');
  await resetCounters();
  const before16b = await state();
  await evaluate(`document.querySelector('.arrange-action').click()`);
  await pause(300);
  const afterClick16b = await state();
  const dClick16b = delta(before16b, afterClick16b);
  await screenshot('s16b-narrow-inspector-arrange-from-details');
  // Switch back to the map pane and confirm the arrangement actually reached the canvas (it is
  // applied regardless of pane visibility, since GraphCanvas stays mounted -- only its container is
  // display:none) and survived the pane switch without a resize-driven camera change.
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  const afterReturn16b = await state();
  const dReturn16b = delta(afterClick16b, afterReturn16b);
  const checks16b = [
    ['a single tap switches to the Details pane, as usual', paneAfterSelect16b === 'details'],
    ['the arrange action is enabled for the just-selected, currently-displayed resource', enabled16b],
    ['activating it from the Details pane still drives exactly one arrangement', dClick16b.arrangeCalls === 1],
    ['no double-click gesture was involved', dClick16b.dbltaps === 0],
    ['scope/level/page unchanged', !dClick16b.scopeChanged && dClick16b.levelAfter === dClick16b.levelBefore && dClick16b.countAfter === dClick16b.countBefore],
    ['zoom/pan unchanged by the arrangement itself', !dClick16b.zoomChanged && !dClick16b.panChanged],
    ['returning to the map pane does not itself trigger another arrangement or move the camera', dReturn16b.arrangeCalls === 0 && !dReturn16b.zoomChanged && !dReturn16b.panChanged],
    ['canvas instance preserved across the pane switch (no zero-size resize corruption)', !dReturn16b.canvasRecreated]
  ];
  record('narrow-inspector-arrange-from-details-pane', before16b, afterReturn16b, { ...dClick16b, returnToMap: dReturn16b }, { baseline: checks16b, acceptance: checks16b });
  await screenshot('s16b-narrow-arranged-map-after-return');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await pause(600);
}

// ---------------------------------------------------------------------------
// S17 — "Code map" navigation returns to the last map view rather than
// resetting to Packages or clearing selection (Story 6). Leaving the map
// entirely (Entry points tab unmounts GraphCanvas) and coming back must still
// restore the exact saved geometry from persisted view state, independent of
// the canvas instance itself.
// ---------------------------------------------------------------------------
{
  await reload();
  await revealClasses(12);
  await panAndZoom();
  await probe();
  const target = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open before leaving to another tab');
  const before = await state();
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Entry points')).click()`);
  await pause(400);
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Code map')).click()`);
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  const checks = [
    ['level is still Classes, not reset to Packages', after.level === 'Classes'],
    ['inspection survives the round trip', !!before.inspecting && after.inspecting === before.inspecting],
    ['the page is byte-identical', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('code-map-returns-to-last-view', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s17-code-map-returns-to-last-view');
}

// ---------------------------------------------------------------------------
// S18 — Step 5 review remediation A3 (CANVAS-02): a level's node count going 0 -> >0 must trigger
// GraphCanvas's initial-fit effect even though `camera` itself stays the exact same `null`
// reference throughout (reconcileLevelView echoes `camera: view.camera` verbatim -- a removal or
// addition never replaces it). Before this fix the effect was keyed on `[camera]` only, so a level
// first visited with zero eligible nodes (camera stays null, nothing to place) that later gains
// cards via a scope widening -- with camera never becoming non-null in between -- never re-ran the
// effect and never fit the camera to the newly admitted card.
//
// `com.example.stable.marker.RegionTag` (test-fixtures/stable-graph-fixture) is a field-only class
// with no explicit methods or constructor, added specifically so METHOD level has a real,
// non-empty-scope package that is genuinely empty at that level (verified: the imported graph has
// no METHOD/CONSTRUCTOR node for it) -- every other package in this fixture has at least one method
// per class (even a plain getter), so this trigger was otherwise unreachable through real scope
// narrowing in the existing fixture.
// ---------------------------------------------------------------------------
{
  await reload();
  await evaluate(`document.querySelector('.scope-toolbar button:nth-of-type(2)').click()`); // Clear
  await pause(300);
  // Selecting the empty-at-METHOD-level package alone remounts GraphCanvas fresh (scopeEmpty -> not
  // empty is a different JSX subtree, not a prop change) at PACKAGE level with one node -- a
  // legitimate 0 -> >0... no, 1 node at mount, which the *existing* mount-time effect run already
  // handles regardless of this fix (a fresh mount always runs the effect once). The actual case
  // under test is the *subsequent* switch to Methods below, on this same already-mounted instance.
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.marker'));if(!label)throw Error('missing package marker');label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(400);
  await probe(); // (re-)register instrumentation on whatever cy instance is currently mounted
  await clickLevel('Methods');
  await until(() => evaluate(`!!document.querySelector('.canvas-empty')`), 'Methods view genuinely empty for the marker-only scope');
  await resetCounters();
  const before = await state();
  assert.equal(before.ids.length, 0, 'Methods view starts genuinely empty: the sole in-scope package has no methods');
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.util'));if(!label)throw Error('missing package util');label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  const allNodesInsideCanvas = await evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    return cy.nodes().length > 0 && cy.nodes().every(n=>{const b=n.renderedBoundingBox();return b.x1>=-1&&b.y1>=-1&&b.x2<=w+1&&b.y2<=h+1;});
  })()`);
  d.allNodesInsideCanvas = allNodesInsideCanvas;
  const checks = [
    ['scope changed', d.scopeChanged],
    ['Methods genuinely had zero cards before this addition', d.countBefore === 0],
    ['the level actually gained cards (0 -> >0)', d.countAfter > 0],
    ['the initial fit ran for this transition even though camera never changed reference away from null (Step 5 review remediation A3 fixed)', d.fitCalls >= 1],
    ['every newly admitted card ends up inside the visible canvas viewport, not off-screen with no way to reach it', allNodesInsideCanvas]
  ];
  record('empty-level-then-scope-widened-triggers-initial-fit', before, after, d, { baseline: checks, acceptance: checks });
  await screenshot('s18-empty-level-scope-widened-fit');
}

// ---------------------------------------------------------------------------
// S19 — Step 5 review remediation B2 (UI-06): an inspected aggregate edge is level-scoped by
// construction (aggregate:[source,target] keys on THAT level's endpoints), so it
// can never resolve again at a different level. Before this fix, switching levels via the segmented
// control left it "inspected" with nothing on screen matching it -- silently dangling rather than
// either closing or showing a notice. The fix clears it via the same CLEAR_INSPECTION path Back
// already knows how to restore (Step 5 review remediation A1's inspectedLevel fix), so one Back both
// undoes the level switch and recovers the edge inspection, rather than losing it.
// ---------------------------------------------------------------------------
{
  await reload();
  await until(async () => (await evaluate(`${CY}.nodes().length`)) > 1, 'Packages level populated');
  await probe(); await resetCounters();
  const candidates = await visibleEdgeCandidates(12);
  let clickedId = null;
  for (const id of candidates) {
    const point = await edgePoint(id);
    if (!point) continue;
    await singleClick(point);
    if (await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`)) { clickedId = id; break; }
  }
  assert.ok(clickedId, 'a real pointer click landed on a Packages-level edge for the level-switch survival case');
  const before = await state();
  assert.equal(before.level, 'Packages');
  assert.ok(before.inspectorOpen, 'inspector is open on the clicked relationship before the level switch');
  await clickLevel('Classes');
  await pause(600);
  const after = await state();
  const d = delta(before, after);
  const clickBack = () => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='← Back');if(!b||b.disabled)return false;b.click();return true})()`);
  const backAvailable = await clickBack();
  await pause(500);
  const afterBack = await state();
  const checks = [
    ['level actually changed', d.levelBefore === 'Packages' && d.levelAfter === 'Classes'],
    ['the dangling aggregate edge inspection was cleared on the level switch, not left silently pointing at nothing (Step 5 review remediation B2 fixed)', !after.inspectorOpen],
    ['Back is available (Step 5 review remediation A1/B1: the edge inspection still pushed a history entry under the level it was actually inspected at)', backAvailable],
    ['a single Back both undoes the level switch and restores the edge inspection', afterBack.level === 'Packages' && afterBack.inspectorOpen && (afterBack.inspectorSubject || '').includes('Relationship')]
  ];
  record('edge-inspection-cleared-then-recovered-across-level-switch', before, afterBack, { ...d, backAvailable, afterBackLevel: afterBack.level, afterBackInspectorOpen: afterBack.inspectorOpen }, { baseline: checks, acceptance: checks });
  await screenshot('s19-edge-inspection-recovered-after-level-switch-back');
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
