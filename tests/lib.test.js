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

test('markers expire Nov 1 2026 at 6:00 AM Toronto (= 11:00 UTC, after DST ends)', () => {
  assert.equal(L.MARKER_EXPIRES_MS, Z('2026-11-01T11:00:00Z'));
  assert.equal(L.isMarkerExpired({}, Z('2026-11-01T10:59:59Z')), false);
  assert.equal(L.isMarkerExpired({}, Z('2026-11-01T11:00:00Z')), true);
});

test('dot expiry: 30-minute TTL', () => {
  const now = Z('2026-10-31T23:00:00Z');
  assert.equal(L.isDotFresh({ updatedAt: now - 29 * 60000 - 59000 }, now, 30), true);
  assert.equal(L.isDotFresh({ updatedAt: now - 30 * 60000 }, now, 30), false);
  const kept = L.pruneDots([{ updatedAt: now - 60000 }, { updatedAt: now - 31 * 60000 }], now, 30);
  assert.equal(kept.length, 1);
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

test('send cadence: at most once per 60 s and only while visible', () => {
  const now = 1e12;
  assert.equal(L.shouldSendDot(0, now, true), true);
  assert.equal(L.shouldSendDot(now - 59000, now, true), false);
  assert.equal(L.shouldSendDot(now - 60000, now, true), true);
  assert.equal(L.shouldSendDot(0, now, false), false, 'hidden page never sends');
});

test('sharing stops on its own after 90 minutes', () => {
  const t0 = 1e12;
  assert.equal(L.sharingExpired(t0, t0 + 89 * 60000), false);
  assert.equal(L.sharingExpired(t0, t0 + 90 * 60000), true);
  assert.equal(L.sharingLeftMs(t0, t0 + 30 * 60000), 60 * 60000);
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

test('hex score blend: 0.5 area + 0.3 votes + 0.2 pins', () => {
  assert.equal(L.blendHexScore(1, 0, 0), 0.5);
  assert.equal(L.blendHexScore(0, 1, 0), 0.3);
  assert.ok(Math.abs(L.blendHexScore(0, 0, 1) - 0.2) < 1e-12);
  assert.equal(L.blendHexScore(1, 1, 1), 1);
  assert.equal(L.blendHexScore(2, 2, 2), 1, 'clamped');
  assert.equal(L.normalise(3, 0), 0);
  assert.equal(L.normalise(3, 6), 0.5);
});

test('planning hexes: research, votes and pins all move the score; capped', () => {
  const grid = L.makeGrid(null);
  const A = { id: 'a', lat: 42.9668, lng: -81.2455, r: 650, s: { candy: 5, decor: 5, safety: 5, crowd: 5 } };
  const B = { id: 'b', lat: 43.000, lng: -81.2000, r: 650, s: { candy: 5, decor: 5, safety: 5, crowd: 1 } };
  const now = Z('2026-10-20T12:00Z');
  const base = L.planningHexes([A, B], [], {}, grid, now);
  const top = (list, area) => Math.max(...list.filter((h) => L.distM(grid.center(h.cell), [area.lat, area.lng]) < 400).map((h) => h.score));
  const voted = L.planningHexes([A, B], [], { a: 10 }, grid, now);
  assert.ok(top(voted, A) > top(base, A) + 0.2, 'board votes raise area A');
  assert.equal(top(voted, B), top(base, B), 'area B has no votes');
  const pins = [{ lat: B.lat, lng: B.lng, types: ['candy'], status: 'giving' }];
  const pinned = L.planningHexes([A, B], pins, {}, grid, now);
  assert.ok(Math.abs(top(pinned, B) - top(base, B) - 0.2) < 1e-9, 'a giving marker adds the 0.2 pin weight');
  const decor = [{ lat: B.lat, lng: B.lng, types: ['decor'], status: 'later' }];
  assert.ok(top(L.planningHexes([A, B], decor, {}, grid, now), B) > top(base, B), 'decoration markers count too');
  const outPins = [{ lat: B.lat, lng: B.lng, types: ['candy'], status: 'out' }];
  assert.equal(top(L.planningHexes([A, B], outPins, {}, grid, now), B), top(base, B), '"out" markers do not count');
  assert.ok(Math.abs(top(base, A) - 0.5) < 0.05, 'perfect research area ≈ 0.5 × 1 near its centre');
  assert.ok(base.every((h) => h.score > 0 && h.score <= 1));
  assert.equal(L.planningHexes([A, B], [], {}, grid, now, 5).length, 5, 'cap respected');
});

test('min-count suppression: hexes with fewer than 3 dots are dropped', () => {
  assert.deepEqual(L.suppressSmall({ a: 2, b: 3, c: 5 }, 3).map((x) => x.cell).sort(), ['b', 'c']);
  const now = 1e12, cell = () => 'X';
  const dots = [{ updatedAt: now }, { updatedAt: now - 5 * 60000 }, { updatedAt: now - 21 * 60000 }];
  assert.deepEqual(L.countDotsByCell(dots, cell, now, 20), { X: 2 }, 'only the last 20 min count');
  assert.deepEqual(L.suppressSmall(L.countDotsByCell(dots, cell, now, 20), 3), []);
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

test('markers: sanitise, filter, migrate v1 pins, share-link round trip', () => {
  assert.equal(L.sanitizeMarker({ lat: 43.65, lng: -79.38, types: ['candy'] }), null, 'outside London');
  assert.equal(L.sanitizeMarker({ lat: 42.98, lng: -81.24, types: ['bogus'] }), null, 'needs a valid type');
  assert.equal(L.sanitizeMarker({ lat: 42.98, lng: -81.24, types: ['candy'], note: 'call 519-555-1234' }), null);
  const m = L.sanitizeMarker({ lat: 42.98, lng: -81.24, types: ['teal', 'teal', 'early'], status: 'zzz', start: '17:30', end: '25:00' });
  assert.deepEqual([m.types, m.status, m.start, m.end], [['teal', 'early'], 'giving', '17:30', '']);
  const now = Z('2026-10-31T22:00Z');
  const list = [
    { id: 1, types: ['candy', 'teal'], status: 'giving' }, { id: 2, types: ['fullsize'], status: 'out' },
    { id: 3, types: ['early', 'candy'], status: 'later' }, { id: 4, types: ['candy'], status: 'giving', expiresAt: now - 1 }
  ];
  const ids = (f) => L.filterMarkers(list, f, now).map((x) => x.id);
  assert.deepEqual(ids({}), [1, 2, 3], 'expired dropped');
  assert.deepEqual(ids({ teal: true }), [1]);
  assert.deepEqual(ids({ fullsize: true }), [2]);
  assert.deepEqual(ids({ early: true }), [3]);
  assert.deepEqual(ids({ hideOut: true }), [1, 3]);
  const v1 = L.migrateV1Pins([{ id: 'a', lat: 42.97, lng: -81.24, type: 'fullsize', rating: 5, note: 'yum' },
                              { id: 'b', lat: 42.97, lng: -81.25, type: 'avoid', rating: 1, note: 'mean dog' },
                              { id: 'c', lat: 10, lng: 10, type: 'candy' }]);
  assert.equal(v1.length, 2, 'out-of-town pin dropped');
  assert.deepEqual([v1[0].types, v1[0].status, v1[0].localOnly], [['fullsize'], 'giving', true]);
  assert.deepEqual([v1[1].status, v1[1].note], ['out', '⚠️ mean dog']);
  const enc = L.encodeMarkers([m, v1[0]]);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const dec = L.decodeMarkers(enc);
  assert.deepEqual(dec.map((x) => [x.types, x.status, x.note, x.start]), [[['teal', 'early'], 'giving', '', '17:30'], [['fullsize'], 'giving', 'yum', '']]);
  assert.deepEqual(L.decodeMarkers('!!garbage'), []);
  const v1link = Buffer.from(JSON.stringify([[42.97, -81.24, 1, 4, 'big bars']])).toString('base64url');
  assert.deepEqual(L.decodeV1Pins(v1link).map((x) => x.types), [['fullsize']], 'old #pins= links still open');
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
