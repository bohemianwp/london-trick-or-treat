// Supabase smoke test (SPEC §8.5). Run ONLY after Peng has created the project and run supabase/schema.sql.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node tests/supabase_smoke.mjs
// Uses only the public anon key and plain fetch (no packages).
// Checks: RPC input validation, RLS (anon cannot read votes/reports/marks/suggestions/secrets or write tables
//         directly, cannot call internal helpers), one vote per device, 3 reports hide a post, send_mark
//         window/box/tag checks, zone privacy floor (n ≥ 3, no hashes or points), suggestion rules.
// Rows it leaves behind: the test post is deleted again (its votes/reports go with it). ONE suggestion row
// remains (device 'smoke-test-<random>', a random non-H3 hex id, so it can never light up a real zone) —
// anon cannot delete suggestions; supabase/cleanup.sql removes it. No marks are created (send_mark is only
// called with inputs it must reject).
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
const DEV = 'smoke-test-' + rand(8), TOKEN = rand(20);

// ---- RLS: direct table access
for (const t of ['votes', 'reports', 'marks', 'suggestions']) {
  const r = await rest('GET', t + '?select=*&limit=1');
  check(`anon cannot read ${t}`, r.status === 401 || r.status === 403, 'HTTP ' + r.status);
}
check('anon cannot read posts.author_hash', (await rest('GET', 'posts?select=author_hash&limit=1')).status >= 400);
check('anon cannot read posts.token_hash', (await rest('GET', 'posts?select=token_hash&limit=1')).status >= 400);
check('anon can read safe post columns', (await rest('GET', 'posts?select=id,body,votes&limit=1')).status === 200);
check('anon cannot insert into posts directly', (await rest('POST', 'posts', { board: 'fun', body: 'x', author_hash: 'a', token_hash: 'b' })).status >= 400);
check('anon cannot insert into marks directly', (await rest('POST', 'marks',
  { session_hash: 'a', lat: 42.98, lng: -81.24, h3_r8: '882b1ad4a3fffff', token_hash: 'b' })).status >= 400);
check('anon cannot insert into suggestions directly', (await rest('POST', 'suggestions',
  { device_hash: 'a', h3_r8: '882b1ad4a3fffff', lat: 42.98, lng: -81.24 })).status >= 400);
check('anon cannot call internal helpers (_ltot_hash)', (await rpc('_ltot_hash', { t: 'x' })).status >= 400);
check('anon cannot call _ltot_cleanup_marks', (await rpc('_ltot_cleanup_marks')).status >= 400);

// ---- board
const bad = async (body) => errMsg(await rpc('create_post', { p_board: 'fun', p_area_id: null, p_lat: null, p_lng: null, p_body: body, p_voter: DEV, p_token: TOKEN }));
check('create_post rejects links', /text:url/.test(await bad('see www.spam.com')));
check('create_post rejects phone numbers', /text:phone/.test(await bad('call 519-555-1234')));
check('create_post rejects > 140 chars', /text:tooLong/.test(await bad('x'.repeat(141))));
const created = await rpc('create_post', { p_board: 'fun', p_area_id: 'old-north', p_lat: null, p_lng: null, p_body: 'Smoke test post (will be deleted)', p_voter: DEV, p_token: TOKEN });
const postId = created.data;
check('create_post works', created.status === 200 && typeof postId === 'string', 'HTTP ' + created.status + ' ' + errMsg(created));
const v1 = (await rpc('vote_post', { p_post_id: postId, p_voter: 'smoke-test-voter-1' })).data;
const v2 = (await rpc('vote_post', { p_post_id: postId, p_voter: 'smoke-test-voter-1' })).data;
check('one vote per device', v1 === 1 && v2 === -1, `${v1}, ${v2}`);
for (const r of ['smoke-test-rep-1', 'smoke-test-rep-2', 'smoke-test-rep-3']) await rpc('report_post', { p_post_id: postId, p_voter: r });
const after = await rest('GET', `posts?select=id&id=eq.${postId}`);
check('3 reports hide the post', after.status === 200 && after.data.length === 0);
check('delete_post with wrong token is refused', /forbidden/.test(errMsg(await rpc('delete_post', { p_id: postId, p_token: rand(20) }))));
check('delete_post with the right token', (await rpc('delete_post', { p_id: postId, p_token: TOKEN })).status === 200);

