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
const routeStyles = async () => evaluate(`(()=>{const cy=${cyExpr};const key=n=>n.data('qualifiedName')||n.data('simpleName')||n.id();return cy.edges().map(e=>({id:e.id(),source:key(e.source()),target:key(e.target()),change:e.data('reviewChange')||null,color:e.style('line-color'),glow:e.style('underlay-color'),flowIn:e.hasClass('flow-in'),flowOut:e.hasClass('flow-out'),lineStyle:e.style('line-style')}))})()`);
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
  nodes: state.nodes.map(n => ({ key: n.key, name: n.name, kind: n.kind, expanded: n.expanded, parent: n.parent, x: Math.round(n.position.x), y: Math.round(n.position.y), change: n.change })),
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
    if (Math.abs(a.position.x - b.position.x) > 1.5 || Math.abs(a.position.y - b.position.y) > 1.5) diffs.push({ key, reason: 'position', before: a.position, after: b.position });
    if (!a.expanded && !b.expanded && (Math.abs((a.cardSize?.width || 0) - (b.cardSize?.width || 0)) > 1 || Math.abs((a.cardSize?.height || 0) - (b.cardSize?.height || 0)) > 1)) {
      diffs.push({ key, reason: 'card size', before: a.cardSize, after: b.cardSize });
    }
    if (a.expanded && b.expanded && (Math.abs((a.minSize?.width || 0) - (b.minSize?.width || 0)) > 1 || Math.abs((a.minSize?.height || 0) - (b.minSize?.height || 0)) > 1)) {
      diffs.push({ key, reason: 'expanded box minimum size', before: a.minSize, after: b.minSize });
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
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='Hub'&&n.data('containerId'))`), 'classes inside expanded review package');
await clickGraphNode('Hub');
await clickButton('button[aria-label="Show methods inside Hub"]', 'expand Hub class');
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='changed'&&n.data('containerId'))`), 'methods inside expanded Hub');
await clickGraphNode('Hub');

// A real geometry edit and camera edit exercise the persisted state instead of only checking the
// initial fit. dragfree goes through the same callback as a user drag; pan/zoom goes through the
// normal debounced camera path.
await evaluate(`(()=>{const cy=${cyExpr};const n=cy.nodes().filter(x=>x.data('simpleName')==='changed').first();if(!n||!n.length)throw Error('Missing changed method');const p=n.position();n.position({x:p.x+83,y:p.y+41});n.emit('dragfree');cy.pan({x:cy.pan().x+37,y:cy.pan().y-19});cy.zoom(cy.zoom()*1.08);return true})()`);
await pause(800);
const ordinaryEdited = await graphState();
const ordinaryScope = await packageScope('support');
const ordinarySelected = await selectedName();
check('ordinary map records the edited layout, camera, selection and narrowed scope',
  ordinaryEdited.nodes.some(n=>n.expanded&&n.name==='review') && ordinaryEdited.nodes.some(n=>n.expanded&&n.name==='Hub') &&
  ordinarySelected === 'Hub' && ordinaryScope && !ordinaryScope.checked,
  { state: stateSummary(ordinaryEdited), supportScope: ordinaryScope, selected: ordinarySelected });
await screenshot('01-ordinary-layout-before-changes');

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
check('overlay keeps parser uncertainty visible as an unknown dotted route/card',
  !!unknownRoute && unknownRoute.lineStyle === 'dotted' && colorIs(unknownRoute.color, '#ba862d', 'rgb(186,134,45)') && brokenCard?.change === 'UNKNOWN',
  { route: unknownRoute, card: brokenCard });
check('overlay retains removed, added and unchanged resource facts beside the ordinary survivors',
  oldCard?.change === 'REMOVED' && newCard?.change === 'ADDED' && untrackedCard?.change === 'ADDED' && reviewFirst.nodes.some(n => n.name === 'KeepDep' && n.change === 'UNCHANGED'),
  { removed: oldCard, added: newCard, untracked: untrackedCard, unchanged: nodeNamed(reviewFirst, 'KeepDep') });
check('overlay aggregates occurrences by endpoint and change status without merging statuses',
  reviewFirst.edges.length === new Set(reviewFirst.edges.map(e => `${e.source}->${e.target}|${e.change}`)).size,
  reviewFirst.edges.map(e => `${e.source}->${e.target}|${e.change}`));
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

// Selection emphasis must not turn an unchanged incoming route into the removed-route red. The
// review route's own status color remains factual while direction emphasis uses indigo for incoming.
await clickGraphNode('KeepDep');
const selectedStyles = await routeStyles();
const unchangedIncoming = selectedStyles.find(e => e.target === 'review.KeepDep' && e.change === 'UNCHANGED' && e.flowIn)
  || selectedStyles.find(e => e.target.endsWith('.KeepDep') && e.change === 'UNCHANGED' && e.flowIn);
