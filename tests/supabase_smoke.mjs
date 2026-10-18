// Supabase smoke test (SPEC §8.5). Run ONLY after Peng has created the project and run supabase/schema.sql.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node tests/supabase_smoke.mjs
// Uses only the public anon key and plain fetch (no packages).
// Checks: RPC input validation, RLS (anon cannot read votes/reports/marks/suggestions/secrets or write tables
//         directly, cannot call internal helpers), one vote per device, 3 reports hide a post, send_mark
//         window/box/tag checks, zone privacy floor (n ≥ 3, no hashes or points), suggestion rules,
//         v11 decor RPCs (skipped with a note until supabase/v11_decor.sql is run; creates no decor rows),
//         v14 board RPCs (skipped until supabase/v14_board.sql is run; its one test pin is deleted again).
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
const NO_ROWS = process.env.SMOKE_NO_ROWS === '1';   // skip every write that leaves or briefly shows a row

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
const now = Date.now(), open = (now >= Date.parse('2026-10-31T19:00:00Z') && now < Date.parse('2026-11-01T03:00:00Z')) ||
  (process.env.TEST_DAYS_SQL !== '0' && now >= Date.parse('2026-10-17T04:00:00Z') && now < Date.parse('2026-10-21T04:00:00Z'));   // v7_update.sql is live (TEST_DAYS_SQL=0 for an old server)
