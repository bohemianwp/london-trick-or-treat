-- =====================================================================================
-- London Trick-or-Treat Map: v14 server update, "Best streets from past years / 往年最佳街区" board
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- Needs schema.sql (v3+) already installed: it reuses _ltot_hash, _ltot_in_box and _ltot_check_text.
--
-- What it adds
--   * public.fav_pins: a pin on a STREET, never a house. The server snaps every pin to a ~50 m grid
--     (lat step 0.00045, lng step 0.0006) whatever the phone sends. A required preset tag
--     (festive | candy | littlekids | walking) and an optional note of at most 80 characters.
--   * public.fav_replies: short replies (at most 60 characters) under a pin.
--   * public.fav_reactions: 👍 (like) and ❤️ (heart), at most one of each per phone per pin.
--   * public.fav_reports: one report per phone per pin/reply; 3 reports hide it.
--   * Text filter (EN + ZH): no emails, links, phone numbers, addresses, house numbers, postal codes,
--     or profanity (fav text: the shared _ltot_check_text plus stricter house-number rules).
--   * No names, no accounts, no photos. Phones are known only by sha256('fav:' || random device id).
--   * Limits: 5 pins and 20 replies per phone per Toronto day, 200 reactions, 20 reports, plus global brakes.
--   * Pins, likes and replies stay as a record through Halloween night (Oct 31) for the "how is it tonight?" prompt.
--   * Writes are open Oct 17, 2026 00:00 to Nov 1, 2026 00:00 Toronto. EVERYTHING is deleted from
--     Nov 2, 2026 00:00 Toronto (checked on every call; cleanup.sql also empties the tables).
--   * RLS on, anon cannot read or write any fav_* table directly; only the 7 RPCs below are callable.
-- Error codes: invalid | forbidden | rate | closed | outside | text:<empty|tooLong|url|email|phone|address|profanity>
-- =====================================================================================

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
revoke execute on function public._ltot_fav_open(), public._ltot_cleanup_fav(),
  public._ltot_fav_snap(double precision, double precision), public._ltot_today_start(),
  public._ltot_fav_text(text, boolean, int) from public, anon, authenticated;
revoke execute on function
  public.fav_create(text, double precision, double precision, text, text, text), public.fav_react(text, uuid, text),
  public.fav_reply(text, uuid, text, text), public.fav_report(text, text, uuid), public.fav_list(text),
  public.fav_replies(uuid), public.fav_delete(text, uuid, text) from public;
grant execute on function
  public.fav_create(text, double precision, double precision, text, text, text), public.fav_react(text, uuid, text),
  public.fav_reply(text, uuid, text, text), public.fav_report(text, text, uuid), public.fav_list(text),
  public.fav_replies(uuid), public.fav_delete(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Check: this last line should show "v14 board ready" with 4 tables and 7 RPCs.
select 'v14 board ready' as status,
       (select count(*) from pg_tables where schemaname = 'public' and tablename like 'fav\_%') as tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('fav_create','fav_react','fav_reply','fav_report','fav_list','fav_replies','fav_delete')) as rpcs;
