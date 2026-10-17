# v=6 summary: live-seconds countdown, feedback, route tweaks, ▶ How to use tour (Oct 17, 2026)

## 1. Countdown with live seconds
- The top bar shows `🎃 Halloween in 14d 01h 05m 32s`; in Chinese it reads `🎃 离万圣节还有 14天 01时 05分 32秒`. The Safety panel's big countdown uses the same code.
- **No shifting:**
  - Every unit is always shown and zero-padded (`00d …` on the last day).
  - The digits sit in fixed `2ch` boxes in the monospace font with `tabular-nums`.
  - The DOM is rebuilt only when the phase or language changes. Each tick only swaps the digit text.
- **Timer:** one `setInterval(1000)`, started on the next second boundary (+20 ms). It stops when the page is hidden and restarts aligned when the page is visible again. The old 45 s poll no longer redraws the countdown.
- **Seconds glow:**
  - Each tick plays a short magenta neon flicker on the seconds digit, using opacity and text-shadow only.
  - It replays by switching between two identical `@keyframes` names, so there is no forced reflow.
  - It is off with `prefers-reduced-motion`.
- **Target:** Oct 31, 2026, 5:00 PM America/Toronto.
  - From then until Nov 1 at 00:00 Toronto time, the countdown shows `Halloween is ON! 🎃` / `万圣节开始啦！🎃` with a pulsing glow.
  - After that it shows "Thanks for trick-or-treating safely! See you next Halloween 👻" / "谢谢大家平安讨糖！明年万圣节见 👻".
  - The switch happens live at the exact second. The old 6:00–9:30 PM "night" window is gone.
- **Accessibility:** `#countdown` is now `role="timer"`. It was `role="status"`, which would make a screen reader announce every second.
- **Pure functions in `lib.js`:** `HALLOWEEN`, `countdownPhase`, `countdownUnits`, `formatCountdown`, `msToNextSecond` and `parseNowParam`.
- **Small fix along the way:** the top bar already overflowed at 390 px in v5, and "中文" was cut off. On screens up to 480 px wide, "🧪 Practice mode" and "📴 Offline mode" now show only their icon. Tapping still explains, and the aria-label and tooltip keep the words. That freed room for the ▶ button.

## 2. 💬 Feedback / 反馈
- **Where to find it:** the top bar is full at 390 px, so the button sits in the **Guide tab**, right under "▶ How to use", next to "🔗 Share this map". The tour's last step also points at it. In this app the Guide tab *is* the How-to panel, so that covers both places.
- **The panel** follows the existing sheet style and both languages:
  - three questions, 500 characters each
  - an optional name or nickname (40 characters)
  - the note "Please don't include your kids' names. / 请不要写孩子的名字。"
- **✉️ Send** is a real `<a href="mailto:sisy+halloween@mail.grokbot.com?subject=Halloween%20map%20feedback&body=…">`.
  - The link is rebuilt on every keystroke.
  - The body has the three answers, the name, `v=6`, the language, the screen and window size, `navigator.userAgent` and an ISO time.
  - If all three answers are empty, Send shows "Please answer at least one question."
- **📋 Copy text** copies the same text plus a `To:` and `Subject:` line.
  - It uses the Clipboard API first, then a hidden `textarea` + `execCommand('copy')`.
  - On success it shows "✅ Copied! Paste it into an email or WeChat / 已复制！可粘贴到邮件或微信".
  - If both fail, it shows the text in a selectable box.
- There is no backend.
- **`LIB.buildFeedbackMail()`** (pure function):
  - cuts each answer to 500 characters
  - then shortens the longest answer (adding "…") until the whole `mailto:` link is at most 1,800 characters
  - Chinese text counts about 9 characters per character after encoding.