if (open) {
  console.log('(live/test window is open: checking send_mark validation instead of "closed")');
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

// ---- v11 decor marks (only after supabase/v11_decor.sql was run; skipped with a note otherwise).
// send_decor is only called with inputs it must reject, so no decor rows are created.
const missingFn = (r) => r.status === 404 || /PGRST202|Could not find the function/.test(JSON.stringify(r.data || ''));
const dc0 = await rpc('decor_counts');
if (missingFn(dc0)) console.log('(decor: send_decor / decor_counts not installed yet. Run supabase/v11_decor.sql, then run this again. Decor checks skipped.)');
else {
  const dr = await rest('GET', 'decor_marks?select=*&limit=1');
  check('anon cannot read decor_marks', dr.status === 401 || dr.status === 403, 'HTTP ' + dr.status);
  check('anon cannot insert into decor_marks directly', (await rest('POST', 'decor_marks',
    { day_hash: 'a', day: '2026-10-20', lat: 42.98, lng: -81.24, h3_r8: HEX })).status >= 400);
  check('anon cannot call _ltot_cleanup_decor', (await rpc('_ltot_cleanup_decor')).status >= 400);
  const sendDecor = (lat, lng, h3, tags) => rpc('send_decor', { p_device: DEV, p_lat: lat, p_lng: lng, p_h3: h3, p_tags: tags });
  check('send_decor rejects Toronto (outside)', /outside/.test(errMsg(await sendDecor(43.65, -79.38, HEX, null))));
  check('send_decor rejects a bad hex id (invalid)', /invalid/.test(errMsg(await sendDecor(42.98, -81.24, 'garbage', null))));
  check("send_decor rejects tag 'candy' (decor tags only)", /invalid/.test(errMsg(await sendDecor(42.98, -81.24, HEX, ['lights', 'candy']))));
  const drows = Array.isArray(dc0.data) ? dc0.data : null;
  check('decor_counts only returns hexes with n ≥ 3', dc0.status === 200 && drows && drows.every((r) => r.n >= 3), `HTTP ${dc0.status}, ${drows ? drows.length : '?'} rows`);
  check('decor_counts returns only h3_r8, n, top_tag, top_tag_n', drows && drows.every((r) => JSON.stringify(Object.keys(r).sort()) === '["h3_r8","n","top_tag","top_tag_n"]'));
}

// ---- v14 board "Best streets from past years" (only after supabase/v14_board.sql was run; skipped with a note otherwise).
// Without SMOKE_NO_ROWS=1 it creates ONE pin + one 👍 + one reply and deletes them again with their tokens (nothing left behind).
const fl0 = await rpc('fav_list', { p_device: DEV });
if (missingFn(fl0)) console.log('(board: fav_* RPCs not installed yet. Run supabase/v14_board.sql, then run this again. Board checks skipped.)');
else {
  for (const t of ['fav_pins', 'fav_replies', 'fav_reactions', 'fav_reports']) {
    const r = await rest('GET', t + '?select=*&limit=1');
    check(`anon cannot read ${t}`, r.status === 401 || r.status === 403, 'HTTP ' + r.status);
  }
  check('anon cannot insert into fav_pins directly', (await rest('POST', 'fav_pins', { device_hash: 'a', lat: 42.98, lng: -81.24, tag: 'candy', token_hash: 'b' })).status >= 400);
  check('anon cannot call _ltot_cleanup_fav / _ltot_fav_text', (await rpc('_ltot_cleanup_fav')).status >= 400 && (await rpc('_ltot_fav_text', { p: 'x', p_optional: true, p_max: 80 })).status >= 400);
  const frows = Array.isArray(fl0.data) ? fl0.data : null;
  check('fav_list returns only safe columns', frows && frows.every((r) => JSON.stringify(Object.keys(r).sort()) === '["body","created_at","families","hearts","id","lat","likes","lng","my_heart","my_like","replies","tag"]'), `HTTP ${fl0.status}, ${frows ? frows.length : '?'} rows`);
  check('fav_list families: null or ≥ 3 (aggregate only)', frows && frows.every((r) => r.families === null || r.families >= 3));
  const favC = (lat, lng, tag, body) => rpc('fav_create', { p_device: DEV, p_lat: lat, p_lng: lng, p_tag: tag, p_body: body, p_token: TOKEN });
  check('fav_create rejects Toronto (outside)', /outside/.test(errMsg(await favC(43.65, -79.38, 'candy', null))));
  check('fav_create needs a preset tag (invalid)', /invalid/.test(errMsg(await favC(42.98, -81.24, 'pizza', null))));
  check('fav_create rejects phone numbers', /text:phone/.test(errMsg(await favC(42.98, -81.24, 'candy', 'call 519-555-1234'))));
  check('fav_create rejects house numbers / addresses', /text:address/.test(errMsg(await favC(42.98, -81.24, 'candy', 'house 7 has candy'))) && /text:address/.test(errMsg(await favC(42.98, -81.24, 'candy', '大街12号'))));
  check('fav_create rejects profanity (zh)', /text:profanity/.test(errMsg(await favC(42.98, -81.24, 'candy', '草泥马'))));
  check('fav_create rejects > 80 chars', /text:tooLong/.test(errMsg(await favC(42.98, -81.24, 'candy', 'x'.repeat(81)))));
  const fake = '00000000-0000-4000-8000-000000000000';
  check('fav_react / fav_reply on an unknown pin → invalid', /invalid/.test(errMsg(await rpc('fav_react', { p_device: DEV, p_pin: fake, p_kind: 'like' }))) &&
    /invalid/.test(errMsg(await rpc('fav_reply', { p_device: DEV, p_pin: fake, p_body: 'hi', p_token: TOKEN }))));
  if (NO_ROWS) console.log('(SMOKE_NO_ROWS=1: skipped the create → like → reply → delete round trip)');
  else {
    const c = await favC(42.98761, -81.24322, 'walking', 'Smoke test pin (deleted in seconds)');
    const pin = c.data && c.data.id;
    check('fav_create works and snaps to the ~50 m grid', c.status === 200 && !!pin && Math.abs(c.data.lat - 42.9876) < 1e-6 && Math.abs(c.data.lng - -81.243) < 1e-6, JSON.stringify(c.data) + ' ' + errMsg(c));
    if (pin) {
      const r1 = (await rpc('fav_react', { p_device: 'smoke-test-liker-1', p_pin: pin, p_kind: 'like' })).data;
      const r2 = (await rpc('fav_react', { p_device: 'smoke-test-liker-1', p_pin: pin, p_kind: 'like' })).data;
      check('👍 once per device', r1 && r1.added === true && r1.likes === 1 && r2 && r2.added === false && r2.likes === 1, JSON.stringify([r1, r2]));
      const rep = await rpc('fav_reply', { p_device: DEV, p_pin: pin, p_body: 'Smoke test reply', p_token: TOKEN });
      check('fav_reply works', rep.status === 200 && typeof rep.data === 'string', errMsg(rep));
      const reps = await rpc('fav_replies', { p_pin: pin });
      check('fav_replies returns only id, body, created_at', Array.isArray(reps.data) && reps.data.length === 1 && JSON.stringify(Object.keys(reps.data[0]).sort()) === '["body","created_at","id"]');
      check('fav_delete with a wrong token is refused', /forbidden/.test(errMsg(await rpc('fav_delete', { p_kind: 'pin', p_id: pin, p_token: rand(20) }))));
      check('fav_delete (reply, then pin) with the right token', (await rpc('fav_delete', { p_kind: 'reply', p_id: rep.data, p_token: TOKEN })).status === 200 &&
        (await rpc('fav_delete', { p_kind: 'pin', p_id: pin, p_token: TOKEN })).status === 200);
      check('the smoke pin is gone', !((await rpc('fav_list', {})).data || []).some((r) => r.id === pin));
    }
  }
}

// ---- neighbourhood suggestions
const SHEX = rand(8).slice(0, 15);                // random 15-hex id, not a real H3 cell
const suggest = (dev, lat, lng, reason) => rpc('suggest_area', { p_device: dev, p_h3: SHEX, p_lat: lat, p_lng: lng, p_reason: reason });
const sErr = async (reason, lat = 42.98, lng = -81.24) => errMsg(await suggest(DEV, lat, lng, reason));
check('suggest_area rejects links (text:url)', /text:url/.test(await sErr('see www.spam.com')));
check('suggest_area rejects phone numbers (text:phone)', /text:phone/.test(await sErr('call 519-555-1234')));
check('suggest_area rejects > 80 chars (text:tooLong)', /text:tooLong/.test(await sErr('x'.repeat(81))));
check('suggest_area rejects Toronto (outside)', /outside/.test(await sErr(null, 43.65, -79.38)));
// SMOKE_NO_ROWS=1 skips the one valid suggestion (anon cannot delete it), so the run leaves nothing behind.
const s1 = NO_ROWS ? { status: 0 } : await suggest(DEV, 42.98, -81.24, 'Smoke test');
if (NO_ROWS) console.log('(SMOKE_NO_ROWS=1: skipped the valid-suggestion write and the duplicate check)');
else {
  check('suggest_area accepts a valid suggestion', s1.status === 200 && typeof s1.data === 'string', 'HTTP ' + s1.status + ' ' + errMsg(s1));
  check('same device + same hex again → rate', /rate/.test(errMsg(await suggest(DEV, 42.98, -81.24, null))));
}
const cs = await rpc('community_suggested');
const crows = Array.isArray(cs.data) ? cs.data : null;
check('community_suggested only returns hexes with n ≥ 3', cs.status === 200 && crows && crows.every((r) => r.n >= 3), `HTTP ${cs.status}, ${crows ? crows.length : '?'} rows`);
check('community_suggested never returns device_hash', crows && !JSON.stringify(crows).includes('device_hash') && !crows.some((r) => r.h3_r8 === SHEX));

console.log(`\n${pass} passed, ${fail} failed`);
if (s1.status === 200) console.log(`Left behind: 1 suggestion (device ${DEV}, hex ${SHEX}) — remove it with supabase/cleanup.sql.`);
process.exit(fail ? 1 : 0);
