'use strict';
// v=6: live-seconds countdown, feedback mail, route hints, loop closing, and the ▶ How to use tour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const I18N = require('../i18n.js');
const TOUR = require('../tour.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ==== countdown ====
test('countdown: zero-padded, always 4 units, en + zh units', () => {
  const ms = ((14 * 24 + 1) * 3600 + 5 * 60 + 32) * 1000;
  assert.equal(L.formatCountdown(ms, I18N.en.cdUnits), '14d 01h 05m 32s');
  assert.equal(L.formatCountdown(ms, I18N.zh.cdUnits), '14天 01时 05分 32秒');
  assert.equal(L.formatCountdown(9000, I18N.en.cdUnits), '00d 00h 00m 09s');
  assert.equal(L.formatCountdown(-5000, I18N.en.cdUnits), '00d 00h 00m 00s');
  assert.deepEqual(L.countdownUnits(3 * 3600e3 + 7e3, ['d', 'h', 'm', 's']), [['00', 'd'], ['03', 'h'], ['00', 'm'], ['07', 's']]);
});

test('target is Oct 31 2026 5:00 PM Toronto (EDT); 4:59:59 PM is still "before", 5:00:00 PM is "on"', () => {
  assert.equal(L.HALLOWEEN.start, Date.parse('2026-10-31T17:00:00-04:00'));
  assert.equal(L.countdownPhase(Date.parse('2026-10-31T16:59:59-04:00')), 'before');
  assert.equal(L.formatCountdown(L.HALLOWEEN.start - Date.parse('2026-10-31T16:59:59-04:00'), I18N.en.cdUnits), '00d 00h 00m 01s');
  assert.equal(L.countdownPhase(Date.parse('2026-10-31T17:00:00-04:00')), 'on');
  assert.equal(L.countdownPhase(Date.parse('2026-10-31T21:00:00Z')), 'on');          // same instant in UTC
});

test('"Halloween is ON" lasts until Nov 1 midnight Toronto, then "see you next year"', () => {
  assert.equal(L.HALLOWEEN.end, Date.parse('2026-11-01T00:00:00-04:00'));            // DST ends at 2 AM, so midnight is still EDT
  assert.equal(L.countdownPhase(Date.parse('2026-10-31T23:59:59-04:00')), 'on');
  assert.equal(L.countdownPhase(Date.parse('2026-11-01T00:00:00-04:00')), 'after');
  assert.equal(L.countdownPhase(Date.parse('2026-11-02T12:00:00-05:00')), 'after');
  assert.equal(L.countdownPhase(Date.parse('2026-10-17T12:00:00-04:00')), 'before');
});

test('ticker helpers: next second boundary, ?now= override', () => {
  assert.equal(L.msToNextSecond(1000), 1000);
  assert.equal(L.msToNextSecond(1250), 750);
  assert.equal(L.msToNextSecond(1999), 1);
  assert.equal(L.parseNowParam('?now=2026-10-31T17:30:00-04:00'), Date.parse('2026-10-31T21:30:00Z'));
  assert.equal(L.parseNowParam('?lang=zh&now=2026-10-31T17%3A30%3A00-04%3A00'), Date.parse('2026-10-31T21:30:00Z'));
  assert.equal(L.parseNowParam('?now=2026-11-01T01:00:00+00:00'), Date.parse('2026-11-01T01:00:00Z'));   // "+" kept
  assert.equal(L.parseNowParam('?now=2026-11-01T01:00:00 00:00'), Date.parse('2026-11-01T01:00:00Z'));   // "+" decoded as space
  assert.equal(L.parseNowParam('?now=garbage'), null);
  assert.equal(L.parseNowParam('?demo=1'), null);
});

test('i18n: countdown strings in both languages', () => {
  assert.equal(I18N.en.cdUnits.length, 4); assert.equal(I18N.zh.cdUnits.length, 4);
  assert.equal(I18N.en.cdNow, 'Halloween is ON! 🎃');
  assert.match(I18N.zh.cdNow, /^万圣节开始啦！/);
  assert.match(I18N.en.cdAfter, /next Halloween/); assert.match(I18N.zh.cdAfter, /明年/);
});

// ==== feedback ====
const FB = { confusing: 'Colours & zones?', liked: '好玩 😀', missing: '', name: 'Sam', version: 'v=6', lang: 'zh',
             screen: '390×844', ua: 'Mozilla/5.0 (iPhone)', time: '2026-10-17T21:00:00.000Z' };
test('buildFeedbackMail: address, subject, encoded body with all fields', () => {
  const m = L.buildFeedbackMail(FB);
  assert.ok(m.href.startsWith('mailto:sisy+halloween@mail.grokbot.com?subject=Halloween%20map%20feedback&body='), m.href.slice(0, 90));
  assert.equal(m.subject, 'Halloween map feedback');
  const body = decodeURIComponent(m.href.split('&body=')[1]);
  assert.equal(body, m.body);
  for (const s of ['Colours & zones?', '好玩 😀', 'Sam', 'v=6', 'lang: zh', '390×844', 'Mozilla/5.0 (iPhone)', '2026-10-17T21:00:00.000Z',
                   'What was confusing? / 哪里让你困惑？', 'What did you like? / 你喜欢什么？', "What's missing? / 还缺什么功能？"]) assert.ok(body.includes(s), s);
  assert.doesNotMatch(m.href.split('?')[1], /[ &]Colours|\n|好/);                     // spaces, "&", newlines and CJK are encoded
  assert.ok(m.text.includes('sisy+halloween@mail.grokbot.com') && m.text.includes('Subject: Halloween map feedback') && m.text.includes(m.body));
});

test('buildFeedbackMail: answers capped at 500 chars, whole link ≤ 1800 chars (CJK too)', () => {
  const long = L.buildFeedbackMail({ ...FB, confusing: 'a'.repeat(900), liked: 'b'.repeat(700), missing: 'c'.repeat(600) });
  assert.ok(long.href.length <= L.MAILTO_MAX, String(long.href.length));
  assert.ok(long.body.includes('…'));
  const zh = L.buildFeedbackMail({ ...FB, confusing: '困'.repeat(500), liked: '喜'.repeat(500), missing: '缺'.repeat(500) });
  assert.ok(zh.href.length <= L.MAILTO_MAX, String(zh.href.length));
  assert.ok(zh.href.length > 1200, 'kept as much text as fits');
  assert.ok(zh.body.includes('困') && zh.body.includes('喜') && zh.body.includes('缺'));
  const short = L.buildFeedbackMail(FB);
  assert.ok(!short.body.includes('…'), 'short answers are not cut');
  assert.ok(L.buildFeedbackMail({}).href.startsWith('mailto:sisy+halloween@mail.grokbot.com'));
});

// ==== route ====
test('staminaHint: under 5 gets one warning for anything over 45 min, 5–8 up to 60–90, older neutral', () => {
  assert.deepEqual(L.staminaHint('u5', 30), { key: 'staminaU5', warn: false });
  assert.deepEqual(L.staminaHint('u5', 45), { key: 'staminaU5', warn: false });          // 45 min is still OK
  assert.deepEqual(L.staminaHint('u5', 46), { key: 'staminaU5Warn', warn: true });
  assert.deepEqual(L.staminaHint('u5', 60), { key: 'staminaU5Warn', warn: true });       // same single warning at 60 and 90
  assert.deepEqual(L.staminaHint('u5', 90), { key: 'staminaU5Warn', warn: true });
  assert.deepEqual(L.staminaHint('5-8', 90), { key: 'stamina58', warn: false });
  assert.deepEqual(L.staminaHint('9-12', 90), { key: 'staminaOlder', warn: false });
  assert.deepEqual(L.staminaHint('teen', 30), { key: 'staminaOlder', warn: false });
  assert.equal(I18N.en.staminaU5Warn, 'Over 45 min is long for under-5s. Little ones usually tire after 30–45 min, so pick 30 min.');
  assert.equal(I18N.zh.staminaU5Warn, '超过 45 分钟对 5 岁以下太长了。小小孩一般 30–45 分钟就累了，建议选 30 分钟。');
});

test('start-time hint: little kids 5:30 PM, older 6–8:30 PM', () => {
  assert.equal(L.startTimeHintKey('u5'), 'startEarly'); assert.equal(L.startTimeHintKey('5-8'), 'startEarly');
  assert.equal(L.startTimeHintKey('9-12'), 'startLate'); assert.equal(L.startTimeHintKey('teen'), 'startLate');
  assert.match(I18N.en.startEarly, /Best start: 5:30 PM \(sunset 6:18 PM\)/); assert.match(I18N.zh.startEarly, /建议 17:30 出发（日落 18:18）/);
  assert.match(I18N.en.startLate, /Most fun 6–8:30 PM/); assert.match(I18N.zh.startLate, /18:00–20:30 最热闹/);
});

test('estimateHouses: ≈ 40 per km', () => {
  assert.equal(L.estimateHouses(1), 40);
  assert.equal(L.estimateHouses(1.5), 60);
  assert.equal(L.estimateHouses(0), 0);
  assert.equal(L.estimateHouses(2.4), 96);
  assert.equal(I18N.en.housesEst.replace('{n}', 60), '≈ 60 houses');
  assert.equal(I18N.zh.housesEst.replace('{n}', 60), '≈ 60 户');
});

test('loop: the waypoint list ends at the start (walk from home, and drive & park)', () => {
  const area = { lat: 42.9668, lng: -81.2455, r: 600 };
  const home = [42.9600, -81.2500];                                                    // ~0.8 km away: walk from home
  const w = L.loopWaypoints(home, area, 2.0, 1.5);
  assert.equal(w.drive, false);
  assert.deepEqual(w.waypoints[0], home);
  assert.deepEqual(w.waypoints[w.waypoints.length - 1], home);
  assert.equal(w.waypoints.length, 7);
  const far = L.loopWaypoints([43.05, -81.10], area, 2.0, 1.5);                         // too far: park at the area
  assert.equal(far.drive, true);
  assert.deepEqual(far.waypoints[0], far.origin);
  assert.deepEqual(far.waypoints[far.waypoints.length - 1], far.origin);
  assert.equal(I18N.en.startFinish, 'Start & finish (car / home)'); assert.equal(I18N.zh.startFinish, '起点和终点（车或家）');
});

test('PACE is unchanged (u5 1.5, 5–8 2.0, 9–12 2.5, teen 3.0 km/h)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(js, /var PACE = \{ 'u5': 1\.5, '5-8': 2\.0, '9-12': 2\.5, 'teen': 3\.0 \};/);
});

