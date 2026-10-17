'use strict';
// v3 "Mark it!": zone colours, the 3+ rule, the mark window, rate limits, blurring before storage, tags whitelist,
// citywide marks outside the researched areas (NEW badge), suggestions (promote at 3), Near me, outside-London rejection.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const B = require('../backend.js');

const root = path.join(__dirname, '..');
const RAW = JSON.parse(fs.readFileSync(path.join(root, 'data/areas_researched.json'), 'utf8'));
const AREAS = RAW.areas.map(L.mapArea);
const CFG = { backend: 'local', liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' }, markWindowMin: 45 };
const NIGHT = Date.parse('2026-10-31T23:00:00Z');       // 7 PM Toronto
const BEFORE = Date.parse('2026-10-20T16:00:00Z');
const MIN = 60000;
const grid = L.makeGrid(null);                           // local hex grid (h3-js is a browser CDN script)
function seeded(a) { return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; }
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
function bus() {
  const chans = [];
  return () => {
    const c = { onmessage: null, postMessage(d) { chans.filter((x) => x !== c).forEach((x) => x.onmessage && x.onmessage({ data: d })); } };
    chans.push(c);
    return c;
  };
}
// Two "tabs" over the same storage + a fake BroadcastChannel, through the real createBackend wrapper (so blurring applies).
function tabs(now) {
  const storage = memStore(), mk = bus(), clock = { t: now };
  const mkApi = () => B.createBackend(CFG, { storage, channel: mk(), now: () => clock.t });
  return { a: mkApi(), b: mkApi(), clock, storage };
}
let sid = 0;
const session = () => (++sid).toString(16).padStart(32, 'a');
const TOKEN = 't'.repeat(40);

test('zone colour thresholds: <3 none, 3–5 teal (quiet), 6–14 orange (lively), 15+ hot pink', () => {
  assert.equal(L.zoneBucket(0), null);
  assert.equal(L.zoneBucket(2), null);
  assert.equal(L.zoneBucket(3), 'quiet');
  assert.equal(L.zoneBucket(5), 'quiet');
  assert.equal(L.zoneBucket(6), 'lively');
  assert.equal(L.zoneBucket(14), 'lively');
  assert.equal(L.zoneBucket(15), 'hot');
  assert.equal(L.zoneBucket(230), 'hot');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.zone-quiet \{[^}]*var\(--teal\)/);
  assert.match(css, /\.zone-lively \{[^}]*var\(--orange\)/);
  assert.match(css, /\.zone-hot \{[^}]*var\(--pink\)[^}]*animation: zflash \.85s/, 'super-hot zones pulse faster');
  assert.match(css, /\.zone \{[^}]*animation: zpulse 2\.8s/);
});

test('3+ suppression: cells with 1–2 marks never leave aggregateZones; decorateZones re-checks server rows', () => {
  const now = NIGHT, c = 'L1_1';
  const marks = (n) => Array.from({ length: n }, (_, i) => ({ cell: c, createdAt: now - i * MIN, tags: [] }));
  assert.deepEqual(L.aggregateZones(marks(2), null, now, 45), []);
  const z = L.aggregateZones(marks(3), null, now, 45);
  assert.equal(z.length, 1);
  assert.equal(z[0].count, 3);
  assert.equal(z[0].bucket, 'quiet');
  assert.deepEqual(L.decorateZones([{ cell: 'a', count: 2 }, { cell: 'b', count: 3 }, { cell: 'c', count: 17, topTag: 'candy', topTagN: 9 }], now).map((x) => [x.cell, x.bucket, x.topTag]),
                   [['c', 'hot', 'candy'], ['b', 'quiet', null]]);
});

