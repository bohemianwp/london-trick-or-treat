# SUMMARY v2 · 第二版做了什么（2026-10-17）

Everything runs in **local mode** (`backend: 'local'`). No accounts were created, nothing was deployed or published,
no `git push`, and no Supabase project was contacted.
全部在**本地模式**下运行。没有注册任何账号、没有部署或发布、没有 git push、没有连接任何 Supabase 项目。

## Built · 已完成

| Spec | What | Status |
|---|---|---|
| §3 | `config.js` exactly as in the spec + EN/中文 comment block | ✅ |
| §3 | `backend.js`: LocalAdapter (localStorage + BroadcastChannel) and SupabaseAdapter (supabase-js 2.118.0 from jsDelivr with SRI, **lazy-loaded only when configured**); 5 s timeout → local fallback + "📴 Offline mode" chip, retry every 2 min; last remote lists cached | ✅ |
| §2.3 | House markers: 6 types (🍬 🩵 🍫 🎃 🐶 🕔), one-tap *Giving now / Starting later / Out of candy* (greyed), optional hours, template notes, 140-char limit with counter, "Don't post your name…" warning, edit token per marker (SHA-256 hash stored), expiry Nov 1 6 AM Toronto, filter chips (teal / full-size / open early / hide out), max 3 markers per phone. Glowing SVG pumpkin markers (teal pumpkin for 🩵), pulse ring on "Giving now" | ✅ |
| §2.3 | v1 pins migrated once into the marker model (kept on that phone only; "avoid" → greyed "out" with ⚠️ note; star ratings dropped). Old `#pins=` share links still open | ✅ |
| §2.4 | Board tab ("Pins / Board" → 🗳️ Board / 投票): *Most fun neighbourhood*, *Best decorations*; optional area + rough location (~100 m); one upvote per device; report (hidden at 3, one report per device); Top / New; links, emails, phone numbers and profanity rejected; 5 posts per device per hour; delete your own post | ✅ |
| §2.5 | Live dots: exact consent text; toggle disabled outside Oct 31 15:00–23:00 Toronto ("Opens Halloween night") unless `?demo=1`; ≤ 1 send / 60 s and only while visible; ~50 m grid + ≤ 25 m jitter; random session id rotating every 30 min (per tab, not per device); 30-min TTL; auto-stop after 90 min; others' dots = plain circles; own dot never echoed (matched by session hash); turning it off deletes your dot immediately | ✅ |
| §2.6 | Hotspot hexes: h3-js 4.5.0 (SRI) at resolution 8, local hex-grid fallback; legend Quiet (teal) / Busy (orange) / Very busy (red-magenta glow); planning score 0.5·area + 0.3·votes + 0.2·pins; live = last 20 min, only cells ≥ 3, over the planning layer at 30 %; ≤ 400 hexes, viewport-only, **one canvas**, recompute ≤ once per 60 s, tap lookup via `latLngToCell` | ✅ |
| §2.2 | 10 researched areas from `data/areas_researched.json`; popups show scores, notes, cautions (now also in Chinese), streets and **sources with dates**; label "Based on local news and parent reports, 2026" / "根据本地新闻和家长反馈整理，2026"; crowd inverted (`6 − json.crowd`) | ✅ |
| — | Events layer: HitV (Oct 24), Camp Weathered (65 Wethered St), Somerset Monster House (71 Somerset Cres) — coordinates from OpenStreetMap Nominatim, stored in `meta.events` | ✅ |
| §6 | Privacy page (EN/中文, 8 sections, PIPEDA spirit) reachable from Safety and Live | ✅ |
| §4 | `supabase/schema.sql` (RLS on all tables, column-level grants, SECURITY DEFINER RPCs with validation + rate limits), `supabase/cleanup.sql`, `supabase/README.md` (Peng's steps, EN/中文) | ✅ |
| Style | Dark #07060d→#120a1f, neon orange/purple glow, HUD grid + slow radar sweep (`pointer-events:none`, off with `prefers-reduced-motion`), monospace numbers/countdown (system fonts), phone-first 48–60 px touch targets, passive touch listeners | ✅ |
| i18n | Every UI string in `en` + `zh` (`i18n.js`), one-tap toggle, test enforces identical keys | ✅ |

## Test results · 测试结果

| Check | Result |
|---|---|
| `node --check` on all 17 JS/MJS files | ✅ all OK |
| `node --test` (lib, i18n, data, backend) | ✅ **34 / 34 pass** — includes Oct 31 2:59 PM closed / 3:00 open / 11:00 & 11:01 PM closed, dot TTL + session rotation, coarsening bounds, bounding box, hex blend weights, ≥ 3 suppression, crowd inversion, two-tab BroadcastChannel sync, vote/report/rate limits, offline fallback with a fake failing server |
| Headless Chrome, 390×844 (`tests/headless_check.mjs`, local server on 8080) | ✅ **56 / 56 pass**, 0 JS errors — all layers toggled, all tabs, board + house flows via real taps, language switch with no untranslated keys, **two `?demo=1` tabs**: post, "Out of candy" and live dot appear in the other tab; own dot not drawn twice; sent dot moved 8 m (coarsened); live hexes only with ≥ 3; h3-js blocked → local grid; Supabase unset → offline chip, no CDN download; Supabase unreachable (`https://ltot-test.invalid`) → offline chip and board still works; reduced motion hides the HUD |
| Hex redraw time at 4× CPU throttle | 0–1 ms per redraw (budget 16 ms) |
| `file://` (double-click) incl. `?demo=1` | ✅ loads, no exceptions |
| `schema.sql` + `cleanup.sql` on **PGlite** (real Postgres 17 in WebAssembly, Supabase-style roles) | ✅ **47 / 47** — anon can't read votes/reports/dots/token hashes, can't write tables or call helpers; RPC validation, rate limits, one vote per device, 3 reports hide, live window, ≥ 3 floor, 30-min deletion, cleanup empties everything |
| `tests/supabase_smoke.mjs`, `tests/load_sim.mjs` | Written, **not run** (no project). Smoke test verified to refuse without credentials and to refuse secret keys |
| Server | Stopped after testing; port 8080 confirmed free |

Screenshots (390×844) · 截图：`/tmp/ltot-test/v2-map-hex.png` (map + hexagons), `v2-board.png` (board, demo), `v2-live-demo.png` (live mode with dots and glowing hexes), plus `v2-live-panel.png`, `v2-board-local.png`, `v2-areas-zh.png`.

## Not done / limits · 没做到的 / 局限

1. **Size budget only half met.** Own JS = **149.1 KB** (meets SPEC §8.4 "JS < 150 KB"), but **JS + CSS = 171.2 KB raw** (54.9 KB gzipped — what a phone actually downloads from Netlify/GitHub Pages), over the task's combined 150 KB. The extra is bilingual text (~29 KB) and the embedded research data (~15 KB). Getting under 150 KB raw would mean stripping comments/indentation (a build step in disguise) or dropping content. I chose readable code; tell me if you'd rather have the cut.
   **体积预算只达标一半**：自有 JS 149.1 KB 符合 SPEC，但 JS + CSS 合计 171.2 KB（压缩后 54.9 KB），超过任务要求的 150 KB。
2. Not tested on a real iPhone; only Chrome's phone emulation.
3. Supabase path not tested against a real Supabase project (only PGlite + a fake failing server). PostgREST-specific behaviour is covered by `supabase_smoke.mjs` once a project exists.
4. Posts/markers created while in offline fallback stay on that phone (not uploaded later).
5. Headless screenshots show faint horizontal lines at map-tile edges. They appear even with all app CSS removed (Leaflet + headless Chrome at 2× density); two fixes didn't help, so I stopped. Check on a real phone.
6. **Data check for you:** 65 Wethered St geocodes ~1.6 km north-west of the `east-wethered` area centre in the research JSON (42.9965, −81.2045). I left the area circle as researched; the event pin uses the geocoded address. You know the city — worth a look.
7. Spec SQL default `'2026-11-01 06:00-04'` would expire markers at **5 AM** local (DST ends that night). Implemented as 6 AM Toronto = 11:00 UTC in both JS and SQL.
8. Additions beyond the spec interface: `deleteMarker`, `deletePost`, `removeDot` (so people can delete their own data), a `reports` table (so one phone can't hide a post alone), and `author_hash` / `token_hash` / `device_hash` columns (rate limits and deletes). None of these are readable by anon.
9. The Argyle event (Oct 17) is listed but already over today.
10. The project lives on the iCloud-synced Desktop; per your notes, `~/projects/` is the usual place. I didn't move it.

## Account setup Peng needs (only for shared mode) · 共享模式需要你做的

Full steps in [`supabase/README.md`](supabase/README.md):
1. Sign up at supabase.com → new free project `london-tot`, region **Canada (Central)**, strong DB password.
2. SQL Editor → run `supabase/schema.sql`.
3. Copy Project URL + **anon/publishable** key into `config.js`, set `backend: 'supabase'` (never the service_role key).
4. Run `tests/supabase_smoke.mjs` with those two values.
5. Publish: Netlify Drop or GitHub Pages (free account).
6. Oct 29–30: open the dashboard so the free project isn't paused. Nov 2+: run `supabase/cleanup.sql` or pause/delete the project.

## Backup · 备份

v1 files before this change: `/tmp/ltot-backup-v1-20261017-155700/` (index.html, app.js, styles.css, README.md, SUMMARY.md, areas_researched.json). `app.v1.bak.js` in the project folder was already there and was left untouched.
