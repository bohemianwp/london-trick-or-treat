-- =====================================================================================
-- London Trick-or-Treat Map — Supabase schema (SPEC §4, v3: anonymous marks → zones)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to run again (and over a v2 database:
-- the old house-marker and live-dot tables/functions are dropped below).
--
-- Security model
--   * RLS is on for every table. The anon role cannot INSERT/UPDATE/DELETE any table directly.
--   * All writes go through SECURITY DEFINER functions (RPCs) that validate every input.
--   * anon may SELECT only safe columns of posts (not hidden). Nothing else is directly readable:
--     token hashes, device/author/session hashes, votes, reports, marks and suggestions stay private.
--   * Marks ("This spot is great!"): the server keeps only a hash of the rotating session id,
--     re-rounds the (already blurred) location to 4 decimals, deletes marks after 2 hours and
--     returns per-hex counts (H3 res 8) only when a hex has 3 or more marks. No points, no ids.
--   * Suggestions ("this neighbourhood should be on the map"): one per hex per phone, 3 per phone per day,
--     shown only once 3 different phones suggest the same hex.
-- Errors are raised with short codes the app understands:
--   invalid | forbidden | rate | closed | outside | text:<empty|tooLong|url|email|phone|profanity>
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ v2 leftovers (house markers + live dots)
drop function if exists
  public.upsert_marker(uuid, double precision, double precision, text[], text, text, time, time, text, text),
  public.set_marker_status(uuid, text, text),
  public.delete_marker(uuid, text),
  public.send_dot(text, double precision, double precision, text),
  public.remove_dot(text),
  public.live_dots_recent(),
  public.live_hex_counts(int),
  public._ltot_cleanup_dots(),
  public._ltot_check_text(text, boolean);        -- replaced by the 3-argument version below
drop table if exists public.markers, public.live_dots;

-- ------------------------------------------------------------------ tables
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  board text not null check (board in ('fun','decor')),
  area_id text check (area_id ~ '^[a-z0-9-]{1,40}$'),
  lat double precision,                          -- rough location only (3 decimals ≈ 100 m), optional
  lng double precision,
  body text not null check (char_length(body) between 1 and 140),
  votes int not null default 0,
  reports int not null default 0,
  hidden boolean generated always as (reports >= 3) stored,
  author_hash text not null,                     -- sha256('voter:' || device id): rate limit only, never shown
  token_hash text not null,                      -- sha256 of the delete token kept on the author's phone
  created_at timestamptz not null default now()
);
create index if not exists posts_board_created on public.posts (board, created_at desc);
create index if not exists posts_author_created on public.posts (author_hash, created_at);

create table if not exists public.votes (
  post_id uuid references public.posts on delete cascade,
  voter text not null,                           -- sha256('voter:' || device id)
  created_at timestamptz not null default now(),
  primary key (post_id, voter)
);
create index if not exists votes_voter_created on public.votes (voter, created_at);

create table if not exists public.reports (
  post_id uuid references public.posts on delete cascade,
  reporter text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter)
);

-- One row per "This spot is great!" tap on Halloween night. Deleted after 2 hours.
create table if not exists public.marks (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null,                    -- sha256 of the client's random rotating session id (raw id never stored)
  lat double precision not null check (lat between 42.85 and 43.10),   -- client blurs to ~50 m + jitter;
  lng double precision not null check (lng between -81.45 and -81.05), -- re-rounded to 4 decimals here
  h3_r8 text not null check (h3_r8 ~ '^[0-9a-f]{15}$'),                -- H3 resolution-8 cell computed by the client
  tags text[] not null default '{}' check (tags <@ array['candy','decor','crowded']),
  token_hash text not null,                      -- sha256 of the token that lets the phone add a tag later
  created_at timestamptz not null default now()
);
create index if not exists marks_created on public.marks (created_at);
create index if not exists marks_h3_created on public.marks (h3_r8, created_at);
create index if not exists marks_session_created on public.marks (session_hash, created_at);

-- "Please put this neighbourhood on the map." One per hex per phone.
create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,                     -- sha256('device:' || random device id)
  h3_r8 text not null check (h3_r8 ~ '^[0-9a-f]{15}$'),
  lat double precision not null check (lat between 42.85 and 43.10),   -- centre of the hex, 4 decimals
  lng double precision not null check (lng between -81.45 and -81.05),
  reason text check (char_length(reason) <= 80),
  created_at timestamptz not null default now(),
  unique (device_hash, h3_r8)
);
create index if not exists suggestions_device_created on public.suggestions (device_hash, created_at);

