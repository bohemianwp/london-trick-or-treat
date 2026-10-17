# Supabase setup · 共享后端设置（SPEC §9）

> **Nothing here has been done yet.** The app works fully in local mode without any of this.
> **这些都还没做。** 不做这些，app 在本地模式下也能完整使用。
> Only do this if you want the hot zones, neighbourhood suggestions and the board **shared between everyone's phones**.
> 只有当你想让热门区域、街区推荐和留言板**在所有人手机之间共享**时才需要。

Supabase = a hosted database with a free plan (Postgres + an automatic web API).
Supabase 是一个托管数据库服务（Postgres 数据库 + 自动生成的网络接口），有免费套餐。

---

## How it works · 工作原理

There are **no house markers and no live family dots** any more. Instead:
现在**没有房屋标记，也没有实时家庭圆点**了。改成：

- **Marks · 打点** — on Oct 31, 3–11 PM, a kid taps **"This spot is great!"**. The phone sends a *blurred* location
  (~50 m + jitter) and the H3 hex it falls in. The server keeps only a scrambled (hashed) copy of the phone's
  short-lived session id, never the id itself, and **deletes every mark after 2 hours**.
  10 月 31 日下午 3 点到晚上 11 点，孩子点一下 **"This spot is great!"**。手机只发一个*模糊过的*位置（约 50 米 + 随机偏移）
  和它所在的 H3 六边形格子编号。服务器只存会话编号的哈希（打乱后的指纹，倒推不回原值），**每个打点 2 小时后自动删除**。
- **Zones · 热区** — the app asks for counts per hex (H3 = a map cut into equal hexagons; "res 8" ≈ 0.7 km² each).
  A hex shows up **only when 3 or more marks** landed in it in the last 30–60 minutes, so nobody can be traced
  from a single mark. The app never gets points, ids or session hashes back.
  app 按六边形格子要数量（H3 是把地图切成一样大的六边形；res 8 每格约 0.7 平方公里）。一个格子**至少 3 个打点**
  （最近 30–60 分钟内）才会显示，单个打点没法追到人。app 拿不到具体坐标、编号或会话哈希。
- **Suggestions · 街区推荐** — anyone can say "put this neighbourhood on the map" (until Nov 1, 6 AM).
  One per hex per phone, 3 per phone per day; a hex is shown only after **3 different phones** suggested it.
  任何人都可以推荐「把这个街区加到地图上」（截止 11 月 1 日早上 6 点）。每台手机每个格子 1 次、每天最多 3 次；
  **3 台不同手机**推荐过同一个格子才会显示。
- **Board · 留言板** — unchanged (posts, votes, reports; 3 reports hide a post).
  不变（发帖、投票、举报；被举报 3 次自动隐藏）。

The app calls only these functions (RPCs = functions the app calls over the web API):
app 只调用这几个函数（RPC = app 通过网络接口调用的数据库函数）：

| Function 函数 | What 做什么 |
|---|---|
| `send_mark(p_session, p_lat, p_lng, p_h3, p_tags, p_token)` → mark id | one tap · 打一个点（每 5 分钟 1 次；同一格子 30 分钟 1 次） |
| `tag_mark(p_id, p_token, p_tag)` → tags | add `candy` / `decor` / `crowded` to your own mark within 15 min · 15 分钟内给自己的点加标签 |
| `zone_counts(p_window_min)` → `h3_r8, n, top_tag, top_tag_n, first_lit_at` | hot zones (3+ only) · 热区（只返回 3 个以上的） |
| `suggest_area(p_device, p_h3, p_lat, p_lng, p_reason)` → id | suggest a neighbourhood · 推荐街区 |
| `community_suggested()` → `h3_r8, n, lat, lng, reasons` | hexes with 3+ suggestions · 3 人以上推荐的格子 |
| `create_post`, `vote_post`, `report_post`, `delete_post` | board · 留言板 |

Nothing else is reachable with the public key: it cannot read or write any table except the visible board posts.
公开密钥只能做上面这些事：除了能看到未隐藏的帖子，任何表都不能直接读写。

## 1. Create the project · 创建项目（约 5 分钟）

1. Go to **supabase.com** → *Start your project* → sign up with email or GitHub.
   打开 **supabase.com** → *Start your project* → 用邮箱或 GitHub 注册。
2. *New project* → name **`london-tot`** → region **Canada (Central)** → set a strong database password (save it in your password manager).
   *New project* → 名字填 **`london-tot`** → 区域选 **Canada (Central)** → 设一个强数据库密码（存进密码管理器）。
3. Plan: **Free**. 套餐选 **Free（免费）**。

## 2. Create the tables · 建表（1 分钟）

Dashboard → **SQL Editor** → *New query* → paste all of [`schema.sql`](schema.sql) → **Run**.
控制台 → **SQL Editor** → *New query* → 把 [`schema.sql`](schema.sql) 全部粘贴进去 → **Run**。

You should see "Success. No rows returned". 应看到 “Success. No rows returned”。

It is safe to run it again later (for example after an update). If you had already run the **old v2** schema,
running this one removes the old house-marker and live-dot tables and keeps your board posts.
以后再跑一次也没关系（比如更新之后）。如果你之前跑过**旧版 v2**，这次会删掉旧的房屋标记和实时圆点表，留言板帖子保留。

## 3. Connect the app · 连接 app

Dashboard → **Project Settings → API** (newer dashboards: **API Keys**):
控制台 → **Project Settings → API**（新版控制台叫 **API Keys**）：

