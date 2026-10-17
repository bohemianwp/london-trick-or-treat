// Supabase smoke test (SPEC §8.5). Run ONLY after Peng has created the project and run supabase/schema.sql.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node tests/supabase_smoke.mjs
// Uses only the public anon key and plain fetch (no packages). Creates a few test rows and deletes them again.
// Checks: RPC input validation, RLS (anon cannot read votes/reports/dots/secrets or write tables directly),
//         one vote per device, 3 reports hide a post, live-dot window/box checks, hex privacy floor.
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || '';
if (!/^https:\/\//.test(URL_) || !KEY) {
  console.log('Set SUPABASE_URL and SUPABASE_ANON_KEY first. Nothing was sent.');
  process.exit(2);
}
// Refuse secret keys: this test must prove what the PUBLIC key can and cannot do.
function jwtRole(k) { try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role; } catch { return null; } }
if (/^sb_secret_/.test(KEY) || jwtRole(KEY) === 'service_role') {
  console.log('That is a SECRET (service_role) key. Use the anon / publishable key. Nothing was sent.');
  process.exit(2);
}

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
async function rest(method, path, body) {
  const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers: Object.assign({ Prefer: 'return=representation' }, H), body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const rpc = (name, args) => rest('POST', 'rpc/' + name, args || {});
const errMsg = (r) => (r.data && r.data.message) || '';
let pass = 0, fail = 0;
function check(name, ok, detail) { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }
const rand = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const DEV = 'smoke-' + rand(8), TOKEN = rand(20);

// ---- RLS: direct table access
for (const t of ['votes', 'reports', 'live_dots']) {
  const r = await rest('GET', t + '?select=*&limit=1');
  check(`anon cannot read ${t}`, r.status === 401 || r.status === 403, 'HTTP ' + r.status);
}
check('anon cannot read markers.edit_token_hash', (await rest('GET', 'markers?select=edit_token_hash&limit=1')).status >= 400);
check('anon cannot read posts.author_hash', (await rest('GET', 'posts?select=author_hash&limit=1')).status >= 400);
check('anon can read safe post columns', (await rest('GET', 'posts?select=id,body,votes&limit=1')).status === 200);
check('anon cannot insert into posts directly', (await rest('POST', 'posts', { board: 'fun', body: 'x', author_hash: 'a', token_hash: 'b' })).status >= 400);
check('anon cannot update markers directly', (await rest('PATCH', 'markers?id=not.is.null', { status: 'out' })).status >= 400);
check('anon cannot call internal helpers', (await rpc('_ltot_hash', { t: 'x' })).status >= 400);

// ---- board
const bad = async (body) => errMsg(await rpc('create_post', { p_board: 'fun', p_area_id: null, p_lat: null, p_lng: null, p_body: body, p_voter: DEV, p_token: TOKEN }));
check('create_post rejects links', /text:url/.test(await bad('see www.spam.com')));
check('create_post rejects phone numbers', /text:phone/.test(await bad('call 519-555-1234')));
check('create_post rejects > 140 chars', /text:tooLong/.test(await bad('x'.repeat(141))));
const created = await rpc('create_post', { p_board: 'fun', p_area_id: 'old-north', p_lat: null, p_lng: null, p_body: 'Smoke test post (will be deleted)', p_voter: DEV, p_token: TOKEN });
const postId = created.data;
check('create_post works', created.status === 200 && typeof postId === 'string', 'HTTP ' + created.status + ' ' + errMsg(created));
const v1 = (await rpc('vote_post', { p_post_id: postId, p_voter: 'smoke-voter-1' })).data;
const v2 = (await rpc('vote_post', { p_post_id: postId, p_voter: 'smoke-voter-1' })).data;
check('one vote per device', v1 === 1 && v2 === -1, `${v1}, ${v2}`);
for (const r of ['smoke-rep-1', 'smoke-rep-2', 'smoke-rep-3']) await rpc('report_post', { p_post_id: postId, p_voter: r });
const after = await rest('GET', `posts?select=id&id=eq.${postId}`);
check('3 reports hide the post', after.status === 200 && after.data.length === 0);
check('delete_post with wrong token is refused', /forbidden/.test(errMsg(await rpc('delete_post', { p_id: postId, p_token: rand(20) }))));
check('delete_post with the right token', (await rpc('delete_post', { p_id: postId, p_token: TOKEN })).status === 200);

// ---- markers
const m = await rpc('upsert_marker', { p_id: null, p_lat: 42.9668, p_lng: -81.2455, p_types: ['candy', 'teal'], p_status: 'giving',
  p_note: 'Smoke test marker (will be deleted)', p_start: '17:30', p_end: '20:30', p_token: TOKEN, p_device: DEV });
const markerId = m.data;
check('upsert_marker works', m.status === 200 && typeof markerId === 'string', 'HTTP ' + m.status + ' ' + errMsg(m));
check('status change with wrong token refused', /forbidden/.test(errMsg(await rpc('set_marker_status', { p_id: markerId, p_token: rand(20), p_status: 'out' }))));
check('status change with right token', (await rpc('set_marker_status', { p_id: markerId, p_token: TOKEN, p_status: 'out' })).status === 200);
const mr = await rest('GET', `markers?select=id,status&id=eq.${markerId}`);
check('marker readable with new status', mr.data && mr.data[0] && mr.data[0].status === 'out');
check('marker outside London refused', /outside/.test(errMsg(await rpc('upsert_marker', { p_id: null, p_lat: 43.65, p_lng: -79.38, p_types: ['candy'],
  p_status: 'giving', p_note: null, p_start: null, p_end: null, p_token: rand(20), p_device: DEV }))));
check('delete_marker with the right token', (await rpc('delete_marker', { p_id: markerId, p_token: TOKEN })).status === 200);

// ---- live dots
const now = Date.now(), open = now >= Date.parse('2026-10-31T19:00:00Z') && now < Date.parse('2026-11-01T03:00:00Z');
check('send_dot rejects points outside London', /outside|closed/.test(errMsg(await rpc('send_dot', { p_session: rand(16), p_lat: 43.65, p_lng: -79.38, p_h3: null }))));
const sess = rand(16);
const sd = await rpc('send_dot', { p_session: sess, p_lat: 42.98, p_lng: -81.24, p_h3: null });
if (open) check('send_dot accepted during the Oct 31 window', sd.status === 200 && sd.data === true, errMsg(sd));
else check('send_dot refused outside the Oct 31 window', /closed/.test(errMsg(sd)), errMsg(sd));
const recent = await rpc('live_dots_recent');
check('live_dots_recent never returns raw session ids', recent.status === 200 && !JSON.stringify(recent.data).includes(sess));
const hex = await rpc('live_hex_counts', { p_window_min: 20 });
check('live_hex_counts only returns counts ≥ 3', hex.status === 200 && hex.data.every((r) => r.n >= 3));
if (open) await rpc('remove_dot', { p_session: sess });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
