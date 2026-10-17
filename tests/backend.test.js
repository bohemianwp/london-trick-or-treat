'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');
const B = require('../backend.js');

const CFG = { backend: 'local', liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
              markWindowMin: 45, pollSec: 45 };
const NIGHT = Date.parse('2026-10-31T23:00:00Z');       // 7 PM Toronto
const BEFORE = Date.parse('2026-10-20T16:00:00Z');

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
// Fake BroadcastChannel bus: a message from one tab reaches every *other* tab.
function bus() {
  const chans = [];
  return () => {
    const c = { onmessage: null, postMessage(d) { chans.filter((x) => x !== c).forEach((x) => x.onmessage && x.onmessage({ data: d })); } };
    chans.push(c);
    return c;
  };
}
function twoTabs(now) {
  const storage = memStore(), mk = bus(), clock = { t: now };
  const opt = () => ({ storage, channel: mk(), cfg: CFG, now: () => clock.t });
  return { a: new B.LocalAdapter(opt()), b: new B.LocalAdapter(opt()), clock };
}
const TOKEN = 'a'.repeat(40), OTHER = 'b'.repeat(40);

test('two tabs: a post in tab A shows up in tab B (BroadcastChannel)', async () => {
  const { a, b } = twoTabs(BEFORE);
  const seen = [];
  b.onChange((kind, remote) => seen.push([kind, remote]));
  await a.createPost({ board: 'fun', areaId: 'old-south-baker', body: 'Baker St was great!' }, 'dev1', TOKEN);
  assert.ok(seen.some(([k, r]) => k === 'posts' && r === true), 'tab B was notified');
  const list = await b.listPosts('fun');
  assert.equal(list.length, 1);
  assert.equal(list[0].body, 'Baker St was great!');
  assert.equal(list[0].tokenHash, undefined, 'secrets are not returned');
  assert.equal((await b.listPosts('decor')).length, 0);
});

test('board: one vote per device, report hides at 3, rate limit, URL/phone rejected', async () => {
  const { a, clock } = twoTabs(BEFORE);
  const { id } = await a.createPost({ board: 'decor', body: 'Haunted garage on Askin' }, 'dev1', TOKEN);
  assert.deepEqual(await a.vote(id, 'dev2'), { ok: true, count: 1 });
  assert.equal((await a.vote(id, 'dev2')).already, true, 'second vote from the same device ignored');
  await a.vote(id, 'dev3');
  assert.equal((await a.listPosts('decor'))[0].votes, 2);
  await a.report(id, 'r1'); await a.report(id, 'r1'); await a.report(id, 'r2');
  assert.equal((await a.listPosts('decor')).length, 1, 'duplicate reports from one device count once');
  await a.report(id, 'r3');
  assert.equal((await a.listPosts('decor')).length, 0, 'hidden at 3 reports');

  await assert.rejects(a.createPost({ board: 'fun', body: 'visit www.spam.com' }, 'dev9', TOKEN), { code: 'text:url' });
  await assert.rejects(a.createPost({ board: 'fun', body: 'call 519-555-1234' }, 'dev9', TOKEN), { code: 'text:phone' });
  await assert.rejects(a.createPost({ board: 'nope', body: 'hi' }, 'dev9', TOKEN), { code: 'invalid' });
  await assert.rejects(a.createPost({ board: 'fun', body: 'hi', lat: 43.65, lng: -79.38 }, 'dev9', TOKEN), { code: 'outside' });
  for (let i = 0; i < 5; i++) await a.createPost({ board: 'fun', body: 'post ' + i }, 'dev5', TOKEN);
  await assert.rejects(a.createPost({ board: 'fun', body: 'post 6' }, 'dev5', TOKEN), { code: 'rate' });
  clock.t += 3600001;
  await a.createPost({ board: 'fun', body: 'an hour later' }, 'dev5', TOKEN);
  const withLoc = await a.createPost({ board: 'fun', body: 'rough spot', lat: 42.966812, lng: -81.245533 }, 'dev6', TOKEN);
  const p = (await a.listPosts('fun')).find((x) => x.id === withLoc.id);
  assert.deepEqual([p.lat, p.lng], [42.967, -81.246], 'post location rounded to ~100 m');
  await assert.rejects(a.deletePost(withLoc.id, OTHER), { code: 'forbidden' });
  await a.deletePost(withLoc.id, TOKEN);
});

test('resilient backend: network failure → offline mode + local fallback; validation errors pass through', async () => {
  const storage = memStore();
  const unconfigured = B.createBackend(Object.assign({}, CFG, { backend: 'supabase' }), { storage, channel: null });
  assert.equal(unconfigured.mode, 'offline');
  assert.equal(unconfigured.reason, 'notConfigured');
  assert.deepEqual(await unconfigured.listPosts('fun'), []);

  const calls = [];
  const down = {};
  B.METHODS.forEach((m) => { down[m] = () => { calls.push(m); return Promise.reject(new Error('Failed to fetch')); }; });
  down.ping = () => Promise.reject(new Error('down'));
  const statuses = [];
  const api = B.createBackend(CFG, { storage, channel: null, remote: down, timeoutMs: 50, retryMs: 60000 });
  api.onStatus((m) => statuses.push(m));
  assert.equal(api.mode, 'supabase');
  const r = await api.createPost({ board: 'fun', body: 'still works offline' }, 'dev1', TOKEN);
  assert.ok(r.id, 'write fell back to local');
  assert.equal(api.mode, 'offline');
  assert.deepEqual(statuses, ['offline']);
  assert.equal((await api.listPosts('fun')).length, 1);
  assert.deepEqual(calls, ['createPost'], 'once offline, calls go local');

  const slow = {};
  B.METHODS.forEach((m) => { slow[m] = () => new Promise(() => {}); });
  slow.ping = () => Promise.resolve();
  const api2 = B.createBackend(CFG, { storage: memStore(), channel: null, remote: slow, timeoutMs: 30, retryMs: 60000 });
  assert.deepEqual(await api2.listPosts('fun'), [], 'timeout → local');
  assert.equal(api2.mode, 'offline');

  const strict = {};
  B.METHODS.forEach((m) => { strict[m] = () => { const e = new Error('rate'); e.code = 'rate'; e.validation = true; return Promise.reject(e); }; });
  const api3 = B.createBackend(CFG, { storage: memStore(), channel: null, remote: strict, timeoutMs: 50 });
  await assert.rejects(api3.createPost({ board: 'fun', body: 'x' }, 'd', TOKEN), { code: 'rate' });
  assert.equal(api3.mode, 'supabase', 'a server-side "no" is not an outage');
});

test('isConfigured needs backend=supabase, an https URL and a key', () => {
  assert.equal(B.isConfigured({ backend: 'local', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k'.repeat(40) }), false);
  assert.equal(B.isConfigured({ backend: 'supabase', supabaseUrl: '', supabaseAnonKey: '' }), false);
  assert.equal(B.isConfigured({ backend: 'supabase', supabaseUrl: 'http://x.supabase.co', supabaseAnonKey: 'k'.repeat(40) }), false);
  assert.equal(B.isConfigured({ backend: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k'.repeat(40) }), true);
});
