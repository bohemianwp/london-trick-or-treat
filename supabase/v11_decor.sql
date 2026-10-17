-- =====================================================================================
-- London Trick-or-Treat Map — v11 server update: "Best decorations / 最佳装饰" layer
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- What it adds
--   * public.decor_marks: one row per "Cool decorations here! 🎃" tap. Zone level only: the phone blurs the spot
--     (~50 m grid + jitter) before sending; the server re-rounds to 4 decimals and stores the H3 res-8 hex.
--     No photos, no text, no addresses. Optional preset tags only: spooky, funny, lights, mustsee.
--   * Shared from Oct 17, 2026 until Nov 1, 2026 00:00 Toronto. Counts use the last 14 days.
--     Rows older than 14 days are deleted on every call; EVERYTHING is deleted from Nov 2, 2026 00:00 Toronto.
--   * Limits: one decor mark per phone per hex per Toronto day, 10 per phone per day, plus a global brake.
--     The phone's id is hashed together with the day, so a phone cannot be linked across days.
--   * decor_counts(): per-hex counts ONLY for hexes with 3+ decor marks (privacy floor). No ids, no points.
--   * RLS on, anon cannot read or write the table directly; only the two RPCs are callable.
-- =====================================================================================

create table if not exists public.decor_marks (
  id uuid primary key default gen_random_uuid(),
  day_hash text not null,                        -- sha256('decor:' || device id || ':' || Toronto day): per-day limits only
  day date not null,                             -- Toronto calendar day of the mark
  lat double precision not null check (lat between 42.85 and 43.10),
  lng double precision not null check (lng between -81.45 and -81.05),
  h3_r8 text not null check (h3_r8 ~ '^[0-9a-f]{15}$'),
  tags text[] not null default '{}' check (tags <@ array['spooky','funny','lights','mustsee']),
  created_at timestamptz not null default now(),
  unique (day_hash, h3_r8)                       -- one per phone per hex per day
);
create index if not exists decor_created on public.decor_marks (created_at);
create index if not exists decor_h3_created on public.decor_marks (h3_r8, created_at);
create index if not exists decor_dayhash on public.decor_marks (day_hash);

alter table public.decor_marks enable row level security;
revoke all on public.decor_marks from anon, authenticated;
-- No policies: anon can neither read nor write decor_marks directly.

-- Retention: 14 days, and nothing at all after Nov 2, 2026 00:00 Toronto.
create or replace function public._ltot_cleanup_decor() returns void
language sql
as $$
  delete from public.decor_marks
   where created_at < now() - interval '14 days'
      or now() >= timestamptz '2026-11-02 00:00:00 America/Toronto'
$$;

create or replace function public._ltot_decor_open() returns boolean
language sql stable
as $$ select now() >= timestamptz '2026-10-17 00:00:00 America/Toronto'
         and now() <  timestamptz '2026-11-01 00:00:00 America/Toronto' $$;

create or replace function public.send_decor(
  p_device text, p_lat double precision, p_lng double precision, p_h3 text, p_tags text[]
) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_day date := (now() at time zone 'America/Toronto')::date;
  v_hash text;
  v_tags text[];
  v_id uuid;
begin
  perform public._ltot_cleanup_decor();
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if p_h3 is null or p_h3 !~ '^[0-9a-f]{15}$' then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  if p_tags is not null and not (p_tags <@ array['spooky','funny','lights','mustsee']) then raise exception 'invalid'; end if;
  if not public._ltot_decor_open() then raise exception 'closed'; end if;
  v_tags := array(select distinct t from unnest(coalesce(p_tags, '{}'::text[])) t order by t);
  v_hash := public._ltot_hash('decor:' || p_device || ':' || v_day::text);
  if exists (select 1 from public.decor_marks d where d.day_hash = v_hash and d.h3_r8 = p_h3) then
    raise exception 'rate';                      -- same hex once per phone per day
  end if;
  if (select count(*) from public.decor_marks d where d.day_hash = v_hash) >= 10 then
    raise exception 'rate';                      -- 10 decor marks per phone per day
  end if;
  if (select count(*) from public.decor_marks d where d.created_at > now() - interval '10 minutes') >= 3000 then
    raise exception 'rate';                      -- global brake
  end if;
  insert into public.decor_marks (day_hash, day, lat, lng, h3_r8, tags)
  values (v_hash, v_day, round(p_lat::numeric, 4)::float8, round(p_lng::numeric, 4)::float8, p_h3, v_tags)
  on conflict (day_hash, h3_r8) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'rate'; end if;
  return v_id;
end $$;


-- Hexes with 3+ decor marks in the last 14 days, most marked first, with the most common tag.
create or replace function public.decor_counts()
returns table (h3_r8 text, n int, top_tag text, top_tag_n int)
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._ltot_cleanup_decor();
  return query
    with w as (
      select d.h3_r8 as hx, d.tags as tg from public.decor_marks d where d.created_at > now() - interval '14 days'
    ), lit as (
      select w.hx, count(*)::int as cnt from w group by w.hx having count(*) >= 3
    ), tagc as (
      select w.hx, t.tag, count(*)::int as cnt
        from w cross join lateral unnest(w.tg) as t(tag)
       where w.hx in (select lit.hx from lit)
       group by w.hx, t.tag
    ), top as (
      select distinct on (tagc.hx) tagc.hx, tagc.tag, tagc.cnt from tagc order by tagc.hx, tagc.cnt desc, tagc.tag
    )
    select lit.hx, lit.cnt, top.tag, top.cnt
      from lit left join top on top.hx = lit.hx
     order by lit.cnt desc, lit.hx
     limit 400;
end $$;

revoke execute on function public._ltot_cleanup_decor(), public._ltot_decor_open() from public, anon, authenticated;
revoke execute on function public.send_decor(text, double precision, double precision, text, text[]), public.decor_counts() from public;
grant execute on function public.send_decor(text, double precision, double precision, text, text[]), public.decor_counts() to anon, authenticated;

notify pgrst, 'reload schema';
