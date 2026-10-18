// Headless browser check for v3 "Mark it!" (SPEC §8.2–8.4 + v3 pivot) and the v=6 additions (countdown, feedback, route, tour). Needs Google Chrome and a local server:
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
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--window-size=390,844',
  '--lang=zh-CN', '--accept-lang=zh-CN,zh'], { stdio: 'ignore' });   // v9: a Chinese phone must still default to English
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

// v7: config.js now points at Peng's real Supabase project. Every page here gets a LOCAL config instead
// (no test days, so the "practice" expectations hold), unless a test passes its own config.
const LOCAL_CFG = `window.TOT_CONFIG={backend:'local',supabaseUrl:'',supabaseAnonKey:'',liveWindow:{date:'2026-10-31',start:'15:00',end:'23:00',tz:'America/Toronto'},markWindowMin:45,pollSec:45};`;
async function openPage(path, opts = {}) {
  opts = Object.assign({ config: LOCAL_CFG }, opts);
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
  // v9: ?lang= is saved now. Outside the chooser checks (opts.rawLang), each page starts in English unless its URL says ?lang=.
  if (!opts.rawLang) await s('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!/[?&]lang=/.test(location.search))localStorage.setItem('ltot.lang','en')}catch(e){}` });
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

// =========================================================== 0. v9: first-visit language chooser (fresh profile, Chinese browser)
{
  const p = await openPage('', { wait: 3500, rawLang: true });
  check('browser language is Chinese (zh-CN) in this run', /^zh/.test(await p.ev('navigator.language')), await p.ev('navigator.language'));
  check('fresh visit: English / 中文 chooser shows FIRST (welcome cards not yet)', await p.ev(`!document.getElementById('langPick').hidden && document.getElementById('guide').hidden`));
  check('…and the page underneath is ENGLISH, not the browser language', await p.ev(`document.documentElement.lang==='en' && __ltot.state().lang==='en' && document.getElementById('langBtn').textContent.trim()==='中文'`));
  check('…two big buttons English and 中文 (≥ 64 px)', await p.ev(`[...document.querySelectorAll('#langPick [data-pick]')].map(b=>b.textContent.trim()+':'+(b.getBoundingClientRect().height>=64)).join()==='English:true,中文:true'`));
  await p.shot('v9-chooser.png');
  await p.click('#langPick [data-pick="en"]'); await sleep(400);
  check('English → chooser closes, saved, English welcome cards appear', await p.ev(`document.getElementById('langPick').hidden && localStorage.getItem('ltot.lang')==='en' && !document.getElementById('guide').hidden`) &&
    /Find the fun/.test(await p.ev(`document.getElementById('guideTrack').textContent`)));
  const p2 = await openPage('', { wait: 3000, rawLang: true });
  check('second visit: no chooser again', await p2.ev(`document.getElementById('langPick').hidden`));
  await p2.ev(`localStorage.clear()`);
  const z = await openPage('?lang=zh', { wait: 3000, rawLang: true });
  check('?lang=zh skips the chooser, shows Chinese welcome cards, and saves zh', await z.ev(`document.getElementById('langPick').hidden && __ltot.state().lang==='zh' && localStorage.getItem('ltot.lang')==='zh' && !document.getElementById('guide').hidden`));
  await z.ev(`localStorage.clear()`);
  const d = await openPage('?demo=1', { wait: 3000, rawLang: true });
  check('?demo=1 skips the chooser and uses English', await d.ev(`document.getElementById('langPick').hidden && __ltot.state().lang==='en'`));
  await d.ev(`localStorage.clear(); localStorage.setItem('ltot.lang','en')`);   // the checks below expect a first visit in English
  const tq = await openPage('?tour=1', { wait: 2500, rawLang: true });
  await tq.ev(`localStorage.removeItem('ltot.lang')`);
  const tq2 = await openPage('?tour=1', { wait: 3000, rawLang: true });
  check('?tour=1 on a first visit: chooser first, tour starts only after choosing', await tq2.ev(`!document.getElementById('langPick').hidden && !__ltot.tour.state().active`) &&
    (await tq2.click('#langPick [data-pick="en"]'), await sleep(1500), await tq2.ev(`document.getElementById('langPick').hidden && __ltot.tour.state().active`)));
  await tq2.ev(`localStorage.clear(); localStorage.setItem('ltot.lang','en')`);
  check('chooser pages: no JS errors', [p, p2, z, d, tq, tq2].every((x) => realErrors(x).length === 0), [p, p2, z, d, tq, tq2].map(realErrors).flat().join(' | '));
}

// =========================================================== 1. normal page (practice mode today, local backend)
{
  const p = await openPage('', { geo: [42.966812, -81.245533] });
  check('page loads with no JS errors (390×844)', realErrors(p).length === 0, realErrors(p).join(' | '));
  check('first visit: v15 welcome = 3 short cards (Find the fun / Share in one tap / Safe & private)', await p.ev(`!document.getElementById('guide').hidden && document.querySelectorAll('#guideTrack .gcard').length===3`) &&
    /^01Find the fun/.test(await p.ev(`document.querySelector('#guideTrack .gcard').textContent`)));
  check('card 2 shows the purple, cream and orange sample buttons; card 3 has safety, the tip hint and ▶ demo', /Share in one tap/.test(await p.ev(`document.querySelectorAll('#guideTrack .gcard')[1].textContent`)) &&
    await p.ev(`document.querySelectorAll('#guideTrack .gcard')[1].querySelectorAll('.gbtn-demo').length===3 && !!document.querySelectorAll('#guideTrack .gcard')[1].querySelector('.gbtn-fav')`) &&
    /grown-up[\s\S]*Press and hold any button to see what it does[\s\S]*25-second demo/.test(await p.ev(`document.querySelectorAll('#guideTrack .gcard')[2].textContent`)));
  await p.shot('v3-guide-en.png');
  for (let i = 0; i < 2; i++) { await p.click('#guideNext'); await sleep(350); }
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
  await sleep(900);
  check('v15: one-time “Press and hold any button for a tip” hint after the welcome, remembered', await p.ev(`!document.getElementById('tipHint').hidden && /Press and hold any button for a tip/.test(document.getElementById('tipHint').textContent) && localStorage.getItem('ltot.tipHintSeen')==='true'`));
  check('v15: no ⓘ buttons left (tooltips instead)', await p.ev(`!document.querySelector('.ibtn') && !document.getElementById('markHintBtn')`));
  check('no house UI left', await p.ev(`!document.getElementById('addHouseBtn') && !document.getElementById('filterChips') && !document.querySelector('.pk')`));
  check('3 event markers on the map', (await p.ev('document.querySelectorAll(".ev-pin").length')) === 3);
  check('HUD overlay present and not clickable', await p.ev(`getComputedStyle(document.querySelector('.hud')).pointerEvents==='none' && getComputedStyle(document.querySelector('.hud')).display!=='none'`));
  check('legend: Quiet / Busy / Very busy', /Quiet[\s\S]*Busy[\s\S]*Very busy/.test(await p.ev(`document.getElementById('legend').textContent`)));
  check('mark window text follows config.js (no raw {win} placeholders)', !(await p.ev(`document.body.textContent.includes('{win}')`)) &&
    /in the last 45 min: grey = 3–5 marks/.test(await p.ev(`document.getElementById('howtoList').textContent`)));
  // v15 tooltips: a real long-press (touch) shows the tip and does NOT run the action; auto-hides; aria-describedby while shown
  const lp = async (sel) => { const r = await p.ev(`(function(){var b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [b.left+b.width/2,b.top+b.height/2];})()`);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r[0], y: r[1] }] }, p.sessionId); await sleep(700);
    const shown = await p.ev(`({tip:!document.getElementById('tip').hidden, txt:document.getElementById('tip').textContent, desc:document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-describedby'),
      tipR:document.getElementById('tip').getBoundingClientRect().toJSON(), elR:document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().toJSON()})`);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, p.sessionId); await sleep(250);
    return shown; };
  const t1 = await lp('#safetyBtn');
  const noOverlap = (a, b) => a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
  check('long-press Safety → tip “Safety tips and emergency numbers”, panel NOT opened, tip not over the button, aria-describedby',
    t1.tip && t1.txt === 'Safety tips and emergency numbers' && t1.desc === 'tip' && noOverlap(t1.tipR, t1.elR) && await p.ev(`document.getElementById('sheet').dataset.open!=='true'`), JSON.stringify(t1).slice(0, 160));
  await sleep(2500);
  check('…tip hides by itself after ~2.5 s (aria-describedby removed)', await p.ev(`document.getElementById('tip').hidden && !document.getElementById('safetyBtn').getAttribute('aria-describedby')`));
  const t2 = await lp('.tabbar [data-tab="route"]');
  check('long-press a tab → “Plan a walking loop”, tab not opened', t2.tip && t2.txt === 'Plan a walking loop' && await p.ev(`document.getElementById('panel-route').hidden`), t2.txt);
  const t3 = await lp('#markBtn');
  check('long-press the big button → tip, no mark made', t3.tip && /Share great decorations/.test(t3.txt) && (await p.ev('__ltot.state().marks')) === 0 && await p.ev(`document.getElementById('markCard').hidden`), t3.txt);
  await p.click('#safetyBtn'); await sleep(200);
  check('…a normal tap still works (Safety opens)', await p.ev(`!document.getElementById('panel-safety').hidden`));
  await p.click('#safetyBtn'); await sleep(200);
  await p.shot('v3-map-practice.png');

  // v13: before Oct 31 3 PM the big button is purple (decorations); the fun-street mark is the small orange practice pill
  check('v15 banner: one short line “🎃 Now: decorations · 🔥 Oct 31: fun streets”, one line high',
    await p.ev(`!document.getElementById('phaseBanner').hidden && document.getElementById('phaseLine').textContent==='🎃 Now: decorations · 🔥 Oct 31: fun streets' && !document.getElementById('phaseTestLine') && document.getElementById('phaseLine').getBoundingClientRect().height < 26`));
  await p.click('#phaseBanner'); await sleep(250);
  check('tapping the banner opens the explainer: ≤ 4 bullets, details closed behind “More details” (+board item when on)', await p.ev(`!document.getElementById('phaseCard').hidden && document.querySelectorAll('#phaseBullets li').length===(__ltot.state().favOn?4:3) && !document.getElementById('phaseMore').open && document.querySelectorAll('#phaseList dt').length===(__ltot.state().favOn?5:4) && /14 days/.test(document.getElementById('phaseList').textContent)`));
  check('explainer shows the gift line', await p.ev(`/helps another family have a happier, more magical Halloween/.test(document.getElementById('phaseGift').textContent) && document.getElementById('phaseGift').offsetHeight>0`));
  await p.click('#phaseOk'); await sleep(150);
  check('big button = purple decor button, small orange pill = “🧪 Practice: fun street”', await p.ev(`document.getElementById('markBtn').classList.contains('mb-decor') && /Great decorations\\?/.test(document.getElementById('markBtn').textContent) && /Practice: fun street/.test(document.getElementById('altBtn').textContent) && !document.getElementById('altBtn').hidden`));
  // the fun-street pill creates a mark (one-shot location; first time explains, then asks)
  await p.click('#altBtn'); await sleep(500);
  await allowLoc(p); await sleep(1500);
  const m1 = await p.ev('__ltot.state()');
  check('big button → a mark is stored (practice, local)', m1.marks === 1 && m1.myMarks === 1, JSON.stringify({ marks: m1.marks, mine: m1.myMarks }));
  await sleep(300);
  check('v15 “Shared! 🎉” card: short thanks + practice line + “Add a tag?” + 3 tags, no gift line, no timer bar', await p.ev(`!document.getElementById('markCard').hidden && document.querySelectorAll('#tagRow .tagbtn').length===3 && !document.getElementById('markCardGift') && document.getElementById('markCard').dataset.timer==='off' && getComputedStyle(document.querySelector('.mc-timerrow')).display==='none'`) &&
    /Other families can see it now/.test(await p.ev(`document.getElementById('markCardText').textContent`)) && /Practice: not shared/.test(await p.ev(`document.getElementById('markCardProg').textContent`)));
  check('celebration (particles + pulse) played once', (await p.ev('__ltot.state().celebrations')) === 1 && await p.ev(`document.getElementById('markBtn').classList.contains('pop')`));
  await p.shot('v3-marked.png');
  await p.click('#tagRow [data-tag="candy"]'); await sleep(400);
  const stored = await p.ev(`JSON.parse(localStorage.getItem('ltot.v3.marks'))[0]`);
  check('tag added with one tap', stored.tags.join() === 'candy' && await p.ev(`document.querySelector('#tagRow [data-tag="candy"]').getAttribute('aria-pressed')==='true'`), stored.tags.join());
  const dist = __dist([42.966812, -81.245533], [stored.lat, stored.lng]);
  check('stored mark is blurred (moved, < ~65 m), raw position not stored', dist > 0 && dist < 65 && !(await p.ev(`JSON.stringify(localStorage).includes('42.966812')`)), dist.toFixed(1) + ' m');
  check('1 mark → no zone shown (3+ rule)', (await p.ev('__ltot.state().zones.length')) === 0 && (await p.ev('document.querySelectorAll(".zbadge").length')) === 0);
  await sleep(8500);
  check('v15: the thank-you card does not close by itself (no surprise timer)', await p.ev(`!document.getElementById('markCard').hidden`));
  await p.click('#markCardDone'); await sleep(200);
  await p.click('.tabbar [data-tab="mark"]'); await sleep(500);
  check('v11: before Oct 31 3 PM the centre “Mark it!” tab opens 🎃 Best decorations (purple button + lists)',
    await p.ev(`!document.getElementById('panel-decor').hidden && document.getElementById('sheet').dataset.open==='true' && /Great decorations\\?/.test(document.getElementById('decorPanelBtn').textContent)`) &&
    await p.ev(`!document.getElementById('altBtn').hidden`));
  await p.click('.tabbar [data-tab="mark"]'); await sleep(300);
  await p.click('#altBtn'); await sleep(800);
  check('big button again → friendly “Already shared” card (5-minute limit)', /Next share in \d+ min/.test(await p.ev(`document.getElementById('markCardText').textContent`)) && (await p.ev('__ltot.state().marks')) === 1,
    await p.ev(`document.getElementById('markCardText').textContent`));

  check('v15: a tap outside closes the card', (await p.tap(200, 270), await sleep(250), await p.ev(`document.getElementById('markCard').hidden`)));
  // layers: before Oct 31 the main chips are Decorations + Past favourites; “More ▾” reveals the rest
  check('v15 layer chips fit at 390 px: main chips + More, secondary hidden', await p.ev(`(function(){var bar=document.getElementById('layerbar');return bar.scrollWidth<=bar.clientWidth && !!document.querySelector('.lchip[data-layer="decor"]:not([hidden])') && document.querySelector('.lchip[data-layer="zones"]').hidden && document.getElementById('nearChip').hidden && document.getElementById('layerMore').getAttribute('aria-expanded')==='false';})()`));
  await p.click('#layerMore'); await sleep(200);
  check('…More ▾ reveals Fun streets, Suggested areas, Events, Near me', await p.ev(`document.getElementById('layerMore').getAttribute('aria-expanded')==='true' && ['zones','areas','events'].every(function(k){return !document.querySelector('.lchip[data-layer="'+k+'"]').hidden;}) && !document.getElementById('nearChip').hidden`));
  let layerOk = true;
  for (const k of ['zones', 'areas', 'events']) {
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    const off = await p.ev(`!__ltot.state().layers['${k}'] && document.querySelector('.lchip[data-layer="${k}"]').getAttribute('aria-pressed')==='false'`);
    await p.click(`.lchip[data-layer="${k}"]`); await sleep(150);
    if (!off || !(await p.ev(`__ltot.state().layers['${k}']`))) layerOk = false;
  }
  check('layer chips Fun streets / Suggested areas / Events toggle off and on (+ Near me chip)', layerOk && await p.ev(`!!document.getElementById('nearChip')`) && realErrors(p).length === 0);
  await p.click('#layerMore'); await sleep(150);

  // tabs
  let tabsOk = true;
  for (const tab of ['map', 'route', 'guide']) {
    await p.click(`.tabbar [data-tab="${tab}"]`); await sleep(200);
    if (!(await p.ev(`!document.getElementById('panel-${tab}').hidden && document.getElementById('sheet').dataset.open==='true'`))) tabsOk = false;
  }
  check('Map / Route / Guide tabs open their panel', tabsOk);
  check('Guide tab = feature cards + 8 one-sentence answers behind “More answers” + one primary ▶ demo, no Board/Safety duplicates', (await p.ev('document.querySelectorAll("#howtoList h3").length')) === 8 &&
    await p.ev(`!document.getElementById('howtoMore').open && !document.getElementById('guideBoard') && !document.getElementById('guideSafety') && document.querySelectorAll('#panel-guide .btn-primary').length===1`));
  // v15.1 (Peng): one card per feature = where (mini phone, target ringed) + the real button + How + Why + Show me
  const hc = await p.ev(`[...document.querySelectorAll('#howtoCards .hcard')].map(function(c){return {k:c.dataset.kind, ok:!!(c.querySelector('.hc-phone .hp-target')&&c.querySelector('.hc-rep')&&/^How: /.test(c.querySelector('.hc-how').textContent)&&/^Why: /.test(c.querySelector('.hc-why').textContent)&&c.querySelector('.hc-show'))};})`);
  check('v15.1 How-to cards before Oct 31: decorations, past favourite, fun street, like/reply — each with where / button / How / Why / Show me',
    hc.map((c) => c.k).join() === ((await p.ev('__ltot.state().favOn')) ? 'decor,fav,fun,like' : 'decor,fun') && hc.every((c) => c.ok), JSON.stringify(hc));
  check('v15.1 the replica buttons wear the real colours (purple / cream / orange), no yellow', await p.ev(`(function(){var g=function(s,p){var e=document.querySelector(s);return e&&getComputedStyle(e)[p];};return g('.hc-decor .hc-rep','backgroundColor')==='rgb(124, 58, 237)' && (!document.querySelector('.hc-fav') || g('.hc-fav .hc-rep','color')==='rgb(255, 247, 232)') && g('.hc-fun .hc-rep','backgroundColor')==='rgb(255, 138, 61)';})()`));
  if (await p.ev(`!!document.querySelector('.hc-fav .hc-show')`)) {
    await p.click('.hc-fav .hc-show'); await sleep(700);
    const sm = await p.ev(`(function(){var r=document.querySelector('.showme-ring'),b=document.getElementById('favShareBtn').getBoundingClientRect();if(!r)return null;var q=r.getBoundingClientRect();return {closed:document.getElementById('sheet').dataset.open==='false', around:q.left<=b.left&&q.right>=b.right&&q.top<=b.top&&q.bottom>=b.bottom};})()`);
    check('v15.1 “Show me” closes the guide and rings the real “share a past favourite” button', !!sm && sm.closed && sm.around, JSON.stringify(sm));
    await sleep(2000);
    check('…the ring is gone after ~2 s', await p.ev(`!document.querySelector('.showme-ring')`));
  }

  // area popup = "Suggested" base layer
  const pop = await p.ev(`(function(){var c; __ltot.map.eachLayer(function(l){ if(!c && l.options && l.options.className==='area-circle') c=l; });
    c.fire('click',{latlng:c.getLatLng()}); var t=document.querySelector('.leaflet-popup-content').textContent; __ltot.map.closePopup(); return t;})()`);
  check('researched area popup: “Suggested”, scores, dated sources', /Suggested/.test(pop) && /Sources/.test(pop) && /20\d\d-\d\d/.test(pop), pop.slice(0, 90) + '…');
  check('researched areas drawn dashed with a muted fill', await p.ev(`(function(){var ok=false; __ltot.map.eachLayer(function(l){ if(l.options && l.options.className==='area-circle') ok = !!l.options.dashArray && l.options.fillOpacity<=0.08; }); return ok;})()`));

  // board
  await p.ev(`__ltot.openTab('board')`); await sleep(200);
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
  check('suggestion saved (needs 3 to show)', !(await p.ev(`document.getElementById('suggestDialog').open`)) && /after 3 suggestions/.test(await p.ev(`document.getElementById('toast').textContent`)) && (await p.ev('__ltot.state().suggested')) === 0);

  // language
  await p.click('#langBtn'); await sleep(400);
  const zh = await p.ev(`({ title: document.title, lang: document.documentElement.lang, tabs: [...document.querySelectorAll('.tabbar button')].map(b=>b.textContent).join('|'),
     btn: document.getElementById('markBtn').textContent, legend: document.getElementById('legend').textContent,
     leftovers: [...document.querySelectorAll('[data-i18n]')].filter(n=>n.textContent===n.dataset.i18n).map(n=>n.dataset.i18n) })`);
  check('one-tap Chinese: title, tabs (v14: line icons), big button, legend', /万圣节/.test(zh.title) && zh.lang === 'zh-CN' && zh.tabs === '地图|路线|标记！|指南' && (await p.ev(`document.querySelectorAll('.tabbar .ti svg.ico').length`)) === 4 && /装饰很棒？/.test(zh.btn) && /非常热闹/.test(zh.legend), zh.tabs + ' / ' + zh.btn);
  check('no untranslated i18n keys on screen', zh.leftovers.length === 0, zh.leftovers.join(','));
  await p.click('.tabbar [data-tab="map"]'); await sleep(200);
  check('Map panel (zh): “你的街没亮？分享它。”', /你的街没亮？分享它。3 个标记就会亮。/.test(await p.ev(`document.getElementById('panel-map').textContent`)));
  await p.shot('v3-map-panel-zh.png');
  await p.click('#safetyBtn'); await sleep(200);
  check('safety panel: 11 tips incl. “go with a grown-up” and Teal Pumpkin', (await p.ev('document.querySelectorAll("#tipList li").length')) === 11 && /跟大人一起去/.test(await p.ev(`document.getElementById('tipList').textContent`)) && /Teal Pumpkin/.test(await p.ev(`document.getElementById('tipList').textContent`)));
  await p.click('#panel-safety .privacy-link'); await sleep(200);
  check('privacy page (zh): 5-line summary + full notice (13 sections, +1 board) behind “完整隐私说明”, PIPEDA + contact', (await p.ev('document.querySelectorAll("#privacySummary li").length')) === 5 && !(await p.ev(`document.getElementById('privacyMore').open`)) && (await p.ev('document.querySelectorAll("#privacyList dt").length')) === ((await p.ev('__ltot.state().favOn')) ? 14 : 13) && /装饰标记/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)) && /PIPEDA/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)) && /sisy\+halloween@mail\.grokbot\.com/.test(await p.ev(`document.getElementById('panel-privacy').textContent`)));
  await p.click('#langBtn'); await sleep(300);
  check('still no JS errors after all interactions', realErrors(p).length === 0, realErrors(p).join(' | '));
  check('no Supabase library downloaded in local mode', !p.requests.some((u) => /supabase/.test(u)));

  // URL params on the same profile (guide already seen)
  const g = await openPage('?guide=1&lang=zh', { wait: 3000 });
  check('?guide=1&lang=zh forces the welcome cards in Chinese', await g.ev(`!document.getElementById('guide').hidden && /看哪里好玩/.test(document.getElementById('guideTrack').textContent)`));
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
  const badges = await a.ev(`[...document.querySelectorAll('.zbadge:not(.zb-decor)')].map(b=>b.textContent)`);
  const dBadges = await a.ev(`[...document.querySelectorAll('.zb-decor')].map(b=>b.textContent)`);
  check('v11 decor layer: purple zones (3+ only, 2-mark street hidden) with compact “🎃 n” badges + top tag', sa.decorZones.length === 4 && sa.decorZones.every((z) => z.count >= 3) &&
    (await a.ev(`document.querySelectorAll('path.zone-decor').length`)) >= 4 && dBadges.length >= 4 && dBadges.every((t) => /^🎃 \d+/.test(t)), dBadges.join(' | '));
  const overlapPx = await a.ev(`(function(){var bs=[...document.querySelectorAll('.zbadge')].map(function(b){return b.getBoundingClientRect();}),o=0;
    for(var i=0;i<bs.length;i++)for(var j=i+1;j<bs.length;j++){var w=Math.min(bs[i].right,bs[j].right)-Math.max(bs[i].left,bs[j].left),h=Math.min(bs[i].bottom,bs[j].bottom)-Math.max(bs[i].top,bs[j].top);if(w>0&&h>0)o+=w*h;}return Math.round(o);})()`);
  check('fun and decor badges are laid out around each other (little or no overlap)', overlapPx < 150, overlapPx + ' px²');
  check('zoomed out: compact badges “🔥 n” + NEW + top-tag emoji', badges.length >= 5 && badges.every((t) => /^🔥 \d+/.test(t)) && badges.some((t) => /NEW/.test(t)) && badges.some((t) => /🍬/.test(t)), badges.slice(0, 6).join(' | '));
  await a.shot('v3-demo-zones.png');
  await a.ev(`__ltot.map.setView([42.9655, -81.2440], 14, {animate:false})`); await sleep(800);
  const full = await a.ev(`[...document.querySelectorAll('.zbadge')].map(b=>b.textContent)`);
  check('street zoom: full badge “🔥 23+ marks”, decorations “🎃 n likes” (demo ticks up)', full.some((t) => /^🔥 2\d marks/.test(t)) && full.some((t) => /^🎃 \d+ likes/.test(t)), full.join(' | '));
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
  await a.click('#altBtn'); await sleep(2000); await allowLoc(a); await sleep(1500);
  const myId = await a.ev(`(JSON.parse(localStorage.getItem('ltot.demo.mine.marks'))||[]).slice(-1).map(h=>h.id)[0]`);
  check('demo tab A: big button → mark + “Marked!” card', !!myId && await a.ev(`!document.getElementById('markCard').hidden`) && /Other families can see it now/.test(await a.ev(`document.getElementById('markCardText').textContent`)));
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
  check('Near me in Chinese', /我附近好玩的街/.test(await nz.ev(`document.getElementById('panel-near').textContent`)) && /\d+ 个标记/.test(await nz.ev(`document.getElementById('nearList').textContent`)));
  await nz.shot('v3-near-zh.png');
  await nz.ev(`__ltot.openTab(null); __ltot.map.setView([42.975, -81.27], 12, {animate:false})`); await sleep(900);
  await nz.shot('v3-demo-zones-zh.png');
  check('demo tabs: no JS errors', [a, b, n, nz].every((x) => realErrors(x).length === 0), [a, b, n, nz].map(realErrors).flat().join(' | '));
}

