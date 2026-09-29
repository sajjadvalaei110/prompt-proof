// Browser acceptance for Step 0 of the Git-review-on-the-Code-map feature.
//
// Changes is a presentation/inspection mode over the same exploration. Toggling it must keep the
// user's package-only map layout, scope, camera, selection and in-place package/class expansions.
// This uses Node's native WebSocket against Chromium's CDP, so the repository needs no Playwright
// dependency. The packaged pipeline creates the fixture and supplies these arguments:
//
//   node scripts/verify-git-review-ui.mjs <appBase> <chromiumDebugBase> <workspaceId>
//     <initialSnapshotId> <baseOid> <fixturePath> <outputDir>
import fs from 'node:fs/promises';

const [base, debug, workspaceId, initialSnapshotId, baseOid, fixturePath, outDir] = process.argv.slice(2);
if (![base, debug, workspaceId, initialSnapshotId, baseOid, fixturePath, outDir].every(Boolean)) {
  throw new Error('Usage: verify-git-review-ui.mjs <appBase> <chromiumDebugBase> <workspaceId> <snapshotId> <baseOid> <fixturePath> <outputDir>');
}
await fs.mkdir(outDir, { recursive: true });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const failures = [];
const network = [];
const reviewResponses = [];
const pendingReviews = new Map();
const pageErrors = [];

function check(label, condition, detail) {
  const pass = !!condition;
  const result = { label, pass, ...(detail === undefined ? {} : { detail }) };
  checks.push(result);
  if (!pass) failures.push(result);
  console.log(pass ? 'PASS' : 'FAIL', label, detail === undefined ? '' : JSON.stringify(detail));
  return pass;
}

async function until(fn, label, tries = 300, delay = 200) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch { /* wait for React/CDP state */ }
    await pause(delay);
  }
  throw new Error(`Timed out: ${label}`);
}

const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
const cdp = (method, params = {}) => {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
};
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      message.error ? waiting.reject(new Error(JSON.stringify(message.error))) : waiting.resolve(message.result);
    }
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    pageErrors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
  } else if (message.method === 'Network.requestWillBeSent') {
    const request = message.params.request;
    const isReview = /\/api\/workspaces\/[^/]+\/reviews(?:\?|$)/.test(request.url);
    const record = { method: request.method, url: request.url, status: null };
    network.push(record);
    if (isReview) {
      let body = null;
      try { body = request.postData ? JSON.parse(request.postData) : null; } catch { body = { invalidJson: true }; }
      pendingReviews.set(message.params.requestId, { body });
    }
  } else if (message.method === 'Network.responseReceived') {
    const request = network.find(item => item.url === message.params.response.url && item.status === null);
    if (request) request.status = message.params.response.status;
    const review = pendingReviews.get(message.params.requestId);
    if (review) review.status = message.params.response.status;
  } else if (message.method === 'Network.loadingFinished') {
    const review = pendingReviews.get(message.params.requestId);
    if (review) {
      pendingReviews.delete(message.params.requestId);
      void cdp('Network.getResponseBody', { requestId: message.params.requestId }).then(result => {
        const text = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
        reviewResponses.push({ ...review, response: JSON.parse(text) });
      }).catch(error => pageErrors.push(`Could not capture review response: ${error.message}`));
    }
  }
};