## 3. Route tweaks (PACE unchanged: u5 1.5, 5–8 2.0, 9–12 2.5, teen 3.0 km/h)
- **Stamina hint** under the age picker, from `LIB.staminaHint(age, minutes)`:
  - Under 5: "30–45 min is usually plenty". Above 45 min (that is, 60 or 90) it turns into an orange warning: "⚠️ Little ones usually tire after 30–45 min / 小小孩一般 30–45 分钟就累了".
    - The spec asked for the warning at 90 min. I also show it at 60 min because 60 is already past 30–45. The one-line change is in `staminaHint` if you prefer 90 only.
  - 5–8: "up to 60–90 min".
  - 9–12 / 13+: a neutral "agree on a check-in time".
- **Start-time hint** (`LIB.startTimeHintKey`):
  - Under 5 and 5–8: "Best start: 5:30 PM (sunset 6:18 PM) / 建议 17:30 出发（日落 18:18）".
  - Older kids: "Most fun 6–8:30 PM / 18:00–20:30 最热闹".
- **Estimated houses** (`LIB.estimateHouses(km)` = `round(km × 1000 / 15 × 0.6)`): a new stat shows "≈ 60 houses / ≈ 60 户". 1 km → 40, 1.5 km → 60.
- **Closed loop:**
  - `LIB.loopWaypoints()` moved out of `app.js` and is now tested. The first and last waypoint are always the start: home/my location, or the parking spot at the area centre when the area is more than 1.5 km away.
  - The drawn line is joined to the real start at both ends, because the router snaps to the nearest path.
  - The last turn reads "Back at the start (car / home) 🎉".
  - The start pin, the 🅿️ pin and a line under the result say "Start & finish (car / home) / 起点和终点（车或家）".

## 4. ▶ How to use / 怎么用 — auto-play tour
- **Where to start it:**
  - a **▶** chip in the top bar, right next to "?"
  - "▶ How to use" on welcome card 1
  - the first button in the Guide tab
- **The tour** runs about 26 s with no input. A dimmed overlay with a glowing, pulsing ring (CSS `box-shadow` cut-out) slides to each step with a bilingual caption:
  1. zones + legend
  2. 📍 Near me
  3. the big button
  4. a ✨ mark drops onto the map, the demo zone goes 2 → 3 (lights up with NEW) → 4 → 5
  5. Route
  6. 🔗 Share
  7. 💬 Feedback
- **Controls:** a 7-segment progress bar, Pause/Resume, Replay and Skip (it becomes Done at the end). Esc ends it cleanly.
- **Demo data** lives only in an in-memory store inside `app.js` and is drawn instead of the real zones while the tour runs.
  - Nothing is written to localStorage. Layers change in memory only, not through `setLayer`, which would save them.
  - Real refreshes keep updating underneath.
  - At the end, the real zones, layer toggles, map centre and zoom, and the open panel come back.
- **`prefers-reduced-motion`:** nothing moves by itself. Step cards with Back/Next show each step's end state, and the ring jumps without animation.
- **Code:** `tour.js` (8.3 KB with comments) holds the single `TIMELINE` array of `{target, cap, act, ms, beats}`, the controller and the spotlight. `app.js` supplies the snapshot, restore and demo actions.
- **New button "🔗 Share this map":** step 6 needed a share control, and v3 had removed the old house-share links. It uses `navigator.share` and falls back to copying the link. It's in the Guide tab.
- **The "Near me" chip** is now static in `index.html`, so the tour has a fixed target. It looks and works the same.

## URL params (all of them)
| Param | What it does |
|---|---|
| `?now=2026-10-31T17:30:00-04:00` | **new.** Pretends it is that moment, for the countdown only (screenshots). The clock keeps ticking from there. Practice/live mode still uses the real time. |
| `?feedback=1` | **new.** Opens the 💬 Feedback panel (no welcome cards) |
| `?tour=1` | **new.** Starts the ▶ How to use tour on load |
| `?tour=1&tourStep=N` | **new.** Jumps to step N (1–7) and pauses half-way through it. For example `tourStep=4` shows the zone at 4 marks with NEW and the ✨ drops. |
| `?near=1` | Opens "Near me" (with `?demo=1`, from a pretend home in Old South) |
| `?demo=1` | Demo zones and fake marks (separate `ltot.demo.*` storage) |
| `?lang=zh` / `?lang=en` | Language for this load |
| `?guide=1` | Forces the welcome cards |
| `?howto=1` | Opens the Guide / How-to panel |

