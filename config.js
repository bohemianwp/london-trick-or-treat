/* ==========================================================================
   config.js — backend settings / 后端设置
   --------------------------------------------------------------------------
   backend         'local'    = everything stays in this browser (localStorage). Default. No account needed.
                   'supabase' = share marks, suggestions and board posts with everyone through your Supabase project.
                   'local'    = 所有数据只存在这个浏览器里（localStorage），默认值，不需要任何账号。
                   'supabase' = 通过你自己的 Supabase 项目，和所有人共享标记、推荐区域和投票板。

   supabaseUrl     Your project's URL, e.g. https://xxxx.supabase.co (Project Settings → API → Project URL).
                   你的项目网址，例如 https://xxxx.supabase.co（Project Settings → API → Project URL）。

   supabaseAnonKey The PUBLIC "anon" key only. NEVER paste the service_role key here — this file is public.
                   只填公开的 anon 密钥。绝对不要填 service_role 密钥——这个文件所有人都能看到。

   liveWindow      When marks are live and shared (wall-clock time in tz). The server checks this too.
                   Outside it, marks stay on this phone as practice ("Practice mode").
                   标记实时共享的时间段（按 tz 时区的当地时间），服务器端也会再检查。其他时间标记只存在本机，算「练习模式」。

   testWindow      Optional shared TEST days before Halloween: { from, to } local dates, both days included.
                   Marks are shared like Halloween night and the app shows "Test days" so testers know they get wiped.
                   The server must allow the same days: run supabase/v7_update.sql once.
                   可选的「试用期」：这几天标记也会共享，app 顶部会显示「试用期」。服务器端要先运行一次 supabase/v7_update.sql。

   markWindowMin   Zones count marks from the last N minutes (30–60, default 45).   热区统计最近 N 分钟的标记（30–60，默认 45）。
   pollSec         How often the app asks the server for zones, in seconds (30–60). 多少秒向服务器刷新一次热区（30–60）。
                   Local/demo mode re-counts every 12 s and instantly when another tab marks.
                   本地/演示模式每 12 秒重算一次，别的标签页一标记就立刻更新。

   A zone (hexagon) shows only when it has 3 or more marks — this is fixed, not a setting.
   一个热区（六边形）至少 3 个标记才会显示——这是固定的隐私规则，不能改。

   If backend is 'supabase' but the URL/key are empty or the server does not answer within 5 s,
   the app falls back to local mode automatically, shows an "Offline mode" chip and retries every 2 minutes.
   如果设成 'supabase' 但网址/密钥是空的，或者服务器 5 秒内没响应，app 会自动退回本地模式，
   显示「离线模式」小标签，并每 2 分钟重试一次。
   ========================================================================== */
window.TOT_CONFIG = {
  backend: 'supabase',         // 'local' | 'supabase'
  supabaseUrl: 'https://iufivsqvfngvvmnxihnt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1Zml2c3F2Zm5ndnZtbnhpaG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyNDg4MjcsImV4cCI6MjEwNzgyNDgyN30.DX2h7WUvrZkw-1KRtYOx2p1Qhf75uxcJ03rfhxFKpcQ',   // PUBLIC anon key (safe to publish; RLS + RPC checks protect the data)
  liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
  testWindow: { from: '2026-10-17', to: '2026-10-20', tz: 'America/Toronto' },   // shared test days (whole days, inclusive); remove after the test
  markWindowMin: 45,           // 30–60
  pollSec: 45                  // 30–60
};