const evaluate = async expression => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const screenshot = async name => {
  await pause(500);
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(result.data, 'base64'));
  console.log('screenshot', name);
};
const clickButton = async (selector, label) => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});b.click();return true})()`);
const clickButtonText = async (text, parentSelector = 'button') => evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(parentSelector)})].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button text: '+${JSON.stringify(text)});b.scrollIntoView({block:'nearest'});b.click();return true})()`);
const setValue = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const cyExpr = `document.querySelector('.graph-canvas')?._cyreg?.cy`;
const graphState = async () => evaluate(`(()=>{const cy=${cyExpr};if(!cy)return null;const key=n=>n.data('qualifiedName')||n.data('simpleName')||n.id();return {
  nodes:cy.nodes().map(n=>({id:n.id(),key:key(n),name:n.data('simpleName'),kind:n.data('kind'),change:n.data('reviewChange')||null,
    expanded:!!n.data('expanded'),parent:n.parent().length?key(n.parent()):null,position:{x:n.position('x'),y:n.position('y')},
    cardSize:{width:n.data('cardWidth'),height:n.data('cardHeight')},minSize:{width:n.data('minW'),height:n.data('minH')},
    renderedSize:{width:n.width(),height:n.height()},children:n.children().map(child=>key(child)),drawn:n.visible(),
    added:n.data('reviewAddedLines'),removed:n.data('reviewRemovedLines'),background:n.style('background-color')})),
  edges:cy.edges().map(e=>({id:e.id(),source:key(e.source()),target:key(e.target()),change:e.data('reviewChange')||null,
    color:e.style('line-color'),lineStyle:e.style('line-style')})),
  zoom:cy.zoom(),pan:cy.pan()
};})()`);
const scopeState = async () => evaluate(`(()=>[...document.querySelectorAll('.scope-checkbox')].map(e=>({label:e.getAttribute('aria-label'),checked:e.checked,mixed:e.indeterminate,aria:e.getAttribute('aria-checked')})))()`);
const selectedName = async () => evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent?.trim()||null`);
const nodeNamed = (state, name) => state?.nodes?.find(node => node.name === name);
const colorIs = (value, hex, rgb) => {
  const normalized = String(value || '').toLowerCase().replace(/\s/g, '');
  return normalized === hex.toLowerCase() || normalized === rgb.toLowerCase();
};
const clickGraphNode = async name => {
  await evaluate(`(()=>{const cy=${cyExpr};const n=cy.nodes().filter(x=>x.data('simpleName')===${JSON.stringify(name)}).first();if(!n||!n.length)throw Error('Missing graph node ${name}');n.emit('tap');return true})()`);
  await pause(400);
};
const routeStyles = async () => evaluate(`(()=>{const cy=${cyExpr};const key=n=>n.data('qualifiedName')||n.data('simpleName')||n.id();return cy.edges().map(e=>({id:e.id(),source:key(e.source()),target:key(e.target()),change:e.data('reviewChange')||null,color:e.style('line-color'),arrow:e.style('target-arrow-color'),glow:e.style('underlay-color'),flowIn:e.hasClass('flow-in'),flowOut:e.hasClass('flow-out'),lineStyle:e.style('line-style'),dashPattern:e.style('line-dash-pattern')}))})()`);
const waitForMap = async (label = 'code map') => until(() => evaluate(`!!${cyExpr} && ${cyExpr}.nodes().length > 0`), label);
const waitForReview = async (enabled, label) => {
  await until(() => evaluate(`document.querySelector('.review-toggle')?.getAttribute('aria-pressed')===${JSON.stringify(String(enabled))}`), label);
  if (enabled) await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('reviewChange'))`), `${label} overlay`);
  await pause(600);
};
const readSourceDialog = async () => evaluate(`(()=>{const dialog=document.querySelector('.source-dialog');return dialog?{
  heading:dialog.querySelector('header h2')?.textContent||'',addRows:dialog.querySelectorAll('.diff-row-add').length,
  delRows:dialog.querySelectorAll('.diff-row-del').length,hasDiff:!!dialog.querySelector('.diff-unified,.diff-split-table'),
  hasSplitTable:!!dialog.querySelector('.diff-split-table'),
  layoutButtons:[...dialog.querySelectorAll('.diff-layout-toggle button')].map(b=>({text:b.textContent.trim(),pressed:b.getAttribute('aria-pressed')})),
  plainLines:dialog.querySelectorAll('pre:not(.diff-unified) .code-line').length,open:dialog.open
}:null})()`);

// Layout state is compared by semantic qualified names because ordinary and review snapshot IDs are
// intentionally different. Positions, parent chains and camera are the user-visible exploration
// state that must survive the mode switch; review badges/colors are allowed to change.
const stateSummary = state => state && ({
  // Overlay-only nodes can be inserted in a different Cytoscape order after a tab remount. Their
  // semantic state is stable, so canonicalize by qualified/simple name before exact comparisons.
  nodes: state.nodes.map(n => ({ key: n.key, name: n.name, kind: n.kind, expanded: n.expanded, parent: n.parent, x: Math.round(n.position.x), y: Math.round(n.position.y), change: n.change })).sort((a, b) => a.key.localeCompare(b.key)),
  zoom: Number(state.zoom.toFixed(4)), pan: { x: Number(state.pan.x.toFixed(2)), y: Number(state.pan.y.toFixed(2)) }
});
const layoutDifferences = (before, after) => {
  if (!before || !after) return [{ reason: 'missing graph state', before: !!before, after: !!after }];
  const diffs = [];
  const left = new Map(before.nodes.map(n => [n.key, n])), right = new Map(after.nodes.map(n => [n.key, n]));
  // A Base+changes overlay legitimately adds base-only resources (removed/unknown declarations)
  // that are absent from the ordinary after snapshot. Every ordinary survivor must still be found;
  // overlay-only nodes are checked separately below and are not layout regressions.
  for (const key of left.keys()) {
    const a = left.get(key), b = right.get(key);
    if (!b) { diffs.push({ key, reason: 'ordinary survivor missing from target', before: true, after: false }); continue; }
    if (a.expanded !== b.expanded || a.parent !== b.parent) diffs.push({ key, reason: 'expansion/parent', before: { expanded: a.expanded, parent: a.parent }, after: { expanded: b.expanded, parent: b.parent } });
    // A compound node's rendered box is derived from all of its children. The overlay can add a
    // removed/unknown child, so its bounds and centroid may legitimately grow or move. Leaf cards
    // have no such derived geometry: compare their rendered position and width/height directly.
    const leafBefore = (a.children || []).length === 0;
    const leafAfter = (b.children || []).length === 0;
    if (leafBefore && leafAfter && (Math.abs(a.position.x - b.position.x) > 1.5 || Math.abs(a.position.y - b.position.y) > 1.5)) {
      diffs.push({ key, reason: 'survivor leaf position', before: a.position, after: b.position });
    }
    if (leafBefore && leafAfter && (Math.abs((a.renderedSize?.width || 0) - (b.renderedSize?.width || 0)) > 1.5 || Math.abs((a.renderedSize?.height || 0) - (b.renderedSize?.height || 0)) > 1.5)) {
      diffs.push({ key, reason: 'survivor leaf rendered size', before: a.renderedSize, after: b.renderedSize });
    }
    // Card dimensions and user-resized minimum dimensions are persisted state even for compounds;
    // compare them independently of the derived compound bounds.
    if (Math.abs((a.cardSize?.width || 0) - (b.cardSize?.width || 0)) > 1.5 || Math.abs((a.cardSize?.height || 0) - (b.cardSize?.height || 0)) > 1.5) {
      diffs.push({ key, reason: 'persisted card size', before: a.cardSize, after: b.cardSize });
    }
    if (Math.abs((a.minSize?.width || 0) - (b.minSize?.width || 0)) > 1.5 || Math.abs((a.minSize?.height || 0) - (b.minSize?.height || 0)) > 1.5) {
      diffs.push({ key, reason: 'persisted minimum size', before: a.minSize, after: b.minSize });
    }
  }
  if (Math.abs(before.zoom - after.zoom) > .01 || Math.abs(before.pan.x - after.pan.x) > 1 || Math.abs(before.pan.y - after.pan.y) > 1) diffs.push({ reason: 'camera', before: { zoom: before.zoom, pan: before.pan }, after: { zoom: after.zoom, pan: after.pan } });
  return diffs;
};
const packageScope = async name => evaluate(`(()=>{const input=[...document.querySelectorAll('.scope-checkbox')].find(e=>(e.getAttribute('aria-label')||'').includes('package ${name} '));return input?{label:input.getAttribute('aria-label'),checked:input.checked,mixed:input.indeterminate,aria:input.getAttribute('aria-checked')}:null})()`);

