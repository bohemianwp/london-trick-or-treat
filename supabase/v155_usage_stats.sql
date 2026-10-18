-- =====================================================================================
-- London Trick-or-Treat Map: v15.5 private usage report (developer only) · 使用情况统计（仅开发者可见）
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- What it adds:
--   * private.stats_token: ONE row with the sha256 of the developer's report token. The schema "private" is not
--     exposed by the API; RLS is on and anon/authenticated get no rights at all, so nobody can read it.
--   * public.usage_stats(p_token, p_since): returns ONLY aggregate counts (jsonb). It never returns rows, text,
--     device/session hashes, tokens or exact locations: "top places" are H3 cell ids or street centres rounded
--     to 3 decimals (≈100 m), the same precision the app already shows.
--   * A wrong or missing token raises 'forbidden'. The token itself is 32 random bytes kept only on the
--     developer's machine; this file holds just its sha256, which is not a secret.
-- Not stored anywhere, so not counted: practice marks (they stay on the phone) and the language choice.
-- =====================================================================================
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.stats_token (
  id smallint primary key default 1 check (id = 1),           -- exactly one row
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.stats_token enable row level security;     -- no policies: nobody reads it through the API
revoke all on private.stats_token from public, anon, authenticated;

-- One-time: the sha256 of the developer's token (re-running replaces it with the same value).
insert into private.stats_token (id, token_hash)
values (1, '0e7bde67acd73163e1f9eb4caf59d9e81ba6bec8b6569636060ee73c76c6ce8d')
on conflict (id) do update set token_hash = excluded.token_hash, created_at = now();

create or replace function public.usage_stats(p_token text, p_since timestamptz default now() - interval '24 hours')
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '24 hours');
  v_test_end  constant timestamptz := timestamptz '2026-10-21 00:00:00 America/Toronto';  -- test days Oct 17–20
  v_live_from constant timestamptz := timestamptz '2026-10-31 15:00:00 America/Toronto';
  v_live_to   constant timestamptz := timestamptz '2026-10-31 23:00:00 America/Toronto';
  v jsonb;
