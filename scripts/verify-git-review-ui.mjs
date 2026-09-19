// Git review acceptance through the packaged application's actual Review changes tab.
// No Playwright/npm dependency: Node's native WebSocket speaks to headless Chromium's CDP.
//
// Usage is normally through verify_git_review_pipeline.py, which creates a disposable Git fixture,
// starts the packaged app and Chromium, and analyzes the current working tree via the workspace API:
//   node scripts/verify-git-review-ui.mjs <appBase> <chromiumDebugBase> <workspaceId>
//     <initialSnapshotId> <baseOid> <fixturePath> <outputDir>
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

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

const api = async (path, body) => {
  const response = await fetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text.slice(0, 1200)}`);
  return text ? JSON.parse(text) : null;
};

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
    network.push({ method: request.method, url: request.url, status: null });
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
        reviewResponses.push({ ...review, body: review.body, response: JSON.parse(text) });
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
const setValue = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input '+${JSON.stringify(selector)});const set=Object.getOwnPropertyDescriptor(e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value').set;set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const setRadio = async value => {
  await evaluate(`(()=>{const input=document.querySelector('input[name="review-view"][value="${value}"]');if(!input)throw Error('Missing review mode ${value}');input.click();return true})()`);
  await until(() => evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');return app?.dataset.explorerInstance.startsWith('review-${value.toLowerCase()}-')&&!!app.querySelector('.graph-canvas')?._cyreg?.cy})()`), `${value} active explorer`);
  await pause(350);
};
const setGraphLevel = async level => evaluate(`(()=>{const root=document.querySelector('[data-testid="review-explorer"] [aria-label="Graph level"]');if(!root)throw Error('Missing active review graph level control');const button=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(level)});if(!button)throw Error('Missing review graph level '+${JSON.stringify(level)});button.click();return true})()`);
const normalCyExpr = `document.querySelector('.graph-canvas')?._cyreg?.cy`;
const cyExpr = `document.querySelector('[data-testid="review-explorer"] .graph-canvas')?._cyreg?.cy`;
const graphState = async (canvasExpr = cyExpr) => evaluate(`(()=>{const cy=${canvasExpr};if(!cy)return null;return {
  nodes:cy.nodes().map(n=>({id:n.id(),name:n.data('simpleName'),qualifiedName:n.data('qualifiedName'),kind:n.data('kind'),change:n.data('reviewChange')||null,
    added:n.data('reviewAddedLines'),removed:n.data('reviewRemovedLines'),background:n.style('background-color'),card:n.data('card'),position:n.position(),inspected:n.hasClass('inspected')})),
  edges:cy.edges().map(e=>({id:e.id(),source:e.source().data('simpleName'),target:e.target().data('simpleName'),change:e.data('reviewChange')||null,
    color:e.style('line-color'),arrowColor:e.style('target-arrow-color'),lineStyle:e.style('line-style'),sourceId:e.data('sourceId'),targetId:e.data('targetId'),inspected:e.hasClass('inspected'),flowOut:e.hasClass('flow-out'),flowIn:e.hasClass('flow-in')})),
  zoom:cy.zoom(),pan:cy.pan()
};})()`);
const reviewViewState = async () => evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const cy=app?.querySelector('.graph-canvas')?._cyreg?.cy;if(!cy)return null;return{
  level:app.querySelector('[aria-label="Graph level"] button.active')?.textContent.trim()||null,
  selection:app.querySelector('.review-selection strong')?.textContent.trim()||null,
  nodes:cy.nodes().map(n=>({id:n.id(),position:n.position(),inspected:n.hasClass('inspected')})).sort((a,b)=>a.id.localeCompare(b.id)),
  zoom:cy.zoom(),pan:cy.pan()
}})()`);
const sameState = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const setLevelAndWait = async level => {
  await setGraphLevel(level);
  await until(async () => (await graphState())?.nodes?.length > 0, `${level} graph`);
  await pause(300);
  return graphState();
};
const nodeNamed = (state, name) => state?.nodes?.find(node => node.name === name);
const routeNamed = (state, source, target, change) => state?.edges?.find(edge => edge.source === source && edge.target === target && (!change || edge.change === change));
const colorIs = (value, hex, rgb) => {
  const normalized = String(value || '').toLowerCase().replace(/\s/g, '');
  return normalized === hex.toLowerCase() || normalized === rgb.toLowerCase();
};
const svgCardText = card => {
  if (typeof card !== 'string' || !card.startsWith('data:image/svg+xml')) return '';
  try { return decodeURIComponent(card.slice(card.indexOf(',') + 1)); } catch { return ''; }
};
const readSourceDialog = async () => evaluate(`(()=>{const dialog=document.querySelector('.source-dialog');return dialog?{
  heading:dialog.querySelector('header h2')?.textContent||'',snapshotLabel:dialog.querySelector('header p')?.textContent||'',
  paths:[...dialog.querySelectorAll('.source-path')].map(x=>x.textContent.trim()),
  content:[...dialog.querySelectorAll('.source-dialog pre')].map(x=>x.innerText).join(String.fromCharCode(10)),
  notices:[...dialog.querySelectorAll('.notice')].map(x=>x.textContent.trim()),
  open:dialog.open, text:dialog.innerText
}:null})()`);
const waitForSourceContent = async (expected, label) => {
  try {
    await until(async () => (await readSourceDialog())?.content.includes(expected), label);
  } catch (error) {
    console.log('source dialog diagnostic', JSON.stringify(await readSourceDialog()),
      network.filter(item => item.url.includes('/source')));
    throw error;
  }
};
const clickGraphNode = async (name, canvasExpr = cyExpr) => {
  await evaluate(`(()=>{const cy=${canvasExpr};const n=cy.nodes().filter(x=>x.data('simpleName')===${JSON.stringify(name)}).first();if(!n||!n.length)throw Error('Missing graph node ${name}');n.emit('tap');return true})()`);
  await pause(400);
};
const clickGraphRoute = async (source, target, change, canvasExpr = cyExpr) => {
  await evaluate(`(()=>{const cy=${canvasExpr};const e=cy.edges().filter(x=>x.source().data('simpleName')===${JSON.stringify(source)}&&x.target().data('simpleName')===${JSON.stringify(target)}&&(!${JSON.stringify(change)}||x.data('reviewChange')===${JSON.stringify(change)})).first();if(!e||!e.length)throw Error('Missing graph route ${source} -> ${target} (${change||'any'})');e.emit('tap');return true})()`);
  await pause(400);
};
const revealReviewGraph = async label => {
  const view = await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const stage=app?.querySelector('.graph-stage');if(!stage)throw Error('Missing active review graph stage for ${label}');stage.scrollIntoView({block:'center',inline:'nearest'});const canvas=app.querySelector('.graph-canvas');const rect=stage.getBoundingClientRect();const canvasRect=canvas?.getBoundingClientRect();return{stage:{top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},canvas:{top:canvasRect?.top||0,bottom:canvasRect?.bottom||0,width:canvasRect?.width||0,height:canvasRect?.height||0},viewport:{width:innerWidth,height:innerHeight},nodes:app.querySelector('.graph-canvas')?._cyreg?.cy?.nodes().length||0,edges:app.querySelector('.graph-canvas')?._cyreg?.cy?.edges().length||0}})()`);
  await pause(500);
  const visible = await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const stage=app?.querySelector('.graph-stage');const rect=stage?.getBoundingClientRect();return!!rect&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight})()`);
  check(`${label} review graph stage is reachable in the viewport`, visible && view.nodes > 0 && view.edges > 0, { ...view, visible });
  return view;
};

await cdp('Runtime.enable');
await cdp('Network.enable');
await cdp('Page.enable');
await cdp('Page.bringToFront');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${base}/?snapshotId=${encodeURIComponent(initialSnapshotId)}` });
await until(() => evaluate(`!!document.querySelector('.graph-canvas')?._cyreg?.cy && ${`document.querySelector('.graph-canvas')._cyreg.cy.nodes().length`} > 0`), 'initial code map');
await pause(700);

