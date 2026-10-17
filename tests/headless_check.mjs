// Headless browser check (SPEC §8.2–8.4). Needs Google Chrome and a local server:
//   python3 -m http.server 8080      (in the project folder)
//   node tests/headless_check.mjs    (screenshots go to /tmp/ltot-test/v2-*.png)
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket — nothing to install.
// Never contacts a Supabase project: the "offline" test points config at https://ltot-test.invalid (a name that cannot resolve).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = '/tmp/ltot-test';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
rmSync(OUT + '/profile-v2', { recursive: true, force: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/profile-v2`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=390,844'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
if (!ver) { console.log('SKIP: Chrome did not start'); chrome.kill(); process.exit(0); }

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map(), handlers = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  handlers.forEach((h) => h(m));
});
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = ++seq; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  (ok ? pass++ : fail++);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  console.log(results[results.length - 1]);
}

// Only the front tab gets input events and is "visible" (the app pauses live sharing in hidden tabs), so switch explicitly.
let fronted = null;
async function front(p) { if (fronted !== p) { fronted = p; await p.s('Page.bringToFront'); await sleep(200); } }

async function openPage(path, opts = {}) {
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
  const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
  const p = { sessionId, targetId, errors: [], requests: [] };
  const s = (m, prm) => send(m, prm, sessionId);
  p.s = s;
  handlers.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') p.errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') p.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') p.errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    if (m.method === 'Network.requestWillBeSent') p.requests.push(m.params.request.url);
    if (m.method === 'Fetch.requestPaused' && opts.config) {
      s('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from(opts.config).toString('base64') });
    }
  });
  await s('Runtime.enable'); await s('Page.enable'); await s('Log.enable'); await s('Network.enable');
  if (opts.block) await s('Network.setBlockedURLs', { urls: opts.block });
  if (opts.config) await s('Fetch.enable', { patterns: [{ urlPattern: '*config.js*' }] });
  if (opts.reducedMotion) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true });
  if (opts.geo) await s('Emulation.setGeolocationOverride', { latitude: opts.geo[0], longitude: opts.geo[1], accuracy: 10 });
  fronted = p;
  await s('Page.navigate', { url: BASE + path });
  await sleep(opts.wait || 4000);
  p.ev = async (expr) => {
    await front(p);
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval failed: ' + expr + ' → ' + JSON.stringify(r.result.exceptionDetails.exception?.description));
    return r.result?.result?.value;
  };
  p.click = (sel) => p.ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true;})()`);
  p.tap = async (x, y) => {
    await front(p);
    await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60);
    await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
  };
  p.shot = async (name) => {
    await front(p);
    const r = await s('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64'));
  };
  return p;
}
const realErrors = (p) => p.errors.filter((e) => !/ERR_BLOCKED_BY_CLIENT|ltot-test\.invalid|ERR_NAME_NOT_RESOLVED|Failed to fetch|favicon/.test(e));

await send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['geolocation'] });

