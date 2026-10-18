// v15.7: tests supabase/v156_antiabuse.sql in PGlite (real Postgres in WebAssembly, in memory).
// It first loads the schema as it is live today (the old one, passed as argv[2]), shows the gaps, then runs the
// v156 file on top (twice: it must be idempotent) and attacks it as the `anon` role.
//   cd /tmp/ltot-sqlcheck && cp "<project>/tests/sql_antiabuse_pglite_check.mjs" . &&
//   node sql_antiabuse_pglite_check.mjs <old schema.sql> "<project>/supabase/v156_antiabuse.sql"
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
const oldSchema = readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^;]*;/g, '');
const fix = readFileSync(process.argv[3], 'utf8').replace(/notify pgrst[^;]*;/g, '');
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
async function err(sql, params) { try { await db.query(sql, params); return null; } catch (e) { return e.message; } }
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
await db.exec(`create schema if not exists extensions;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated; grant usage on schema extensions to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;`);
await db.exec(oldSchema);
ok('old (live) schema loads', true);

const HX = ['882b1ad4a3fffff', '882b1ad4a7fffff', '882b1ad4abfffff'];
// Seed marks directly (as the owner): hex 0 = 3 marks from 2 sessions, hex 1 = 3 marks from 3 sessions, hex 2 = 2 marks.
async function seed() {
  await db.exec('reset role; delete from public.marks;');
  const rows = [[HX[0], 's1', 40], [HX[0], 's1', 10], [HX[0], 's2', 5], [HX[1], 'a', 30], [HX[1], 'b', 20], [HX[1], 'c', 2], [HX[2], 'x', 3], [HX[2], 'y', 1]];
  for (const [h, s, mins] of rows) await db.query(`insert into public.marks (session_hash, lat, lng, h3_r8, token_hash, created_at)
      values (encode(extensions.digest($1, 'sha256'), 'hex'), 42.98, -81.24, $2, 'x', now() - make_interval(mins => $3))`, [s, h, mins]);
}
const lit = async () => { await db.exec('set role anon'); const r = (await db.query('select h3_r8, n from zone_counts(45) order by h3_r8')).rows; await db.exec('reset role'); return r; };
await seed();
let z = await lit();
ok('BEFORE: 3 marks from only 2 sessions light a zone (the gap)', z.some(r => r.h3_r8 === HX[0]), JSON.stringify(z));

// Fav pin + post by device A (anon), then the gaps: A can like its own pin and vote its own post.
await db.exec('set role anon');
const A = 'device-aaaa-1111', B = 'device-bbbb-2222', T = 'token-'.padEnd(40, 'x');
const pin = (await one(`select fav_create($1, 42.9668, -81.2455, 'festive', null, $2) as r`, [A, T])).r.id;
const post = (await one(`select create_post('fun', null, null, null, 'Great street', $1, $2) as id`, [A, T])).id;
ok('BEFORE: a phone can 👍 its own pin (the gap)', (await one(`select fav_react($1, $2, 'like') as r`, [A, pin])).r.added === true);
ok('BEFORE: a phone can vote its own post (the gap)', (await one(`select vote_post($1, $2) as n`, [post, A])).n === 1);
await db.exec('reset role');

// Apply the fix twice.
const errx = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
const e1 = await errx(fix), e2 = await errx(fix);
ok('v156_antiabuse.sql runs without errors', e1 === null, e1 || '');
ok('v156_antiabuse.sql can run a second time', e2 === null, e2 || '');
const st = (await db.query(fix.slice(fix.lastIndexOf("select 'v15.6")))).rows[0];
ok('check line: "v15.6 anti-abuse ready", 3 changed functions, anon can run', st.status === 'v15.6 anti-abuse ready' && Number(st.changed_functions) === 3 && st.anon_can_run === true, JSON.stringify(st));
const anonFns = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)).rows.map(r => r.proname);
ok('anon may still execute exactly the 18 public RPCs', anonFns.length === 18 && anonFns.includes('zone_counts') && anonFns.includes('fav_react') && anonFns.includes('vote_post'), anonFns.join(','));
ok('anon still cannot read marks directly', /permission denied/.test(await (async () => { await db.exec('set role anon'); const m = await err('select * from marks'); await db.exec('reset role'); return m; })()));

await seed();
z = await lit();
ok('AFTER: 3 marks from 2 sessions do NOT light a zone', !z.some(r => r.h3_r8 === HX[0]), JSON.stringify(z));
ok('AFTER: 3 marks from 3 sessions still light a zone, n = 3', z.some(r => r.h3_r8 === HX[1] && r.n === 3));
ok('AFTER: 2 marks never light a zone', !z.some(r => r.h3_r8 === HX[2]));
await db.exec(`reset role; insert into public.marks (session_hash, lat, lng, h3_r8, token_hash, created_at)
  values (encode(extensions.digest('s3', 'sha256'), 'hex'), 42.98, -81.24, '${HX[0]}', 'x', now() - interval '1 minute')`);
z = await lit();
ok('AFTER: a 3rd session lights it; n counts all 4 marks', z.some(r => r.h3_r8 === HX[0] && r.n === 4), JSON.stringify(z));
const fl = (await db.query(`select first_lit_at from zone_counts(45) where h3_r8 = $1`, [HX[1]])).rows[0];
ok('first_lit_at still returned', fl && fl.first_lit_at instanceof Date);

await db.exec('set role anon');
const pin2 = (await one(`select fav_create($1, 42.9700, -81.2500, 'candy', null, $2) as r`, [A, T])).r.id;
ok('AFTER: 👍 on your own pin raises "own"', /^own/.test(await err(`select fav_react($1, $2, 'like')`, [A, pin2]) || ''));
ok('AFTER: ❤️ on your own pin raises "own"', /^own/.test(await err(`select fav_react($1, $2, 'heart')`, [A, pin2]) || ''));
const rB = (await one(`select fav_react($1, $2, 'like') as r`, [B, pin2])).r;
ok('AFTER: another phone can still 👍 it (likes = 1)', rB.added === true && rB.likes === 1, JSON.stringify(rB));
ok('AFTER: the same other phone again = not added', (await one(`select fav_react($1, $2, 'like') as r`, [B, pin2])).r.added === false);
const fl2 = (await db.query(`select families, likes from fav_list($1) where id = $2`, [B, pin2])).rows[0];
ok('AFTER: fav_list still works', fl2 && fl2.likes === 1);
const post2 = (await one(`select create_post('fun', null, null, null, 'Nice lights', $1, $2) as id`, [A, T])).id;
ok('AFTER: voting your own post raises "own"', /^own/.test(await err(`select vote_post($1, $2)`, [post2, A]) || ''));
ok('AFTER: another phone can vote it (1)', (await one(`select vote_post($1, $2) as n`, [post2, B])).n === 1);
ok('AFTER: the same phone again = minus count (already voted)', (await one(`select vote_post($1, $2) as n`, [post2, B])).n === -1);
ok('AFTER: send_mark still works for anon', !!(await one(`select send_mark($1, 42.98, -81.24, $2, null, $3) as id`, ['ab'.repeat(16), HX[2], T])).id);
ok('AFTER: same session again within 5 min is still rate-limited', /^rate/.test(await err(`select send_mark($1, 42.98, -81.24, $2, null, $3)`, ['ab'.repeat(16), HX[1], T]) || ''));
await db.exec('reset role');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
