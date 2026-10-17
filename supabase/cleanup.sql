-- =====================================================================================
-- London Trick-or-Treat Map — cleanup after Halloween (SPEC §6: delete everything after Nov 2, 2026)
-- Supabase → SQL Editor → New query → paste → Run.
-- ⚠️ This permanently deletes all markers, posts, votes, reports and live dots. There is no undo.
-- =====================================================================================

-- Step A (default): delete all data, keep the empty tables and functions (handy if you reuse it next year).
begin;
delete from public.live_dots;
delete from public.reports;
delete from public.votes;
delete from public.posts;
delete from public.markers;
commit;

-- Check: every count should be 0.
select 'markers' as t, count(*) from public.markers
union all select 'posts', count(*) from public.posts
union all select 'votes', count(*) from public.votes
union all select 'reports', count(*) from public.reports
union all select 'live_dots', count(*) from public.live_dots;

-- Step B (optional): remove everything this project created. Uncomment to run.
-- select cron.unschedule('ltot-cleanup');   -- only if you scheduled it
-- drop function if exists
--   public.upsert_marker(uuid, double precision, double precision, text[], text, text, time, time, text, text),
--   public.set_marker_status(uuid, text, text), public.delete_marker(uuid, text),
--   public.create_post(text, text, double precision, double precision, text, text, text),
--   public.vote_post(uuid, text), public.report_post(uuid, text), public.delete_post(uuid, text),
--   public.send_dot(text, double precision, double precision, text), public.remove_dot(text),
--   public.live_dots_recent(), public.live_hex_counts(int),
--   public._ltot_hash(text), public._ltot_in_box(double precision, double precision), public._ltot_live_open(),
--   public._ltot_check_text(text, boolean), public._ltot_cleanup_dots();
-- drop table if exists public.live_dots, public.reports, public.votes, public.posts, public.markers;

-- Or simply pause/delete the whole project: Project Settings → General → Pause project / Delete project.