// ==== tour ====
test('tour timeline: 7 steps, every caption key exists in en + zh', () => {
  assert.equal(TOUR.TIMELINE.length, 7);
  for (const s of TOUR.TIMELINE) {
    assert.ok(typeof I18N.en[s.cap] === 'string' && I18N.en[s.cap].length > 5, 'en ' + s.cap);
    assert.ok(typeof I18N.zh[s.cap] === 'string' && I18N.zh[s.cap].length > 5, 'zh ' + s.cap);
  }
  for (const k of ['tourBtn', 'tourEnd', 'tourPause', 'tourResume', 'tourSkip', 'tourReplay', 'tourNext', 'tourBack', 'tourDone', 'tourProgress'])
    assert.ok(k in I18N.en && k in I18N.zh, k);
  const total = TOUR.TIMELINE.reduce((a, s) => a + s.ms, 0);
  assert.ok(total >= 20000 && total <= 30000, total + ' ms');
  assert.ok(fs.statSync(path.join(__dirname, '..', 'tour.js')).size < 9 * 1024, 'tour.js stays small');
});

test('tour: every target selector exists in index.html', () => {
  for (const s of TOUR.TIMELINE) {
    const id = /^#([\w-]+)$/.exec(s.target), attr = /^\[([\w-]+)="([^"]+)"\]$/.exec(s.target);
    assert.ok(id || attr, 'simple selector ' + s.target);
    if (id) assert.match(html, new RegExp(`id="${id[1]}"`), s.target);
    else assert.ok(html.includes(`${attr[1]}="${attr[2]}"`), s.target);
  }
  for (const id of ['tour', 'tourRing', 'tourCard', 'tourBar', 'tourCap', 'tourPause', 'tourSkip', 'tourReplay', 'tourNext', 'tourBack', 'guideTour'])
    assert.match(html, new RegExp(`id="${id}"`), id);
});

