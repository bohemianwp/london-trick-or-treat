-- =====================================================================================
-- London Trick-or-Treat Map — Supabase schema (SPEC §4)
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run.
--
-- Security model
--   * RLS is on for every table. The anon role cannot INSERT/UPDATE/DELETE any table directly.
--   * All writes go through SECURITY DEFINER functions (RPCs) that validate every input.
--   * anon may SELECT only safe columns of markers (not expired) and posts (not hidden).
--     Token hashes, device/author hashes, votes, reports and live dots are never directly readable.
--   * Live dots: the server re-rounds to 4 decimals, keeps only a hash of the session id,
--     deletes dots after 30 minutes and returns hex counts only when count >= 3.
-- Errors are raised with short codes the app understands:
--   invalid | forbidden | rate | closed | outside | text:<empty|tooLong|url|email|phone|profanity>
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ tables
create table if not exists public.markers (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null check (lat between 42.85 and 43.10),
  lng double precision not null check (lng between -81.45 and -81.05),
  types text[] not null check (cardinality(types) between 1 and 6
                               and types <@ array['candy','teal','fullsize','decor','pet','early']),
  status text not null default 'giving' check (status in ('giving','later','out')),
  note text check (char_length(note) <= 140),
  start_time time,
  end_time time,
  edit_token_hash text not null,                 -- sha256 of the client's random edit token
  device_hash text,                              -- sha256('device:' || random device id), for the 3-per-phone limit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nov 1 06:00 in Toronto. DST ends at 2 AM that morning, so this is 06:00 EST = 11:00 UTC
  -- (the spec's '2026-11-01 06:00-04' would be 05:00 local).
  expires_at timestamptz not null default '2026-11-01 06:00:00 America/Toronto'
);

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

create table if not exists public.live_dots (
  session_id text primary key,                   -- sha256 of the random 30-minute session id (raw id never stored)
  lat double precision not null,                 -- already coarsened by the client; re-rounded to 4 decimals here
  lng double precision not null,
  h3_r8 text check (h3_r8 ~ '^[0-9a-f]{15}$'),   -- H3 resolution-8 cell computed by the client
  updated_at timestamptz not null default now()
);
create index if not exists live_dots_updated on public.live_dots (updated_at);
create index if not exists live_dots_h3 on public.live_dots (h3_r8);

-- ------------------------------------------------------------------ row level security + column grants
alter table public.markers   enable row level security;
alter table public.posts     enable row level security;
alter table public.votes     enable row level security;
alter table public.reports   enable row level security;
alter table public.live_dots enable row level security;

-- Supabase grants everything on new tables to anon/authenticated by default: take it all back first.
revoke all on public.markers, public.posts, public.votes, public.reports, public.live_dots from anon, authenticated;

grant select (id, lat, lng, types, status, note, start_time, end_time, created_at, expires_at)
  on public.markers to anon, authenticated;
grant select (id, board, area_id, lat, lng, body, votes, hidden, created_at)
  on public.posts to anon, authenticated;

drop policy if exists markers_read on public.markers;
create policy markers_read on public.markers for select to anon, authenticated using (expires_at > now());
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select to anon, authenticated using (not hidden);
-- No policies on votes, reports, live_dots: anon can read or write none of them directly.

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
as $$ select now() >= timestamptz '2026-10-31 15:00:00 America/Toronto'
         and now() <  timestamptz '2026-10-31 23:00:00 America/Toronto' $$;

-- Same rules as checkText() in lib.js. Returns the cleaned text (or null for an empty optional note).
create or replace function public._ltot_check_text(p text, p_optional boolean) returns text
language plpgsql immutable
as $$
declare s text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
begin
  if s = '' then
    if p_optional then return null; end if;
    raise exception 'text:empty';
  end if;
  if char_length(s) > 140 then raise exception 'text:tooLong'; end if;
  if s ~* '[^\s@]+@[^\s@]+\.[a-z]{2,}' then raise exception 'text:email'; end if;
  if s ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|ca|net|org|io|ly|co|me|app|info|biz|xyz|link|site|gg|tv|to)\M)' then
    raise exception 'text:url';
  end if;
  if s ~ '(\+?1[\s.-]?)?\(?\m\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\M|\m\d{3}[\s.-]\d{4}\M|\d{7,}' then
    raise exception 'text:phone';
  end if;
  if s ~* '\m(fuck|shit|bitch|cunt|asshole|dickhead|bastard|slut|whore|retard|nigger|faggot)(s|es|ing|ed)?\M'
     or s ~ '(傻逼|操你|他妈的|去死)' then
    raise exception 'text:profanity';
  end if;
  return s;
end $$;

create or replace function public._ltot_cleanup_dots() returns void
language sql
as $$ delete from public.live_dots where updated_at < now() - interval '30 minutes' $$;

-- ------------------------------------------------------------------ RPC: house markers
create or replace function public.upsert_marker(
  p_id uuid, p_lat double precision, p_lng double precision, p_types text[], p_status text,
  p_note text, p_start time, p_end time, p_token text, p_device text default null
) returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
  v_note text;
  v_hash text;
  v_dev text;
  v_types text[];