- copy the **Project URL** · 复制 **Project URL**
- copy the **anon public** key (newer projects may call it the **publishable** key) · 复制 **anon public** 密钥（新项目可能叫 **publishable** 密钥）
- ⛔ **never** copy the `service_role` / secret key into the app — `config.js` is public. 绝对不要把 `service_role` / secret 密钥放进 app——`config.js` 是公开的。

Edit `config.js` · 修改 `config.js`：

```js
backend: 'supabase',
supabaseUrl: 'https://xxxx.supabase.co',
supabaseAnonKey: 'eyJ… or sb_publishable_…',
```

Reload the app. If the "📴 Offline mode" chip appears, the URL or key is wrong (tap the chip to see why).
刷新 app。如果出现「📴 离线模式」小标签，说明网址或密钥不对（点一下标签看原因）。

## 4. Test it · 测试

**Without any Supabase account** (recommended before step 2) — runs `schema.sql` in PGlite, a real Postgres
that runs inside Node in memory, and attacks it as the public role:
**不需要 Supabase 账号**（建议在第 2 步之前跑）——在 PGlite（在 Node 里、内存中运行的真 Postgres）里跑 `schema.sql`，
再用公开角色去「攻击」它：

```bash
mkdir -p /tmp/ltot-sqlcheck && cd /tmp/ltot-sqlcheck && npm install @electric-sql/pglite@0.3
cp ~/Desktop/万圣节讨糖App/tests/sql_pglite_check.mjs .
node sql_pglite_check.mjs ~/Desktop/万圣节讨糖App/supabase/schema.sql ~/Desktop/万圣节讨糖App/supabase/cleanup.sql
```

The last line should say `… passed, 0 failed`. 最后一行应是 `… passed, 0 failed`。

**Against your real project** — `tests/supabase_smoke.mjs` checks RLS and every RPC with the public key only
(it leaves 1 test suggestion with a fake hexagon id; `cleanup.sql` removes it). `tests/load_sim.mjs` simulates the
Oct 31 peak (500 phones polling `zone_counts` every 45 s, 150 phones marking every 5 min). Neither has been run against a real project yet.
**对真项目测试**——`tests/supabase_smoke.mjs` 只用公开密钥检查权限和每个函数（会留下 1 条假格子的测试推荐，`cleanup.sql` 能删掉）。
`tests/load_sim.mjs` 模拟 10 月 31 日晚高峰（500 台手机每 45 秒查热区，150 台手机每 5 分钟标记一次）。两个都还没对真项目跑过。

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node tests/supabase_smoke.mjs
SUPABASE_URL=... SUPABASE_ANON_KEY=... node tests/load_sim.mjs --yes   # ~23 requests/s for 5 min · 每秒约 23 个请求，5 分钟
```

## 5. Publish the site · 发布网页（二选一）

- **Netlify Drop** — app.netlify.com/drop → drag the folder in (free account). 把文件夹拖进去（需免费账号）。
- **GitHub Pages** — free GitHub account + public repository. 免费 GitHub 账号 + 公开仓库。

Details in the main [README](../README.md). 详见主 [README](../README.md)。

## 6. Calendar · 日程提醒

| When 时间 | What 做什么 | Why 为什么 |
|---|---|---|
| **Oct 29–30** | Open the Supabase dashboard (or use the app once) · 打开一次控制台（或用一次 app） | Free projects **pause after 1 week without activity** · 免费项目**一周没活动会自动暂停** |
| **Oct 31, 3–11 PM** | Marks open automatically · 打点自动开放 | Window is enforced by the server too · 服务器端同样限制时间 |
| **Oct 31 – Nov 1** | Marks delete themselves 2 hours after they were made · 打点 2 小时后自动删除 | Nothing to do · 不用管 |
| **Nov 1, 6 AM** | Suggestions close · 街区推荐截止 | |
| **Nov 2 or later** | Run [`cleanup.sql`](cleanup.sql) in the SQL Editor, or pause/delete the project · 在 SQL Editor 运行 `cleanup.sql`，或暂停/删除项目 | Privacy promise: delete everything after Nov 2 · 隐私承诺：11 月 2 日后全部删除 |

## Notes · 说明

- **Old marks are cleaned up without a timer**: every `send_mark` and `zone_counts` call first deletes marks older
  than 2 hours. A timer (pg_cron, every 10 min) is **optional** — the commented-out lines at the end of `schema.sql` show how.
  **旧打点不需要定时器也会被清掉**：每次调用 `send_mark` 和 `zone_counts` 都会先删掉 2 小时前的打点。
  定时任务（pg_cron，每 10 分钟）是**可选的**——`schema.sql` 末尾被注释掉的几行写了怎么开。
- The app **polls** once a minute instead of using Realtime sockets, so the free plan's 200-connection Realtime limit doesn't apply.
  app 每分钟**轮询**一次，不用 Realtime 长连接，所以免费套餐 200 个并发连接的限制用不上。
- If Supabase is slow (> 5 s) or down, the app switches to local mode by itself and retries every 2 minutes.
  Supabase 太慢（超过 5 秒）或挂了，app 会自己切回本地模式，每 2 分钟重试一次。
- Posts made while offline stay on that phone only (they are not uploaded later).
  离线期间发的帖子只留在那台手机上（之后不会补传）。
- `schema.sql` was tested on PGlite (real Postgres 17 in WebAssembly) with Supabase-style roles: 75/75 checks passed,
  including running it twice and running it over the old v2 schema.
  It has **not** been run on a real Supabase project yet.
  `schema.sql` 在 PGlite（WebAssembly 版的真 Postgres 17）上按 Supabase 的角色设置测过：75/75 通过，
  包括连跑两次、以及在旧版 v2 上直接跑。**还没在真 Supabase 项目上跑过。**