test('mark window: only the last 45 min count; window clamps to 30–60; future marks ignored', () => {
  const now = NIGHT, c = 'L2_2';
  const at = (m) => ({ cell: c, createdAt: now - m * MIN, tags: [] });
  const marks = [at(1), at(10), at(44), at(46), at(55), at(70)];
  assert.equal(L.marksInWindow(marks, now, 45).length, 3);
  assert.equal(L.aggregateZones(marks, null, now, 45)[0].count, 3);
  assert.equal(L.aggregateZones(marks, null, now, 60)[0].count, 5);
  assert.equal(L.aggregateZones(marks, null, now, 30).length, 0, 'only 2 marks in 30 min → hidden');
  assert.equal(L.clampWindow(5), 30);
  assert.equal(L.clampWindow(500), 60);
  assert.equal(L.clampWindow(undefined), 45);
  assert.equal(L.marksInWindow([{ createdAt: now + MIN }], now, 45).length, 0);
  const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  assert.match(cfg, /markWindowMin: 45/);
});

test('rate limits: 1 mark per device per 5 min, 1 per zone per 30 min (lib + local adapter)', async () => {
  const t0 = NIGHT;
  assert.deepEqual(L.markRate([], 'A', t0), { ok: true });
  const h = [{ t: t0, cell: 'A' }];
  assert.equal(L.markRate(h, 'B', t0 + 4 * MIN).reason, 'device');
  assert.equal(L.markRate(h, 'B', t0 + 4 * MIN).waitMs, MIN);
  assert.equal(L.markRate(h, 'B', t0 + 5 * MIN).ok, true, 'another zone after 5 min');
  assert.equal(L.markRate(h, 'A', t0 + 6 * MIN).reason, 'zone');
  assert.equal(L.markRate(h, 'A', t0 + 30 * MIN).ok, true);

  const { a, clock } = tabs(NIGHT);
  const s = session(), here = [42.9668, -81.2455], there = [43.010, -81.335];
  await a.sendMark({ session: s, lat: here[0], lng: here[1] }, TOKEN, grid.cell, seeded(1));
  await assert.rejects(a.sendMark({ session: s, lat: there[0], lng: there[1] }, TOKEN, grid.cell, seeded(2)), { code: 'rate' }, '5-min device limit');
  clock.t += 6 * MIN;
  await a.sendMark({ session: s, lat: there[0], lng: there[1] }, TOKEN, grid.cell, seeded(3));
  clock.t += 6 * MIN;
  await assert.rejects(a.sendMark({ session: s, lat: here[0], lng: here[1] }, TOKEN, grid.cell, seeded(4)), { code: 'rate' }, '30-min zone limit');
  clock.t += 20 * MIN;
  await a.sendMark({ session: s, lat: here[0], lng: here[1] }, TOKEN, grid.cell, seeded(5));
  assert.equal(a.local.markCount(), 3);
});