// Keep a real exploration state across entering and leaving review. This proves that comparison
// browsing is a temporary view and does not replace the user's existing map selection.
await clickButtonText('Classes', '[aria-label="Graph level"] button');
await until(() => evaluate(`document.querySelector('[aria-label="Graph level"] button.active')?.textContent.trim()==='Classes'`), 'normal class graph');
await clickGraphNode('Hub', normalCyExpr);
const normalBefore = await evaluate(`(()=>{const cy=document.querySelector('.graph-canvas')._cyreg.cy;return{
  level:document.querySelector('[aria-label="Graph level"] button.active')?.textContent.trim(),
  selected:document.querySelector('.inspector .subject-heading h2')?.textContent||null,
  nodes:cy.nodes().map(n=>n.id()).sort(),
  positions:cy.nodes().map(n=>({id:n.id(),p:n.position()})).sort((a,b)=>a.id.localeCompare(b.id)),
  zoom:cy.zoom(),pan:cy.pan()
}})()`);
check('initial workspace graph is the after-change snapshot', normalBefore.nodes.length > 0 && normalBefore.selected?.includes('Hub'), normalBefore);

await clickButton('button[aria-label="Review changes"]', 'Review changes');
await until(() => evaluate(`!!document.querySelector('[aria-label="Review changes"].review-panel')`), 'Review changes tab');
await until(() => evaluate(`!!document.querySelector('[data-testid="review-added-lines"]')`), 'default Git comparison');
await setValue('input[aria-label="Base revision"]', baseOid);
await clickButton('button[aria-label="Compare changes"]', 'Compare changes');
await until(() => reviewResponses.some(item => item.body?.baseRef === baseOid && item.response), 'explicit-base review response');
await until(() => evaluate(`document.querySelector('.review-summary code')?.textContent.trim()==='${baseOid}'`), 'explicit base shown in review summary');
await until(() => evaluate(`!!document.querySelector('[data-testid="review-explorer"] .graph-canvas')?._cyreg?.cy`), 'integrated review graph');

