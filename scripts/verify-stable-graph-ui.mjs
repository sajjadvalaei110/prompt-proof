// Stable-map browser observation using Chromium CDP and Node's built-in WebSocket; no npm dependency.
//
// Mode (config.mode): `acceptance` asserts the stable-map contract from the product specification.
// The Step 1 `baseline` mode (known-defect snapshot) is retired: every defect it recorded was fixed by
// Steps 2-5, and its scenarios drove the level switcher ADR 0007 removed.
//
// Ported to the package-only map (ADR 0007, 2026-10-01): the map shows every in-scope package (the
// package level has no display limit, so Show more never appears), and classes are reached by
// expanding a package card in place. Scenarios that tested the removed
// Packages/Classes/Methods switcher itself are retired or replaced by their package-only equivalent
// (see docs/STABLE_GRAPH_INTERACTIONS.md "Browser acceptance after ADR 0007").
//
// Instrumentation is installed from the test side onto Cytoscape's own registry
// (`.graph-canvas._cyreg.cy`). The application ships no debug object and no graph data leaves
// the page; `window.__probe` is created here and holds integer counters only.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const { base, debug, fixture, output, mode = 'acceptance' } = config;
if (mode !== 'acceptance' && mode !== 's4-diagnostic') throw Error(`Unknown mode ${mode}; the baseline mode is retired`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
const scenarios = [];
const screenshots = [];
const pointerDiagnostics = { 's4-click-edge': [] };

async function api(path, body) {
  const r = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${r.status}`);
  return r.json();
}
async function until(fn, label) { for (let i = 0; i < 150; i++) { if (await fn()) return; await pause(200); } throw Error(`Timed out: ${label}`); }

// ---------------------------------------------------------------------------
// Import the fixture and confirm it is large enough to put 36+ class cards on the map.
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
    boxes:cy.nodes(':parent').map(n=>n.id()),
    positions:Object.fromEntries(cy.nodes().map(n=>[n.id(),{x:round(n.position('x')),y:round(n.position('y'))}])),
    edgeIds:cy.edges().map(e=>e.id()).sort(),
    zoom:round(cy.zoom()),
    pan:{x:round(cy.pan().x),y:round(cy.pan().y)},
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
  const shifted = id => after.positions[id] &&
    (Math.abs(after.positions[id].x - before.positions[id].x) > 0.01 || Math.abs(after.positions[id].y - before.positions[id].y) > 0.01);
  // Cards are the stored positions the contract preserves. An expanded box has no stored position:
  // Cytoscape derives it from its children's bounds, which include a child's selection halo (outline),
  // so a halo on a card at the box's edge shifts the box while no card moves. Boxes are reported
  // separately (boxesShifted) rather than counted as moved cards.
  const isBox = id => before.boxes.includes(id) || after.boxes.includes(id);
  const moved = before.ids.filter(id => !isBox(id) && shifted(id));
  const boxesShifted = before.ids.filter(id => isBox(id) && shifted(id));
  const maxMove = moved.reduce((max, id) => Math.max(max, Math.hypot(after.positions[id].x - before.positions[id].x, after.positions[id].y - before.positions[id].y)), 0);
  return {
    countBefore: before.ids.length, countAfter: after.ids.length,
    idOrderPreserved: JSON.stringify(before.ids) === JSON.stringify(after.ids),
    survivors: before.ids.filter(id => after.ids.includes(id)).length,
    dropped: before.ids.filter(id => !after.ids.includes(id)).length,
    added: after.ids.filter(id => !before.ids.includes(id)).length,
    survivorsMoved: moved.length,
    boxesShifted: boxesShifted.map(id => ({ id, dx: Math.round((after.positions[id].x - before.positions[id].x) * 100) / 100, dy: Math.round((after.positions[id].y - before.positions[id].y) * 100) / 100 })),
    movedIds: moved.slice(0, 8),
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
    showMoreBefore: before.showMore, showMoreAfter: after.showMore,
    scopeChanged: Object.keys(before.scopeChecks).some(k => Object.hasOwn(after.scopeChecks, k) && after.scopeChecks[k] !== before.scopeChecks[k])
  };
}

/** Records a scenario. `acceptance` is an array of [label, boolean]. */
function record(name, before, after, d, expectations) {
  const active = expectations[mode] || [];
  const checked = active.map(([label, ok]) => ({ label, ok }));
  for (const c of checked) if (!c.ok) failures.push(`${mode}/${name}: ${c.label}`);
  scenarios.push({ name, delta: d, before: summarize(before), after: summarize(after), checks: checked });
  console.log(`  ${checked.every(c => c.ok) ? 'ok  ' : 'FAIL'} ${name} :: ${JSON.stringify(d)}`);
}
const summarize = s => ({ count: s.ids.length, edges: s.edgeIds.length, zoom: s.zoom, pan: s.pan, banner: s.banner, showMore: s.showMore, inspecting: s.inspecting, inspectorSubject: s.inspectorSubject, probeId: s.probeId, canvasBox: s.canvasBox });

// ---------------------------------------------------------------------------
// Real pointer dispatch (never `.emit('tap')`).
// ---------------------------------------------------------------------------
async function pointAt(expression) {
  return evaluate(`(()=>{const p=${expression};if(!p)return null;const box=document.querySelector('.graph-canvas').getBoundingClientRect();return{x:box.left+p.x,y:box.top+p.y}})()`);
}
const nodePoint = id => pointAt(`(()=>{const n=${CY}.getElementById(${JSON.stringify(id)});return n.length?n.renderedPosition():null})()`);
/**
 * Return several real, renderer-tested points along an edge.  A midpoint alone
 * is fragile: a bezier midpoint can be covered by a card, a label, or another
 * parallel route after the camera moves.  The renderer hit-test only chooses candidates;
 * the caller still dispatches a real CDP mouse press/release at each point.
 */
const edgePoints = id => evaluate(`(()=>{
  const cy=${CY}, edge=cy.getElementById(${JSON.stringify(id)});
  if(!edge.length)return [];
  const box=document.querySelector('.graph-canvas').getBoundingClientRect();
  const canvas=document.querySelector('.graph-canvas');
  const w=cy.width(),h=cy.height(), source=edge.source().renderedPosition(), target=edge.target().renderedPosition();
  const midpoint=edge.renderedMidpoint();
  const nodeBoxes=cy.nodes().map(n=>n.renderedBoundingBox());
  const points=[], seen=new Set();
  const add=(p)=>{
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<4||p.y<4||p.x>w-4||p.y>h-4)return;
    // Do not aim at the interior of a card; Cytoscape will correctly route a
    // pointer there to the node even when the edge passes underneath it.
    if(nodeBoxes.some(b=>p.x>b.x1+2&&p.x<b.x2-2&&p.y>b.y1+2&&p.y<b.y2-2))return;
    const key=Math.round(p.x*10)+':'+Math.round(p.y*10);
    if(seen.has(key))return;
    // The renderer hit-test uses model coordinates, so convert the rendered
    // candidate before rejecting a point that cannot reach this edge.  The
    // acceptance click below remains a real pointer.
    const pan=cy.pan(),zoom=cy.zoom();
    const nearest=cy.renderer().findNearestElements((p.x-pan.x)/zoom,(p.y-pan.y)/zoom,true,false);
    if(!nearest.some(element=>element.id()===edge.id()))return;
    const clientX=box.left+p.x,clientY=box.top+p.y, domTarget=document.elementFromPoint(clientX,clientY);
    const targetChain=[];
    for(let el=domTarget;el&&targetChain.length<6;el=el.parentElement){
      targetChain.push({tag:el.tagName,id:el.id||null,className:typeof el.className==='string'?el.className:(el.className?.baseVal||''),role:el.getAttribute('role'),ariaLabel:el.getAttribute('aria-label')});
    }
    let minimapHit=null;
    const minimapSvg=domTarget?.closest?.('.minimap svg');
    if(minimapSvg){
      const screenPoint=minimapSvg.createSVGPoint();screenPoint.x=clientX;screenPoint.y=clientY;
      const matrix=minimapSvg.getScreenCTM(), viewport=minimapSvg.querySelectorAll('rect');
      const viewportRect=viewport.length?viewport[viewport.length-1]:null;
      if(matrix&&viewportRect){
        const p=screenPoint.matrixTransform(matrix.inverse());
        const bounds={x:Number(viewportRect.getAttribute('x')),y:Number(viewportRect.getAttribute('y')),w:Number(viewportRect.getAttribute('width')),h:Number(viewportRect.getAttribute('height'))};
        const center={x:bounds.x+bounds.w/2,y:bounds.y+bounds.h/2};
        minimapHit={point:{x:p.x,y:p.y},viewport:bounds,outsideViewport:p.x<bounds.x||p.x>bounds.x+bounds.w||p.y<bounds.y||p.y>bounds.y+bounds.h,distanceFromViewportCenter:Math.hypot(p.x-center.x,p.y-center.y)};
      }
    }
    // Renderer hit testing sees Cytoscape's drawing beneath HTML/SVG overlays. Keep those
    // points for diagnostics, but only send an acceptance click when the DOM would deliver
    // the real pointer to one of Cytoscape's own renderer canvases.
    const cyCanvasTarget=domTarget instanceof HTMLCanvasElement&&domTarget.closest('.graph-canvas')===canvas;
    seen.add(key);points.push({x:clientX,y:clientY,cyCanvasTarget,targetChain,minimapHit});
  };
  add(midpoint);
  for(const t of [.12,.2,.3,.4,.5,.6,.7,.8,.88])add({x:source.x+(target.x-source.x)*t,y:source.y+(target.y-source.y)*t});
  const dx=target.x-source.x,dy=target.y-source.y,len=Math.hypot(dx,dy)||1;
  for(const offset of [-8,-4,4,8])add({x:midpoint.x-dy/len*offset,y:midpoint.y+dx/len*offset});
  return points;
})()`);

/**
 * Step 3 changed what "a node to click" means: the camera is no longer auto-fit to whatever is
 * currently displayed (that was exactly the instability under test), so `cy.nodes()[N]` can now be
 * a card well outside the visible canvas -- e.g. appended below the initial fit, or past whatever
 * panAndZoom() last framed. `renderedPosition()`/`renderedMidpoint()` are canvas-relative
 * coordinates regardless of visibility, so a synthesized click at an off-screen point lands on
 * whatever real DOM happens to sit there (the minimap, zoom controls, or nothing), producing a
 * confusing failure rather than a real pointer test. Pick from cards that are actually visible.
 */
async function pickVisibleNodeId(preferredIndex = 0, insideBox = false) {
  return evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    // A card, never an expanded box: a box's centre is usually covered by one of its children.
    // insideBox: true picks a card drawn inside an expanded box (a class of an expanded package),
    // 'top' a top-level card, false any card.
    const where=${JSON.stringify(insideBox)};
    const cards=cy.nodes().filter(n=>!n.isParent()&&(where===true?n.parent().length>0:where==='top'?n.parent().length===0:true));
    const within=cards.filter(n=>{const b=n.renderedBoundingBox();return b.x1>=4&&b.y1>=4&&b.x2<=w-4&&b.y2<=h-4;});
    const pool=within.length?within:cards;
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

async function beginPointerTrace() {
  return evaluate(`(()=>{
    window.__s4PointerDown=[];
    document.addEventListener('pointerdown',event=>{
      const chain=[];
      for(let el=event.target;el&&chain.length<6;el=el.parentElement){
        chain.push({tag:el.tagName,id:el.id||null,className:typeof el.className==='string'?el.className:(el.className?.baseVal||''),role:el.getAttribute('role'),ariaLabel:el.getAttribute('aria-label')});
      }
      window.__s4PointerDown.push({x:event.clientX,y:event.clientY,pointerType:event.pointerType,targetChain:chain});
    },true);
    return true;
  })()`);
}
const takePointerTrace = () => evaluate(`(window.__s4PointerDown||[]).splice(0)`);

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

const packageId = suffix => {
  const pkg = graph.nodes.find(n => n.kind === 'PACKAGE' && n.qualifiedName.endsWith('.' + suffix));
  assert.ok(pkg, `fixture package ${suffix}`);
  return pkg.id;
};
/** Expand (or collapse) a card in place through its own Details control, as a user would. */
async function toggleCard(id, expanded) {
  const control = await evaluate(`(()=>{const b=document.querySelector('.map-details-button[data-card-id="'+CSS.escape(${JSON.stringify(id)})+'"]');if(!b)return false;b.click();return true})()`);
  if (!control) {
    // A grown box can put its Collapse control (top-right corner) off screen. The card menu is the
    // other user route (contract: "Card menu (right-click) Expand / Collapse"): right-click the
    // visible part of the box's header band and choose Collapse.
    assert.ok(!expanded, `no Details control drawn for ${id}`);
    const header = await evaluate(`(()=>{const cy=${CY},n=cy.getElementById(${JSON.stringify(id)}),r=document.querySelector('.graph-canvas').getBoundingClientRect(),b=n.renderedBoundingBox({includeLabels:false});
      const x1=Math.max(b.x1,8),x2=Math.min(b.x2,cy.width()-8),y=b.y1+14;if(x2<=x1||y<4||y>cy.height()-4)return null;return{x:r.x+(x1+x2)/2,y:r.y+y}})()`);
    assert.ok(header, `the header of box ${id} is on screen for its card menu`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: header.x, y: header.y, button: 'none', buttons: 0 });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: header.x, y: header.y, button: 'right', buttons: 2, clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: header.x, y: header.y, button: 'right', buttons: 0, clickCount: 1 });
    await pause(400);
    await evaluate(`(()=>{const b=[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].find(b=>/Collapse/.test(b.textContent)&&!/into/.test(b.textContent));if(!b)throw Error('no Collapse item in the card menu: '+[...document.querySelectorAll('.graph-context-menu [role=menuitem]')].map(b=>b.textContent).join(' | '));b.click();return true})()`);
  }
  await until(() => evaluate(`(()=>{const n=${CY}.getElementById(${JSON.stringify(id)});return n.length>0&&!!n.data('expanded')===${expanded}&&(${!expanded}||n.children().length>0)})()`), `${id} ${expanded ? 'expanded' : 'collapsed'}`);
  await pause(400);
  await probe();
}
const expandPackage = suffix => toggleCard(packageId(suffix), true);
const collapsePackage = suffix => toggleCard(packageId(suffix), false);
const leaveAndReturnToMap = async () => {
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Entry points')).click()`);
  await pause(400);
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Code map')).click()`);
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy&&${CY}.nodes().length>0`), 'map remounted');
  await pause(400);
};
/** Fresh page load. Re-selecting an already-active level is now a genuine no-op (Step 2), so a
 * level's displayed page persists once grown; the only reliable way back to a small starting page
 * for a scenario that needs one is a real reload, not clicking the same level again. */
async function reload() {
  await cdp('Page.navigate', { url: `${base}/?snapshotId=${snapshot}` });
  await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy`), 'canvas mount (reload)');
  await probe();
}
/** Frame the whole map with the user's own Fit map control. A scenario's setup does this so its
 * pointer targets are on screen: a small package map can sit entirely outside the camera an earlier
 * scenario left (the removed Classes page filled the view with 36 cards, so this never came up). */