// =========================================================== 1. normal page (planning mode, local backend)
{
  const p = await openPage('', { geo: [42.9668, -81.2455] });
  check('page loads with no JS errors (390×844)', realErrors(p).length === 0, realErrors(p).join(' | '));
  const st = await p.ev('__ltot.state()');
  check('local backend by default', st.mode === 'local', st.mode);
  const perf = await p.ev('__ltot.hexPerf()');
  check('h3-js loaded: hex grid is H3 resolution 8', perf.grid === 'h3', JSON.stringify(perf));
  check('planning hexes drawn (0 < n ≤ 400)', perf.drawn > 0 && perf.drawn <= 400, `${perf.drawn} drawn of ${perf.plan}`);
  check('single canvas renderer for hexes', (await p.ev('document.querySelectorAll(".hex-canvas").length')) === 1);
  check('first screen: sheet closed, 4 big buttons', await p.ev(`document.getElementById('sheet').dataset.open==='false' && [...document.querySelectorAll('.tabbar button')].filter(b=>b.getBoundingClientRect().height>=56).length===4`));
  check('3 event markers on the map', (await p.ev('document.querySelectorAll(".ev-pin").length')) === 3);
  check('HUD overlay present and not clickable', await p.ev(`getComputedStyle(document.querySelector('.hud')).pointerEvents==='none' && getComputedStyle(document.querySelector('.hud')).display!=='none'`));
  await p.shot('v2-map-hex.png');

  // CPU-throttled redraw timing (roughly a mid-range phone)
  await p.s('Emulation.setCPUThrottlingRate', { rate: 4 });
  const times = [];
  for (const z of [12, 13, 14, 13]) { await p.ev(`__ltot.map.setZoom(${z}, {animate:false})`); await sleep(300); times.push((await p.ev('__ltot.hexPerf()')).ms); }
  await p.s('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('hex redraw < 16 ms at 4× CPU throttle', Math.max(...times) < 16, times.join(' / ') + ' ms');

  // layers
  const layerNames = ['areas', 'hex', 'houses', 'dots', 'events'];
  let layerOk = true;
  for (const k of layerNames) {
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    const off = await p.ev(`!__ltot.state().layers['${k}'] && document.querySelector('.lchip[data-layer="${k}"]').getAttribute('aria-pressed')==='false'`);
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    const on = await p.ev(`__ltot.state().layers['${k}']`);
    if (!off || !on) layerOk = false;
  }
  check('each map layer toggles off and on', layerOk && realErrors(p).length === 0);
  check('hex layer back with legend', await p.ev(`!document.getElementById('legend').hidden && document.querySelectorAll('.hex-canvas').length===1`));

  // tabs
  let tabsOk = true;
  for (const tab of ['areas', 'route', 'pins', 'live']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await sleep(200);
    if (!(await p.ev(`!document.getElementById('panel-${tab}').hidden && document.getElementById('sheet').dataset.open==='true'`))) tabsOk = false;
  }
  check('all 4 tabs open their panel', tabsOk);

  // area popup with sources + label
  const pop = await p.ev(`(function(){var c; __ltot.map.eachLayer(function(l){ if(!c && l.options && l.options.className==='area-circle') c=l; });
    c.fire('click',{latlng:c.getLatLng()}); var t=document.querySelector('.leaflet-popup-content').textContent; __ltot.map.closePopup(); return t;})()`);
  check('area popup: scores, label, dated sources', /Based on local news and parent reports, 2026/.test(pop) && /Sources/.test(pop) && /20\d\d-\d\d/.test(pop) && /Candy/.test(pop), pop.slice(0, 90) + '…');

  // live gate (today is not Oct 31)
  await p.click('.tabbar [data-tab="live"]'); await sleep(200);
  check('live toggle disabled outside Oct 31 window, shows "Opens Halloween night"',
    await p.ev(`document.getElementById('shareToggle').disabled && !document.getElementById('liveGate').hidden && /Opens Halloween night/.test(document.getElementById('liveGate').textContent)`));
  check('consent text is the exact spec wording', await p.ev(`[...document.querySelectorAll('.consent p')].some(n=>n.textContent==="Share an anonymous dot so other families can see where it's busy. No name, rough location only, disappears after 30 minutes.")`));

  // board
  await p.click('.tabbar [data-tab="pins"]'); await sleep(150);
  await p.click('#pinsSub [data-v="board"]'); await sleep(150);
  await p.ev(`document.getElementById('postBody').value='best street: www.spam.com'; document.getElementById('postBtn').click()`); await sleep(300);
  check('board rejects links', await p.ev(`!document.getElementById('postErr').hidden && /Links/.test(document.getElementById('postErr').textContent)`));
  await p.ev(`document.getElementById('postBody').value='call 519 555 1234'; document.getElementById('postBtn').click()`); await sleep(300);
  check('board rejects phone numbers', await p.ev(`/Phone/.test(document.getElementById('postErr').textContent)`));
  await p.ev(`document.getElementById('postArea').value='old-north'; document.getElementById('postBody').value='Old North was so friendly!'; document.getElementById('postBtn').click()`); await sleep(600);
  check('valid post appears', await p.ev(`/Old North was so friendly/.test(document.getElementById('postList').textContent)`));
  await p.click('#postList .vote'); await sleep(500);
  const v1 = await p.ev(`document.querySelector('#postList .vote b').textContent`);
  await p.click('#postList .vote'); await sleep(400);
  const v2 = await p.ev(`document.querySelector('#postList .vote b').textContent`);
  check('one upvote per device', v1 === '1' && v2 === '1' && await p.ev(`document.querySelector('#postList .vote').classList.contains('voted')`), `${v1} → ${v2}`);
  await p.shot('v2-board-local.png');

  // house marker via a real tap on the map
  await p.click('#pinsSub [data-v="houses"]'); await sleep(150);
  const before = await p.ev('document.querySelectorAll(".pk").length');
  await p.click('#addHouseBtn'); await sleep(400);
  check('“Add my house” enters tap mode', await p.ev(`!document.getElementById('modeBanner').hidden`));
  await p.tap(195, 420);
  check('tapping the map opens the house dialog', await p.ev(`document.getElementById('houseDialog').open`));
  await p.click('#typeGrid .tchip-teal'); await sleep(100);
  await p.click('#tplChips .fchip'); await sleep(100);
  check('template note fills the note box with a counter', await p.ev(`document.getElementById('hNote').value.length>5 && /\\/140/.test(document.getElementById('hCount').textContent)`));
  check('house dialog warns about names', await p.ev(`/Don't post your name/.test(document.getElementById('houseDialog').textContent)`));
  await p.ev(`document.getElementById('hStart').value='17:30'; document.getElementById('hEnd').value='20:30'`);
  await p.click('#hSave'); await sleep(700);
  const after = await p.ev('document.querySelectorAll(".pk").length');
  check('marker saved and drawn as a glowing pumpkin', after === before + 1 && await p.ev(`document.querySelectorAll('.pk-teal.pk-giving').length>=1`), `${before} → ${after}`);
  await p.ev(`[...document.querySelectorAll('#myHouseList .seg button')][2].click()`); await sleep(600);
  check('one-tap “Out of candy” greys the marker', await p.ev(`document.querySelectorAll('.pk-out').length>=1`));
  await p.ev(`[...document.querySelectorAll('#filterChips .fchip')][3].click()`); await sleep(200);
  check('filter “hide out” hides it', (await p.ev('document.querySelectorAll(".pk-out").length')) === 0);
  await p.ev(`[...document.querySelectorAll('#filterChips .fchip')][3].click()`); await sleep(200);

  // language
  await p.click('#langBtn'); await sleep(400);
  const zh = await p.ev(`({ title: document.title, lang: document.documentElement.lang, tabs: [...document.querySelectorAll('.tabbar button')].map(b=>b.textContent).join('|'),
     leftovers: [...document.querySelectorAll('[data-i18n]')].filter(n=>n.textContent===n.dataset.i18n).map(n=>n.dataset.i18n),
     consent: document.querySelector('.consent p').textContent })`);
  check('one-tap Chinese: title, tabs, consent', /万圣节/.test(zh.title) && zh.lang === 'zh-CN' && /社区/.test(zh.tabs) && /匿名圆点/.test(zh.consent), zh.tabs);
  check('no untranslated i18n keys on screen', zh.leftovers.length === 0, zh.leftovers.join(','));
  await p.click('.tabbar [data-tab="areas"]'); await sleep(200);
  await p.shot('v2-areas-zh.png');
  await p.click('#safetyBtn'); await sleep(200);
  check('safety panel: 10 tips', (await p.ev('document.querySelectorAll("#tipList li").length')) === 10);
  await p.click('#panel-safety .privacy-link'); await sleep(200);
  check('privacy page (zh) with 8 sections', (await p.ev('document.querySelectorAll("#privacyList dt").length')) === 8 && /PIPEDA/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)));
  await p.click('#langBtn'); await sleep(300);
  check('privacy page (en)', /What|No accounts/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)));
  check('still no JS errors after all interactions', realErrors(p).length === 0, realErrors(p).join(' | '));
  check('no Supabase library downloaded in local mode', !p.requests.some((u) => /supabase/.test(u)));
}