test('blurring happens before storage: stored point is moved, on-grid ± jitter, raw coords never stored', async () => {
  const { a, storage } = tabs(NIGHT);
  const raw = [42.966812, -81.245533];
  await a.sendMark({ session: session(), lat: raw[0], lng: raw[1], tags: ['candy'] }, TOKEN, grid.cell, seeded(9));
  const dump = [...storage._m.values()].join('\n');
  assert.ok(!dump.includes('42.966812') && !dump.includes('81.245533'), 'raw position is not in storage');
  const m = JSON.parse(storage.getItem('ltot.v3.marks'))[0];
  const d = L.distM(raw, [m.lat, m.lng]);
  assert.ok(d > 0.5 && d < 36 + 26, 'moved by the 50 m grid + ≤25 m jitter, got ' + d.toFixed(1) + ' m');
  assert.equal(m.cell, grid.cell(m.lat, m.lng), 'the zone is computed from the blurred point');
  assert.equal(m.sidHash.length, 64, 'only a hash of the session id is kept');
  assert.ok(!dump.includes(TOKEN), 'token is stored hashed');
  // The app sends the raw fix to backend.sendMark, which blurs; it never stores raw marks itself.
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /backend\.sendMark\(\{ session: s\.id, lat: pos\[0\], lng: pos\[1\]/);
  assert.match(fs.readFileSync(path.join(root, 'backend.js'), 'utf8'), /var b = LIB\.blurPoint\(\+m\.lat, \+m\.lng, rnd\);/);
});

test('tags whitelist: candy / decor / crowded only, deduped; tagMark needs the token', async () => {
  assert.deepEqual(L.MARK_TAGS, ['candy', 'decor', 'crowded']);
  assert.deepEqual(L.cleanTags(['candy', 'candy', 'pizza', 'crowded']), ['candy', 'crowded']);
  assert.equal(L.tagsValid(['decor']), true);
  assert.equal(L.tagsValid(['decor', 'pizza']), false);
  const { a, b } = tabs(NIGHT);
  await assert.rejects(a.sendMark({ session: session(), lat: 42.97, lng: -81.24, tags: ['pizza'] }, TOKEN, grid.cell), { code: 'invalid' });
  const { id } = await a.sendMark({ session: session(), lat: 42.97, lng: -81.24, tags: [] }, TOKEN, grid.cell);
  await assert.rejects(b.tagMark(id, 'wrong'.repeat(8), 'candy'), { code: 'forbidden' });
  await assert.rejects(b.tagMark(id, TOKEN, 'pizza'), { code: 'invalid' });
  assert.deepEqual(await b.tagMark(id, TOKEN, 'candy'), ['candy']);
  assert.deepEqual(await b.tagMark(id, TOKEN, 'candy'), ['candy'], 'no duplicates');
});

test('top tag shown only when common (≥2 marks and ≥30%)', () => {
  assert.equal(L.topTag({ candy: 1 }, 3), null);
  assert.equal(L.topTag({ candy: 2, decor: 1 }, 5), 'candy');
  assert.equal(L.topTag({ candy: 2 }, 10), null, '20% is not common');
  assert.equal(L.topTag({ decor: 4, crowded: 5 }, 9), 'crowded');
});

test('marks anywhere in London: Hyde Park, Lambeth, Argyle (no researched area) light up at 3 with a NEW badge', async () => {
  const spots = { 'Hyde Park': [43.010, -81.335], Lambeth: [42.905, -81.300], Argyle: [43.020, -81.170] };
  for (const [name, p] of Object.entries(spots)) {
    const nearest = Math.min(...AREAS.map((a) => L.distM(p, [a.lat, a.lng]) - a.r));
    assert.ok(nearest > 1000, name + ' is more than 1 km outside every researched area (' + Math.round(nearest) + ' m)');
  }
  const { a, b, clock } = tabs(NIGHT);
  const seen = [];
  b.onChange((kind, remote) => seen.push([kind, remote]));
  for (const [name, spot] of Object.entries(spots)) {
    // three families at the same street corner (the hex centre, so the ≤62 m blur keeps them in one hexagon)
    const cell = grid.cell(spot[0], spot[1]), p = grid.center(cell);
    for (let i = 0; i < 2; i++) await a.sendMark({ session: session(), lat: p[0], lng: p[1] }, TOKEN, grid.cell, seeded(i + 3));
    assert.equal((await b.listZones(45, grid.cell)).filter((z) => z.cell === cell).length, 0, name + ': 2 marks → nothing shown');
    await a.sendMark({ session: session(), lat: p[0], lng: p[1] }, TOKEN, grid.cell, seeded(11));
    const lit = (await b.listZones(45, grid.cell)).find((z) => z.cell === cell);
    assert.ok(lit && lit.count === 3, name + ': shows at 3 marks, seen in the other tab');
    assert.equal(lit.isNew, true, name + ': NEW badge');
    assert.equal(lit.bucket, 'quiet');
    clock.t += 6 * MIN;
  }
  assert.ok(seen.some(([k, r]) => k === 'marks' && r === true), 'tab B was told about the new marks (BroadcastChannel)');
  clock.t += 31 * MIN;
  const later = await b.listZones(60, grid.cell);
  assert.ok(later.length >= 3 && later.every((x) => x.isNew === false), 'NEW only for 30 minutes after lighting up');
});

test('a hot user zone with no researched area nearby stays hot (planning never dims it)', () => {
  const p = [43.010, -81.335], cell = grid.cell(p[0], p[1]);
  const marks = Array.from({ length: 18 }, (_, i) => ({ cell, createdAt: NIGHT - i * MIN, tags: i % 2 ? ['candy'] : [] }));
  const z = L.aggregateZones(marks, null, NIGHT, 45);
  assert.equal(z[0].bucket, 'hot');
  assert.equal(z[0].topTag, 'candy');
  const plan = L.planningHexes(AREAS, {}, grid);
  assert.ok(!plan.some((h) => h.cell === cell), 'no planning score under Hyde Park, and the live zone is unaffected');
  const hex = fs.readFileSync(path.join(root, 'hex.js'), 'utf8');
  assert.match(hex, /ensurePane\(map, 'basePane', 340\)/);
  assert.match(hex, /ensurePane\(map, 'zonePane', 430\)/, 'live zones are drawn above the base layer');
});

test('marks outside London are rejected (before and after blurring)', async () => {
  const { a } = tabs(NIGHT);
  await assert.rejects(a.sendMark({ session: session(), lat: 43.6532, lng: -79.3832 }, TOKEN, grid.cell), { code: 'outside' }, 'Toronto');
  await assert.rejects(a.sendMark({ session: session(), lat: 42.84, lng: -81.2 }, TOKEN, grid.cell), { code: 'outside' });
  await assert.rejects(a.sendMark({ session: session(), lat: 42.85, lng: -81.05 }, TOKEN, grid.cell, () => 0.999), { code: 'outside' },
    'a corner point that blurs out of the box is rejected too');
  await assert.rejects(a.local.sendMark({ session: session(), lat: 0, lng: 0, cell: 'L0_0' }, TOKEN), { code: 'outside' });
  assert.equal(a.local.markCount(), 0);
});

test('marks are deleted after 2 hours; practice mode before Oct 31 keeps marks local', async () => {
  const { a, clock } = tabs(NIGHT);
  for (let i = 0; i < 3; i++) await a.sendMark({ session: session(), lat: 42.97, lng: -81.24 }, TOKEN, grid.cell, seeded(i + 1));
  assert.equal(a.local.markCount(), 3);
  clock.t += 121 * MIN;
  assert.equal(a.local.markCount(), 0);
  assert.equal(L.markMode(BEFORE, CFG, false), 'practice');
  assert.equal(L.markMode(NIGHT, CFG, false), 'live');
  assert.equal(L.markMode(BEFORE, CFG, true), 'demo');
  // Supabase configured but outside the window: marks never reach the server.
  const calls = [];
  const remote = { ping: () => Promise.resolve() };
  B.METHODS.forEach((m) => { remote[m] = () => { calls.push(m); return Promise.resolve([]); }; });
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, remote, now: () => BEFORE });
  await api.sendMark({ session: session(), lat: 42.97, lng: -81.24 }, TOKEN, grid.cell);
  await api.listZones(45, grid.cell);
  await api.listPosts('fun');
  assert.deepEqual(calls, ['listPosts'], 'practice marks stay local; the board is still shared');
  const live = B.createBackend(CFG, { storage: memStore(), channel: null, remote, now: () => NIGHT });
  await live.listZones(45, grid.cell);
  assert.deepEqual(calls, ['listPosts', 'liveZoneCounts'], 'on the night zones come from the server');
});

