-- =====================================================================================
-- London Trick-or-Treat Map — cleanup after Halloween (SPEC §6: delete everything after Nov 2, 2026)
-- Supabase → SQL Editor → New query → paste → Run.
-- ⚠️ This permanently deletes all marks, suggestions, posts, votes and reports. There is no undo.
-- =====================================================================================

-- Step A (default): delete all data, keep the empty tables and functions (handy if you reuse it next year).
begin;
delete from public.marks;
delete from public.suggestions;
delete from public.reports;
delete from public.votes;
delete from public.posts;
commit;

-- Check: every count should be 0.
select 'marks' as t, count(*) from public.marks
union all select 'suggestions', count(*) from public.suggestions
union all select 'posts', count(*) from public.posts
union all select 'votes', count(*) from public.votes
union all select 'reports', count(*) from public.reports;

-- Step B (optional): remove everything this project created. Uncomment to run.
-- select cron.unschedule('ltot-cleanup');   -- only if you scheduled it
-- drop function if exists
--   public.create_post(text, text, double precision, double precision, text, text, text),
--   public.vote_post(uuid, text), public.report_post(uuid, text), public.delete_post(uuid, text),
--   public.send_mark(text, double precision, double precision, text, text[], text),
--   public.tag_mark(uuid, text, text), public.zone_counts(int),
--   public.suggest_area(text, text, double precision, double precision, text), public.community_suggested(),
--   public._ltot_hash(text), public._ltot_in_box(double precision, double precision), public._ltot_live_open(),
--   public._ltot_check_text(text, boolean, int), public._ltot_cleanup_marks();
-- drop table if exists public.marks, public.suggestions, public.reports, public.votes, public.posts;

-- Or simply pause/delete the whole project: Project Settings → General → Pause project / Delete project.