// =========================================================== 2. two demo tabs (?demo=1)
{
  const a = await openPage('?demo=1', { geo: [42.9668, -81.2455] });
  const b = await openPage('?demo=1', { geo: [42.999, -81.2475] });
  check('demo tabs load without errors', realErrors(a).length + realErrors(b).length === 0, realErrors(a).concat(realErrors(b)).join(' | '));
  check('demo chip shown, live toggle enabled', await a.ev(`!document.getElementById('demoChip').hidden && !document.getElementById('shareToggle').disabled`));
  const pa = await a.ev('__ltot.state().posts'), pb0 = await b.ev('__ltot.state().posts');
  await a.ev(`__ltot.openTab('pins'); document.querySelector('#pinsSub [data-v="board"]').click();
    document.getElementById('postBody').value='Tab A says hi from Baker St'; document.getElementById('postBtn').click()`);
  await sleep(1500);
  check('post from tab A appears in tab B without reload', /Tab A says hi/.test(await b.ev(`document.getElementById('postList').textContent`)) && (await b.ev('__ltot.state().posts')) === pb0 + 1, `A had ${pa}, B ${pb0} → ${await b.ev('__ltot.state().posts')}`);

  // marker status change propagates
  await a.ev(`document.querySelector('#pinsSub [data-v="houses"]').click(); document.getElementById('addHouseBtn').click()`); await sleep(400);
  const pt = await a.ev(`(function(){ __ltot.map.setView([42.970, -81.240], 16, {animate:false}); var r=document.getElementById('map').getBoundingClientRect();
    var c=__ltot.map.latLngToContainerPoint([42.970, -81.240]); return [r.left+c.x, r.top+c.y]; })()`);
  await sleep(300);
  await a.tap(pt[0], pt[1]);
  check('demo tab: house dialog opened from a map tap', await a.ev(`document.getElementById('houseDialog').open`));
  await a.click('#hSave'); await sleep(900);
  const bOut0 = await b.ev('document.querySelectorAll(".pk-out").length');
  await a.ev(`__ltot.openTab('pins'); [...document.querySelectorAll('#myHouseList .seg button')][2].click()`); await sleep(1500);
  const bOut1 = await b.ev('document.querySelectorAll(".pk-out").length');
  check('“Out of candy” in tab A updates tab B', bOut1 === bOut0 + 1, `${bOut0} → ${bOut1}`);

  // live dots
  await a.ev(`__ltot.openTab('live')`); await sleep(200);
  await a.click('#shareToggle'); await sleep(600);
  if (await a.ev(`document.getElementById('locDialog').open`)) { await a.click('#locYes'); }
  await sleep(2500);
  const sa = await a.ev('__ltot.state()');
  await sleep(1200);
  const sb = await b.ev('__ltot.state()');
  check('tab A is sharing and sent one coarsened dot', sa.live && sa.ownSids.length === 1, JSON.stringify({ live: sa.live, own: sa.ownSids.length }));
  const bSeesA = await b.ev(`(async function(){ var d = await __ltot.backend.listDots(); return d.some(function(x){ return x.sidHash===${JSON.stringify(sa.ownSids[0])}; }); })()`);
  check('tab B sees tab A’s dot', bSeesA && sb.drawnDots === sb.dots, `B drew ${sb.drawnDots}/${sb.dots}`);
  check('tab A does not draw its own dot twice', sa.drawnDots === sa.dots - 1, `A drew ${sa.drawnDots} of ${sa.dots}`);
  const stored = await a.ev(`(async function(){ var d = await __ltot.backend.listDots(); var me = d.filter(function(x){ return x.sidHash===${JSON.stringify(sa.ownSids[0])}; })[0]; return me ? [me.lat, me.lng] : null; })()`);
  const dist = stored ? __dist([42.9668, -81.2455], stored) : 1e9;
  check('sent position is coarsened (moved, but < ~65 m)', stored && dist > 0.5 && dist < 65, stored ? dist.toFixed(1) + ' m from the real spot' : 'none');
  check('status line shows sharing countdown', /Sharing · next update in \d+ s · stops by itself in 90 min/.test(await a.ev(`document.getElementById('liveStatus').textContent`)));
  await a.ev('__ltot.computeHex()');
  const lp = await a.ev('__ltot.hexPerf()');
  const liveCounts = await a.ev(`(async function(){ return (await __ltot.backend.liveHexCounts(20, __ltot.grid.cell)).map(function(c){return c.count;}); })()`);
  check('live hex mode: only hexes with ≥ 3 dots', lp.live > 0 && liveCounts.every((n) => n >= 3), `live hexes ${lp.live}, counts ${liveCounts.join(',')}`);
  await a.ev(`__ltot.openTab(null); __ltot.map.setView([42.968, -81.247], 14, {animate:false})`); await sleep(800);
  await a.shot('v2-live-demo.png');
  await a.ev(`__ltot.openTab('live')`); await sleep(400);
  await a.shot('v2-live-panel.png');
  await b.ev(`__ltot.openTab('pins'); document.querySelector('#pinsSub [data-v="board"]').click()`); await sleep(300);
  await b.shot('v2-board.png');
  await a.click('#shareToggle'); await sleep(1500);
  const bStill = await b.ev(`(async function(){ var d = await __ltot.backend.listDots(); return d.some(function(x){ return x.sidHash===${JSON.stringify(sa.ownSids[0])}; }); })()`);
  check('turning sharing off removes the dot for others', !bStill && !(await a.ev('__ltot.state().live')));
  check('demo tabs: no JS errors after live test', realErrors(a).length + realErrors(b).length === 0, realErrors(a).concat(realErrors(b)).join(' | '));
}

