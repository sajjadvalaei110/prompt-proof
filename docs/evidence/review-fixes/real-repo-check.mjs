// Real-repository check of the reported Changes-mode problems, on a copy of the owner's database.
//   node real-repo-check.mjs <appBase> <debugBase> <outDir> <reviewAssistSnapshotId>
import fs from 'node:fs/promises';
const [base, debug, outDir, startSnapshot] = process.argv.slice(2);
await fs.mkdir(outDir, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const report = [];
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
let seq = 0; const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const reviews = [];
socket.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) { const w = pending.get(m.id); if (w) { pending.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); } return; }
  if (m.method === 'Network.requestWillBeSent' && /\/reviews$/.test(m.params.request.url)) reviews.push({ url: m.params.request.url, body: m.params.request.postData, status: null });
  if (m.method === 'Network.responseReceived' && /\/reviews$/.test(m.params.response.url)) { const r = reviews.find(x => x.status === null); if (r) r.status = m.params.response.status; }
};
await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
async function until(fn, label, tries = 600) { for (let i = 0; i < tries; i++) { try { if (await fn()) return; } catch {} await pause(200); } throw new Error('Timed out: ' + label); }
const shot = async name => { await pause(800); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.data, 'base64')); };
const click = sel => evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)throw Error('missing ${sel}');b.click();return true})()`);
const setBase = v => evaluate(`(()=>{const e=document.querySelector('input[placeholder="Default merge base, or origin/main"]');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
const cy = `document.querySelector('.graph-canvas')?._cyreg?.cy`;
const state = async label => {
  const s = await evaluate(`(()=>{const c=${cy};const changes={};if(c){c.elements().forEach(x=>{const v=x.data('reviewChange');if(v){const k=(x.isNode()?'node:':'edge:')+v;changes[k]=(changes[k]||0)+1}})}
    return {toggle:document.querySelector('.review-toggle')?.getAttribute('aria-pressed'),baseField:document.querySelector('input[placeholder="Default merge base, or origin/main"]')?.value,
      error:document.querySelector('.error-banner span')?.textContent||null,outcome:document.querySelector('.review-outcome')?.textContent||null,
      popoverNotices:[...document.querySelectorAll('.review-options .notice')].map(n=>n.textContent),workspace:document.querySelector('.workspace-switch')?.textContent,changes}})()`);
  report.push({ label, ...s, reviewRequests: reviews.map(r => ({ body: r.body, status: r.status })) });
  console.log(label, JSON.stringify(s));
};
const waitIdle = () => until(() => evaluate(`!document.querySelector('.review-toggle')?.disabled`), 'compare finished');

await cdp('Page.navigate', { url: `${base}/?snapshotId=${startSnapshot}` });
await until(() => evaluate(`!!${cy}&&${cy}.nodes().length>0`), 'review-assist map');
// 1. The owner's comparison: base 9c2045e, module workspace src/main.
await click('.review-options summary'); await setBase(process.env.BASE1 || '9c2045e'); await pause(200);
await click('.review-toggle'); await pause(500); await waitIdle(); await pause(1500);
await state('1 review-assist src/main, base '+(process.env.BASE1||'9c2045e')); await shot('1-review-assist-no-change-in-module');
// 2. Recompare against a base that changed Java under src/main.
await setBase('fe97bde'); await pause(200);
await evaluate(`[...document.querySelectorAll('.review-options button')].find(b=>b.textContent.trim()==='Recompare').click()`);
await pause(500); await waitIdle(); await pause(1500);
await click('.review-options summary');
await state('2 review-assist src/main, Recompare base fe97bde'); await shot('2-review-assist-base-fe97bde');
// 3. Switch, in the same page, to second-review-assist/src and turn Changes on.
await click('.workspace-switch'); await pause(800);
await evaluate(`(()=>{const b=[...document.querySelectorAll('.recent-projects button')].find(b=>b.querySelector('small')?.textContent==='/home/sajjad/projects/second-review-assist/src');if(!b)throw Error('no recent src');b.click();return true})()`);
await until(() => evaluate(`document.querySelector('.workspace-switch')?.textContent.startsWith('src')&&!!${cy}&&${cy}.nodes().length>0`), 'second-review-assist map');
await pause(1500);
if (await evaluate(`document.querySelector('.review-toggle')?.getAttribute('aria-pressed')`) === 'true') { await click('.review-toggle'); await pause(800); }
await click('.review-options summary'); await pause(300);
await state('3a second-review-assist/src opened (before Changes)');
await click('.review-toggle'); await pause(500); await waitIdle(); await pause(1500);
await state('3b second-review-assist/src, Changes on'); await shot('3-second-review-assist-src-changes');
await fs.writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
process.exit(0);
