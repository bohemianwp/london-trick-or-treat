-- =====================================================================================
-- London Trick-or-Treat Map — cleanup after Halloween (SPEC §6: delete everything after Nov 2, 2026)
-- Supabase → SQL Editor → New query → paste → Run.
-- ⚠️ This permanently deletes all marks, decoration marks, suggestions, posts, votes, reports and the v14 board (pins, replies, reactions, reports). There is no undo.
-- =====================================================================================

-- Step A (default): delete all data, keep the empty tables and functions (handy if you reuse it next year).
begin;
delete from public.fav_reports;      -- v14 board (skip these 4 lines if v14_board.sql was never run)
delete from public.fav_reactions;
delete from public.fav_replies;
delete from public.fav_pins;
delete from public.marks;
delete from public.decor_marks;      -- v11 (skip this line if v11_decor.sql was never run)
delete from public.suggestions;
delete from public.reports;
delete from public.votes;
delete from public.posts;
commit;

-- Check: every count should be 0.
select 'marks' as t, count(*) from public.marks
union all select 'decor_marks', count(*) from public.decor_marks
union all select 'suggestions', count(*) from public.suggestions
union all select 'posts', count(*) from public.posts
union all select 'votes', count(*) from public.votes
union all select 'reports', count(*) from public.reports
union all select 'fav_pins', count(*) from public.fav_pins
union all select 'fav_replies', count(*) from public.fav_replies
union all select 'fav_reactions', count(*) from public.fav_reactions
union all select 'fav_reports', count(*) from public.fav_reports;

-- Step B (optional): remove everything this project created. Uncomment to run.
-- select cron.unschedule('ltot-cleanup');   -- only if you scheduled it
-- drop function if exists
--   public.create_post(text, text, double precision, double precision, text, text, text),
--   public.vote_post(uuid, text), public.report_post(uuid, text), public.delete_post(uuid, text),
--   public.send_mark(text, double precision, double precision, text, text[], text),
--   public.tag_mark(uuid, text, text), public.zone_counts(int),
--   public.suggest_area(text, text, double precision, double precision, text), public.community_suggested(),
--   public._ltot_hash(text), public._ltot_in_box(double precision, double precision), public._ltot_live_open(),
--   public._ltot_check_text(text, boolean, int), public._ltot_cleanup_marks(),
--   public.send_decor(text, double precision, double precision, text, text[]), public.decor_counts(),
--   public._ltot_cleanup_decor(), public._ltot_decor_open(),
--   public.fav_create(text, double precision, double precision, text, text, text), public.fav_react(text, uuid, text),
--   public.fav_reply(text, uuid, text, text), public.fav_report(text, text, uuid), public.fav_list(text),
--   public.fav_replies(uuid), public.fav_delete(text, uuid, text), public._ltot_fav_open(), public._ltot_cleanup_fav(),
--   public._ltot_fav_snap(double precision, double precision), public._ltot_today_start(), public._ltot_fav_text(text, boolean, int);
-- drop table if exists public.fav_reports, public.fav_reactions, public.fav_replies, public.fav_pins, public.decor_marks, public.marks, public.suggestions, public.reports, public.votes, public.posts;

-- Or simply pause/delete the whole project: Project Settings → General → Pause project / Delete project.