const responseRecord = reviewResponses.filter(item => item.body?.baseRef === baseOid).at(-1);
const review = responseRecord.response;
const filesByPath = new Map(review.files.map(file => [file.path, file]));
const nodeLabel = node => `${node?.qualifiedName || ''} ${node?.simpleName || ''}`;
const findNode = (name, status) => review.nodes.find(row => row.change === status && [row.base, row.head].some(node => node && (node.simpleName === name || nodeLabel(node).includes(name))));
const changedMethod = review.nodes.find(row => row.change === 'MODIFIED' && [row.base, row.head].some(node => node?.kind === 'METHOD' && node.simpleName === 'changed'));
const siblingMethod = review.nodes.find(row => row.change === 'UNCHANGED' && [row.base, row.head].some(node => node?.kind === 'METHOD' && node.simpleName === 'sibling'));
const oldClass = findNode('OldDep', 'REMOVED');
const newClass = findNode('NewDep', 'ADDED');
const untrackedClass = findNode('UntrackedHelper', 'ADDED');
const hubClass = review.nodes.find(row => row.change === 'MODIFIED' && [row.base, row.head].some(node => node?.kind === 'CLASS' && node.simpleName === 'Hub'));
const reviewPackage = review.nodes.find(row => row.change === 'MODIFIED' && [row.base, row.head].some(node => node?.kind === 'PACKAGE' && node.simpleName === 'review'));

check('versioned comparison response resolves the requested base and pins both snapshots', review.schemaVersion === '1' && review.base.resolvedRef === baseOid && !!review.base.snapshotId && !!review.head.snapshotId && review.head.ref === 'WORKING_TREE', {
  schemaVersion: review.schemaVersion, requestedRef: review.base.requestedRef, resolvedRef: review.base.resolvedRef,
  baseSnapshotId: review.base.snapshotId, headSnapshotId: review.head.snapshotId, headRef: review.head.ref,
  headOid: review.head.headOid, fingerprint: review.head.fingerprint, capturedAt: review.head.capturedAt
});
check('line totals include staged, later unstaged, deleted, untracked Java, and non-Java changes', review.summary.addedLines > 0 && review.summary.removedLines > 0 && review.summary.changedFiles >= 5 &&
  filesByPath.get('src/main/java/review/Hub.java')?.status === 'MODIFIED' &&
  filesByPath.get('src/main/java/review/NewDep.java')?.status === 'ADDED' &&
  filesByPath.get('src/main/java/review/OldDep.java')?.status === 'DELETED' &&
  filesByPath.get('src/main/java/review/UntrackedHelper.java')?.status === 'ADDED' &&
  filesByPath.get('review-notes.txt')?.status === 'ADDED' && filesByPath.get('review-notes.txt')?.javaFile === false, {
  summary: review.summary, files: review.files.map(file => ({ path: file.path, status: file.status, addedLines: file.addedLines, removedLines: file.removedLines, javaFile: file.javaFile }))
});
check('comparison facts identify changed method, same-file unchanged sibling, changed class, package, removed and added types',
  !!changedMethod && !!siblingMethod && !!hubClass && !!reviewPackage && !!oldClass && !!newClass && !!untrackedClass,
  review.nodes.map(row => ({ change: row.change, kind: row.head?.kind || row.base?.kind, name: row.head?.simpleName || row.base?.simpleName, addedLines: row.addedLines, removedLines: row.removedLines })));
check('changed method carries one added and one removed line from final working tree', changedMethod?.addedLines === 1 && changedMethod?.removedLines === 1,
  changedMethod && { key: changedMethod.comparisonKey, addedLines: changedMethod.addedLines, removedLines: changedMethod.removedLines });

const baseGraph = await api(`/api/snapshots/${review.base.snapshotId}/graph`);
const headGraph = await api(`/api/snapshots/${review.head.snapshotId}/graph`);
const endpoint = (edge, graph) => {
  const from = graph.nodes.find(node => node.id === edge.sourceId);
  const to = graph.nodes.find(node => node.id === edge.targetId);
  return { source: from?.simpleName, target: to?.simpleName, sourceKind: from?.kind, targetKind: to?.kind };
};
const relationshipFacts = review.relationships.map(row => {
  const edge = row.head || row.base;
  return { change: row.change, kind: edge?.kind, ...(row.head ? endpoint(row.head, headGraph) : endpoint(row.base, baseGraph)), row };
});
const addedNewRoute = relationshipFacts.find(fact => fact.change === 'ADDED' && (fact.target === 'NewDep' || fact.target === 'read' && fact.source === 'changed'));
const removedOldRoute = relationshipFacts.find(fact => fact.change === 'REMOVED' && (fact.target === 'OldDep' || fact.target === 'read' && fact.source === 'changed'));
const unchangedKeepRoute = relationshipFacts.find(fact => fact.change === 'UNCHANGED' && (fact.target === 'KeepDep' || fact.target === 'read' && fact.source === 'sibling'));
check('parser-owned comparison contains added NewDep, removed OldDep, and retained KeepDep relations', !!addedNewRoute && !!removedOldRoute && !!unchangedKeepRoute,
  relationshipFacts.map(({ change, kind, source, target }) => ({ change, kind, source, target })));