// A fake app: a real-looking state + storage, and a manual clock so the timeline runs instantly.
function fakeApp(opts = {}) {
  const storage = new Map([['ltot.v3.mine.marks', '[]'], ['ltot.v3.layers', '{"zones":false}']]);
  const app = { view: { center: [42.98, -81.24], zoom: 12 }, layers: { zones: false, areas: true, events: true }, tab: 'route', open: true,
                demoZones: null, calls: [], restored: 0 };
  let timers = [];
  const api = {
    snapshot: () => JSON.parse(JSON.stringify({ view: app.view, layers: app.layers, tab: app.tab, open: app.open })),
    restore: (s) => { app.restored++; app.view = s.view; app.layers = s.layers; app.tab = s.tab; app.open = s.open; app.demoZones = null; },
    run: (name) => {
      app.calls.push(name);
      if (name === 'setup') { app.layers = { ...app.layers, zones: true }; app.view = { center: [42.964, -81.242], zoom: 14 }; app.demoZones = { n: 2 }; }
      if (name === 'zones' || name === 'markStart') app.demoZones = { n: 2 };
      if (name === 'markDrop') app.demoZones.n++;
      if (name === 'guide') { app.tab = 'guide'; app.open = true; }
      if (name === 'map') app.open = false;
    },
    open() {}, close() {}, show() {}, progress() {}, finish() {}, controls() {}
  };
  const tour = TOUR.createTour(api, { reduced: !!opts.reduced, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => { timers = []; } });
  const runFor = (ms) => { for (let t = 0; t < ms; t += TOUR.TICK) { const f = timers.shift(); if (!f) return; f(); } };
  return { app, tour, storage, runFor, storageCopy: () => JSON.stringify([...storage]) };
}

