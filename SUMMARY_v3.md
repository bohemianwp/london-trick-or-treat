# v3 summary: "Mark it!" for kids & families (Oct 17, 2026)

The app now serves **kids and families out trick-or-treating**, not candy-giving households. The earlier stopped run left an unfinished guide/How-to/hints and the Argyle removal in the working tree. I kept the Argyle removal and the guide mechanics (swipe, focus trap, Esc, URL params) and rewrote everything else for the pivot.

## What changed

**Core: the big button "This spot is great! / 这里很热闹！"**
- The button is 72 px tall and glows like an arcade button. The centre **Mark it!** tab runs the same flow.
- It takes one location fix. The first time, a short dialog explains why the browser will ask. If location is denied or unavailable, the banner says "Tap the map to mark a spot" and the user taps the map instead.
- `backend.sendMark` blurs the position (50 m grid + up to 25 m jitter) **before** either adapter sees it, so the raw position is never stored or sent.
- After marking, a "Marked! 🎉" card offers one-tap tags 🍬 / 🎃 / 👥, or skip. A CSS particle burst and a button pulse play; both are off with `prefers-reduced-motion`.
- Limits: 1 mark per 5 min and 1 per zone per 30 min. They're checked in the app (with a kind "try again in N min" message), in the local adapter, and in the `send_mark` RPC.
- Outside Oct 31 3–11 PM: **🧪 Practice mode**. Marks stay local even when Supabase is configured.

**Zones (citywide)**
- Zones are H3 res-8 hexagons anywhere in the London box, built from marks in the last `markWindowMin` minutes (config, 30–60, default 45). Text that mentions the window follows the config.
- A zone shows only at 3+ marks:
  - 3–5: teal, Quiet
  - 6–14: orange, Lively
  - 15+: hot pink, Super hot, with a faster flash
- Badges read "🔥 23 marked" / "🔥 23 人标记", with the top-tag emoji. Zoomed out they're compact ("🔥 23") and sit above the hexagon so the glow stays visible.
- **NEW / 新发现** shows for 30 min after a zone first reaches 3. NEW zones also get a dashed outline.
- Rendering: SVG paths with CSS opacity animation and no per-frame JS. Only zones in the viewport are drawn, up to 150 zones and 40 badges.
- Refresh: local/demo mode recounts every 12 s and instantly on BroadcastChannel. Supabase mode polls `zone_counts` every 30–60 s.

**Secondary layers**
- Researched areas are now "🧭 Good areas to start / 推荐出发区": dashed outlines with a muted fill and a "Suggested" tag.
- The faint planning score (0.7 research + 0.3 board votes) is drawn on one canvas in a pane **below** the live zones. Badges sit above area labels.
- **📍 Near me / 我附近**: live zones within 1/2/5 km, nearest first. Tap a row to fly there; 🚶 plans a walk to the zone. If location is off, the list sorts from the map centre and says so.
- **📌 Suggest an area / 推荐一个区域**: tap the map and add an optional reason (80 characters or fewer; links and phone numbers rejected). Only the hexagon is kept. At 3 suggestions it shows as **💜 Community suggested**. Limits: 3 per device per day, 1 per hexagon.

**Navigation and guide**
- Tabs: **Map / Route / Mark it! / Guide**. Layer chips: Zones, Areas, Events, plus the Near me action.
- The Board is now secondary: the 🏆 icon in the top bar and a button in the Guide tab.
- Safety, the language toggle, Show my location and Route are unchanged.
- New welcome cards (`ltot.guideSeen.v2`, so v1 users see them once):
  1. See where it's fun!
  2. Found a great spot? Tap the big button!
  3. Plan your walk & stay safe.
- "Your area isn't on the map? Mark it! Once 3 people mark it, it lights up." appears in card 1, the How-to panel and the Map panel, in EN + 中文.
- How-to has 13 short sections. ⓘ hints sit next to the big button (until the first mark) and the legend.
- URL params: `?guide=1`, `?howto=1`, `?lang=zh|en`, `?demo=1`, `?demo=1&near=1`.

**Removed (code deleted, not flagged off):** Add my house, house filters/statuses/markers, share links, the Live tab and family dots. Their i18n strings, CSS, tests and Supabase tables/RPCs went with them; re-running `schema.sql` on an old database drops them and keeps board posts. The past Argyle event (Oct 17) stays removed.

