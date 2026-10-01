// Real-browser acceptance for go to definition in the Changes diff (ADR 0014) and the repository root (ADR 0015).
// Driven by scripts/verify_diff_navigation_pipeline.py: <base> <debugger> <repo> <base oid> <out>.
// Every gesture is a real CDP input event (keys with modifiers, mouse moves and clicks), not a synthetic DOM event.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base, debug, repo, baseOid, out] = process.argv.slice(2);
const moduleDir = repo + '/app';
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(), errors = [], requests = [], posts = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  else if (m.method === 'Network.requestWillBeSent') {
    requests.push(m.params.request.url);
    if (m.params.request.method === 'POST') posts.push({ url: m.params.request.url, body: m.params.request.postData || '' });
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async (expr, what, tries = 480) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return; await pause(250); } throw Error('Timed out: ' + what); };
const shots = [];
const shot = async name => { await pause(400); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${out}/${name}.png`, Buffer.from(r.data, 'base64')); shots.push(name); };
const viewport = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const CTRL = 2, ALT = 1;
const KEYS = { Control: ['ControlLeft', 17], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39] };
const key = async (k, modifiers = 0, type = 'press') => {
  const [code, vk] = KEYS[k];
  const params = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  if (type !== 'up') await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
  if (type !== 'down') await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...params, modifiers: k === 'Control' ? 0 : modifiers });
};
const ctrlClick = async p => {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: CTRL });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: CTRL });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: CTRL });
};
/** Arms navigation: Ctrl held and the pointer moved over the dialog with it, as a user does before a click. */
const holdCtrl = async () => {
  await key('Control', CTRL, 'down');
  const p = await ev(`(()=>{const r=document.querySelector('.source-dialog header').getBoundingClientRect();return {x:r.x+20,y:r.y+20};})()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: CTRL });
};
const section = file => `[...document.querySelectorAll('.source-dialog section')].find(s=>s.querySelector('.source-path').firstChild.textContent.trim().endsWith(${JSON.stringify(file)}))`;
/** Centre of the `.nav-token` `text` on head line `newNo` of a diff section (unified rows or split's right cells). */
const diffToken = (file, newNo, text) => ev(`(()=>{
  const s=${section(file)};if(!s)throw Error('no section ${file}');
  const cells=s.querySelector('.diff-split-table')?[...s.querySelectorAll('.diff-split-row')].map(r=>r.children[1]):[...s.querySelectorAll('.diff-unified .code-line')];
  const cell=cells.find(c=>{const g=c.querySelectorAll('.diff-gutter');return g[g.length-1].textContent===${JSON.stringify(String(newNo))};});
  if(!cell)throw Error('no head line ${newNo} in ${file}');
  const t=[...cell.querySelectorAll('.nav-token')].find(t=>t.textContent===${JSON.stringify(text)});
  if(!t)return null;
  t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
/** Centre of a deleted line's code (unified row, or split's left cell) by its base line number. */
const deletedLine = (file, oldNo) => ev(`(()=>{
  const s=${section(file)};
  const rows=s.querySelector('.diff-split-table')?[...s.querySelectorAll('.diff-split-cell.diff-row-del')]:[...s.querySelectorAll('.code-line.diff-row-del')];
  const row=rows.find(r=>r.querySelector('.diff-gutter').textContent===${JSON.stringify(String(oldNo))});
  if(!row)throw Error('no deleted line ${oldNo}');
  const c=row.querySelector('code');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+Math.min(40,r.width/2),y:r.y+r.height/2};})()`);
const waitToken = async (file, newNo, text) => { let p = null; for (let i = 0; i < 120 && !p; i++) { p = await diffToken(file, newNo, text); if (!p) await pause(250); } if (!p) throw Error(`no clickable ${text} on head line ${newNo} of ${file}`); return p; };
const dialogState = () => ev(`(()=>{const d=document.querySelector('.source-dialog');if(!d||!d.open)return null;return {
  title:d.querySelector('header h2').textContent, sub:d.querySelector('header p').textContent,
  paths:[...d.querySelectorAll('section .source-path')].map(s=>s.firstChild.textContent.trim()),
  diff:!!d.querySelector('.diff-unified,.diff-split-table'), split:!!d.querySelector('.diff-split-table'),
  addRows:d.querySelectorAll('.diff-row-add').length, delRows:d.querySelectorAll('.diff-row-del').length,
  target:d.querySelector('.nav-target')?.closest('.code-line,.diff-split-cell')?.querySelector('code')?.textContent||null,
  targetToken:d.querySelector('.nav-target')?.textContent||null,
  message:d.querySelector('.nav-message')?.firstChild?.textContent?.trim()||null, hint:!!d.querySelector('.nav-hint'),
  served:[...d.querySelectorAll('.nav-served')].map(p=>p.textContent), chip:d.querySelector('.nav-chip')?.textContent||null,
  scrollTop:Math.round(d.scrollTop),
  back:!!d.querySelector('[aria-label=Back]')&&!d.querySelector('[aria-label=Back]').disabled,
  forward:!!d.querySelector('[aria-label=Forward]')&&!d.querySelector('[aria-label=Forward]').disabled};})()`);
const setInput = (selector, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const click = selectorExpr => ev(`(()=>{const e=${selectorExpr};if(!e)throw Error('missing '+${JSON.stringify(selectorExpr)});e.click();return true;})()`);
const overflow = () => ev(`document.documentElement.scrollWidth>window.innerWidth+1`);
const reviewPosts = () => posts.filter(p => p.url.endsWith('/reviews')).length;
/** Selects a class from the scope tree and opens its code from the inspector (in Changes mode: the after-change side). */
async function openClass(name) {
  await click(`[...document.querySelectorAll('.package-tree .scope-label')].find(b=>b.textContent.endsWith(${JSON.stringify(name)}))`);
  await until(`!!document.querySelector('.inspector .view-code-action')`, `${name} inspector`);
  await click(`document.querySelector('.inspector .view-code-action')`);
  await until(`!!document.querySelector('.source-dialog')?.open&&!!${section(name + '.java')}`, `${name} source dialog`);
}
const results = {};
try {
  await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');

  // 1. The import form at 390 px, with the module path and the repository root filled in.
  await viewport(390, 844);
  await cdp('Page.navigate', { url: base });
  await until(`!!document.querySelector('.welcome select[aria-label="Indexer"]')`, 'import form with engine picker');
  await setInput('.welcome input[aria-label="Local repository path"]', moduleDir);
  await setInput('.welcome input[aria-label="Repository root"]', repo);
  await ev(`(()=>{const s=document.querySelector('.welcome select[aria-label="Indexer"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'scip-java');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`!!document.querySelector('.build-consent input')`, 'consent box');
  await ev(`document.querySelector('.build-consent input').click()`);
  await ev(`document.querySelector('.welcome input[aria-label="Repository root"]').scrollIntoView({block:'center'})`);
  results.formOverflow390 = await overflow();
  assert.equal(results.formOverflow390, false, 'no horizontal page scroll at 390 px');
  await shot('01-import-form-repository-root-390');

  // 2. Analyze through the form: the module, built from the repository root with scip-java.
  await viewport(1280, 900);
  await until(`!document.querySelector('.welcome button.primary').disabled`, 'analyze enabled');
  await ev(`document.querySelector('.welcome button.primary').click()`);
  await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes().length&&!!document.querySelector('.package-tree .scope-label')`, 'scip-java graph of the module');
  const registration = JSON.parse(posts.find(p => p.url.endsWith('/api/workspaces')).body);
  assert.deepEqual([registration.path, registration.repositoryRoot, registration.indexer, registration.allowBuildExecution], [moduleDir, repo, 'scip-java', true]);
  const workspace = (await (await fetch(base + '/api/workspaces')).json()).find(w => w.path.endsWith('/repo/app'));
  results.workspace = { path: workspace.path, repositoryRoot: workspace.repositoryRoot, indexer: workspace.indexer };
  assert.ok(workspace.repositoryRoot.endsWith('/repo') && workspace.indexer === 'scip-java', JSON.stringify(workspace));

  // 3. Changes on, against the base commit; the module's change is compared from the repository root.
  await ev(`document.querySelector('.review-options summary').click()`);
  await setInput('input[placeholder="Default merge base, or origin/main"]', baseOid);
  await ev(`document.querySelector('.review-options summary').click()`);
  await ev(`document.querySelector('.review-toggle').click()`);
  await until(`document.querySelector('.review-toggle')?.getAttribute('aria-pressed')==='true'&&document.querySelector('.graph-canvas')._cyreg.cy.nodes().some(n=>n.data('reviewChange'))`, 'Changes overlay');
  await pause(600);
  await openClass('Farewell');
  await until(`!!document.querySelector('.source-dialog .diff-row-add')`, 'the added class as an all-added diff');
  let d = await dialogState();
  results.addedFile = d;
  assert.ok(d.diff && d.delRows === 0 && d.addRows > 0 && /after-change snapshot/.test(d.sub), JSON.stringify(d));
  await shot('02-added-file-as-diff-unified');

  // 4. Ctrl+click in the added file (unified): the type name jumps into the other changed file, shown as its diff.
  await holdCtrl();
  let p = await waitToken('Farewell.java', 6, 'GreetingService');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: CTRL });
  await shot('03-ctrl-hover-added-file');
  d = await dialogState();
  results.servedNote = d.served;
  assert.ok(d.served.some(s => s.startsWith('Navigation from Current analysis')), JSON.stringify(d.served));
  await ctrlClick(p);
  await until(`document.querySelector('.source-dialog header h2').textContent==='GreetingService.java'&&!!document.querySelector('.source-dialog .nav-target')`, 'jump into the changed file');
  d = await dialogState();
  results.addedFileJump = d;
  assert.ok(d.diff && d.addRows > 0 && d.delRows > 0, 'the changed target opens as its diff');
  assert.ok(/class GreetingService/.test(d.target), d.target);
  assert.ok(/after-change snapshot/.test(d.sub) && !d.chip, d.sub);
  await shot('04-jump-from-added-file-lands-in-diff');

  // 5. An added line of that diff: `bye` jumps to its definition in the added file (all added rows).
  p = await waitToken('GreetingService.java', 14, 'bye');
  await ctrlClick(p);
  await until(`document.querySelector('.source-dialog header h2').textContent==='Farewell.java'`, 'jump from an added line');
  d = await dialogState();
  results.addedLineJump = d;
  assert.ok(d.diff && d.delRows === 0 && d.addRows > 0 && d.targetToken === 'bye' && /public String bye/.test(d.target), JSON.stringify(d));
  await shot('05-added-line-jumps-into-added-file');

  // 6. Back / forward (Alt+←/→) through these views.
  await key('ArrowLeft', ALT);
  await until(`document.querySelector('.source-dialog header h2').textContent==='GreetingService.java'`, 'back to the changed diff');
  d = await dialogState(); results.back = d; assert.ok(d.diff && d.forward);
  await key('ArrowLeft', ALT);
  await until(`document.querySelector('.source-dialog header h2').textContent!=='GreetingService.java'&&!!${section('Farewell.java')}&&!document.querySelector('[aria-label=Back]:not([disabled])')`, 'back to the opening view');
  await key('ArrowRight', ALT);
  await until(`document.querySelector('.source-dialog header h2').textContent==='GreetingService.java'`, 'forward again');
  await shot('06-back-forward-restores-the-diff');

  // 7. A deleted row is not navigable; find in file still covers it.
  await ctrlClick(await deletedLine('GreetingService.java', 14));
  await until(`!!document.querySelector('.source-dialog .nav-message')`, 'deleted-row message');
  d = await dialogState(); results.deletedRow = d.message;
  assert.equal(d.message, "Deleted lines aren't navigable; find in file still works here.");
  await shot('07-deleted-row-message');

  // 8. Split layout: the same added line (right cell) navigates; a left-only (deleted) cell does not.
  await click(`[...document.querySelectorAll('.diff-layout-toggle button')].find(b=>b.textContent==='Split')`);
  await until(`!!document.querySelector('.source-dialog .diff-split-table')`, 'split layout');
  await ctrlClick(await deletedLine('GreetingService.java', 14));
  await until(`document.querySelector('.source-dialog .nav-message')?.textContent.startsWith("Deleted lines")`, 'split deleted-cell message');
  p = await waitToken('GreetingService.java', 14, 'Farewell');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: CTRL });
  await shot('08-split-layout-added-line');
  await ctrlClick(p);
  await until(`document.querySelector('.source-dialog header h2').textContent==='Farewell.java'&&!!document.querySelector('.source-dialog .diff-split-table')`, 'split jump into the added file');
  d = await dialogState(); results.splitJump = d;
  assert.ok(d.split && /public class Farewell/.test(d.target) && d.targetToken === 'Farewell', JSON.stringify(d));
  await shot('09-split-jump-into-added-file');
  // Ctrl+click on the added file itself (split right cell): a local field's type stays in the change.
  p = await waitToken('Farewell.java', 6, 'GreetingService');
  await ctrlClick(p);
  await until(`document.querySelector('.source-dialog header h2').textContent==='GreetingService.java'`, 'split jump from the added file');
  await key('Control', 0, 'up');
  await click(`[...document.querySelectorAll('.diff-layout-toggle button')].find(b=>b.textContent==='Unified')`);

  // 9. A file edited after the last analysis: Recompare, and its diff says to re-analyze instead of navigating.
  await click(`document.querySelector('.source-dialog [aria-label="Close source"]')`);
  await until(`!document.querySelector('.source-dialog')?.open`, 'dialog closed');
  const mainPath = repo + '/app/src/main/java/com/example/app/Main.java';
  await fs.writeFile(mainPath, (await fs.readFile(mainPath, 'utf8')) + '\n// edited after the last analysis\n');
  const before = reviewPosts();
  await ev(`document.querySelector('.review-options summary').click()`);
  await click(`[...document.querySelectorAll('.review-options button')].find(b=>b.textContent==='Recompare')`);
  await until(`!document.querySelector('.review-toggle').disabled`, 'recompare finished');
  assert.equal(reviewPosts(), before + 1);
  await ev(`document.querySelector('.review-options').open=false`);
  await pause(800);
  await openClass('Main');
  await until(`!!${section('Main.java')}?.querySelector('.diff-unified')`, 'Main.java now a diff');
  await holdCtrl();
  await pause(1500);
  const mainPoint = await ev(`(()=>{const s=${section('Main.java')};const c=[...s.querySelectorAll('.diff-row-add code')].pop();c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+30,y:r.y+r.height/2};})()`);
  for (let i = 0; i < 20 && !(await dialogState()).hint; i++) { await ctrlClick(mainPoint); await pause(300); }
  d = await dialogState(); results.stale = d.message;
  assert.ok(d.hint && d.message === 'This file changed since the last analysis; re-analyze to navigate it.', JSON.stringify(d));
  await shot('10-stale-file-hint');
  await key('Control', 0, 'up');
  // A file unchanged by the review opens as plain after-change source, still served by the current analysis.
  await click(`document.querySelector('.source-dialog [aria-label="Close source"]')`);
  await until(`!document.querySelector('.source-dialog')?.open`, 'dialog closed');
  await openClass('Factories');
  await holdCtrl();
  await until(`[...(${section('Factories.java')}?.querySelectorAll('.nav-token')||[])].some(t=>t.textContent==='GreetingService')`, 'plain head file navigable');
  d = await dialogState(); results.unchangedPlain = { diff: d.diff, served: d.served };
  assert.ok(!d.diff && d.served.some(s => s.startsWith('Navigation from Current analysis')), JSON.stringify(d));
  await key('Control', 0, 'up');
  await click(`document.querySelector('.source-dialog [aria-label="Close source"]')`);
  await until(`!document.querySelector('.source-dialog')?.open`, 'dialog closed');
  await openClass('Farewell');

  // 10. The dialog at 390 px.
  await viewport(390, 844);
  await pause(500);
  results.dialogOverflow390 = await overflow();
  assert.equal(results.dialogOverflow390, false);
  await holdCtrl();
  await waitToken('Farewell.java', 6, 'GreetingService');
  await key('Control', 0, 'up');
  await shot('11-dialog-390');

  results.offPage = requests.filter(u => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('about:'));
  assert.deepEqual(results.offPage, []);
  assert.deepEqual(errors, []);
  await fs.writeFile(out + '/diff-navigation-report.json', JSON.stringify({ pass: true, results, screenshots: shots, pageErrors: errors }, null, 2));
  console.log('PASS: repository root through the form (390 px), module review from the root, Ctrl+click in an added file and on an added line (unified and split), jumps land in the target diff, back/forward, deleted-row message, stale hint after Recompare, 390 px dialog, no page errors, no off-machine requests');
} catch (e) {
  await shot('zz-failure').catch(() => {});
  await fs.writeFile(out + '/diff-navigation-report.json', JSON.stringify({ pass: false, error: String(e?.stack || e), results, screenshots: shots, pageErrors: errors }, null, 2));
  throw e;
} finally {
  ws.close();
}
