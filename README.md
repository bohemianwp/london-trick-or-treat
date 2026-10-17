# 🎃 London Trick-or-Treat Map v2 · 伦敦安省万圣节讨糖地图

A free, phone-first map for a happy, safe Halloween night (**Sat Oct 31, 2026**) in **London, Ontario**.
一个免费、手机优先的地图网页，帮伦敦（安省）的家长规划开心又安全的万圣节之夜（**2026 年 10 月 31 日，周六**）。

The first screen is the map plus 4 big buttons · 打开就是地图 + 4 个大按钮：

| Button 按钮 | What it does 做什么 |
|---|---|
| 🏘️ **Areas · 社区** | 10 researched neighbourhoods with scores, cautions and **dated sources**, plus an events list (HitV Oct 24, Camp Weathered, Somerset Monster House). 10 个调研过的社区（评分、注意事项、**带日期的来源**），加活动列表。 |
| 🗺️ **Route · 路线** | Walking loop for 30/60/90 min by kid age (OSRM foot routing, straight-line fallback). 按时间和孩子年龄生成步行环线。 |
| 📌 **Pins / Board · 标记 / 投票** | **Houses**: a household marks its own house — 🍬 candy, 🩵 teal pumpkin, 🍫 full-size, 🎃 decorations, 🐶 pet treats, 🕔 open early; one-tap *Giving now / Starting later / Out of candy*; optional hours. **Board**: "Most fun neighbourhood" and "Best decorations", one upvote per phone, report (hidden at 3). **房屋**：住户标自己家（类型、一键状态、时间）。**投票板**：两个板块，每台手机赞一次，举报 3 次自动隐藏。 |
| 📡 **Live · 实时** | ⬡ Hotspot hexagons (Quiet / Busy / Very busy) and opt-in anonymous family dots on **Oct 31, 3–11 PM** only. ⬡ 热区六边形 + 自愿分享的匿名家庭圆点（**仅 10/31 15:00–23:00**）。 |

Top bar: 🦺 Safety tips · 中文/EN toggle · countdown. Privacy page is linked from Safety and Live.
顶栏：🦺 安全提示 · 中英切换 · 倒计时。隐私说明从「安全」和「实时」里进入。

No install, no login, no build step. 不用安装、不用登录、不需要编译。

---

## 1. Open it · 怎么打开

```bash
cd ~/Desktop/万圣节讨糖App
python3 -m http.server 8080
```

Open http://localhost:8080 . Stop with `Control + C`. 打开 http://localhost:8080，用完按 `Control + C` 停止。
Double-clicking `index.html` also works (everything except location may be limited). 双击 `index.html` 也能用。

**Try the shared features on one computer · 在一台电脑上试共享功能**
Open http://localhost:8080/?demo=1 in **two tabs**. Posts, marker status and live dots made in one tab show up in the other.
Demo mode uses separate test data and turns live mode on regardless of the date.
用**两个标签页**打开 http://localhost:8080/?demo=1。一个标签页里发帖、改标记状态、分享圆点，另一个会同步出现。
演示模式用单独的测试数据，并且不管日期都打开实时模式。

---

## 2. Local mode vs shared mode · 本地模式和共享模式

`config.js` decides · 由 `config.js` 决定：

