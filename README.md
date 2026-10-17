# 🎃 Mark it! London Trick-or-Treat Map v3 · 标记它！伦敦万圣节讨糖地图

A free, phone-first map **for kids and families out trick-or-treating** in **London, Ontario** on **Sat Oct 31, 2026**.
Found a fun street? Tap the big glowing button. When 3 or more families mark the same spot, it lights up for everyone.
一个免费、手机优先的地图网页，**给出门讨糖的孩子和家长用**（安省伦敦，**2026 年 10 月 31 日，周六**）。
找到好玩的街道？点那个发光的大按钮。同一个地方有 3 个以上家庭标记，它就会在地图上亮起来。

| | What it does · 做什么 |
|---|---|
| ✨ **This spot is great! · 这里很热闹！** | The big arcade button. One tap marks where you are (one-shot location, blurred ~50 m). Location off? Tap the map instead. Then optional one-tap tags: 🍬 Lots of candy · 🎃 Great decorations · 👥 Crowded. Limit: 1 mark per 5 min, same spot once per 30 min. 大按钮：一点就标记你现在的位置（只定位一次，模糊约 50 米）。没开定位就点地图。之后可选标签：🍬 糖很多 · 🎃 装饰超棒 · 👥 人很多。限制：5 分钟一次，同一地方 30 分钟一次。 |
| 🔥 **Zones · 热区** | Marks from the last **45 min** (30–60, `config.js`) grouped into H3 hexagons **anywhere in London**. Shown only at **3+ marks**: teal 3–5 (Quiet), orange 6–14 (Lively), hot pink 15+ (Super hot, faster pulse). Badge "🔥 23 marked", top-tag emoji, **NEW** for 30 min after a zone first lights up. 最近 **45 分钟**的标记按 H3 六边形汇总，**全伦敦任何地方**都算。**3 个以上**才显示：青色 3–5（安静），橙色 6–14（很热闹），亮粉 15+（超级火爆，闪得更快）。 |
| 📍 **Near me · 我附近** | Live zones within 1 / 2 / 5 km, nearest first; tap to fly there, 🚶 to walk there. For families who'd rather stay close to home. 1/2/5 公里内的热区，近的在前；点一下飞过去，点 🚶 规划走过去。适合不想开车去市中心的家庭。 |
| 📌 **Suggest an area · 推荐一个区域** | Before Oct 31: pin your neighbourhood (only the ~800 m hexagon is kept) with an optional 80-character reason. At 3 suggestions it shows as 💜 Community suggested. 3 per phone per day, 1 per hexagon. 万圣节前在地图上推荐你的社区（只保存约 800 米的六边形），3 个家庭推荐后显示为 💜 社区推荐。 |
| 🧭 **Good areas to start · 推荐出发区** | The 10 researched neighbourhoods (dated sources) + events, drawn as a faint dashed "Suggested" base layer **under** the live zones. 10 个调研过的社区（带日期来源）+ 活动，作为淡淡的虚线「推荐」底层，画在实时热区**下面**。 |

Bottom tabs · 底部标签：**🗺️ Map 地图 · 🚶 Route 路线 · ✨ Mark it! 标记！ · 📖 Guide 指南**.
Top bar · 顶栏：🏆 Board 投票板 · 🦺 Safety 安全 · ? How-to 使用说明 · 中文/EN.
First visit shows 3 welcome cards (remembered in `ltot.guideSeen.v2`). 第一次打开会显示 3 张欢迎卡片。

No install, no login, no build step. 不用安装、不用登录、不需要编译。

---

## 1. Open it · 怎么打开

```bash
cd ~/Desktop/万圣节讨糖App
python3 -m http.server 8080
```

Open http://localhost:8080 . Stop with `Control + C`. 打开 http://localhost:8080，用完按 `Control + C` 停止。

**Live window · 实时时段**: Oct 31, 3–11 PM Toronto time marks are live and shared. Any other time marks stay on your phone as practice (🧪 **Practice mode** chip).
10 月 31 日下午 3 点到晚上 11 点（多伦多时间）标记实时共享；其他时间标记只存在你的手机上，算练习（显示 🧪 **练习模式**）。

**Demo & screenshot links · 演示和截图用的网址**

| URL | Shows · 显示 |
|---|---|
| `?demo=1` | Fake marks around Old South/Baker St, Old North, Carling Heights, Ferndale, plus hot **NEW** zones in Hyde Park and Lambeth and one 💜 community-suggested area. A new fake mark every ~4 s. Open it in **two tabs**: a mark in one shows in the other. 假标记 + 新热区 + 社区推荐，每 4 秒左右来一个新标记。**两个标签页**打开，一个标记另一个会出现。 |
| `?demo=1&near=1` | Opens **Near me** from a pretend home in Old South · 从老南区一个假想的家打开「我附近」 |
| `?guide=1` · `?howto=1` · `?lang=zh` / `?lang=en` | Welcome cards · How-to panel · language (combine freely) · 欢迎卡片 · 使用说明 · 语言（可组合） |
| `?tour=1` · `?tour=1&tourStep=4` | Plays the ▶ How to use tour · jumps to step N (1–7) and pauses there · 播放「▶ 怎么用」演示 · 跳到第 N 步（1–7）并暂停 |
| `?feedback=1` | Opens the 💬 Feedback panel · 打开「💬 反馈」面板 |
| `?now=2026-10-31T17:30:00-04:00` | Pretends it is that time, for the countdown only (screenshots) · 只让倒计时假装是这个时间（截图用） |

---

## 2. Local mode vs shared mode · 本地模式和共享模式

`config.js` decides · 由 `config.js` 决定：

