# DEVLOG: Mark it! London Trick-or-Treat Map / 万圣节讨糖地图

> **DRAFT.** Written from `git log -p`, REVIEW_safety_legal.md, the SUMMARY_* files and the build notes. It will be extended with the full conversation transcript.
> All times are Toronto time (EDT, UTC-4). Everything below happened on Saturday, Oct 17, 2026.

Live: https://bohemianwp.github.io/london-trick-or-treat/ · Repo: bohemianwp/london-trick-or-treat (GitHub Pages from `main`)

## What it is
A free, no-sign-up, bilingual (EN / 中文) map for families in London, Ontario.
- **Before Halloween**, parents mark streets with great decorations and pin favourite streets from past years.
- **On Oct 31 (3–11 PM)**, they tap one button to say "this street is fun right now". Streets with 3+ recent marks light up live, so other families can see where it's lively.
- **Privacy:** street level only (hexagons about 800 m wide, positions blurred to about 50 m), no names, photos or accounts. Everything shared is deleted by Nov 2.

## Stack
- **App:** a static site (no build step). Leaflet + OpenStreetMap tiles with a dark filter; h3-js for hexagons, with a local hex-grid fallback.
- **Code:** `lib.js` (pure logic, UMD, unit-tested), `backend.js`, `app.js`, `i18n.js` (every string EN + ZH), `hex.js`, `tour.js`, `demo.js` (`?demo=1` sample data, phone-only) and `sfx.js` (v14).
- **Backend adapters:** `LocalAdapter` (phone only) and `SupabaseAdapter`. The app falls back to local by itself when Supabase is slow or down, and retries every 2 minutes.
- **Supabase:** RLS on every table; anon has no table grants. The app talks only through SECURITY DEFINER RPCs that check input, rate limits, the London box and the time windows. Only the public anon key is in `config.js`.
- **Tests:**
  - `node --test tests/`: unit tests (101 at v14).
  - `tests/headless_check.mjs`: a headless Chrome walk-through of the whole app (145 checks at v14).
  - `tests/sql_pglite_check.mjs`: real Postgres 17 in WebAssembly with Supabase-style roles (150 checks at v14).
  - `tests/supabase_smoke.mjs`: read-mostly checks against the live project.
- **Cache busting:** `APP_VERSION` in lib.js must equal every `?v=` in index.html; tests enforce this.

## Timeline

### v2: first map (16:46, d445759)
- A planning map: researched areas, events, a parent board, a route planner by age (pace: under-5 1.5 km/h up to teens 3.0 km/h), a safety panel, EN/ZH.
- OSM tiles with a dark filter (16:51) and cache-busting (16:53).

### v3: "Mark it!" for kids & families (17:45, 456427a)
- **The big button:** one location fix, blurred on the phone (50 m grid + up to 25 m jitter) before any adapter sees it.
- **Limits:** 1 mark per 5 min and 1 per zone per 30 min, enforced in the app, the local adapter and `send_mark`.
- **Live zones:** H3 res-8 hexagons from marks in the last 45 min. A zone appears only at 3+ marks (privacy floor), shows a NEW badge for 30 min, and is drawn with CSS animation only (no per-frame JS).
- **Other:** Near me, Suggest an area, new welcome cards, and a 4-tab layout (Map / Route / Mark it! / Guide). The house-level UI was removed.

### v=6: live-seconds countdown, feedback, tour (18:01, 14dadef)
- Countdown to Oct 31 5 PM with fixed-width units, so ticking never shifts the line. `role="timer"`.
- 💬 Feedback by mailto (no backend), route stamina/start-time hints, and a ≈houses estimate.
- ▶ How to use: a 26 s auto-play spotlight tour.
- Tests at this point: 68 unit, 107 headless.

### v=7 (18:16, 382145e) and v=8 (18:29, 263042d)
- **v=7:** demo framing and badge declutter.
- **v=8:** Supabase on.
  - Shared **test days Oct 17–20** with a banner.
  - An address / house-number filter on both client and server.
  - Teal Pumpkin (allergy) tip.
  - Privacy notice (PIPEDA principles) and OSM attribution.
  - Server update in `supabase/v7_update.sql`.

### v=9: language chooser (18:48, 4c081f9)
- The first visit asks English / 中文. English is the default, and the browser language is never used to guess. `?lang=` presets it. Privacy contact added.

### v=10: parent-focused sharing (19:25, 573269a)
- Honest progress card ("2 more marks and this street lights up").
- Phone-only badges (Street Scout / Neighbourhood Guide / Halloween Hero).
- A gentle curb hint: "Waiting for the kids? Share this street." No push notifications.

### v=11: Best decorations / 最佳装饰 (19:50, f8df7b8)
- **Decoration marks:** a purple layer, zone level only, with preset tags (spooky / funny / lights / must-see) and no free text.
- **Privacy:** a street shows only at 3+ marks. Only sha256 of device + day is stored, so different days can't be linked.
- **Retention:** 14 days, all deleted by Nov 2.
- **Server:** `supabase/v11_decor.sql` (send_decor, decor_counts), run via a UTF-8 paste page.

### v=12: popup placement (20:04, 5836a66)
- Popups open below the top-right buttons; size budget 250 KB.