const baseChangedNode = changedMethod?.base;
const headChangedNode = changedMethod?.head;
let baseSource = null, headSource = null;
if (baseChangedNode && headChangedNode) {
  baseSource = await api(`/api/snapshots/${review.base.snapshotId}/symbols/${baseChangedNode.id}/source`);
  headSource = await api(`/api/snapshots/${review.head.snapshotId}/symbols/${headChangedNode.id}/source`);
}
check('retained source evidence is immutable for base and final working tree', !!baseSource?.content?.includes('new OldDep().read()') &&
  !baseSource?.content?.includes('new NewDep().read()') && !!headSource?.content?.includes('new NewDep().read() + "-working-tree"') &&
  !headSource?.content?.includes('new OldDep().read()'), {
  basePath: baseSource?.path, baseExact: baseSource?.exact, headPath: headSource?.path, headExact: headSource?.exact,
  baseSnapshotId: review.base.snapshotId, headSnapshotId: review.head.snapshotId
});

// Exercise all three user modes against the actual Cytoscape graph, not a separately reconstructed
// test graph. The review comparison source and the visible projection must tell the same story.
await setRadio('BASE');
const baseClasses = await setLevelAndWait('Classes');
const baseNames = baseClasses.nodes.map(node => node.name);
check('Base codebase graph has OldDep and KeepDep without after-change types', baseNames.includes('Hub') && baseNames.includes('OldDep') && baseNames.includes('KeepDep') && !baseNames.includes('NewDep') && !baseNames.includes('UntrackedHelper'), baseNames);
const baseKeep = routeNamed(baseClasses, 'Hub', 'KeepDep');
check('base graph retains the original Hub to KeepDep route', !!baseKeep, baseKeep);

await setRadio('OVERLAY');
const overlayClasses = await setLevelAndWait('Classes');
const overlayNames = overlayClasses.nodes.map(node => node.name);
const overlayHub = nodeNamed(overlayClasses, 'Hub');
const overlayOld = nodeNamed(overlayClasses, 'OldDep');
const overlayNew = nodeNamed(overlayClasses, 'NewDep');
const overlayUntracked = nodeNamed(overlayClasses, 'UntrackedHelper');
const overlayKeep = nodeNamed(overlayClasses, 'KeepDep');
check('Base + changes graph contains old, new, untracked and unchanged resources together', ['Hub','OldDep','KeepDep','NewDep','UntrackedHelper'].every(name => overlayNames.includes(name)), overlayNames);
check('mixed class cards carry the expected change status', overlayHub?.change === 'MODIFIED' && overlayOld?.change === 'REMOVED' && overlayNew?.change === 'ADDED' && overlayUntracked?.change === 'ADDED' && overlayKeep?.change === 'UNCHANGED',
  [overlayHub, overlayOld, overlayNew, overlayUntracked, overlayKeep].map(node => node && ({ name: node.name, change: node.change })));
check('changed class is amber with per-resource +/− line data', !!overlayHub && colorIs(overlayHub.background, '#fff4c8', 'rgb(255,244,200)') && Number.isInteger(overlayHub.added) && Number.isInteger(overlayHub.removed) && overlayHub.added > 0 && overlayHub.removed > 0,
  overlayHub && { background: overlayHub.background, added: overlayHub.added, removed: overlayHub.removed });
const addedClassRoute = routeNamed(overlayClasses, 'Hub', 'NewDep', 'ADDED');
const removedClassRoute = routeNamed(overlayClasses, 'Hub', 'OldDep', 'REMOVED');
const unchangedClassRoute = routeNamed(overlayClasses, 'Hub', 'KeepDep', 'UNCHANGED');
check('added route is green, removed route is red and dashed, retained route matches base color',
  !!addedClassRoute && colorIs(addedClassRoute.color, '#168a58', 'rgb(22,138,88)') &&
  !!removedClassRoute && colorIs(removedClassRoute.color, '#c74545', 'rgb(199,69,69)') && removedClassRoute.lineStyle === 'dashed' &&
  !!unchangedClassRoute && unchangedClassRoute.color === baseKeep?.color,
  { added: addedClassRoute, removed: removedClassRoute, unchanged: unchangedClassRoute, baseUnchangedColor: baseKeep?.color });

// Select the changed source resource. Added/removed status colors and the unchanged original route
// must stay visible through selection emphasis, when the ordinary explorer animates route direction.
await clickGraphNode('Hub');
await until(() => evaluate(`!!document.querySelector('.review-explorer .review-selection')`), 'selected review resource');
const selectedOverlay = await graphState();
const selectedAddedRoute = routeNamed(selectedOverlay, 'Hub', 'NewDep', 'ADDED');
const selectedRemovedRoute = routeNamed(selectedOverlay, 'Hub', 'OldDep', 'REMOVED');
const selectedUnchangedRoute = routeNamed(selectedOverlay, 'Hub', 'KeepDep', 'UNCHANGED');
check('selecting a resource preserves all three relationship styles and the unchanged route',
  !!selectedAddedRoute && colorIs(selectedAddedRoute.color, '#168a58', 'rgb(22,138,88)') &&
  !!selectedRemovedRoute && colorIs(selectedRemovedRoute.color, '#c74545', 'rgb(199,69,69)') && selectedRemovedRoute.lineStyle === 'dashed' &&
  !!selectedUnchangedRoute && selectedUnchangedRoute.lineStyle === 'dashed',
  { added: selectedAddedRoute, removed: selectedRemovedRoute, unchanged: selectedUnchangedRoute });
