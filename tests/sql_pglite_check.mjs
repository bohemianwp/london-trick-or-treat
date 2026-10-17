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
const exp = await one(`select column_default, (select '2026-11-01 06:00:00 America/Toronto'::timestamptz at time zone 'UTC')::text as utc from information_schema.columns where table_name='markers' and column_name='expires_at'`);
ok('marker expiry = Nov 1 11:00 UTC (6 AM Toronto, after DST ends)', exp.utc === '2026-11-01 11:00:00', exp.utc);

await db.exec('set role anon');
const V = 'device-aaaa-1111', T = 'token-'.padEnd(40, 'x');
ok('anon cannot select votes', /permission denied/.test(await err('select * from votes')));
ok('anon cannot select reports', /permission denied/.test(await err('select * from reports')));
ok('anon cannot select live_dots', /permission denied/.test(await err('select * from live_dots')));
ok('anon cannot read edit_token_hash', /permission denied/.test(await err('select edit_token_hash from markers')));
ok('anon cannot read author_hash', /permission denied/.test(await err('select author_hash from posts')));
ok('anon cannot insert posts directly', /permission denied/.test(await err(`insert into posts(board,body,author_hash,token_hash) values ('fun','x','a','b')`)));
ok('anon cannot update markers directly', /permission denied/.test(await err(`update markers set status='out'`)));
ok('anon cannot call internal helpers', /permission denied/.test(await err(`select _ltot_hash('x')`)));

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

const mk = (await one(`select upsert_marker(null,42.9668,-81.2455,array['candy','teal','teal'],'giving','Nut-free treats.','17:30','20:30',$1,'dev-1') as id`, [T])).id;
ok('upsert_marker creates a marker', !!mk);
const row = await one('select types, status, start_time::text from markers where id=$1', [mk]);
ok('anon can read safe marker columns; duplicate types removed', JSON.stringify(row.types) === '["candy","teal"]' && row.start_time === '17:30:00', JSON.stringify(row));
ok('status change with wrong token → forbidden', /forbidden/.test(await err(`select set_marker_status($1,'nope-nope-nope-nope','out')`, [mk])));
ok('status change with right token', !(await err(`select set_marker_status($1,$2,'out')`, [mk, T])) && (await one('select status from markers where id=$1', [mk])).status === 'out');
ok('edit with wrong token → forbidden', /forbidden/.test(await err(`select upsert_marker($1,42.9668,-81.2455,array['candy'],'giving','x',null,null,'other-token-123456789',null)`, [mk])));
ok('marker note rejects phone numbers', /text:phone/.test(await err(`select upsert_marker(null,42.9668,-81.2455,array['candy'],'giving','call 5195551234',null,null,$1,'dev-2')`, [T])));
ok('marker outside London rejected', /outside/.test(await err(`select upsert_marker(null,43.65,-79.38,array['candy'],'giving',null,null,null,$1,'dev-2')`, [T])));
ok('marker with unknown type rejected', /invalid/.test(await err(`select upsert_marker(null,42.97,-81.24,array['bogus'],'giving',null,null,null,$1,'dev-2')`, [T])));
await one(`select upsert_marker(null,42.97,-81.24,array['candy'],'giving',null,null,null,$1,'dev-1')`, [T + '2']);
await one(`select upsert_marker(null,42.97,-81.24,array['candy'],'giving',null,null,null,$1,'dev-1')`, [T + '3']);
ok('3 markers per device', /rate/.test(await err(`select upsert_marker(null,42.97,-81.24,array['candy'],'giving',null,null,null,$1,'dev-1')`, [T + '4'])));

const S = 'ab'.repeat(16);
ok('send_dot closed outside Oct 31 3–11 PM (today)', /closed/.test(await err(`select send_dot($1,42.98,-81.24,null)`, [S])));
await db.exec('reset role');
await db.exec(`create or replace function public._ltot_live_open() returns boolean language sql as 'select true'`);   // pretend it is Halloween night
await db.exec('set role anon');
ok('send_dot rejects outside London', /outside/.test(await err(`select send_dot($1,43.65,-79.38,null)`, [S])));
ok('send_dot rejects bad session id', /invalid/.test(await err(`select send_dot('not hex!',42.98,-81.24,null)`)));
const H = '882b1ad4a3fffff';
ok('send_dot accepts a dot', (await one(`select send_dot($1,42.981234,-81.245678,$2) as ok`, [S, H])).ok === true);
ok('second dot within 30 s ignored', (await one(`select send_dot($1,42.98,-81.24,$2) as ok`, [S, H])).ok === false);
const dots = (await db.query('select * from live_dots_recent()')).rows;
ok('live_dots_recent: rounded to 4 decimals, no raw session id', dots.length === 1 && dots[0].lat === 42.9812 && dots[0].lng === -81.2457 && !JSON.stringify(dots).includes(S), JSON.stringify(dots[0]));
ok('hex counts hidden below 3', (await db.query('select * from live_hex_counts(20)')).rows.length === 0);
await one(`select send_dot($1,42.98,-81.24,$2)`, ['cd'.repeat(16), H]);
await one(`select send_dot($1,42.98,-81.24,'garbage')`, ['ee'.repeat(16)]);
ok('bad h3 value stored as null (not counted)', (await db.query('select * from live_hex_counts(20)')).rows.length === 0);
await one(`select send_dot($1,42.98,-81.24,$2)`, ['ef'.repeat(16), H]);
const hc = (await db.query('select * from live_hex_counts(20)')).rows;
ok('hex counts shown at 3', hc.length === 1 && hc[0].h3_r8 === H && hc[0].n === 3, JSON.stringify(hc));
await one('select remove_dot($1)', [S]);
ok('remove_dot deletes my dot', (await db.query('select * from live_dots_recent()')).rows.length === 3);
await db.exec('reset role');
await db.exec(`update live_dots set updated_at = now() - interval '31 minutes'`);
await db.exec('set role anon');
ok('dots older than 30 min are deleted on the next call', (await db.query('select * from live_dots_recent()')).rows.length === 0);
await db.exec('reset role');
ok('…and really gone from the table', (await one('select count(*)::int as n from live_dots')).n === 0);

// cleanup.sql runs
const cleanup = readFileSync(process.argv[3], 'utf8');
await db.exec(cleanup);
ok('cleanup.sql empties every table', (await one(`select (select count(*) from markers)+(select count(*) from posts)+(select count(*) from votes)+(select count(*) from reports)+(select count(*) from live_dots) as n`)).n == 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
