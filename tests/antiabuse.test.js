'use strict';
// v15.7 anti-abuse tightening (supabase/v156_antiabuse.sql + the same rules on the phone).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const B = require('../backend.js');
const I18N = require('../i18n.js');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const CFG = { backend: 'local', liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' }, markWindowMin: 45, pollSec: 45 };
const OCT18 = Date.parse('2026-10-18T16:00:00Z');
function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }

test('aggregateZones: 3 marks from 2 sessions do not light a zone; 3 sessions do; marks without a session count alone', () => {
  const now = Date.parse('2026-10-31T23:00:00Z'), mk = (sid, min, i) => ({ id: 'm' + i, sidHash: sid, cell: 'c1', lat: 42.98, lng: -81.24, tags: [], createdAt: now - min * 60000 });
  assert.equal(L.aggregateZones([mk('a', 40, 1), mk('a', 10, 2), mk('b', 5, 3)], null, now, 45).length, 0);
  const z = L.aggregateZones([mk('a', 40, 1), mk('a', 10, 2), mk('b', 5, 3), mk('c', 1, 4)], null, now, 45);
  assert.equal(z.length, 1); assert.equal(z[0].count, 4, 'count is still all marks'); assert.ok(!('who' in z[0]), 'no session data leaves the function');
  const noSid = [1, 2, 3].map((i) => ({ id: 'x' + i, cell: 'c2', tags: [], createdAt: now - i * 60000 }));
  assert.equal(L.aggregateZones(noSid, null, now, 45).length, 1, 'demo/old marks without sidHash');
});

test('LocalAdapter: no 👍/❤️ on your own pin (code "own"), others still can', async () => {
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, now: () => OCT18 });
  api.local.store = memStore();
  const D = 'device-own-0001', T = 'tok'.padEnd(40, 'x');
  const r = await api.favCreate({ device: D, lat: 42.9668, lng: -81.2455, tag: 'festive' }, T);
  await assert.rejects(api.favReact(D, r.id, 'like'), { code: 'own' });
  await assert.rejects(api.favReact(D, r.id, 'heart'), { code: 'own' });
  const ok = await api.favReact('device-other-02', r.id, 'like');
  assert.ok(ok.added && ok.likes === 1);
});

test('the app understands "own": backend error code, EN + ZH message, pre-checks before calling the server', () => {
  const be = read('backend.js'), app = read('app.js');
  assert.match(be, /CODE_RE = \/\^\(invalid\|forbidden\|rate\|closed\|outside\|own\|/);
  assert.ok(I18N.en.err_own && I18N.zh.err_own && /自己/.test(I18N.zh.err_own));
  assert.match(app, /if \(favTokens\[p\.id\]\) \{ toast\(t\('err_own'\)/);
  assert.match(app, /if \(myPostTokens\[p\.id\]\) \{ toast\(t\('err_own'\)/);
});

test('v156_antiabuse.sql: the 3 functions are byte-identical to schema.sql, change no tables, and end with a check line', () => {
  const fix = read('supabase/v156_antiabuse.sql'), schema = read('supabase/schema.sql');
  const block = (s, n) => { const i = s.indexOf('create or replace function public.' + n + '('); return s.slice(i, s.indexOf('end $$;', i) + 7); };
  for (const n of ['zone_counts', 'fav_react', 'vote_post']) {
    assert.ok(fix.includes('create or replace function public.' + n + '('), n);
    assert.equal(block(fix, n), block(schema, n), n + ' matches schema.sql');
  }
  assert.match(block(fix, 'zone_counts'), /having count\(\*\) >= 3 and count\(distinct w\.sid\) >= 3/);
  assert.match(block(fix, 'fav_react'), /raise exception 'own'/);
  assert.match(block(fix, 'vote_post'), /raise exception 'own'/);
  assert.doesNotMatch(fix.replace(/--[^\n]*/g, ''), /\b(create|alter|drop) table\b|\bdelete from\b|\bgrant\b|\brevoke\b/i);
  assert.match(fix, /select 'v15\.6 anti-abuse ready' as status/);
});