await revealReviewGraph('desktop');
await screenshot('review-overlay-desktop');

// Each review side owns its own ordinary Explorer journey. Change the base side while the
// overlay is inspected, then return to both sides and verify their level, selection, positions,
// and camera are independent and retained.
const overlayBeforeRoundtrip = await reviewViewState();
await setRadio('BASE');
await setLevelAndWait('Methods');
await clickGraphNode('sibling');
const baseBeforeRoundtrip = await reviewViewState();
await setRadio('OVERLAY');
const overlayAfterRoundtrip = await reviewViewState();
check('overlay review state survives an independent base-side exploration', sameState(overlayAfterRoundtrip, overlayBeforeRoundtrip), {
  before: overlayBeforeRoundtrip, after: overlayAfterRoundtrip
});
await setRadio('BASE');
const baseAfterRoundtrip = await reviewViewState();
check('base review state survives a round trip through the overlay side', sameState(baseAfterRoundtrip, baseBeforeRoundtrip), {
  before: baseBeforeRoundtrip, after: baseAfterRoundtrip
});
await setRadio('OVERLAY');

// Fit the comparison map and open its own fixed map stage so the evidence image shows all three
// relationship colors and arrows. Collapse the minimap because it otherwise covers the selected
// Hub card in this small synthetic fixture.
await clickButton('[data-testid="review-explorer"] .inspector .arrange-action', 'arrange around reviewed Hub');
await clickButton('[data-testid="review-explorer"] button[aria-label="Fit map"]', 'fit overlay review map');
await clickButton('[data-testid="review-explorer"] .minimap-title', 'collapse review minimap');
await clickButton('[data-testid="review-explorer"] button[aria-label="Full screen"]', 'full-screen overlay review map');
await until(() => evaluate(`document.querySelector('[data-testid="review-explorer"] .graph-stage')?.classList.contains('fullscreen')`), 'overlay map full screen');
await until(() => evaluate(`${cyExpr}.width()===1500`), 'full-screen canvas resized');
await clickButton('[data-testid="review-explorer"] button[aria-label="Fit map"]', 'fit full-screen overlay');
const fullscreenOverlay = await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const stage=app?.querySelector('.graph-stage');const rect=stage?.getBoundingClientRect();const mini=app?.querySelector('.minimap');const cy=app?.querySelector('.graph-canvas')?._cyreg?.cy;return{fullscreen:stage?.classList.contains('fullscreen'),top:rect?.top||0,left:rect?.left||0,width:rect?.width||0,height:rect?.height||0,minimapExpanded:mini?.classList.contains('collapsed')===false,nodes:cy?.nodes().length||0,edges:cy?.edges().length||0}})()`);
check('full-screen overlay map fits all changed and retained routes with minimap collapsed', fullscreenOverlay.fullscreen && fullscreenOverlay.top === 0 && fullscreenOverlay.left === 0 && fullscreenOverlay.width === 1500 && fullscreenOverlay.height === 1000 && !fullscreenOverlay.minimapExpanded && fullscreenOverlay.nodes === 5 && fullscreenOverlay.edges === 3, fullscreenOverlay);
await screenshot('review-overlay-fullscreen');
// Card controls are intentionally hidden below their minimum hit size; exercise expansion after
// fitting the full-screen canvas, where a person can actually reach the control.
await until(() => evaluate(`!!document.querySelector('[data-testid="review-explorer"] button[aria-label="Show methods inside Hub"]')`), 'visible Hub expansion control');
await clickButton('[data-testid="review-explorer"] button[aria-label="Show methods inside Hub"]', 'expand changed Hub');
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='Hub'&&n.data('expanded'))`), 'expanded changed Hub');
const expandedLabel = await evaluate(`${cyExpr}.nodes().filter(n=>n.data('simpleName')==='Hub').first().data('containerLabel')`);
check('expanded changed resource retains its change label and line counts', expandedLabel.includes('MODIFIED +1 −1'), expandedLabel);
await clickButton('[data-testid="review-explorer"] button[aria-label="Fit map"]', 'fit expanded Hub');
await until(() => evaluate(`!!document.querySelector('[data-testid="review-explorer"] button[aria-label="Collapse Hub"]')`), 'visible Hub collapse control');
await clickButton('[data-testid="review-explorer"] button[aria-label="Collapse Hub"]', 'collapse changed Hub');
await until(() => evaluate(`${cyExpr}.nodes().length===5`), 'collapsed overlay classes');
await clickButton('[data-testid="review-explorer"] button[aria-label="Exit full screen"]', 'exit full-screen overlay review map');
await until(() => evaluate(`!document.querySelector('[data-testid="review-explorer"] .graph-stage')?.classList.contains('fullscreen')`), 'overlay map leaves full screen');

