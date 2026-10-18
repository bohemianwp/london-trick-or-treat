'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const L = require('../lib.js');

const CFG = { liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' } };
const Z = (s) => Date.parse(s);                       // UTC helper
function seeded(a) { return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; }

test('Toronto offsets: EDT on Oct 31, EST after DST ends Nov 1', () => {
  assert.equal(L.tzOffsetMin(Z('2026-10-31T20:00Z'), 'America/Toronto'), -240);
  assert.equal(L.tzOffsetMin(Z('2026-11-02T20:00Z'), 'America/Toronto'), -300);
  assert.equal(L.zonedToUtcMs('2026-10-31', '15:00', 'America/Toronto'), Z('2026-10-31T19:00Z'));
});

test('live window gating: Oct 31 3 PM–11 PM Toronto only', () => {
  const at = (iso) => L.isLiveOpen(Z(iso), CFG, false);
  assert.equal(at('2026-10-31T18:59:00Z'), false, '2:59 PM is closed');
  assert.equal(at('2026-10-31T19:00:00Z'), true, '3:00 PM opens');
  assert.equal(at('2026-11-01T02:59:00Z'), true, '10:59 PM still open');
  assert.equal(at('2026-11-01T03:00:00Z'), false, '11:00 PM closes');
  assert.equal(at('2026-11-01T03:01:00Z'), false, '11:01 PM is closed');
  assert.equal(at('2026-10-30T22:00:00Z'), false, 'Oct 30 is closed');
  assert.equal(at('2026-10-17T20:00:00Z'), false, 'today (planning) is closed');
  assert.equal(L.isLiveOpen(Z('2026-10-17T20:00:00Z'), CFG, true), true, '?demo=1 overrides');
});

test('session id: random, rotates every 30 minutes', () => {
  const t0 = Z('2026-10-31T21:00:00Z');
  const s1 = L.nextSession(null, t0);
  assert.match(s1.id, /^[0-9a-f]{32}$/);
  assert.equal(L.nextSession(s1, t0 + 29 * 60000), s1, 'same session before 30 min');
  const s2 = L.nextSession(s1, t0 + 30 * 60000);
  assert.notEqual(s2.id, s1.id, 'new session at 30 min');
  assert.notEqual(L.nextSession(s1, t0 - 1000).id, s1.id, 'clock going backwards also rotates');
  assert.notEqual(L.nextSession(null, t0).id, L.nextSession(null, t0).id, 'not derived from time');
});

test('coarsening: snaps to a ~50 m grid, jitter at most 25 m', () => {
  const p = [42.96681, -81.24553];
  const snapped = L.coarsen(p[0], p[1], seeded(1), 50, 0);
  assert.ok(L.distM(p, snapped) <= 36, 'snap moves at most half the grid diagonal');
  // two points in the same 50 m cell collapse to the same snapped point
  const near = L.coarsen(p[0] + 0.00005, p[1] + 0.00005, seeded(1), 50, 0);
  assert.deepEqual(near, snapped);
  const rnd = seeded(7);
  let maxJ = 0, sum = 0;
  for (let i = 0; i < 2000; i++) {
    const j = L.coarsen(p[0], p[1], rnd);
    const d = L.distM(snapped, j);
    maxJ = Math.max(maxJ, d); sum += d;
  }
  assert.ok(maxJ <= 25.3, 'jitter ≤ 25 m (+ 0.1 m rounding), got ' + maxJ.toFixed(2));
  assert.ok(sum / 2000 > 8, 'jitter actually happens');
  assert.ok(L.distM(p, L.coarsen(p[0], p[1])) < 36 + 26, 'total displacement bounded');
});

test('London bounding box rejection', () => {
  assert.equal(L.inLondonBox(42.9849, -81.2453), true);
  assert.equal(L.inLondonBox(43.6532, -79.3832), false, 'Toronto');
  assert.equal(L.inLondonBox(42.84, -81.2), false);
  assert.equal(L.inLondonBox(42.9, -81.46), false);
  assert.equal(L.inLondonBox(NaN, -81.2), false);
  assert.equal(L.inLondonBox(42.85, -81.05), true, 'edges inclusive');
});

test('planning base layer: research + board votes (0.7 / 0.3), capped, no live data in it', () => {
  const grid = L.makeGrid(null);
  const A = { id: 'a', lat: 42.9668, lng: -81.2455, r: 650, s: { candy: 5, decor: 5, safety: 5, crowd: 5 } };
  const B = { id: 'b', lat: 43.000, lng: -81.2000, r: 650, s: { candy: 5, decor: 5, safety: 5, crowd: 1 } };
  const base = L.planningHexes([A, B], {}, grid);
  const top = (list, area) => Math.max(...list.filter((h) => L.distM(grid.center(h.cell), [area.lat, area.lng]) < 400).map((h) => h.score));
  const voted = L.planningHexes([A, B], { a: 10 }, grid);
  assert.ok(top(voted, A) > top(base, A) + 0.2, 'board votes raise area A');
  assert.equal(top(voted, B), top(base, B), 'area B has no votes');
  assert.ok(Math.abs(top(base, A) - 0.7) < 0.07, 'perfect research area ≈ 0.7 near its centre');
  assert.ok(base.every((h) => h.score > 0 && h.score <= 1));
  assert.equal(L.planningHexes([A, B], {}, grid, 5).length, 5, 'cap respected');
  assert.equal(L.blendPlanScore(1, 1), 1);
  assert.equal(L.blendPlanScore(2, 2), 1, 'clamped');
  assert.equal(L.normalise(3, 6), 0.5);
});
test('crowd score inversion: JSON 5 = comfortable → app 1 (quiet)', () => {
  assert.equal(L.invertCrowd(5), 1);
  assert.equal(L.invertCrowd(1), 5);
  assert.equal(L.invertCrowd(3), 3);
  const a = L.mapArea({ id: 'x', lat: 1, lng: 2, name_en: 'X', name_zh: '叉', notes_en: '', notes_zh: '',
                         scores: { candy: 5, decorations: 4, safety: 3, crowd: 1 } });
  assert.deepEqual(a.s, { candy: 5, decor: 4, safety: 3, crowd: 5 });
});

test('text filter: links, emails, phone numbers and profanity are rejected', () => {
  const bad = { 'Call 519-661-5670': 'phone', 'text 5196615670': 'phone', 'call (519) 555 1234': 'phone',
                'see www.example.com': 'url', 'https://x.y': 'url', 'go to baker.ca now': 'url', 'me@mail.com': 'email',
                'what the fuck': 'profanity', '': 'empty', ['x'.repeat(141)]: 'tooLong' };
  for (const [txt, err] of Object.entries(bad)) assert.equal(L.checkText(txt).error, err, txt);
  for (const okTxt of ['Busy 5:30-8:30 on Oct 31, 2026', 'Over 1,200 candies!', '超好玩！装饰很棒 🎃', 'x'.repeat(140), 'Scunthorpe classic']) {
    assert.equal(L.checkText(okTxt).ok, true, okTxt);
  }
  assert.equal(L.checkText('', { optional: true }).ok, true);
  assert.equal(L.checkText('a'.repeat(139) + '🎃').ok, true, 'emoji counts as one character');
});

test('board helpers: sort, hidden at 3 reports, per-area vote totals', () => {
  const posts = [{ id: 1, votes: 2, reports: 0, createdAt: 3, areaId: 'a' }, { id: 2, votes: 9, reports: 3, createdAt: 2, areaId: 'a' },
                 { id: 3, votes: 5, reports: 2, createdAt: 1, areaId: 'b' }];
  assert.deepEqual(L.visiblePosts(posts).map((p) => p.id), [1, 3]);
  assert.deepEqual(L.sortPosts(L.visiblePosts(posts), 'top').map((p) => p.id), [3, 1]);
  assert.deepEqual(L.sortPosts(L.visiblePosts(posts), 'new').map((p) => p.id), [1, 3]);
  assert.deepEqual(L.areaVoteTotals(posts), { a: 2, b: 5 });
  assert.equal(L.rateOk([1, 2, 3, 4], 10, 100, 5), true);
  assert.equal(L.rateOk([1, 2, 3, 4, 5], 10, 100, 5), false);
  assert.equal(L.rateOk([1, 2, 3, 4, 5], 200, 100, 5), true, 'window slides');
});

test('sha256 matches Node crypto', () => {
  for (const s of ['', 'abc', 'edit-token-'.repeat(20), '中文🎃']) {
    assert.equal(L.sha256Hex(s), crypto.createHash('sha256').update(s).digest('hex'));
  }
});

test('local hex grid fallback: consistent cells, 6 corners, ~H3 r8 size', () => {
  const g = L.makeGrid(null);
  assert.equal(g.kind, 'local');
  for (const [lat, lng] of [[42.9668, -81.2455], [43.05, -81.1], [42.9, -81.4]]) {
    const c = g.cell(lat, lng);
    assert.equal(g.cell(...g.center(c)), c, 'centre maps back to its own cell');
    assert.ok(L.distM([lat, lng], g.center(c)) <= 461, 'point is inside its hex');
    const b = g.boundary(c);
    assert.equal(b.length, 6);
    b.forEach((v) => assert.ok(Math.abs(L.distM(v, g.center(c)) - 460) < 2));
  }
  const c0 = g.cell(42.98, -81.245);
  assert.equal(g.disk(c0, 0).length, 1);
  assert.equal(g.disk(c0, 1).length, 7);
  assert.equal(g.disk(c0, 2).length, 19);
  g.disk(c0, 1).filter((c) => c !== c0).forEach((n) => assert.ok(Math.abs(L.distM(g.center(n), g.center(c0)) - 797) < 3));
  const fake = { latLngToCell: () => '882b1ad4a3fffff', cellToLatLng: () => [1, 2], cellToBoundary: () => [], gridDisk: () => [] };
  assert.equal(L.makeGrid(fake).kind, 'h3', 'uses h3-js when it loaded');
});

// v=7: shared test days Oct 17–20 (whole local days, inclusive), then practice again until Oct 31 3 PM.
test('testWindow: Oct 17 00:00 – Oct 21 00:00 Toronto is shared ("test"), outside it practice, Oct 31 night live', () => {
  const C = Object.assign({}, CFG, { testWindow: { from: '2026-10-17', to: '2026-10-20', tz: 'America/Toronto' } });
  const Z = (iso) => Date.parse(iso);
  assert.equal(L.markMode(Z('2026-10-17T03:59:00Z'), C, false), 'practice');      // Oct 16 23:59 EDT
  assert.equal(L.markMode(Z('2026-10-17T04:00:00Z'), C, false), 'test');          // Oct 17 00:00 EDT
  assert.equal(L.markMode(Z('2026-10-17T22:00:00Z'), C, false), 'test');
  assert.equal(L.markMode(Z('2026-10-21T03:59:00Z'), C, false), 'test');          // Oct 20 23:59 EDT
  assert.equal(L.markMode(Z('2026-10-21T04:00:00Z'), C, false), 'practice');      // Oct 21 00:00 EDT
  assert.equal(L.markMode(Z('2026-10-31T20:00:00Z'), C, false), 'live');
  assert.equal(L.isLiveOpen(Z('2026-10-18T16:00:00Z'), C, false), true, 'test days share marks');
  assert.equal(L.isLiveOpen(Z('2026-10-25T16:00:00Z'), C, false), false);
  assert.equal(L.markMode(Z('2026-10-18T16:00:00Z'), CFG, false), 'practice', 'no testWindow in config = no test days');
  assert.equal(L.markMode(Z('2026-10-18T16:00:00Z'), C, true), 'demo');
});

test('checkText rejects house numbers + street (no targeting individual homes), allows street names', () => {
  for (const s of ['Great display at 123 Askin St', '45 Elmwood Avenue has fog', '12b Baker St.', '7 Old Wortley Rd', '湖边路 45号 很好']) {
    assert.equal(L.checkText(s).error, 'address', s);
  }
  for (const s of ['Baker St is the place!', 'Haunted garage on Askin St, not too scary for 5-year-olds.', '3 kids loved Old North', 'Go before 6 PM']) {
    assert.equal(L.checkText(s).ok, true, s);
  }
});

// v9: first-visit language chooser; English fallback, never the browser language.
test('language chooser: shows only with no saved language, no ?lang= and no ?demo=1; fallback is English', () => {
  assert.equal(L.shouldShowLangChooser({}, null), true);
  assert.equal(L.shouldShowLangChooser({}, 'garbage'), true);
  assert.equal(L.shouldShowLangChooser({}, 'en'), false);
  assert.equal(L.shouldShowLangChooser({}, 'zh'), false);
  assert.equal(L.shouldShowLangChooser({ lang: 'zh' }, null), false);
  assert.equal(L.shouldShowLangChooser({ lang: 'en' }, null), false);
  assert.equal(L.shouldShowLangChooser({ demo: true }, null), false);
  assert.equal(L.shouldShowLangChooser({ tour: true }, null), true, 'the tour waits for the chooser');
  assert.equal(L.initialLang({}, null), 'en');
  assert.equal(L.initialLang({}, 'zh'), 'zh');
  assert.equal(L.initialLang({ lang: 'en' }, 'zh'), 'en');
  assert.equal(L.initialLang({ lang: 'zh' }, null), 'zh');
  assert.equal(L.initialLang({ demo: true }, null), 'en');
  assert.equal(L.parseUrlFlags('?lang=fr').lang, null);
  assert.equal(L.parseUrlFlags('?lang=zh-CN').lang, 'zh');
});
test('privacy notice names the privacy contact in both languages', () => {
  const I = require('../i18n.js');
  for (const l of ['en', 'zh']) assert.ok(JSON.stringify(I[l].privacyItems).includes('sisy+halloween@mail.grokbot.com'), l);
});

// v10: honest value feedback after a mark, personal badges, gentle hint.
test('markProgress: exact below 3 (phone-local), "1–2 more" when the server hides it, lit / crossed thresholds', () => {
  assert.deepEqual(L.markProgress(null, 1, true), { kind: 'need', n: 2 });
  assert.deepEqual(L.markProgress(null, 2, true), { kind: 'need', n: 1 });
  assert.deepEqual(L.markProgress(null, null, false), { kind: 'needSome' }, 'server never reveals counts below 3');
  assert.deepEqual(L.markProgress(null, 3, false), { kind: 'lit', k: 3, bucket: 'quiet', crossed: 'lit' });
  assert.deepEqual(L.markProgress(4, 5, false), { kind: 'lit', k: 5, bucket: 'quiet', crossed: null });
  assert.deepEqual(L.markProgress(5, 6, false), { kind: 'lit', k: 6, bucket: 'lively', crossed: 'lively' });
  assert.deepEqual(L.markProgress(14, 15, false), { kind: 'lit', k: 15, bucket: 'hot', crossed: 'hot' });
  assert.deepEqual(L.markProgress(20, 21, false), { kind: 'lit', k: 21, bucket: 'hot', crossed: null });
});
test('badges: 1 Street Scout, 3 Neighbourhood Guide, 5 Halloween Hero; newBadge only when a level is reached', () => {
  assert.equal(L.badgeFor(0), null);
  assert.equal(L.badgeFor(1).key, 'badge1'); assert.equal(L.badgeFor(2).key, 'badge1');
  assert.equal(L.badgeFor(3).key, 'badge3'); assert.equal(L.badgeFor(9).key, 'badge5');
  assert.equal(L.newBadge(0, 1).key, 'badge1'); assert.equal(L.newBadge(1, 2), null); assert.equal(L.newBadge(2, 3).key, 'badge3');
  assert.equal(L.newBadge(4, 5).key, 'badge5'); assert.equal(L.newBadge(5, 6), null);
  const I = require('../i18n.js');
  assert.deepEqual([I.en.badge1, I.en.badge3, I.en.badge5], ['Street Scout', 'Neighbourhood Guide', 'Halloween Hero']);
  assert.deepEqual([I.zh.badge1, I.zh.badge3, I.zh.badge5], ['街区侦察员', '社区向导', '万圣节英雄']);
});
test('nudge: only on live / test days (or demo), 20 min after the last mark and the last hint', () => {
  const T = Date.parse('2026-10-31T22:00:00Z'), M = 60000;
  assert.equal(L.shouldNudge('practice', 0, 0, T), false);
  assert.equal(L.shouldNudge('live', 0, 0, T), true);
  assert.equal(L.shouldNudge('test', T - 19 * M, 0, T), false);
  assert.equal(L.shouldNudge('test', T - 20 * M, 0, T), true);
  assert.equal(L.shouldNudge('live', 0, T - 5 * M, T), false, 'no repeating hints');
});
test('v10/v15 copy: parent-focused button, thank-you card, hint and guide tip (EN + ZH)', () => {
  const I = require('../i18n.js');
  assert.equal(I.en.markBtn, 'Fun street? Share it 🔥'); assert.equal(I.zh.markBtn, '这条街好玩？分享 🔥');
  assert.equal(I.en.markSub, 'Helps other families'); assert.equal(I.zh.markSub, '帮其他家庭找到好地方');
  assert.equal(I.en.markedThanks, 'Thanks! Other families can see it now.');
  assert.equal(I.zh.markedThanks, '谢谢！其他家庭现在能看到了。');
  assert.equal(I.en.nudge, 'Waiting for the kids? Share this street.');
  assert.ok(JSON.stringify(I.en.guideCards).includes('tap the orange button when you are on a fun street'));
  assert.ok(JSON.stringify(I.zh.guideCards).includes('在好玩的街上点橙色按钮'));
  for (const l of ['en', 'zh']) assert.ok(!JSON.stringify(I[l]).includes(l === 'en' ? 'This spot is great' : '这里很热闹！'), 'old button wording gone: ' + l);
});
