# London Trick-or-Treat Map: Spec v3 (Oct 17, 2026) — v3 pivot first, then the v2 sections it builds on

Owner: Peng Wu. Builder: Claude Code (headless) on Peng's Mac, in `~/Desktop/万圣节讨糖App`.
Target night: **Saturday, Oct 31, 2026**, London, Ontario. Sunset 6:18 PM EDT. Peak trick-or-treating is about 5:30 to 8:30 PM.
Status: nothing gets published and no online accounts get created by the builder. Section 9 lists what Peng would have to set up himself.

## v3 pivot: "Mark it!" for kids & families (Oct 17, 2026)

**This section replaces 2.3 (house markers), 2.5 (live family dots) and the live part of 2.6 below.** Where the older sections disagree with it, this one wins.

**Who it's for.** Kids and families out trick-or-treating, not candy-giving households. Many users are Chinese families who stay near home, often in neighbourhoods that aren't in the researched list.

**Core loop.**
1. A big glowing arcade button, **"This spot is great! / 这里很热闹！"** (≥ 64 px tall; it's also the centre "Mark it!" tab). Tapping it takes one location fix. If location is off, denied or unavailable, the app says "Tap the map to mark a spot".
2. The position is blurred on the phone (50 m grid plus up to 25 m jitter) **before** it is sent or stored. The mark gets a random session id that rotates every 30 minutes, optional one-tap tags (🍬 candy, 🎃 decor, 👥 crowded; whitelist), and the time. Marks are deleted after 2 hours.
3. Limits: 1 mark per device per 5 minutes, and 1 per zone per 30 minutes. They're enforced in the app (localStorage history), in the local adapter and in the `send_mark` RPC (by session hash).
4. Marks are counted per **H3 res-8 hexagon anywhere in the London box** (lat 42.85–43.10, lng −81.45 to −81.05), over the last `markWindowMin` minutes (30–60, default 45).
   - Fewer than 3 marks: nothing is shown.
   - 3–5: teal, Quiet.
   - 6–14: orange, Lively.
   - 15+: hot pink, Super hot, with a faster pulse.
   - Each zone gets a "🔥 n marked" badge with the top tag when it's common (≥ 2 marks and ≥ 30%).
   - **NEW / 新发现** shows for 30 minutes after the 3rd mark.
5. Rendering: live zones are SVG hexagons in their own pane, pulsing through CSS opacity animations with no per-frame JS. Only zones in the viewport are drawn, up to 150 zones and 40 badges. Zoomed out, the badges are compact.
6. Updates: local and demo mode use BroadcastChannel + localStorage and recount every 12 s. With Supabase, the app calls `zone_counts(window)` every 30–60 s, and it returns only cells with count ≥ 3.
7. **Live window**: Oct 31, 3–11 PM Toronto. Outside it, marks stay in the local adapter as practice and a "Practice mode" chip is shown.

**Secondary layers.** The researched areas become "Good areas to start / 推荐出发区". They're drawn as a faint, dashed "Suggested" base layer, with the planning score (0.7 × research + 0.3 × board votes) on one canvas **below** the live zones. They never hide or dim a live zone.
- **Suggest an area / 推荐一个区域**: before the night, families pin a neighbourhood with a reason of 80 characters or fewer (no links or phone numbers). Only the res-8 hexagon is kept. A hexagon with 3+ suggestions becomes 💜 "Community suggested". Limits: 3 per device per day, 1 per hexagon.
- **Near me / 我附近**: live zones within 1, 2 or 5 km (default 2), nearest first. Tapping a row flies there, and 🚶 plans a walk to it. Without location, the list is sorted from the map centre and says so.

**Navigation.**
- Bottom tabs: Map / Route / Mark it! / Guide.
- Layer chips: Zones, Areas, Events, plus a "Near me" action.
- The Board stays, as a 🏆 top-bar icon and a link in the Guide tab.
- Safety, language toggle, Show my location and the Route planner are kept.

**Removed.** Add my house, house filters and statuses, house markers, share links (`#m=`), the Live tab and the opt-in family dots. This removes their code, tests and Supabase tables/RPCs.

**Guide.** Three welcome cards (key `ltot.guideSeen.v2`):
1. See where it's fun!
2. Found a great spot? Tap the big button!
3. Plan your walk & stay safe.

Card 1 and the How-to panel include "Your area isn't on the map? Mark it! Once 3 people mark it, it lights up." There are ⓘ hints next to the big button (shown until the first mark) and the legend. URL params: `?guide=1`, `?howto=1`, `?lang=zh|en`, `?demo=1`, `?demo=1&near=1`.

**Backend.** `backend.js`:
- `sendMark` (blurs, then hands the mark to an adapter), `tagMark`, `liveZoneCounts`, `listZones`, `suggestArea`, `communitySuggested`, plus the board methods.
- `supabase/schema.sql` tables: `marks` and `suggestions` (RLS on, no direct anon access).
- RPCs: `send_mark`, `tag_mark`, `zone_counts(window_min)` (only n ≥ 3, with top tag and first-lit time), `suggest_area`, `community_suggested()` (only n ≥ 3).
- Marks are cleaned up after 2 hours. `tests/sql_pglite_check.mjs` tests all of it.

## 1. Goals
1. Help parents pick the best neighbourhood and walk a good loop with their kids.
2. Let families share what's good tonight: houses giving candy, teal pumpkins, full-size bars, great decorations, and "out of candy".
3. On the night, show where the action is, on a live hotspot map and as anonymous dots that people opt in to.
4. Keep it free, fast on phones, private, and still working when the backend is down.

## 2. Requirements

### 2.1 Existing features (v1, keep)
- Leaflet + OSM map, EN/中文 toggle, locate-me blue dot, route planner (OSRM foot profile with a straight-line fallback), pins in localStorage and shared by URL, safety tips, countdown.

### 2.2 Researched areas (replaces the seed data)
- Load `areas_researched.json`: 10 areas, sources from Oct 2024 to Oct 2026 only, each source with its date.
- Each area popup shows its scores, notes, cautions, and source links with dates.
- Label: "Based on local news and parent reports, 2026" / "根据本地新闻和家长反馈整理，2026".
- Score mapping: in the JSON, crowd 5 means comfortable. The app's internal `crowd` means 5 = very busy, so app `crowd = 6 - json.crowd`.

### 2.3 House markers (opt-in, by the person at that house)
- Types:
  - 🍬 giving candy
  - 🩵 teal pumpkin (non-food or allergy-friendly treats, FARE Teal Pumpkin Project)
  - 🍫 full-size bars
  - 🎃 great decorations
  - 🐶 pet treats
  - 🕔 open early (for little kids)
- Optional hours (start and end time).
- Status the owner can change in one tap: **Giving now**, **Starting later**, or **Out of candy** (shown greyed out). Only the device that created the marker can change it, using an edit token kept in localStorage.
- The marker stores lat/lng and an optional note of 140 characters or fewer. It stores no names, phone numbers, photos, or house numbers. The UI warns: "Don't post your name or your kids' names".
- Markers expire automatically on Nov 1, 2026 at 6:00 AM Toronto time.

### 2.4 Shared board (posts and votes)
- Two boards: **Most fun neighbourhood** and **Best decorations**.
- A post has a category, an optional area_id, an optional rough location, and text of 140 characters or fewer.
- Users can upvote (one vote per device per post) and report.
- A post with 3 or more reports is hidden automatically.
- Sort by Top (votes) or New. A per-area vote total feeds the hotspot map (2.6).

### 2.5 Live family dots (Oct 31 only, opt-in)
- Off by default. Turning it on needs an explicit toggle with clear text: "Share an anonymous dot so other families can see where it's busy. No name, rough location only, disappears after 30 minutes."
- It only works on **Oct 31, 2026, 3:00 PM to 11:00 PM America/Toronto**. Outside that window the toggle is disabled and shows "Opens Halloween night". A `?demo=1` flag is allowed for local testing only.
- The client sends a position at most once every 60 s, and only while the page is visible.
- Before sending, the location is coarsened: snapped to a grid of about 50 m, with jitter of up to 25 m.
- The session id is random and rotates every 30 minutes. It isn't linked to a device or an account.
- A dot expires 30 minutes after its last update. The server rejects points outside the London bounding box or outside the time window.
- The user's own dot is never echoed back as a separate marker. Other people's dots are drawn as small, plain anonymous circles with no trails and no history.
- Sharing stops automatically after 90 minutes, and the user has to turn it on again to keep going.

### 2.6 Hotspot map (busy areas, like a ride-share driver heat map)
- A toggleable layer of glowing hexagons. Use the H3 grid through `h3-js` (UMD from a CDN) at resolution 8, with a fallback hex grid computed locally if h3-js fails to load.
- Colour scale with a legend:
  - **Quiet**: dim teal
  - **Busy**: orange
  - **Very busy**: red-magenta with glow (CSS `filter: drop-shadow` on the SVG path)
- **Before Oct 31 (planning mode):** each hex's score is
  `0.5 × researched area score` + `0.3 × normalised board votes` + `0.2 × normalised pins`.
  - The researched area score is the mean of candy, decorations, and safety, spread across hexes within the area radius.
  - Board votes are counted for the area.
  - Pins count the giving and decoration markers in the hex.
- **On Oct 31 (live mode, 3 PM to 11 PM):** the score is the count of opt-in dots in each hex over the last 20 minutes (configurable from 15 to 30).
  - **Privacy floor:** a hex is drawn only when count ≥ 3. Smaller counts render as "no data".
  - The server does the aggregation (RPC `live_hex_counts`) and returns only hexes with 3 or more dots. A blend of the planning score is shown at 30% opacity under it, so the map is never empty.
- Performance:
  - Recompute at most every 60 s.
  - Cap the layer at 400 hexes and draw only hexes inside the viewport.
  - Use a single canvas or SVG renderer and no per-hex DOM listeners. Tapping a hex finds it by lat/lng with `latLngToCell`.

## 3. Architecture
- **Static front end:** `index.html`, `app.js`, `styles.css`, plus new files:
  - `config.js` holds the backend settings
  - `backend.js` is the data-access layer
  - `hex.js` builds the hotspot layer
  - `data/areas_researched.json` holds the area data
- No build step. It must work from `file://` and from `python3 -m http.server`.
- `config.js`:
  ```js
  window.TOT_CONFIG = {
    backend: 'local',            // 'local' | 'supabase'
    supabaseUrl: '',             // e.g. https://xxxx.supabase.co  (Peng fills in)
    supabaseAnonKey: '',         // public anon key only, never the service_role key
    liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
    dotTtlMin: 30, hexWindowMin: 20, hexMinCount: 3, pollSec: 60
  };
  ```
- `backend.js` exposes one interface with two adapters: `listMarkers`, `upsertMarker`, `setMarkerStatus`, `listPosts`, `createPost`, `vote`, `report`, `sendDot`, `listDots`, and `liveHexCounts`.
  - **LocalAdapter** (the default and the fallback) uses localStorage, plus `BroadcastChannel` so two tabs can demo the "other users" features. It runs hex aggregation on the client.
  - **SupabaseAdapter** uses supabase-js v2 from a CDN and talks only to RPCs and RLS-protected tables.
  - If a Supabase call fails or times out after 5 s, it switches to the local adapter, shows a small "offline mode" chip, and retries every 2 minutes.
- **Polling, not realtime sockets, for dots and hexes.** On the Supabase free plan, Realtime allows 200 concurrent connections and 100 messages per second, and broadcast fan-out grows with the square of the number of users. REST/RPC polling once a minute scales linearly, and API requests are unlimited on the free plan. Board posts can use polling too, every 60 s.
- Offline: cache the last data in localStorage. OSM tiles go through the browser cache.

## 4. Data model (Supabase Postgres; put it in `supabase/schema.sql`)
```sql
create table markers (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null, lng double precision not null,
  types text[] not null,              -- candy, teal, fullsize, decor, pet, early
  status text not null default 'giving' check (status in ('giving','later','out')),
  note text check (char_length(note) <= 140),
  start_time time, end_time time,
  edit_token_hash text not null,      -- sha256 of client token
  created_at timestamptz default now(),
  expires_at timestamptz not null default '2026-11-01 06:00-04'
);
create table posts (
  id uuid primary key default gen_random_uuid(),
  board text not null check (board in ('fun','decor')),
  area_id text, lat double precision, lng double precision,
  body text not null check (char_length(body) between 1 and 140),
  votes int not null default 0, reports int not null default 0,
  hidden boolean generated always as (reports >= 3) stored,
  created_at timestamptz default now()
);
create table votes (post_id uuid references posts on delete cascade, voter text not null, primary key (post_id, voter));
create table live_dots (
  session_id text primary key,
  lat double precision not null, lng double precision not null,  -- already coarsened by client; server re-rounds to 4 decimals
  h3_r8 text,                         -- computed by client, validated length
  updated_at timestamptz not null default now()
);
```
- RLS is on for every table. The anon role can't write tables directly; all writes go through `security definer` RPCs that check their inputs:
  - `upsert_marker`, `set_marker_status(id, token)`, `create_post`, `vote_post(post_id, voter)`, `report_post`
  - `send_dot(session, lat, lng, h3)`: checks the London box (lat 42.85 to 43.10, lng -81.45 to -81.05), checks the Oct 31 window, and rounds coordinates
  - `live_dots_recent()`: returns only dots updated in the last 30 minutes
  - `live_hex_counts(window_min)`: returns `h3_r8, count` where count ≥ 3
- Selects on `markers` and `posts` are allowed when the row isn't expired or hidden. There is no select on raw `votes`.
- Cleanup: the RPCs delete expired dots on each call (a cheap `delete … where updated_at < now() - interval '30 min'`). Optionally, `pg_cron` runs it every 5 minutes.
- Simple rate limits inside the RPCs: one dot per session every 30 s, five posts per voter per hour.

## 5. Free backend choice
- **Supabase Free**, chosen:
  - Postgres with RLS and RPCs, 500 MB database, unlimited API requests, 50k monthly active users
  - Realtime: 200 concurrent connections, 2M messages a month, 100 messages per second (not needed, since we poll)
  - Canada region (`ca-central-1`) available
  - Caveat: **free projects pause after 1 week of inactivity**. Open the dashboard or call the API on Oct 29 to 30.
- Firebase Spark, not chosen: the Realtime Database has a hard limit of **100 simultaneous connections**, it's NoSQL with no SQL aggregation for the hexes, and when you go over a Spark limit the app gets turned off.

Sources:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/realtime/limits
- https://firebase.google.com/docs/database/usage/limits

## 6. Privacy and safety
- No accounts and no names, emails, phone numbers, or photos in v1. Device ids are random UUIDs in localStorage.
- Live dots are opt-in and anonymous:
  - coarsened to about 50 m, kept for 30 minutes, with no history kept
  - hex counts shown only at 3 or more
  - only on Oct 31 from 3 to 11 PM
  - sharing stops on its own after 90 minutes
- A house marker is posted by the household itself. The help text says to place it on your own house only. Markers expire Nov 1.
- Board text is limited to 140 characters, can be reported (hidden at 3 reports), and runs through a basic profanity and URL filter (links and phone numbers are rejected).
- A privacy page in the app (EN/中文) lists what is collected, how long it's kept, and how to delete your own posts and markers. It's written in the spirit of Canada's PIPEDA rules.
- Delete everything after Nov 2. A `supabase/cleanup.sql` script is provided.
- Safety copy follows the City of London's Oct 29, 2025 notice: reflective gear, groups, sidewalks, and marked crossings.

## 7. Oct 31 load estimate
- Assumption: up to 500 active phones in the peak hour, with 30% sharing dots.
  - **Writes:** 150 × 1 per 60 s ≈ 2.5 requests per second
  - **Reads:** 500 phones × 2 calls (dots and hex counts) per 60 s ≈ 17 requests per second
  - **Board and markers:** 500 per 60 s ≈ 8 requests per second
  - **Total:** about 30 requests per second, which shared-CPU Free Postgres handles at these tiny row counts
- **Data size:** under 1 MB for the night, and egress is far below 5 GB.
- **Tiles:** OSM tile usage policy. Set a proper attribution and don't prefetch tiles. If the user base grows, switch to a free-tier tile provider with an API key.
- **OSRM public demo server:** rate-limited and not for production. Keep the straight-line fallback, and call it only when the user presses Plan.
- **Degradation:** if the backend fails, fall back to local mode. Hexes keep showing planning scores.

## 8. Test plan
1. `node --check` on every JS file. A `tests/` folder uses `node --test` with pure functions pulled into `lib.js`:
   - live-window gating (Toronto timezone, including Oct 31 at 2:59 PM and 11:01 PM)
   - dot expiry and rotation
   - coordinate coarsening
   - bounding-box rejection
   - hex score blend
   - min-count suppression
   - crowd score inversion
2. Local adapter: two tabs with `?demo=1`. Dots and posts appear in the other tab, and the out-of-candy status updates.
3. Headless check: Chrome or `playwright` if installed, otherwise skipped. Load the page with no console errors at 390×844, then toggle each layer.
4. Phone performance: keep the hex layer under 16 ms per redraw on a mid-range phone (log with `performance.now()`), and keep total JS under 150 KB, not counting CDN libraries.
5. Supabase (only after Peng creates a project): run `schema.sql`, then `tests/supabase_smoke.mjs`, which needs the URL and anon key from the environment. It tests RPC validation and RLS, including that anon users can't select votes and can't write tables directly.
6. Load (optional, Peng's project only): `tests/load_sim.mjs` simulates 500 pollers and 150 dot senders for 5 minutes and reports p95 latency and errors.

## 9. Account setup Peng would need (nothing done yet)
1. **Supabase:** sign up at supabase.com (email or GitHub), create a free project named `london-tot` in region Canada (Central), and set a strong database password.
2. In the SQL Editor, run `supabase/schema.sql`.
3. In Project Settings, then API, copy the **Project URL** and the **anon public key** into `config.js`, and set `backend: 'supabase'`. Never use the service_role key in the app.
4. **Hosting, choose one:**
   - Netlify Drop (drag the folder in; free account)
   - GitHub Pages (free GitHub account and a public repo)
5. On Oct 29 to 30, open the Supabase dashboard so the project doesn't get paused for inactivity.
6. On Nov 2, run `supabase/cleanup.sql`, or pause or delete the project.

## 10. Best practices from similar products
| Product | Key features | What users like / complain about | Privacy approach | Link |
|---|---|---|---|---|
| Nextdoor Treat Map (14th year, 2026; US/UK/Canada) | Home pins and local-spot pins. Tags for decorations, events, and businesses. Template wording for pins. Filters for non-food treats, pet treats, and early-open doors. | Liked: route planning and finding events. Complaints: you need a Nextdoor account tied to your real address, pins aren't verified, the map is empty where few neighbours join, and it's sponsor-driven. | Pins are opt-in, and Nextdoor says it collects no location data beyond pins. Its advice: "only visit homes that have opted in." | https://nextdoor.com/treat_map/ · https://ppc.land/nextdoors-halloween-treat-map-gains-pet-and-non-food-treat-filters/ · https://blog.nextdoor.com/nextdoors-13th-annual-treat-map-your-neighborhoods-ultimate-halloween-guide |
| Trick or Treat Map (trickortreatmap.com, UK-based) | "Add your stop" with opening times and the treats offered. Comments, safety flags, and "send thanks". Ghost Mode game. Community-voted competitions. | Liked: kids plan the route "like a treasure hunt", and hosts can set times. | Opt-in hosts and safety flags. | https://www.trickortreatmap.com/ |
| Dulce Halloween (US/Mexico) | **Live status pin:** orange means giving now, grey means later or out of candy. Treat hours, photos, offline caching for crowded networks, contests. | Liked: never arriving at a closed door. | It says it never publishes personal data, phone numbers, or resident identities. | https://dulcehalloween.com/en/ |
| Zillow Trick-or-Treat Index (2009–2017, discontinued) | A data score from home values, single-family density, and the share of kids under 10. Earlier versions also used Walk Score and crime data. | Criticism: no crowdsourcing, and it mostly tells you "where the rich people live" (Wired). | Aggregate data only. | https://zillow.mediaroom.com/2017-10-12-San-Francisco-Tops-the-List-of-Best-Cities-for-Trick-or-Treating · https://www.wired.com/2009/10/zillow-halloween/ |
| FARE Teal Pumpkin Project Map | A teal pumpkin means non-food treats, kept in a separate bowl. Houses and events are mapped so allergy families can plan routes. | Liked: kids with allergies are included and don't have to explain their allergy at every door. | Opt-in addresses. | https://www.foodallergy.org/our-initiatives/awareness-campaigns/teal-pumpkin-project |
| FrightMaps (app, 4.9★ on Google Play) | Filters by scare level, distance, and admission. Routes with up to 13 stops. One-tap "open this year". Contests with voting. | Liked: easy for display owners to promote their house. Complaint: "a bit of a learning curve". | It collects location and personal info, per its Play data-safety listing. | https://frightmaps.com/ · https://play.google.com/store/apps/details?id=com.prolificsoftware.frightmaps&hl=en |
| HalloweenChristmasMaps | Owners **re-verify each season**, so there are no stale listings. Route ordering. No account needed to browse. | Liked: no app or account needed. | "Always respect private property and posted hours." | https://halloweenchristmasmaps.com/ |
| Local: Camp Weathered map (CBC London, Oct 2025) | A hand-painted map of dozens of London displays, digitised by CBC. Many displays collect charity donations. | Liked: strong local community spirit. | Only owners who chose to be listed are on it. | https://www.cbc.ca/news/canada/london/here-s-a-halloween-map-of-the-biggest-scary-houses-to-visit-in-london-9.6944487 |

**Ideas we take from these:**
1. Opt-in house markers with a live **Giving now / Later / Out of candy** status (Dulce).
2. A 🩵 **teal pumpkin** type and filter, plus pet-treat and open-early filters (FARE, Nextdoor).
3. Template wording when adding a marker, with no blank box and a 140-character limit (Nextdoor).
4. Hours on markers, so families know what's open (Trick or Treat Map, Dulce).
5. Markers expire every year, so nothing is stale (HalloweenChristmasMaps).
6. Charity and donation notes for big displays, and an events layer with HitV Oct 24 and Camp Weathered (CBC).
7. Voting on the board, with no prizes and no accounts (FrightMaps, Trick or Treat Map competitions).
8. An offline cache, because phone networks get crowded on busy streets (Dulce).
9. A "visit only homes with lights on or markers, and respect private property" tip (Nextdoor, HCM).
10. No real-address accounts, which avoids Nextdoor's biggest complaint.