- **`backend: 'local'`** (default · 默认) — everything stays in this browser (`localStorage` = the browser's built-in notebook). Tabs in the same browser share instantly (BroadcastChannel); zones are re-counted every 12 s.
  所有数据只存在这个浏览器里（`localStorage`，浏览器自带的小本子）。同一浏览器的多个标签页即时同步；热区每 12 秒重算。
- **`backend: 'supabase'`** — marks, suggestions and board posts are shared through your own free Supabase project; the app asks for zones every 30–60 s (`pollSec`). Setup: [`supabase/README.md`](supabase/README.md).
  通过你自己的免费 Supabase 项目共享；app 每 30–60 秒问一次服务器。设置步骤见 [`supabase/README.md`](supabase/README.md)。

If Supabase is selected but unreachable (or not filled in), the app falls back to local mode and shows **📴 Offline mode**.
选了 Supabase 但连不上（或没填好），会自动退回本地模式并显示 **📴 离线模式**。

---

## 3. Publish it free · 免费发布

Phones need an `https://` address for location. 手机定位需要 `https://` 地址。
This repo is published with **GitHub Pages** from `main` (Settings → Pages → Branch `main` / root). Netlify Drop also works.
这个仓库用 **GitHub Pages** 从 `main` 分支发布。Netlify Drop 也可以。

Files the site needs · 网站需要的文件：`index.html`, `styles.css`, `config.js`, `lib.js`, `i18n.js`, `backend.js`, `hex.js`, `app.js`, `demo.js`, `data/areas.js`.

---

## 4. Privacy in one paragraph · 隐私一段话说清

No accounts, names, emails, phone numbers or photos. A mark is rounded to ~50 m and moved randomly up to 25 m **before it leaves the phone or is stored**, carries a random ID that changes every 30 min, and is deleted after 2 hours. A zone appears only with **3 or more** marks — nobody can see a single mark. Suggestions keep only the ~800 m hexagon. Board text max 140 characters, suggestion reasons max 80; links and phone numbers are blocked. Full text: in the app → 🦺 Safety → Privacy.
不收集账号、姓名、邮箱、电话、照片。标记在**离开手机或被保存之前**先取整到约 50 米、再随机挪动最多 25 米，随机编号每 30 分钟换一次，2 小时后删除。一个热区**至少 3 个标记**才显示，没人能看到单个标记。推荐区域只保存约 800 米的六边形。帖子最多 140 字、推荐理由最多 80 字，链接和电话号码会被拦下。全文在 app 里：🦺 安全 → 隐私。

---

## 5. Files · 文件说明

| File 文件 | What 是什么 |
|---|---|
| `index.html` / `styles.css` | Page + neon Halloween/HUD theme, arcade button, CSS-animated zones · 页面 + 霓虹万圣节/雷达风格、街机按钮、CSS 动画热区 |
| `config.js` | Backend settings, `markWindowMin` (30–60), `pollSec` (EN/中文 comments) · 后端设置（中英注释） |
| `lib.js` | Pure functions: zone colours, 3+ rule, mark window, rate limits, blurring, Near me, suggestions, time window, text filter… (tested in Node) · 纯函数，可在 Node 里测试 |
| `i18n.js` | Every UI string in `en` and `zh` · 所有界面文字的中英两套 |
| `backend.js` | One data interface (`sendMark`, `tagMark`, `listZones`, `liveZoneCounts`, `suggestArea`, `communitySuggested`, board): LocalAdapter and SupabaseAdapter, automatic fallback · 数据层：本地 / Supabase 两种实现，自动切换 |
| `hex.js` | Map layers: one canvas for the faint planning base, SVG hexagons + CSS pulse for live zones, capped badges · 地图图层 |
| `demo.js` | Fake marks for `?demo=1` only · 只在 `?demo=1` 时加载的假数据 |
| `tour.js` | ▶ How to use: the tour timeline + spotlight; demo zones stay in memory · 「▶ 怎么用」演示的时间线和聚光灯，演示数据只在内存里 |
| `data/areas_researched.json` → `data/areas.js` | Research data (source of truth) → generated copy: `python3 tools/gen_areas.py` · 调研数据（原件）→ 页面用的生成副本 |
| `supabase/` | `schema.sql` (marks, suggestions, board + RPCs), `cleanup.sql`, setup README · 数据库 |
| `tests/` | Unit tests, `headless_check.mjs` (Chrome), `sql_pglite_check.mjs` (Postgres in WebAssembly), `supabase_smoke.mjs` + `load_sim.mjs` (need a real project) · 测试 |

## 6. Tests · 测试

```bash
node --test tests/*.test.js                   # unit tests: zones, rate limits, blurring, i18n, guide, data, backend · 单元测试
python3 -m http.server 8080 &                 # then · 然后
node tests/headless_check.mjs                 # browser checks at 390×844, screenshots → /tmp/ltot-test/v3-*.png
```

PGlite SQL check (no Supabase account needed) · 数据库检查（不需要 Supabase 账号）：see the header of `tests/sql_pglite_check.mjs`.

## Notes · 说明

- Area scores come from local news and parent reports (Oct 2024 – Oct 2026); every source is listed with its date. Live zones from real marks always win over them.
  社区评分来自本地新闻和家长反馈（2024 年 10 月至 2026 年 10 月），每条来源都带日期。真实标记形成的热区永远优先。
- Routing uses free public OSRM servers, only when you press *Build* or 🚶 on a zone; if they fail, the app draws straight lines and says so.
  路线用免费公共 OSRM 服务器，只在点「生成」或热区的 🚶 时调用；连不上就画直线并明确提示。
- Map © OpenStreetMap contributors. Hex grid: Uber H3 via `h3-js` (built-in hex grid if it fails to load). 地图 © OpenStreetMap 贡献者。六边形网格：Uber H3（`h3-js`），加载失败时用内置网格。
