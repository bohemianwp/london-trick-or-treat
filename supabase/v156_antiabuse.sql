-- =====================================================================================
-- London Trick-or-Treat Map: v15.6 anti-abuse tightening (for app v15.7) · 防虚假标记小调整
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again. Changes no tables and no data.
--
-- What it changes (3 functions; same names, arguments and grants, so older app versions keep working):
--   1. zone_counts: a zone lights up only with 3+ marks from 3+ DIFFERENT sessions (before: 3+ marks).
--   2. fav_react:   a phone cannot 👍/❤️ its own favourite-street pin (raises 'own').
--   3. vote_post:   a phone cannot vote for its own post (raises 'own').
-- Unchanged: 1 mark per session per 5 min, same zone once per 30 min, 3 reports hide, all daily caps,
-- the global brakes, and the 2-hour deletion of marks.
-- =====================================================================================

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
      select m.h3_r8 as hx, m.tags as tg, m.session_hash as sid
        from public.marks m
       where m.created_at > now() - make_interval(mins => v_w)
    ), lit as (                                   -- v15.7: 3+ marks from 3+ different sessions
      select w.hx, count(*)::int as cnt from w group by w.hx having count(*) >= 3 and count(distinct w.sid) >= 3
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
  if exists (select 1 from public.fav_pins f where f.id = p_pin and f.device_hash = v_dev) then
    raise exception 'own';                       -- v15.7: no 👍/❤️ on your own pin
  end if;
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
  if exists (select 1 from public.posts where id = p_post_id and author_hash = v_who) then
    raise exception 'own';                       -- v15.7: no voting for your own post
  end if;
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

notify pgrst, 'reload schema';

-- Check: this last line should show "v15.6 anti-abuse ready", 3, true.
select 'v15.6 anti-abuse ready' as status,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and ((p.proname = 'zone_counts' and p.prosrc like '%count(distinct w.sid) >= 3%')
             or (p.proname in ('fav_react', 'vote_post') and p.prosrc like '%raise exception ''own''%'))) as changed_functions,
       has_function_privilege('anon', 'public.zone_counts(int)', 'execute')
         and has_function_privilege('anon', 'public.fav_react(text, uuid, text)', 'execute')
         and has_function_privilege('anon', 'public.vote_post(uuid, text)', 'execute') as anon_can_run;