// =========================================================== 2b. v14: "Best streets from past years" board (demo) + sounds
{
  const p = await openPage('?demo=1', { wait: 5000 });
  await dismissGuide(p);
  const st = await p.ev('__ltot.state()');
  check('v14 board on in demo: “Past favourites” is a main layer chip (v15)', st.favOn && st.favPins === 6 &&
    await p.ev(`!!document.querySelector('[data-layer="fav"]:not([hidden])') && /Past favourites/.test(document.querySelector('[data-layer="fav"]').textContent)`), JSON.stringify({ favOn: st.favOn, n: st.favPins }));
  await p.ev(`__ltot.map.setView([42.9672, -81.2449], 16, {animate:false})`); await sleep(700);
  const b16 = await p.ev(`[...document.querySelectorAll('.favb')].map(function(b){return {t:b.textContent, s:parseFloat(b.style.getPropertyValue('--s'))};})`);
  check('zoomed in: speech bubbles with tag icon, short note and 👍/❤️ counts; bigger with more likes', b16.length >= 5 && b16.some((b) => /^🏆Best street every year!…👍 14 ❤️ 9$/.test(b.t)) &&
    Math.max(...b16.map((b) => b.s)) > Math.min(...b16.map((b) => b.s)), b16.map((b) => b.t + '@' + b.s).slice(0, 3).join(' | '));
  await p.ev(`__ltot.map.setView([42.975, -81.26], 12, {animate:false})`); await sleep(700);
  const b12 = await p.ev(`[...document.querySelectorAll('.favb')].map(function(b){return b.textContent;})`);
  check('zoomed out: nearby pins cluster (“💬 n”), no long text', b12.some((t) => /^💬\d+$/.test(t)) && b12.length < 6 && !b12.some((t) => /Best street/.test(t)), b12.join(' | '));
  await p.ev(`__ltot.map.setView([42.9672, -81.2449], 16, {animate:false}); __ltot.favPopup(__ltot.favPins()[0])`); await sleep(700);
  check('bubble popup: tag, note, families (aggregate) and 👍/❤️/reply/report', await p.ev(`(function(){var t=document.querySelector('.pop-fav').textContent;return /Most festive/.test(t)&&/21 families remember this street/.test(t)&&/Replies \\(2\\)/.test(t)&&!!document.querySelector('.pop-fav .fav-rx[data-kind="heart"]')&&/Report/.test(t);})()`));
  await p.click('.fav-rx[data-kind="like"]'); await sleep(500);
  const toast1 = await p.ev(`document.getElementById('toast').textContent`);
  check('👍 counts once, shows a short gift toast', await p.ev(`document.querySelector('.fav-rx[data-kind="like"] b').textContent==='15'`) && /another family/.test(toast1), toast1);
  await p.click('.fav-rx[data-kind="like"]'); await sleep(400);
  check('second 👍 from the same phone does not count', await p.ev(`document.querySelector('.fav-rx[data-kind="like"] b').textContent==='15' && /already/.test(document.getElementById('toast').textContent)`));
  await p.ev(`(function(){var i=document.querySelector('.fav-reply-in'); i.value='Call 519 555 1234'; document.querySelector('.fav-replyrow .btn').click();})()`); await sleep(300);
  check('reply filter: phone numbers refused', /Phone numbers are not allowed/.test(await p.ev(`document.querySelector('.pop-fav .err').textContent`)));
  await p.ev(`(function(){var i=document.querySelector('.fav-reply-in'); i.value='So much fun!'; document.querySelector('.fav-replyrow .btn').click();})()`); await sleep(700);
  check('short reply posts and shows', /So much fun!/.test(await p.ev(`document.querySelector('.fav-replies').textContent`)));
  await p.ev(`__ltot.map.closePopup(); __ltot.openTab('fav')`); await sleep(400);
  check('💬 panel: Past favourites + Most loved list, no gift line in the panel (v15)', await p.ev(`!document.getElementById('panel-fav').hidden && document.querySelectorAll('#favList .fav-row').length===6 && /Past favourites/.test(document.querySelector('#panel-fav h2').textContent) && !document.querySelector('#panel-fav .mc-gift')`));
  await p.ev(`__ltot.openFavForm([42.9601, -81.2410])`); await sleep(300);
  await p.click('#favSend'); await sleep(200);
  check('post form: a preset tag is required', /Pick one/.test(await p.ev(`document.getElementById('favErr').textContent`)));
  await p.ev(`document.querySelector('#favTags [data-tag="candy"]').click(); document.getElementById('favNote').value='Lots of candy at 1234 Elm'; document.getElementById('favSend').click()`); await sleep(300);
  check('post form: house numbers refused', /No house numbers/.test(await p.ev(`document.getElementById('favErr').textContent`)));
  await p.ev(`document.getElementById('favNote').value='Full-size bars every year'; document.getElementById('favSend').click()`); await sleep(900);
  const mine = await p.ev(`(function(){var x=__ltot.favPins().filter(function(q){return q.body==='Full-size bars every year';})[0]; return x?{lat:x.lat,lng:x.lng}:null;})()`);
  check('pin posted, snapped to the ~50 m street grid, popup shows “yours” + Delete', !!mine && mine.lat === 42.96015 && mine.lng === -81.2412 &&
    await p.ev(`/yours/.test(document.querySelector('.pop-fav').textContent) && /Delete/.test(document.querySelector('.pop-fav').textContent)`), JSON.stringify(mine));
  check('sound: 🔊 (line icon) in the top bar, ON by default', await p.ev(`document.getElementById('soundBtn').dataset.on==='1' && document.getElementById('soundBtn').getAttribute('aria-pressed')==='true' && !!document.querySelector('#soundBtn svg') && __ltot.SFX.isOn()`));
  await p.click('#soundBtn'); await sleep(200);
  check('sound: tap → 🔇, remembered in localStorage, bilingual label', await p.ev(`document.getElementById('soundBtn').dataset.on==='0' && document.getElementById('soundBtn').getAttribute('aria-pressed')==='false' && localStorage.getItem('ltot.sound')==='0' && /Sound off/.test(document.getElementById('soundBtn').getAttribute('aria-label'))`));
  await p.click('#soundBtn'); await sleep(200);
  check('How-to has the past-favourite card and the sounds answer', await p.ev(`(function(){var t=document.getElementById('howtoList').textContent;return !!document.querySelector('#howtoCards .hc-fav') && /💬 Share a past favourite/.test(document.getElementById('howtoCards').textContent) && /🔊 Sounds/.test(t);})()`));
  check('privacy notice mentions the past-years board', /Past-years board/.test(await p.ev(`document.getElementById('privacyList').textContent`)));
  check('v14 board page: no JS errors', realErrors(p).length === 0, realErrors(p).join(' | '));
  const n = await openPage('?demo=1&now=2026-10-31T17:30:00-04:00&lang=zh', { wait: 5000 });
  await dismissGuide(n);
  await n.ev(`__ltot.map.setView([42.9672, -81.2449], 16, {animate:false}); __ltot.favPopup(__ltot.favPins()[0])`); await sleep(700);
  const night = await n.ev(`document.querySelector('.pop-fav').textContent`);
  check('Oct 31 (zh): memory + tonight prompt, both counts when the zone is lit', /\d+ 个家庭说这里往年难忘/.test(night) && /今晚：\d+ 个标记/.test(night) && /今晚怎么样？点一下分享！/.test(night), night.slice(0, 90));
  check('Oct 31 bubbles say “🏆 n · 🔥 n 个标记”', /🏆 \d+ · 🔥 \d+ 个标记/.test(await n.ev(`[...document.querySelectorAll('.favb')].map(function(b){return b.textContent;}).join('|')`)));
}

