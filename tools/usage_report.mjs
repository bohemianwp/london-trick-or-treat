#!/usr/bin/env node
// Private usage report (developer only). Calls the usage_stats RPC (supabase/v155_usage_stats.sql) and prints a short
// summary plus the JSON. Only aggregate counts come back; no device hashes, text or exact locations.
//   node tools/usage_report.mjs            → last 24 hours
//   node tools/usage_report.mjs 72         → last 72 hours
//   node tools/usage_report.mjs 2026-10-17 → since that day (00:00 Toronto)
// The token is read from ~/.secrets/ltot_stats_token (chmod 600, never in a repo). It is never printed.
// Overrides for testing: LTOT_STATS_TOKEN_FILE, LTOT_SUPABASE_URL, LTOT_SUPABASE_ANON_KEY.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokenFile = process.env.LTOT_STATS_TOKEN_FILE || join(homedir(), '.secrets', 'ltot_stats_token');
let token;
try {
  const st = statSync(tokenFile);
  if (st.mode & 0o077) console.error(`warning: ${tokenFile} is readable by others; run: chmod 600 ${tokenFile}`);
  token = readFileSync(tokenFile, 'utf8').trim();
} catch (e) { console.error(`No token file at ${tokenFile}.`); process.exit(2); }

function fromConfig() {
  const src = readFileSync(join(here, '..', 'config.js'), 'utf8');
  const url = (src.match(/supabaseUrl:\s*'([^']+)'/) || [])[1];
  const key = (src.match(/supabaseAnonKey:\s*'([^']+)'/) || [])[1];
  return { url, key };
}
const cfg = fromConfig();
const URL_ = (process.env.LTOT_SUPABASE_URL || cfg.url || '').replace(/\/$/, '');
const KEY = process.env.LTOT_SUPABASE_ANON_KEY || cfg.key;
if (!URL_ || !KEY) { console.error('config.js has no supabaseUrl / supabaseAnonKey.'); process.exit(2); }

function sinceArg(a) {
  if (!a) return new Date(Date.now() - 24 * 3600e3);
  if (/^\d+$/.test(a)) return new Date(Date.now() - Number(a) * 3600e3);
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return new Date(a + 'T00:00:00-04:00');   // Toronto (EDT until Nov 1)
  const d = new Date(a); if (isNaN(d)) { console.error('Bad time: ' + a); process.exit(2); } return d;
}
const since = sinceArg(process.argv[2]);

const res = await fetch(URL_ + '/rest/v1/rpc/usage_stats', {
  method: 'POST',
  headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_token: token, p_since: since.toISOString() }),
});
const body = await res.text();
if (!res.ok) {
  const msg = /forbidden/.test(body) ? 'The server refused the token (forbidden). Was v155_usage_stats.sql run with this token?' : body.slice(0, 300);
  console.error(`Error ${res.status}: ${msg}`); process.exit(1);
}
const s = JSON.parse(body);
const tz = { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' };
const fmt = (d) => new Date(d).toLocaleString('en-CA', tz) + ' (Toronto)';
const n = (x) => (typeof x === 'number' ? x : x ?? 0);
const lines = [];
lines.push(`Usage report · ${fmt(s.since)} → ${fmt(s.until)}`);
lines.push(`• Decorations: ${n(s.decorations.marks)} shared, from ${n(s.decorations.phone_days)} phone-days.`);
lines.push(`• Past favourites: ${n(s.past_favourites.pins)} pins, ${n(s.past_favourites.likes)} 👍, ${n(s.past_favourites.hearts)} ❤️, ${n(s.past_favourites.replies)} replies, ${n(s.past_favourites.reports)} reports, from ${n(s.past_favourites.phones)} phones.`);
lines.push(`• Fun-street marks: ${n(s.marks.total)} (${n(s.marks.real)} on Oct 31, ${n(s.marks.test)} on test days) from ${n(s.marks.sessions)} sessions. Marks are deleted after 2 h, so older ones are not counted. Practice is not stored.`);
lines.push(`• Board: ${n(s.board.posts)} posts, ${n(s.board.votes)} votes, ${n(s.board.reports)} reports. Suggestions: ${n(s.suggestions.total)} from ${n(s.suggestions.phones)} phones.`);
const busiest = [...(s.by_hour || [])].sort((a, b) => b.n - a.n)[0];
lines.push(busiest ? `• Busiest hour: ${busiest.hour} Toronto (${busiest.n} actions).` : '• No activity in this period.');
if ((s.top_cells || []).length) lines.push(`• Top map cells: ${s.top_cells.map((c) => `${c.cell} (${c.n})`).join(', ')}.`);
if ((s.top_fav_spots || []).length) lines.push(`• Top past-favourite spots: ${s.top_fav_spots.map((c) => `${c.lat},${c.lng} (${c.n})`).join('; ')}.`);
console.log(lines.join('\n'));
console.log('\n```json\n' + JSON.stringify(s, null, 2) + '\n```');
