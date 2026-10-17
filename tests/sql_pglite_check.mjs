// Runs supabase/schema.sql + cleanup.sql in PGlite (real Postgres compiled to WebAssembly, in memory)
// and attacks it as the `anon` role. No Supabase project or account needed.
// PGlite is not a project dependency, so run this from a scratch folder:
//   mkdir -p /tmp/ltot-sqlcheck && cd /tmp/ltot-sqlcheck && npm install @electric-sql/pglite@0.3
//   cp "<project>/tests/sql_pglite_check.mjs" . && node sql_pglite_check.mjs "<project>/supabase/schema.sql" "<project>/supabase/cleanup.sql"
// Differences from real Supabase: no PostgREST layer and simplified default grants (emulated below).
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
const schema = readFileSync(process.argv[2], 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
async function err(sql, params) { try { await db.query(sql, params); return null; } catch (e) { return e.message; } }
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// Supabase-like environment: roles + default grants that the schema must take back.
await db.exec(`create schema if not exists extensions;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated; grant usage on schema extensions to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;`);
await db.exec(schema.replace(/notify pgrst[^;]*;/, ''));
ok('schema.sql runs without errors', true);
const errx = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const rerun = await errx(schema.replace(/notify pgrst[^;]*;/, ''));
ok('schema.sql can run a second time (idempotent)', rerun === null, rerun || '');
const oldGone = await one(`select to_regclass('public.markers') is null and to_regclass('public.live_dots') is null as gone`);
ok('v2 tables markers/live_dots do not exist', oldGone.gone);
const anonFns = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map(r => r.proname);
const wantFns = ['community_suggested', 'create_post', 'decor_counts', 'delete_post', 'report_post', 'send_decor', 'send_mark', 'suggest_area', 'tag_mark', 'vote_post', 'zone_counts'];
ok('anon may execute exactly the 11 public RPCs (v11: + send_decor, decor_counts)', JSON.stringify(anonFns) === JSON.stringify(wantFns), anonFns.join(','));

await db.exec('set role anon');
const V = 'device-aaaa-1111', T = 'token-'.padEnd(40, 'x');
ok('anon cannot select votes', /permission denied/.test(await err('select * from votes')));
ok('anon cannot select reports', /permission denied/.test(await err('select * from reports')));
ok('anon cannot select marks', /permission denied/.test(await err('select * from marks')));
ok('anon cannot insert marks', /permission denied/.test(await err(`insert into marks(session_hash,lat,lng,h3_r8,token_hash) values ('a',42.98,-81.24,'882b1ad4a3fffff','b')`)));
ok('anon cannot update marks', /permission denied/.test(await err(`update marks set tags='{}'`)));
ok('anon cannot select suggestions', /permission denied/.test(await err('select * from suggestions')));
ok('anon cannot insert suggestions', /permission denied/.test(await err(`insert into suggestions(device_hash,h3_r8,lat,lng) values ('a','882b1ad4a3fffff',42.98,-81.24)`)));
ok('anon cannot read author_hash', /permission denied/.test(await err('select author_hash from posts')));
ok('anon cannot insert posts directly', /permission denied/.test(await err(`insert into posts(board,body,author_hash,token_hash) values ('fun','x','a','b')`)));
ok('anon cannot call internal helpers', /permission denied/.test(await err(`select _ltot_hash('x')`)));
ok('anon cannot call _ltot_cleanup_marks', /permission denied/.test(await err(`select _ltot_cleanup_marks()`)));

const post = (body, voter = V, extra = {}) => db.query(`select create_post($1,$2,$3,$4,$5,$6,$7) as id`,
  [extra.board || 'fun', extra.area ?? 'old-south-baker', extra.lat ?? null, extra.lng ?? null, body, voter, T]);
const p1 = (await post('Baker St was great!')).rows[0].id;
ok('create_post works', !!p1);
ok('create_post rejects links', /text:url/.test(await err(`select create_post('fun',null,null,null,'go to www.spam.com',$1,$2)`, [V, T])));
ok('create_post rejects phone numbers', /text:phone/.test(await err(`select create_post('fun',null,null,null,'call 519-555-1234',$1,$2)`, [V, T])));
ok('create_post rejects emails', /text:email/.test(await err(`select create_post('fun',null,null,null,'me@mail.com',$1,$2)`, [V, T])));
ok('create_post rejects > 140 chars', /text:tooLong/.test(await err(`select create_post('fun',null,null,null,$3,$1,$2)`, [V, T, 'x'.repeat(141)])));
ok('create_post rejects locations outside London', /outside/.test(await err(`select create_post('fun',null,43.65,-79.38,'hi',$1,$2)`, [V, T])));
ok('create_post rejects bad board', /invalid/.test(await err(`select create_post('nope',null,null,null,'hi',$1,$2)`, [V, T])));
ok('times like 5:30-8:30 and 2026-10-31 are allowed', !(await err(`select create_post('fun',null,null,null,'Busy 5:30-8:30 on 2026-10-31',$1,$2)`, ['device-b-2222', T])));
const loc = (await post('rough', 'device-c-3333', { lat: 42.966812, lng: -81.245533 })).rows[0].id;
const lr = await one('select lat, lng from posts where id=$1', [loc]);
ok('post location rounded to 3 decimals', lr.lat === 42.967 && lr.lng === -81.246, JSON.stringify(lr));
for (let i = 0; i < 3; i++) await post('more ' + i);
const fifth = await err(`select create_post('fun',null,null,null,'fifth',$1,$2)`, [V, T]);
const sixth = await err(`select create_post('fun',null,null,null,'sixth',$1,$2)`, [V, T]);
const other = await err(`select create_post('fun',null,null,null,'other phone',$1,$2)`, ['device-d-4444', T]);
ok('5 posts per device per hour, 6th rejected, other devices unaffected', fifth === null && /rate/.test(sixth) && other === null, `${fifth} / ${sixth} / ${other}`);

const v1 = (await one('select vote_post($1,$2) as n', [p1, 'voter-x-0001'])).n;
const v2 = (await one('select vote_post($1,$2) as n', [p1, 'voter-x-0001'])).n;
const v3 = (await one('select vote_post($1,$2) as n', [p1, 'voter-y-0002'])).n;
ok('one vote per device per post', v1 === 1 && v2 === -1 && v3 === 2, `${v1}, ${v2}, ${v3}`);
await one('select report_post($1,$2)', [p1, 'rep-aaaa-1']);
const dup = (await one('select report_post($1,$2) as n', [p1, 'rep-aaaa-1'])).n;
await one('select report_post($1,$2)', [p1, 'rep-bbbb-2']);
ok('duplicate report ignored, 2 reports still visible', dup === -1 && (await db.query('select id from posts where id=$1', [p1])).rows.length === 1);
await one('select report_post($1,$2)', [p1, 'rep-cccc-3']);
ok('3 reports hide the post from anon', (await db.query('select id from posts where id=$1', [p1])).rows.length === 0);
ok('cannot vote on a hidden post', /invalid/.test(await err('select vote_post($1,$2)', [p1, 'voter-z-0003'])));
ok('delete_post needs the token', /forbidden/.test(await err('select delete_post($1,$2)', [loc, 'wrong-token-xxxxxxxxx'])) && !(await err('select delete_post($1,$2)', [loc, T])));

// ---------------------------------------------------------------- marks → zones
// Three London neighbourhoods (fake but valid-looking H3 res-8 ids; PGlite has no h3-js).
const HP = { h: '882b1ad4a3fffff', lat: 43.010123, lng: -81.335678 };   // Hyde Park
const LB = { h: '882b1ad4a7fffff', lat: 42.905, lng: -81.300 };         // Lambeth
const AR = { h: '882b1ad4abfffff', lat: 43.020, lng: -81.170 };         // Argyle
const sess = (i) => (i.toString(16).padStart(2, '0')).repeat(16);       // 32 hex chars
const tok = (i) => `mark-token-${i}`.padEnd(32, 'z');
const mark = (i, z, tags = null) => db.query(`select send_mark($1,$2,$3,$4,$5,$6) as id`, [sess(i), z.lat, z.lng, z.h, tags, tok(i)]);
const zones = async (w) => (await db.query(`select * from zone_counts(${w === undefined ? '' : w})`)).rows;
const asRoot = async (sql, params) => { await db.exec('reset role'); try { return await db.query(sql, params); } finally { await db.exec('set role anon'); } };

// v7: the server window is Oct 31 3–11 PM Toronto OR the test days Oct 17 00:00 – Oct 21 00:00 Toronto.
const nowMs = Date.now();
const windowOpen = (nowMs >= Date.parse('2026-10-31T19:00:00Z') && nowMs < Date.parse('2026-11-01T03:00:00Z')) ||
                   (nowMs >= Date.parse('2026-10-17T04:00:00Z') && nowMs < Date.parse('2026-10-21T04:00:00Z'));
const liveNow = (await asRoot('select public._ltot_live_open() as v')).rows[0].v;
ok(`_ltot_live_open() is ${windowOpen} right now (Oct 31 night or test days Oct 17–20)`, liveNow === windowOpen, String(liveNow));
if (!windowOpen) ok('send_mark closed outside the windows (today)', /closed/.test(await err(`select send_mark($1,42.98,-81.24,$2,null,$3)`, [sess(99), HP.h, tok(99)])));
await db.exec('reset role');
await db.exec(`create or replace function public._ltot_live_open() returns boolean language sql as 'select true'`);   // pretend it is Halloween night
await db.exec('set role anon');
ok('send_mark rejects outside London (Toronto)', /outside/.test(await err(`select send_mark($1,43.65,-79.38,$2,null,$3)`, [sess(1), HP.h, tok(1)])));
ok('send_mark rejects bad session id', /invalid/.test(await err(`select send_mark('not hex!',42.98,-81.24,$1,null,$2)`, [HP.h, tok(1)])));
ok('send_mark rejects bad h3', /invalid/.test(await err(`select send_mark($1,42.98,-81.24,'garbage',null,$2)`, [sess(1), tok(1)])));
ok('send_mark rejects short token', /invalid/.test(await err(`select send_mark($1,42.98,-81.24,$2,null,'short')`, [sess(1), HP.h])));
ok("send_mark rejects unknown tag 'pizza'", /invalid/.test(await err(`select send_mark($1,42.98,-81.24,$2,array['candy','pizza'],$3)`, [sess(1), HP.h, tok(1)])));

const m1 = (await mark(1, HP, ['candy', 'candy', 'decor'])).rows[0].id;
ok('send_mark accepts a mark and returns its id', /^[0-9a-f-]{36}$/.test(m1), m1);
const r1 = (await asRoot('select tags, lat, lng from marks where id=$1', [m1])).rows[0];
ok('tags deduped, lat/lng rounded to 4 decimals', JSON.stringify(r1.tags) === '["candy","decor"]' && r1.lat === 43.0101 && r1.lng === -81.3357, JSON.stringify(r1));
const leak = (await asRoot(`select count(*)::int as n from marks m where position($1 in row_to_json(m)::text) > 0 or position($2 in row_to_json(m)::text) > 0`, [sess(1), tok(1)])).rows[0].n;
ok('raw session id and token not stored', leak === 0);

ok('same session, second mark within 5 min → rate', /rate/.test(await err(`select send_mark($1,$2,$3,$4,null,$5)`, [sess(1), LB.lat, LB.lng, LB.h, tok(1)])));
await asRoot(`update marks set created_at = now() - interval '6 minutes' where id=$1`, [m1]);
ok('after 6 min: same hex still → rate (30-min zone limit)', /rate/.test(await err(`select send_mark($1,$2,$3,$4,null,$5)`, [sess(1), HP.lat, HP.lng, HP.h, tok(1)])));
const mL1 = await err(`select send_mark($1,$2,$3,$4,null,$5)`, [sess(1), LB.lat, LB.lng, LB.h, tok(1)]);
ok('after 6 min: a different hex is accepted', mL1 === null, mL1 || '');

ok('tag_mark wrong token → forbidden', /forbidden/.test(await err(`select tag_mark($1,'wrong-token-wrong-token','crowded')`, [m1])));
ok('tag_mark unknown id → forbidden', /forbidden/.test(await err(`select tag_mark(gen_random_uuid(),$1,'crowded')`, [tok(1)])));
ok('tag_mark bad tag → invalid', /invalid/.test(await err(`select tag_mark($1,$2,'pizza')`, [m1, tok(1)])));
const t1 = (await one(`select tag_mark($1,$2,'crowded') as tags`, [m1, tok(1)])).tags;
const t2 = (await one(`select tag_mark($1,$2,'candy') as tags`, [m1, tok(1)])).tags;
ok('tag_mark adds a tag and is idempotent', JSON.stringify(t1) === '["candy","crowded","decor"]' && JSON.stringify(t2) === JSON.stringify(t1), JSON.stringify(t2));
await asRoot(`update marks set created_at = now() - interval '16 minutes' where id=$1`, [m1]);
ok('tag_mark after 15 min → closed', /closed/.test(await err(`select tag_mark($1,$2,'decor')`, [m1, tok(1)])));

await mark(2, HP, ['candy']);
ok('hex with 2 marks is not returned (3+ rule)', (await zones(45)).length === 0);
const m3 = (await mark(3, HP, ['candy'])).rows[0].id;
const zHP = (await zones(45)).find(z => z.h3_r8 === HP.h);
const m3at = (await asRoot('select created_at from marks where id=$1', [m3])).rows[0].created_at;
ok('3rd mark lights the zone: n=3, top_tag candy ×3', zHP && zHP.n === 3 && zHP.top_tag === 'candy' && zHP.top_tag_n === 3, JSON.stringify(zHP));
ok('first_lit_at = time of the 3rd mark', zHP && zHP.first_lit_at && zHP.first_lit_at.getTime() === m3at.getTime(), `${zHP?.first_lit_at?.toISOString()} vs ${m3at.toISOString()}`);
ok('zone_counts returns only h3_r8, n, top_tag, top_tag_n, first_lit_at', zHP && JSON.stringify(Object.keys(zHP).sort()) === '["first_lit_at","h3_r8","n","top_tag","top_tag_n"]', Object.keys(zHP || {}).join(','));

await mark(4, LB, ['decor']); await mark(5, LB, ['decor']);
await mark(6, AR); await mark(7, AR); await mark(8, AR);
const all3 = await zones(45);
const zLB = all3.find(z => z.h3_r8 === LB.h), zAR = all3.find(z => z.h3_r8 === AR.h);
ok('marks anywhere in London count (Hyde Park, Lambeth, Argyle)', all3.length === 3 && zLB?.n === 3 && zAR?.n === 3, all3.map(z => `${z.h3_r8}:${z.n}`).join(' '));
ok('top_tag per zone (Lambeth decor ×2, Argyle none → null)', zLB?.top_tag === 'decor' && zLB?.top_tag_n === 2 && zAR?.top_tag === null && zAR?.top_tag_n === null, `${JSON.stringify(zLB)} ${JSON.stringify(zAR)}`);
ok('default window (no argument) works', (await zones()).length === 3);

await asRoot(`update marks set created_at = now() - interval '50 minutes' where h3_r8=$1`, [AR.h]);
await asRoot(`update marks set created_at = now() - interval '70 minutes' where h3_r8=$1`, [LB.h]);
const ids = async (w) => (await zones(w)).map(z => z.h3_r8).sort().join(',');
const [w5, w30, w45, w60, w500] = [await ids(5), await ids(30), await ids(45), await ids(60), await ids(500)];
ok('marks older than the window are not counted: zone_counts(45) drops 50-min-old Argyle', w45 === HP.h, w45);
ok('…but zone_counts(60) still counts Argyle', w60 === [HP.h, AR.h].sort().join(','), w60);
ok('window clamped: zone_counts(5) behaves like 30 (16-min-old mark still counted)', w5 === w30 && w5 === HP.h, `${w5} | ${w30}`);
ok('window clamped: zone_counts(500) behaves like 60 (70-min-old Lambeth not counted)', w500 === w60, `${w500} | ${w60}`);

await asRoot(`update marks set created_at = now() - interval '121 minutes' where h3_r8=$1`, [AR.h]);
const before = (await asRoot('select count(*)::int as n from marks')).rows[0].n;
await zones(45);
const arLeft = (await asRoot('select count(*)::int as n from marks where h3_r8=$1', [AR.h])).rows[0].n;
const after = (await asRoot('select count(*)::int as n from marks')).rows[0].n;
ok('marks older than 2 hours are deleted by the next zone_counts call', arLeft === 0 && after === before - 3, `${before} → ${after}`);

// ---------------------------------------------------------------- neighbourhood suggestions
const SA = { h: '882b1ad4b3fffff', lat: 42.981234, lng: -81.251234 };
const SB = { h: '882b1ad4b7fffff', lat: 42.99, lng: -81.26 };
const SC = { h: '882b1ad4bbfffff', lat: 43.00, lng: -81.27 };
const SD = { h: '882b1ad4bffffff', lat: 43.01, lng: -81.28 };
const D1 = 'device-sugg-0001';
const suggest = (dev, z, reason = null) => err(`select suggest_area($1,$2,$3,$4,$5)`, [dev, z.h, z.lat, z.lng, reason]);
ok('suggest_area rejects short device id', /invalid/.test(await suggest('short', SA)));
ok('suggest_area rejects bad h3', /invalid/.test(await suggest(D1, { ...SA, h: 'nope' })));
ok('suggest_area rejects outside London', /outside/.test(await suggest(D1, { h: SA.h, lat: 43.65, lng: -79.38 })));
ok('suggest_area rejects links (www.x.com → text:url)', /text:url/.test(await suggest(D1, SA, 'see www.x.com')));
ok('suggest_area rejects phone numbers', /text:phone/.test(await suggest(D1, SA, 'call 519-555-1234')));
ok('suggest_area rejects > 80 chars (text:tooLong)', /text:tooLong/.test(await suggest(D1, SA, 'x'.repeat(81))));
ok('suggest_area accepts exactly 80 chars', (await suggest('device-sugg-0080', SD, 'y'.repeat(80))) === null);
ok('suggest_area accepts a suggestion', (await suggest(D1, SA, 'Lots of decorated houses')) === null);
ok('same device + same hex again → rate', /rate/.test(await suggest(D1, SA, 'again')));
ok('2nd and 3rd hex for the same device accepted', (await suggest(D1, SB)) === null && (await suggest(D1, SC)) === null);
ok('4th suggestion in 24 h → rate', /rate/.test(await suggest(D1, SD)));
await suggest('device-sugg-0002', SA);
ok('community_suggested hides a hex with 2 suggestions', !(await db.query('select * from community_suggested()')).rows.some(r => r.h3_r8 === SA.h));
await suggest('device-sugg-0003', { ...SA, lat: 42.981634 }, 'Great for little kids');
const cs = (await db.query('select * from community_suggested()')).rows;
const csA = cs.find(r => r.h3_r8 === SA.h);
ok('community_suggested shows it at 3 with n=3 and reasons (newest first)', cs.length === 1 && csA?.n === 3 && JSON.stringify(csA.reasons) === '["Great for little kids","Lots of decorated houses"]', JSON.stringify(csA));
ok('community_suggested: averaged centre, no device hash', Math.abs(csA?.lat - 42.9813) < 1e-9 && csA?.lng === -81.2512 && JSON.stringify(Object.keys(csA || {}).sort()) === '["h3_r8","lat","lng","n","reasons"]', JSON.stringify(csA));
await db.exec('reset role');

// ---------------------------------------------------------------- v11 decor marks ("Best decorations / 最佳装饰")
await db.exec('set role anon');
ok('anon cannot select decor_marks', /permission denied/.test(await err('select * from decor_marks')));
ok('anon cannot insert decor_marks', /permission denied/.test(await err(`insert into decor_marks(day_hash,day,lat,lng,h3_r8) values ('a',current_date,42.98,-81.24,'882b1ad4a3fffff')`)));
ok('anon cannot call _ltot_cleanup_decor / _ltot_decor_open', /permission denied/.test(await err('select _ltot_cleanup_decor()')) && /permission denied/.test(await err('select _ltot_decor_open()')));
const decorOpen = nowMs >= Date.parse('2026-10-17T04:00:00Z') && nowMs < Date.parse('2026-11-01T04:00:00Z');
const dOpen = (await asRoot('select public._ltot_decor_open() as v')).rows[0].v;
ok(`_ltot_decor_open() is ${decorOpen} right now (Oct 17 – Oct 31 Toronto)`, dOpen === decorOpen, String(dOpen));
const DA = { h: '882b1ad4b3fffff', lat: 42.971234, lng: -81.239876 }, DB = { h: '882b1ad4b7fffff', lat: 42.9935, lng: -81.2405 };
const dev = (i) => `decor-device-${i}`.padEnd(20, 'q');
const decor = (i, z, tags = null) => err(`select send_decor($1,$2,$3,$4,$5)`, [dev(i), z.lat, z.lng, z.h, tags]);
const dcounts = async () => (await db.query('select * from decor_counts()')).rows;
if (!decorOpen) ok('send_decor closed outside Oct 17 – Oct 31', /closed/.test(await decor(1, DA)));
else {
  ok('send_decor rejects outside London', /outside/.test(await err(`select send_decor($1,43.65,-79.38,$2,null)`, [dev(1), DA.h])));
  ok('send_decor rejects bad h3 / short device id', /invalid/.test(await err(`select send_decor($1,42.98,-81.24,'garbage',null)`, [dev(1)])) && /invalid/.test(await err(`select send_decor('short',42.98,-81.24,$1,null)`, [DA.h])));
  ok("send_decor rejects unknown tag 'candy' (decor tags only)", /invalid/.test(await decor(1, DA, ['spooky', 'candy'])));
  ok('send_decor accepts a decor mark', (await decor(1, DA, ['lights', 'lights'])) === null);
  ok('same phone, same hex, same day → rate', /rate/.test(await decor(1, DA)));
  ok('same phone, another hex → ok', (await decor(1, DB)) === null);
  const st = (await asRoot('select day_hash, lat, lng, tags::text as tags, day from decor_marks where h3_r8=$1', [DA.h])).rows[0];
  ok('stored: only a per-day hash (no device id), 4-decimal location, de-duplicated tags, Toronto day',
     st && !st.day_hash.includes('decor-device') && st.day_hash.length === 64 && st.lat === 42.9712 && st.lng === -81.2399 && st.tags === '{lights}', JSON.stringify(st));
  await decor(2, DA, ['spooky']);
  ok('decor_counts hides a hex with 2 decor marks', !(await dcounts()).some(r => r.h3_r8 === DA.h));
  await decor(3, DA, ['lights', 'spooky']);
  const dc = (await dcounts()).find(r => r.h3_r8 === DA.h);
  ok('decor_counts shows it at 3 with the top tag (lights 2 vs spooky 2 → alphabetical tie-break)', dc?.n === 3 && dc?.top_tag === 'lights' && dc?.top_tag_n === 2, JSON.stringify(dc));
  ok('decor_counts returns only h3_r8, n, top_tag, top_tag_n', JSON.stringify(Object.keys(dc || {}).sort()) === '["h3_r8","n","top_tag","top_tag_n"]');
  for (let k = 0; k < 10; k++) await err(`select send_decor($1,42.98,-81.24,$2,null)`, [dev(9), `882b1ad4c${k}fffff`.slice(0, 15)]);
  const eleventh = await err(`select send_decor($1,42.98,-81.24,'882b1ad4dffffff',null)`, [dev(9)]);
  const n9 = (await asRoot(`select count(*)::int as n from decor_marks where day_hash = encode(extensions.digest('decor:' || $1 || ':' || (now() at time zone 'America/Toronto')::date::text, 'sha256'), 'hex')`, [dev(9)])).rows[0].n;
  ok('10 decor marks per phone per day, the 11th → rate', n9 === 10 && /rate/.test(eleventh || ''), `${n9} stored, 11th=${eleventh}`);
  await asRoot(`update decor_marks set created_at = now() - interval '15 days' where h3_r8 = $1`, [DB.h]);
  await dcounts();
  ok('decor marks older than 14 days are deleted on the next decor_counts call', (await asRoot('select count(*)::int as n from decor_marks where h3_r8=$1', [DB.h])).rows[0].n === 0);
}
const purgeSrc = (await asRoot(`select prosrc from pg_proc where proname = '_ltot_cleanup_decor'`)).rows[0]?.prosrc || '';
ok('_ltot_cleanup_decor deletes everything from Nov 2, 2026 00:00 Toronto', /2026-11-02 00:00:00 America\/Toronto/.test(purgeSrc) && /14 days/.test(purgeSrc));
await db.exec('reset role');

// cleanup.sql runs
const cleanup = readFileSync(process.argv[3], 'utf8');
await db.exec(cleanup);
ok('cleanup.sql empties every table', (await one(`select (select count(*) from marks)+(select count(*) from decor_marks)+(select count(*) from suggestions)+(select count(*) from posts)+(select count(*) from votes)+(select count(*) from reports) as n`)).n == 0);
// The optional "drop everything" part (Step B) must name the right signatures.
const stepB = cleanup.split('-- Step B')[1].split('\n').filter(l => /^-- (drop|  )/.test(l)).map(l => l.slice(3)).join('\n');
const dropErr = await errx(stepB);
const left = (await one(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).n;
ok('cleanup.sql Step B (uncommented) removes every function and table', dropErr === null && left === 0 && (await one(`select to_regclass('public.marks') as t`)).t === null && (await one(`select to_regclass('public.decor_marks') as t`)).t === null, dropErr || `${left} functions left`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
