'use strict';
// v11: "Best decorations / 最佳装饰" layer — lib rules, local adapter, graceful fallback when the server SQL is missing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const B = require('../backend.js');
const I18N = require('../i18n.js');
const root = path.join(__dirname, '..');

const CFG = { backend: 'local', markWindowMin: 45, pollSec: 45 };
const OCT20 = Date.parse('2026-10-20T20:00:00Z');        // 4 PM Toronto
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const grid = L.makeGrid(null);
const SPOT = [42.9712, -81.2398];

test('decor window: open Oct 17 00:00 – Nov 1 00:00 Toronto, main button stays fun-street from Oct 31 3 PM, purge Nov 2', () => {
  assert.equal(L.isDecorOpen(Date.parse('2026-10-17T03:59:00Z')), false, 'Oct 16 23:59 Toronto');
  assert.equal(L.isDecorOpen(Date.parse('2026-10-17T04:00:00Z')), true, 'Oct 17 00:00 Toronto');
  assert.equal(L.isDecorOpen(Date.parse('2026-11-01T03:59:00Z')), true, 'Oct 31 23:59');
  assert.equal(L.isDecorOpen(Date.parse('2026-11-01T04:00:00Z')), false, 'Nov 1 00:00');
  assert.equal(L.decorPrimary(Date.parse('2026-10-31T18:59:00Z')), true, 'Oct 31 2:59 PM: Mark tab opens decor');
  assert.equal(L.decorPrimary(Date.parse('2026-10-31T19:00:00Z')), false, 'Oct 31 3 PM: fun streets first');
  assert.equal(L.decorVisible(Date.parse('2026-11-01T12:00:00Z')), true, 'layer still visible on Nov 1');
  assert.equal(L.DECOR_PURGE_MS, Date.parse('2026-11-02T05:00:00Z'), 'Nov 2 00:00 EST');
  assert.equal(L.decorVisible(L.DECOR_PURGE_MS), false);
  assert.equal(L.isDecorOpen(Date.parse('2027-01-01T00:00:00Z'), true), true, 'demo always open');
});

test('Toronto day + decor rate: same hex once per Toronto day, max 10 per day', () => {
  assert.equal(L.torontoDay(Date.parse('2026-10-21T03:59:00Z')), '2026-10-20');
  assert.equal(L.torontoDay(Date.parse('2026-10-21T04:00:00Z')), '2026-10-21');
  assert.deepEqual(L.decorRate([{ t: OCT20 - 3600e3, cell: 'a' }], 'a', OCT20), { ok: false, reason: 'zone' });
  assert.deepEqual(L.decorRate([{ t: OCT20 - 24 * 3600e3, cell: 'a' }], 'a', OCT20), { ok: true }, 'yesterday is fine');
  const ten = Array.from({ length: 10 }, (_, i) => ({ t: OCT20 - i * 60000, cell: 'c' + i }));
  assert.deepEqual(L.decorRate(ten, 'new', OCT20), { ok: false, reason: 'day' });
  assert.deepEqual(L.decorRate(ten.slice(1), 'new', OCT20), { ok: true });
});

test('aggregateDecor: 3+ only, last 14 days, top tag needs 2+, sorted by count; nothing after the purge', () => {
  const m = (cell, ageDays, tags) => ({ cell, createdAt: OCT20 - ageDays * 864e5, tags });
  const marks = [m('a', 1, ['lights']), m('a', 2, ['lights', 'spooky']), m('a', 3, []), m('a', 4, ['funny']),
                 m('b', 1, ['spooky']), m('b', 1, []), m('b', 15, ['spooky']),         // 15 days old: not counted
                 m('c', 0.1, ['mustsee']), m('c', 0.2, ['bogus']), m('c', 0.3, ['spooky'])];
  const z = L.aggregateDecor(marks, null, OCT20);
  assert.deepEqual(z.map((x) => [x.cell, x.count, x.topTag]), [['a', 4, 'lights'], ['c', 3, null]]);
  assert.ok(z.every((x) => x.kind === 'decor'));
  assert.deepEqual(L.aggregateDecor(marks, null, L.DECOR_PURGE_MS + 1), []);
  assert.deepEqual(L.decorateDecor([{ cell: 'x', count: 2, topTag: 'lights', topTagN: 2 }, { cell: 'y', count: 5, topTag: 'lights', topTagN: 1 },
                                    { cell: 'z', count: 7, topTag: 'evil', topTagN: 7 }]).map((x) => [x.cell, x.topTag]), [['z', null], ['y', null]]);
  assert.deepEqual(L.cleanDecorTags(['lights', 'lights', 'candy', 'mustsee']), ['lights', 'mustsee']);
});