test('suggestions: reason ≤ 80, no links/phones, 1 per hex, 3 per day, promoted to "community suggested" at 3', async () => {
  const { a, b, clock } = tabs(BEFORE);
  const p = [43.0262, -81.2765], cell = grid.cell(p[0], p[1]), c = grid.center(cell);
  const sug = (dev, reason, cl = cell, at = c) => a.suggestArea({ device: dev, cell: cl, lat: at[0], lng: at[1], reason });
  await assert.rejects(sug('device-0001', 'see www.mysite.com'), { code: 'text:url' });
  await assert.rejects(sug('device-0001', 'call 519-555-1234'), { code: 'text:phone' });
  await assert.rejects(sug('device-0001', 'x'.repeat(81)), { code: 'text:tooLong' });
  await assert.rejects(a.suggestArea({ device: 'device-0001', cell: 'L0_0', lat: 43.65, lng: -79.38 }), { code: 'outside' });
  await sug('device-0001', 'Lots of porch lights');
  await assert.rejects(sug('device-0001', 'again'), { code: 'rate' }, '1 per hex per device');
  await sug('device-0002', '');
  assert.deepEqual(await b.communitySuggested(), [], '2 suggestions: not shown');
  await sug('device-0003', '很多人家装饰');
  const cs = await b.communitySuggested();
  assert.equal(cs.length, 1);
  assert.equal(cs[0].cell, cell);
  assert.equal(cs[0].n, 3);
  assert.deepEqual(cs[0].reasons.sort(), ['Lots of porch lights', '很多人家装饰'].sort());
  // 3 per device per day
  for (const q of [[42.91, -81.30], [43.02, -81.17]]) { const k = grid.cell(...q); await sug('device-0009', 'ok', k, grid.center(k)); }
  const k3 = grid.cell(43.01, -81.335);
  await sug('device-0009', 'ok', k3, grid.center(k3));
  const k4 = grid.cell(42.95, -81.40);
  await assert.rejects(sug('device-0009', 'ok', k4, grid.center(k4)), { code: 'rate' }, '4th suggestion in a day');
  clock.t += 25 * 3600000;
  await sug('device-0009', 'ok', k4, grid.center(k4));
  assert.equal(L.suggestRate([{ t: 0, cell: 'X' }], 'X', 10 * 86400000).reason, 'hex', 'same hex stays blocked');
  assert.equal(L.checkReason('').ok, true, 'reason is optional');
});