await setRadio('HEAD');
const headClasses = await setLevelAndWait('Classes');
const headNames = headClasses.nodes.map(node => node.name);
check('After changes graph excludes the deleted type and includes staged plus untracked additions', headNames.includes('Hub') && headNames.includes('KeepDep') && headNames.includes('NewDep') && headNames.includes('UntrackedHelper') && !headNames.includes('OldDep'), headNames);

await setRadio('OVERLAY');
const overlayMethods = await setLevelAndWait('Methods');
const changedMethodNode = nodeNamed(overlayMethods, 'changed');
const siblingMethodNode = nodeNamed(overlayMethods, 'sibling');
const methodBadge = svgCardText(changedMethodNode?.card);
check('changed method is yellow and shows its +1/−1 resource badge', !!changedMethodNode && colorIs(changedMethodNode.background, '#fff4c8', 'rgb(255,244,200)') &&
  changedMethodNode.change === 'MODIFIED' && changedMethodNode.added === 1 && changedMethodNode.removed === 1 && methodBadge.includes('+1') && methodBadge.includes('−1'),
  changedMethodNode && { change: changedMethodNode.change, background: changedMethodNode.background, added: changedMethodNode.added, removed: changedMethodNode.removed, badge: methodBadge.match(/CHANGED[^<]*/)?.[0] });
check('unchanged sibling method in the same Hub.java stays in the mixed map and keeps normal styling', !!siblingMethodNode && siblingMethodNode.change === 'UNCHANGED' &&
  siblingMethodNode.added === 0 && siblingMethodNode.removed === 0,
  siblingMethodNode && { name: siblingMethodNode.name, change: siblingMethodNode.change, added: siblingMethodNode.added, removed: siblingMethodNode.removed });

// The package-level card is a changed resource too and carries aggregate +/- line totals.
await setGraphLevel('Packages');
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('kind')==='PACKAGE')`), 'review package graph');
const packageState = await graphState();
const packageNode = packageState.nodes.find(node => node.kind === 'PACKAGE' && (node.name === 'review' || node.qualifiedName === 'review'));
const packageBadge = svgCardText(packageNode?.card);
check('changed package is amber and its card reports added and removed lines', !!packageNode && packageNode.change === 'MODIFIED' &&
  colorIs(packageNode.background, '#fff4c8', 'rgb(255,244,200)') && Number.isInteger(packageNode.added) && packageNode.added > 0 && Number.isInteger(packageNode.removed) && packageNode.removed > 0 &&
  packageBadge.includes(`+${packageNode.added}`) && packageBadge.includes(`−${packageNode.removed}`),
  packageNode && { name: packageNode.name, change: packageNode.change, added: packageNode.added, removed: packageNode.removed, badge: packageBadge.match(/CHANGED[^<]*/)?.[0] });

// Open evidence from a removed relation in overlay mode. The dialog must use the base snapshot,
// not the current disk contents. Then inspect an added relation, which must use the head snapshot.
await setGraphLevel('Classes');
await until(() => evaluate(`${cyExpr}.nodes().some(n=>n.data('simpleName')==='OldDep')`), 'overlay class graph restored');
await clickGraphRoute('Hub', 'OldDep', 'REMOVED');
const removedEvidenceButton = await evaluate(`!![...document.querySelectorAll('.review-explorer .review-selection button')].find(b=>b.getAttribute('aria-label')==='View relationship source from base snapshot')`);
check('removed relation selection offers evidence from the base snapshot', removedEvidenceButton);
await clickButton('.review-explorer .review-selection button[aria-label="View relationship source from base snapshot"]', 'removed relationship evidence');
await waitForSourceContent('new OldDep().read()', 'base-side removed relationship source');
const removedEvidence = await readSourceDialog();
check('removed relationship evidence is captured from base source', removedEvidence?.snapshotLabel.includes('base snapshot') && removedEvidence.content.includes('new OldDep().read()') && !removedEvidence.content.includes('new NewDep().read()'),
  { snapshotLabel: removedEvidence?.snapshotLabel, paths: removedEvidence?.paths, pinnedNotice: removedEvidence?.notices.some(item => item.includes('pinned to its review snapshot')) });
await screenshot('review-removed-source');
await clickButton('.source-dialog button[aria-label="Close source"]', 'close base source dialog');
await until(() => evaluate(`!document.querySelector('.source-dialog')?.open`), 'base evidence closed');

await setGraphLevel('Classes');
await clickGraphRoute('Hub', 'NewDep', 'ADDED');
await until(() => evaluate(`!!document.querySelector('.review-explorer .review-selection')`), 'added route selection');
const addedEvidenceButton = await evaluate(`!![...document.querySelectorAll('.review-explorer .review-selection button')].find(b=>b.getAttribute('aria-label')==='View relationship source from changed snapshot')`);
check('added relation selection offers evidence from the changed snapshot', addedEvidenceButton);
await clickButton('.review-explorer .review-selection button[aria-label="View relationship source from changed snapshot"]', 'added relationship evidence');
await waitForSourceContent('new NewDep().read() + "-working-tree"', 'head-side added relationship source');
const addedEvidence = await readSourceDialog();
check('added relationship evidence contains final working-tree source', addedEvidence?.snapshotLabel.includes('after-change snapshot') &&
  addedEvidence.content.includes('new NewDep().read() + "-working-tree"') && !addedEvidence.content.includes('new OldDep().read()'),
  { snapshotLabel: addedEvidence?.snapshotLabel, paths: addedEvidence?.paths, pinnedNotice: addedEvidence?.notices.some(item => item.includes('pinned to its review snapshot')) });
await clickButton('.source-dialog button[aria-label="Close source"]', 'close head source dialog');
await until(() => evaluate(`!document.querySelector('.source-dialog')?.open`), 'head evidence closed');

// Check resource cards and line counts in the review list. Turn off Changed resources only to show
// that the unchanged method can also be selected and read from the same file/snapshot.
const changedOnly = await evaluate(`!![...document.querySelectorAll('.review-toolbar label')].find(l=>l.textContent.includes('Changed resources in list only'))?.querySelector('input')?.checked`);
if (changedOnly) {
  const checkboxPoint = await evaluate(`(()=>{const label=[...document.querySelectorAll('.review-toolbar label')].find(l=>l.textContent.includes('Changed resources in list only'));const input=label?.querySelector('input');if(!input)throw Error('Missing changed-resources checkbox');input.scrollIntoView({block:'nearest'});const rect=input.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2,checked:input.checked}})()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: checkboxPoint.x, y: checkboxPoint.y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: checkboxPoint.x, y: checkboxPoint.y, button: 'left', clickCount: 1 });
  await pause(500);
}
await until(() => evaluate(`(()=>{const label=[...document.querySelectorAll('.review-toolbar label')].find(l=>l.textContent.includes('Changed resources in list only'));const input=label?.querySelector('input');return!!input&&!input.checked&&[...document.querySelectorAll('[data-testid^="review-resource-"]')].some(row=>row.querySelector('h3')?.textContent.includes('sibling'))})()`), 'all review resources visible');
const completeListState = await evaluate(`(()=>({
  rows:[...document.querySelectorAll('[data-testid^="review-resource-"]')].map(row=>({name:row.querySelector('h3')?.textContent||'',text:row.innerText,change:[...row.classList].find(c=>c.startsWith('review-change-'))||''})),
  labels:[...document.querySelectorAll('.review-mode input')].map(i=>({value:i.value,checked:i.checked}))
}))()`);
check('review resource list exposes changed method, removed class and unchanged sibling with line counts',
  completeListState.rows.some(row => row.name.includes('changed') && row.text.includes('+1') && row.text.includes('−1')) &&
  completeListState.rows.some(row => row.name.includes('OldDep') && row.change === 'review-change-removed') &&
  completeListState.rows.some(row => row.name.includes('sibling') && row.change === 'review-change-unchanged'), completeListState.rows);

