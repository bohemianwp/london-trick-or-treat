// v15.7 Halloween-night load test (Node 18+, no dependencies). Three modes:
//
//   node tests/load_halloween.mjs --estimate [--users 500]
//       No network. Prints requests/minute for N phones with the v15.6 and v15.7 client schedules.
//
//   node tests/load_halloween.mjs --safe [--vus 20] [--seconds 60]
//       SAFE against the live project (reads URL + public anon key from config.js). Each virtual phone repeats what
//       one app refresh does (zone_counts, fav_list, decor_counts, community_suggested, 2× posts) back to back with a
//       1 s pause, plus write-path probes that the server REJECTS at validation (send_mark with an invalid session,
//       fav_react on a pin that does not exist): real round trips, nothing is ever stored. Capped at 25 VUs / 120 s.
//
//   SUPABASE_URL=https://<staging>.supabase.co SUPABASE_ANON_KEY=... node tests/load_halloween.mjs --full --vus 500 --seconds 300
//       FULL simulation: phones poll on the v15.7 schedule (zones every 45 s ±20 %, the 5 slower calls every 3rd poll),
//       send a mark every 5–8 min (new session each time, like the app after 30 min) and 👍 a random pin now and then.
//       Test pins carry the text "loadtest" and are deleted with their tokens at the end; marks expire after 2 hours
//       (or run supabase/cleanup.sql). REFUSES the production project from config.js: use a separate free project
//       with schema.sql loaded and the live window open.
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
const cfgSrc = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const PROD_URL = (/supabaseUrl:\s*'([^']+)'/.exec(cfgSrc) || [])[1], PROD_KEY = (/supabaseAnonKey:\s*'([^']+)'/.exec(cfgSrc) || [])[1];

// ---------------------------------------------------------------- 1) estimate
// Per visible phone per minute. v15.6: 6 requests every 45 s + a full refresh (6) on every unlock (assume 1 unlock / 2 min)
// + a mark every 5 min (send_mark + refresh zones). v15.7: zone_counts every 45 s ±20 %; fav_list, decor_counts,
// community_suggested and 2× posts only every ~3rd poll (≥ 121.5 s, so ~135 s); an unlock re-asks only the zones, and only
// if they are older than 30 s. fav_list (the biggest answer) drops from ~1.8 to ~0.44 calls per phone-minute.
function estimate(users, visibleShare = 0.6) {
  const v156 = 6 * 60 / 45 + 6 * 0.5 + 2 / 5;
  const v157 = 60 / 45 + 5 * 60 / 135 + 1 * 0.5 + 2 / 5;
  const row = (perPhone) => ({ perPhone: +perPhone.toFixed(2), perMin: Math.round(perPhone * users * visibleShare), perSec: +(perPhone * users * visibleShare / 60).toFixed(1) });
  return { users, visibleShare, v156: row(v156), v157: row(v157) };
}
if (has('estimate')) {
  const u = +arg('users', 500);
  for (const n of [300, u]) console.log(JSON.stringify(estimate(n)));
  process.exit(0);
}

// ---------------------------------------------------------------- shared HTTP + stats
const SAFE = has('safe'), FULL = has('full');
if (SAFE === FULL) { console.log('Choose --estimate, --safe or --full. Nothing was sent.'); process.exit(2); }
const URL_ = (SAFE ? PROD_URL : process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = SAFE ? PROD_KEY : process.env.SUPABASE_ANON_KEY || '';
if (!/^https:\/\//.test(URL_ || '') || !KEY) { console.log('No Supabase URL/key. Nothing was sent.'); process.exit(2); }
function jwtRole(k) { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role; } catch { return null; } }
if (/^sb_secret_/.test(KEY) || jwtRole(KEY) === 'service_role') { console.log('Use the anon key, never a secret key. Nothing was sent.'); process.exit(2); }
if (FULL && URL_ === (PROD_URL || '').replace(/\/$/, '')) { console.log('--full refuses the production project in config.js (it would pollute real data). Use a staging project.'); process.exit(2); }
const VUS = Math.max(1, +arg('vus', SAFE ? 20 : 300)), SECONDS = Math.max(5, +arg('seconds', 60));
if (SAFE && (VUS > 25 || SECONDS > 120)) { console.log('--safe is capped at 25 VUs and 120 s against production. Nothing was sent.'); process.exit(2); }

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' };
const stats = {};
const S = (n) => stats[n] || (stats[n] = { ms: [], ok: 0, expectedReject: 0, err: 0, bytes: 0, codes: {} });
async function call(name, method, path, body, expectReject) {
  const st = S(name), t0 = performance.now();
  try {
    const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    st.ms.push(performance.now() - t0); st.bytes += Buffer.byteLength(txt);
    if (r.ok) { st.ok++; return JSON.parse(txt || 'null'); }
    if (expectReject && r.status === 400 && /invalid/.test(txt)) { st.expectedReject++; return null; }
    if (/"message":"(rate|closed|own)/.test(txt)) { st.expectedReject++; return null; }
    st.err++; st.codes[r.status] = (st.codes[r.status] || 0) + 1; return null;
  } catch (e) {
    st.ms.push(performance.now() - t0); st.err++; st.codes[e.cause?.code || e.name] = (st.codes[e.cause?.code || e.name] || 0) + 1; return null;
  }
}
const rpc = (fn, args, expectReject) => call(fn, 'POST', 'rpc/' + fn, args || {}, expectReject);
const posts = (board) => call('posts_' + board, 'GET', `posts?select=id,board,area_id,lat,lng,body,votes,created_at&hidden=eq.false&board=eq.${board}&order=created_at.desc&limit=200`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms, f = 0.2) => ms * (1 - f + Math.random() * 2 * f);
const hex = (n) => randomBytes(n / 2).toString('hex');
const H3 = ['882b1ad4a3fffff', '882b1ad4a7fffff', '882b1ad4abfffff', '882b1ad4affffff', '882b1ad4b3fffff', '882b1ad4b7fffff'];

const t0 = Date.now(), until = t0 + SECONDS * 1000;
let pinIds = [];
const mine = [];   // [id, token] of test pins (full mode) for cleanup

async function safePhone(i) {
  const dev = 'loadtest-' + i + '-' + hex(8);
  while (Date.now() < until) {
    await Promise.all([rpc('zone_counts', { p_window_min: 45 }), rpc('fav_list', { p_device: dev }), rpc('decor_counts'), rpc('community_suggested'), posts('fun'), posts('decor')]);
    await Promise.all([
      rpc('send_mark', { p_session: 'not-a-session', p_lat: 42.98, p_lng: -81.24, p_h3: H3[0], p_tags: [], p_token: 'x'.repeat(20) }, true),   // rejected: invalid
      rpc('fav_react', { p_device: dev, p_pin: randomUUID(), p_kind: 'like' }, true)                                                       // rejected: no such pin
    ]);
    await sleep(1000);
  }
}
async function fullPhone(i) {
  const dev = 'loadtest-' + i + '-' + hex(8);
  await sleep(Math.random() * 45000);                       // phones open the app at different moments
  let poll = 0, nextMark = Date.now() + jitter(60000, 1), nextLike = Date.now() + jitter(120000, 1);
  while (Date.now() < until) {
    const calls = [rpc('zone_counts', { p_window_min: 45 })];
    if (poll++ % 3 === 0) calls.push(rpc('fav_list', { p_device: dev }).then((l) => { if (Array.isArray(l) && l.length) pinIds = l.map((p) => p.id); }),
      rpc('decor_counts'), rpc('community_suggested'), posts('fun'), posts('decor'));
    await Promise.all(calls);
    if (Date.now() > nextMark) {
      nextMark = Date.now() + jitter(390000, 0.25);
      const lat = 42.95 + Math.random() * 0.06, lng = -81.30 + Math.random() * 0.08;
      await rpc('send_mark', { p_session: hex(32), p_lat: +lat.toFixed(4), p_lng: +lng.toFixed(4), p_h3: H3[i % H3.length], p_tags: [], p_token: hex(32) });
      await rpc('zone_counts', { p_window_min: 45 });
    }
    if (Date.now() > nextLike && pinIds.length) { nextLike = Date.now() + jitter(300000, 0.5); await rpc('fav_react', { p_device: dev, p_pin: pinIds[Math.floor(Math.random() * pinIds.length)], p_kind: 'like' }); }
    await sleep(jitter(45000));
  }
}
if (FULL) {   // a few test pins so likes have targets
  for (let k = 0; k < 10; k++) {
    const tok = hex(32), r = await rpc('fav_create', { p_device: 'loadtest-seed-' + k + '-' + hex(6), p_lat: 42.96 + k * 0.004, p_lng: -81.25, p_tag: 'festive', p_body: 'loadtest', p_token: tok });
    if (r && r.id) mine.push([r.id, tok]);
  }
}
console.log(`${SAFE ? 'SAFE' : 'FULL'} run: ${VUS} virtual phones for ${SECONDS} s against ${URL_.replace(/^https:\/\/([^.]{4})[^.]*/, 'https://$1…')}`);
await Promise.all(Array.from({ length: VUS }, (_, i) => (SAFE ? safePhone : fullPhone)(i)));
for (const [id, tok] of mine) await rpc('fav_delete', { p_kind: 'pin', p_id: id, p_token: tok });

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
const secs = (Date.now() - t0) / 1000;
let tot = 0, totErr = 0, totBytes = 0; const all = [];
console.log('endpoint               calls   ok  rejected(ok)  errors   p50   p95   p99 ms   avg bytes');
for (const [n, s] of Object.entries(stats).sort()) {
  const c = s.ms.length; tot += c; totErr += s.err; totBytes += s.bytes; all.push(...s.ms);
  console.log(`${n.padEnd(22)} ${String(c).padStart(5)} ${String(s.ok).padStart(5)} ${String(s.expectedReject).padStart(12)} ${String(s.err).padStart(7)} ${String(pct(s.ms, 50)).padStart(5)} ${String(pct(s.ms, 95)).padStart(5)} ${String(pct(s.ms, 99)).padStart(5)}    ${String(Math.round(s.bytes / Math.max(1, c))).padStart(8)}${s.err ? '  ' + JSON.stringify(s.codes) : ''}`);
}
console.log(JSON.stringify({ seconds: +secs.toFixed(1), requests: tot, reqPerSec: +(tot / secs).toFixed(1), errorRate: +(totErr / Math.max(1, tot)).toFixed(4), p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), avgBytes: Math.round(totBytes / Math.max(1, tot)), testPinsDeleted: mine.length }));
