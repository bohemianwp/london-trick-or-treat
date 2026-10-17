# Supabase setup · 共享后端设置（SPEC §9）

> **Nothing here has been done yet.** The app works fully in local mode without any of this.
> **这些都还没做。** 不做这些，app 在本地模式下也能完整使用。
> Only do this if you want markers, the board and live dots **shared between everyone's phones**.
> 只有当你想让房屋标记、投票板和实时圆点**在所有人手机之间共享**时才需要。

Supabase = a hosted database with a free plan (Postgres + an automatic web API).
Supabase 是一个托管数据库服务（Postgres 数据库 + 自动生成的网络接口），有免费套餐。

---

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

## 4. Test it · 测试（可选但推荐）

```bash
cd ~/Desktop/万圣节讨糖App
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node tests/supabase_smoke.mjs
```

It checks that the public key **cannot** read votes/secrets or write tables directly, that bad input is rejected,
and cleans up the test rows it creates. It refuses to run with a secret key.
它会检查公开密钥**不能**读投票、读密钥哈希、直接写表，检查不合规输入会被拒绝，并删掉自己建的测试数据。用 secret 密钥它会拒绝运行。

Optional load test (sends ~30 requests/second for 5 minutes to **your** project):
可选的压力测试（向**你自己的**项目每秒发约 30 个请求，持续 5 分钟）：

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... node tests/load_sim.mjs --yes
```

## 5. Publish the site · 发布网页（二选一）

- **Netlify Drop** — app.netlify.com/drop → drag the folder in (free account). 把文件夹拖进去（需免费账号）。
- **GitHub Pages** — free GitHub account + public repository. 免费 GitHub 账号 + 公开仓库。

Details in the main [README](../README.md). 详见主 [README](../README.md)。

## 6. Calendar · 日程提醒

| When 时间 | What 做什么 | Why 为什么 |
|---|---|---|
| **Oct 29–30** | Open the Supabase dashboard (or use the app once) · 打开一次控制台（或用一次 app） | Free projects **pause after 1 week without activity** · 免费项目**一周没活动会自动暂停** |
| **Oct 31, 3–11 PM** | Live dots open automatically · 实时圆点自动开放 | Window is enforced by the server too · 服务器端同样限制时间 |
| **Nov 1, 6 AM** | House markers expire automatically · 房屋标记自动过期 | |
| **Nov 2 or later** | Run [`cleanup.sql`](cleanup.sql) in the SQL Editor, or pause/delete the project · 在 SQL Editor 运行 `cleanup.sql`，或暂停/删除项目 | Privacy promise: delete everything after Nov 2 · 隐私承诺：11 月 2 日后全部删除 |

## Notes · 说明

- The app **polls** once a minute instead of using Realtime sockets, so the free plan's 200-connection Realtime limit doesn't apply.
  app 每分钟**轮询**一次，不用 Realtime 长连接，所以免费套餐 200 个并发连接的限制用不上。
- If Supabase is slow (> 5 s) or down, the app switches to local mode by itself and retries every 2 minutes.
  Supabase 太慢（超过 5 秒）或挂了，app 会自己切回本地模式，每 2 分钟重试一次。
- Posts/markers made while offline stay on that phone only (they are not uploaded later).
  离线期间发的帖子/标记只留在那台手机上（之后不会补传）。
- `schema.sql` was tested on PGlite (real Postgres 17 in WebAssembly) with Supabase-style roles: 47/47 checks passed.
  It has **not** been run on a real Supabase project yet — run `supabase_smoke.mjs` after step 2.
  `schema.sql` 在 PGlite（WebAssembly 版的真 Postgres 17）上按 Supabase 的角色设置测过：47/47 通过。
  **还没在真 Supabase 项目上跑过**——第 2 步之后请跑一次 `supabase_smoke.mjs`。