test('LocalAdapter decor: blurred, zone-level, per-day hash, limits, 14-day + Nov 2 retention, 3+ counts', async () => {
  const START = Date.parse('2026-10-17T16:00:00Z');            // noon Toronto, first decor day
  const clock = { t: START };
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, now: () => clock.t });
  const loc = api.local; loc.store = memStore();
  await api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1], tags: ['lights'] }, grid.cell);
  const rec = loc._get('decor', [])[0];
  assert.ok(rec.dayHash && !JSON.stringify(rec).includes('device-one'), 'only a day-salted hash is stored');
  assert.ok(rec.lat !== SPOT[0] || rec.lng !== SPOT[1], 'moved'); assert.ok(L.distM([rec.lat, rec.lng], SPOT) < 80, 'blurred about 50 m');
  assert.deepEqual(Object.keys(rec).sort(), ['cell', 'createdAt', 'dayHash', 'id', 'lat', 'lng', 'tags'], 'no photo, address or text fields');
  await assert.rejects(api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1] }, () => rec.cell), { code: 'rate' }, 'same hex same day');
  await assert.rejects(api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1], tags: ['candy'] }, () => 'L9_9'), { code: 'invalid' });
  await assert.rejects(api.sendDecor({ device: 'device-one-123', lat: 43.65, lng: -79.38 }, grid.cell), { code: 'outside' });
  clock.t += 864e5;                                                   // next day: allowed again, different hash
  await api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1] }, () => rec.cell);
  assert.notEqual(loc._get('decor', [])[1].dayHash, rec.dayHash, 'different days cannot be linked');
  assert.deepEqual(await api.decorCounts(grid.cell), [], '2 marks: hidden');
  await api.sendDecor({ device: 'device-two-456', lat: SPOT[0], lng: SPOT[1], tags: ['lights'] }, () => rec.cell);
  const z = await api.listDecor(grid.cell);
  assert.deepEqual(z.map((x) => [x.cell, x.count, x.topTag]), [[rec.cell, 3, 'lights']]);
  for (let i = 0; i < 10; i++) await api.sendDecor({ device: 'device-three-789', lat: SPOT[0], lng: SPOT[1] }, () => 'L' + i + '_1');
  await assert.rejects(api.sendDecor({ device: 'device-three-789', lat: SPOT[0], lng: SPOT[1] }, () => 'L99_1'), { code: 'rate' }, '10 per day');
  clock.t = START + 14.5 * 864e5;                                 // Nov 1 00:00 Toronto, before the purge
  assert.equal(loc._pruneDecor().length, 12, 'the first mark is gone after 14 days');
  clock.t = L.DECOR_PURGE_MS;
  assert.equal(loc._pruneDecor().length, 0, 'everything deleted from Nov 2');
  clock.t = Date.parse('2026-11-01T05:00:00Z');
  await assert.rejects(api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1] }, grid.cell), { code: 'closed' });
});