test('Near me: sorted by distance, filtered by radius (1 / 2 / 5 km)', () => {
  const home = [42.9628, -81.2390];
  const spots = [[42.9668, -81.2455, 23], [42.9763, -81.2390, 7], [42.9990, -81.2475, 9], [42.9420, -81.2660, 5], [43.0100, -81.3350, 16], [42.9605, -81.2470, 6]];
  const zones = spots.map(([lat, lng, n]) => ({ cell: grid.cell(lat, lng), count: n, bucket: L.zoneBucket(n) }));
  const d = (z) => z.distM;
  const r2 = L.nearZones(zones, home, 2, grid.center);
  assert.ok(r2.length >= 2);
  assert.ok(r2.every((z, i) => i === 0 || d(r2[i - 1]) <= d(z)), 'nearest first');
  assert.ok(r2.every((z) => z.distM <= 2000));
  const r1 = L.nearZones(zones, home, 1, grid.center);
  const r5 = L.nearZones(zones, home, 5, grid.center);
  assert.ok(r1.length < r2.length && r2.length < r5.length, `${r1.length} < ${r2.length} < ${r5.length}`);
  assert.ok(!r5.some((z) => z.count === 16), 'Hyde Park (~8 km) is outside 5 km');
  assert.ok(r2[0].center && typeof r2[0].distM === 'number');
});

test('demo seeds a range of zones incl. a hot NEW zone outside the researched areas and one community-suggested hexagon', () => {
  const src = fs.readFileSync(path.join(root, 'demo.js'), 'utf8');
  const sandbox = { TOT_LIB: L, document: { visibilityState: 'hidden' }, setInterval: () => 0 };
  require('node:vm').runInNewContext(src, sandbox);
  const D = sandbox.TOT_DEMO;
  const store = memStore();
  const local = new B.LocalAdapter({ storage: store, channel: null, cfg: CFG, prefix: 'ltot.demo.', now: () => NIGHT });
  D.seed(local, grid);
  const zones = L.aggregateZones(local._get('marks', []), null, NIGHT, 45);
  const counts = zones.map((z) => z.count);
  assert.ok(counts.includes(23) && counts.includes(9) && counts.includes(4), counts.join());
  assert.deepEqual([...new Set(zones.map((z) => z.bucket))].sort(), ['hot', 'lively', 'quiet']);
  const hyde = zones.find((z) => L.distM(grid.center(z.cell), [43.010, -81.335]) < 500);
  assert.ok(hyde && hyde.bucket === 'hot' && hyde.isNew, 'Hyde Park is hot and NEW');
  assert.ok(zones.filter((z) => z.isNew).length >= 1);
  assert.ok(!zones.some((z) => L.distM(grid.center(z.cell), [42.944, -81.207]) < 400), 'the 2-mark Pond Mills cell stays hidden');
  assert.equal(L.communitySuggested(local._get('suggestions', [])).length, 1);
  const before = local._get('marks', []).length;
  D.addOne(local, grid);
  assert.equal(local._get('marks', []).length, before + 1, 'fake marks keep arriving');
});