// Narrow screen gets a real screenshot and must not force page-level horizontal scrolling.
await setRadio('OVERLAY');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await pause(700);
const narrowDetails = await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const main=app?.querySelector('.app-main');const inspector=app?.querySelector('.inspector');const rect=inspector?.getBoundingClientRect();return{pane:main?.className||'',inspectorWidth:rect?.width||0,inspectorHeight:rect?.height||0}})()`);
check('narrow selected review resource opens the embedded details pane', narrowDetails.pane.includes('pane-details') && narrowDetails.inspectorWidth > 0 && narrowDetails.inspectorHeight > 0, narrowDetails);
await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const tab=[...app.querySelectorAll('.mobile-tabs button')].find(item=>item.textContent.trim()==='map');if(!tab)throw Error('Missing active embedded Map mobile tab');tab.click();return true})()`);
await until(() => evaluate(`document.querySelector('[data-testid="review-explorer"] .app-main')?.classList.contains('pane-map')`), 'embedded review map pane');
await pause(350);
await clickButton('[data-testid="review-explorer"] button[aria-label="Fit map"]', 'fit narrow review map');
const visibleNarrowCards = await evaluate(`(()=>{const cy=${cyExpr};return cy.nodes().filter(n=>{const b=n.renderedBoundingBox();return b.x2>0&&b.y2>0&&b.x1<cy.width()&&b.y1<cy.height()}).length})()`);
check('Fit map makes review resources visible after a narrow viewport change', visibleNarrowCards === 5, visibleNarrowCards);
const narrowLayout = await evaluate(`(()=>{const app=document.querySelector('[data-testid="review-explorer"]');const stage=app?.querySelector('.graph-stage');stage?.scrollIntoView({block:'start',inline:'nearest'});const rect=stage?.getBoundingClientRect();const workspace=app?.querySelector('.workspace-content')?.getBoundingClientRect();const main=app?.querySelector('.app-main')?.getBoundingClientRect();return{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,reviewWidth:document.querySelector('.review-panel')?.scrollWidth||0,reviewClientWidth:document.querySelector('.review-panel')?.clientWidth||0,mainWidth:main?.width||0,workspaceWidth:workspace?.width||0,graphTop:rect?.top||0,graphBottom:rect?.bottom||0,graphWidth:rect?.width||0,graphHeight:rect?.height||0,nodes:app?.querySelector('.graph-canvas')?._cyreg?.cy?.nodes().length||0,edges:app?.querySelector('.graph-canvas')?._cyreg?.cy?.edges().length||0}})()`);
check('narrow review Map pane has no horizontal page overflow and its graph is reachable', narrowLayout.documentWidth <= narrowLayout.width && narrowLayout.bodyWidth <= narrowLayout.width && narrowLayout.graphWidth > 0 && narrowLayout.graphHeight > 0 && narrowLayout.graphBottom > 0 && narrowLayout.graphTop < narrowLayout.height && narrowLayout.nodes > 0 && narrowLayout.edges > 0, narrowLayout);
await screenshot('review-overlay-narrow');