-- ------------------------------------------------------------------ row level security + column grants
alter table public.posts       enable row level security;
alter table public.votes       enable row level security;
alter table public.reports     enable row level security;
alter table public.marks       enable row level security;
alter table public.suggestions enable row level security;

-- Supabase grants everything on new tables to anon/authenticated by default: take it all back first.
revoke all on public.posts, public.votes, public.reports, public.marks, public.suggestions from anon, authenticated;

grant select (id, board, area_id, lat, lng, body, votes, hidden, created_at)
  on public.posts to anon, authenticated;

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon, authenticated using (not hidden);
-- No policies on votes, reports, marks, suggestions: anon can read or write none of them directly.

-- ------------------------------------------------------------------ internal helpers (not callable by anon)
create or replace function public._ltot_hash(t text) returns text
language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;

create or replace function public._ltot_in_box(p_lat double precision, p_lng double precision) returns boolean
language sql immutable
as $$ select p_lat is not null and p_lng is not null
         and p_lat between 42.85 and 43.10 and p_lng between -81.45 and -81.05 $$;

create or replace function public._ltot_live_open() returns boolean
language sql stable
as $$ select (now() >= timestamptz '2026-10-31 15:00:00 America/Toronto'
          and now() <  timestamptz '2026-10-31 23:00:00 America/Toronto')
          or (now() >= timestamptz '2026-10-17 00:00:00 America/Toronto'      -- test days Oct 17–20 (see v7_update.sql)
          and now() <  timestamptz '2026-10-21 00:00:00 America/Toronto') $$;

-- Same rules as checkText() in lib.js. Returns the cleaned text (or null for an empty optional note).
-- p_max: maximum length (posts 140, suggestion reasons 80).
create or replace function public._ltot_check_text(p text, p_optional boolean, p_max int default 140) returns text
language plpgsql immutable
as $$
declare s text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if s = '' then
    if p_optional then return null; end if;
    raise exception 'text:empty';
  end if;
  if char_length(s) > coalesce(p_max, 140) then raise exception 'text:tooLong'; end if;
  if s ~* '[^\s@]+@[^\s@]+\.[a-z]{2,}' then raise exception 'text:email'; end if;
  if s ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|ca|net|org|io|ly|co|me|app|info|biz|xyz|link|site|gg|tv|to)\M)' then
    raise exception 'text:url';
  end if;
  if s ~ '(\+?1[\s.-]?)?\(?\m\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\M|\m\d{3}[\s.-]\d{4}\M|\d{7,}' then
    raise exception 'text:phone';
  end if;
  if s ~* '\m\d{1,5}[a-z]?\s+[a-z][a-z.''-]*(\s+[a-z][a-z.''-]*)?\s+(st|street|rd|road|ave|avenue|cres|crescent|dr|drive|blvd|boulevard|ct|court|pl|place|way|lane|ln|terr|terrace|cir|circle|gate|grove|pkwy|parkway|row|sq|square|trail|trl)\M'
     or s ~ '\d{1,5}\s*号' then
    raise exception 'text:address';            -- no house numbers / addresses: zones, never individual homes
  end if;
  if s ~* '\m(fuck|shit|bitch|cunt|asshole|dickhead|bastard|slut|whore|retard|nigger|faggot)(s|es|ing|ed)?\M'
     or s ~ '(傻逼|操你|他妈的|去死)' then
    raise exception 'text:profanity';
  end if;
  return s;
end $$;

-- Marks live for 2 hours. Called by send_mark and zone_counts (and optionally by pg_cron, see the end).
create or replace function public._ltot_cleanup_marks() returns void
language sql
as $$ delete from public.marks where created_at < now() - interval '2 hours' $$;

-- ------------------------------------------------------------------ RPC: board
create or replace function public.create_post(
  p_board text, p_area_id text, p_lat double precision, p_lng double precision,
  p_body text, p_voter text, p_token text
) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_body text;
  v_author text;
  v_id uuid;
