// Real-browser acceptance for source-viewer navigation (ADR 0013). Driven by
// scripts/verify_code_navigation_pipeline.py: <base> <debugger> <scip fixture> <javaparser fixture> <out>.
// Every gesture is a real CDP input event (keys with modifiers, mouse moves and clicks), not a synthetic DOM event.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [base, debug, scipFixture, plainFixture, out] = process.argv.slice(2);
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(), errors = [], requests = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  else if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async (expr, what, tries = 480) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return; await pause(250); } throw Error('Timed out: ' + what); };
const shots = [];
const shot = async name => { await pause(350); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${out}/${name}.png`, Buffer.from(r.data, 'base64')); shots.push(name); };
const CTRL = 2, ALT = 1, SHIFT = 8;
const KEYS = { Control: ['ControlLeft', 17], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Enter: ['Enter', 13], f: ['KeyF', 70] };
const key = async (k, modifiers = 0, type = 'press') => {
  const [code, vk] = KEYS[k];
  const params = { key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(k === 'Enter' ? { text: '\r' } : {}) };
  if (type !== 'up') await cdp('Input.dispatchKeyEvent', { type: k === 'Enter' ? 'keyDown' : 'rawKeyDown', ...params });
  if (type !== 'down') await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...params, modifiers: k === 'Control' ? 0 : modifiers });
};
/** Centre of the first `.nav-token` matching text on a 1-based line of the section whose path includes `file`. */
const tokenPoint = (file, line, text, nth = 0) => ev(`(()=>{
  const s=[...document.querySelectorAll('.source-dialog section')].find(s=>s.querySelector('.source-path').textContent.includes(${JSON.stringify(file)}));
  const row=[...s.querySelectorAll('.code-line')].find(r=>r.querySelector('span').textContent===${JSON.stringify(String(line))});
  const t=[...row.querySelectorAll('.nav-token')].filter(t=>t.textContent===${JSON.stringify(text)})[${nth}];
  if(!t)throw Error('no token ${text} on line ${line}');
  t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,title:t.title||''};})()`);
const ctrlClick = async p => {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, modifiers: CTRL });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: CTRL });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: CTRL });
};
const dialogState = () => ev(`(()=>{const d=document.querySelector('.source-dialog');if(!d)return null;return {
  title:d.querySelector('header h2').textContent, sub:d.querySelector('header p').textContent,
  paths:[...d.querySelectorAll('section .source-path')].map(s=>s.firstChild.textContent.trim()),
  target:d.querySelector('.nav-target')?.closest('.code-line')?.textContent||null,
  targetToken:d.querySelector('.nav-target')?.textContent||null,
  message:d.querySelector('.nav-message')?.firstChild?.textContent?.trim()||null,
  hint:!!d.querySelector('.nav-hint'), scrollTop:Math.round(d.scrollTop),
  back:!!d.querySelector('[aria-label=Back]')&&!d.querySelector('[aria-label=Back]').disabled,
  forward:!!d.querySelector('[aria-label=Forward]')&&!d.querySelector('[aria-label=Forward]').disabled,
  count:d.querySelector('.find-count')?.textContent||null};})()`);
const setInput = (selector, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
/** Imports a fixture through the real form; `scip` picks the scip-java engine and ticks the consent box. */
async function importProject(path, scip) {
  await cdp('Page.navigate', { url: base });
  await until(`!!document.querySelector('.welcome select[aria-label="Indexer"]')`, 'import form with engine picker');
  await setInput('.welcome input[aria-label="Local repository path"]', path);
  const engine = scip ? 'scip-java' : 'javaparser';
  await ev(`(()=>{const s=document.querySelector('.welcome select[aria-label="Indexer"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${engine}');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  if (scip) { await until(`!!document.querySelector('.build-consent input')`, 'consent box'); await ev(`document.querySelector('.build-consent input').click()`); }
  await until(`!document.querySelector('.welcome button.primary').disabled`, 'analyze enabled');
  await ev(`document.querySelector('.welcome button.primary').click()`);
  await until(`!!document.querySelector('.graph-canvas')?._cyreg?.cy?.edges().length`, `${engine} graph`);
}
/** Opens the evidence of the app -> core package route (the relationship whose sites include `greeter.greet(name)`). */
async function openRouteEvidence() {
  await ev(`(()=>{const cy=document.querySelector('.graph-canvas')._cyreg.cy;cy.edges().filter(e=>e.source().data('simpleName')==='com.example.app'&&e.target().data('simpleName')==='com.example.core')[0].emit('tap')})()`);
  await until(`[...document.querySelectorAll('.inspector button')].some(b=>b.textContent.startsWith('View source evidence'))`, 'edge inspector');
  await ev(`[...document.querySelectorAll('.inspector button')].find(b=>b.textContent.startsWith('View source evidence')).click()`);
  await until(`document.querySelectorAll('.source-dialog section').length===3`, 'evidence dialog');
}
const results = {};
try {
  await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. scip-java workspace through the real form; evidence of a relationship; Ctrl held arms navigation.
  await importProject(scipFixture, true);
  const workspaces = await (await fetch(base + '/api/workspaces')).json();
  results.scipWorkspace = workspaces.find(w => w.path === scipFixture);
  assert.equal(results.scipWorkspace.indexer, 'scip-java');
  await openRouteEvidence();
  await key('Control', CTRL, 'down');
  await until(`document.querySelectorAll('.source-dialog .nav-token').length>20`, 'occurrence tokens');
  const greet = await tokenPoint('GreetingService.java', 14, 'greet');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: greet.x, y: greet.y, modifiers: CTRL });
  results.hover = await ev(`(()=>{const t=[...document.querySelectorAll('.source-dialog .nav-token:hover')].pop();return {armed:document.querySelector('.source-dialog').classList.contains('nav-armed'),token:t?.textContent,underline:t?getComputedStyle(t).textDecorationLine:null}})()`);
  assert.deepEqual(results.hover, { armed: true, token: 'greet', underline: 'underline' }, 'Ctrl held: the token under the pointer is underlined');
  results.tokensOnCallLine = await ev(`[...[...document.querySelectorAll('.source-dialog section')].find(s=>s.textContent.includes('GreetingService.java')).querySelectorAll('.code-line')][13].querySelectorAll('.nav-token').length`);
  await shot('01-evidence-ctrl-hover');
  const evidenceScroll = (await dialogState()).scrollTop;

  // 2. Ctrl+click the call's name: jumps to the interface method in another module's file.
  await ctrlClick(greet);
  await until(`(document.querySelector('.source-dialog .nav-target')?.textContent)==='greet'`, 'cross-file jump');
  results.crossFile = await dialogState();
  assert.deepEqual(results.crossFile.paths, ['core/src/main/java/com/example/core/Greeter.java']);
  assert.match(results.crossFile.target, /^4\s+String greet\(String name\);$/);
  assert.equal(results.crossFile.back, true);
  await key('Control', 0, 'up');
  await shot('02-cross-file-definition');

  // 3. Back (Alt+Left) restores the evidence view at its scroll offset; Forward (button) returns.
  await key('ArrowLeft', ALT);
  await until(`document.querySelectorAll('.source-dialog section').length===3`, 'back to evidence');
  await pause(300);
  results.back = await dialogState();
  assert.equal(results.back.forward, true);
  assert.ok(Math.abs(results.back.scrollTop - evidenceScroll) <= 2, `back restores scroll (${results.back.scrollTop} vs ${evidenceScroll})`);
  await shot('03-back-restores-evidence');
  await ev(`document.querySelector('.source-dialog [aria-label=Forward]').click()`);
  await until(`(document.querySelector('.source-dialog .nav-target')?.textContent)==='greet'`, 'forward');
  results.forward = await dialogState();
  assert.deepEqual(results.forward.paths, ['core/src/main/java/com/example/core/Greeter.java']);
  await key('ArrowLeft', ALT);
  await until(`document.querySelectorAll('.source-dialog section').length===3`, 'back again');

  // 3b. A view left at the very top comes back at the top: offset 0 is a remembered position, not "none".
  // A short window makes the definition file tall enough to scroll.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 260, deviceScaleFactor: 1, mobile: false });
  await pause(200);
  await ev(`document.querySelector('.source-dialog').scrollTop=0`);
  await pause(100);
  await ev(`document.querySelector('.source-dialog [aria-label=Forward]').click()`);
  await until(`(document.querySelector('.source-dialog .nav-target')?.textContent)==='greet'`, 'forward from the top');
  await ev(`(()=>{const d=document.querySelector('.source-dialog');d.scrollTop=d.scrollHeight;})()`);
  await pause(100);
  results.topBefore = (await dialogState()).scrollTop;
  assert.ok(results.topBefore > 0, `the definition view scrolls away from the top (${results.topBefore})`);
  await key('ArrowLeft', ALT);
  await until(`document.querySelectorAll('.source-dialog section').length===3`, 'back to the top');
  await pause(300);
  results.backToTop = (await dialogState()).scrollTop;
  assert.equal(results.backToTop, 0, `back restores the top (${results.topBefore} -> ${results.backToTop})`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await pause(200);

  // 4. A local variable: `name` in greeter.greet(name) jumps to its declaration in the for loop.
  await key('Control', CTRL, 'down');
  await ctrlClick(await tokenPoint('GreetingService.java', 14, 'name'));
  await until(`(document.querySelector('.source-dialog .nav-target')?.closest('.code-line')?.querySelector('span')?.textContent)==='13'`, 'local variable jump');
  results.local = await dialogState();
  assert.deepEqual(results.local.paths, ['app/src/main/java/com/example/app/GreetingService.java']);
  assert.equal(results.local.targetToken, 'name');
  assert.match(results.local.target, /for \(String name : names\)/);
  await shot('04-local-variable-definition');

  // 5. An external target (the JDK's List.add) shows "outside workspace" and does not navigate.
  const add = await tokenPoint('GreetingService.java', 14, 'add');
  assert.equal(add.title, 'add · outside workspace');
  const list = await tokenPoint('GreetingService.java', 11, 'List');
  assert.equal(list.title, 'List · outside workspace');
  await ctrlClick(add);
  await until(`!!document.querySelector('.source-dialog .nav-message')`, 'external message');
  results.external = await dialogState();
  assert.equal(results.external.message, 'add · outside workspace');
  assert.deepEqual(results.external.paths, results.local.paths, 'external target does not navigate');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: add.x, y: add.y, modifiers: CTRL });
  await shot('05-external-target');
  await key('Control', 0, 'up');

  // 6. Find in file: Ctrl/Cmd+F, live "N of M", Enter / Shift+Enter, whole word.
  await key('ArrowLeft', ALT); await key('ArrowLeft', ALT);
  await until(`document.querySelectorAll('.source-dialog section').length===3`, 'evidence for find');
  await key('f', CTRL);
  await until(`document.activeElement?.getAttribute('aria-label')==='Find in file'&&document.activeElement.tagName==='INPUT'`, 'find input focused');
  await cdp('Input.insertText', { text: 'greet' });
  const expected = await ev(`[...document.querySelectorAll('.source-dialog section .code-line code')].reduce((n,c)=>n+(c.textContent.toLowerCase().match(/greet/g)||[]).length,0)`);
  await until(`(document.querySelector('.find-count')?.textContent)==='1 of ${expected}'`, 'find count');
  results.find = { query: 'greet', expected, first: (await dialogState()).count };
  await key('Enter'); results.find.afterEnter = (await dialogState()).count;
  assert.equal(results.find.afterEnter, `2 of ${expected}`);
  await key('Enter', SHIFT); await key('Enter', SHIFT); results.find.afterShiftEnterTwice = (await dialogState()).count;
  assert.equal(results.find.afterShiftEnterTwice, `${expected} of ${expected}`, 'Shift+Enter wraps backwards');
  results.find.activeVisible = await ev(`(()=>{const a=document.querySelector('.find-active');const r=a.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`);
  assert.equal(results.find.activeVisible, true);
  await shot('06-find-in-file');
  await ev(`document.querySelector('.find-bar [aria-label="Whole word"]').click()`);
  const whole = await ev(`[...document.querySelectorAll('.source-dialog section .code-line code')].reduce((n,c)=>n+(c.textContent.match(/(?<![\\p{L}\\p{M}\\p{N}\\p{Pc}])greet(?![\\p{L}\\p{M}\\p{N}\\p{Pc}])/giu)||[]).length,0)`);
  await until(`(document.querySelector('.find-count')?.textContent)==='1 of ${whole}'`, 'whole-word count');
  results.find.wholeWord = whole;
  assert.ok(whole < expected && whole >= 1);
  await ev(`document.querySelector('.find-bar [aria-label="Match case"]').click()`);
  await until(`(document.querySelector('.find-count')?.textContent||'').endsWith(' of ${whole}')||(document.querySelector('.find-count')?.textContent)==='No results'`, 'match case count');
  results.find.matchCaseWholeWord = (await dialogState()).count;
  await shot('07-find-whole-word-match-case');

  // 7. 390 px: dialog with the find bar and a definition view fits with no horizontal page scroll.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await pause(500);
  results.narrow = await ev(`(()=>{const d=document.querySelector('.source-dialog'),h=d.querySelector('header');return {page:document.documentElement.scrollWidth<=innerWidth,header:h.scrollWidth<=h.clientWidth+1,dialog:d.getBoundingClientRect().right<=innerWidth}})()`);
  assert.deepEqual(results.narrow, { page: true, header: true, dialog: true });
  await shot('08-narrow-390-find');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await ev(`document.querySelector('.source-dialog [aria-label="Close source"]').click()`);

  // 8. JavaParser snapshot: Ctrl+click shows the data-driven hint; find still works there.
  await importProject(plainFixture, false);
  const plainWorkspace = (await (await fetch(base + '/api/workspaces')).json()).find(w => w.path === plainFixture);
  assert.equal(plainWorkspace.indexer, 'javaparser');
  await openRouteEvidence();
  await key('Control', CTRL, 'down');
  await pause(800);
  results.plainTokens = await ev(`document.querySelectorAll('.source-dialog .nav-token').length`);
  assert.equal(results.plainTokens, 0, 'no clickable tokens without occurrence rows');
  const codePoint = await ev(`(()=>{const s=[...document.querySelectorAll('.source-dialog section')].find(s=>s.textContent.includes('GreetingService.java'));const c=[...s.querySelectorAll('.code-line')][13].querySelector('code');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2}})()`);
  await ctrlClick(codePoint);
  await until(`!!document.querySelector('.source-dialog .nav-hint')`, 'hint');
  results.hint = (await dialogState()).message;
  const indexers = await (await fetch(base + '/api/indexers')).json();
  const own = indexers.find(i => i.indexer === 'javaparser'), nav = indexers.filter(i => i.language === 'java' && i.providesNavigation).map(i => i.label);
  assert.equal(results.hint, `This snapshot's indexer (${own.label}) doesn't provide go to definition; engines that do: ${nav.join(', ')}.`);
  await key('Control', 0, 'up');
  await shot('09-javaparser-hint');
  await key('f', CTRL);
  await until(`document.activeElement?.getAttribute('aria-label')==='Find in file'&&document.activeElement.tagName==='INPUT'`, 'find input focused (javaparser)');
  await cdp('Input.insertText', { text: 'greet' });
  await until(`/^1 of \\d+$/.test(document.querySelector('.find-count')?.textContent||'')`, 'find on javaparser snapshot');
  results.plainFind = (await dialogState()).count;

  // Nothing left the machine: every page request went to the local app.
  results.offPage = requests.filter(u => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('about:'));
  assert.deepEqual(results.offPage, []);
  assert.deepEqual(errors, []);
  await fs.writeFile(out + '/navigation-report.json', JSON.stringify({ pass: true, results, screenshots: shots, pageErrors: errors }, null, 2));
  console.log('PASS: Ctrl+click relationship evidence into another file, local variable jump, back/forward with scroll restore (the top included), external target, find with count/whole word/match case, 390 px fit, JavaParser hint, no page errors, no off-machine requests');
} finally { ws.close(); }