// =========================================================== 3. h3-js blocked → local hex grid fallback
{
  const p = await openPage('', { block: ['*h3-js*'] });
  const perf = await p.ev('__ltot.hexPerf()');
  check('h3-js blocked → local hex grid still draws', perf.grid === 'local' && perf.drawn > 0, JSON.stringify(perf));
  await p.ev(`__ltot.openTab('live')`); await sleep(200);
  check('fallback note visible', await p.ev(`!document.getElementById('hexFallback').hidden`));
  check('no JS errors with h3 blocked', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 4. backend 'supabase' but not configured
{
  const cfg = `window.TOT_CONFIG={backend:'supabase',supabaseUrl:'',supabaseAnonKey:'',liveWindow:{date:'2026-10-31',start:'15:00',end:'23:00',tz:'America/Toronto'},dotTtlMin:30,hexWindowMin:20,hexMinCount:3,pollSec:60};`;
  const p = await openPage('', { config: cfg });
  check('supabase selected but empty → offline chip, local mode', await p.ev(`!document.getElementById('offlineChip').hidden && __ltot.backend.reason==='notConfigured'`));
  check('…and supabase-js is not downloaded', !p.requests.some((u) => /supabase-js/.test(u)));
}

// =========================================================== 5. supabase configured but unreachable → automatic fallback
{
  const cfg = `window.TOT_CONFIG={backend:'supabase',supabaseUrl:'https://ltot-test.invalid',supabaseAnonKey:'${'x'.repeat(40)}',liveWindow:{date:'2026-10-31',start:'15:00',end:'23:00',tz:'America/Toronto'},dotTtlMin:30,hexWindowMin:20,hexMinCount:3,pollSec:60};`;
  const p = await openPage('', { config: cfg, wait: 8000 });
  check('supabase-js lazy-loaded from CDN (SRI ok) only when configured', p.requests.some((u) => /supabase-js@2\.118\.0/.test(u)) && await p.ev(`!!(window.supabase && window.supabase.createClient)`));
  check('unreachable server → “Offline mode” chip', await p.ev(`__ltot.backend.mode==='offline' && !document.getElementById('offlineChip').hidden`));
  await p.ev(`__ltot.openTab('pins'); document.querySelector('#pinsSub [data-v="board"]').click();
    document.getElementById('postBody').value='works offline'; document.getElementById('postBtn').click()`); await sleep(800);
  check('board still works offline (saved locally)', /works offline/.test(await p.ev(`document.getElementById('postList').textContent`)));
  check('no unexpected JS errors in offline mode', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 6. reduced motion
{
  const p = await openPage('', { reducedMotion: true, wait: 2500 });
  check('prefers-reduced-motion turns the radar HUD off', await p.ev(`getComputedStyle(document.querySelector('.hud')).display==='none'`));
}

function __dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

console.log(`\n${pass} passed, ${fail} failed`);
writeFileSync(`${OUT}/v2-results.txt`, results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
ws.close();
chrome.kill();
await sleep(500);
process.exit(fail ? 1 : 0);
