-- =====================================================================================
-- London Trick-or-Treat Map — v7 server update: shared TEST DAYS Oct 17–20, 2026 (America/Toronto)
--                                + reject house numbers/addresses in posts and suggestion reasons
-- Run ONCE in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- Lets send_mark accept marks on Oct 17 00:00 – Oct 21 00:00 Toronto as well as Halloween night (Oct 31, 3–11 PM).
-- It closes by itself on Oct 21 00:00: nothing to undo. Matches testWindow in config.js.
-- =====================================================================================
create or replace function public._ltot_live_open() returns boolean
language sql stable
as $$ select (now() >= timestamptz '2026-10-31 15:00:00 America/Toronto'
          and now() <  timestamptz '2026-10-31 23:00:00 America/Toronto')
          or (now() >= timestamptz '2026-10-17 00:00:00 America/Toronto'      -- test days (Oct 17–20 inclusive)
          and now() <  timestamptz '2026-10-21 00:00:00 America/Toronto') $$;
revoke execute on function public._ltot_live_open() from public, anon, authenticated;

-- Same text rules as checkText() in lib.js v7, plus: no house numbers / addresses ("123 Askin St", "45号").
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
    raise exception 'text:address';
  end if;
  if s ~* '\m(fuck|shit|bitch|cunt|asshole|dickhead|bastard|slut|whore|retard|nigger|faggot)(s|es|ing|ed)?\M'
     or s ~ '(傻逼|操你|他妈的|去死)' then
    raise exception 'text:profanity';
  end if;
  return s;
end $$;
revoke execute on function public._ltot_check_text(text, boolean, int) from public, anon, authenticated;
notify pgrst, 'reload schema';

-- -------------------------------------------------------------------------------------
-- AFTER the test (Oct 21 or later): wipe everything testers created, so none of it carries into Halloween night.
-- Marks also delete themselves 2 hours after they are made (on the next app call), so this is mostly for
-- suggestions, board posts, votes and reports, which do NOT expire on their own. Uncomment and run:
-- begin;
-- delete from public.marks       where created_at < timestamptz '2026-10-21 00:00:00 America/Toronto';
-- delete from public.suggestions where created_at < timestamptz '2026-10-21 00:00:00 America/Toronto';
-- delete from public.posts       where created_at < timestamptz '2026-10-21 00:00:00 America/Toronto';  -- votes/reports go with them
-- delete from public.votes       where created_at < timestamptz '2026-10-21 00:00:00 America/Toronto';
-- delete from public.reports     where created_at < timestamptz '2026-10-21 00:00:00 America/Toronto';
-- commit;