begin
  if now() >= timestamptz '2026-11-01 06:00:00 America/Toronto' then raise exception 'closed'; end if;
  if p_token is null or char_length(p_token) not between 16 and 128 then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  if p_types is null or cardinality(p_types) not between 1 and 6
     or not (p_types <@ array['candy','teal','fullsize','decor','pet','early']) then raise exception 'invalid'; end if;
  if coalesce(p_status, '') not in ('giving','later','out') then raise exception 'invalid'; end if;
  v_types := array(select distinct t from unnest(p_types) t order by t);
  v_note := public._ltot_check_text(p_note, true);
  v_hash := public._ltot_hash(p_token);

  if p_id is null then
    v_dev := case when p_device is null then null else public._ltot_hash('device:' || left(p_device, 64)) end;
    if v_dev is not null and (select count(*) from public.markers where device_hash = v_dev) >= 3 then
      raise exception 'rate';
    end if;
    if (select count(*) from public.markers where created_at > now() - interval '1 hour') >= 500 then
      raise exception 'rate';                    -- global brake against floods
    end if;
    insert into public.markers (lat, lng, types, status, note, start_time, end_time, edit_token_hash, device_hash)
    values (round(p_lat::numeric, 5)::float8, round(p_lng::numeric, 5)::float8, v_types, p_status, v_note,
            p_start, p_end, v_hash, v_dev)
    returning id into v_id;
  else
    update public.markers
       set lat = round(p_lat::numeric, 5)::float8, lng = round(p_lng::numeric, 5)::float8, types = v_types,
           status = p_status, note = v_note, start_time = p_start, end_time = p_end, updated_at = now()
     where id = p_id and edit_token_hash = v_hash and expires_at > now()
    returning id into v_id;
    if v_id is null then raise exception 'forbidden'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.set_marker_status(p_id uuid, p_token text, p_status text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if coalesce(p_status, '') not in ('giving','later','out') then raise exception 'invalid'; end if;
  update public.markers set status = p_status, updated_at = now()
   where id = p_id and edit_token_hash = public._ltot_hash(coalesce(p_token, '')) and expires_at > now();
  if not found then raise exception 'forbidden'; end if;
  return true;
end $$;

create or replace function public.delete_marker(p_id uuid, p_token text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.markers where id = p_id and edit_token_hash = public._ltot_hash(coalesce(p_token, ''));
  if not found then raise exception 'forbidden'; end if;
  return true;
end $$;

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

-- ------------------------------------------------------------------ RPC: live dots (Oct 31, 3–11 PM Toronto only)
create or replace function public.send_dot(p_session text, p_lat double precision, p_lng double precision, p_h3 text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_sid text;
begin
  perform public._ltot_cleanup_dots();
  if p_session is null or p_session !~ '^[a-f0-9]{16,64}$' then raise exception 'invalid'; end if;
  if not public._ltot_in_box(p_lat, p_lng) then raise exception 'outside'; end if;
  if not public._ltot_live_open() then raise exception 'closed'; end if;
  v_sid := public._ltot_hash(p_session);
  if exists (select 1 from public.live_dots
              where session_id = v_sid and updated_at > now() - interval '30 seconds') then
    return false;                                -- one dot per session every 30 s
  end if;
  if (select count(*) from public.live_dots) >= 5000 then raise exception 'rate'; end if;
  insert into public.live_dots (session_id, lat, lng, h3_r8, updated_at)
  values (v_sid, round(p_lat::numeric, 4)::float8, round(p_lng::numeric, 4)::float8,
          case when p_h3 ~ '^[0-9a-f]{15}$' then p_h3 end, now())
  on conflict (session_id) do update
    set lat = excluded.lat, lng = excluded.lng, h3_r8 = excluded.h3_r8, updated_at = now();
  return true;
end $$;

-- Turning sharing off removes the dot right away.
create or replace function public.remove_dot(p_session text) returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.live_dots where session_id = public._ltot_hash(coalesce(p_session, ''));
  return true;
end $$;

-- Dots updated in the last 30 minutes. Only the hashed session id is returned, so a phone can skip its own dot.
create or replace function public.live_dots_recent()
returns table (sid_hash text, lat double precision, lng double precision, updated_at timestamptz)
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._ltot_cleanup_dots();
  return query
    select d.session_id, d.lat, d.lng, d.updated_at
      from public.live_dots d
     where d.updated_at > now() - interval '30 minutes'
     limit 3000;
end $$;

-- Dot counts per H3 cell over the last 15–30 minutes, ONLY for cells with 3 or more dots (privacy floor).
create or replace function public.live_hex_counts(p_window_min int default 20)
returns table (h3_r8 text, n int)
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_w int := least(30, greatest(15, coalesce(p_window_min, 20)));
begin
  perform public._ltot_cleanup_dots();
  return query
    select d.h3_r8, count(*)::int
      from public.live_dots d
     where d.h3_r8 is not null and d.updated_at > now() - make_interval(mins => v_w)
     group by d.h3_r8
    having count(*) >= 3
     order by 2 desc
     limit 400;
end $$;

-- ------------------------------------------------------------------ who may call what
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.upsert_marker(uuid, double precision, double precision, text[], text, text, time, time, text, text),
  public.set_marker_status(uuid, text, text),
  public.delete_marker(uuid, text),
  public.create_post(text, text, double precision, double precision, text, text, text),
  public.vote_post(uuid, text),
  public.report_post(uuid, text),
  public.delete_post(uuid, text),
  public.send_dot(text, double precision, double precision, text),
  public.remove_dot(text),
  public.live_dots_recent(),
  public.live_hex_counts(int)
to anon, authenticated;

-- ------------------------------------------------------------------ optional: pg_cron cleanup every 5 minutes
-- The RPCs already delete expired dots on every call. If you also want a timer:
--   Database → Extensions → enable pg_cron, then run:
-- select cron.schedule('ltot-cleanup', '*/5 * * * *',
--   $$delete from public.live_dots where updated_at < now() - interval '30 minutes'$$);

-- Make the API notice the new functions right away.
notify pgrst, 'reload schema';