// ---- marks → zones (send_mark is only called with inputs that must be rejected: no rows are created)
const HEX = '882b1ad4a3fffff';
const sendMark = (lat, lng, tags) => rpc('send_mark', { p_session: rand(16), p_lat: lat, p_lng: lng, p_h3: HEX, p_tags: tags, p_token: rand(20) });
const now = Date.now(), open = now >= Date.parse('2026-10-31T19:00:00Z') && now < Date.parse('2026-11-01T03:00:00Z');
if (open) {
  console.log('(Oct 31 live window is open: checking send_mark validation instead of "closed")');
  check('send_mark rejects Toronto (outside)', /outside/.test(errMsg(await sendMark(43.65, -79.38, null))));
  check("send_mark rejects tag 'pizza' (invalid)", /invalid/.test(errMsg(await sendMark(42.98, -81.24, ['candy', 'pizza']))));
} else {
  const sm = await sendMark(42.98, -81.24, null);
  check('send_mark refused outside Oct 31 3–11 PM Toronto (closed)', /closed/.test(errMsg(sm)), errMsg(sm));
}
const zc = await rpc('zone_counts', { p_window_min: 45 });
const zrows = Array.isArray(zc.data) ? zc.data : null;
check('zone_counts(45) only returns zones with n ≥ 3', zc.status === 200 && zrows && zrows.every((r) => r.n >= 3), `HTTP ${zc.status}, ${zrows ? zrows.length : '?'} rows`);
check('zone_counts never exposes session_hash / lat / lng', zrows && zrows.every((r) => !('session_hash' in r) && !('lat' in r) && !('lng' in r)));

// ---- neighbourhood suggestions
const SHEX = rand(8).slice(0, 15);                // random 15-hex id, not a real H3 cell
const suggest = (dev, lat, lng, reason) => rpc('suggest_area', { p_device: dev, p_h3: SHEX, p_lat: lat, p_lng: lng, p_reason: reason });
const sErr = async (reason, lat = 42.98, lng = -81.24) => errMsg(await suggest(DEV, lat, lng, reason));
check('suggest_area rejects links (text:url)', /text:url/.test(await sErr('see www.spam.com')));
check('suggest_area rejects phone numbers (text:phone)', /text:phone/.test(await sErr('call 519-555-1234')));
check('suggest_area rejects > 80 chars (text:tooLong)', /text:tooLong/.test(await sErr('x'.repeat(81))));
check('suggest_area rejects Toronto (outside)', /outside/.test(await sErr(null, 43.65, -79.38)));
const s1 = await suggest(DEV, 42.98, -81.24, 'Smoke test');
check('suggest_area accepts a valid suggestion', s1.status === 200 && typeof s1.data === 'string', 'HTTP ' + s1.status + ' ' + errMsg(s1));
check('same device + same hex again → rate', /rate/.test(errMsg(await suggest(DEV, 42.98, -81.24, null))));
const cs = await rpc('community_suggested');
const crows = Array.isArray(cs.data) ? cs.data : null;
check('community_suggested only returns hexes with n ≥ 3', cs.status === 200 && crows && crows.every((r) => r.n >= 3), `HTTP ${cs.status}, ${crows ? crows.length : '?'} rows`);
check('community_suggested never returns device_hash', crows && !JSON.stringify(crows).includes('device_hash') && !crows.some((r) => r.h3_r8 === SHEX));

console.log(`\n${pass} passed, ${fail} failed`);
if (s1.status === 200) console.log(`Left behind: 1 suggestion (device ${DEV}, hex ${SHEX}) — remove it with supabase/cleanup.sql.`);
process.exit(fail ? 1 : 0);