// =========================================================== 2b. v15.1 past-favourites entry + orange score dots
{
  const R = (id) => `(function(){var r=document.getElementById('${id}').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height};})()`;
  const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
  for (const [lang, q, re] of [['en', '?demo=1&lang=en', /Loved a street in past years\? Share it/], ['zh', '?demo=1&lang=zh', /往年哪条街最好玩？来分享/],
                               ['zh-night', '?demo=1&lang=zh&now=2026-10-31T19:30:00-04:00', /往年哪条街最好玩？来分享/]]) {
    const p = await openPage(q, { wait: 5000 });
    await dismissGuide(p);
    const vis = await p.ev(`(function(){var b=document.getElementById('favShareBtn');return !b.hidden && b.offsetParent!==null && getComputedStyle(b).display!=='none';})()`);
    const fb = await p.ev(R('favShareBtn')), mb = await p.ev(R('markBtn')), lg = await p.ev(R('legend'));
    const w = await p.ev('window.innerWidth');
    check(`v15.1 (${lang}) “share a past favourite” button visible at ${w} px, under the big button, not overlapping it or the legend`,
      vis && re.test(await p.ev(`document.getElementById('favShareBtn').textContent`)) && w === 390 && fb.l >= 0 && fb.r <= w && fb.h >= 40 && fb.t >= mb.b && apart(fb, mb) && apart(fb, lg) && apart(mb, lg),
      JSON.stringify({ vis, fb, mb, lg }));
    if (lang === 'zh-night') {
      check('v15.1 Oct 31 night: the entry sits under the orange fun-street button', !(await p.ev(`document.getElementById('markBtn').classList.contains('mb-decor')`)) && fb.t >= mb.b);
      await send('Target.closeTarget', { targetId: p.targetId }); continue;
    }
    await p.tap(fb.l + fb.w / 2, fb.t + fb.h / 2); await sleep(500);
    check(`v15.2 (${lang}) pin prompt: Cancel stays on one line at 390 px and the prompt text never runs under it`,
      await p.ev(`(function(){var b=document.getElementById('modeCancel'),r=b.getBoundingClientRect(),lh=parseFloat(getComputedStyle(b).lineHeight)||20,tx=document.getElementById('modeText').getBoundingClientRect();var rg=document.createRange();rg.selectNodeContents(b);var tops=[...rg.getClientRects()].map(function(q){return Math.round(q.top);}).filter(function(v,i,arr){return arr.indexOf(v)===i;});return getComputedStyle(b).whiteSpace==='nowrap' && tops.length===1 && b.scrollWidth<=b.clientWidth+1 && tx.right<=r.left && r.right<=window.innerWidth;})()`),
      await p.ev(`JSON.stringify(document.getElementById('modeCancel').getBoundingClientRect())`));
    check(`v15.1 (${lang}) one tap → pin mode with the “tap the street” prompt, Past favourites panel + layer on`,
      await p.ev(`!document.getElementById('modeBanner').hidden && document.getElementById('modeText').textContent===__ltot.t('favTapMap') && !document.getElementById('panel-fav').hidden && __ltot.state().layers.fav`),
      await p.ev(`document.getElementById('modeText').textContent`));
    if (lang !== 'en') { await p.click('#modeCancel'); await sleep(200); }
    if (lang === 'en') {
      await p.shot('v151-pin-mode-en.png');
      await p.ev(`__ltot.map.setView([42.9605, -81.2410], 17, {animate:false})`); await sleep(400);
      await p.tap(195, 560); await sleep(600);
      check('v15.1 second tap on the street → the favourite form opens (2 taps total)', await p.ev(`document.getElementById('favDialog').open`));
      await p.ev(`document.getElementById('favDialog').close()`);
      await p.ev(`__ltot.map.setView([42.9672, -81.2449], 16, {animate:false}); __ltot.favPopup(__ltot.favPins()[0])`); await sleep(600);
      check('v15.1 a past-favourite popup offers “💬 Share yours”', await p.ev(`(function(){var b=document.querySelector('.pop-fav .btn-fav-share');return !!b && /Share yours/.test(b.textContent);})()`));
      await p.click('.pop-fav .btn-fav-share'); await sleep(400);
      check('…and it goes straight into pin mode', await p.ev(`!document.getElementById('modeBanner').hidden && document.getElementById('modeText').textContent===__ltot.t('favTapMap')`));
      await p.click('#modeCancel'); await sleep(200);
      await p.ev(`__ltot.openPhaseCard()`); await sleep(300);
      check('v15.1 explainer bullet “💬 Mark past favourite streets” is a link to the same flow', await p.ev(`!!document.querySelector('#phaseBullets .pb-fav')`));
      await p.click('#phaseBullets .pb-fav'); await sleep(400);
      check('…tap → explainer closes, pin mode starts', await p.ev(`document.getElementById('phaseCard').hidden && !document.getElementById('modeBanner').hidden`));
      await p.click('#modeCancel'); await sleep(200);
    }
    // area scores: orange dots
    await p.ev(`(function(){var T=__ltot;T.setLayer('areas',true);var c=null;T.map.eachLayer(function(l){if(!c&&l.options&&l.options.className==='area-circle')c=l;});T.map.setView(c.getLatLng(),14,{animate:false});c.fire('click',{latlng:c.getLatLng()});})()`); await sleep(800);
    const dots = await p.ev(`(function(){var d=document.querySelector('.leaflet-popup .dots');if(!d)return null;var on=d.querySelector('.dot:not(.off)'),off=document.querySelector('.leaflet-popup .dot.off');return {n:d.querySelectorAll('.dot').length,on:on&&getComputedStyle(on).backgroundColor,off:off?getComputedStyle(off).borderTopColor:null,label:d.getAttribute('aria-label')};})()`);
    check(`v15.1 (${lang}) area score dots: 5 per row, filled = Halloween orange, empty = dim orange ring, labelled`,
      !!dots && dots.n === 5 && dots.on === 'rgb(255, 138, 61)' && (dots.off === null || dots.off === 'rgb(176, 104, 58)') && (lang === 'en' ? /of 5/ : /\/5 分/).test(dots.label || ''), JSON.stringify(dots));
    check(`v15.1 (${lang}) page: no JS errors`, realErrors(p).length === 0, realErrors(p).join(' | '));
    await send('Target.closeTarget', { targetId: p.targetId });
  }
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
  check('v14: the board stays hidden until the server has answered (no 💬 chip)', await p.ev(`!__ltot.state().favOn && !document.querySelector('[data-layer="fav"]')`));
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
  check('prefers-reduced-motion: the seconds digit does not flicker', await p.ev(`getComputedStyle(document.querySelector('#countdown .cd-s')).animationName==='none'`));
  await p.ev(`__ltot.openTab('guide')`); await sleep(300); await p.click('#guideTour'); await sleep(900);
  const r1 = await p.ev(`document.getElementById('tourRing').style.transform`);
  await sleep(4500);
  const still = await p.ev(`__ltot.tour.state().idx===0 && !document.getElementById('tourNext').hidden && document.getElementById('tourPause').hidden`);
  await p.click('#tourNext'); await sleep(300);
  check('prefers-reduced-motion: tour waits on Next/Back cards (no auto-advance)', still && (await p.ev('__ltot.tour.state().idx')) === 1 &&
    r1 !== await p.ev(`document.getElementById('tourRing').style.transform`));
  await p.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(200);
  check('…Esc ends it', await p.ev(`document.getElementById('tour').hidden && !__ltot.tour.state().active`));
}