**Demo (`?demo=1`)**
- Zones of 4–23 marks around Old South/Baker St, Wortley, Old North, Carling Heights and Ferndale.
- **Hot NEW zones in Hyde Park and Lambeth**, which have no researched area nearby.
- A 2-mark cell in Pond Mills that stays hidden under the 3+ rule.
- One 💜 community-suggested hexagon (Masonville area).
- A new fake mark every ~4 s, so counts tick up while you watch.

**Backend:** `backend.js` adds `sendMark`, `tagMark`, `liveZoneCounts`, `listZones`, `suggestArea` and `communitySuggested`. `supabase/schema.sql` adds:
- tables `marks` and `suggestions` (RLS, no direct anon access)
- `send_mark` (London box, live window, rate limits, tag whitelist)
- `tag_mark`
- `zone_counts(window_min)` (n ≥ 3 only, with top tag and first-lit time; marks deleted after 2 h)
- `suggest_area`
- `community_suggested()` (n ≥ 3 only)

`cleanup.sql`, `supabase/README.md`, `tests/supabase_smoke.mjs` and `tests/load_sim.mjs` are updated to match.

**Other:** every asset is `?v=5`; README is EN/中文; SPEC.md has a "v3 pivot" section. The task prompt files `CLAUDE_TASK_guide.md` and `CLAUDE_TASK_pivot.md` were added to `.gitignore`, like `CLAUDE_TASK_v2.md` before them.

## Test results (Oct 17, 2026, on Peng's Mac)

| Check | Result |
|---|---|
| `node --check` on every JS / MJS file | all OK |
| `node --test tests/*.test.js` | **48 passed, 0 failed** |
| `tests/headless_check.mjs` (headless Chrome, 390×844) | **71 passed, 0 failed**; screenshots in `/tmp/ltot-test/v3-*.png` |
| `tests/sql_pglite_check.mjs` (real Postgres in WebAssembly) | **75 passed, 0 failed** |
| `supabase_smoke.mjs` / `load_sim.mjs` | Syntax OK. They refuse to run without credentials and refuse secret keys (exit 2, nothing sent). **Not run against a real project** (none exists). |

What the unit tests (`tests/zones.test.js`) cover:
- zone colour thresholds
- the 3+ suppression
- the mark window and its 30–60 clamp
- both rate limits
- blurring before storage (the raw coordinates are absent from storage)
- the tags whitelist
- marks in **Hyde Park, Lambeth and Argyle** (each more than 1 km outside every researched area) lighting up at 3 with NEW, which expires after 30 min
- a hot zone with no planning score staying hot
- marks outside London rejected, before and after blurring
- 2-hour deletion
- practice marks never reaching the server
- suggestions promoting at 3, and their limits
- Near me sorting and radius filtering
- the demo seed

`guide.test.js` covers the guide-seen v2 logic and URL params. `i18n.test.js` covers EN/中文 parity and the exact spec wording. `data.test.js` checks that Argyle is gone.

What the headless check covers:
- the guide shows on first visit and Got it remembers it
- the big button creates a blurred mark with the tag card
- 1 mark shows no zone
- the 5-minute message
- the demo shows 7 zones in all three colours, with a hot NEW Hyde Park zone
- badges: compact when zoomed out, full at street zoom
- counts tick up (71 → 75 in 13 s)
- **a mark made in tab A appears in tab B**
- Near me sorted within 2 km, the radius toggle, and Route to a zone
- Suggest an area via a real map tap
- Chinese UI with no untranslated keys
- the h3-js-blocked fallback
- Supabase offline fallback
- reduced motion
- no JS errors anywhere

I also looked at the screenshots. That caught three problems the checks had missed, all fixed:
- the badges covered the zone hexagons
- the area labels sat on top of the zones
- an invalid CSS `font` shorthand left the big button text unbolded

## Known limits / next steps
1. The live Supabase path is tested only in PGlite and against a fake unreachable server, not a real project. Run `supabase_smoke.mjs` once the project exists.
2. With Supabase, if h3-js fails to load from the CDN, marks use the built-in hex ids. The server rejects those as `invalid`, so marking shows an error that night. Local mode is unaffected.
3. Server-side rate limits go by the rotating session hash (privacy first), so someone clearing storage can mark more often. A global cap in `send_mark` limits the damage.
4. Res-9 hexagons at street zoom were not added; res 8 looks fine at street zoom in the screenshots.
