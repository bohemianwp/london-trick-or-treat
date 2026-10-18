'use strict';
// v15.7 Halloween-night load: jittered polling, slow layers every ~3rd poll, unlock throttle, offline mark queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const B = require('../backend.js');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const CFG = { backend: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k'.repeat(40),
              liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' }, markWindowMin: 45, pollSec: 45 };
const NIGHT = Date.parse('2026-10-31T23:00:00Z');
function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }

test('jitterMs stays within ±f and actually varies', () => {
  assert.equal(L.jitterMs(45000, 0.2, () => 0), 36000);
  assert.equal(L.jitterMs(45000, 0.2, () => 1), 54000);
  const s = new Set(Array.from({ length: 50 }, () => L.jitterMs(45000, 0.2)));
  assert.ok(s.size > 10 && [...s].every((v) => v >= 36000 && v <= 54000));
});

test('pollPlan: all when the slow layers are stale, zones otherwise, nothing on a quick re-unlock', () => {
  const SLOW = 121500, now = 1e9;
  assert.equal(L.pollPlan(now, 0, 0, SLOW, 0), 'all', 'first poll');
  assert.equal(L.pollPlan(now, now - 45000, now - 45000, SLOW, 0), 'zones', '2nd poll');
  assert.equal(L.pollPlan(now, now - 90000, now - 45000, SLOW, 0), 'zones', '3rd poll');
  assert.equal(L.pollPlan(now, now - 135000, now - 45000, SLOW, 0), 'all', '4th poll: slow layers again');
  assert.equal(L.pollPlan(now, now - 60000, now - 10000, SLOW, 30000), 'none', 'unlock 10 s after a refresh');
  assert.equal(L.pollPlan(now, now - 60000, now - 40000, SLOW, 30000), 'zones', 'unlock 40 s later');
});

test('markQueueFresh keeps at most 5 marks younger than 15 minutes', () => {
  const now = 1e9, q = Array.from({ length: 8 }, (_, i) => ({ at: now - i * 60000, m: { i } }));
  assert.equal(L.markQueueFresh(q, now).length, 5);
  assert.equal(L.markQueueFresh([{ at: now - L.MARK_QUEUE_MS }], now).length, 0, '15 min old = dropped');
  assert.deepEqual(L.markQueueFresh(null, now), []);
});

test('offline queue: a live mark made while the server is down is sent once it answers again (blurred, once)', async () => {
  global.localStorage = memStore();
  const sent = []; let up = false;
  const remote = {};
  B.METHODS.forEach((m) => { remote[m] = () => (up ? Promise.resolve([]) : Promise.reject(new Error('Failed to fetch'))); });
  remote.sendMark = (m, token) => { if (!up) return Promise.reject(new Error('Failed to fetch')); sent.push([m, token]); return Promise.resolve({ id: 'srv' }); };
  remote.ping = () => (up ? Promise.resolve() : Promise.reject(new Error('down')));
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, remote, timeoutMs: 50, retryMs: 40, now: () => NIGHT });
  const cell = () => '882b1ad4a3fffff', T = 't'.repeat(32);
  const r = await api.sendMark({ session: 'ab'.repeat(16), lat: 42.9668, lng: -81.2455, tags: [] }, T, cell);
  assert.ok(r.id, 'still counted on the phone right away');
  assert.equal(api.mode, 'offline');
  assert.equal(api.pendingMarks(), 1);
  up = true;
  await new Promise((res) => setTimeout(res, 250));
  assert.equal(api.mode, 'supabase', 'back online after a jittered retry');
  assert.equal(sent.length, 1, 'sent exactly once');
  assert.notEqual(sent[0][0].lat, 42.9668, 'the queued copy is the blurred position, never the raw one');
  assert.equal(api.pendingMarks(), 0);
  delete global.localStorage;
});

test('app.js: no fixed-interval full refresh; jittered poll loop + unlock throttle + catch-up on reconnect', () => {
  assert.doesNotMatch(app, /setInterval\(function \(\) \{\s*if \(document\.visibilityState === 'visible'\) refreshAll\(\);/);
  assert.match(app, /LIB\.jitterMs\(POLL_MS, 0\.2\)/);
  assert.match(app, /SLOW_MS = Math\.round\(POLL_MS \* 2\.7\)/);
  assert.match(app, /UNLOCK_ZONES_MS = 30000/);
  assert.match(app, /backend\.onStatus\(function \(m\) \{ if \(m === 'supabase'\) setTimeout\(refreshAll/);
});