- **`backend: 'local'`** (default · 默认) — everything is stored in this browser only (`localStorage` = the browser's built-in notebook). No account, nothing leaves the phone. Good for trying it out; friends won't see each other's markers.
  所有数据只存在这个浏览器里（`localStorage`，浏览器自带的小本子）。不用账号，数据不出手机。适合试用，但朋友之间看不到彼此的标记。
- **`backend: 'supabase'`** — markers, posts and live dots are shared through your own free Supabase project. Setup steps: [`supabase/README.md`](supabase/README.md).
  通过你自己的免费 Supabase 项目共享。设置步骤见 [`supabase/README.md`](supabase/README.md)。

If Supabase is selected but unreachable (or not filled in), the app falls back to local mode by itself and shows a **📴 Offline mode** chip.
选了 Supabase 但连不上（或没填好），app 会自动退回本地模式，并显示 **📴 离线模式** 小标签。

Sharing a link still works in both modes: **Pins → Share link** packs your markers into the link (`#m=…`). Old v1 `#pins=` links still open.
两种模式下都能用链接分享：**标记 → 分享链接** 会把你的标记打包进链接。旧版 `#pins=` 链接仍然能打开。

---

## 3. Publish it free · 免费发布

Phones need an `https://` address for location. 手机定位需要 `https://` 地址。

- **Netlify Drop** (easiest · 最简单): https://app.netlify.com/drop → drag the folder in → you get `https://xxx.netlify.app`. A free account keeps the site up.
  把文件夹拖进去，得到一个 `https://xxx.netlify.app` 链接。注册免费账号网站才会长期保留。
- **GitHub Pages**: new public repository → upload the files → Settings → Pages → Branch `main` / root.
  新建公开仓库 → 上传文件 → Settings → Pages → 选 `main` 分支根目录。

Files the site needs · 网站需要的文件：`index.html`, `styles.css`, `config.js`, `lib.js`, `i18n.js`, `backend.js`, `hex.js`, `app.js`, `demo.js`, `data/areas.js`.
Not needed online · 不需要上传：`tests/`, `tools/`, `supabase/`, `app.v1.bak.js`, `*.md`, `*.log`.

---

## 4. Privacy in one paragraph · 隐私一段话说清

No accounts, names, emails, phone numbers or photos. Board text is max 140 characters; links and phone numbers are blocked. House markers expire **Nov 1, 6 AM**. Live dots are **off by default**, only on Oct 31 3–11 PM, rounded to ~50 m plus up to 25 m of random jitter, use a random ID that changes every 30 min, disappear after 30 min, stop by themselves after 90 min, and busy hexes show only when **3 or more** families are in one. Full text: in the app → 🦺 Safety → Privacy.
不收集账号、姓名、邮箱、电话、照片。帖子最多 140 字，链接和电话号码会被拦下。房屋标记 **11 月 1 日早上 6 点**过期。实时圆点**默认关闭**，只在 10/31 15:00–23:00 可开，位置取整到约 50 米再随机挪动最多 25 米，随机编号每 30 分钟换一次，30 分钟后消失，90 分钟后自动停止分享，一个六边形里**至少 3 个家庭**才显示热闹程度。全文在 app 里：🦺 安全 → 隐私。

---

## 5. Files · 文件说明

| File 文件 | What 是什么 |
|---|---|
| `index.html` / `styles.css` | Page + neon Halloween/HUD theme (system fonts only) · 页面 + 霓虹万圣节/雷达风格（只用系统字体） |
| `config.js` | Backend settings (EN/中文 comments) · 后端设置（中英注释） |
| `lib.js` | Pure functions: time window, coarsening, hex scores, text filter, SHA-256… (tested in Node) · 纯函数，可在 Node 里测试 |
| `i18n.js` | Every UI string in `en` and `zh` · 所有界面文字的中英两套 |
| `backend.js` | One data interface: LocalAdapter (localStorage + BroadcastChannel) and SupabaseAdapter, with automatic fallback · 数据层：本地 / Supabase 两种实现，自动切换 |
| `hex.js` | Hotspot layer: one canvas, H3 res 8 (h3-js) or built-in hex grid fallback · 热区图层 |
| `demo.js` | Test data for `?demo=1` only · 只在 `?demo=1` 时加载的测试数据 |
| `data/areas_researched.json` → `data/areas.js` | Research data (source of truth) → generated copy for the page: `python3 tools/gen_areas.py` · 调研数据（原件）→ 页面用的生成副本 |
| `supabase/` | `schema.sql`, `cleanup.sql`, setup README · 数据库建表、清理脚本、设置说明 |
| `tests/` | `node --test` unit tests; `headless_check.mjs` (Chrome); `sql_pglite_check.mjs`; `supabase_smoke.mjs` + `load_sim.mjs` (need a project) · 测试 |

## 6. Tests · 测试

```bash
node --test                                   # 34 unit tests: lib, i18n, data, backend · 单元测试
python3 -m http.server 8080 &                 # then · 然后
node tests/headless_check.mjs                 # 56 browser checks at 390×844, screenshots → /tmp/ltot-test/v2-*.png
```

## Notes · 说明

- Area scores come from local news and parent reports (Oct 2024 – Oct 2026); every source is listed with its date. The JSON's `crowd` (5 = comfortable) is inverted in the app (5 = very busy).
  社区评分来自本地新闻和家长反馈（2024 年 10 月至 2026 年 10 月），每条来源都带日期。JSON 里的 `crowd`（5 = 宽松）在 app 里反过来显示（5 = 很挤）。
- Routing uses free public OSRM servers, only when you press *Build*; if they fail, the app draws straight lines and says so.
  路线用免费公共 OSRM 服务器，只在点「生成」时调用；连不上就画直线并明确提示。
- Map © OpenStreetMap contributors. Hex grid: Uber H3 via `h3-js`. 地图 © OpenStreetMap 贡献者。六边形网格：Uber H3（`h3-js`）。