test('server without the v11 SQL: decor degrades to this phone ("coming soon"), fun marks stay shared', async () => {
  let calls = 0;
  const missing = () => { calls++; const e = new Error('missing'); e.code = 'missing'; return Promise.reject(e); };
  const remote = { sendDecor: missing, decorCounts: missing, ping: () => Promise.resolve(), listPosts: () => Promise.resolve([]) };
  const api = B.createBackend({ ...CFG, backend: 'supabase' }, { remote, storage: memStore(), channel: null, now: () => OCT20 });
  api.local.store = memStore();
  assert.equal(api.decorShared(), true, 'assumed shared until the server says otherwise');
  assert.deepEqual(await api.decorCounts(grid.cell), []);
  assert.equal(api.decorMissing, true); assert.equal(api.mode, 'supabase', 'not offline'); assert.equal(api.decorShared(), false);
  await api.sendDecor({ device: 'device-one-123', lat: SPOT[0], lng: SPOT[1] }, grid.cell);
  assert.equal(api.local._get('decor', []).length, 1, 'kept on this phone');
  assert.equal(calls, 1, 'the server is not asked again');
  assert.deepEqual(await api.listPosts('fun'), [], 'the rest still uses the server');
});

test('SupabaseAdapter maps PGRST202 (function not found) to code "missing" and calls send_decor / decor_counts', async () => {
  const seen = [];
  const a = Object.create(B.SupabaseAdapter.prototype);
  a.ready = Promise.resolve();
  a.db = { rpc: (name, args) => {
    seen.push([name, args]);
    if (name === 'decor_counts') return Promise.resolve({ data: [{ h3_r8: '882ab2590bfffff', n: 4, top_tag: 'lights', top_tag_n: 2 }], error: null });
    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.send_decor(p_device, ...) in the schema cache' } });
  } };
  assert.deepEqual(await a.decorCounts(), [{ cell: '882ab2590bfffff', count: 4, topTag: 'lights', topTagN: 2 }]);
  await assert.rejects(a.sendDecor({ device: 'd'.repeat(10), lat: 42.97, lng: -81.24, cell: '882ab2590bfffff', tags: ['spooky'] }), { code: 'missing' });
  assert.deepEqual(seen[1], ['send_decor', { p_device: 'd'.repeat(10), p_lat: 42.97, p_lng: -81.24, p_h3: '882ab2590bfffff', p_tags: ['spooky'] }]);
});

test('decor copy (EN + ZH), privacy notice, guide, and the SQL file', () => {
  assert.equal(I18N.en.decorBtn, 'Great decorations? 🎃');   // v15: short question, one name ("Decorations")
  assert.equal(I18N.zh.decorBtn, '装饰很棒？🎃');
  assert.deepEqual(L.DECOR_TAGS.map((t) => [I18N.en['dtag_' + t], I18N.zh['dtag_' + t], L.DECOR_ICON[t]]),
    [['Spooky', '吓人', '👻'], ['Funny', '搞笑俏皮', '😄'], ['Lights', '灯光', '✨'], ['Must-see', '必看', '🏆']]);
  for (const l of ['en', 'zh']) {
    const priv = I18N[l].privacyItems.map((x) => x.join(' ')).join(' ');
    assert.match(priv, l === 'en' ? /Decoration marks.*14 days.*Nov 2, 2026/ : /装饰标记.*14 天.*11 月 2 日/);
    assert.ok(I18N[l].guideCards[1][1].some((b) => b.includes(l === 'en' ? 'purple button at great decorations' : '看到好看的装饰，点紫色按钮')), l + ' welcome card mentions decor');
    assert.ok(I18N[l].howtoSections.some((s) => s[0].includes('🎃')), l + ' How-to decor section');
  }
  const sql = fs.readFileSync(path.join(root, 'supabase/v11_decor.sql'), 'utf8'), schema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
  for (const s of [sql, schema]) {
    assert.match(s, /create table if not exists public\.decor_marks/);
    assert.match(s, /alter table public\.decor_marks enable row level security/);
    assert.match(s, /function public\.send_decor\(/); assert.match(s, /function public\.decor_counts\(/);
    assert.match(s, /having count\(\*\) >= 3/); assert.match(s, /interval '14 days'/);
    assert.match(s, /2026-11-02 00:00:00 America\/Toronto/); assert.match(s, /2026-11-01 00:00:00 America\/Toronto/);
    assert.doesNotMatch(s, /grant (select|insert|update|delete)[^;]*decor_marks/i);
  }
});
