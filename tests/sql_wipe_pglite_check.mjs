// v16: checks supabase/v16_test_wipe.sql (smoke suggestions from two different random smoke devices must both go) in PGlite on schema.sql + v11/v14 tables, seeded with test and real rows.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.argv[2];
const strip = (s) => s.replace(/notify pgrst[^;]*;/g, '');
const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); };
await db.exec(`create schema if not exists extensions; create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated; grant usage on schema extensions to anon, authenticated;`);
await db.exec(strip(readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8')));
const wipe = readFileSync(join(ROOT, 'supabase/v16_test_wipe.sql'), 'utf8');
const T = "timestamptz '2026-10-18 20:00 America/Toronto'", R = "timestamptz '2026-10-31 19:00 America/Toronto'";
await db.exec(`
 insert into public.marks(session_hash,lat,lng,h3_r8,token_hash,created_at) values
   ('a',42.98,-81.24,'882b1ad4a3fffff','t',${T}),('b',42.98,-81.24,'882b1ad4a3fffff','t',${T}),('c',42.98,-81.24,'882b1ad4a3fffff','t',${R});
 insert into public.suggestions(device_hash,h3_r8,lat,lng,reason,created_at) values
   (public._ltot_hash('device:smoke-test-6e08607e528863b9'),'6bedd4154d1f132',42.98,-81.24,'Smoke test',${T}),
   (public._ltot_hash('device:smoke-test-a1b2c3d4e5f60718'),'0f3c9a2b7d1e455',42.98,-81.24,'Smoke test',${T}),
   ('realphone','882b1ad4a1fffff',42.97,-81.25,'Lots of kids here',${T});
 insert into public.posts(id,board,body,author_hash,token_hash,created_at) values
   ('00000000-0000-0000-0000-000000000001','fun','test post','x','t',${T}),('00000000-0000-0000-0000-000000000002','fun','night post','y','t',${R});
 insert into public.votes(post_id,voter) values ('00000000-0000-0000-0000-000000000001','v1'),('00000000-0000-0000-0000-000000000002','v2');
 insert into public.reports(post_id,reporter) values ('00000000-0000-0000-0000-000000000001','r1');
 insert into public.decor_marks(day_hash,day,lat,lng,h3_r8,created_at) values ('d1','2026-10-18',42.98,-81.24,'882b1ad4a3fffff',${T});
 insert into public.fav_pins(device_hash,lat,lng,tag,token_hash,created_at) values ('f1',42.98,-81.24,'candy','t',${T});`);
const r1 = (await db.query(wipe)).rows[0];
ok('first run: counts', r1.marks_deleted === 2 && r1.smoke_suggestion_deleted === 2 && r1.posts_deleted === 1 && r1.votes_deleted_with_posts === 1
  && r1.reports_deleted_with_posts === 1 && r1.suggestions_kept === 1 && r1.decorations_kept === 1 && r1.past_favourites_kept === 1, JSON.stringify(r1));
ok('status row keeps Chinese intact', r1.status.includes('测试数据已清除'));
const left = (await db.query(`select (select count(*) from public.marks)::int m,(select count(*) from public.suggestions)::int s,
  (select count(*) from public.posts)::int p,(select count(*) from public.votes)::int v,(select count(*) from public.reports)::int r,
  (select count(*) from public.decor_marks)::int d,(select count(*) from public.fav_pins)::int f,
  (select reason from public.suggestions limit 1) reason`)).rows[0];
ok('after: Oct 31 mark/post/vote, real suggestion, decoration, favourite remain', left.m===1&&left.s===1&&left.p===1&&left.v===1&&left.r===0&&left.d===1&&left.f===1&&left.reason==='Lots of kids here', JSON.stringify(left));
const r2 = (await db.query(wipe)).rows[0];
ok('second run deletes nothing', r2.marks_deleted===0&&r2.smoke_suggestion_deleted===0&&r2.posts_deleted===0, JSON.stringify(r2));
console.log(`${pass}/${pass+fail} passed`); process.exit(fail ? 1 : 0);