### v=13: two phases explained (20:48, 0d97dd9)
- A phase banner and explainer: "Now: mark the best decorations · Oct 31: mark the most fun streets", plus a "What's different on Oct 31" section.
- The big button changes by phase: purple "Cool decorations here!" before Oct 31, orange "Great street? Share it!" on the night.
- Thank-you cards close after about 8 s and pause while touched.
- Gift line: "Every mark, like and comment helps another family have a happier, more magical Halloween 🎃".

### v=14: Best streets from past years / 往年最佳街区 + sounds (21:29, 4089641)
- **Board:**
  - Speech-bubble pins at street level (snapped to about 50 m on the server).
  - One required preset tag (Most festive / Lots of candy / Great for little kids / Easy walking), an optional note of 80 characters or fewer, and replies of 60 or fewer.
  - 👍 and ❤️ once each per phone.
  - ⚑ Report: 3 reports hide a pin or reply. Authors can delete with a token kept on their phone.
  - Bubbles grow gently with likes and cluster when zoomed out. Gift-line toasts after a like, reply or post.
- **Server filters (EN + ZH):** phones, emails, links, addresses, house numbers (including 号/栋/单元/室/门牌), Canadian postal codes, full-width digits and a longer profanity list.
- **Rate limits:** 5 pins, 20 replies, 200 reactions and 20 reports per phone per day, plus global brakes.
- **Oct 31 (3–11 PM):** the past-years pins stay as a record and ask "🏆 12 families remember this street as unforgettable · 🔥 How is it tonight? Tap to share!" Tapping leads into the normal fun-street mark.
  - The count is distinct phones (author + 👍/❤️), aggregate only, and appears only at 3 or more.
  - When the street's zone is lit, both counts show.
- **Safe rollout:**
  - The client shows the board only after the server has answered.
  - Until `supabase/v14_board.sql` ran, the live site hid the board automatically (the server answered PGRST202) and kept the v13 copy.
  - `favBoard: false` in config.js turns it off.
  - The SQL ran in the Supabase SQL Editor at about 22:00. Its result row was `v14 board ready | 4 | 7`.
- **Sounds:**
  - Four short, gentle sounds under 1 s: a soft ghost "boo" for a fun-street mark, a twinkle for decorations, a chime for likes/replies/posts, and a small fanfare for a badge.
  - Synthesised with Web Audio: no files, no licences, quiet (volume 0.14).
  - They play only within 20 s of a real tap. 🔊/🔇 in the top bar, remembered, ON by default.
- **Retention:** writes are open Oct 17 to Nov 1. Everything is deleted from Nov 2 00:00, checked on every call; `supabase/cleanup.sql` also empties the tables.

### v=14: tidy design system (21:57, 5b0aa06)
Peng said the colours and fonts didn't look clean. With no behaviour change:
- **Type:** one system font stack (Inter-like; PingFang / Noto Sans SC for Chinese), 3 text sizes (13 / 16 / 20 px), 2 weights.
- **Colour:** calm navy, with orange for fun streets and purple for decorations, plus greys. The heat ramp is grey → light orange → deep orange.
- **Neon:** glows, text-shadows, gradients and the radar sweep are removed.
- **Chrome:** line icons in the tab bar and top bar, colour dots on the layer chips, one button shape, an 8 px grid.
- **Contrast:** every core text pair passes WCAG AA. The old gift line was 2.9:1 and is now 7.6:1.
- **Tests:** `tests/design.test.js` guards these rules.
- **Fix:** zoomed-out board pins showed as oversized boxes; they're now small pills.
- Before/after pairs are in `halloween_app/screenshots/compare/`.

### v=14.1: polish after live check (about 22:15)
- Board list rows keep the 👍/❤️ counts inside the row; tidier popup ✕.

### Posters (about 22:00)
- 1080×1920 (WeChat/RedNote) and 1080×1080 (X/LinkedIn), bilingual, in the new style, with a real app screenshot (sample data, labelled as such).
- The QR code decodes to the plain link. Rendered with Noto Sans CJK SC and checked glyph by glyph.

## Safety & privacy principles (kept throughout)
- **Street level only:** never a house, no names, photos or accounts. Privacy floors of 3 for every public count.
- **Grown-ups only:** text is filtered on the server (the client mirrors it), with no DMs or profiles.
- **Short retention:** fun-street marks 2 h, decorations 14 days, everything by Nov 2, 2026.
- **No dark patterns:** no push, no streaks, no leaderboards of people. Sounds and animations respect taps and `prefers-reduced-motion`.
- **Least privilege:** only the public anon key in the app; every server write goes through a validated RPC.
- Full review: `halloween_app/REVIEW_safety_legal.md` (PIPEDA principles, ethics, accessibility, addenda for v11 and v14).

## How server changes were shipped
1. Write the SQL (idempotent) and test it in PGlite: on a fresh schema, on a copy of production, and running it twice.
2. Build the client so it is harmless until the SQL exists.
3. Serve a UTF-8 paste page and run it in the Supabase SQL Editor. Check the final status row.
4. Smoke-test the live project, push, wait for Pages, and check live with headless Chrome at 390×844.

## Open items
- `~/Desktop/万圣节讨糖App` on Peng's Mac needs a `git pull`.
- The full smoke run leaves one test suggestion, which anon can't delete. Remove it with the one-line SQL (`halloween_app/sqlserve/v14_smoke_cleanup.txt`) or `supabase/cleanup.sql`.
- After the test days (Oct 21), wipe test-day fun-street marks (see `supabase/v7_update.sql`).
- For Halloween night, consider a keyed tile provider if traffic is high (OSM tile policy).