check('selected review resource uses indigo for unchanged incoming flow', !!unchangedIncoming && !colorIs(unchangedIncoming.color, '#c74545', 'rgb(199,69,69)') && !colorIs(unchangedIncoming.color, '#e0474c', 'rgb(224,71,76)'), unchangedIncoming);
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
await evaluate(`(()=>{const cy=${cyExpr};const n=cy.nodes().filter(x=>x.data('simpleName')==='changed').first();if(!n||!n.length)throw Error('Missing changed method in review');const p=n.position();n.position({x:p.x-47,y:p.y+29});n.emit('dragfree');cy.pan({x:cy.pan().x-23,y:cy.pan().y+31});return true})()`);
await pause(800);
const reviewEdited = await graphState();
await clickButton('.review-toggle', 'Changes toggle off');
await waitForReview(false, 'Changes off after layout edit');
const ordinaryAfterOff = await graphState();
const scopeAfterOff = await packageScope('support');
const offDiffs = layoutDifferences(reviewEdited, ordinaryAfterOff);
const offSelected = await selectedName();
check('turning Changes off preserves the later layout and camera edit', offDiffs.length === 0, { differences: offDiffs, review: stateSummary(reviewEdited), ordinary: stateSummary(ordinaryAfterOff) });
check('turning Changes off preserves scope and selection', offSelected === 'Hub' && scopeAfterOff && !scopeAfterOff.checked, { selected: offSelected, supportScope: scopeAfterOff });

// Ordinary inspection goes back to the pinned source, with no diff controls or +/- rows.
await clickButton('.inspector .view-code-action', 'View ordinary class code');
await until(async () => (await readSourceDialog())?.open, 'ordinary source dialog open');
await until(async () => (await readSourceDialog())?.plainLines > 0, 'ordinary source lines rendered');
const ordinaryDialog = await readSourceDialog();
check('ordinary inspection has plain source behavior after Changes is off', !ordinaryDialog.hasDiff && ordinaryDialog.layoutButtons.length === 0 && ordinaryDialog.addRows === 0 && ordinaryDialog.delRows === 0 && ordinaryDialog.plainLines > 0, ordinaryDialog);
await screenshot('03-ordinary-after-changes-off');
await evaluate(`document.querySelector('.source-dialog button[aria-label="Close source"]')?.click()`);

// Toggle is one undoable exploration action. Undo returns to review with the exact edited geometry;
// redo returns to ordinary mode with that same geometry and scope.
await clickButton('button[title^="Undo last exploration action"]', 'undo Changes toggle');
await waitForReview(true, 'undo returns to Changes');
const reviewAfterUndo = await graphState();
const undoDiffs = layoutDifferences(reviewEdited, reviewAfterUndo);
const undoSelected = await selectedName();
check('undo restores Changes mode and its preserved layout in one step', undoDiffs.length === 0 && undoSelected === 'Hub', { differences: undoDiffs, state: stateSummary(reviewAfterUndo) });
await clickButton('button[title^="Redo"]', 'redo Changes toggle');
await waitForReview(false, 'redo returns to ordinary map');
const ordinaryAfterRedo = await graphState();
const redoDiffs = layoutDifferences(reviewEdited, ordinaryAfterRedo);
const redoSelected = await selectedName();
check('redo restores ordinary mode without resetting the layout', redoDiffs.length === 0 && redoSelected === 'Hub', { differences: redoDiffs.slice(0, 8), state: stateSummary(ordinaryAfterRedo) });

// Enter Changes again after the edits; both directions now exercise a non-initial state. The second
// tab is deliberately changed independently to prove mode/layout state belongs to each tab.
await clickButton('.review-toggle', 'Changes toggle on after redo');
await waitForReview(true, 'Changes on after redo');
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
check('switching tabs restores the first tab mode and layout independently', firstTabDiffs.length === 0 && JSON.stringify(firstTabState) === JSON.stringify(stateSummary(firstTabRestored)), { differences: firstTabDiffs, first: firstTabState, restored: stateSummary(firstTabRestored) });
await screenshot('04-first-tab-restored');

// Recompare remains a supported review action; exercise it once and ensure it is captured without
// allowing the browser run to mutate the fixture (the Python wrapper hashes it before/after).
const hubPath = `${fixturePath}/src/main/java/review/Hub.java`;
const hubOriginal = await fs.readFile(hubPath, 'utf8');
await fs.writeFile(hubPath, hubOriginal + '// a further edit for Recompare\n');
await clickButton('.review-options summary', 'review options for recompare');
await clickButtonText('Recompare');
await until(() => reviewResponses.filter(item => item.response).length >= 2, 'recompare issued a fresh comparison');
await fs.writeFile(hubPath, hubOriginal);

const failed = failures.length > 0 || pageErrors.length > 0;
await fs.writeFile(`${outDir}/report.json`, JSON.stringify({ checks, pageErrors, network: network.length, reviewResponses: reviewResponses.length }, null, 2));
console.log(`Checks: ${checks.filter(c => c.pass).length}/${checks.length}; page errors: ${pageErrors.length}`);
if (pageErrors.length) console.log('Page errors:', pageErrors);
socket.close();
process.exit(failed ? 1 : 0);