begin
  if p_token is null or char_length(p_token) not between 32 and 128
     or not exists (select 1 from private.stats_token s
                     where s.id = 1 and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'forbidden';
  end if;
  if v_since > now() then raise exception 'invalid'; end if;

  select jsonb_build_object(
    'since', v_since, 'until', now(), 'tz', 'America/Toronto',
    'marks', jsonb_build_object(                                  -- Oct 31 "fun street" marks (deleted after 2 h)
      'total',  (select count(*) from public.marks m where m.created_at >= v_since),
      'real',   (select count(*) from public.marks m where m.created_at >= v_since and m.created_at >= v_live_from and m.created_at < v_live_to),
      'test',   (select count(*) from public.marks m where m.created_at >= v_since and m.created_at < v_test_end),
      'practice', 'not stored (practice stays on the phone)',
      'sessions', (select count(distinct m.session_hash) from public.marks m where m.created_at >= v_since)),
    'decorations', jsonb_build_object(
      'marks', (select count(*) from public.decor_marks d where d.created_at >= v_since),
      'phone_days', (select count(distinct d.day_hash) from public.decor_marks d where d.created_at >= v_since),
      'likes', 'none (decorations have no likes)'),
    'past_favourites', jsonb_build_object(
      'pins',    (select count(*) from public.fav_pins f where f.created_at >= v_since),
      'hidden',  (select count(*) from public.fav_pins f where f.created_at >= v_since and f.hidden),
      'likes',   (select count(*) from public.fav_reactions r where r.created_at >= v_since and r.kind = 'like'),
      'hearts',  (select count(*) from public.fav_reactions r where r.created_at >= v_since and r.kind = 'heart'),
      'replies', (select count(*) from public.fav_replies r where r.created_at >= v_since),
      'reports', (select count(*) from public.fav_reports r where r.created_at >= v_since),
      'phones',  (select count(distinct x.h) from (
                    select f.device_hash h from public.fav_pins f where f.created_at >= v_since
                    union all select r.device_hash from public.fav_reactions r where r.created_at >= v_since
                    union all select r.device_hash from public.fav_replies r where r.created_at >= v_since
                    union all select r.device_hash from public.fav_reports r where r.created_at >= v_since) x)),
    'board', jsonb_build_object(
      'posts',   (select count(*) from public.posts p where p.created_at >= v_since),
      'votes',   (select count(*) from public.votes p where p.created_at >= v_since),
      'reports', (select count(*) from public.reports p where p.created_at >= v_since),
      'posting_phones', (select count(distinct p.author_hash) from public.posts p where p.created_at >= v_since),
      'voting_phones',  (select count(distinct p.voter) from public.votes p where p.created_at >= v_since)),
    'suggestions', jsonb_build_object(
      'total',  (select count(*) from public.suggestions s where s.created_at >= v_since),
      'phones', (select count(distinct s.device_hash) from public.suggestions s where s.created_at >= v_since)),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'n', n) order by h) from (
        select to_char(t at time zone 'America/Toronto', 'YYYY-MM-DD HH24:00') h, count(*) n from (
          select m.created_at t from public.marks m where m.created_at >= v_since
          union all select d.created_at from public.decor_marks d where d.created_at >= v_since
          union all select f.created_at from public.fav_pins f where f.created_at >= v_since
          union all select r.created_at from public.fav_reactions r where r.created_at >= v_since
          union all select r.created_at from public.fav_replies r where r.created_at >= v_since
          union all select r.created_at from public.fav_reports r where r.created_at >= v_since
          union all select p.created_at from public.posts p where p.created_at >= v_since
          union all select p.created_at from public.votes p where p.created_at >= v_since
          union all select s.created_at from public.suggestions s where s.created_at >= v_since) a
        group by 1) hh), '[]'::jsonb),
    'top_cells', coalesce((select jsonb_agg(jsonb_build_object('cell', c, 'marks', mk, 'decor', dc, 'n', mk + dc) order by mk + dc desc, c) from (
        select c, sum(mk)::int mk, sum(dc)::int dc from (
          select m.h3_r8 c, 1 mk, 0 dc from public.marks m where m.created_at >= v_since
          union all select d.h3_r8, 0, 1 from public.decor_marks d where d.created_at >= v_since) u
        group by c order by sum(mk) + sum(dc) desc, c limit 5) tc), '[]'::jsonb),
    'top_fav_spots', coalesce((select jsonb_agg(jsonb_build_object('lat', la, 'lng', lo, 'n', n) order by n desc, la, lo) from (
        select round(f.lat::numeric, 3) la, round(f.lng::numeric, 3) lo,
               count(*) filter (where f.created_at >= v_since)
               + coalesce(sum((select count(*) from public.fav_reactions r where r.pin_id = f.id and r.created_at >= v_since)), 0)
               + coalesce(sum((select count(*) from public.fav_replies r where r.pin_id = f.id and r.created_at >= v_since)), 0) n
          from public.fav_pins f where not f.hidden
         group by 1, 2 order by 3 desc, 1, 2 limit 5) tf where n > 0), '[]'::jsonb),
    'language', 'not stored (see the GoatCounter events)'
  ) into v;
  return v;
end;
$$;

revoke execute on function public.usage_stats(text, timestamptz) from public, authenticated;
grant execute on function public.usage_stats(text, timestamptz) to anon;            -- the token is the gate

notify pgrst, 'reload schema';

-- Check: this last line should show "v15.5 usage stats ready", token_rows = 1, anon_can_run = true.
select 'v15.5 usage stats ready' as status,
       (select count(*) from private.stats_token) as token_rows,
       has_function_privilege('anon', 'public.usage_stats(text, timestamptz)', 'execute') as anon_can_run;