async function fitMap() {
  await evaluate(`document.querySelector('.zoom-controls button[aria-label="Fit map"]').click()`);
  await pause(500);
}
/** The package map: every in-scope package is a top-level card (ADR 0007; no display limit). Frames
 * it, and returns the number of top-level cards and boxes. */
async function packageMap() {
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 1, 'package map');
  await fitMap();
  await probe();
  return evaluate(`${CY}.nodes().orphans().length`);
}
/** Classes are reached by expanding packages in place. Expands the largest packages (fixture order)
 * until at least `target` class cards are drawn inside boxes; returns that count. */
async function revealClassesInBoxes(target) {
  await packageMap();
  for (const pkg of ['service', 'domain', 'controller', 'repository', 'util', 'external']) {
    if ((await evaluate(`${CY}.nodes().filter(n=>n.parent().length>0).length`)) >= target) break;
    if (!(await evaluate(`!!${CY}.getElementById(${JSON.stringify(packageId(pkg))}).data('expanded')`))) await expandPackage(pkg);
  }
  await fitMap();
  return evaluate(`${CY}.nodes().filter(n=>n.parent().length>0).length`);
}

console.log(`fixture: ${typeCount} types, ${packageCount} packages, edge kinds ${edgeKinds.join('/')}, displayed resolutions ${resolutions.join('/')}, ${unresolvedRelationships} unresolved-target relationships (never projected onto the canvas)`);
console.log(`mode: ${mode}`);

