// Load simulation (SPEC §7, §8.6) — OPTIONAL, against Peng's own Supabase project only.
// Simulates the Oct 31 peak: 500 phones polling every 45 s (zone_counts(45) + the board's post list)
// and 150 phones sending a mark every 5 minutes (the app's own rate limit), for 5 minutes.
// Reports p50/p95/p99 latency and errors.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node tests/load_sim.mjs --yes
//   Options (env): POLLERS=500 SENDERS=150 DURATION_S=300
//
// Outside Oct 31 3–11 PM Toronto the server answers send_mark with "closed" — still a real round trip,
// counted separately as "rejected: closed". Marks sent during the window are deleted by the server
// 2 hours later (or right away with supabase/cleanup.sql).
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
const POLLERS = +(process.env.POLLERS || 500), SENDERS = +(process.env.SENDERS || 150), DURATION = +(process.env.DURATION_S || 300) * 1000;
const POLL_MS = 45000, SEND_MS = 300000;
if (!/^https:\/\//.test(URL_) || !KEY) { console.log('Set SUPABASE_URL and SUPABASE_ANON_KEY first. Nothing was sent.'); process.exit(2); }
function jwtRole(k) { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role; } catch { return null; } }
if (/^sb_secret_/.test(KEY) || jwtRole(KEY) === 'service_role') { console.log('Use the anon / publishable key, not a secret key. Nothing was sent.'); process.exit(2); }
if (!process.argv.includes('--yes')) {
  const rps = POLLERS * 2 / (POLL_MS / 1000) + SENDERS / (SEND_MS / 1000);
  console.log(`This sends about ${rps.toFixed(1)} requests/second to ${URL_} for ${DURATION / 1000} s.\nRe-run with --yes to start.`);
  process.exit(2);
}

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const stats = {};                        // name -> { ms: [], ok, err, closed, codes: {} }
const S = (n) => stats[n] || (stats[n] = { ms: [], ok: 0, err: 0, closed: 0, codes: {} });
async function call(name, method, path, body) {
  const st = S(name), t0 = performance.now();
  try {
    const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const txt = await r.text();
    st.ms.push(performance.now() - t0);
    if (r.ok) st.ok++;
    else if (/closed/.test(txt)) st.closed++;
    else { st.err++; st.codes[r.status] = (st.codes[r.status] || 0) + 1; }
  } catch (e) {
    st.ms.push(performance.now() - t0); st.err++; st.codes[e.code || e.name] = (st.codes[e.code || e.name] || 0) + 1;
  }
}
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const randCell = () => '882b1ad4' + rand(1) + 'fffff';      // H3-looking res-8 id: 15 lowercase hex, ends in fffff
const TAGS = ['candy', 'decor', 'crowded'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = Date.now() + DURATION;

async function poller(i) {
  await sleep(Math.random() * POLL_MS);                     // spread phones over the poll interval
  while (Date.now() < end) {
    await Promise.all([
      call('zone_counts', 'POST', 'rpc/zone_counts', { p_window_min: 45 }),
      call('list_posts', 'GET', 'posts?select=id,board,area_id,lat,lng,body,votes,created_at&hidden=eq.false&order=created_at.desc&limit=200')
    ]);
    await sleep(POLL_MS);
  }
}
async function sender(i) {
  const session = rand(16);                                 // 32 hex chars, like the app's rotating session id
  await sleep(Math.random() * Math.min(SEND_MS, DURATION));
  while (Date.now() < end) {
    const lat = 42.95 + Math.random() * 0.08, lng = -81.33 + Math.random() * 0.16;
    const tags = Math.random() < 0.5 ? null : [TAGS[i % TAGS.length]];
    await call('send_mark', 'POST', 'rpc/send_mark', { p_session: session, p_lat: lat, p_lng: lng, p_h3: randCell(), p_tags: tags, p_token: rand(20) });
    await sleep(SEND_MS);
  }
}
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }

console.log(`Simulating ${POLLERS} pollers (every ${POLL_MS / 1000} s) + ${SENDERS} mark senders (every ${SEND_MS / 60000} min) for ${DURATION / 1000} s…`);
const t0 = Date.now();
const ticker = setInterval(() => {
  const n = Object.values(stats).reduce((a, s) => a + s.ms.length, 0);
  console.log(`  ${Math.round((Date.now() - t0) / 1000)} s: ${n} requests`);
}, 30000);
await Promise.all([...Array(POLLERS)].map((_, i) => poller(i)).concat([...Array(SENDERS)].map((_, i) => sender(i))));
clearInterval(ticker);
const secs = (Date.now() - t0) / 1000;
console.log('\nendpoint             requests   ok  closed  errors    p50 ms   p95 ms   p99 ms');
let total = 0, errs = 0;
for (const [n, s] of Object.entries(stats)) {
  total += s.ms.length; errs += s.err;
  console.log(`${n.padEnd(20)} ${String(s.ms.length).padStart(8)} ${String(s.ok).padStart(4)} ${String(s.closed).padStart(7)} ${String(s.err).padStart(7)}` +
              `${pct(s.ms, 50).toFixed(0).padStart(10)}${pct(s.ms, 95).toFixed(0).padStart(9)}${pct(s.ms, 99).toFixed(0).padStart(9)}` +
              (s.err ? '   ' + JSON.stringify(s.codes) : ''));
}
const closedN = Object.values(stats).reduce((a, s) => a + s.closed, 0);
if (closedN) console.log(`(rejected: closed = ${closedN} send_mark calls — outside Oct 31 3–11 PM Toronto; not counted as errors)`);
console.log(`\n${total} requests in ${secs.toFixed(0)} s = ${(total / secs).toFixed(1)} req/s, ${errs} errors (${(100 * errs / Math.max(1, total)).toFixed(2)}%)`);
process.exit(errs ? 1 : 0);