## Other
- Every asset in `index.html` is `?v=6`, including the new `tour.js`, and so is `demo.js` loaded from `app.js`. A test checks that `LIB.APP_VERSION` matches every `?v=`.
- README lists the new params and `tour.js`. `CLAUDE_TASK_countdown.md` was added to `.gitignore`, like the earlier task files.
- ⚠️ **Size budget raised.** Own JS is 190.1 KB, and `tour.js` is now counted too. The old cap in `tests/data.test.js` was 170 KB, so I raised it to 195 KB with a comment.
  - Over the network: 60.2 → 70.9 KB gzipped (JS + CSS), +10.7 KB.
  - Most of it is the bilingual strings and the tour/feedback code.
  - If that's too much, the cheapest cut is to lazy-load `tour.js` on the first ▶ tap, like `demo.js`.

## Test results
Run on Oct 17, 2026, on Peng's Mac:

| Check | Result |
|---|---|
| `node --check` on every JS / MJS file | all OK |
| `node --test tests/*.test.js` | **68 passed, 0 failed**. 20 new in `tests/countdown.test.js`; `guide.test.js` and `data.test.js` updated for v=6. |
| `tests/headless_check.mjs` (headless Chrome, 390×844) | **107 passed, 0 failed** (71 old + 36 new). Screenshots: `/tmp/ltot-test/v6-*.png` |
| `tests/sql_pglite_check.mjs` | Not re-run: no SQL or backend changes in this round |

New checks:
- **Unit tests (`tests/countdown.test.js`):**
  - zero-padded formatting in EN and 中文
  - 4:59:59 PM is "before" and 5:00:00 PM is "on" (Toronto time, also checked against UTC)
  - "on" until 23:59:59, "after" from Nov 1 00:00
  - `?now=` parsing, and the next-second alignment
  - `buildFeedbackMail`: address, subject, encoding, the 500-character cap, the link staying ≤ 1,800 characters with long English and long Chinese, and short answers not cut
  - `staminaHint`, the start-time hint, `estimateHouses` (1 → 40, 1.5 → 60)
  - the loop ends at the start, both walking and driving
  - PACE unchanged
  - all tour caption keys exist in EN + 中文, and every target selector exists in `index.html`
  - **Skip mid-tour restores** layers, view and panel, and storage is untouched
  - the full run, pause/resume, `tourStep`, and reduced motion
  - every `?v=` equals `APP_VERSION`
- **Headless check:**
  - the countdown ticks and keeps a fixed width
  - flicker, monospace and tabular-nums are applied
  - the top bar fits at 390 px
  - `?now=` ON, the live 4:59:58 → 5:00:00 switch, and "after"
  - the feedback panel: the `mailto:sisy+halloween@mail.grokbot.com…` link, and Copy text
  - route hints, "≈ N houses", and the closed loop (routers blocked, so the straight-line fallback runs)
  - the tour: the ring moves, step 4 reaches 5 + NEW, pause, and Skip gives back an identical localStorage, layers, centre, zoom and panel
  - `?tour=1&tourStep=4` in Chinese
  - the welcome-card button
  - with reduced motion: no flicker, Next/Back only, and Esc
  - no JS errors on any page

Not done or not checkable here:
- The real `mailto:` handoff to a mail app (the link is checked, not opened).
- `navigator.share` on a phone (headless has no share sheet; the copy-link fallback is used there).
- The OSRM-routed loop, because the routers were blocked in the test. Its closing code is the same `distM` join that is checked on the straight-line route.
