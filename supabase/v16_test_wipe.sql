-- =====================================================================================
-- London Trick-or-Treat Map: v16 test-day wipe (Oct 21, 2026) · 测试日结束，清掉测试数据
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again (the second run deletes 0 rows).
--
-- DELETES (test data only):
--   • fun-street marks made before Oct 21, 2026 00:00 Toronto (test-day marks; most already expired after 2 h)
--   • every smoke-test suggestion (reason = 'Smoke test') that anon can't delete (replaces v14_smoke_cleanup).
--     Matches on reason only: each smoke run uses a new random device ('smoke-test-<random>'), so a device_hash
--     filter would only catch one run.
--   • board posts made before Oct 21 (their votes and reports go with them via ON DELETE CASCADE)
-- KEEPS (real content people shared):
--   • decorations (decor_marks), past favourites (fav_pins + replies/reactions/reports), real suggestions
-- Changes no tables, functions or grants. Replaces the commented "AFTER the test" block in v7_update.sql,
-- which also wiped ALL suggestions; real suggestions are now kept.
-- =====================================================================================

with
  cutoff as (select timestamptz '2026-10-21 00:00:00 America/Toronto' as t),
  before as (
    select (select count(*) from public.votes   v join public.posts p on p.id = v.post_id, cutoff where p.created_at < cutoff.t) as votes_n,
           (select count(*) from public.reports r join public.posts p on p.id = r.post_id, cutoff where p.created_at < cutoff.t) as reports_n,
           (select count(*) from public.suggestions) as sugg_total,
           (select count(*) from public.decor_marks) as decor_n,
           (select count(*) from public.fav_pins) as fav_n
  ),
  m as (delete from public.marks where created_at < (select t from cutoff) returning 1),
  s as (delete from public.suggestions
         where reason = 'Smoke test'
        returning 1),
  p as (delete from public.posts where created_at < (select t from cutoff) returning 1)
select 'v16 test wipe done · 测试数据已清除' as status,
       (select count(*) from m)::int as marks_deleted,
       (select count(*) from s)::int as smoke_suggestion_deleted,
       (select count(*) from p)::int as posts_deleted,
       before.votes_n::int   as votes_deleted_with_posts,
       before.reports_n::int as reports_deleted_with_posts,
       (before.sugg_total - (select count(*) from s))::int as suggestions_kept,
       before.decor_n::int as decorations_kept,
       before.fav_n::int   as past_favourites_kept
from before;