// Returning to the existing exploration restores its exact graph membership, positions, camera,
// level, and inspected resource. The review tab is a separate view over the same workspace.
// Restore the desktop viewport first. At narrow widths the navigation is intentionally replaced by
// mobile tabs and every workspace-nav button is display:none; clicking the first hidden embedded
// button can leave the outer review tab active and make the return wait forever.
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await until(() => evaluate(`innerWidth===1500&&innerHeight===1000`), 'desktop viewport restored');
await pause(500);
await evaluate(`(()=>{const outer=[...document.querySelectorAll('.app-container')].find(app=>!app.classList.contains('embedded-explorer-app'));const b=outer?.querySelector('nav.workspace-nav button');if(!b)throw Error('Missing outer Code map navigation button');b.scrollIntoView({block:'nearest'});b.click();return true})()`);
await until(() => evaluate(`!document.querySelector('[data-testid="review-explorer"]') && !!document.querySelector('.graph-canvas')?._cyreg?.cy`), 'return to code map');
const normalAfter = await evaluate(`(()=>{const cy=document.querySelector('.graph-canvas')._cyreg.cy;return{
  level:document.querySelector('[aria-label="Graph level"] button.active')?.textContent.trim(),
  selected:document.querySelector('.inspector .subject-heading h2')?.textContent||null,
  nodes:cy.nodes().map(n=>n.id()).sort(),
  positions:cy.nodes().map(n=>({id:n.id(),p:n.position()})).sort((a,b)=>a.id.localeCompare(b.id)),
  zoom:cy.zoom(),pan:cy.pan()
}})()`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
check('closing review preserves the original exploration map and inspection state', same(normalAfter, normalBefore), { before: normalBefore, after: normalAfter });

const forbiddenRequests = network.filter(item => /\/api\/(?:explanations(?:\/|\?)|model-profiles\/test)/.test(item.url));
check('review used no explanation or model-test endpoint', forbiddenRequests.length === 0, forbiddenRequests);
check('browser reports no page exceptions or console errors', pageErrors.length === 0, pageErrors);

const report = {
  workspaceId, initialSnapshotId, baseOid, fixturePath,
  review: {
    schemaVersion: review.schemaVersion, base: review.base, head: review.head, summary: review.summary,
    files: review.files.map(file => ({ path: file.path, status: file.status, addedLines: file.addedLines, removedLines: file.removedLines, javaFile: file.javaFile })),
    nodeFacts: review.nodes.map(row => ({ change: row.change, kind: row.head?.kind || row.base?.kind, name: row.head?.simpleName || row.base?.simpleName, addedLines: row.addedLines, removedLines: row.removedLines })),
    relationshipFacts: relationshipFacts.map(({ change, kind, source, target }) => ({ change, kind, source, target }))
  },
  sourceEvidence: {
    base: { path: baseSource?.path, exact: baseSource?.exact, hasOldDepCall: !!baseSource?.content?.includes('new OldDep().read()') },
    head: { path: headSource?.path, exact: headSource?.exact, hasFinalWorkingTreeEdit: !!headSource?.content?.includes('new NewDep().read() + "-working-tree"') },
    removedRelation: { snapshotLabel: removedEvidence?.snapshotLabel, paths: removedEvidence?.paths },
    addedRelation: { snapshotLabel: addedEvidence?.snapshotLabel, paths: addedEvidence?.paths }
  },
  initialExploration: normalBefore,
  checks, pageErrors, network: network.map(({ method, url, status }) => ({ method, url, status })),
  screenshots: ['review-overlay-desktop.png', 'review-overlay-fullscreen.png', 'review-removed-source.png', 'review-overlay-narrow.png']
};
await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nChecks: ${checks.filter(item => item.pass).length}/${checks.length}`);
console.log(`Page errors: ${pageErrors.length}; screenshots: ${report.screenshots.length}`);
if (failures.length) {
  socket.close();
  throw new Error(`Git review UI acceptance failed: ${failures.map(item => item.label).join('; ')}`);
}
console.log('ALL GIT REVIEW UI CHECKS PASSED');
socket.close();