// =========================================================== 7. v=6: live-seconds countdown
{
  const p = await openPage('', { wait: 3500 });
  await dismissGuide(p);
  const c1 = await p.ev(`document.getElementById('countdown').textContent`);
  const w1 = await p.ev(`document.querySelector('#countdown .cd-digits').getBoundingClientRect().width`);
  await sleep(1300);
  const c2 = await p.ev(`document.getElementById('countdown').textContent`);
  const w2 = await p.ev(`document.querySelector('#countdown .cd-digits').getBoundingClientRect().width`);
  check('countdown ticks every second: “Halloween in 14d 01h 05m 32s” format', /Halloween in \d\dd \d\dh \d\dm \d\ds$/.test(c1) && c1 !== c2, c1 + ' → ' + c2);
  check('…digits have a fixed width (no shifting between ticks)', Math.abs(w1 - w2) < 0.01, w1 + ' / ' + w2);
  check('…seconds digit has the CSS flicker, tabular-nums (v14: one font stack, no monospace)', await p.ev(`(function(){var s=getComputedStyle(document.querySelector('#countdown .cd-s')), d=getComputedStyle(document.querySelector('#countdown .cd-digits'));
    return /cd-tick-[ab]/.test(s.animationName) && d.fontVariantNumeric==='tabular-nums' && !/mono/i.test(d.fontFamily);})()`));
  check('v15 top bar fits at 390 px: brand, “🧪 Practice” (words visible), Safety, 🔊, 中文 only', await p.ev(`[...document.querySelectorAll('.topbar > *')].filter(e=>!e.hidden).every(e=>e.getBoundingClientRect().right<=390)`) &&
    await p.ev(`document.getElementById('practiceChip').textContent==='🧪 Practice' && !document.getElementById('tourBtn') && !document.getElementById('helpBtn') && !document.getElementById('boardBtn')`));
  check('countdown is role="timer" (not announced every second)', await p.ev(`document.getElementById('countdown').getAttribute('role')==='timer'`));
  await p.shot('v6-countdown.png');

  const z = await openPage('?lang=zh&howto=1', { wait: 3000 });
  check('Chinese units: “离万圣节还有 13天 23时 04分 07秒”', /离万圣节还有 \d\d天 \d\d时 \d\d分 \d\d秒$/.test(await z.ev(`document.getElementById('countdown').textContent`)),
    await z.ev(`document.getElementById('countdown').textContent`));

  const on = await openPage('?now=2026-10-31T17:30:00-04:00', { wait: 3000 });
  await dismissGuide(on);
  check('?now=Oct 31 5:30 PM → “Halloween is ON! 🎃” with a pulsing glow', (await on.ev(`document.getElementById('countdown').textContent`)) === 'Halloween is ON! 🎃' &&
    await on.ev(`getComputedStyle(document.querySelector('#countdown .cd-msg')).animationName==='cd-pulse'`));
  check('v15 ?now=Oct 31 5:30 PM: banner “🔥 Share fun streets until 11 PM” (no 2nd “Halloween is ON”), big orange button, decor = small pill, main chip = Fun streets',
    await on.ev(`document.getElementById('phaseLine').textContent==='🔥 Share fun streets until 11 PM' && !document.getElementById('markBtn').classList.contains('mb-decor') && /Fun street\\? Share it/.test(document.getElementById('markBtn').textContent) && /Great decorations\\?/.test(document.getElementById('altBtn').textContent) && !document.querySelector('.lchip[data-layer="zones"]').hidden && document.querySelector('.lchip[data-layer="decor"]').hidden && !document.querySelector('.tab-mark').classList.contains('tab-decor')`));
  await on.shot('v6-halloween-on.png');
  const edge = await openPage('?now=2026-10-31T16:59:58-04:00&lang=zh', { wait: 600 });
  const e1 = await edge.ev(`document.getElementById('countdown').dataset.phase`);
  await sleep(2600);
  check('4:59:58 PM → switches to “万圣节开始啦！” by itself at 5:00:00 PM', e1 === 'before' && /^万圣节开始啦！/.test(await edge.ev(`document.getElementById('countdown').textContent`)), e1);
  const after = await openPage('?now=2026-11-01T00:00:05-04:00', { wait: 2500 });
  check('after Nov 1 midnight → “see you next Halloween”', /See you next Halloween/.test(await after.ev(`document.getElementById('countdown').textContent`)));
  check('countdown pages: no JS errors', [p, z, on, edge, after].every((x) => realErrors(x).length === 0), [p, z, on, edge, after].map(realErrors).flat().join(' | '));
}

