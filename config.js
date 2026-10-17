/* ==========================================================================
   config.js — backend settings / 后端设置
   --------------------------------------------------------------------------
   backend         'local'    = everything stays in this browser (localStorage). Default. No account needed.
                   'supabase' = share markers, board posts and live dots with everyone through your Supabase project.
                   'local'    = 所有数据只存在这个浏览器里（localStorage），默认值，不需要任何账号。
                   'supabase' = 通过你自己的 Supabase 项目，和所有人共享房屋标记、投票板和实时圆点。

   supabaseUrl     Your project's URL, e.g. https://xxxx.supabase.co (Project Settings → API → Project URL).
                   你的项目网址，例如 https://xxxx.supabase.co（Project Settings → API → Project URL）。

   supabaseAnonKey The PUBLIC "anon" key only. NEVER paste the service_role key here — this file is public.
                   只填公开的 anon 密钥。绝对不要填 service_role 密钥——这个文件所有人都能看到。

   liveWindow      When live dots and live hexes are allowed (wall-clock time in tz). The server checks this too.
                   允许实时圆点和实时热区的时间段（按 tz 时区的当地时间）。服务器端也会再检查一遍。

   dotTtlMin       A live dot disappears this many minutes after its last update.   实时圆点最后一次更新后多少分钟消失。
   hexWindowMin    Live hexes count dots from the last N minutes (15–30).            实时热区统计最近 N 分钟的圆点（15–30）。
   hexMinCount     Privacy floor: a hex is drawn only with at least this many dots.  隐私下限：圆点数不少于这个值才显示该六边形。
   pollSec         How often the app refreshes shared data, in seconds.              多少秒刷新一次共享数据。

   If backend is 'supabase' but the URL/key are empty or the server does not answer within 5 s,
   the app falls back to local mode automatically, shows an "Offline mode" chip and retries every 2 minutes.
   如果设成 'supabase' 但网址/密钥是空的，或者服务器 5 秒内没响应，app 会自动退回本地模式，
   显示「离线模式」小标签，并每 2 分钟重试一次。
   ========================================================================== */
window.TOT_CONFIG = {
  backend: 'local',            // 'local' | 'supabase'
  supabaseUrl: '',             // e.g. https://xxxx.supabase.co  (Peng fills in)
  supabaseAnonKey: '',         // public anon key only, never the service_role key
  liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
  dotTtlMin: 30, hexWindowMin: 20, hexMinCount: 3, pollSec: 60
};
