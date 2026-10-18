// v15.5: checks supabase/v155_usage_stats.sql in PGlite (real Postgres in WebAssembly) as the `anon` role, then runs
// tools/usage_report.mjs end-to-end against a tiny local stand-in for the Supabase RPC endpoint.
// Uses a throw-away TEST token (the real token hash in the SQL is swapped for the test token's hash).
//   mkdir -p /tmp/ltot-sqlcheck && cd /tmp/ltot-sqlcheck && npm install @electric-sql/pglite@0.3
//   cp "<project>/tests/sql_usage_pglite_check.mjs" . && node sql_usage_pglite_check.mjs "<project>"
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ROOT = process.argv[2];
const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8').replace(/notify pgrst[^;]*;/g, '');
const v155raw = readFileSync(join(ROOT, 'supabase/v155_usage_stats.sql'), 'utf8');
const TOKEN = randomBytes(32).toString('hex');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const realHash = (v155raw.match(/values \(1, '([0-9a-f]{64})'\)/) || [])[1];
const v155 = v155raw.replace(realHash, sha(TOKEN)).replace(/notify pgrst[^;]*;/g, '');
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const err = async (sql, p) => { try { await db.query(sql, p); return null; } catch (e) { return e.message; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
ok('the SQL file holds one 64-hex token hash and no plain 64-hex token elsewhere', !!realHash && (v155raw.match(/[0-9a-f]{64}/g) || []).length === 1);

await db.exec(`create schema if not exists extensions;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated; grant usage on schema extensions to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;`);
await db.exec(schema);
let e = null; try { await db.exec(v155); } catch (x) { e = x.message; }
ok('v155_usage_stats.sql runs on top of schema.sql', e === null, e || '');
e = null; try { await db.exec(v155); } catch (x) { e = x.message; }
ok('…and can run a second time (idempotent)', e === null, e || '');
const chk = await one(`select (select count(*) from private.stats_token)::int as n,
  has_function_privilege('anon','public.usage_stats(text, timestamptz)','execute') as anon,
  has_function_privilege('authenticated','public.usage_stats(text, timestamptz)','execute') as auth`);
ok('one token row; anon may execute usage_stats; authenticated may not', chk.n === 1 && chk.anon && !chk.auth, JSON.stringify(chk));

// Seed (as the table owner): known counts, fixed times.
const H = (s) => sha(s);
await db.exec(`
  insert into public.marks(session_hash,lat,lng,h3_r8,token_hash,created_at) values
    ('${H('s1')}',42.98,-81.24,'882b1ad4a3fffff','t', now() - interval '1 hour'),
    ('${H('s1')}',42.98,-81.24,'882b1ad4a3fffff','t', now() - interval '50 minutes'),
    ('${H('s2')}',42.97,-81.25,'882b1ad4a1fffff','t', now() - interval '40 minutes'),
    ('${H('s3')}',42.97,-81.25,'882b1ad4a1fffff','t', timestamptz '2026-10-31 19:00:00 America/Toronto');
  insert into public.decor_marks(day_hash,day,lat,lng,h3_r8,created_at) values
    ('${H('d1')}','2026-10-18',42.98,-81.24,'882b1ad4a3fffff', now() - interval '2 hours'),
    ('${H('d2')}','2026-10-18',42.98,-81.24,'882b1ad4a5fffff', now() - interval '3 hours'),
    ('${H('d1')}','2026-10-10',42.98,-81.24,'882b1ad4a5fffff', now() - interval '8 days');
  insert into public.fav_pins(id,device_hash,lat,lng,tag,body,token_hash,created_at) values
    ('00000000-0000-0000-0000-000000000001','${H('f1')}',42.96712,-81.24491,'festive','Best street',  't', now() - interval '5 hours'),
    ('00000000-0000-0000-0000-000000000002','${H('f2')}',42.99001,-81.20002,'candy',null,'t', now() - interval '3 days');
  insert into public.fav_reactions(pin_id,device_hash,kind,created_at) values
    ('00000000-0000-0000-0000-000000000001','${H('f2')}','like', now() - interval '1 hour'),
    ('00000000-0000-0000-0000-000000000001','${H('f2')}','heart', now() - interval '1 hour'),
    ('00000000-0000-0000-0000-000000000001','${H('f3')}','like', now() - interval '30 minutes');
  insert into public.fav_replies(pin_id,device_hash,body,token_hash,created_at) values
    ('00000000-0000-0000-0000-000000000001','${H('f3')}','So true!','t', now() - interval '20 minutes');
  insert into public.fav_reports(target,kind,device_hash,created_at) values
    ('00000000-0000-0000-0000-000000000002','pin','${H('f4')}', now() - interval '10 minutes');
  insert into public.posts(board,body,author_hash,token_hash,created_at) values ('fun','hello','${H('a1')}','t', now() - interval '6 hours');
  insert into public.suggestions(device_hash,h3_r8,lat,lng,created_at) values ('${H('g1')}','882b1ad4a3fffff',42.98,-81.24, now() - interval '7 hours');
`);

await db.exec('set role anon');
ok('anon cannot read private.stats_token', /permission denied/.test(await err('select * from private.stats_token') || ''));
ok('anon cannot insert a token of its own', /permission denied/.test(await err(`insert into private.stats_token(id,token_hash) values (1,'${'0'.repeat(64)}') on conflict (id) do update set token_hash=excluded.token_hash`) || ''));
ok('wrong token → forbidden', /forbidden/.test(await err('select public.usage_stats($1)', [randomBytes(32).toString('hex')]) || ''));
ok('missing / short token → forbidden', /forbidden/.test(await err('select public.usage_stats(null)') || '') && /forbidden/.test(await err('select public.usage_stats($1)', ['short']) || ''));
ok('the token hash itself does not work as a token', /forbidden/.test(await err('select public.usage_stats($1)', [sha(TOKEN)]) || ''));
const s = (await one('select public.usage_stats($1) as s', [TOKEN])).s;
ok('right token → stats (default window: last 24 h)', !!s && s.tz === 'America/Toronto');
// (the seeded Oct 31 row lies in the future today, so it is inside every window)
ok('marks: 4 = 3 on test days + 1 in the Oct 31 3–11 PM window, from 3 sessions', s.marks.total === 4 && s.marks.test === 3 && s.marks.real === 1 && s.marks.sessions === 3, JSON.stringify(s.marks));
ok('decorations: 2 marks from 2 phone-days in 24 h (8-day-old one excluded)', s.decorations.marks === 2 && s.decorations.phone_days === 2, JSON.stringify(s.decorations));
ok('past favourites: 1 pin, 2 👍, 1 ❤️, 1 reply, 1 report, 4 phones', s.past_favourites.pins === 1 && s.past_favourites.likes === 2 && s.past_favourites.hearts === 1 && s.past_favourites.replies === 1 && s.past_favourites.reports === 1 && s.past_favourites.phones === 4, JSON.stringify(s.past_favourites));
ok('board 1 post / 1 posting phone; suggestions 1 / 1 phone', s.board.posts === 1 && s.board.posting_phones === 1 && s.suggestions.total === 1 && s.suggestions.phones === 1);
const hourSum = s.by_hour.reduce((a, h) => a + h.n, 0);
ok('by_hour (Toronto) adds up to every action in the window (4+2+1+3+1+1+1+1 = 14)', hourSum === 14 && s.by_hour.every((h) => /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(h.hour)), String(hourSum));
ok('top_cells: H3 ids only, most active first (882b1ad4a3fffff: 2 marks + 1 decor)', s.top_cells.length === 3 && s.top_cells[0].cell === '882b1ad4a3fffff' && s.top_cells[0].n === 3, JSON.stringify(s.top_cells));
ok('top_fav_spots: rounded to 3 decimals (≈100 m), 1 pin + 3 reactions + 1 reply = 5', s.top_fav_spots.length === 1 && s.top_fav_spots[0].lat === 42.967 && s.top_fav_spots[0].lng === -81.245 && s.top_fav_spots[0].n === 5, JSON.stringify(s.top_fav_spots));
const js = JSON.stringify(s);
ok('the result has no hashes, no tokens and no free text', !/[0-9a-f]{40,}/.test(js) && !/Best street|So true|hello/.test(js));
ok('practice + language are labelled "not stored"', /not stored/.test(s.marks.practice) && /not stored/.test(s.language));
const s2 = (await one(`select public.usage_stats($1, timestamptz '2026-10-01 00:00:00 America/Toronto') as s`, [TOKEN])).s;
ok('p_since widens the window: the 8-day-old decoration and 3-day-old pin are included', s2.decorations.marks === 3 && s2.past_favourites.pins === 2, JSON.stringify([s2.marks, s2.decorations.marks, s2.past_favourites.pins]));
ok('p_since in the future → invalid', /invalid/.test(await err(`select public.usage_stats($1, now() + interval '1 day')`, [TOKEN]) || ''));
await db.exec('reset role');

// End-to-end: tools/usage_report.mjs against a local stand-in for POST /rest/v1/rpc/usage_stats (runs as anon).
const srv = createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', async () => {
    try {
      if (req.method !== 'POST' || req.url !== '/rest/v1/rpc/usage_stats' || req.headers.apikey !== 'test-anon') throw new Error('bad request');
      const a = JSON.parse(b); await db.exec('set role anon');
      const r = await db.query('select public.usage_stats($1, $2::timestamptz) as s', [a.p_token, a.p_since]);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.rows[0].s));
    } catch (x) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: x.message })); }
    finally { await db.exec('reset role').catch(() => {}); }
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const dir = mkdtempSync(join(tmpdir(), 'ltot-usage-'));
const tf = join(dir, 'token'); writeFileSync(tf, TOKEN); chmodSync(tf, 0o600);
const bad = join(dir, 'bad'); writeFileSync(bad, randomBytes(32).toString('hex')); chmodSync(bad, 0o600);
const run = (file, arg) => new Promise((r) => execFile('node', [join(ROOT, 'tools/usage_report.mjs'), ...(arg ? [arg] : [])], {
  env: { ...process.env, LTOT_STATS_TOKEN_FILE: file, LTOT_SUPABASE_URL: `http://127.0.0.1:${srv.address().port}`, LTOT_SUPABASE_ANON_KEY: 'test-anon' } },
  (er, out, se) => r({ code: er ? er.code : 0, out, se })));
const r1 = await run(tf);
ok('usage_report.mjs prints the summary + JSON (exit 0)', r1.code === 0 && /^Usage report · /.test(r1.out) && /Past favourites: 1 pins, 2 👍, 1 ❤️, 1 replies/.test(r1.out) && /```json/.test(r1.out), (r1.se || r1.out).slice(0, 200));
ok('…and never prints the token', !r1.out.includes(TOKEN) && !r1.se.includes(TOKEN));
const r2 = await run(tf, '2026-10-01');
ok('usage_report.mjs 2026-10-01 widens the window (3 decorations, 2 pins)', r2.code === 0 && /Decorations: 3 shared/.test(r2.out) && /Past favourites: 2 pins/.test(r2.out), r2.out.split('\n').slice(1,3).join(' | '));
const r3 = await run(bad);
ok('usage_report.mjs with a wrong token: exit 1, "forbidden" message', r3.code === 1 && /forbidden/.test(r3.se), r3.se.slice(0, 160));
srv.close();
if (process.env.SHOW_REPORT) console.log('\n' + r1.out);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