// =========================================================== 8. v=6: feedback panel (mailto + copy)
{
  await send('Browser.grantPermissions', { origin: new URL(BASE).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const p = await openPage('?feedback=1', { wait: 3000 });
  check('?feedback=1 opens the Feedback panel (no welcome cards)', await p.ev(`!document.getElementById('panel-feedback').hidden && document.getElementById('guide').hidden`));
  check('3 questions (≤ 500 chars), optional name, “no kids’ names” note', await p.ev(`[...document.querySelectorAll('#panel-feedback textarea.fb-in')].map(t=>t.maxLength).join()==='500,500,500' && !!document.getElementById('fbNameIn')`) &&
    /Please don’t include your kids’ names/.test(await p.ev(`document.getElementById('panel-feedback').textContent`)));
  await p.ev(`(function(){var a=document.getElementById('fbConfusingIn'); a.value='The colours & NEW badge?'; a.dispatchEvent(new Event('input'));
    var n=document.getElementById('fbNameIn'); n.value='Sam'; n.dispatchEvent(new Event('input'));})()`);
  const href = await p.ev(`document.getElementById('fbSend').getAttribute('href')`);
  check('Send link: mailto:sisy+halloween@mail.grokbot.com, subject, encoded answers, ≤ 1800 chars', href.startsWith('mailto:sisy+halloween@mail.grokbot.com') &&
    href.includes('subject=Halloween%20map%20feedback') && href.includes('The%20colours%20%26%20NEW%20badge%3F') && href.includes('v%3D15') && href.length <= 1800, href.slice(0, 80) + '… ' + href.length);
  await p.click('#fbCopy'); await sleep(500);
  check('Copy text → “Copied! Paste it into an email or WeChat”', /^✅ Copied! Paste it into an email or WeChat/.test(await p.ev(`document.getElementById('fbCopied').textContent`)));
  await p.shot('v6-feedback.png');
  await p.ev(`__ltot.openTab('guide')`);
  check('Feedback is easy to find: 💬 button in the Guide tab', await p.ev(`!document.getElementById('feedbackBtn').hidden && document.getElementById('feedbackBtn').getBoundingClientRect().top < innerHeight`));
  check('feedback page: no JS errors', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 9. v=6: route hints, houses, closed loop (routers blocked → straight-line fallback)
{
  const p = await openPage('?howto=1', { wait: 3000, block: ['*routing.openstreetmap.de*', '*router.project-osrm.org*'] });
  await p.ev(`__ltot.openTab('route'); document.querySelector('#ageSeg [data-v="u5"]').click(); document.querySelector('#timeSeg [data-v="90"]').click()`);
  check('under 5 + 90 min → “Little ones usually tire after 30–45 min” + “Best start: 5:30 PM”', /Little ones usually tire after 30–45 min/.test(await p.ev(`document.getElementById('staminaHint').textContent`)) &&
    await p.ev(`document.getElementById('staminaHint').className==='warn'`) && /Best start: 5:30 PM \(sunset 6:18 PM\)/.test(await p.ev(`document.getElementById('startHint').textContent`)));
  await p.ev(`document.querySelector('#ageSeg [data-v="teen"]').click()`);
  check('13+ → neutral hint + “Most fun 6–8:30 PM”', await p.ev(`document.getElementById('staminaHint').className==='hint'`) && /Most fun 6–8:30 PM/.test(await p.ev(`document.getElementById('startHint').textContent`)));
  await p.ev(`__ltot.setStart([42.9640,-81.2500],'map'); __ltot.buildLoop()`); await sleep(1500);
  const res = await p.ev(`(function(){var l=null; __ltot.map.eachLayer(function(x){ if(x.options && x.options.className==='route-line') l=x.getLatLngs(); });
    return { houses: document.getElementById('housesEst').textContent, note: document.querySelector('.loop-note').textContent,
             first: l && [l[0].lat,l[0].lng], last: l && [l[l.length-1].lat,l[l.length-1].lng], turns: [...document.querySelectorAll('.turns li')].map(x=>x.textContent) }; })()`);
  check('route shows “≈ N houses” and “Start & finish (car / home)”', /^≈ \d+ houses$/.test(res.houses) && /Start & finish \(car \/ home\)/.test(res.note), res.houses + ' / ' + res.note);
  check('the loop ends where it starts (line + last turn back to the start)', !!res.first && __dist(res.first, res.last) < 1 && /back to the start \(car \/ home\)/.test(res.turns[res.turns.length - 1]),
    res.turns[res.turns.length - 1]);
  check('route page: no JS errors', realErrors(p).length === 0, realErrors(p).join(' | '));
}

// =========================================================== 10. v=6: ▶ How to use tour
{
  const p = await openPage('', { wait: 4000 });
  await dismissGuide(p);
  await p.ev(`__ltot.map.setView([42.99,-81.20], 13, {animate:false}); __ltot.setLayer('events', false); __ltot.openTab('route')`); await sleep(300);
  const before = await p.ev(`JSON.stringify({ls: Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]), layers: __ltot.state().layers,
    c: __ltot.map.getCenter(), z: __ltot.map.getZoom(), tab: __ltot.state().tab, open: document.getElementById('sheet').dataset.open})`);
  const zonesBefore = await p.ev(`document.querySelectorAll('path.zone').length`);
  check('v15: ▶ 25-second demo is the one primary button in the Guide tab (not in the top bar)', await p.ev(`!document.getElementById('tourBtn') && document.getElementById('guideTour').classList.contains('btn-primary')`));
  await p.ev(`document.getElementById('guideTour').click()`); await sleep(1000);
  const r1 = await p.ev(`document.getElementById('tourRing').style.transform`);
  check('tour starts: overlay, ring around the legend, caption, DEMO DATA tag', await p.ev(`!document.getElementById('tour').hidden && __ltot.tour.state().idx===0`) &&
    /Orange streets show where kids/.test(await p.ev(`document.getElementById('tourCap').textContent`)) && (await p.ev(`document.querySelectorAll('#tourBar i').length`)) === 7);
  await p.shot('v6-tour-1.png');
  await sleep(10500);                                           // into step 4
  const mid = await p.ev(`JSON.stringify({ idx: __ltot.tour.state().idx, ring: document.getElementById('tourRing').style.transform, z: (__ltot.tourZones()||[]).map(z=>z.count+(z.isNew?'N':'')) })`);
  const m = JSON.parse(mid);
  check('spotlight moved between steps (auto-play, no input)', m.idx === 3 && m.ring !== r1, r1 + ' → ' + m.ring);
  await sleep(4200);
  const late = await p.ev(`(__ltot.tourZones()||[]).map(z=>z.count+(z.isNew?'N':''))`);
  check('step 4: demo zone lights up with NEW and its count climbs to 5', late.includes('5N') && await p.ev(`document.querySelectorAll('.tour-drop').length`) === 3, mid + ' → ' + late.join(','));
  await p.shot('v6-tour-4.png');
  await p.click('#tourPause'); const i1 = await p.ev('__ltot.tour.state().idx'); await sleep(4000);
  check('Pause holds the step; Resume continues', i1 === (await p.ev('__ltot.tour.state().idx')) && /Resume/.test(await p.ev(`document.getElementById('tourPause').textContent`)));
  await p.click('#tourPause'); await sleep(200);
  await p.click('#tourSkip'); await sleep(400);
  const after = await p.ev(`JSON.stringify({ls: Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]), layers: __ltot.state().layers,
    c: __ltot.map.getCenter(), z: __ltot.map.getZoom(), tab: __ltot.state().tab, open: document.getElementById('sheet').dataset.open})`);
  check('Skip restores everything: localStorage, layers, view, zoom, open panel', after === before, after === before ? '' : before + ' ≠ ' + after);
  check('…no demo zones or marks left on the map', !(await p.ev(`__ltot.tourZones()`)) && (await p.ev(`document.querySelectorAll('.tour-drop').length`)) === 0 &&
    (await p.ev(`document.querySelectorAll('path.zone').length`)) === zonesBefore && await p.ev(`document.getElementById('tour').hidden`));
  check('tour: no JS errors', realErrors(p).length === 0, realErrors(p).join(' | '));

  const q = await openPage('?tour=1&tourStep=4&lang=zh', { wait: 4500 });
  check('?tour=1&tourStep=4 jumps to step 4 and pauses there (zh caption)', await q.ev(`__ltot.tour.state().idx===3 && __ltot.tour.state().paused`) &&
    /满 3 个/.test(await q.ev(`document.getElementById('tourCap').textContent`)), await q.ev(`document.getElementById('tourCap').textContent`));
  await q.shot('v6-tour-4-zh.png');
  const w = await openPage('?guide=1', { wait: 3500 });
  check('welcome cards have “▶ 25-second demo”', /▶ 25-second demo/.test(await w.ev(`document.getElementById('guideTrack').textContent`)));
  await w.click('#guideTourBtn'); await sleep(800);
  check('…and it starts the tour', await w.ev(`document.getElementById('guide').hidden && __ltot.tour.state().active`));
  check('tour pages: no JS errors', [q, w].every((x) => realErrors(x).length === 0), [q, w].map(realErrors).flat().join(' | '));
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