await cdp('Runtime.enable');
await cdp('Network.enable');
await cdp('Page.enable');
await cdp('Page.bringToFront');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${base}/?snapshotId=${encodeURIComponent(initialSnapshotId)}` });
await waitForMap('initial package map');
await pause(700);

check('package-only explorer has no removed graph-level switcher', !(await evaluate(`!!document.querySelector('[aria-label="Graph level"]')`)));
const initial = await graphState();
check('initial map includes the two fixture packages', initial.nodes.some(n => n.name === 'review') && initial.nodes.some(n => n.name === 'support'), stateSummary(initial));

// Establish a meaningful package-only state: one package is out of scope, the other package is
// expanded, one class inside it is expanded, and a method is inspected. This is the state Step 0
// promises to preserve while only review colors/inspection behavior change.
await clickButton('input[aria-label^="Remove package support"]', 'remove support package from scope');
await until(async () => !(await packageScope('support'))?.checked, 'support package leaves scope');
await clickButton('button[aria-label="Show types inside review"]', 'expand review package');
// GraphCanvas stores the display parent as Cytoscape's compound-node parent. It deliberately
// strips the model-only containerId from element data, so inspect the live parent relationship here.
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='Hub'&&n.parent().length>0)`), 'classes inside expanded review package');
await clickButton('button[aria-label="Show methods inside Hub"]', 'expand Hub class');
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='changed'&&n.parent().length>0)`), 'methods inside expanded Hub');
await clickGraphNode('Hub');
// The nested method may sit outside the viewport after the two expansions. Bring it
// into view so its keyboard resize grip is mounted by the map's visible-grip filter.
await until(() => evaluate(`!!${cyExpr} && ${cyExpr}.nodes().some(n=>n.data('simpleName')==='changed')`), 'changed method after expansion');
await evaluate(`(()=>{const cy=${cyExpr};cy.center(cy.nodes().filter(n=>n.data('simpleName')==='changed'));return true})()`);
await pause(400);

// Resize a real leaf through the same keyboard path exposed to users. Its persisted dimensions are
// then part of the ordinary state that the first Changes toggle must carry across.
const ordinaryBeforeResize = await graphState();
const resizeTargetBefore = nodeNamed(ordinaryBeforeResize, 'changed');
await evaluate(`(()=>{const grip=[...document.querySelectorAll('.map-resize-grip')].find(button=>(button.getAttribute('aria-label')||'').startsWith('Resize changed'));if(!grip)throw Error('Missing changed-method resize grip');grip.focus();grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return document.activeElement===grip})()`);
await pause(800);
const ordinaryAfterResize = await graphState();
const resizeTargetAfter = nodeNamed(ordinaryAfterResize, 'changed');
check('ordinary mode accepts an actual keyboard resize of a survivor leaf',
  !!resizeTargetBefore && !!resizeTargetAfter &&
  (resizeTargetAfter.cardSize.width - resizeTargetBefore.cardSize.width) >= 10 &&
  Math.abs(resizeTargetAfter.cardSize.height - resizeTargetBefore.cardSize.height) <= 1,
  { before: resizeTargetBefore, after: resizeTargetAfter });

// A real geometry edit and camera edit exercise the persisted state instead of only checking the
// initial fit. dragfree goes through the same callback as a user drag; pan/zoom goes through the
// normal debounced camera path.
const ordinaryBeforeEdit = ordinaryAfterResize;
await evaluate(`(()=>{const cy=${cyExpr};const n=cy.nodes().filter(x=>x.data('simpleName')==='changed').first();if(!n||!n.length)throw Error('Missing changed method');const p=n.position();n.position({x:p.x+83,y:p.y+41});n.emit('dragfree');cy.pan({x:cy.pan().x+37,y:cy.pan().y-19});cy.zoom(cy.zoom()*1.08);return true})()`);
await pause(800);
const ordinaryEdited = await graphState();
const ordinaryScope = await packageScope('support');
const ordinarySelected = await selectedName();
check('ordinary map records the edited layout, camera, selection and narrowed scope',
  ordinaryEdited.nodes.some(n=>n.expanded&&n.name==='review') && ordinaryEdited.nodes.some(n=>n.expanded&&n.name==='Hub') &&
  ordinarySelected === 'Hub' && ordinaryScope && !ordinaryScope.checked,
  { state: stateSummary(ordinaryEdited), supportScope: ordinaryScope, selected: ordinarySelected });
const ordinaryBeforeChanged = nodeNamed(ordinaryBeforeEdit, 'changed');
const ordinaryAfterChanged = nodeNamed(ordinaryEdited, 'changed');
check('ordinary mode accepts a leaf position and camera edit before first activation',
  !!ordinaryBeforeChanged && !!ordinaryAfterChanged &&
  (Math.abs(ordinaryBeforeChanged.position.x - ordinaryAfterChanged.position.x) > 1 || Math.abs(ordinaryBeforeChanged.position.y - ordinaryAfterChanged.position.y) > 1) &&
  (Math.abs(ordinaryBeforeEdit.zoom - ordinaryEdited.zoom) > .01 || Math.abs(ordinaryBeforeEdit.pan.x - ordinaryEdited.pan.x) > 1 || Math.abs(ordinaryBeforeEdit.pan.y - ordinaryEdited.pan.y) > 1),
  { before: { node: ordinaryBeforeChanged, zoom: ordinaryBeforeEdit.zoom, pan: ordinaryBeforeEdit.pan }, after: { node: ordinaryAfterChanged, zoom: ordinaryEdited.zoom, pan: ordinaryEdited.pan } });
await screenshot('01-ordinary-layout-before-changes');

// The review projection reuses the ordinary display IDs for unambiguous survivors. Keep the actual
// Cytoscape objects so this acceptance catches a remount/rebuild that happens to reproduce the same
// numbers while silently losing the user's live canvas state.
await evaluate(`(()=>{const cy=${cyExpr};const key=n=>n.data('qualifiedName')||n.data('simpleName')||n.id();const saved={};for(const name of ['review','Hub','KeepDep','changed']){const node=cy.nodes().filter(n=>n.data('simpleName')===name||key(n)===name).first();if(node&&node.length)saved[name]=node[0];}window.__step0Canvas=cy;window.__step0CanvasElement=document.querySelector('.graph-canvas');window.__step0SurvivorNodes=saved;return Object.keys(saved)})()`);

// Set an explicit base so the source diff and statuses are deterministic, then enter Changes for
// the first time. The review request remains UI-owned; this test never seeds comparison state via API.
await clickButton('.review-options summary', 'review comparison options');
await setValue('input[placeholder="Default merge base, or origin/main"]', baseOid);
await pause(100);
await clickButton('.review-options summary', 'close review comparison options');
await clickButton('.review-toggle', 'Changes toggle on');
await until(() => reviewResponses.some(item => item.response), 'Git comparison captured');
await waitForReview(true, 'Changes on');
const reviewFirst = await graphState();
const reviewScope = await packageScope('support');
const firstDiffs = layoutDifferences(ordinaryEdited, reviewFirst);
check('first Changes toggle preserves map membership, positions, camera and expansion tree', firstDiffs.length === 0,
  { differences: firstDiffs, ordinary: stateSummary(ordinaryEdited), review: stateSummary(reviewFirst) });
const reviewSelected = await selectedName();
check('first Changes toggle preserves the selected resource and package scope', reviewSelected === 'Hub' && reviewScope && !reviewScope.checked,
  { selected: reviewSelected, supportScope: reviewScope });
const firstIdentity = await evaluate(`(()=>{const cy=${cyExpr};const currentCanvas=document.querySelector('.graph-canvas');const saved=window.__step0SurvivorNodes||{};const nodes=Object.fromEntries(Object.entries(saved).map(([name,node])=>{const current=cy.getElementById(node.id());return [name,{id:node.id(),same:current.length>0&&current[0]===node}] }));return {canvasSame:cy===window.__step0Canvas,canvasElementSame:currentCanvas===window.__step0CanvasElement,nodes}})()`);
check('first Changes toggle keeps the same canvas and surviving Cytoscape node objects',
  firstIdentity.canvasSame && firstIdentity.canvasElementSame && Object.values(firstIdentity.nodes).length === 4 && Object.values(firstIdentity.nodes).every(node => node.same), firstIdentity);
const reviewHub = nodeNamed(reviewFirst, 'Hub');
check('review overlay changes styling/facts while retaining the same resource', !!reviewHub && reviewHub.change === 'MODIFIED', reviewHub);
const addedRoute = reviewFirst.edges.find(e => e.change === 'ADDED');
const removedRoute = reviewFirst.edges.find(e => e.change === 'REMOVED');
check('review colors remain parser-owned (added green and removed red)',
  !!addedRoute && colorIs(addedRoute.color, '#168a58', 'rgb(22,138,88)') && !!removedRoute && colorIs(removedRoute.color, '#c74545', 'rgb(199,69,69)'),
  { added: addedRoute, removed: removedRoute });
const unknownRoute = reviewFirst.edges.find(e => e.change === 'UNKNOWN');
const brokenCard = nodeNamed(reviewFirst, 'Broken');
const oldCard = nodeNamed(reviewFirst, 'OldDep');
const newCard = nodeNamed(reviewFirst, 'NewDep');
const untrackedCard = nodeNamed(reviewFirst, 'UntrackedHelper');
const reviewFacts = reviewResponses.find(item => item.response)?.response;
const removedLegacyPackage = reviewFacts?.nodes?.find(row => row.change === 'REMOVED' && (row.base?.simpleName === 'legacy' || row.base?.qualifiedName === 'legacy'));
check('overlay keeps parser uncertainty visible as an unknown dotted route/card',
  !!unknownRoute && unknownRoute.lineStyle === 'dotted' && colorIs(unknownRoute.color, '#ba862d', 'rgb(186,134,45)') && brokenCard?.change === 'UNKNOWN',
  { route: unknownRoute, card: brokenCard });
check('comparison retains a removed whole-package fact for the scope boundary', !!removedLegacyPackage, removedLegacyPackage && { change: removedLegacyPackage.change, base: removedLegacyPackage.base });
check('overlay retains removed, added and unchanged resource facts beside the ordinary survivors',
  oldCard?.change === 'REMOVED' && newCard?.change === 'ADDED' && untrackedCard?.change === 'ADDED' && reviewFirst.nodes.some(n => n.name === 'KeepDep' && n.change === 'UNCHANGED'),
  { removed: oldCard, added: newCard, untracked: untrackedCard, unchanged: nodeNamed(reviewFirst, 'KeepDep') });
check('added, removed and modified resource fills are distinct',
  colorIs(newCard?.background, '#e9f8ef', 'rgb(233,248,239)') &&
  colorIs(oldCard?.background, '#fdecec', 'rgb(253,236,236)') &&
  colorIs(nodeNamed(reviewFirst, 'Hub')?.background, '#fff4c8', 'rgb(255,244,200)'),
  {added:newCard?.background,removed:oldCard?.background,modified:nodeNamed(reviewFirst, 'Hub')?.background});
check('overlay keeps real removed and unknown resources drawn on the scoped map',
  !!oldCard?.drawn && !!brokenCard?.drawn && !reviewFirst.nodes.some(n => n.name === 'support' || n.name === 'Stable' || n.name === 'legacy' || n.name === 'Retired'),
  { removed: oldCard, unknown: brokenCard, excludedPackages: reviewFirst.nodes.filter(n => ['support', 'Stable', 'legacy', 'Retired'].includes(n.name)) });
check('overlay aggregates occurrences by endpoint and change status without merging statuses',
  reviewFirst.edges.length === new Set(reviewFirst.edges.map(e => `${e.source}->${e.target}|${e.change}`)).size,
  reviewFirst.edges.map(e => `${e.source}->${e.target}|${e.change}`));
const statusByPair = new Map();
for (const edge of reviewFirst.edges) {
  const pair = `${edge.source}->${edge.target}`;
  if (!statusByPair.has(pair)) statusByPair.set(pair, new Set());
  statusByPair.get(pair).add(edge.change);
}
const separateSamePairStatuses = [...statusByPair.entries()].filter(([, statuses]) => statuses.has('UNCHANGED') && statuses.has('REMOVED'));
check('overlay keeps removed and unchanged routes separate for the same endpoint pair', separateSamePairStatuses.length > 0,
  separateSamePairStatuses.map(([pair, statuses]) => ({ pair, statuses: [...statuses] })));
await screenshot('02-changes-preserved-layout');

// In Changes mode, code inspection upgrades a changed file to a real diff.
await clickButton('.inspector .view-code-action', 'View changed class code');
await until(async () => (await readSourceDialog())?.open, 'review source dialog open');
await until(async () => { const d = await readSourceDialog(); return d && (d.addRows > 0 || d.delRows > 0); }, 'review diff rows rendered');
const reviewDialog = await readSourceDialog();
check('Changes inspection opens a unified diff for a changed file', reviewDialog.hasDiff && reviewDialog.addRows > 0 && reviewDialog.delRows > 0 && reviewDialog.layoutButtons.some(b => b.text === 'Unified' && b.pressed === 'true'), reviewDialog);
await clickButtonText('Split', '.diff-layout-toggle button');
await until(async () => (await readSourceDialog())?.hasSplitTable, 'review split diff rendered');
check('review source inspection can switch to split diff', (await readSourceDialog())?.hasSplitTable === true);
const sourceRequestsBefore = network.filter(item => /\/api\/snapshots\/[^/]+\/files\/source/.test(item.url)).length;
await setValue('#global-search', 'Hu');
await setValue('#global-search', '');
await pause(1200);
const sourceRequestsAfter = network.filter(item => /\/api\/snapshots\/[^/]+\/files\/source/.test(item.url)).length;
check('an open review diff does not refetch pinned source during unrelated renders', sourceRequestsAfter === sourceRequestsBefore, { sourceRequestsBefore, sourceRequestsAfter });
await evaluate(`document.querySelector('.source-dialog button[aria-label="Close source"]')?.click()`);

// Selection leaves factual route colors intact; the related-node halos carry direction.
await evaluate(`document.querySelector('.inspector button[aria-label="Close inspector"]')?.click()`);
await until(() => evaluate(`!${cyExpr}.edges().some(e=>e.hasClass('flow-in')||e.hasClass('flow-out'))`), 'unselected route baseline');
const routesBeforeSelection = await routeStyles();
await clickGraphNode('KeepDep');
const selectedStyles = await routeStyles();
const unchangedIncoming = selectedStyles.find(e => e.target === 'review.KeepDep' && e.change === 'UNCHANGED' && e.flowIn)
  || selectedStyles.find(e => e.target.endsWith('.KeepDep') && e.change === 'UNCHANGED' && e.flowIn);
check('selection preserves every factual review route color', selectedStyles.every(e => { const before=routesBeforeSelection.find(item=>item.id===e.id); return before?.color===e.color&&before?.arrow===e.arrow; }),
  {before: routesBeforeSelection, selected: selectedStyles});
check('selected review routes have directional margins and moving patterns', selectedStyles.filter(e=>e.flowIn||e.flowOut).length>0&&selectedStyles.filter(e=>e.flowIn||e.flowOut).every(e=>colorIs(e.glow,e.flowIn?'#6366f1':'#0ea5e9',e.flowIn?'rgb(99,102,241)':'rgb(14,165,233)')&&e.lineStyle===(e.change==='UNKNOWN'?'dotted':'dashed')), selectedStyles);
check('unchanged incoming route stays light gray when selected', !!unchangedIncoming && colorIs(unchangedIncoming.color, '#aab6c4', 'rgb(170,182,196)') && colorIs(unchangedIncoming.arrow, '#768698', 'rgb(118,134,152)'), unchangedIncoming);
check('direction overlay and animated dash phase are active', await evaluate(`(()=>{const cy=${cyExpr};const c=document.querySelector('.graph-direction-overlay');return !!c&&c.width>0&&cy.scratch('atlas:dashPhase')>0})()`));
await evaluate(`(()=>{const cy=${cyExpr};cy.fit(cy.elements(),42);return true})()`);
await screenshot('03-selected-change-colors-and-dashes');
// Direct edge selection overrides every review color, then restores it on deselection.
const directEdgeChecks = await evaluate(`(()=>{const cy=${cyExpr};const result=[];for(const change of ['ADDED','REMOVED','UNKNOWN','UNCHANGED']){const edge=cy.edges().filter(e=>e.data('reviewChange')===change)[0];if(!edge)continue;const before=edge.style('line-color');edge.addClass('inspected');const black=['line-color','target-arrow-color','underlay-color'].every(key=>edge.style(key).replaceAll(' ','')==='rgb(0,0,0)');edge.removeClass('inspected');result.push({change,black,restored:edge.style('line-color')===before});}return result})()`);
check('direct edge inspection is black for every review status and restores factual colors', directEdgeChecks.length===4&&directEdgeChecks.every(e=>e.black&&e.restored), directEdgeChecks);
await clickGraphNode('Hub');

// Base-only source remains inspectable after the working tree deletes its file, and its pinned
// dialog is an all-removed diff rather than an invented after-side source.
await clickGraphNode('OldDep');
await clickButton('.inspector .view-code-action', 'View removed class code');
await until(async () => (await readSourceDialog())?.open, 'removed source dialog open');
await until(async () => (await readSourceDialog())?.delRows > 0, 'removed source diff rendered');
const removedDialog = await readSourceDialog();
check('removed resource source stays pinned as all removed lines', removedDialog.delRows > 0 && removedDialog.addRows === 0, removedDialog);
await evaluate(`document.querySelector('.source-dialog button[aria-label="Close source"]')?.click()`);
await clickGraphNode('Hub');

// Edit the layout while Changes is on. Turning it back off must carry this later edit with it, too.
const reviewBeforeEdit = await graphState();
await evaluate(`(()=>{const cy=${cyExpr};const n=cy.nodes().filter(x=>x.data('simpleName')==='changed').first();if(!n||!n.length)throw Error('Missing changed method in review');const p=n.position();n.position({x:p.x-47,y:p.y+29});n.emit('dragfree');cy.pan({x:cy.pan().x-23,y:cy.pan().y+31});return true})()`);
await pause(800);
const reviewEdited = await graphState();
const reviewBeforeChanged = nodeNamed(reviewBeforeEdit, 'changed');
const reviewAfterChanged = nodeNamed(reviewEdited, 'changed');
check('Changes mode accepts a later leaf position and camera edit',
  !!reviewBeforeChanged && !!reviewAfterChanged &&
  (Math.abs(reviewBeforeChanged.position.x - reviewAfterChanged.position.x) > 1 || Math.abs(reviewBeforeChanged.position.y - reviewAfterChanged.position.y) > 1) &&
  (Math.abs(reviewBeforeEdit.zoom - reviewEdited.zoom) > .01 || Math.abs(reviewBeforeEdit.pan.x - reviewEdited.pan.x) > 1 || Math.abs(reviewBeforeEdit.pan.y - reviewEdited.pan.y) > 1),
  { before: { node: reviewBeforeChanged, zoom: reviewBeforeEdit.zoom, pan: reviewBeforeEdit.pan }, after: { node: reviewAfterChanged, zoom: reviewEdited.zoom, pan: reviewEdited.pan } });
await clickButton('.review-toggle', 'Changes toggle off');
await waitForReview(false, 'Changes off after layout edit');
const ordinaryAfterOff = await graphState();
const scopeAfterOff = await packageScope('support');
// Compare from ordinary -> overlay so base-only removed/unknown cards that disappear when Changes
// is turned off are allowed, while every ordinary survivor is still required to match.
const offDiffs = layoutDifferences(ordinaryAfterOff, reviewEdited);
const offSelected = await selectedName();
check('turning Changes off preserves the later layout and camera edit', offDiffs.length === 0, { differences: offDiffs, review: stateSummary(reviewEdited), ordinary: stateSummary(ordinaryAfterOff) });
check('turning Changes off preserves scope and selection', offSelected === 'Hub' && scopeAfterOff && !scopeAfterOff.checked, { selected: offSelected, supportScope: scopeAfterOff });
const ordinaryIdentityAfterOff = await evaluate(`(()=>{const cy=${cyExpr};const currentCanvas=document.querySelector('.graph-canvas');const saved=window.__step0SurvivorNodes||{};const nodes=Object.fromEntries(Object.entries(saved).map(([name,node])=>{const current=cy.getElementById(node.id());return [name,{id:node.id(),same:current.length>0&&current[0]===node}] }));return {canvasSame:cy===window.__step0Canvas,canvasElementSame:currentCanvas===window.__step0CanvasElement,nodes}})()`);
check('turning Changes off keeps the same canvas and surviving Cytoscape node objects',
  ordinaryIdentityAfterOff.canvasSame && ordinaryIdentityAfterOff.canvasElementSame && Object.values(ordinaryIdentityAfterOff.nodes).length === 4 && Object.values(ordinaryIdentityAfterOff.nodes).every(node => node.same), ordinaryIdentityAfterOff);
check('turning Changes off clears review facts from existing canvas elements',
  ordinaryAfterOff.nodes.every(node => node.change === null) && ordinaryAfterOff.edges.every(edge => edge.change === null),
  { staleNodes: ordinaryAfterOff.nodes.filter(node => node.change !== null), staleEdges: ordinaryAfterOff.edges.filter(edge => edge.change !== null) });

// The toggle itself is the latest exploration action. Undo/redo must be checked before opening or
// closing ordinary source, since source inspection has its own history entry.
await clickButton('button[title^="Undo last exploration action"]', 'undo Changes toggle');
await waitForReview(true, 'undo returns to Changes');
const reviewAfterUndo = await graphState();
const undoDiffs = layoutDifferences(reviewEdited, reviewAfterUndo);
const undoSelected = await selectedName();
check('undo restores Changes mode and its preserved layout in one step', undoDiffs.length === 0 && undoSelected === 'Hub', { differences: undoDiffs, state: stateSummary(reviewAfterUndo) });
await clickButton('button[title^="Redo"]', 'redo Changes toggle');
await waitForReview(false, 'redo returns to ordinary map');
const ordinaryAfterRedo = await graphState();
const redoDiffs = layoutDifferences(ordinaryAfterRedo, reviewEdited);
const redoSelected = await selectedName();
check('redo restores ordinary mode without resetting the layout', redoDiffs.length === 0 && redoSelected === 'Hub', { differences: redoDiffs.slice(0, 8), state: stateSummary(ordinaryAfterRedo) });

// Ordinary inspection goes back to the pinned source, with no diff controls or +/- rows.
await clickButton('.inspector .view-code-action', 'View ordinary class code');
await until(async () => (await readSourceDialog())?.open, 'ordinary source dialog open');
await until(async () => (await readSourceDialog())?.plainLines > 0, 'ordinary source lines rendered');
const ordinaryDialog = await readSourceDialog();
check('ordinary inspection has plain source behavior after Changes is off', !ordinaryDialog.hasDiff && ordinaryDialog.layoutButtons.length === 0 && ordinaryDialog.addRows === 0 && ordinaryDialog.delRows === 0 && ordinaryDialog.plainLines > 0, ordinaryDialog);
await screenshot('03-ordinary-after-changes-off');
// Leave ordinary source open: switching presentation must invalidate this dialog.

// Enter Changes again after the edits; both directions now exercise a non-initial state. The second
// tab is deliberately changed independently to prove mode/layout state belongs to each tab.
await clickButton('.review-toggle', 'Changes toggle on after redo');
await waitForReview(true, 'Changes on after redo');
check('entering Changes closes an open ordinary symbol source dialog', !(await readSourceDialog())?.open);
const reviewRoundTrip = await graphState();
const roundTripDiffs = layoutDifferences(reviewEdited, reviewRoundTrip);
check('a second toggle-on restores the edited review layout', roundTripDiffs.length === 0, { differences: roundTripDiffs });
const firstTabState = stateSummary(reviewRoundTrip);
await clickButtonText('+ New tab');
await until(() => evaluate(`document.querySelector('.journey-tab.active .journey-review-tag')!==null`), 'new tab active in Changes mode');
check('new tab inherits only the current mode, with its own exploration state', await evaluate(`!!document.querySelector('.journey-tab.active .journey-review-tag') && document.querySelectorAll('.journey-tab').length===2`));
await clickButton('.review-toggle', 'turn Changes off in second tab');
await waitForReview(false, 'second tab ordinary mode');
const secondTabState = await graphState();
check('second tab can switch mode without changing its sibling tab', !(await evaluate(`!!document.querySelector('.journey-tab.active .journey-review-tag')`)) && !secondTabState.nodes.some(n => n.change), stateSummary(secondTabState));
await evaluate(`document.querySelectorAll('[role="tab"]')[0]?.click()`);
await until(() => evaluate(`document.querySelectorAll('[role="tab"]')[0]?.getAttribute('aria-selected')==='true'`), 'return to first tab');
await waitForReview(true, 'first tab remains in Changes mode');
const firstTabRestored = await graphState();
const firstTabDiffs = layoutDifferences(reviewRoundTrip, firstTabRestored);
const firstTabSelected = await selectedName();
check('switching tabs restores the first tab mode and layout independently',
  firstTabDiffs.length === 0 && JSON.stringify(firstTabState) === JSON.stringify(stateSummary(firstTabRestored)) && firstTabSelected === 'Hub',
  { differences: firstTabDiffs, first: firstTabState, restored: stateSummary(firstTabRestored), selected: firstTabSelected });
await screenshot('04-first-tab-restored');

// Ordinary edge inspection and its source belong to the analyzed snapshot, not the comparison.
await clickButton('.review-toggle', 'ordinary mode before recompare');
await waitForReview(false, 'ordinary mode before recompare');
await evaluate(`(()=>{const edge=${cyExpr}.edges().first();if(!edge.length)throw Error('Missing ordinary edge');edge.emit('tap');return edge.id()})()`);
await until(() => evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent.includes('→')`), 'ordinary relationship inspected');
const ordinaryEdgeHeading = await evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent`);
await evaluate(`(()=>{const b=[...document.querySelectorAll('.inspector button')].find(b=>b.textContent.startsWith('View source evidence'));if(!b)throw Error('Missing relationship source button');b.click()})()`);
await until(async () => (await readSourceDialog())?.open, 'ordinary relationship source open');

// Recompare remains a supported review action. The button itself issues a fresh capture, so this
// acceptance does not edit the fixture merely to make the request distinguishable; the Python
// wrapper can therefore prove the imported source and Git index stayed byte-for-byte unchanged.
await clickButton('.review-options summary', 'review options for recompare');
await clickButtonText('Recompare');
await until(() => reviewResponses.filter(item => item.response).length >= 2, 'recompare issued a fresh comparison');
await until(() => evaluate(`document.querySelector('.review-toggle')?.disabled===false`), 'recapture state applied');
await pause(500);
check('Recompare preserves ordinary relationship inspection', await evaluate(`document.querySelector('.inspector .subject-heading h2')?.textContent`) === ordinaryEdgeHeading);
check('Recompare preserves an open ordinary relationship source dialog', (await readSourceDialog())?.open === true);
await screenshot('05-ordinary-relationship-after-recompare');

const failed = failures.length > 0 || pageErrors.length > 0;
await fs.writeFile(`${outDir}/report.json`, JSON.stringify({ checks, pageErrors, network: network.length, reviewResponses: reviewResponses.length }, null, 2));
console.log(`Checks: ${checks.filter(c => c.pass).length}/${checks.length}; page errors: ${pageErrors.length}`);
if (pageErrors.length) console.log('Page errors:', pageErrors);
socket.close();
process.exit(failed ? 1 : 0);
