# DEVLOG: Mark it! London Trick-or-Treat Map / 万圣节讨糖地图

> The complete record of how the map was built, from Peng's first message to v15.
> All times are Toronto time (EDT, UTC-4). Everything happened on Saturday, Oct 17, 2026.
>
> **Sources**
> - The conversation transcript export (3:17–4:51 PM; Peng's words are quoted verbatim from it).
> - The task briefs the assistant received after that. Requests from those are quoted where the brief carried Peng's own words, and summarised otherwise.
> - `git log -p`, `halloween_app/REVIEW_safety_legal.md` and the build notes.
>
> The export stops at about 4:51 PM, so later requests are not verbatim unless marked "Peng:". General questions that weren't about the map are left out (hardware questions, email, personal matters).

Live: https://bohemianwp.github.io/london-trick-or-treat/ · Repo: bohemianwp/london-trick-or-treat (GitHub Pages from `main`)

## What it is
A free, no-sign-up, bilingual (EN / 中文) map for families in London, Ontario.
- **Before Halloween**, parents mark streets with great decorations and pin favourite streets from past years.
- **On Oct 31 (3–11 PM)**, they tap one button to say "this street is fun right now". Streets with 3+ marks in 45 minutes light up live.
- **Privacy:** street level only (hexagons about 800 m wide, positions blurred to about 50 m), no names, photos or accounts. Everything shared is deleted by Nov 2.

## Stack
- **App:** a static site (no build step). Leaflet + OpenStreetMap tiles with a dark filter; h3-js for hexagons, with a local hex-grid fallback.
- **Code:** `lib.js` (pure logic, UMD, unit-tested), `backend.js`, `app.js`, `i18n.js` (every string EN + ZH), `hex.js`, `tour.js`, `demo.js` (`?demo=1` sample data, phone-only) and `sfx.js`.
- **Backend adapters:** `LocalAdapter` (phone only) and `SupabaseAdapter`. The app falls back to local by itself when Supabase is slow or down, and retries every 2 minutes.
- **Supabase:** RLS on every table; anon has no table grants. The app talks only through SECURITY DEFINER RPCs that check input, rate limits, the London box and the time windows. Only the public anon key is in `config.js`.
- **Tests:**
  - `node --test tests/`: unit tests (112 at v15, 122 at v15.4).
  - `tests/headless_check.mjs`: a headless Chrome walk-through of the whole app at 390×844, including real long-press touches (153 at v15, 192 at v15.4).
  - `tests/sql_pglite_check.mjs`: real Postgres 17 in WebAssembly with Supabase-style roles (150 checks).
  - `tests/supabase_smoke.mjs`: read-mostly checks against the live project.
- **Cache busting:** `APP_VERSION` in lib.js must equal every `?v=` in index.html; tests enforce this.

## Requests, in order

### The first hour (verbatim from the transcript)
| Time | Peng's words | In English | What was done |
|---|---|---|---|
| 3:17 PM | "I'd like to build a application that could help parents find a best rout for trit and trike at Hallowen Day. 指挥claude code 去做这个吧。我的意思是：我想做一个在安省小伦敦使用的在万圣节讨糖的一个小程序，这个小程序能够找出最好的讨糖路线，帮助父母带孩子去找到最好的社区去讨糖，过一个快乐的万圣节，规划路线，分享哪里最好，进入使用的人的定位显示。" | "…Have Claude Code build it. I mean: a small trick-or-treat program for London, Ontario that finds the best route, helps parents take their kids to the best neighbourhoods for a happy Halloween, plans routes, shares where is best, and shows the location of people using it." | SPEC.md and a Claude Code task were written. The build ran on Peng's Mac (Claude Code approved for this project only). |
| 3:20 PM | "I think you need to check it, and do some research about where is the best areas to 讨糖 在万圣节" | "…research the best areas for trick-or-treating on Halloween." | Area research (`areas_research.md`, `areas_researched.json`), every area with dated sources. |
| 3:21 PM | "不一定是需要做app,我希望是比较容易打开的程序就可以了，怎么简单怎么方便用户使用怎么来。这是一个季节性的单个产品，不是频繁使用的，仅仅一年一次就这一天的用户使用" | "It doesn't have to be an app; something easy to open is enough, whatever is simplest for users. It's a seasonal, single-use product, used one day a year." | A web page (no install), static hosting, no accounts. |
| 3:21 PM | "我希望他的风格能够结合万圣节的主题，并且带有一定的科技感，中英双语" | "I want the style to combine the Halloween theme with a techy feel, bilingual Chinese/English." | A dark Halloween + "radar" look (later calmed in v14), with every string in EN + ZH. |
| 3:23 PM | "要现实当天使用者的地点，可以在里面交流哪个社区最好玩，哪里的装饰最好，记住你搜索的在伦敦比较好玩的区域，大家是近两年在各个社区分享的地方，而不是超过两年的老信息，你要把这些交给claude code。 并且使用工程思维去做" | "Show users' locations on the day; let people discuss which neighbourhood is most fun and where the decorations are best. Use only what people shared in the last two years (no older info), hand this to Claude Code, and use an engineering mindset." | Live "where it's fun" zones instead of individual dots (privacy), a parent board, and sources limited to Oct 2024–Oct 2026, plus a spec and tests from day one. |
| 3:24 PM | "你可以去找一些有没有类似的应用，作为最佳实践的参考" | "Look for similar apps as best-practice references." | Comparable apps were reviewed for the spec. |
| 3:26 PM | "能显示出热点区域分布状态，像uber的app 里面的繁忙区域的标注那样的样子" | "Show hot-zone distribution, like Uber's busy-area shading." | Glowing hexagon zones (H3), busier = hotter colour. |
| 4:43 PM | "如果我想用git呢？" | "What if I want to use git?" | Git repo + GitHub. |
| 4:45 PM | "yes, I have GitHub Account" · "Yes, publish it" | — | Public repo `bohemianwp/london-trick-or-treat`, GitHub Pages: **v2** (d445759, 4:46 PM). |
| 4:51 PM | "I can't see the map it shows API key required" | — | The tile provider needed a key; switched to OpenStreetMap tiles with a dark filter (a6d38d3, 4:51 PM), plus cache-busting (0252cf5). |

Between 3:31 and 3:52 PM the Mac went offline mid-build. The build finished at about 4:39 PM: 34 unit tests and 56 browser checks.

### Later requests (from the task briefs)
- **v3 (5:45 PM):** a "Mark it!" flow for families on the night, the house-level UI removed, a new guide, and a past event dropped.
- **v=6–v=8 (6:01–6:29 PM):** a live countdown, feedback, a tour, demo framing, Supabase on with shared test days, address filters, Teal Pumpkin, a privacy notice.
- **v=9 (6:48 PM):** an English / 中文 chooser on the first visit (never guess from the browser language).
- **v=10 (7:25 PM):** parent-focused wording ("Great street? Share it!"), honest progress, badges, a curb hint.
- **v=11 (7:50 PM):** Best decorations, a pre-Halloween purple layer.
- **v=12 (8:04 PM):** popups placed below the top-right buttons.
- **v=13 (8:48 PM):** explain the two phases (decorations now, fun streets on Oct 31), plus the gift line (exact copy from the brief): "Every mark, like and comment helps another family have a happier, more magical Halloween 🎃" / "你的每一次标记、点赞和留言，都在帮助另一个家庭和小朋友过一个更快乐、更难忘的万圣节 🎃".
- **v14 board (8:52 PM):** prepare `v14_board.sql`, test in PGlite, client behind a server check, a UTF-8 paste page, then stop for approval.
- **v14 Oct 31 record (8:56 PM):** past-years pins stay through Halloween night with the memory line "🏆 n families remember this street as unforgettable" / "🏆 n 个家庭说这里往年难忘" and the tonight prompt. The count is distinct phones, aggregate only, shown at 3+.
- **Sounds (9:01 PM):** short, spooky-but-cute, under 1 s; Web Audio or CC0 only; only after a tap; a remembered 🔊/🔇, default on but quiet.
- **Visual cleanup (9:29 PM):** Peng said the colours and fonts didn't look clean. One font stack, 3 sizes, 2 weights, calm navy, two accents, WCAG AA, before/after screenshots.
- **Poster (9:56 PM):** a bilingual image poster.
  - Peng's hook: "Still wondering where to take the kids this Halloween? / 还在为万圣节带孩子去哪玩发愁吗？"
  - Answer: "Now it's easy. Here's where the fun is! / 现在你可以不费力了！"
  - "Free · No sign-up · Privacy-safe / 免费·无需注册·保护隐私", a large QR to the live link, "London, Ontario".
- **10:04 PM:** `v14_board.sql` ran in the Supabase SQL Editor ("v14 board ready | 4 | 7"). Then: smoke test, push, live check, a DEVLOG draft.
- **v15, 10:33 PM.** Peng: "too complex, too much text, users can't read it all; as product designer check and optimize every detail, find anything confusing." See **v15** below.
- **v15 tooltips, 10:34 PM (Peng's idea):**
  - one-line EN/ZH tips on every clickable element: hover/focus on desktop, press-and-hold on phones (without acting);
  - a first-visit hint "Press and hold any button for a tip / 长按任意按钮查看提示".
- **v15 details, 10:44 PM:**
  - Peng saw the mark card's shrinking timer bar stop and thought it was a bug (it was the touch-pause);
  - also audit colour meanings, every EN/ZH string pair, and that instructions match behaviour.
- **10:34 PM:** turn the full transcript into this final DEVLOG.
- **v15.1, Oct 18 morning (Peng's words, quoted verbatim):**
  - **7:18 AM**: "我现在就想在这个上面分享往年我知道的最好玩的地方，是在那个入口进行分享呢？我不能一眼就抓到这个需求" ("I want to share the most fun places I know from past years right now. Where do I share it? I can't spot it at a glance.")
  - **7:20 AM**: "还有对于每个街区的评分，还是用万圣节的主题色，进行配色，灰色太不明显了" ("For each area's score, use Halloween theme colours. The grey is too hard to see.")
  - **7:25 AM**: "在指南里面的，文字表述，装饰（现在），往年最爱，被举报，45分钟内3个标记就亮， 练习：橙色小按钮，数字：现在23，14赞最近14天，这些表述有些模糊，我是用户，我第一次看到不明白什么意思" ("In the Guide, the wording 'Decorations (now)', 'Past favourites', 'reported', 'lights up with 3 marks in 45 min', 'Practice: small orange button', and numbers like 'now 23' and '14 likes in the last 14 days' is vague. As a first-time user I don't understand them.")
  - **7:26 AM**: "在怎么用里面一定直观的让用户一眼就知道这个功能的入口在哪，怎么使用，使用的目的是什么，简单明了，吸引眼球" ("In How to use, users must see at a glance where each feature's entry is, how to use it, and what it's for. Simple, clear and eye-catching.")
  - See **v=15.1** below.
- **v15.3, Oct 18 morning (Peng's words, quoted verbatim):**
  - **8:45 AM**: "被举报三次会被隐藏是什么意思？怎么举报" ("What does 'hidden after 3 reports' mean? How do I report?")
  - **8:48 AM**: "如果点击更多，在手机上更多的菜单会出屏幕之外，还需要左滑才能看到。这个设计需要修改一下" ("On a phone, tapping More pushes the menu off the screen, and you have to swipe left to see it. Please change this design.")
  - See **v=15.3** below.
- **v15.6, Oct 18 late morning (Peng's words, quoted verbatim):**
  - **11:04 AM**: "哪里可以分析用户得使用情况吗" ("Where can I analyze how users use it?"). Then he chose "Set up both" (an evening usage report + an anonymous visit counter).
  - **11:46 AM**: "仅仅开发者我能看" ("Only I, the developer, can see it.")
  - **11:50 AM**: "注明一下这个程序仅为伦敦区域使用，不提供其他区域" ("State that this app is only for the London area and doesn't cover other areas.")
  - See **v=15.6** below.

### Cancelled
- **Promo QR / video v4:** cancelled before any work. `qr.png` was never touched. Earlier promo video drafts (v1–v3) are kept in `halloween_app/` and were never published. (Re-requested by Peng on Oct 18, 10:03 AM and made then; see "Promo video v4 + posters" below.)

## Versions

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

### v=14: past-years board (now "Past favourites / 往年最爱") + sounds (21:29, 4089641)
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

### v=15: simpler, shorter, tooltips (Oct 17, 11:17 PM, [81e32eb](https://github.com/bohemianwp/london-trick-or-treat/commit/81e32eb))
Peng: "too complex, too much text, users can't read it all." The user is a parent holding a phone at night, giving it a few seconds. The full audit (problem → change → why) is `halloween_app/ux/UX_AUDIT_v15.md`.
- **Text:** the visible copy (banner, welcome, How-to, explainer, big button, cards, privacy) is about 80% shorter in EN and ZH. A unit test guards ≥ 50% against v14.1.
- **One name per thing (EN / ZH):**
  - Fun streets / 好玩的街
  - Decorations / 装饰
  - Past favourites / 往年最爱
  - Suggested areas / 推荐区
  - Busy / 热闹, Very busy / 非常热闹
  - Decoration counts are "🎃 14 likes / 🎃 14 个赞" (was "14 decor marks"). Fun streets are "🔥 23 now / 🔥 现在 23". The old ZH said "23 人标记", which wrongly implied 23 *people*.
- **Top bar, 8 → 5 controls:**
  - Kept: brand, status chip, Safety, 🔊, 中文.
  - ▶ and ? moved to the Guide tab; the 💬 board icon is replaced by the Past favourites chip.
  - The status chip keeps its words: "🧪 Practice" / "🧪 Test days".
- **Banner:** one short line, "🎃 Now: decorations · 🔥 Oct 31: fun streets ›".
  - The test-days line moved into the chip.
  - On the night: "🔥 Share fun streets until 11 PM ›". The duplicate "Halloween is ON!" is gone (the countdown still says it).
- **Layer chips:** two main chips that follow the phase, plus "More ▾".
  - Before Oct 31: Decorations, Past favourites. On the night: Fun streets, Past favourites.
  - More ▾ holds the rest. Fits 390 px in EN and ZH.
- **Locate:** a round ⌖ icon button with a spoken label.
- **Help:** the ⓘ buttons are gone; tooltips replace them.
- **Explainer:** 4 one-line bullets plus "More details ▾" (native `<details>`), with one primary button. On the night it opens at the Oct 31 section.
- **Welcome:** 3 cards (Find the fun · Share in one tap · Safe & private), at most 3 short lines each. The demo button is on the last card.
- **How-to:** 9 short sections (+ Past favourites), with one primary "▶ 25-second demo".
- **Privacy:** a 5-line summary. The full notice is unchanged behind "Full privacy notice ▾" (PIPEDA, contact, every item).
- **Gift line:** kept only in the explainer and the board toasts (it was also on every thank-you card and the board panel).
- **Mark card timer.** Peng thought the stopping bar was a bug. Decision:
  - Thank-you and "already shared" cards no longer close by themselves. They close with Done, ✕ or a tap outside. Nothing moves on its own, so there is nothing to misread.
  - Only the decoration card that *shares by itself* after 8 s keeps a countdown. It now has words ("Shares in 5 s"), and touching it shows "⏸ Paused / 已暂停" with a dimmed bar.
  - The bar is purple there (decorations); there is no yellow anywhere.
- **Tooltips:**
  - One line, EN + ZH, on every clickable element: top bar, chips, buttons, tabs, map badges and bubbles, zoom.
  - Desktop: hover (0.4 s) or keyboard focus. Phones: press and hold 0.5 s shows the tip and does **not** act (the following click is swallowed; a drag cancels).
  - Placed above the element, or below if there's no room, never over it. Auto-hides after 2.5 s. `aria-describedby` is set while shown.
  - First visit: "👆 Press and hold any button for a tip / 长按任意按钮查看提示", once.
- **Colour meanings, made consistent:**
  - orange = fun streets (Oct 31) only;
  - purple = decorations only;
  - cream = past favourites;
  - grey/white = everything else.
  - Fixed: generic primary buttons, selected tabs, segment controls, the tour ring and links were orange or purple; the route line was orange; suggested areas and community hexes were purple (with a 💜); the Mark tab was orange even when the big button was purple; the "families remember" line was orange.
- **Translation pass:**
  - Dates unified ("10月31日", no "31号").
  - "好了" → "完成".
  - Old terms removed from tour captions and toasts ("热区", "最佳装饰", "往年最佳", "Zones", "Super hot").
  - The welcome now says "practice or test" (during test days the small button is shared with testers, not practice).
- **Behaviour check:** every time, threshold and expiry in the copy matches `config.js`, `lib.js` and the SQL. Guarded by `tests/ux.test.js`:
  - 3–11 PM;
  - 3+ marks in 45 min;
  - 2 h;
  - 14 days;
  - Oct 17–20;
  - Nov 2;
  - 5 min / 30 min;
  - 60-character replies;
  - 3 reports.
- **Unchanged:** safety tips, emergency numbers, Teal Pumpkin, all limits and filters, the 3+ privacy floor, deletion dates, OSM attribution.

### v=15.1: easy to find, plain words (Oct 18, 8:01 AM, [917f0ca](https://github.com/bohemianwp/london-trick-or-treat/commit/917f0ca))
- **Share a past favourite (7:18 AM).**
  - Why: v15 hid the explainer's "Share a past favourite" button (one primary action per card), and the Past favourites chip only shows or hides the layer. That left the Past favourites panel (with its pin button) reachable only through the `?fav=1` link. It was a regression.
  - Change: a cream secondary button under the big button, "💬 Loved a street in past years? Share it / 💬 往年哪条街最好玩？来分享". It shows whenever the board is on and open, including Oct 31 under the orange button. One tap opens pin mode with "Tap the street…"; the second tap on the street opens the form.
  - Also: a past-favourite popup has "💬 Share yours / 💬 分享你的", and the explainer bullet "💬 Mark past favourite streets" is now a link to the same flow. The tooltip is `tip_favShare`.
  - The legend and the mark card move up when the button shows, so nothing overlaps (checked in the headless test at 390 px, EN + ZH).
- **Area scores (7:20 AM).** The suggested-area score dots were grey (the v15 colour pass made them neutral). They are now Halloween orange: filled dots in `--orange` (7.0:1 on the popup navy), empty dots as a dim orange ring `#b0683a` (3.8:1; AA non-text needs 3:1). Each row has a spoken label ("4 of 5"). The colour rules now read "orange = fun streets and area scores". There is still no yellow anywhere.
- **Plain words (7:25 AM).** Every welcome and How-to line is now one complete sentence that says what the thing is and what to do. The numbers were checked against the code before rewriting:
  - "🔥 23 now" → "🔥 23 marks / 🔥 23 个标记". The number is the count of marks on that street in the last 45 min (SQL `count(*)`). A phone can mark the same street again after 30 min, so it counts *marks*, not families. The popup says "Families marked this street 23 times in the last 45 minutes."
  - "🎃 14 likes" stays on the badge. The popup now says "Families liked these decorations 14 times in the last 14 days" (one like per phone per street per day).
  - "🏆 12" = different phones that pinned or liked that past favourite (shown from 3).
  - "Reported" → "If 3 different people report a pin or a reply, it is hidden" (one report per phone).
  - "Practice: small orange button" → "Before Oct 31, try the small “Practice: fun street” button; practice marks stay on your phone." Test days are explained in their own sentence.
  - The colours sentence gives the real thresholds: grey 3–5, light orange 6–14, deep orange 15+ marks in the last 45 min; NEW = lit up in the last 30 min.
  - The tooltips for zone badges, decoration badges and bubbles say what the number counts.
- **How to use = one card per feature (7:26 AM).**
  - Cards: share decorations · share a past favourite · mark a fun street on Oct 31 · like or reply. On the night, fun streets come first.
  - Each card has: a mini phone with the real button ringed where it sits; the real button in its real colour (purple / cream / orange, and a cream bubble); one "How:" line; one "Why:" line; and "👀 Show me".
  - "Show me" closes the guide and rings the real button on the map for 2 s (a neutral white ring, static with reduced motion).
  - The other answers (practice, colours, numbers, reports, map tools, route, sounds, privacy) are 8 one-sentence answers behind "More answers ▾".
- Tests: unit + headless cover the entry (visible at 390 px, no overlap, 2-tap flow, popup and explainer links), the orange dots and contrast, one sentence per line, the cards and Show me.

### v=15.2: two details from my own v15.1 review (Oct 18, 8:20 AM, [7a00c68](https://github.com/bohemianwp/london-trick-or-treat/commit/7a00c68))
Found while reviewing the v15.1 screenshots myself, under Peng's rule that every detail is checked (not a new request from Peng).
- **Pin prompt:** the Chinese "取消" (Cancel) button wrapped onto two lines at 390 px. The button no longer shrinks (`white-space: nowrap`, `min-width: 64px`) and the prompt text takes the remaining width. The headless test checks one line of text in EN and ZH.
- **Welcome card 2:** its middle line names the cream button, but the card only showed purple and orange sample buttons. It now shows the cream "💬 Loved a street in past years? Share it" sample too, in the same order as the lines (purple, cream, orange).

### v=15.3: what reporting means, and More stays on screen (Oct 18, 9:10 AM, [d577775](https://github.com/bohemianwp/london-trick-or-treat/commit/d577775))
Peng, 8:45 AM: "被举报三次会被隐藏是什么意思？怎么举报" ("What does 'hidden after 3 reports' mean? How do I report?")
- **Every report line now says why, how and what happens.** The past-favourite rules, the board rules and the privacy notes all read: "See something rude, unsafe or personal (like a house number)? Tap ⚑ Report. If 3 different people report it, it is hidden for everyone." (中文：「看到不友善、不安全或涉及个人信息（比如门牌号）的内容？点 ⚑ 举报。3 个不同的人举报后，它会对所有人隐藏。」)
- **The toast after reporting counts down,** using the count the server returns: "Thanks! If 2 more people report it, it will be hidden for everyone." (1 more person / now hidden). If the count is unknown, it shows the general rule.
- **Guide → ⚑ Reports** now has its own answer with the how: "Tap the cream bubble, then ⚑ Report at the bottom; for a reply, tap the small ⚑ next to it." Likes & replies is a separate answer (9 answers behind "More answers").
- **The small ⚑ next to each reply** is labelled "Report this reply / 举报这条回复" (aria-label, title and tooltip). The pin's ⚑ Report has its own tooltip.

Peng, 8:48 AM: "如果点击更多，在手机上更多的菜单会出屏幕之外，还需要左滑才能看到。这个设计需要修改一下" ("On a phone, tapping More pushes the menu off the screen, and you have to swipe left to see it. Please change this design.")
- **Cause:** the layer bar was one row that scrolled sideways. Opening More added 4 chips (826 px of chips in EN, 619 px in ZH, on a 374 px bar at 390 px wide), so Fun streets / Suggested areas / Events / Near me were off-screen with no hint.
- **Fix:** the bar wraps instead of scrolling. With More open the extra chips go onto a second row (ZH) or a second and third row (EN), all fully visible. The app measures the bar and moves the zoom buttons, the locate button, the Practice / decorations pill and the pin prompt down by exactly the extra height, so nothing overlaps. Closing More moves them back.
- **Checked** at 360, 375, 390 and 430 px, EN and ZH, before and on Oct 31. The headless test opens More and checks every chip's box is inside the viewport, the bar's scrollWidth ≤ clientWidth, and no chip overlaps zoom / locate / Practice. It fails on v15.2 in all 16 cases.
- **Also fixed:** the Guide's Map tools line and tour step 2 used the ⌖ symbol, which many phone fonts can't show (an empty box). They now say "the round crosshair button" / 「带十字准星的圆形按钮」, and the tour uses 📍.

### v=15.4: only the most popular nearby events, each checked on the organizer's own page (Oct 18, 9:45 AM, [fd2bc55](https://github.com/bohemianwp/london-trick-or-treat/commit/fd2bc55))
Peng, 8:49 AM: "在深入探究搜索一下伦敦50km以内是否有更多的活动，可以列在这个上面" ("Do a deeper search for more events within 50 km of London that can be listed on the map.")
Peng, 9:25 AM: "不要添加完，要添加评价最好的，最popular的" ("Don't add all of them. Add the best-rated, most popular ones.")
Peng, 9:27 AM: "核实活动今年是否存在，确保100%真实" ("Verify each event really exists this year, 100% real.")
- **Research:** 18 family events from Oct 18–31 within 50 km were confirmed for 2026 (`halloween_app/research/events_50km_2026.md`). Per Peng, only the most popular were added, ranked on real evidence (attendance reported by organizers or news, news coverage, review ratings). No numbers were estimated.
- **5 picks added** (with Wortley's HitV, Somerset, Camp Weathered and the CTV map still listed):

| Pick | Date (2026) | Where | Why it's popular (source) |
|---|---|---|---|
| Pumpkins After Dark | Oct 2–31, nightly | Storybook Gardens, London | 10,000+ hand-carved pumpkins (London Free Press photo feature, Oct 2025); a family reviewer waited 20 minutes just to park (mamasonvacation.com) |
| Downtown Pumpkin Prowl | Fri Oct 23, 5–7 PM | St. Thomas · 23 km | 7th year, "attendance … now topping a thousand people", nearly 90 businesses, street closed for safety (St. Thomas Today, Oct 21, 2025) |
| Pumpkin Fest | Sat Oct 24, 1–4 PM | Ingersoll · 31 km | "approximately 3,500 visitors despite the rainy weather" (Town of Ingersoll museum report, Nov 12, 2025) |
| Downtown London Candy Crawl | Sun Oct 25, 12–3 PM | Downtown London | "Hundreds of people … in costume" (CTV London, Oct 26, 2025); "record-breaking year … highest participation to date" (organizers, 2026) |
| Clovermead Fall Festival | Until Oct 31, Mon–Sat 9–5 | Aylmer · 30 km | Tripadvisor 4.7/5 from 232 reviews, Travellers' Choice |

- **100% real (9:27 rule):** each pick was opened on the organizer's own page and the exact 2026 date, time, venue and cost were quoted. An HTML copy and a screenshot of each are in `halloween_app/research/evidence/` (`EVIDENCE.md` holds the table). Dropped because of doubt: **Kustermans** (its Halloween dates show no year) and the **Port Stanley pumpkin train** (no year beside its dates, and prices only on third-party sites). The Ingersoll link now points to the Town's own page, not the radio listing. St. Thomas's line makes no cost claim because the organizer doesn't state one.
- **Past events hide themselves:** each event now has an `end` (a Toronto date = through that day, or date + time = from that minute). The list and pins show only events that haven't ended, re-checked on the poll timer, and `?now=` previews follow it. If nothing is left, the list says "No upcoming events right now / 目前没有即将举行的活动". Before this, past events stayed listed until someone deleted them (Halloween in Argyle had to be removed by hand on Oct 17).
- **Out-of-town lines start with the town and distance:** "St. Thomas · 23 km · …" / "圣托马斯 · 23 公里 · …", so nobody drives 30 km by surprise. Chinese town names: 圣托马斯, 英格索尔, 艾尔默.
- **Events note:** "The most popular family events nearby, each checked on the organizer's own page. Past events disappear on their own. Details can change, so check the event page before you go." (中文同步)
- **Design:** no new colours. Event pins and cards keep the existing 📅 pin and card style.
- **Tests:**
  - Unit tests check the 5 picks, their organizer links, 2026 dates in EN and ZH, the town · km prefixes, a valid `end` on every event, and hiding at the exact minute and day boundaries (Oct 23 6:59/7:00 PM, Oct 26, Oct 31 11:59 PM → Nov 1).
  - Headless runs at 4 `?now=` times: 9/8/5/0 cards, 8/7/4/0 pins, and the empty-state line. Screenshots: `v154-events-layer-{en,zh}.png`, `v154-events-list-{en,zh}(-2).png`.

### v=15.5.1 hotfix: the blue "you are here" dot was never drawn (Oct 18, 12:10 PM, [e6b12c4](https://github.com/bohemianwp/london-trick-or-treat/commit/e6b12c4) + [f881698](https://github.com/bohemianwp/london-trick-or-treat/commit/f881698))
Found while testing v15.6 (the far-away toast check never got a location fix). Not reported by a user. It was live from v15.1 (Oct 18, about 7:50 AM) until 12:09 PM.
- **Bug:** after allowing location, phones saw no blue dot, and a "This is not available right now" toast appeared instead.
- **Cause:** `app.js` had two `function showMe` declarations in the same scope: the location helper (draws the dot) and the v15.1 How-to "👀 Show me" helper. In JavaScript the later declaration wins, so every location fix ran the Show me helper with no feature name. That helper closed the sheet, found no target, and showed the toast. The dot was never drawn. Follow-me and marking still had the position, so only the dot and the toast were affected.
- **Fix:** the location helper is renamed `drawMeDot` ([e6b12c4](https://github.com/bohemianwp/london-trick-or-treat/commit/e6b12c4), 2 lines). The asset cache-buster went to `?v=15.5.1` so phones fetch the new `app.js` ([f881698](https://github.com/bohemianwp/london-trick-or-treat/commit/f881698); there is no service worker).
- **Verified live:** the page loads `app.js?v=15.5.1`, which contains `drawMeDot`. Headless against the live URL passed 192/192. A 390 px live screenshot with a London location (Wortley Village) shows the blue dot: `halloween_app/screenshots/v1551-medot-live.png`.
- **Guard (in v15.6, branch `stats`):** a unit test fails if two function declarations in `app.js` share a name, and the headless test checks the blue dot appears after a location fix.
### v=15.6: usage stats only the developer can see, a London-only note, and the "you are here" dot (Oct 18, 12:30 PM, branch `stats`, not pushed)
Peng, 11:04–11:46 AM: "哪里可以分析用户得使用情况吗" … "仅仅开发者我能看" ("Where can I analyze how users use it?" … "Only I, the developer, can see it.")
- **Private usage report.**
  - `supabase/v155_usage_stats.sql` adds `public.usage_stats(p_token, p_since)`. It returns aggregate counts only:
    - marks, split into test days and Oct 31 (practice is not stored);
    - decoration marks;
    - past-favourite pins, 👍, ❤️, replies and reports;
    - board posts, votes and reports, and suggestions;
    - distinct-phone counts (never the hashes) and counts per Toronto hour;
    - the top 5 H3 cells, and favourite spots rounded to ≈100 m.
  - Language is not stored. GoatCounter counts it instead.
  - The gate is a random 32-byte token. Only its sha256 is in `private.stats_token` (RLS on, no grants), and a wrong token raises `forbidden`. The plain token stays on the box, outside every repo.
  - `tools/usage_report.mjs` prints a plain-English summary plus the JSON.
  - Verified in PGlite (`tests/sql_usage_pglite_check.mjs`, 25/25): wrong/short/hash-as-token are refused, the counts are exact, by-hour sums match, there are no hashes or text in the output, and the tool runs end to end. `sql_pglite_check.mjs` is still 150/150.
  - The SQL is **not run yet**: the paste page is `sqlserve/v155_usage_stats.html`.
- **Anonymous visit counter (GoatCounter, cookieless).** One script tag. The site code `ltot-london` is confirmed (dashboard verified, visible only to logged-in users).
  - Events have fixed names only: `ev-lang-en|zh`, `ev-decor-share`, `ev-fav-share`, `ev-mark`, `ev-like`, `ev-heart`, `ev-reply`, `ev-show-me-<kind>`. `LIB.gcPath` allows only `a–z 0–9 -`. Events are sent after a successful send, never in `?demo=1`, and errors are swallowed.
  - The privacy notice replaces "No tracking" with: "We count visits anonymously, with no cookies, so we can improve the map. Only the developer sees these totals." / "我们匿名统计访问量，不用 cookie，只为改进地图。只有开发者能看到这些总数。" The summary line is now "📊 Visits are counted anonymously, with no cookies or ads." `REVIEW_safety_legal.md` has a PIPEDA addendum.

Peng, 11:50 AM: "注明一下这个程序仅为伦敦区域使用，不提供其他区域" ("State that this app is only for the London area and doesn't cover other areas.")
- **Why:** friends outside London may open the link and wonder why their town is empty.
- **What changed:**
  - One small grey line on the EN/中文 chooser (both languages, the first thing a new visitor sees) and at the foot of the Guide: "This map only covers London, Ontario. Other cities and areas are not included." / "本地图仅限安大略省伦敦市使用，不提供其他城市或地区。"
  - It uses the muted colour (#a7b2c5, AA), no new colours.
  - If the first location fix is more than ~25 km outside London, one toast says the same thing once per page load. The event towns (St. Thomas, Ingersoll, Aylmer) count as nearby, and nothing is stored.

Found while testing: the duplicate `showMe` hid the blue "you are here" dot. It shipped first as the **v=15.5.1 hotfix** (see above). v15.6 adds the guards: a unit test forbids duplicate function names in app.js, and the headless test checks the blue dot appears.
- Tests: unit 125/125, headless 203/203 (new: chooser note, Guide note EN/ZH, far-away toast EN/ZH, GoatCounter event stub, blue dot, no toast in London). `APP_VERSION v=15.6`.
- Screenshots: `halloween_app/screenshots/v156-chooser.png`, `v156-guide-{en,zh}.png`, `v156-toast-{en,zh}.png`.

### Promo video v4 + posters for friends' testing (Oct 18, 10:30 AM)
Peng, 10:03 AM: "重新在生成个视频和海报吧，我今天就要开始让朋友测试了。" ("Make the video and posters again. I'm starting testing with friends today.")
Peng, 10:10 AM: "把文案文字一起发给我" ("Send me the copy text too.")
- **Fresh captures from the live site (v15.5, demo data, 390×844 @3x, EN + 中文):** purple decorations button, the cream "💬 Loved a street in past years? Share it" button with its Show me ring, a past-favourite bubble with 👍 / ❤️, orange score dots, More wrapping onto rows with the Events layer, the Events list (v15.4 picks), a How-to feature card, and the Oct 31 night view (`?now=2026-10-31T19:30`).
- **Video** `halloween_app/promo_video_v4.mp4`: 1080×1920, 30 fps, H.264 High + AAC 48 kHz, 32.0 s, 13 scenes. Flow: hook → what it does + the two phases → 8 app scenes → gift line → privacy (no login, street level only, deleted by Nov 2) → end card with a large QR, "Testing now: tell us what you think! Guide → 💬 Feedback", "demo data" and the music credit ("Sneaky Snitch", Kevin MacLeod, CC BY 4.0). v3 was 780×1688; v4 uses the requested 1080×1920. Built by `halloween_app/promo4/build_v4.py` from `captions.json`.
- **Posters** `halloween_app/poster/poster-v154-1080x1920.png` and `poster-v154-1080x1080.png` (`build_v154.py`, `make_v154.sh`): same copy, privacy badges, testing line, new app screenshots, larger QR on the tall poster.
- **Clean design:** one font family (Noto Sans CJK SC, plus colour emoji), navy background, purple = decorations, cream = past favourites, orange = fun streets (and scores), no yellow, no stale wording (no "🔥 23 now", no ⌖).
- **QA:** the QR is the plain URL (`https://bohemianwp.github.io/london-trick-or-treat/`, no `?lang`), decoded with OpenCV from both posters and the video's end frames. Every caption was checked against the live app strings. All 235 characters have glyphs (no tofu). 6+ frames were extracted and reviewed. Both posters have no overflow, and the smallest text is 20 px.
- **Copy for Peng:** `halloween_app/promo/copy_v154.md` has every video caption in order, all poster text, and ready-to-paste posts (WeChat group, RedNote, X, LinkedIn).

## Issues and fixes
- **4:51 PM:** the map said "API key required" → OSM tiles with a dark filter.
- **Mac offline mid-build (3:31–3:52 PM):** the build was resumed after it came back. Later builds ran on the box.
- **v8:** test-day marks needed a shared mode without polluting Halloween night. Marks are shared Oct 17–20, deleted after 2 hours, and the window ends by itself.
- **v11 / v14 SQL:** Chinese text broke when pasted from plain text. SQL is now served as a UTF-8 HTML paste page, and the result row confirms the Chinese arrived intact.
- **v14:** the board stayed hidden on live until the SQL ran (PGRST202 → "missing"), so the site was never half-broken.
- **v14 design:** zoomed-out board pins rendered as big boxes → compact pills. A stray 34 px number was caught by the design test.
- **v14:** a smoke test leaves one suggestion row that anon can't delete; there's a one-line cleanup SQL.
- **v14.1:** board list counts overflowed the row; the popup ✕ was too small.
- **v15:**
  - EN layer chips needed 466 px on a 390 px phone → phase-aware main chips + More.
  - The one-time hint covered the chips → moved above the big button.
  - A removed helper (`closeHints`) was still called on the language chooser → fixed and covered by the headless check.
- **v15.1:** the v15 cleanup hid the only visible "share a past favourite" entry (regression, reported by Peng at 7:18 AM) → a permanent cream button under the big button, plus links from the popup and the explainer.

## Safety & privacy principles (kept throughout)
- **Street level only:** never a house, no names, photos or accounts. Privacy floors of 3 for every public count.
- **Grown-ups only:** text is filtered on the server (the client mirrors it), with no DMs or profiles.
- **Short retention:** fun-street marks 2 h, decorations 14 days, everything by Nov 2, 2026.
- **No dark patterns:** no push, no streaks, no leaderboards of people. Sounds and animations respect taps and `prefers-reduced-motion`.
- **Least privilege:** only the public anon key in the app; every server write goes through a validated RPC.
- Full review: `halloween_app/REVIEW_safety_legal.md` (PIPEDA principles, ethics, accessibility, addenda for v11, v14 and v15).

## How server changes were shipped
1. Write the SQL (idempotent) and test it in PGlite: on a fresh schema, on a copy of production, and running it twice.
2. Build the client so it is harmless until the SQL exists.
3. Serve a UTF-8 paste page and run it in the Supabase SQL Editor. Check the final status row.
4. Smoke-test the live project, push, wait for Pages, and check live with headless Chrome at 390×844.

## Open items
- Posters (sent at about 10:00 PM) show the v14 screen; re-render them from `halloween_app/poster/build.py` if the v15 look should be on them.
- `~/Desktop/万圣节讨糖App` on Peng's Mac needs a `git pull`.
- The full smoke run leaves one test suggestion, which anon can't delete. Remove it with the one-line SQL (`halloween_app/sqlserve/v14_smoke_cleanup.txt`) or `supabase/cleanup.sql`.
- After the test days (Oct 21), wipe test-day fun-street marks (see `supabase/v7_update.sql`).
- For Halloween night, consider a keyed tile provider if traffic is high (OSM tile policy).

## v=15.5 — Oct 18, 2026, ~10:30 AM EDT: the "Show me" ring no longer gets left behind

**Peng's request (10:09 AM):** "当我移动地图的时候会出现气泡不消失" ("When I move the map, a bubble appears and doesn't go away"), with a phone photo showing an empty white oval in the middle of the map.

**Why:** the How-to "👀 Show me" ring (v15.1) is drawn at a fixed spot on the screen. When the map is dragged, the bubble it points at moves away but the ring stays put, so it looks like a broken, empty bubble. Press-and-hold tips had the same weakness.

**What changed:** the ring now disappears as soon as the map moves or zooms, or when anything is touched, and it still disappears after 2 s on its own. Tips also hide when the map moves, and any new touch clears an old tip. Tests: 122/122 unit, 192/192 headless.