begin
  if coalesce(p_board, '') not in ('fun','decor') then raise exception 'invalid'; end if;
  if p_area_id is not null and p_area_id !~ '^[a-z0-9-]{1,40}$' then raise exception 'invalid'; end if;
  if p_voter is null or char_length(p_voter) not between 8 and 64 then raise exception 'invalid'; end if;
  if p_token is null or char_length(p_token) not between 16 and 128 then raise exception 'invalid'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'invalid'; end if;
  if p_lat is not null and not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  v_body := public._ltot_check_text(p_body, false);
  v_author := public._ltot_hash('voter:' || p_voter);
  if (select count(*) from public.posts where author_hash = v_author and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate';                      -- five posts per device per hour
  end if;
  if (select count(*) from public.posts where created_at > now() - interval '1 hour') >= 1000 then
    raise exception 'rate';                      -- global brake
  end if;
  insert into public.posts (board, area_id, lat, lng, body, author_hash, token_hash)
  values (p_board, p_area_id, round(p_lat::numeric, 3)::float8, round(p_lng::numeric, 3)::float8, v_body, v_author,
          public._ltot_hash(p_token))
  returning id into v_id;
  return v_id;
end $$;

-- Returns the new vote count, or minus the current count if this device already voted.
create or replace function public.vote_post(p_post_id uuid, p_voter text) returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_who text;
  v_n int;
begin
  if p_voter is null or char_length(p_voter) not between 8 and 64 then raise exception 'invalid'; end if;
  if not exists (select 1 from public.posts where id = p_post_id and not hidden) then raise exception 'invalid'; end if;
  v_who := public._ltot_hash('voter:' || p_voter);
  if (select count(*) from public.votes where voter = v_who and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'rate';
  end if;
  insert into public.votes (post_id, voter) values (p_post_id, v_who) on conflict do nothing;
  if not found then
    select votes into v_n from public.posts where id = p_post_id;
    return -v_n;
  end if;
  update public.posts set votes = votes + 1 where id = p_post_id returning votes into v_n;
  return v_n;
end $$;

-- One report per device per post; 3 reports hide the post (posts.hidden is generated).
create or replace function public.report_post(p_post_id uuid, p_voter text) returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_who text;
  v_n int;
begin
  if p_voter is null or char_length(p_voter) not between 8 and 64 then raise exception 'invalid'; end if;
  if not exists (select 1 from public.posts where id = p_post_id) then raise exception 'invalid'; end if;
  v_who := public._ltot_hash('voter:' || p_voter);
  if (select count(*) from public.reports where reporter = v_who and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate';
  end if;
  insert into public.reports (post_id, reporter) values (p_post_id, v_who) on conflict do nothing;
  if not found then return -1; end if;
  update public.posts set reports = reports + 1 where id = p_post_id returning reports into v_n;
  return v_n;
end $$;

create or replace function public.delete_post(p_id uuid, p_token text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.posts where id = p_id and token_hash = public._ltot_hash(coalesce(p_token, ''));
  if not found then raise exception 'forbidden'; end if;
  return true;
end $$;

-- ------------------------------------------------------------------ RPC: marks → zones (Oct 31, 3–11 PM Toronto only)
-- A kid taps "This spot is great!". Returns the mark id; the phone keeps it with p_token to add a tag later.
create or replace function public.send_mark(
  p_session text, p_lat double precision, p_lng double precision, p_h3 text, p_tags text[], p_token text
) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_sid text;
  v_tags text[];
  v_id uuid;
begin
  perform public._ltot_cleanup_marks();
  if p_session is null or p_session !~ '^[a-f0-9]{16,64}$' then raise exception 'invalid'; end if;
  if p_token is null or char_length(p_token) not between 16 and 128 then raise exception 'invalid'; end if;
  if p_h3 is null or p_h3 !~ '^[0-9a-f]{15}$' then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  if p_tags is not null and not (p_tags <@ array['candy','decor','crowded']) then raise exception 'invalid'; end if;
  v_tags := array(select distinct t from unnest(coalesce(p_tags, '{}'::text[])) t order by t);
  if not public._ltot_live_open() then raise exception 'closed'; end if;
  v_sid := public._ltot_hash(p_session);
  if exists (select 1 from public.marks m
              where m.session_hash = v_sid and m.created_at > now() - interval '5 minutes') then
    raise exception 'rate';                      -- one mark per session every 5 minutes
  end if;
  if exists (select 1 from public.marks m
              where m.session_hash = v_sid and m.h3_r8 = p_h3 and m.created_at > now() - interval '30 minutes') then
    raise exception 'rate';                      -- the same zone once per 30 minutes per session
  end if;
  if (select count(*) from public.marks m where m.created_at > now() - interval '10 minutes') >= 5000 then
    raise exception 'rate';                      -- global brake against floods
  end if;
  insert into public.marks (session_hash, lat, lng, h3_r8, tags, token_hash)
  values (v_sid, round(p_lat::numeric, 4)::float8, round(p_lng::numeric, 4)::float8, p_h3, v_tags,
          public._ltot_hash(p_token))
  returning id into v_id;
  return v_id;
end $$;

-- Add one tag to your own mark within 15 minutes. Idempotent. Returns the mark's tags.
create or replace function public.tag_mark(p_id uuid, p_token text, p_tag text) returns text[]
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_created timestamptz;
  v_tags text[];
begin
  if coalesce(p_tag, '') not in ('candy','decor','crowded') then raise exception 'invalid'; end if;
  select m.created_at into v_created from public.marks m
   where m.id = p_id and m.token_hash = public._ltot_hash(coalesce(p_token, ''));
  if not found then raise exception 'forbidden'; end if;
  if v_created < now() - interval '15 minutes' then raise exception 'closed'; end if;
  update public.marks m
     set tags = array(select distinct t from unnest(m.tags || p_tag) t order by t)
   where m.id = p_id
  returning m.tags into v_tags;
  return v_tags;
end $$;

-- Marks per H3 cell over the last 30–60 minutes, ONLY for cells with 3 or more marks (privacy floor).
-- top_tag: most common tag in the window (null if none). first_lit_at: when the cell first reached 3 marks
-- (the 3rd-oldest stored mark), so the app can show "NEW" for 30 minutes. Volatile: it deletes old marks first.
create or replace function public.zone_counts(p_window_min int default 45)
returns table (h3_r8 text, n int, top_tag text, top_tag_n int, first_lit_at timestamptz)
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_w int := least(60, greatest(30, coalesce(p_window_min, 45)));
begin
  perform public._ltot_cleanup_marks();
  return query
    with w as (
      select m.h3_r8 as hx, m.tags as tg
        from public.marks m
       where m.created_at > now() - make_interval(mins => v_w)
    ), lit as (
      select w.hx, count(*)::int as cnt from w group by w.hx having count(*) >= 3
    ), tagc as (
      select w.hx, t.tag, count(*)::int as cnt
        from w cross join lateral unnest(w.tg) as t(tag)
       where w.hx in (select lit.hx from lit)
       group by w.hx, t.tag
    ), top as (
      select distinct on (tagc.hx) tagc.hx, tagc.tag, tagc.cnt
        from tagc order by tagc.hx, tagc.cnt desc, tagc.tag
    ), first3 as (
      select x.hx, x.created_at
        from (select m.h3_r8 as hx, m.created_at,
                     row_number() over (partition by m.h3_r8 order by m.created_at, m.id) as rn
                from public.marks m
               where m.h3_r8 in (select lit.hx from lit)) x
       where x.rn = 3
    )
    select lit.hx, lit.cnt, top.tag, top.cnt, first3.created_at
      from lit
      left join top on top.hx = lit.hx
      left join first3 on first3.hx = lit.hx
     order by lit.cnt desc, lit.hx
     limit 400;
end $$;

-- ------------------------------------------------------------------ RPC: neighbourhood suggestions (until Nov 1, 6 AM)
create or replace function public.suggest_area(
  p_device text, p_h3 text, p_lat double precision, p_lng double precision, p_reason text
) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_dev text;
  v_reason text;
  v_id uuid;
begin
  if now() >= timestamptz '2026-11-01 06:00:00 America/Toronto' then raise exception 'closed'; end if;
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if p_h3 is null or p_h3 !~ '^[0-9a-f]{15}$' then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  v_reason := public._ltot_check_text(p_reason, true, 80);
  v_dev := public._ltot_hash('device:' || p_device);
  if exists (select 1 from public.suggestions s where s.device_hash = v_dev and s.h3_r8 = p_h3) then
    raise exception 'rate';                      -- one suggestion per hex per phone
  end if;
  if (select count(*) from public.suggestions s
       where s.device_hash = v_dev and s.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate';                      -- three suggestions per phone per day
  end if;
  if (select count(*) from public.suggestions s where s.created_at > now() - interval '1 hour') >= 2000 then
    raise exception 'rate';                      -- global brake
  end if;
  insert into public.suggestions (device_hash, h3_r8, lat, lng, reason)
  values (v_dev, p_h3, round(p_lat::numeric, 4)::float8, round(p_lng::numeric, 4)::float8, v_reason)
  on conflict (device_hash, h3_r8) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'rate'; end if;   -- lost a race with the same phone
  return v_id;
end $$;

-- Hexes that 3 or more phones suggested, with up to 3 recent reasons. Never returns device hashes.
create or replace function public.community_suggested()
returns table (h3_r8 text, n int, lat double precision, lng double precision, reasons text[])
language sql stable security definer
set search_path = public, extensions
as $$
  select s.h3_r8, count(*)::int,
         round(avg(s.lat)::numeric, 4)::float8, round(avg(s.lng)::numeric, 4)::float8,
         array(select r.reason from public.suggestions r
                where r.h3_r8 = s.h3_r8 and r.reason is not null
                order by r.created_at desc limit 3)
    from public.suggestions s
   group by s.h3_r8
  having count(*) >= 3
   order by 2 desc, 1
   limit 400
$$;

-- ------------------------------------------------------------------ v11: Best decorations layer (same as supabase/v11_decor.sql)
-- Decor marks: zone level only, optional preset tags, per-day device hash, shared Oct 17 – Nov 1 00:00 Toronto,
-- 14-day counts, 3+ floor, everything deleted from Nov 2 00:00 Toronto.
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

-- ------------------------------------------------------------------ v14: "Best streets from past years / 往年最佳街区" board
-- Same as supabase/v14_board.sql (see its header). Pins snapped to ~50 m, preset tag, ≤80/≤60 chars, deleted Nov 2.

create table if not exists public.fav_pins (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,                     -- sha256('fav:' || device id): limits + "one reaction each" only
  lat double precision not null check (lat between 42.85 and 43.10),   -- snapped to the ~50 m grid
  lng double precision not null check (lng between -81.45 and -81.05),
  tag text not null check (tag in ('festive','candy','littlekids','walking')),
  body text check (body is null or char_length(body) between 1 and 80),
  likes int not null default 0,
  hearts int not null default 0,
  reports int not null default 0,
  hidden boolean generated always as (reports >= 3) stored,
  token_hash text not null,                      -- sha256 of the delete token kept on the author's phone
  created_at timestamptz not null default now()
);
create index if not exists fav_pins_device_created on public.fav_pins (device_hash, created_at);
create index if not exists fav_pins_created on public.fav_pins (created_at);

create table if not exists public.fav_replies (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.fav_pins on delete cascade,
  device_hash text not null,
  body text not null check (char_length(body) between 1 and 60),
  reports int not null default 0,
  hidden boolean generated always as (reports >= 3) stored,
  token_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists fav_replies_pin_created on public.fav_replies (pin_id, created_at);
create index if not exists fav_replies_device_created on public.fav_replies (device_hash, created_at);

create table if not exists public.fav_reactions (
  pin_id uuid not null references public.fav_pins on delete cascade,
  device_hash text not null,
  kind text not null check (kind in ('like','heart')),
  created_at timestamptz not null default now(),
  primary key (pin_id, device_hash, kind)
);
create index if not exists fav_reactions_device_created on public.fav_reactions (device_hash, created_at);

create table if not exists public.fav_reports (
  target uuid not null,                          -- a fav_pins.id or fav_replies.id
  kind text not null check (kind in ('pin','reply')),
  device_hash text not null,
  created_at timestamptz not null default now(),
  primary key (target, device_hash)
);
create index if not exists fav_reports_device_created on public.fav_reports (device_hash, created_at);

alter table public.fav_pins      enable row level security;
alter table public.fav_replies   enable row level security;
alter table public.fav_reactions enable row level security;
alter table public.fav_reports   enable row level security;
revoke all on public.fav_pins, public.fav_replies, public.fav_reactions, public.fav_reports from anon, authenticated;
-- No policies: anon can neither read nor write fav_* tables directly.

-- ------------------------------------------------------------------ internal helpers
create or replace function public._ltot_fav_open() returns boolean
language sql stable
as $$ select now() >= timestamptz '2026-10-17 00:00:00 America/Toronto'
         and now() <  timestamptz '2026-11-01 00:00:00 America/Toronto' $$;

-- Everything goes from Nov 2, 2026 00:00 Toronto.
create or replace function public._ltot_cleanup_fav() returns void
language plpgsql
as $$
begin
  if now() >= timestamptz '2026-11-02 00:00:00 America/Toronto' then
    delete from public.fav_reports;
    delete from public.fav_reactions;
    delete from public.fav_replies;
    delete from public.fav_pins;
  end if;
end $$;

-- Street level, never a house: snap to a ~50 m grid (0.00045° lat ≈ 50 m, 0.0006° lng ≈ 49 m at 43° N).
create or replace function public._ltot_fav_snap(v double precision, step double precision) returns double precision
language sql immutable
as $$ select round((round(v / step) * step)::numeric, 5)::float8 $$;

-- Start of today in Toronto, for the per-day limits.
create or replace function public._ltot_today_start() returns timestamptz
language sql stable
as $$ select (date_trunc('day', now() at time zone 'America/Toronto')) at time zone 'America/Toronto' $$;

-- Stricter text check for the board: the shared rules plus house numbers, postal codes and more words (EN + ZH).
create or replace function public._ltot_fav_text(p text, p_optional boolean, p_max int) returns text
language plpgsql immutable
set search_path = public, extensions
as $$
declare s text;
begin
  -- full-width digits and symbols count as normal ones (０-９ ＠ ． ／ ＃ ： ＋)
  s := translate(coalesce(p, ''), '０１２３４５６７８９＠．／＃：＋', '0123456789@./#:+');
  s := public._ltot_check_text(s, p_optional, p_max);
  if s is null then return null; end if;
  if s ~* '#\s*[0-9]{2,}'                                                          -- "#1 street" is fine, "#42" is not
     or s ~* '\m(no|num|number)\.?\s*#?\s*[0-9]{2,}'
     or s ~* '\m(house|home|apt|unit|suite|lot|address|addr)\.?\s*#?\s*[0-9]'
     or s ~ '[0-9]\s*(号|號|栋|棟|单元|單元|室|门牌|門牌)'
     or s ~ '(门牌|門牌|地址)'
     or s ~* '[a-z][0-9][a-z]\s?[0-9][a-z][0-9]'                                   -- Canadian postal code (N6A 1B2)
     or regexp_replace(s, '(?<![0-9])(19|20)[0-9]{2}(?![0-9])', '', 'g') ~ '(?<![0-9])[0-9]{3,5}(?![0-9])'   -- house numbers (years are fine)
  then
    raise exception 'text:address';
  end if;
  if s ~* '\m(dick|cock|pussy|piss|fag|nazi|kys|stfu|wtf)\M' or s ~* 'kill\s+(yo)?u?r?self'
     or s ~ '(煞笔|沙比|傻b|傻B|草泥马|艹你|婊子|贱人|賤人|王八蛋|狗日|滚蛋|尼玛|妈的|媽的|死全家|废物|白痴)' then
    raise exception 'text:profanity';
  end if;
  return s;
end $$;

-- ------------------------------------------------------------------ RPCs
-- Drop a pin. Returns {id, lat, lng} with the snapped position. The phone keeps p_token to delete it later.
create or replace function public.fav_create(
  p_device text, p_lat double precision, p_lng double precision, p_tag text, p_body text, p_token text
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_dev text;
  v_body text;
  v_lat double precision;
  v_lng double precision;
  v_id uuid;
begin
  perform public._ltot_cleanup_fav();
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if p_token is null or char_length(p_token) not between 16 and 128 then raise exception 'invalid'; end if;
  if coalesce(p_tag, '') not in ('festive','candy','littlekids','walking') then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  if not public._ltot_fav_open() then raise exception 'closed'; end if;
  v_body := public._ltot_fav_text(p_body, true, 80);
  v_lat := public._ltot_fav_snap(p_lat, 0.00045);
  v_lng := public._ltot_fav_snap(p_lng, 0.0006);
  if not public._ltot_in_box(v_lat, v_lng) then raise exception 'outside'; end if;
  v_dev := public._ltot_hash('fav:' || p_device);
  if (select count(*) from public.fav_pins f where f.device_hash = v_dev and f.created_at >= public._ltot_today_start()) >= 5 then
    raise exception 'rate';                      -- 5 pins per phone per Toronto day
  end if;
  if exists (select 1 from public.fav_pins f where f.device_hash = v_dev and f.lat = v_lat and f.lng = v_lng) then
    raise exception 'rate';                      -- one pin per phone per spot
  end if;
  if (select count(*) from public.fav_pins f where f.created_at > now() - interval '10 minutes') >= 300
     or (select count(*) from public.fav_pins) >= 5000 then
    raise exception 'rate';                      -- global brakes
  end if;
  insert into public.fav_pins (device_hash, lat, lng, tag, body, token_hash)
  values (v_dev, v_lat, v_lng, p_tag, v_body, public._ltot_hash(p_token))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'lat', v_lat, 'lng', v_lng);
end $$;

-- 👍 / ❤️, once each per phone per pin. Returns {likes, hearts, added}.
create or replace function public.fav_react(p_device text, p_pin uuid, p_kind text) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_dev text;
  v_added boolean;
  v_likes int;
  v_hearts int;
begin
  perform public._ltot_cleanup_fav();
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if coalesce(p_kind, '') not in ('like','heart') then raise exception 'invalid'; end if;
  if not exists (select 1 from public.fav_pins f where f.id = p_pin and not f.hidden) then raise exception 'invalid'; end if;
  if not public._ltot_fav_open() then raise exception 'closed'; end if;
  v_dev := public._ltot_hash('fav:' || p_device);
  if (select count(*) from public.fav_reactions r where r.device_hash = v_dev and r.created_at >= public._ltot_today_start()) >= 200 then
    raise exception 'rate';
  end if;
  insert into public.fav_reactions (pin_id, device_hash, kind) values (p_pin, v_dev, p_kind) on conflict do nothing;
  v_added := found;
  if v_added then
    update public.fav_pins f
       set likes = f.likes + (case when p_kind = 'like' then 1 else 0 end),
           hearts = f.hearts + (case when p_kind = 'heart' then 1 else 0 end)
     where f.id = p_pin;
  end if;
  select f.likes, f.hearts into v_likes, v_hearts from public.fav_pins f where f.id = p_pin;
  return jsonb_build_object('likes', v_likes, 'hearts', v_hearts, 'added', v_added);
end $$;

-- A short reply (≤ 60 characters). Returns the reply id; the phone keeps p_token to delete it later.
create or replace function public.fav_reply(p_device text, p_pin uuid, p_body text, p_token text) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_dev text;
  v_body text;
  v_id uuid;
begin
  perform public._ltot_cleanup_fav();
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if p_token is null or char_length(p_token) not between 16 and 128 then raise exception 'invalid'; end if;
  if not exists (select 1 from public.fav_pins f where f.id = p_pin and not f.hidden) then raise exception 'invalid'; end if;
  if not public._ltot_fav_open() then raise exception 'closed'; end if;
  v_body := public._ltot_fav_text(p_body, false, 60);
  v_dev := public._ltot_hash('fav:' || p_device);
  if (select count(*) from public.fav_replies r where r.device_hash = v_dev and r.created_at >= public._ltot_today_start()) >= 20 then
    raise exception 'rate';                      -- 20 replies per phone per Toronto day
  end if;
  if (select count(*) from public.fav_replies r where r.pin_id = p_pin) >= 50
     or (select count(*) from public.fav_replies r where r.created_at > now() - interval '10 minutes') >= 600 then
    raise exception 'rate';
  end if;
  insert into public.fav_replies (pin_id, device_hash, body, token_hash)
  values (p_pin, v_dev, v_body, public._ltot_hash(p_token))
  returning id into v_id;
  return v_id;
end $$;

-- One report per phone per pin/reply. Returns the report count (3 hides it), or -1 if this phone already reported.
create or replace function public.fav_report(p_device text, p_kind text, p_id uuid) returns int
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_dev text;
  v_n int;
begin
  perform public._ltot_cleanup_fav();
  if p_device is null or char_length(p_device) not between 8 and 80 then raise exception 'invalid'; end if;
  if coalesce(p_kind, '') not in ('pin','reply') then raise exception 'invalid'; end if;
  if p_kind = 'pin' and not exists (select 1 from public.fav_pins f where f.id = p_id) then raise exception 'invalid'; end if;
  if p_kind = 'reply' and not exists (select 1 from public.fav_replies r where r.id = p_id) then raise exception 'invalid'; end if;
  v_dev := public._ltot_hash('fav:' || p_device);
  if (select count(*) from public.fav_reports x where x.device_hash = v_dev and x.created_at >= public._ltot_today_start()) >= 20 then
    raise exception 'rate';
  end if;
  insert into public.fav_reports (target, kind, device_hash) values (p_id, p_kind, v_dev) on conflict do nothing;
  if not found then return -1; end if;
  if p_kind = 'pin' then
    update public.fav_pins f set reports = f.reports + 1 where f.id = p_id returning f.reports into v_n;
  else
    update public.fav_replies r set reports = r.reports + 1 where r.id = p_id returning r.reports into v_n;
  end if;
  return v_n;
end $$;

drop function if exists public.fav_list(text);     -- return columns may change between versions
-- Visible pins (fewer than 3 reports), most liked first. With p_device, says which ones this phone reacted to.
-- families = how many different phones posted or reacted (aggregate only; null below 3). On Oct 31 the app shows
-- "🏆 12 families remember this street · 🔥 How is it tonight?". Never returns device hashes, tokens or report counts.
create or replace function public.fav_list(p_device text default null)
returns table (id uuid, lat double precision, lng double precision, tag text, body text,
               likes int, hearts int, replies int, families int, my_like boolean, my_heart boolean, created_at timestamptz)
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_dev text := case when p_device is null then null else public._ltot_hash('fav:' || p_device) end;
begin
  perform public._ltot_cleanup_fav();
  return query
    select f.id, f.lat, f.lng, f.tag, f.body, f.likes, f.hearts,
           (select count(*)::int from public.fav_replies r where r.pin_id = f.id and not r.hidden),
           (select case when count(*) >= 3 then count(*)::int end      -- families: distinct phones (author + 👍/❤️), shown only at 3+
              from (select f.device_hash as d union select x.device_hash from public.fav_reactions x where x.pin_id = f.id) fam),
           exists (select 1 from public.fav_reactions x where x.pin_id = f.id and x.device_hash = v_dev and x.kind = 'like'),
           exists (select 1 from public.fav_reactions x where x.pin_id = f.id and x.device_hash = v_dev and x.kind = 'heart'),
           f.created_at
      from public.fav_pins f
     where not f.hidden
     order by f.likes + f.hearts desc, f.created_at desc
     limit 500;
end $$;

drop function if exists public.fav_replies(uuid);
-- Visible replies of a visible pin, oldest first.
create or replace function public.fav_replies(p_pin uuid)
returns table (id uuid, body text, created_at timestamptz)
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._ltot_cleanup_fav();
  return query
    select r.id, r.body, r.created_at
      from public.fav_replies r join public.fav_pins f on f.id = r.pin_id
     where r.pin_id = p_pin and not r.hidden and not f.hidden
     order by r.created_at, r.id
     limit 50;
end $$;

-- Delete my own pin or reply (needs the token this phone kept).
create or replace function public.fav_delete(p_kind text, p_id uuid, p_token text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_kind = 'pin' then
    delete from public.fav_pins f where f.id = p_id and f.token_hash = public._ltot_hash(coalesce(p_token, ''));
  elsif p_kind = 'reply' then
    delete from public.fav_replies r where r.id = p_id and r.token_hash = public._ltot_hash(coalesce(p_token, ''));
  else
    raise exception 'invalid';
  end if;
  if not found then raise exception 'forbidden'; end if;
  delete from public.fav_reports x where x.target = p_id;
  return true;
end $$;

-- ------------------------------------------------------------------ who may call what
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.create_post(text, text, double precision, double precision, text, text, text),
  public.vote_post(uuid, text),
  public.report_post(uuid, text),
  public.delete_post(uuid, text),
  public.send_mark(text, double precision, double precision, text, text[], text),
  public.tag_mark(uuid, text, text),
  public.zone_counts(int),
  public.suggest_area(text, text, double precision, double precision, text),
  public.community_suggested(),
  public.send_decor(text, double precision, double precision, text, text[]),
  public.decor_counts(),
  public.fav_create(text, double precision, double precision, text, text, text),
  public.fav_react(text, uuid, text),
  public.fav_reply(text, uuid, text, text),
  public.fav_report(text, text, uuid),
  public.fav_list(text),
  public.fav_replies(uuid),
  public.fav_delete(text, uuid, text)
to anon, authenticated;

-- ------------------------------------------------------------------ optional: pg_cron cleanup every 10 minutes
-- send_mark and zone_counts already delete marks older than 2 hours on every call. If you also want a timer:
--   Database → Extensions → enable pg_cron, then run:
-- select cron.schedule('ltot-cleanup', '*/10 * * * *', $$select public._ltot_cleanup_marks()$$);

-- Make the API notice the new functions right away.
notify pgrst, 'reload schema';