// Optional causality probe, run as a separate diagnostic configuration. It intentionally clicks
// a renderer-valid edge coordinate that is intercepted by a DOM overlay, then records whether that
// actual target changed the camera. Normal acceptance never performs this overlay click.
if (mode === 's4-diagnostic') {
  await packageMap();
  const seed = await pickVisibleNodeId(8);
  await singleClick(await nodePoint(seed));
  await pause(400);
  await panAndZoom();
  const cameraBefore = await evaluate(`(()=>{const cy=${CY};return {zoom:cy.zoom(),pan:{...cy.pan()}}})()`);
  const candidates = await visibleEdgeCandidates(1000);
  const intercepted = [];
  for (const id of candidates) {
    for (const point of await edgePoints(id)) {
      if (!point.cyCanvasTarget && point.minimapHit?.outsideViewport) intercepted.push({ candidateEdgeId:id, point });
    }
  }
  intercepted.sort((a,b)=>b.point.minimapHit.distanceFromViewportCenter-a.point.minimapHit.distanceFromViewportCenter);
  const selected = intercepted[0];
  assert.ok(selected, `no renderer-valid edge point landed on the minimap SVG outside its current viewport; scanned ${candidates.length} edges`);
  await beginPointerTrace();
  await singleClick(selected.point);
  const pointerDown = await takePointerTrace();
  const cameraAfter = await evaluate(`(()=>{const cy=${CY};return {zoom:cy.zoom(),pan:{...cy.pan()},inspectedEdges:cy.edges('.inspected').map(e=>e.id()),inspectorSubject:(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim()}})()`);
  const result = {
    candidateEdgeId:selected.candidateEdgeId,
    scannedEdges:candidates.length,
    interceptedRendererValidPoints:intercepted.length,
    clickedPoint:selected.point,
    cameraBefore,
    pointerDown,
    cameraAfter,
    cameraChanged:cameraBefore.zoom!==cameraAfter.zoom||cameraBefore.pan.x!==cameraAfter.pan.x||cameraBefore.pan.y!==cameraAfter.pan.y,
    edgeInspected:cameraAfter.inspectedEdges.includes(selected.candidateEdgeId)
  };
  await fs.writeFile(`${output}/s4-minimap-svg-interception-reproduction.json`, JSON.stringify(result, null, 2));
  await screenshot('s4-minimap-svg-interception-after');
  console.log(`  S4 overlay-interception reproduction: ${JSON.stringify(result)}`);
  assert.ok(selected.point.targetChain.some(el => el.tag.toUpperCase() === 'SVG') && selected.point.targetChain.some(el => String(el.className).includes('minimap')), `predicted target was not inside the minimap SVG: ${JSON.stringify(selected.point.targetChain)}`);
  assert.ok(pointerDown[0]?.targetChain?.some(el => el.tag.toUpperCase() === 'SVG') && pointerDown[0]?.targetChain?.some(el => String(el.className).includes('minimap')), `actual pointerdown did not land inside the minimap SVG: ${JSON.stringify(pointerDown)}`);
  assert.ok(result.cameraChanged, 'an actual edge-targeted pointer intercepted by the minimap SVG outside the viewport changes the camera');
  socket.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// S1 — click a class card inside one expanded package box. ADR 0007: classes are reached by expanding
// a package in place, so this is the class-card click.
// ---------------------------------------------------------------------------
{
  await packageMap();
  await expandPackage('service');
  await resetCounters();
  const before = await state();
  const target = await pickVisibleNodeId(5, true);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  d.target = target;
  record('click-class-card-in-expanded-package', before, after, d, {
    // Step 3 fixed selection-triggered arrangement/refit: a single click no longer calls
    // cy.layout()/cy.fit(), moves a survivor, or touches the camera.
    acceptance: [
      ['the clicked card is a class inside the expanded package box', after.inspectorOpen && graph.nodes.some(n => n.id === target && isType(n))],
      ['inspector opened', after.inspectorOpen],
      ['same displayed IDs in the same order', d.idOrderPreserved],
      ['no arrangement command', d.layoutCalls === 0],
      ['no card moved', d.survivorsMoved === 0],
      ['zoom preserved', !d.zoomChanged],
      ['pan preserved', !d.panChanged],
    ]
  });
  await screenshot('s1-click-class-in-expanded-package');
}

// ---------------------------------------------------------------------------
// S2 — put 36+ classes on the map, then click one. The reported "36 -> 12" reset: inspection must not
// shrink what the user revealed. Before ADR 0007 the 36 were revealed with Show more on the Classes
// level; now they are revealed by expanding packages in place.
// ---------------------------------------------------------------------------
{
  await reload();
  const shown = await revealClassesInBoxes(36);
  assert.ok(shown >= 36, `expanding packages reveals at least 36 classes, saw ${shown}`);
  await panAndZoom();
  await probe();
  await resetCounters();
  const before = await state();
  const target = await pickVisibleNodeId(2, true);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  d.subject = after.inspectorSubject.slice(0, 40);
  record('reveal-36-classes-then-click-class', before, after, d, {
    // Step 2 fixed the membership/canvas-identity half of this regression: inspection no longer
    // resets the display limit, and a stable topology means the canvas is no longer torn down.
    // Step 3 fixed the remaining position/camera half: the click no longer moves any of the 36
    // cards or discards the user's pan/zoom.
    acceptance: [
      ['inspector opened', after.inspectorOpen],
      ['every revealed card is still displayed', d.countAfter === d.countBefore],
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
// S3 — click a package card on a fresh package map (every in-scope package, nothing expanded).
// ---------------------------------------------------------------------------
{
  await reload();
  assert.equal(await packageMap(), packageCount, 'a fresh map holds every package');
  await resetCounters();
  const before = await state();
  const target = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target));
  const after = await state();
  const d = delta(before, after);
  record('click-package-card', before, after, d, {
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
  await packageMap();
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
  const blockedCandidates = [];
  await beginPointerTrace();
  for (const id of candidates) {
    for (const point of await edgePoints(id)) {
      if (!point.cyCanvasTarget) {
        blockedCandidates.push({ candidateEdgeId:id, point });
        continue;
      }
      const beforeClick = await evaluate(`(()=>{
        const cy=${CY}, x=${point.x}, y=${point.y};
        const canvas=document.querySelector('.graph-canvas'), box=canvas.getBoundingClientRect();
        const target=document.elementFromPoint(x,y);
        const describe=el=>el?{tag:el.tagName,id:el.id||null,className:typeof el.className==='string'?el.className:(el.className?.baseVal||''),role:el.getAttribute('role'),ariaLabel:el.getAttribute('aria-label')}:null;
        const chain=[];for(let el=target;el&&chain.length<6;el=el.parentElement)chain.push(describe(el));
        const pan={x:cy.pan().x,y:cy.pan().y},zoom=cy.zoom();
        const rendered={x:x-box.left,y:y-box.top};
        const hits=cy.renderer().findNearestElements((rendered.x-pan.x)/zoom,(rendered.y-pan.y)/zoom,true,false).map(el=>({id:el.id(),group:el.group(),inspected:el.hasClass('inspected')}));
        return {x,y,elementChain:chain,pan,zoom,rendererHits:hits,inspectedEdges:cy.edges('.inspected').map(e=>e.id()),inspectedNodes:cy.nodes('.inspected').map(n=>n.id())};
      })()`);
      await singleClick(point);
      const actualPointerDown = await takePointerTrace();
      const afterClick = await evaluate(`(()=>{
        const cy=${CY}, x=${point.x}, y=${point.y};
        const box=document.querySelector('.graph-canvas').getBoundingClientRect(),pan={x:cy.pan().x,y:cy.pan().y},zoom=cy.zoom();
        const rendered={x:x-box.left,y:y-box.top};
        const hits=cy.renderer().findNearestElements((rendered.x-pan.x)/zoom,(rendered.y-pan.y)/zoom,true,false).map(el=>({id:el.id(),group:el.group(),inspected:el.hasClass('inspected')}));
        return {pan,zoom,rendererHits:hits,inspectedEdges:cy.edges('.inspected').map(e=>e.id()),inspectedNodes:cy.nodes('.inspected').map(n=>n.id()),inspectorSubject:(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim()};
      })()`);
      pointerDiagnostics['s4-click-edge'].push({ candidateEdgeId:id, point:{x:point.x,y:point.y}, before:beforeClick, actualPointerDown, after:afterClick });
      console.log(`  S4 click attempt ${pointerDiagnostics['s4-click-edge'].length}: ${JSON.stringify(pointerDiagnostics['s4-click-edge'].at(-1))}`);
      if (await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')`)) { clicked = id; break; }
    }
    if (clicked) break;
  }
  await fs.writeFile(`${output}/s4-click-edge-diagnostics.json`, JSON.stringify(pointerDiagnostics['s4-click-edge'], null, 2));
  await fs.writeFile(`${output}/s4-click-edge-target-filter.json`, JSON.stringify({
    scannedCandidates:candidates,
    blockedRendererValidPoints:blockedCandidates,
    dispatchedClicks:pointerDiagnostics['s4-click-edge']
  }, null, 2));
  if (blockedCandidates.length) console.log(`  S4 skipped ${blockedCandidates.length} renderer-valid edge point(s) intercepted by DOM overlays; evidence: s4-click-edge-target-filter.json`);
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
    acceptance: [
      ['relationship inspector opened', after.inspectorSubject.includes('Relationship')],
      ['displayed count unchanged', d.countAfter === d.countBefore],
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
  await packageMap();
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
  record('inspect-unresolved-relationship', before, after, d, { acceptance: checks });
  await screenshot('s4b-inspect-unresolved-relationship');
  await typeInto('global-search', ''); // clear so later scenarios are not affected by leftover results
  await pause(200);
}

// ---------------------------------------------------------------------------
// S5 — change the relationship filter. Node membership must not react at all.
// ---------------------------------------------------------------------------
{
  await packageMap();
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
  await packageMap();
  // S4b (immediately before this scenario) leaves an unresolved relationship inspected, and
  // nothing in between clears selection (there is no background-tap-deselect handler). Force the
  // pre-state to a NODE first so "Relationship" appearing in the inspector below is a true signal
  // that OUR click landed on an edge, not a stale artifact of the previous scenario.
  await singleClick(await nodePoint(await pickVisibleNodeId(0)));
  await pause(300);
  // The previous scenario's zoom and pan can leave every line behind a card or off the canvas; frame
  // the whole map with the user's own Fit map control before aiming at a line.
  await evaluate(`document.querySelector('.zoom-controls button[aria-label="Fit map"]').click()`);
  await pause(500);
  await resetCounters();
  const candidates = await visibleEdgeCandidates(12);
  // One line now carries every kind between its ordered pair (kindCounts), so filtering to any kind
  // the line contains keeps it drawn (thinner). This case needs a kind the clicked line does NOT
  // contain, so only a line with such a kind available is an eligible candidate.
  let clickedId = null, clickedKind = null, otherKind = null, skippedOverlayPoints = 0;
  const attempts5b = [];
  for (const id of candidates) {
    const lineKinds = await evaluate(`Object.keys(${CY}.getElementById(${JSON.stringify(id)}).data('kindCounts')||{})`);
    const absent = edgeKinds.find(k => !lineKinds.includes(k));
    if (!absent) { attempts5b.push({ id, lineKinds, skipped: 'contains every kind' }); continue; }
    const points = await edgePoints(id);
    attempts5b.push({ id, lineKinds, points: points.length, onCanvas: points.filter(p => p.cyCanvasTarget).length });
    for (const point of points) {
      if (!point.cyCanvasTarget) { skippedOverlayPoints++; continue; }
      await singleClick(point);
      attempts5b.push({ id, point: { x: point.x, y: point.y }, subject: await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').slice(0,60)`), inspected: await evaluate(`${CY}.edges('.inspected').map(e=>e.id())`) });
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
    if (clickedId) break;
  }
  await fs.writeFile(`${output}/s5b-edge-click-attempts.json`, JSON.stringify(attempts5b, null, 2));
  assert.ok(clickedId, `a real pointer click landed on an edge (with at least one kind it does not contain) for the filter-survival case; attempts: ${JSON.stringify(attempts5b).slice(0, 1500)}`);
  const before = await state();
  await evaluate(`{const s=document.querySelector('select[aria-label="Relationship kind"]');s.value=${JSON.stringify(otherKind)};s.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await pause(700);
  const inspectorSubject = await evaluate(`(document.querySelector('.inspector-top')?.textContent||'').replace(/\\s+/g,' ').trim()`);
  const notice = await evaluate(`(document.querySelector('.inspector .notice')?.textContent||'')`);
  const inspectorIdle = await evaluate(`!!document.querySelector('.inspector.idle')`);
  const after = await state();
  const d = delta(before, after);
  d.clickedKind = clickedKind; d.filteredToKind = otherKind; d.notice = notice; d.skippedOverlayPoints = skippedOverlayPoints;
  const checks = [
    ['inspector stays open, not idle', !inspectorIdle],
    ['relationship content is still shown', inspectorSubject.includes('Relationship')],
    ['a "not shown with the current filter" notice appears', notice.includes('current relationship filter')],
    ['node membership unaffected by a filter change', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('inspect-edge-survives-filter-change', before, after, d, { acceptance: checks });
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
  record('inspect-edge-survives-filter-to-contained-kind', containedBefore, containedAfter, cd, { acceptance: containedChecks });
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
  const shown = await packageMap();
  // The four checked packages are the whole page (package-only map, ADR 0007); `service` is excluded.
  assert.equal(shown, 4, `expected the four checked packages before the add-package test, saw ${shown}`);
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
    acceptance: [
      ['scope changed', d.scopeChanged],
      ['no previously displayed package is dropped', d.dropped === 0],
      ['surviving cards keep their exact positions', d.survivorsMoved === 0],
      ['camera preserved', !d.zoomChanged && !d.panChanged],
      ['the newly eligible package is appended', d.added > 0],
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
  await packageMap();
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
  await packageMap();
  await resetCounters();
  const before = await state();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(900);
  const after = await state();
  const d = delta(before, after);
  record('resize-pane', before, after, d, {
    // Step 3's ResizeObserver calls cy.resize() only (renderer dimensions stay in sync); it no
    // longer calls cy.fit(), so a pane resize cannot move the camera on its own.
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
// the new position survives leaving the map (Entry points unmounts the canvas) and returning (Appendix A3.8:
// "Preserve manual drag positions on drag completion"). A real CDP pointer drag,
// not a synthetic position write, since a pure reducer test can prove NODE_MOVED
// preserves state but cannot prove the gesture is actually wired to it.
// ---------------------------------------------------------------------------
{
  await packageMap();
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
  record('manual-drag-persists', before, after, d, { acceptance: dragChecks });
  await screenshot('s9b-manual-drag');

  const draggedPosition = after.positions[draggedId];
  await leaveAndReturnToMap();
  const restored = await state();
  const restoredPosition = restored.positions[draggedId];
  const persistCheck = [
    ['the dragged position survives leaving the map and returning', Boolean(restoredPosition)
      && Math.abs(restoredPosition.x - draggedPosition.x) < 0.5 && Math.abs(restoredPosition.y - draggedPosition.y) < 0.5]
  ];
  record('manual-drag-persists-across-leaving-the-map', after, restored, delta(after, restored), { acceptance: persistCheck });
}

// ---------------------------------------------------------------------------
// S10 — two spaced single clicks versus one real double-click.
// ---------------------------------------------------------------------------
{
  await packageMap();
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
    acceptance: [
      ['two taps dispatched', d.taps >= 2],
      ['no double-click gesture', d.dbltaps === 0],
      ['zero arrangements', d.layoutCalls === 0],
      ['two spaced single clicks cause zero focused arrangements', d.arrangeCalls === 0],
    ]
  });

  // (a0) Control: a real double-click on empty canvas. Cytoscape's core `dbltap` fires here,
  // which proves the CDP gesture synthesis is sound and isolates the node cases below. A previously
  // grown page now persists (Step 2), so start from a fresh reload rather than relying on
  // re-clicking the active level to shrink it back down.
  await reload();
  await packageMap();
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
    acceptance: [
      ['CDP synthesises a double-click Cytoscape recognises', de.anyDbltaps === 1]
    ]
  });

  // (a) Human-paced double-click (90 ms) on a fresh package map. Step 3 fixed the
  // position-shift-away defect (the first tap no longer arranges/moves the card), so the second
  // press now reliably lands and the gesture reaches Cytoscape. Step 4 disconnected the node
  // dbltap handler from explore() entirely (Step 4 point 1: "graph double-click must not remain
  // the drill-down command"). Step 5 gives it its own dedicated ARRANGE_AROUND_RESOURCE command
  // (Appendix B/Story 2): the first tap still only inspects (idempotently -- a repeat inspect of
  // the same subject is a no-op), and `dbltap` now drives exactly one focused arrangement.
  await reload();
  await packageMap();
  await resetCounters();
  const before12 = await state();
  const target12 = await pickVisibleNodeId(6);
  const point12 = await nodePoint(target12);
  await screenshot('s10a-double-click-before');
  await doubleClick(point12, 90);
  const after12 = await state();
  const d12 = delta(before12, after12);
  const settled12 = await nodePoint(target12);
  d12.targetLeftPointerBy = settled12 ? Math.round(Math.hypot(settled12.x - point12.x, settled12.y - point12.y)) : null;
  record('real-double-click-human-paced', before12, after12, d12, {
    acceptance: [
      ['double-click gesture reaches Cytoscape', d12.dbltaps === 1],
      ['exactly one arrangement', d12.arrangeCalls === 1],
      ['no whole-map layout call (out of scope for this step)', d12.layoutCalls === 0],
      ['displayed count unchanged', d12.countAfter === d12.countBefore]
    ]
  });
  await screenshot('s10a-double-click');

  // (a2) Same page, minimal 15 ms gap: establishes whether the gesture is reachable at all
  // when the second press arrives before React re-renders.
  await reload();
  await packageMap();
  await resetCounters();
  const beforeFast = await state();
  const targetFast = await pickVisibleNodeId(6);
  await doubleClick(await nodePoint(targetFast), 15);
  const afterFast = await state();
  const df = delta(beforeFast, afterFast);
  record('real-double-click-fast', beforeFast, afterFast, df, {
    acceptance: [
      ['double-click gesture reaches Cytoscape', df.dbltaps === 1],
      ['exactly one arrangement', df.arrangeCalls === 1],
    ]
  });

  // (b) On an expanded page: Step 2 fixed the membership collapse and canvas survival across the
  // first tap; Step 3 fixed the position-shift defect that used to move the card out from under
  // the second press. Together they made the gesture reach the node reliably. Step 5 wires it to
  // the dedicated arrangement command.
  await reload();
  // On a map with expanded boxes (classes revealed): double-click a top-level package card.
  await revealClassesInBoxes(36);
  await resetCounters();
  const beforeDouble = await state();
  const target = await pickVisibleNodeId(0, 'top');
  await screenshot('s10b-double-click-expanded-boxes-before');
  await doubleClick(await nodePoint(target));
  const afterDouble = await state();
  const dd = delta(beforeDouble, afterDouble);
  record('real-double-click-with-expanded-boxes', beforeDouble, afterDouble, dd, {
    acceptance: [
      ['double-click gesture reaches Cytoscape', dd.dbltaps === 1],
      ['exactly one arrangement', dd.arrangeCalls === 1],
      ['displayed count unchanged', dd.countAfter === dd.countBefore],
      ['canvas instance preserved', !dd.canvasRecreated]
    ]
  });
  await screenshot('s10b-double-click-expanded-boxes');

  // (c) A second, immediately following double-click on a DIFFERENT card still causes exactly one
  // more arrangement (the command is deliberate and re-runnable), and must not touch scope/
  // page/zoom either. A repeat double-click on the SAME already-arranged focus is deliberately not
  // asserted here: the algorithm is deterministic and anchored to that focus's own (unchanged)
  // position, so re-running it recomputes the identical layout and correctly moves nothing -- that
  // is Appendix B determinism working as intended, not a missed arrangement.
  await resetCounters();
  const secondTarget = await evaluate(`(()=>{
    const cy=${CY}, w=cy.width(), h=cy.height();
    const cards=cy.nodes().filter(n=>n.id()!==${JSON.stringify(target)}&&!n.isParent()&&n.parent().length===0);
    const within=cards.filter(n=>{const b=n.renderedBoundingBox();return b.x1>=4&&b.y1>=4&&b.x2<=w-4&&b.y2<=h-4;});
    const pool=within.length?within:cards;
    return pool.length?pool[0].id():null;
  })()`);
  assert.ok(secondTarget, 'a second, different visible card exists for the repeat double-click case');
  const beforeRepeat = await state();
  await doubleClick(await nodePoint(secondTarget));
  const afterRepeat = await state();
  const dr = delta(beforeRepeat, afterRepeat);
  record('real-double-click-second-different-card', beforeRepeat, afterRepeat, dr, {
    acceptance: [
      ['exactly one arrangement', dr.arrangeCalls === 1],
      ['page unchanged', dr.countAfter === dr.countBefore],
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
  await packageMap();
  const displayedIds10d = await evaluate(`${CY}.nodes().map(n=>n.id())`);
  const displayedNode = graph.nodes.find(n => displayedIds10d.includes(n.id) && n.kind === 'PACKAGE');
  assert.ok(displayedNode, 'a displayed package exists to inspect');
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
    ['page unchanged', d10d.countAfter === d10d.countBefore],
    ['scope unaffected', !d10d.scopeChanged],
    ['zoom untouched', !d10d.zoomChanged],
    ['pan untouched', !d10d.panChanged]
  ];
  record('inspector-arrange-around-resource', before10d, after10d, d10d, { acceptance: checks10d });
  await screenshot('s10d-inspector-arrange-action');

  // Disabled state: inspect a class that exists in scope but is not drawn (its package is collapsed).
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
    record('inspector-arrange-disabled-when-not-displayed', after10d, after10d, {}, { acceptance: notDisplayedChecks });
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
  await fitMap(); // frame the map at the narrow width so the cards under test are on screen
  await probe();
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
  await packageMap();
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
    ['the displayed map is unaffected', dTraverse.idOrderPreserved],
    ['no card moved while following relationships', dTraverse.survivorsMoved === 0],
    ['camera preserved while following relationships', !dTraverse.zoomChanged && !dTraverse.panChanged]
  ];
  record('traverse-a-to-b-to-c-via-inspector', before, afterTraverse, dTraverse, { acceptance: traverseChecks });
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
  record('back-restores-b', beforeBack1, afterBack1, dBack1, { acceptance: back1Checks });

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
  record('back-restores-a', beforeBack2, afterBack2, dBack2, { acceptance: back2Checks });
  await screenshot('s12b-back-to-a');
  await typeInto('global-search', '');
  await pause(200);
}

// ---------------------------------------------------------------------------
// S13 — drill in and back: Details (⊞) on a package and then Collapse (⊟) preserves the inspected
// subject, the camera and every card's exact position. ADR 0007 replaced the Classes -> Methods ->
// Classes level round trip with expand-in-place; this is the same contract (drilling into detail never
// destroys the saved arrangement), through the control that now does the drilling.
// ---------------------------------------------------------------------------
{
  await reload();
  await packageMap();
  const target = await pickVisibleNodeId(0);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open before expanding');
  // Move the camera after inspecting, so "camera preserved" below compares a user-chosen camera.
  await panAndZoom();
  await probe();
  // Expand a package other than the inspected one, through a Details control drawn on screen. The
  // smallest such package keeps its box (and so its Collapse control) inside the view.
  const drawn = await evaluate(`[...document.querySelectorAll('.map-details-button[aria-expanded="false"]')].map(b=>b.dataset.cardId).filter(id=>id!==${JSON.stringify(target)})`);
  const typesIn = id => graph.nodes.filter(n => n.parentId === id && isType(n)).length;
  const boxId = drawn.filter(id => typesIn(id) > 0).sort((a, b) => typesIn(a) - typesIn(b))[0];
  assert.ok(boxId, 'a visible package other than the inspected one can be expanded');
  await resetCounters();
  const before = await state();
  await toggleCard(boxId, true);
  const expanded = await state();
  await toggleCard(boxId, false);
  const after = await state();
  const d = delta(before, after);
  const dIn = delta(before, expanded);
  d.expandedCount = expanded.ids.length;
  const checks = [
    ['expanding adds the package\'s classes to the map', expanded.ids.length > before.ids.length],
    ['inspection survives the expansion', !!before.inspecting && expanded.inspecting === before.inspecting],
    ['inspection is still shown after collapsing', after.inspecting === before.inspecting],
    ['camera preserved while expanded', !dIn.zoomChanged && !dIn.panChanged],
    ['the map is the same after the round trip', d.idOrderPreserved],
    ['every card is back at its exact position', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged],
    // Expanding shifts the cards right of / below the box and collapsing shifts them back (contract);
    // the canvas reports each such position update as 'arranged'. No whole-map layout may run.
    ['no whole-map layout command', d.layoutCalls === 0],
    ['canvas instance preserved throughout', !d.canvasRecreated]
  ];
  record('expand-collapse-round-trip-preserves-subject-and-geometry', before, after, d, { acceptance: checks });
  await screenshot('s13-expand-collapse-round-trip');
}

// ---------------------------------------------------------------------------
// S14 — inspecting a resource outside the current scope opens its details
// without adding it to scope or touching the displayed page
// (Story 1/6: "Outside current scope").
// ---------------------------------------------------------------------------
{
  await reload();
  await evaluate(`document.querySelector('.scope-toolbar button:nth-of-type(2)').click()`); // Clear
  await pause(300);
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>(b.getAttribute('title')||'').endsWith('.domain'));label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();return true})()`);
  await pause(400);
  await until(async () => (await evaluate(`${CY}.nodes().length`)) >= 1, 'domain-only map displayed');
  await expandPackage('domain');
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
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('inspect-out-of-scope-resource', before, after, d, { acceptance: checks });
  await screenshot('s14-out-of-scope-inspection');
  await typeInto('global-search', '');
  await pause(200);
  await evaluate(`document.querySelector('.scope-toolbar button:first-child').click()`); // Select all
  await pause(400);
}

// ---------------------------------------------------------------------------
// S15 — removing a displayed package from scope and re-adding it: survivors keep their exact
// positions and order, nothing is refilled from the hidden queue, and the re-added package lands at
// the end with a fresh position rather than back in its old slot (Step 4, Appendix F3). Before ADR
// 0007 this was exercised while the Classes level was inactive; with one level the edit is direct.
// ---------------------------------------------------------------------------
{
  await reload();
  await packageMap();
  await panAndZoom();
  await probe();
  const before12 = await state();
  const targetId = before12.ids[5];
  const targetNode = graph.nodes.find(n => n.id === targetId);
  assert.ok(targetNode && targetNode.kind === 'PACKAGE', 'the target is a displayed fixture package');
  const togglePackageCheckbox = () => evaluate(`(()=>{
    const label=[...document.querySelectorAll('.scope-row-package .scope-row-package-row .scope-label')].find(b=>b.getAttribute('title')===${JSON.stringify(targetNode.qualifiedName)});
    if(!label) return false;
    label.closest('.scope-row-package-row').querySelector('.scope-checkbox').click();
    return true;
  })()`);
  assert.ok(await togglePackageCheckbox(), 'found the target package checkbox to remove it');
  await pause(500);
  const removed = await state();
  assert.ok(await togglePackageCheckbox(), 'found the target package checkbox to re-add it');
  await pause(700);
  const after = await state();
  const survivors = before12.ids.filter(id => id !== targetId);
  const expectedOrder = [...survivors, targetId];
  const survivorPositionsPreserved = survivors.every(id => after.positions[id] && before12.positions[id]
    && Math.abs(after.positions[id].x - before12.positions[id].x) < 0.01 && Math.abs(after.positions[id].y - before12.positions[id].y) < 0.01);
  const freshPosition = after.positions[targetId] && before12.positions[targetId]
    ? (Math.abs(after.positions[targetId].x - before12.positions[targetId].x) > 0.01 || Math.abs(after.positions[targetId].y - before12.positions[targetId].y) > 0.01)
    : false;
  const d = delta(before12, after);
  const checks = [
    ['removal drops only the target', removed.ids.length === before12.ids.length - 1 && !removed.ids.includes(targetId)],
    ['the count is restored (survivors + the re-added package)', after.ids.length === before12.ids.length],
    ['the re-added package lands at the end, not back in its old slot', JSON.stringify(after.ids) === JSON.stringify(expectedOrder)],
    ['every other survivor keeps its exact position', survivorPositionsPreserved],
    ['the re-added package gets a fresh position, not its old one', freshPosition],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('scope-remove-readd-package', before12, after, d, { acceptance: checks });
  await screenshot('s15-scope-remove-readd');
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
  await packageMap();
  await panAndZoom();
  await probe();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  await fitMap(); // frame the map at the narrow width so the cards under test are on screen
  await probe();
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
  record('narrow-inspect-return-preserves-geometry', before, after, d, { acceptance: checks });
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
  await packageMap();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  await fitMap(); // frame the map at the narrow width so the cards under test are on screen
  await probe();

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
  await packageMap();
  await cdp('Emulation.setDeviceMetricsOverride', { width: 430, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(800);
  await evaluate(`[...document.querySelectorAll('.mobile-tabs button')].find(b=>b.textContent==='map').click()`);
  await pause(600);
  await fitMap(); // frame the map at the narrow width so the cards under test are on screen
  await probe();
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
    ['scope/page unchanged', !dClick16b.scopeChanged && dClick16b.countAfter === dClick16b.countBefore],
    ['zoom/pan unchanged by the arrangement itself', !dClick16b.zoomChanged && !dClick16b.panChanged],
    ['returning to the map pane does not itself trigger another arrangement or move the camera', dReturn16b.arrangeCalls === 0 && !dReturn16b.zoomChanged && !dReturn16b.panChanged],
    ['canvas instance preserved across the pane switch (no zero-size resize corruption)', !dReturn16b.canvasRecreated]
  ];
  record('narrow-inspector-arrange-from-details-pane', before16b, afterReturn16b, { ...dClick16b, returnToMap: dReturn16b }, { acceptance: checks16b });
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
  await packageMap();
  const target = await pickVisibleNodeId(2);
  await singleClick(await nodePoint(target));
  await until(() => evaluate(`!!document.querySelector('.inspector-top')`), 'inspector open before leaving to another tab');
  // Move the camera after inspecting (a zoom-in can push the small package map's cards off screen).
  await panAndZoom();
  await probe();
  const before = await state();
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Entry points')).click()`);
  await pause(400);
  await evaluate(`[...document.querySelectorAll('.workspace-nav button')].find(b=>b.textContent.includes('Code map')).click()`);
  await pause(400);
  const after = await state();
  const d = delta(before, after);
  const checks = [
    ['inspection survives the round trip', !!before.inspecting && after.inspecting === before.inspecting],
    ['the page is byte-identical', d.idOrderPreserved],
    ['no card moved', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('code-map-returns-to-last-view', before, after, d, { acceptance: checks });
  await screenshot('s17-code-map-returns-to-last-view');
}

// ---------------------------------------------------------------------------
// S18 retired with ADR 0007: it proved a level first visited with zero cards fits the camera once a
// scope edit gives it cards. With one level, an empty scope shows the empty state instead of the
// canvas, and the canvas remounts (and fits) when the scope is non-empty again.
//
// S19 — an inspected relationship survives a change of what is drawn. Before ADR 0007 this was a level
// switch; now expanding one endpoint reroutes the package line onto the classes inside it. The
// inspection must stay open with the "Not drawn right now" notice rather than collapse or dangle, and
// collapsing the endpoint draws the same line again, still inspected.
// ---------------------------------------------------------------------------
{
  await reload();
  await packageMap();
  await resetCounters();
  const candidates = await visibleEdgeCandidates(12);
  let clickedId = null, skippedOverlayPoints = 0;
  for (const id of candidates) {
    for (const point of await edgePoints(id)) {
      if (!point.cyCanvasTarget) { skippedOverlayPoints++; continue; }
      await singleClick(point);
      const landed = await evaluate(`(()=>{const sel=${CY}.edges('.inspected');return sel.length===1&&(document.querySelector('.inspector-top')?.textContent||'').includes('Relationship')?sel[0].id():null})()`);
      if (landed) { clickedId = landed; break; }
    }
    if (clickedId) break;
  }
  assert.ok(clickedId, 'a real pointer click landed on a package edge');
  // Expand an endpoint whose Details control is drawn on screen (controls exist only for visible cards).
  const endpoint = await evaluate(`(()=>{const e=${CY}.getElementById(${JSON.stringify(clickedId)});const ends=[e.source().id(),e.target().id()];return ends.find(id=>document.querySelector('.map-details-button[data-card-id="'+CSS.escape(id)+'"]'))||null})()`);
  assert.ok(endpoint, 'an endpoint of the inspected line has its Details control on screen');
  const before = await state();
  await toggleCard(endpoint, true);
  const expanded = await state();
  const whileExpanded = await evaluate(`({notice:[...document.querySelectorAll('.inspector .notice')].map(n=>n.textContent).join(' '),idle:!!document.querySelector('.inspector.idle'),drawn:${CY}.getElementById(${JSON.stringify(clickedId)}).length>0})`);
  await toggleCard(endpoint, false);
  const after = await state();
  const restored = await evaluate(`(()=>{const e=${CY}.getElementById(${JSON.stringify(clickedId)});return {drawn:e.length>0,inspected:e.length>0&&e.hasClass('inspected')}})()`);
  const d = delta(before, after);
  const checks = [
    ['expanding the endpoint takes the package line off the map', !whileExpanded.drawn],
    ['the inspection stays open, not idle, while its line is not drawn', !whileExpanded.idle && expanded.inspectorSubject.includes('Relationship')],
    ['the inspector says why the line is not drawn', whileExpanded.notice.includes('an endpoint is expanded')],
    ['collapsing the endpoint draws the same line again', restored.drawn],
    ['the line is still the inspected one', restored.inspected && after.inspectorSubject.includes('Relationship')],
    ['every card is back at its exact position', d.survivorsMoved === 0],
    ['camera preserved', !d.zoomChanged && !d.panChanged]
  ];
  record('edge-inspection-survives-endpoint-expand-and-collapse', before, after, { ...d, endpoint, whileExpanded, restored, skippedOverlayPoints }, { acceptance: checks });
  await screenshot('s19-edge-inspection-after-endpoint-round-trip');
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