test('tour: Skip mid-way restores layers, view, panel; no demo data reaches storage', () => {
  const { app, tour, storage, runFor, storageCopy } = fakeApp();
  const before = storageCopy(), snap = { view: app.view, layers: app.layers, tab: app.tab, open: app.open };
  tour.start();
  runFor(4000 + 3000 + 3500 + 3000);                                                   // into step 4: marks are dropping
  assert.equal(tour.state().idx, 3);
  assert.ok(app.demoZones.n >= 3, 'demo zone lit up');
  assert.equal(app.layers.zones, true);
  tour.skip();
  assert.equal(app.restored, 1);
  assert.deepEqual({ view: app.view, layers: app.layers, tab: app.tab, open: app.open }, snap);
  assert.equal(app.demoZones, null);
  assert.equal(storageCopy(), before);
  assert.equal(storage.size, 2);
  assert.equal(tour.state().active, false);
  tour.skip();                                                                         // a second Skip/Esc is harmless
  assert.equal(app.restored, 1);
});

test('tour: plays all 7 steps in ~26 s, step 4 goes 2 → 3 → 4 → 5, then Replay and Done', () => {
  const { app, tour, runFor } = fakeApp();
  tour.start();
  runFor(4000 + 3000 + 3500 + 6600);
  assert.equal(app.demoZones.n, 5);
  runFor(20000);
  assert.deepEqual(tour.state().done, true);
  assert.deepEqual(app.calls.filter((c) => c !== 'markDrop').slice(0, 8), ['setup', 'zones', 'map', 'map', 'markStart', 'map', 'guide', 'guide']);
  tour.replay();
  assert.equal(tour.state().idx, 0); assert.equal(tour.state().done, false);
  tour.stop();
  assert.equal(app.restored, 1); assert.equal(app.tab, 'route');
});

test('tour: pause stops the clock; ?tourStep=N jumps there paused, half-way', () => {
  const { app, tour, runFor } = fakeApp();
  tour.start(3, true);                                                                 // tourStep=4 (1-based)
  assert.equal(tour.state().idx, 3); assert.equal(tour.state().paused, true);
  assert.equal(app.demoZones.n, 4, 'beats up to the middle of step 4 already ran');
  runFor(10000);
  assert.equal(tour.state().idx, 3, 'stays while paused');
  tour.resume(); runFor(1200);                                                         // 3250 → 4450 ms: the 4400 ms beat fires
  assert.equal(app.demoZones.n, 5);
  tour.pause(); runFor(10000);
  assert.equal(tour.state().idx, 3);
});

test('tour: prefers-reduced-motion = no timer, Next/Back cards, end states shown at once', () => {
  const { app, tour, runFor } = fakeApp({ reduced: true });
  tour.start();
  runFor(60000);
  assert.equal(tour.state().idx, 0, 'never moves on its own');
  tour.next(); tour.next(); tour.next();
  assert.equal(tour.state().idx, 3); assert.equal(app.demoZones.n, 5);
  tour.back(); assert.equal(tour.state().idx, 2);
  for (let i = 0; i < 5; i++) tour.next();
  assert.equal(tour.state().done, true);
  tour.stop(); assert.equal(app.restored, 1);
});

test('URL params: ?feedback=1, ?tour=1&tourStep=N', () => {
  assert.equal(L.parseUrlFlags('?feedback=1').feedback, true);
  assert.deepEqual([L.parseUrlFlags('?tour=1&tourStep=4').tour, L.parseUrlFlags('?tour=1&tourStep=4').tourStep], [true, 4]);
  assert.equal(L.parseUrlFlags('?tour=1').tourStep, null);
  assert.equal(L.parseUrlFlags('?tour=1&tourstep=0').tourStep, null);
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?tour=1'), false), false, 'the tour replaces the welcome cards');
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?feedback=1'), false), false);
});

test('app version matches every ?v= in index.html', () => {
  const own = [...html.matchAll(/(?:src|href)="((?!https?:)[^"]+\.(?:js|css))\?([^"]+)"/g)];
  assert.ok(own.length >= 9);
  own.forEach((m) => assert.equal(m[2], L.APP_VERSION, m[1]));
  assert.match(html, /src="tour\.js\?v=15\.1"/);
  assert.doesNotMatch(html, /id="tourBtn"/, 'v15: the demo lives in the Guide tab only');
});
