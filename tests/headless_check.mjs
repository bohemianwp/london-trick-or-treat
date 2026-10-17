// Headless browser check for v3 "Mark it!" (SPEC §8.2–8.4 + v3 pivot). Needs Google Chrome and a local server:
//   python3 -m http.server 8080      (in the project folder)
//   node tests/headless_check.mjs    (screenshots go to /tmp/ltot-test/v3-*.png)
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
rmSync(OUT + '/profile-v3', { recursive: true, force: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/profile-v3`,
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
// The welcome guide covers the screen on a first visit: close it before the other flows.
async function dismissGuide(p) { if (await p.ev(`!document.getElementById('guide').hidden`)) { await p.click('#guideSkip'); await sleep(200); } }
async function allowLoc(p) { if (await p.ev(`document.getElementById('locDialog').open`)) { await p.click('#locYes'); } }
const realErrors = (p) => p.errors.filter((e) => !/ERR_BLOCKED_BY_CLIENT|ltot-test\.invalid|ERR_NAME_NOT_RESOLVED|Failed to fetch|favicon/.test(e));

await send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['geolocation'] });

// =========================================================== 1. normal page (practice mode today, local backend)
{
  const p = await openPage('', { geo: [42.966812, -81.245533] });
  check('page loads with no JS errors (390×844)', realErrors(p).length === 0, realErrors(p).join(' | '));
  check('first visit: welcome guide with 3 cards', await p.ev(`!document.getElementById('guide').hidden && document.querySelectorAll('#guideTrack .gcard').length===3`));
  check('card 1 explains zones + “Your area isn’t on the map? Mark it!”', /Glowing hexagons/.test(await p.ev(`document.querySelector('#guideTrack .gcard').textContent`)) &&
    /Your area isn’t on the map\? Mark it! Once 3 people mark it, it lights up\./.test(await p.ev(`document.getElementById('guideTrack').textContent`)));
  await p.shot('v3-guide-en.png');
  await p.click('#guideNext'); await sleep(350); await p.click('#guideNext'); await sleep(350);
  check('Got it on the last card closes it and remembers ltot.guideSeen.v2', await p.ev(`!document.getElementById('guideDone').hidden`) &&
    (await p.click('#guideDone'), await sleep(200), await p.ev(`document.getElementById('guide').hidden && localStorage.getItem('ltot.guideSeen.v2')==='done'`)));
  const st = await p.ev('__ltot.state()');
  check('local backend, practice mode (today is not Oct 31)', st.mode === 'local' && st.markMode === 'practice' && await p.ev(`!document.getElementById('practiceChip').hidden`), st.mode + '/' + st.markMode);
  const perf = await p.ev('__ltot.zonePerf()');
  check('h3-js loaded: zones use H3 resolution 8', perf.grid === 'h3', JSON.stringify(perf));
  check('one canvas for the faint planning base layer', (await p.ev('document.querySelectorAll(".hex-canvas").length')) === 1 && perf.base > 0, `base hexes ${perf.base}`);
  check('tabs: Map / Route / Mark it! / Guide, all ≥ 56 px, Mark it! in the centre',
    await p.ev(`[...document.querySelectorAll('.tabbar button')].map(b=>b.dataset.tab).join()==='map,route,mark,guide' && [...document.querySelectorAll('.tabbar button')].every(b=>b.getBoundingClientRect().height>=56) && document.querySelectorAll('.tabbar button')[2].classList.contains('tab-mark')`));
  const bh = await p.ev(`document.getElementById('markBtn').getBoundingClientRect().height`);
  check('big glowing button ≥ 64 px, visible on the map', bh >= 64 && await p.ev(`(function(){var r=document.getElementById('markBtn').getBoundingClientRect(); return r.bottom<=document.querySelector('.tabbar').getBoundingClientRect().top && r.top>0;})()`), bh + ' px');
  check('first-time ⓘ hint next to the big button', await p.ev(`!document.getElementById('markHintBtn').hidden`));
  check('no house UI left', await p.ev(`!document.getElementById('addHouseBtn') && !document.getElementById('filterChips') && !document.querySelector('.pk')`));
  check('3 event markers on the map', (await p.ev('document.querySelectorAll(".ev-pin").length')) === 3);
  check('HUD overlay present and not clickable', await p.ev(`getComputedStyle(document.querySelector('.hud')).pointerEvents==='none' && getComputedStyle(document.querySelector('.hud')).display!=='none'`));
  check('legend: Quiet / Lively / Super hot + ⓘ “3+” note', /Quiet[\s\S]*Lively[\s\S]*Super hot/.test(await p.ev(`document.getElementById('legend').textContent`)) &&
    (await p.click('#legend .ibtn'), await sleep(150), /3 or more people marked it in the last 45 minutes/.test(await p.ev(`document.getElementById('hintLegend').textContent`)) && await p.ev(`!document.getElementById('hintLegend').hidden`)));
  check('mark window text follows config.js (no raw {win} placeholders)', !(await p.ev(`document.body.textContent.includes('{win}')`)) &&
    /last 45 minutes/.test(await p.ev(`document.getElementById('howtoList').textContent`)));
  await p.click('#legend .ibtn');
  await p.shot('v3-map-practice.png');

  // the big button creates a mark (one-shot location; first time explains, then asks)
  await p.click('#markBtn'); await sleep(500);
  await allowLoc(p); await sleep(1500);
  const m1 = await p.ev('__ltot.state()');
  check('big button → a mark is stored (practice, local)', m1.marks === 1 && m1.myMarks === 1, JSON.stringify({ marks: m1.marks, mine: m1.myMarks }));
  check('“Marked! 🎉” card with 3 optional tags', await p.ev(`!document.getElementById('markCard').hidden && document.querySelectorAll('#tagRow .tagbtn').length===3`) &&
    /Practice mark/.test(await p.ev(`document.getElementById('markCardText').textContent`)));
  check('celebration (particles + pulse) played once', (await p.ev('__ltot.state().celebrations')) === 1 && await p.ev(`document.getElementById('markBtn').classList.contains('pop')`));
  await p.shot('v3-marked.png');
  await p.click('#tagRow [data-tag="candy"]'); await sleep(400);
  const stored = await p.ev(`JSON.parse(localStorage.getItem('ltot.v3.marks'))[0]`);
  check('tag added with one tap', stored.tags.join() === 'candy' && await p.ev(`document.querySelector('#tagRow [data-tag="candy"]').getAttribute('aria-pressed')==='true'`), stored.tags.join());
  const dist = __dist([42.966812, -81.245533], [stored.lat, stored.lng]);
  check('stored mark is blurred (moved, < ~65 m), raw position not stored', dist > 0 && dist < 65 && !(await p.ev(`JSON.stringify(localStorage).includes('42.966812')`)), dist.toFixed(1) + ' m');
  check('1 mark → no zone shown (3+ rule)', (await p.ev('__ltot.state().zones.length')) === 0 && (await p.ev('document.querySelectorAll(".zbadge").length')) === 0);
  await p.click('#markCardDone'); await sleep(200);
  check('ⓘ hint goes away after the first mark', await p.ev(`document.getElementById('markHintBtn').hidden`));
  await p.click('.tabbar [data-tab="mark"]'); await sleep(800);
  check('centre “Mark it!” tab runs the same flow → kind 5-minute limit message', /mark again in \d+ min/.test(await p.ev(`document.getElementById('toast').textContent`)) && (await p.ev('__ltot.state().marks')) === 1,
    await p.ev(`document.getElementById('toast').textContent`));

  // layers
  let layerOk = true;
  for (const k of ['zones', 'areas', 'events']) {
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    const off = await p.ev(`!__ltot.state().layers['${k}'] && document.querySelector('.lchip[data-layer="${k}"]').getAttribute('aria-pressed')==='false'`);
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    if (!off || !(await p.ev(`__ltot.state().layers['${k}']`))) layerOk = false;
  }
  check('layer chips Zones / Areas / Events toggle off and on (+ Near me chip)', layerOk && await p.ev(`!!document.getElementById('nearChip')`) && realErrors(p).length === 0);

  // tabs
  let tabsOk = true;
  for (const tab of ['map', 'route', 'guide']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await sleep(200);
    if (!(await p.ev(`!document.getElementById('panel-${tab}').hidden && document.getElementById('sheet').dataset.open==='true'`))) tabsOk = false;
  }
  check('Map / Route / Guide tabs open their panel', tabsOk);
  check('Guide tab = How-to (13 sections) + Board + Safety buttons', (await p.ev('document.querySelectorAll("#howtoList h3").length')) === 13 && await p.ev(`!!document.getElementById('guideBoard')`));
  await p.click('#guideBoard'); await sleep(200);
  check('Board opens from the Guide tab (secondary)', await p.ev(`!document.getElementById('panel-board').hidden`));

  // area popup = "Suggested" base layer
  const pop = await p.ev(`(function(){var c; __ltot.map.eachLayer(function(l){ if(!c && l.options && l.options.className==='area-circle') c=l; });
    c.fire('click',{latlng:c.getLatLng()}); var t=document.querySelector('.leaflet-popup-content').textContent; __ltot.map.closePopup(); return t;})()`);
  check('researched area popup: “Suggested”, scores, dated sources', /Suggested/.test(pop) && /Sources/.test(pop) && /20\d\d-\d\d/.test(pop), pop.slice(0, 90) + '…');
  check('researched areas drawn dashed with a muted fill', await p.ev(`(function(){var ok=false; __ltot.map.eachLayer(function(l){ if(l.options && l.options.className==='area-circle') ok = !!l.options.dashArray && l.options.fillOpacity<=0.08; }); return ok;})()`));

  // board
  await p.click('#boardBtn'); await sleep(200);
  await p.ev(`document.getElementById('postBody').value='best street: www.spam.com'; document.getElementById('postBtn').click()`); await sleep(300);
  check('board rejects links', /Links/.test(await p.ev(`document.getElementById('postErr').textContent`)));
  await p.ev(`document.getElementById('postArea').value='old-north'; document.getElementById('postBody').value='Old North was so friendly!'; document.getElementById('postBtn').click()`); await sleep(600);
  check('valid post appears', /Old North was so friendly/.test(await p.ev(`document.getElementById('postList').textContent`)));

  // suggest an area via a real tap on the map
  await p.ev(`__ltot.openTab('map')`); await sleep(150);
  await p.click('#suggestBtn'); await sleep(400);
  check('“Suggest an area” enters tap mode', /Tap your neighbourhood/.test(await p.ev(`document.getElementById('modeText').textContent`)));
  await p.ev(`__ltot.map.setView([43.0262, -81.2765], 15, {animate:false})`); await sleep(300);
  await p.tap(195, 330);
  check('tapping the map opens the suggestion dialog', await p.ev(`document.getElementById('suggestDialog').open`));
  await p.ev(`document.getElementById('suggestReason').value='see www.x.com'; document.getElementById('suggestSend').click()`); await sleep(300);
  check('suggestion rejects links', /Links/.test(await p.ev(`document.getElementById('suggestErr').textContent`)));
  await p.ev(`document.getElementById('suggestReason').value='Lots of porch lights'; document.getElementById('suggestSend').click()`); await sleep(600);
  check('suggestion saved (needs 3 to show)', !(await p.ev(`document.getElementById('suggestDialog').open`)) && /needs 3/.test(await p.ev(`document.getElementById('toast').textContent`)) && (await p.ev('__ltot.state().suggested')) === 0);

  // language
  await p.click('#langBtn'); await sleep(400);
  const zh = await p.ev(`({ title: document.title, lang: document.documentElement.lang, tabs: [...document.querySelectorAll('.tabbar button')].map(b=>b.textContent).join('|'),
     btn: document.getElementById('markBtn').textContent, legend: document.getElementById('legend').textContent,
     leftovers: [...document.querySelectorAll('[data-i18n]')].filter(n=>n.textContent===n.dataset.i18n).map(n=>n.dataset.i18n) })`);
  check('one-tap Chinese: title, tabs, big button, legend', /万圣节/.test(zh.title) && zh.lang === 'zh-CN' && zh.tabs === '🗺️地图|🚶路线|✨标记！|📖指南' && /这里很热闹！/.test(zh.btn) && /超级火爆/.test(zh.legend), zh.tabs + ' / ' + zh.btn);
  check('no untranslated i18n keys on screen', zh.leftovers.length === 0, zh.leftovers.join(','));
  await p.click('.tabbar [data-tab="map"]'); await sleep(200);
  check('Map panel (zh): “你家附近不在地图上？标记它！”', /你家附近不在地图上？标记它！3 个人标记后就会亮起来。/.test(await p.ev(`document.getElementById('panel-map').textContent`)));
  await p.shot('v3-map-panel-zh.png');
  await p.click('#safetyBtn'); await sleep(200);
  check('safety panel: 10 tips incl. “go with a grown-up”', (await p.ev('document.querySelectorAll("#tipList li").length')) === 10 && /跟大人一起去/.test(await p.ev(`document.getElementById('tipList').textContent`)));
  await p.click('#panel-safety .privacy-link'); await sleep(200);
  check('privacy page (zh) with 10 sections', (await p.ev('document.querySelectorAll("#privacyList dt").length')) === 10 && /PIPEDA/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)));
  await p.click('#langBtn'); await sleep(300);
  check('still no JS errors after all interactions', realErrors(p).length === 0, realErrors(p).join(' | '));
  check('no Supabase library downloaded in local mode', !p.requests.some((u) => /supabase/.test(u)));

  // URL params on the same profile (guide already seen)
  const g = await openPage('?guide=1&lang=zh', { wait: 3000 });
  check('?guide=1&lang=zh forces the welcome cards in Chinese', await g.ev(`!document.getElementById('guide').hidden && /看看哪里好玩/.test(document.getElementById('guideTrack').textContent)`));
  await g.shot('v3-guide-zh.png');
  const h = await openPage('?howto=1', { wait: 3000 });
  check('?howto=1 opens the How-to (Guide) panel, no cards', await h.ev(`!document.getElementById('panel-guide').hidden && document.getElementById('guide').hidden`));
  await h.shot('v3-howto.png');
}

// =========================================================== 2. demo (?demo=1): zones, counts tick up, two tabs
{
  const a = await openPage('?demo=1', { geo: [42.9668, -81.2455], wait: 5000 });
  const b = await openPage('?demo=1', { geo: [42.999, -81.2475], wait: 5000 });
  await dismissGuide(a); await dismissGuide(b);
  check('demo tabs load without errors', realErrors(a).length + realErrors(b).length === 0, realErrors(a).concat(realErrors(b)).join(' | '));
  check('DEMO chip shown', await a.ev(`!document.getElementById('demoChip').hidden && document.getElementById('practiceChip').hidden`));
  const sa = await a.ev('__ltot.state()');
  const counts = sa.zones.map((z) => z.count);
  check('demo zones with counts appear (range of colours)', sa.zones.length >= 6 && new Set(sa.zones.map((z) => z.bucket)).size === 3 && counts.every((n) => n >= 3),
    counts.join(','));
  const hyde = sa.zones.find((z) => z.isNew && z.bucket === 'hot');
  check('a hot NEW zone outside the researched areas (Hyde Park)', !!hyde && await a.ev(`(function(){var c=__ltot.grid.center(${JSON.stringify(hyde ? hyde.cell : '')}); return __ltot.lib.distM(c,[43.010,-81.335])<600;})()`));
  await a.ev(`__ltot.map.setView([42.985, -81.29], 12, {animate:false})`); await sleep(800);
  const badges = await a.ev(`[...document.querySelectorAll('.zbadge')].map(b=>b.textContent)`);
  check('zoomed out: compact badges “🔥 n” + NEW + top-tag emoji', badges.length >= 5 && badges.every((t) => /^🔥 \d+/.test(t)) && badges.some((t) => /NEW/.test(t)) && badges.some((t) => /🍬/.test(t)), badges.slice(0, 6).join(' | '));
  await a.shot('v3-demo-zones.png');
  await a.ev(`__ltot.map.setView([42.9655, -81.2440], 14, {animate:false})`); await sleep(800);
  const full = await a.ev(`[...document.querySelectorAll('.zbadge')].map(b=>b.textContent)`);
  check('street zoom: full badge “🔥 23 marked”', full.some((t) => /^🔥 23 marked/.test(t)), full.join(' | '));
  await a.shot('v3-demo-street.png');
  await a.ev(`__ltot.map.setView([42.985, -81.29], 12, {animate:false})`); await sleep(500);
  check('zones are SVG paths with CSS pulse classes (no per-frame JS)', await a.ev(`document.querySelectorAll('path.zone-hot').length>=1 && document.querySelectorAll('path.zone-lively').length>=1 && document.querySelectorAll('path.zone-quiet').length>=1 && getComputedStyle(document.querySelector('path.zone-hot')).animationName==='zflash'`));
  check('community-suggested hexagon drawn (dashed)', await a.ev(`document.querySelectorAll('path.community-hex').length===1`) && (await a.ev('__ltot.state().suggested')) === 1);
  const zp = await a.ev('__ltot.zonePerf()');
  check('zone layer draws only viewport zones, capped', zp.drawn > 0 && zp.drawn <= 150 && zp.badges <= 40, JSON.stringify(zp));
  const sum0 = (await a.ev('__ltot.state()')).zones.reduce((n, z) => n + z.count, 0);
  await sleep(13500);
  const sum1 = (await a.ev('__ltot.state()')).zones.reduce((n, z) => n + z.count, 0);
  check('fake marks keep arriving: counts tick up', sum1 > sum0, `${sum0} → ${sum1}`);

  // a real mark in tab A shows in tab B
  const bMarks0 = await b.ev('__ltot.state().marks');
  await a.click('#markBtn'); await sleep(2000); await allowLoc(a); await sleep(1500);
  const myId = await a.ev(`(JSON.parse(localStorage.getItem('ltot.demo.mine.marks'))||[]).slice(-1).map(h=>h.id)[0]`);
  check('demo tab A: big button → mark + “Marked!” card', !!myId && await a.ev(`!document.getElementById('markCard').hidden`) && /next 45 minutes/.test(await a.ev(`document.getElementById('markCardText').textContent`)));
  await sleep(1200);
  check('the mark from tab A shows in tab B (BroadcastChannel + localStorage)', await b.ev(`__ltot.backend.local._get('marks',[]).some(m=>m.id===${JSON.stringify(myId)})`) && (await b.ev('__ltot.state().marks')) > bMarks0,
    `B marks ${bMarks0} → ${await b.ev('__ltot.state().marks')}`);
  await a.click('#markCardDone');

  // Near me (demo home)
  const n = await openPage('?demo=1&near=1', { wait: 5000 });
  await dismissGuide(n);
  check('?demo=1&near=1 opens “Near me” centred on the demo home', await n.ev(`!document.getElementById('panel-near').hidden && /pretend home/.test(document.getElementById('nearFrom').textContent)`));
  const rows = await n.ev(`[...document.querySelectorAll('#nearList .near-main b')].map(b=>b.textContent)`);
  const toM = (s) => /km/.test(s) ? parseFloat(s) * 1000 : parseFloat(s);
  check('Near me rows sorted by distance, within 2 km', rows.length >= 2 && rows.every((r, i) => i === 0 || toM(rows[i - 1]) <= toM(r)) && rows.every((r) => toM(r) <= 2000), rows.join(' / '));
  await n.shot('v3-near.png');
  await n.click('#radiusSeg [data-v="5"]'); await sleep(200);
  const r5 = Number(await n.ev(`document.getElementById('nearList').dataset.count`));
  await n.click('#radiusSeg [data-v="1"]'); await sleep(200);
  const r1 = Number(await n.ev(`document.getElementById('nearList').dataset.count`));
  check('1 km / 2 km / 5 km toggle filters the list', r1 <= rows.length && rows.length < r5, `${r1} / ${rows.length} / ${r5}`);
  await n.click('#radiusSeg [data-v="2"]'); await sleep(200);
  await n.click('#nearList .near-row .btn'); await sleep(800);
  check('Route button on a row plans a walk to that zone', await n.ev(`!document.getElementById('panel-route').hidden && document.getElementById('areaSelect').value==='target'`));
  const nz = await openPage('?demo=1&near=1&lang=zh', { wait: 5000 });
  await dismissGuide(nz);
  check('Near me in Chinese', /我附近的热闹地方/.test(await nz.ev(`document.getElementById('panel-near').textContent`)) && /人标记/.test(await nz.ev(`document.getElementById('nearList').textContent`)));
  await nz.shot('v3-near-zh.png');
  await nz.ev(`__ltot.openTab(null); __ltot.map.setView([42.975, -81.27], 12, {animate:false})`); await sleep(900);
  await nz.shot('v3-demo-zones-zh.png');
  check('demo tabs: no JS errors', [a, b, n, nz].every((x) => realErrors(x).length === 0), [a, b, n, nz].map(realErrors).flat().join(' | '));
}

// =========================================================== 3. h3-js blocked → local hex grid fallback
{
  const p = await openPage('?demo=1', { block: ['*h3-js*'], wait: 5000 });
  await dismissGuide(p);
  const perf = await p.ev('__ltot.zonePerf()');
  check('h3-js blocked → local hex grid: zones + base layer still draw', perf.grid === 'local' && perf.zones >= 6 && perf.base > 0, JSON.stringify(perf));
  check('no JS errors with h3 blocked', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 4. backend 'supabase' but not configured
{
  const cfg = `window.TOT_CONFIG={backend:'supabase',supabaseUrl:'',supabaseAnonKey:'',liveWindow:{date:'2026-10-31',start:'15:00',end:'23:00',tz:'America/Toronto'},markWindowMin:45,pollSec:45};`;
  const p = await openPage('', { config: cfg });
  check('supabase selected but empty → offline chip, local mode', await p.ev(`!document.getElementById('offlineChip').hidden && __ltot.backend.reason==='notConfigured'`));
  check('…and supabase-js is not downloaded', !p.requests.some((u) => /supabase-js/.test(u)));
}

// =========================================================== 5. supabase configured but unreachable → automatic fallback
{
  const cfg = `window.TOT_CONFIG={backend:'supabase',supabaseUrl:'https://ltot-test.invalid',supabaseAnonKey:'${'x'.repeat(40)}',liveWindow:{date:'2026-10-31',start:'15:00',end:'23:00',tz:'America/Toronto'},markWindowMin:45,pollSec:45};`;
  const p = await openPage('', { config: cfg, wait: 8000 });
  check('supabase-js lazy-loaded from CDN (SRI ok) only when configured', p.requests.some((u) => /supabase-js@2\.118\.0/.test(u)) && await p.ev(`!!(window.supabase && window.supabase.createClient)`));
  check('unreachable server → “Offline mode” chip', await p.ev(`__ltot.backend.mode==='offline' && !document.getElementById('offlineChip').hidden`));
  await p.ev(`__ltot.openTab('board'); document.getElementById('postBody').value='works offline'; document.getElementById('postBtn').click()`); await sleep(800);
  check('board still works offline (saved locally)', /works offline/.test(await p.ev(`document.getElementById('postList').textContent`)));
  check('no unexpected JS errors in offline mode', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 6. reduced motion
{
  const p = await openPage('?demo=1', { reducedMotion: true, wait: 4000 });
  await dismissGuide(p);
  check('prefers-reduced-motion: HUD off, zones and button glow do not animate', await p.ev(`getComputedStyle(document.querySelector('.hud')).display==='none' &&
    getComputedStyle(document.querySelector('.mb-glow')).animationName==='none' && [...document.querySelectorAll('path.zone')].every(z=>getComputedStyle(z).animationName==='none')`));
}

function __dist(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

console.log(`\n${pass} passed, ${fail} failed`);
writeFileSync(`${OUT}/v3-results.txt`, results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
ws.close();
chrome.kill();
await sleep(500);
process.exit(fail ? 1 : 0);
