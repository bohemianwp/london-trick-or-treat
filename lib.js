/* London Trick-or-Treat Map — pure helpers (no DOM, no Leaflet).
   Works in the browser (window.TOT_LIB) and in Node (require('./lib.js')) so it can be unit-tested. */
(function (root, factory) {
  var lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.TOT_LIB = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZ = 'America/Toronto';
  var LONDON_BOX = { latMin: 42.85, latMax: 43.10, lngMin: -81.45, lngMax: -81.05 };
  var LAT0 = 42.98, LNG0 = -81.245;          // fixed reference so the coarsening grid never shifts
  var M_PER_DEG_LAT = 111320;
  var M_PER_DEG_LNG = 111320 * Math.cos(LAT0 * Math.PI / 180);
  var BOARDS = ['fun', 'decor'];
  var DEFAULT_WINDOW = { date: '2026-10-31', start: '15:00', end: '23:00', tz: TZ };
  var APP_VERSION = 'v=15.5.1';                      // must match every ?v= in index.html (tests check this)

  // ==== time zones ====
  // Offset (minutes, local - UTC) of `tz` at instant `ms`. Uses Intl, so DST is handled by the browser/Node tz data.
  var dtfCache = {};
  function tzOffsetMin(ms, tz) {
    var f = dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  // 'YYYY-MM-DD' + 'HH:MM' wall-clock time in `tz` -> UTC milliseconds.
  function zonedToUtcMs(dateStr, timeStr, tz) {
    var d = dateStr.split('-').map(Number), t = timeStr.split(':').map(Number);
    var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1] || 0);
    var off = tzOffsetMin(guess, tz || TZ);
    var ms = guess - off * 60000;
    var off2 = tzOffsetMin(ms, tz || TZ);
    if (off2 !== off) ms = guess - off2 * 60000;
    return ms;
  }
  // v15.4 events: `end` is the last local (Toronto) day 'YYYY-MM-DD' (hidden from the next midnight) or an exact end
  // 'YYYY-MM-DDTHH:MM' (hidden from that minute). No/invalid `end` = always shown. Past events hide by themselves.
  function eventEndMs(e) {
    var end = e && e.end;
    if (typeof end !== 'string') return null;
    var m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(end);
    if (!m) return null;
    return m[2] ? zonedToUtcMs(m[1], m[2], TZ) : zonedToUtcMs(nextDay(m[1]), '00:00', TZ);
  }
  function eventActive(e, nowMs) { var end = eventEndMs(e); return end === null || nowMs < end; }
  function activeEvents(list, nowMs) { return (list || []).filter(function (e) { return eventActive(e, nowMs); }); }
  function liveWindow(cfg) {
    var w = (cfg && cfg.liveWindow) || DEFAULT_WINDOW;
    return { start: zonedToUtcMs(w.date, w.start, w.tz), end: zonedToUtcMs(w.date, w.end, w.tz) };
  }
  // Optional shared test window before Halloween (config.testWindow: { from, to, tz }, dates inclusive, local days).
  // Example: { from: '2026-10-17', to: '2026-10-20' } = Oct 17 00:00 until Oct 21 00:00 Toronto.
  function nextDay(d) { var x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)); return x.toISOString().slice(0, 10); }
  function testWindow(cfg) {
    var w = cfg && cfg.testWindow;
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(w.to || '')) return null;
    return { start: zonedToUtcMs(w.from, '00:00', w.tz || TZ), end: zonedToUtcMs(nextDay(w.to), '00:00', w.tz || TZ) };
  }
  function isTestOpen(nowMs, cfg) { var w = testWindow(cfg); return !!w && nowMs >= w.start && nowMs < w.end; }
  // Live (shared) marking is open inside the Halloween window (inclusive start, exclusive end), during the test window,
  // or always in demo mode.
  function isLiveOpen(nowMs, cfg, demo) {
    if (demo) return true;
    var w = liveWindow(cfg);
    return (nowMs >= w.start && nowMs < w.end) || isTestOpen(nowMs, cfg);
  }
  // Nov 1, 2026 06:00 in Toronto. DST ends at 2 AM that morning, so this is 06:00 EST (UTC-5) = 11:00 UTC.
  // After this, suggestions close (the night is over).
  var SEASON_END_MS = zonedToUtcMs('2026-11-01', '06:00', TZ);

  // ==== geometry ====
  function distM(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function inLondonBox(lat, lng) {
    return isFinite(lat) && isFinite(lng) &&
      lat >= LONDON_BOX.latMin && lat <= LONDON_BOX.latMax && lng >= LONDON_BOX.lngMin && lng <= LONDON_BOX.lngMax;
  }
  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

  // Coarsen a position before it leaves the phone: snap to a ~50 m grid, then add up to 25 m of random jitter.
  function coarsen(lat, lng, rnd, gridM, jitterM) {
    rnd = rnd || Math.random;
    gridM = gridM || 50;
    jitterM = jitterM === undefined ? 25 : jitterM;
    var y = Math.round((lat - LAT0) * M_PER_DEG_LAT / gridM) * gridM;
    var x = Math.round((lng - LNG0) * M_PER_DEG_LNG / gridM) * gridM;
    var ang = rnd() * 2 * Math.PI, r = jitterM * Math.sqrt(rnd());
    y += r * Math.sin(ang);
    x += r * Math.cos(ang);
    return [round(LAT0 + y / M_PER_DEG_LAT, 6), round(LNG0 + x / M_PER_DEG_LNG, 6)];
  }

  // ==== ids, sessions ====
  function randomHex(n, rnd) {
    var s = '', i;
    var c = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto : null;
    if (!rnd && c) {
      var b = new Uint8Array(Math.ceil(n / 2));
      c.getRandomValues(b);
      for (i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      return s.slice(0, n);
    }
    rnd = rnd || Math.random;
    for (i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16);
    return s;
  }
  function uuid() {
    var h = randomHex(32);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
      ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32);
  }
  var SESSION_MS = 30 * 60000;
  // Random mark session id, not tied to the device; a new one every 30 minutes.
  function nextSession(prev, nowMs, rnd) {
    if (prev && prev.id && nowMs - prev.startedAt < SESSION_MS && nowMs >= prev.startedAt) return prev;
    return { id: randomHex(32, rnd), startedAt: nowMs };
  }

  // ==== marks & zones ====
  var MARK_TAGS = ['candy', 'decor', 'crowded'];
  var TAG_ICON = { candy: '🍬', decor: '🎃', crowded: '👥' };
  var MIN_ZONE = 3;                     // privacy floor: a zone shows only at 3+ marks
  var NEW_MS = 30 * 60000;              // "NEW" badge for 30 min after a zone first lights up
  var MARK_KEEP_MS = 2 * 3600000;       // marks are deleted after 2 hours
  var RATE_DEVICE_MS = 5 * 60000, RATE_ZONE_MS = 30 * 60000;
  function clampWindow(w) { w = Number(w) || 45; return Math.min(60, Math.max(30, Math.round(w))); }
  // Zone colour from the number of marks in the window: <3 none, 3–5 teal, 6–14 orange, 15+ hot pink.
  var BUCKET_ICON = { quiet: '🕯️', lively: '🎉', hot: '🔥' };   // v13: no fire emoji for a quiet zone
  function zoneBucket(n) { return n < MIN_ZONE ? null : n < 6 ? 'quiet' : n < 15 ? 'lively' : 'hot'; }
  // v10: honest feedback after a mark. before/after = this zone's mark count just before / after the mark
  // (null = not visible, i.e. below 3). exact = true only when the phone really knows a below-3 count (local, demo,
  // offline); the server never reveals counts below 3 (privacy floor), so then we say "1–2 more".
  function markProgress(before, after, exact) {
    if (after != null && after >= MIN_ZONE) {
      var b0 = before != null && before >= MIN_ZONE ? zoneBucket(before) : null, b1 = zoneBucket(after);
      return { kind: 'lit', k: after, bucket: b1, crossed: b0 === b1 ? null : b1 === 'quiet' ? 'lit' : b1 };
    }
    if (exact && after != null) return { kind: 'need', n: Math.max(1, MIN_ZONE - after) };
    return { kind: 'needSome' };
  }
  // Personal badges, on this phone only (no names, no leaderboard).
  var BADGES = [{ at: 1, key: 'badge1', icon: '👻' }, { at: 3, key: 'badge3', icon: '🎃' }, { at: 5, key: 'badge5', icon: '🍬' }];
  function badgeFor(n) { var b = null; BADGES.forEach(function (x) { if (n >= x.at) b = x; }); return b; }
  function newBadge(prevN, n) { var a = badgeFor(prevN), b = badgeFor(n); return b && (!a || a.at !== b.at) ? b : null; }
  // Gentle in-app hint (no push): only while sharing is open (Halloween night / test days), the app is visible,
  // nothing was shared in the last 20 min, and the last hint was 20+ min ago.
  var NUDGE_MS = 20 * 60000;
  function shouldNudge(mode, lastMarkAt, lastNudgeAt, nowMs) {
    if (mode !== 'live' && mode !== 'test' && mode !== 'demo') return false;
    return nowMs - (lastMarkAt || 0) >= NUDGE_MS && nowMs - (lastNudgeAt || 0) >= NUDGE_MS;
  }
  // ==== v11: "Best decorations / 最佳装饰" layer (pre-Halloween) ====
  // A separate mark type: zone level only (same hex grid, 50 m blur), visible at 3+ marks, counted over 14 days.
  // Shared Oct 17 00:00 until Nov 1 00:00 Toronto; every decor mark is deleted from Nov 2 00:00 Toronto.
  var DECOR_TAGS = ['spooky', 'funny', 'lights', 'mustsee'];
  var DECOR_ICON = { spooky: '👻', funny: '😄', lights: '✨', mustsee: '🏆' };
  var DECOR_OPEN = { start: zonedToUtcMs('2026-10-17', '00:00', TZ), end: zonedToUtcMs('2026-11-01', '00:00', TZ) };
  var DECOR_PURGE_MS = zonedToUtcMs('2026-11-02', '00:00', TZ);
  var DECOR_KEEP_MS = 14 * 864e5, DECOR_MAX_DAY = 10;
  var DECOR_PRIMARY_FROM = zonedToUtcMs('2026-10-31', '15:00', TZ);   // from here the big button is the fun-street button
  function isDecorOpen(nowMs, demo) { return !!demo || (nowMs >= DECOR_OPEN.start && nowMs < DECOR_OPEN.end); }
  function decorVisible(nowMs, demo) { return !!demo || nowMs < DECOR_PURGE_MS; }        // layer stays visible until the purge
  function decorPrimary(nowMs, demo) { return isDecorOpen(nowMs, demo) && nowMs < DECOR_PRIMARY_FROM; }   // demo follows the calendar too
  // v13: the two phases, for the banner and the big button. 'decor' until Oct 31 3 PM, 'night' until Nov 1 00:00, then 'after'.
  var NIGHT_END_MS = zonedToUtcMs('2026-11-01', '00:00', TZ);
  function appPhase(nowMs) { return nowMs < DECOR_PRIMARY_FROM ? 'decor' : nowMs < NIGHT_END_MS ? 'night' : 'after'; }
  // Toronto calendar day 'YYYY-MM-DD' (the server uses the same day for its per-day limits).
  function torontoDay(ms) { return new Date(ms + tzOffsetMin(ms, TZ) * 60000).toISOString().slice(0, 10); }
  function cleanDecorTags(tags) {
    return (Array.isArray(tags) ? tags : []).filter(function (t, i, a) { return DECOR_TAGS.indexOf(t) >= 0 && a.indexOf(t) === i; });
  }
  function decorTagsValid(tags) { return (tags || []).every(function (t) { return DECOR_TAGS.indexOf(t) >= 0; }); }
  // history: [{t, cell}] from this device. Same hex once per Toronto day, max 10 per day.
  function decorRate(history, cell, nowMs) {
    var day = torontoDay(nowMs), today = (history || []).filter(function (h) { return h.t <= nowMs && torontoDay(h.t) === day; });
    if (today.some(function (h) { return h.cell === cell; })) return { ok: false, reason: 'zone' };
    if (today.length >= DECOR_MAX_DAY) return { ok: false, reason: 'day' };
    return { ok: true };
  }
  // Most common tag (ties: DECOR_TAGS order), shown only when 2+ marks carry it.
  function decorTopTag(tagCounts) {
    var best = null, bestN = 0;
    DECOR_TAGS.forEach(function (t) { if ((tagCounts[t] || 0) > bestN) { best = t; bestN = tagCounts[t]; } });
    return bestN >= 2 ? best : null;
  }
  // marks: [{cell?, lat, lng, tags, createdAt}] -> decor zones with 3+ marks in the last 14 days, most marked first.
  // After the Nov 2 purge nothing is shown (demo excepted).
  function aggregateDecor(marks, cellFn, nowMs, max, demo) {
    var cells = {};
    if (!decorVisible(nowMs, demo)) return [];
    (marks || []).forEach(function (m) {
      if (m.createdAt > nowMs || nowMs - m.createdAt > DECOR_KEEP_MS) return;
      var c = m.cell || (cellFn ? cellFn(m.lat, m.lng) : null);
      if (!c) return;
      var z = cells[c] || (cells[c] = { cell: c, count: 0, tags: {} });
      z.count++;
      cleanDecorTags(m.tags).forEach(function (t) { z.tags[t] = (z.tags[t] || 0) + 1; });
    });
    return decorateDecor(Object.keys(cells).map(function (k) {
      var z = cells[k], t = decorTopTag(z.tags);
      return { cell: z.cell, count: z.count, tags: z.tags, topTag: t, topTagN: t ? z.tags[t] : 0 };
    }), max);
  }
  // Server rows ({cell, count, topTag, topTagN}) -> sorted decor zones, re-checking the 3+ rule and the tag list.
  function decorateDecor(rows, max) {
    return (rows || []).filter(function (r) { return r && r.count >= MIN_ZONE; }).map(function (r) {
      var ok = DECOR_TAGS.indexOf(r.topTag) >= 0 && (r.topTagN == null || r.topTagN >= 2);
      return { cell: r.cell, count: r.count, tags: r.tags || {}, topTag: ok ? r.topTag : null, topTagN: ok ? (r.topTagN || null) : 0, kind: 'decor' };
    }).sort(function (a, b) { return (b.count - a.count) || (a.cell < b.cell ? -1 : 1); }).slice(0, max || 400);
  }
  function cleanTags(tags) {
    return (Array.isArray(tags) ? tags : []).filter(function (t, i, a) { return MARK_TAGS.indexOf(t) >= 0 && a.indexOf(t) === i; });
  }
  function tagsValid(tags) { return (tags || []).every(function (t) { return MARK_TAGS.indexOf(t) >= 0; }); }
  function marksInWindow(marks, nowMs, windowMin) {
    var cut = nowMs - clampWindow(windowMin) * 60000;
    return marks.filter(function (m) { return m.createdAt > cut && m.createdAt <= nowMs; });
  }
  // A tag is "common" in a zone when at least 2 marks and 30% of them carry it.
  function topTag(tagCounts, n) {
    var best = null, bestN = 0;
    MARK_TAGS.forEach(function (t) { if ((tagCounts[t] || 0) > bestN) { best = t; bestN = tagCounts[t]; } });
    return bestN >= 2 && bestN >= 0.3 * n ? best : null;
  }
  // marks: [{cell?, lat, lng, tags, createdAt}] -> zones with 3+ marks in the window, hottest first.
  // firstLitAt = time of the 3rd-oldest stored mark in the cell (the moment the zone first reached 3).
  function aggregateZones(marks, cellFn, nowMs, windowMin, max) {
    var cut = nowMs - clampWindow(windowMin) * 60000, cells = {};
    marks.forEach(function (m) {
      if (m.createdAt > nowMs || nowMs - m.createdAt > MARK_KEEP_MS) return;
      var c = m.cell || (cellFn ? cellFn(m.lat, m.lng) : null);
      if (!c) return;
      var z = cells[c] || (cells[c] = { cell: c, count: 0, tags: {}, times: [] });
      z.times.push(m.createdAt);
      if (m.createdAt <= cut) return;
      z.count++;
      cleanTags(m.tags).forEach(function (t) { z.tags[t] = (z.tags[t] || 0) + 1; });
    });
    var out = [];
    Object.keys(cells).forEach(function (k) {
      var z = cells[k];
      if (z.count < MIN_ZONE) return;                         // 3+ rule: nothing below that leaves this function
      z.times.sort(function (a, b) { return a - b; });
      z.firstLitAt = z.times[MIN_ZONE - 1];
      delete z.times;
      z.topTag = topTag(z.tags, z.count);
      z.bucket = zoneBucket(z.count);
      z.isNew = isZoneNew(z.firstLitAt, nowMs);
      out.push(z);
    });
    out.sort(function (a, b) { return b.count - a.count; });
    return out.slice(0, max || 300);
  }
  function isZoneNew(firstLitAt, nowMs) { return !!firstLitAt && nowMs - firstLitAt >= 0 && nowMs - firstLitAt < NEW_MS; }
  // Server rows ({cell, count, topTag, firstLitAt}) -> the same shape as aggregateZones, re-checking the 3+ rule.
  function decorateZones(rows, nowMs) {
    return rows.filter(function (r) { return r && r.count >= MIN_ZONE; }).map(function (r) {
      return { cell: r.cell, count: r.count, tags: r.tags || {}, topTag: MARK_TAGS.indexOf(r.topTag) >= 0 && (r.topTagN || 2) >= 2 ? r.topTag : null,
               firstLitAt: r.firstLitAt || null, isNew: isZoneNew(r.firstLitAt, nowMs), bucket: zoneBucket(r.count) };
    }).sort(function (a, b) { return b.count - a.count; });
  }
  // Rate limits for marking. history: [{t, cell}] from this device. 1 mark per 5 min, 1 per zone per 30 min.
  function markRate(history, cell, nowMs) {
    var last = 0, lastZone = 0;
    (history || []).forEach(function (h) {
      if (h.t > nowMs) return;
      if (h.t > last) last = h.t;
      if (h.cell === cell && h.t > lastZone) lastZone = h.t;
    });
    if (last && nowMs - last < RATE_DEVICE_MS) return { ok: false, reason: 'device', waitMs: RATE_DEVICE_MS - (nowMs - last) };
    if (lastZone && nowMs - lastZone < RATE_ZONE_MS) return { ok: false, reason: 'zone', waitMs: RATE_ZONE_MS - (nowMs - lastZone) };
    return { ok: true };
  }
  function pruneHistory(history, nowMs) { return (history || []).filter(function (h) { return nowMs - h.t < 24 * 3600000; }).slice(-50); }
  // Blur a position before it leaves the phone or is stored: ~50 m grid + up to 25 m random jitter.
  function blurPoint(lat, lng, rnd) { return coarsen(lat, lng, rnd, 50, 25); }
  // "Near me": zones within radiusKm of center, nearest first. centerOf(cell) -> [lat, lng].
  function nearZones(zones, center, radiusKm, centerOf) {
    var r = (radiusKm || 2) * 1000;
    return zones.map(function (z) {
      var c = centerOf(z.cell);
      return Object.assign({}, z, { center: c, distM: Math.round(distM(center, c)) });
    }).filter(function (z) { return z.distM <= r; })
      .sort(function (a, b) { return (a.distM - b.distM) || (b.count - a.count); });
  }
  // Practice outside the live window, live inside it, demo always.
  function markMode(nowMs, cfg, demo) {
    if (demo) return 'demo';
    var w = liveWindow(cfg);
    if (nowMs >= w.start && nowMs < w.end) return 'live';
    return isTestOpen(nowMs, cfg) ? 'test' : 'practice';     // 'test' = shared like live, labelled "Test days"
  }

  // ==== community suggestions ("Suggest an area") ====
  var SUGGEST_MAX_DAY = 3, SUGGEST_MIN = 3;
  function checkReason(text) { return checkText(text, { max: 80, optional: true }); }
  // history: [{t, cell}] -> 3 per device per day, 1 per hex.
  function suggestRate(history, cell, nowMs) {
    var day = (history || []).filter(function (h) { return nowMs - h.t < 24 * 3600000; });
    if ((history || []).some(function (h) { return h.cell === cell; })) return { ok: false, reason: 'hex' };
    if (day.length >= SUGGEST_MAX_DAY) return { ok: false, reason: 'day' };
    return { ok: true };
  }
  // suggestions: [{cell, lat, lng, reason, createdAt}] -> hexes with 3+ suggestions.
  function communitySuggested(suggestions, min) {
    var by = {};
    (suggestions || []).forEach(function (s) {
      var e = by[s.cell] || (by[s.cell] = { cell: s.cell, n: 0, lat: 0, lng: 0, reasons: [], last: 0 });
      e.n++; e.lat += s.lat; e.lng += s.lng;
      if (s.reason) e.reasons.push([s.createdAt || 0, s.reason]);
    });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (e) { return e.n >= (min || SUGGEST_MIN); }).map(function (e) {
      e.reasons.sort(function (a, b) { return b[0] - a[0]; });
      return { cell: e.cell, n: e.n, lat: round(e.lat / e.n, 4), lng: round(e.lng / e.n, 4),
               reasons: e.reasons.slice(0, 3).map(function (r) { return r[1]; }) };
    }).sort(function (a, b) { return b.n - a.n; });
  }

  // ==== planning base layer (researched areas + board votes) ====
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function normalise(v, max) { return max > 0 ? clamp01(v / max) : 0; }
  function blendPlanScore(area, votes) { return clamp01(0.7 * area + 0.3 * votes); }
  function areaBaseScore(a) { return (a.s.candy + a.s.decor + a.s.safety) / 15; }
  // 1 at the centre, 0.6 at the radius, fading to 0 at radius + 500 m.
  function areaFalloff(d, r) {
    if (d <= r) return 1 - 0.4 * d / r;
    return Math.max(0, 0.6 * (1 - (d - r) / 500));
  }
  function planningHexes(areas, voteTotals, grid, max) {
    var cells = {}, k, maxVotes = 0;
    Object.keys(voteTotals || {}).forEach(function (id) { maxVotes = Math.max(maxVotes, voteTotals[id]); });
    areas.forEach(function (a) {
      var base = areaBaseScore(a), vNorm = normalise((voteTotals || {})[a.id] || 0, maxVotes);
      var ring = Math.ceil((a.r + 500) / grid.spacingM);
      grid.disk(grid.cell(a.lat, a.lng), ring).forEach(function (c) {
        var w = areaFalloff(distM(grid.center(c), [a.lat, a.lng]), a.r);
        if (w <= 0) return;
        var e = cells[c] || (cells[c] = { cell: c, a: 0, v: 0 });
        e.a = Math.max(e.a, w * base);
        e.v = Math.max(e.v, w * vNorm);
      });
    });
    var out = [];
    for (k in cells) {
      var e = cells[k];
      e.score = blendPlanScore(e.a, e.v);
      if (e.score > 0.05) out.push(e);
    }
    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, max || 400);
  }
  // Keep only hexes whose centre is inside the (padded) viewport, capped.
  function clipToBounds(hexes, grid, b, max) {
    var out = [];
    for (var i = 0; i < hexes.length && out.length < (max || 400); i++) {
      var c = grid.center(hexes[i].cell);
      if (c[0] >= b.south && c[0] <= b.north && c[1] >= b.west && c[1] <= b.east) out.push(hexes[i]);
    }
    return out;
  }

  // ==== local hex grid (fallback when h3-js fails to load) ====
  // Pointy-top hexagons on a local flat projection around London. 460 m circumradius ≈ H3 resolution 8 edge length.
  var HEX_R = 460, SQ3 = Math.sqrt(3);
  function toXY(lat, lng) { return [(lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT]; }
  function toLL(x, y) { return [LAT0 + y / M_PER_DEG_LAT, LNG0 + x / M_PER_DEG_LNG]; }
  function localCell(lat, lng) {
    var p = toXY(lat, lng);
    var q = (SQ3 / 3 * p[0] - p[1] / 3) / HEX_R, r = (2 / 3 * p[1]) / HEX_R, s = -q - r;
    var rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    var dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return 'L' + (rq + 0) + '_' + (rr + 0);
  }
  function parseLocal(id) { var m = /^L(-?\d+)_(-?\d+)$/.exec(id); return m ? [+m[1], +m[2]] : null; }
  function localCenterXY(q, r) { return [HEX_R * (SQ3 * q + SQ3 / 2 * r), HEX_R * 1.5 * r]; }
  function localCenter(id) { var a = parseLocal(id), c = localCenterXY(a[0], a[1]); return toLL(c[0], c[1]); }
  function localBoundary(id) {
    var a = parseLocal(id), c = localCenterXY(a[0], a[1]), out = [];
    for (var i = 0; i < 6; i++) {
      var ang = (60 * i - 30) * Math.PI / 180;
      out.push(toLL(c[0] + HEX_R * Math.cos(ang), c[1] + HEX_R * Math.sin(ang)));
    }
    return out;
  }
  function localDisk(id, k) {
    var a = parseLocal(id), out = [];
    for (var dq = -k; dq <= k; dq++) {
      for (var dr = Math.max(-k, -dq - k); dr <= Math.min(k, -dq + k); dr++) out.push('L' + (a[0] + dq) + '_' + (a[1] + dr));
    }
    return out;
  }
  // One interface over h3-js (if loaded) or the local grid.
  function makeGrid(h3) {
    if (h3 && typeof h3.latLngToCell === 'function') {
      return {
        kind: 'h3', res: 8, spacingM: 800,
        cell: function (lat, lng) { return h3.latLngToCell(lat, lng, 8); },
        center: function (c) { return h3.cellToLatLng(c); },
        boundary: function (c) { return h3.cellToBoundary(c); },
        disk: function (c, k) { return h3.gridDisk(c, k); }
      };
    }
    return { kind: 'local', res: 8, spacingM: HEX_R * SQ3, cell: localCell, center: localCenter, boundary: localBoundary, disk: localDisk };
  }

  // ==== areas ====
  function invertCrowd(jsonCrowd) { var c = 6 - Number(jsonCrowd); return Math.min(5, Math.max(1, c)); }
  function mapArea(raw) {
    return {
      id: raw.id, lat: raw.lat, lng: raw.lng, r: raw.radius_m || 700,
      name: { en: raw.name_en, zh: raw.name_zh },
      // JSON crowd: 5 = comfortable. App crowd: 5 = very busy.
      s: { candy: raw.scores.candy, decor: raw.scores.decorations, safety: raw.scores.safety, crowd: invertCrowd(raw.scores.crowd) },
      notes: { en: raw.notes_en, zh: raw.notes_zh },
      cautions: { en: raw.cautions || '', zh: raw.cautions_zh || raw.cautions || '' },
      streets: raw.streets || [], sources: raw.sources || []
    };
  }
  function overall(a) { return Math.round((a.s.candy * 0.4 + a.s.decor * 0.3 + a.s.safety * 0.3) * 10) / 10; }

  // ==== text checks (board posts & suggestion reasons) ====
  var RE_URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ca|net|org|io|ly|co|me|app|info|biz|xyz|link|site|gg|tv|to)\b)/i;
  var RE_EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
  // House numbers + street ("123 Askin St", "45号"): the map is about zones, never individual homes.
  var RE_ADDRESS = /\b\d{1,5}[a-z]?\s+[a-z][a-z.'-]*(\s+[a-z][a-z.'-]*)?\s+(st|street|rd|road|ave|avenue|cres|crescent|dr|drive|blvd|boulevard|ct|court|pl|place|way|lane|ln|terr|terrace|cir|circle|gate|grove|pkwy|parkway|row|sq|square|trail|trl)\b\.?|\d{1,5}\s*号/i;
  var RE_PHONE = /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{3}[\s.-]\d{4}\b|\d{7,}/;
  var BAD = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dickhead', 'bastard', 'slut', 'whore', 'retard', 'nigger', 'faggot',
             '傻逼', '操你', '他妈的', '去死'];
  function hasBadWord(s) {
    var low = s.toLowerCase();
    return BAD.some(function (w) {
      if (/[a-z]/.test(w)) return new RegExp('\\b' + w + '(s|es|ing|ed)?\\b').test(low);
      return low.indexOf(w) >= 0;
    });
  }
  // Returns { ok, text } or { ok:false, error } with error in: empty, tooLong, url, email, phone, profanity.
  function checkText(text, opts) {
    opts = opts || {};
    var s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    var max = opts.max || 140;
    if (!s.length) return opts.optional ? { ok: true, text: '' } : { ok: false, error: 'empty' };
    if (Array.from(s).length > max) return { ok: false, error: 'tooLong' };
    if (RE_EMAIL.test(s)) return { ok: false, error: 'email' };
    if (RE_URL.test(s)) return { ok: false, error: 'url' };
    if (RE_PHONE.test(s)) return { ok: false, error: 'phone' };
    if (RE_ADDRESS.test(s)) return { ok: false, error: 'address' };
    if (hasBadWord(s)) return { ok: false, error: 'profanity' };
    return { ok: true, text: s };
  }
  function charCount(s) { return Array.from(String(s || '')).length; }

  // ==== v14: "Best streets from past years / 往年最佳街区" board ====
  // A pin on a street (snapped to a ~50 m grid, never a house), a required preset tag, an optional note ≤ 80 chars,
  // replies ≤ 60, 👍/❤️ once each per phone. Writes Oct 17 – Nov 1 00:00 Toronto; everything deleted Nov 2 00:00.
  var FAV_TAGS = ['festive', 'candy', 'littlekids', 'walking'];
  var FAV_ICON = { festive: '🏆', candy: '🍬', littlekids: '👨‍👩‍👧', walking: '🚶' };
  var FAV_LAT_STEP = 0.00045, FAV_LNG_STEP = 0.0006, FAV_MAX = 80, FAV_REPLY_MAX = 60, FAV_MAX_DAY = 5, FAV_REPLY_MAX_DAY = 20, FAV_HIDE_AT = 3, FAV_FAMILIES_MIN = 3;
  // v15.3: after my report, how many more different people must report before it is hidden (null = count unknown)
  function reportLeft(count) { var n = Number(count); return count == null || !isFinite(n) || n < 1 ? null : Math.max(0, FAV_HIDE_AT - n); }
  function isFavOpen(nowMs, demo) { return isDecorOpen(nowMs, demo); }
  function favVisible(nowMs, demo) { return decorVisible(nowMs, demo); }
  // Same as the server's _ltot_fav_snap: round to the grid, 5 decimals.
  function favSnap(lat, lng) {
    var f = function (v, st) { return Math.round(Math.round(v / st) * st * 1e5) / 1e5; };
    return [f(+lat, FAV_LAT_STEP), f(+lng, FAV_LNG_STEP)];
  }
  var FW = '０１２３４５６７８９＠．／＃：＋', AS = '0123456789@./#:+';
  function fullToAscii(s) { return String(s).replace(/[０-９＠．／＃：＋]/g, function (c) { return AS[FW.indexOf(c)]; }); }
  var FAV_BAD_EN = /\b(dick|cock|pussy|piss|fag|nazi|kys|stfu|wtf)\b|kill\s+(yo)?u?r?self/i;
  var FAV_BAD_ZH = /(煞笔|沙比|傻b|傻B|草泥马|艹你|婊子|贱人|賤人|王八蛋|狗日|滚蛋|尼玛|妈的|媽的|死全家|废物|白痴)/;
  // Mirrors _ltot_fav_text: the shared rules plus house numbers, postal codes and a longer word list (EN + ZH).
  function checkFavText(text, max, optional) {
    var r = checkText(fullToAscii(text == null ? '' : text), { max: max, optional: optional });
    if (!r.ok || !r.text) return r;
    var s = r.text, noYears = s.replace(/(^|[^0-9])(19|20)[0-9]{2}(?![0-9])/g, '$1');
    if (/#\s*[0-9]{2,}/.test(s) || /\b(no|num|number)\.?\s*#?\s*[0-9]{2,}/i.test(s) || /\b(house|home|apt|unit|suite|lot|address|addr)\.?\s*#?\s*[0-9]/i.test(s) ||
        /[0-9]\s*(号|號|栋|棟|单元|單元|室|门牌|門牌)/.test(s) || /(门牌|門牌|地址)/.test(s) || /[a-z][0-9][a-z]\s?[0-9][a-z][0-9]/i.test(s) ||
        /(^|[^0-9])[0-9]{3,5}(?![0-9])/.test(noYears)) return { ok: false, error: 'address' };
    if (FAV_BAD_EN.test(s) || FAV_BAD_ZH.test(s)) return { ok: false, error: 'profanity' };
    return r;
  }
  // Bubbles grow with 👍 + ❤️ (1× … 1.6×).
  function favScale(likes, hearts) { return Math.round((1 + Math.min(0.6, Math.log2(1 + (likes || 0) + (hearts || 0)) * 0.15)) * 100) / 100; }
  // Group pins whose projected points share a cellPx × cellPx square. project(lat, lng) -> {x, y}.
  function clusterFav(pins, project, cellPx) {
    var groups = {}, order = [];
    pins.forEach(function (p) {
      var pt = project(p.lat, p.lng), k = Math.floor(pt.x / cellPx) + ':' + Math.floor(pt.y / cellPx);
      if (!groups[k]) { groups[k] = { pins: [], lat: 0, lng: 0, score: 0 }; order.push(k); }
      groups[k].pins.push(p);
    });
    return order.map(function (k) {
      var g = groups[k], n = g.pins.length;
      g.lat = g.pins.reduce(function (a, p) { return a + p.lat; }, 0) / n;
      g.lng = g.pins.reduce(function (a, p) { return a + p.lng; }, 0) / n;
      g.score = g.pins.reduce(function (a, p) { return a + (p.likes || 0) + (p.hearts || 0); }, 0);
      g.pins.sort(function (a, b) { return ((b.likes + b.hearts) - (a.likes + a.hearts)) || (b.createdAt - a.createdAt); });
      return g;
    });
  }
  // Families who remember a pin: distinct phones (author + 👍/❤️). Aggregate only; null below 3.
  function favFamilies(authorHash, reactorHashes) {
    var set = {}; set[authorHash] = 1; (reactorHashes || []).forEach(function (h) { set[h] = 1; });
    var n = Object.keys(set).length;
    return n >= FAV_FAMILIES_MIN ? n : null;
  }
  // Oct 31 3–11 PM: the bubble also asks "How is it tonight?" (taps lead into the fun-street mark).
  function favTonight(nowMs, cfg) { return isLiveOpen(nowMs, cfg || {}, false) && nowMs >= DECOR_PRIMARY_FROM && nowMs < NIGHT_END_MS; }
  function favRateOk(times, nowMs, max) {
    var day = torontoDay(nowMs);
    return times.filter(function (t) { return torontoDay(t) === day; }).length < max;
  }

  // ==== board ====
  function visiblePosts(posts) { return posts.filter(function (p) { return (p.reports || 0) < 3 && !p.hidden; }); }
  function sortPosts(posts, how) {
    return posts.slice().sort(how === 'new'
      ? function (a, b) { return b.createdAt - a.createdAt; }
      : function (a, b) { return (b.votes - a.votes) || (b.createdAt - a.createdAt); });
  }
  function areaVoteTotals(posts) {
    var out = {};
    visiblePosts(posts).forEach(function (p) { if (p.areaId) out[p.areaId] = (out[p.areaId] || 0) + (p.votes || 0); });
    return out;
  }
  // Allow at most `max` items with timestamps inside the last `windowMs`.
  function rateOk(times, nowMs, windowMs, max) {
    return times.filter(function (t) { return nowMs - t < windowMs; }).length < max;
  }

  // ==== countdown ====
  function countdownParts(ms) {
    ms = Math.max(0, ms);
    return { d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60, s: Math.floor(ms / 1e3) % 60 };
  }
  // Top-bar countdown: to Oct 31 5:00 PM Toronto, then "Halloween is ON!" until Nov 1 midnight (EDT both times), then "see you next year".
  var HALLOWEEN = { start: zonedToUtcMs('2026-10-31', '17:00', TZ), end: zonedToUtcMs('2026-11-01', '00:00', TZ) };
  function countdownPhase(nowMs) { return nowMs < HALLOWEEN.start ? 'before' : nowMs < HALLOWEEN.end ? 'on' : 'after'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  // -> [['14','d'], ['01','h'], ['05','m'], ['32','s']]; units = i18n cdUnits. Always 4 units, so the width never changes.
  function countdownUnits(ms, units) {
    var p = countdownParts(ms);
    return [[pad2(p.d), units[0]], [pad2(p.h), units[1]], [pad2(p.m), units[2]], [pad2(p.s), units[3]]];
  }
  function formatCountdown(ms, units) { return countdownUnits(ms, units).map(function (u) { return u[0] + u[1]; }).join(' '); }
  function msToNextSecond(nowMs) { return 1000 - (((nowMs % 1000) + 1000) % 1000); }
  // ?now=2026-10-31T17:30:00-04:00 (screenshots only). Raw search string: parseUrlFlags lower-cases values. "+" may arrive as a space.
  function parseNowParam(search) {
    var m = /[?&]now=([^&]*)/.exec(String(search || ''));
    if (!m) return null;
    var v;
    try { v = decodeURIComponent(m[1]).replace(/ /g, '+'); } catch (e) { return null; }
    var ms = Date.parse(v);
    return isFinite(ms) ? ms : null;
  }

  // ==== route helpers ====
  var STAMINA = { 'u5': [30, 45], '5-8': [60, 90] };   // under 5: one warning for any route longer than 45 min
  // -> { key, warn }: i18n key of the hint and whether the chosen walk is longer than little legs usually manage.
  function staminaHint(age, minutes) {
    if (age === 'u5') return { key: minutes > STAMINA.u5[1] ? 'staminaU5Warn' : 'staminaU5', warn: minutes > STAMINA.u5[1] };
    if (age === '5-8') return { key: 'stamina58', warn: false };
    return { key: 'staminaOlder', warn: false };
  }
  function startTimeHintKey(age) { return age === 'u5' || age === '5-8' ? 'startEarly' : 'startLate'; }
  // About 1 house per 15 m of street, 60 % with lights on: ≈ 40 per km.
  function estimateHouses(km) { return Math.round(Math.max(0, km) * 1000 / 15 * 0.6); }
  function bearingDeg(a, b) {
    var r = Math.PI / 180;
    var y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    var x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  // A loop of 5 checkpoints around the area centre. It starts and ends at the same point: home/my location,
  // or the area centre when the area is too far to walk to (drive & park there). waypoints[0] === waypoints[last].
  function loopWaypoints(start, area, targetKm, maxWalkKm) {
    var center = [area.lat, area.lng], dStart = distM(start, center) / 1000;
    var drive = dStart > maxWalkKm, origin = drive ? center : start;
    var loopKm = drive ? targetKm : Math.max(targetKm - 2 * dStart, 0.6);
    var rKm = Math.min(Math.max(loopKm / (2 * Math.PI * 1.3), 0.12), area.r / 1000);
    var n = 5, startAngle = drive ? 0 : bearingDeg(center, start), pts = [];
    for (var i = 0; i < n; i++) {
      var ang = (startAngle + i * 360 / n) * Math.PI / 180;
      pts.push([center[0] + (rKm / 111.32) * Math.cos(ang), center[1] + (rKm / (111.32 * Math.cos(center[0] * Math.PI / 180))) * Math.sin(ang)]);
    }
    return { origin: origin, drive: drive, dStart: dStart, waypoints: [origin].concat(pts, [origin]) };
  }

  // ==== feedback (mailto, no backend) ====
  var FEEDBACK_TO = 'sisy+halloween@mail.grokbot.com', FEEDBACK_SUBJECT = 'Halloween map feedback';
  var FEEDBACK_MAX = 500, MAILTO_MAX = 1800;
  var FB_LABELS = [['confusing', 'What was confusing? / 哪里让你困惑？'], ['liked', 'What did you like? / 你喜欢什么？'],
                   ['missing', "What's missing? / 还缺什么功能？"]];
  function cut(s, n) { var a = Array.from(String(s || '').trim()); return a.length > n ? a.slice(0, Math.max(0, n - 1)).join('') + '…' : a.join(''); }
  // o: { confusing, liked, missing, name, version, lang, screen, ua, time } -> { to, subject, body, href, text }.
  // Answers are cut to 500 characters, then the longest is shortened until the whole mailto: link is ≤ 1800 characters.
  function buildFeedbackMail(o) {
    o = o || {};
    var ans = {};
    FB_LABELS.forEach(function (l) { ans[l[0]] = cut(o[l[0]], FEEDBACK_MAX); });
    var ua = cut(o.ua, 200);
    function body() {
      return FB_LABELS.map(function (l) { return l[1] + '\n' + (ans[l[0]] || '-'); }).join('\n\n') +
        '\n\nName / 名字: ' + (cut(o.name, 40) || '-') +
        '\n---\nApp: ' + (o.version || '') + ' · lang: ' + (o.lang || '') + ' · screen: ' + (o.screen || '') +
        '\nTime: ' + (o.time || '') + '\nUA: ' + ua;
    }
    function href() { return 'mailto:' + FEEDBACK_TO + '?subject=' + encodeURIComponent(FEEDBACK_SUBJECT) + '&body=' + encodeURIComponent(body()); }
    for (var guard = 0; href().length > MAILTO_MAX && guard < 200; guard++) {
      var longest = FB_LABELS.map(function (l) { return l[0]; }).sort(function (a, b) { return Array.from(ans[b]).length - Array.from(ans[a]).length; })[0];
      var n = Array.from(ans[longest]).length;
      if (n > 1) ans[longest] = cut(ans[longest], Math.floor(n * 0.85));
      else if (ua.length > 1) ua = cut(ua, Math.floor(ua.length * 0.7));
      else break;
    }
    var b = body();
    return { to: FEEDBACK_TO, subject: FEEDBACK_SUBJECT, body: b, href: href(),
             text: 'To: ' + FEEDBACK_TO + '\nSubject: ' + FEEDBACK_SUBJECT + '\n\n' + b };
  }

  // ==== URL flags + first-visit guide ====
  // ?guide=1 forces the welcome cards, ?howto=1 opens the How-to panel, ?lang=zh|en picks the language for this load,
  // ?demo=1 runs the demo, ?near=1 opens the "Near me" panel, ?feedback=1 opens Feedback, ?tour=1[&tourStep=N] plays the tour
  // (N = 1-based step, paused there). ?now= is read separately by parseNowParam.
  var GUIDE_KEY = 'ltot.guideSeen.v2';
  function parseUrlFlags(search) {
    var q = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      try { k = decodeURIComponent(k); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
      q[k.toLowerCase()] = v.trim().toLowerCase();
    });
    function on(v) { return v === '1' || v === 'true' || v === 'yes'; }
    var l = (q.lang || '').split(/[-_]/)[0];
    var step = parseInt(q.tourstep, 10);
    return { guide: on(q.guide), howto: on(q.howto), lang: l === 'zh' || l === 'en' ? l : null, demo: on(q.demo), near: on(q.near), nudge: on(q.nudge), decor: on(q.decor), fav: on(q.fav),
             feedback: on(q.feedback), tour: on(q.tour), tourStep: step >= 1 ? step : null };
  }
  function guideSeen(storage) { try { return !!(storage && storage.getItem(GUIDE_KEY)); } catch (e) { return false; } }
  function markGuideSeen(storage, how) {
    try { storage.setItem(GUIDE_KEY, how === 'skipped' ? 'skipped' : 'done'); return true; } catch (e) { return false; }
  }
  // First visit shows the cards; ?guide=1 always does; ?howto=1 or ?near=1 alone open their panel instead.
  // First visit: ask English / 中文 before anything else, unless a language is saved, ?lang= is given, or ?demo=1.
  // The fallback language is ALWAYS English, never the browser's language.
  function shouldShowLangChooser(flags, savedLang) {
    return !(savedLang === 'en' || savedLang === 'zh') && !(flags && (flags.lang || flags.demo));
  }
  function initialLang(flags, savedLang) {
    if (flags && flags.lang) return flags.lang;
    return savedLang === 'zh' ? 'zh' : 'en';
  }
  function shouldShowGuide(flags, seen) {
    return !!(flags && flags.guide) || (!seen && !(flags && (flags.howto || flags.near || flags.feedback || flags.tour)));
  }

  // ==== SHA-256 (edit-token hashes; crypto.subtle is missing on some file:// pages) ====
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex(str) {
    var bytes = Array.from(new TextEncoder().encode(String(str)));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < bytes.length; o += 64) {
      for (i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  return {
    TZ: TZ, LONDON_BOX: LONDON_BOX, BOARDS: BOARDS, SEASON_END_MS: SEASON_END_MS, SESSION_MS: SESSION_MS,
    MARK_TAGS: MARK_TAGS, TAG_ICON: TAG_ICON, MIN_ZONE: MIN_ZONE, NEW_MS: NEW_MS, MARK_KEEP_MS: MARK_KEEP_MS,
    RATE_DEVICE_MS: RATE_DEVICE_MS, RATE_ZONE_MS: RATE_ZONE_MS, SUGGEST_MAX_DAY: SUGGEST_MAX_DAY, SUGGEST_MIN: SUGGEST_MIN,
    tzOffsetMin: tzOffsetMin, zonedToUtcMs: zonedToUtcMs, liveWindow: liveWindow, testWindow: testWindow, isTestOpen: isTestOpen, isLiveOpen: isLiveOpen, markMode: markMode,
    distM: distM, inLondonBox: inLondonBox, round: round, coarsen: coarsen, blurPoint: blurPoint,
    randomHex: randomHex, uuid: uuid, nextSession: nextSession,
    clampWindow: clampWindow, zoneBucket: zoneBucket, cleanTags: cleanTags, tagsValid: tagsValid, marksInWindow: marksInWindow,
    topTag: topTag, aggregateZones: aggregateZones, decorateZones: decorateZones, isZoneNew: isZoneNew,
    markRate: markRate, pruneHistory: pruneHistory, nearZones: nearZones,
    checkReason: checkReason, suggestRate: suggestRate, communitySuggested: communitySuggested,
    normalise: normalise, blendPlanScore: blendPlanScore, areaBaseScore: areaBaseScore, areaFalloff: areaFalloff,
    planningHexes: planningHexes, clipToBounds: clipToBounds, makeGrid: makeGrid, localCell: localCell,
    localCenter: localCenter, localBoundary: localBoundary, localDisk: localDisk,
    invertCrowd: invertCrowd, mapArea: mapArea, overall: overall, checkText: checkText, charCount: charCount,
    visiblePosts: visiblePosts, sortPosts: sortPosts, areaVoteTotals: areaVoteTotals, rateOk: rateOk,
    countdownParts: countdownParts, sha256Hex: sha256Hex, APP_VERSION: APP_VERSION,
    HALLOWEEN: HALLOWEEN, countdownPhase: countdownPhase, countdownUnits: countdownUnits, formatCountdown: formatCountdown,
    msToNextSecond: msToNextSecond, parseNowParam: parseNowParam,
    eventEndMs: eventEndMs, eventActive: eventActive, activeEvents: activeEvents,
    staminaHint: staminaHint, startTimeHintKey: startTimeHintKey, estimateHouses: estimateHouses, bearingDeg: bearingDeg, loopWaypoints: loopWaypoints,
    FEEDBACK_TO: FEEDBACK_TO, FEEDBACK_SUBJECT: FEEDBACK_SUBJECT, MAILTO_MAX: MAILTO_MAX, buildFeedbackMail: buildFeedbackMail,
    GUIDE_KEY: GUIDE_KEY, parseUrlFlags: parseUrlFlags, guideSeen: guideSeen, markGuideSeen: markGuideSeen, shouldShowGuide: shouldShowGuide, shouldShowLangChooser: shouldShowLangChooser, markProgress: markProgress, BADGES: BADGES, badgeFor: badgeFor, newBadge: newBadge, shouldNudge: shouldNudge, NUDGE_MS: NUDGE_MS,
    DECOR_TAGS: DECOR_TAGS, DECOR_ICON: DECOR_ICON, DECOR_OPEN: DECOR_OPEN, DECOR_PURGE_MS: DECOR_PURGE_MS, DECOR_KEEP_MS: DECOR_KEEP_MS,
    DECOR_MAX_DAY: DECOR_MAX_DAY, DECOR_PRIMARY_FROM: DECOR_PRIMARY_FROM, isDecorOpen: isDecorOpen, appPhase: appPhase, NIGHT_END_MS: NIGHT_END_MS, BUCKET_ICON: BUCKET_ICON, decorVisible: decorVisible, decorPrimary: decorPrimary,
    torontoDay: torontoDay, cleanDecorTags: cleanDecorTags, decorTagsValid: decorTagsValid, decorRate: decorRate, decorTopTag: decorTopTag,
    aggregateDecor: aggregateDecor, decorateDecor: decorateDecor, initialLang: initialLang,
    FAV_TAGS: FAV_TAGS, FAV_ICON: FAV_ICON, FAV_LAT_STEP: FAV_LAT_STEP, FAV_LNG_STEP: FAV_LNG_STEP, FAV_MAX: FAV_MAX, FAV_REPLY_MAX: FAV_REPLY_MAX,
    FAV_MAX_DAY: FAV_MAX_DAY, FAV_REPLY_MAX_DAY: FAV_REPLY_MAX_DAY, FAV_HIDE_AT: FAV_HIDE_AT, reportLeft: reportLeft, FAV_FAMILIES_MIN: FAV_FAMILIES_MIN,
    isFavOpen: isFavOpen, favVisible: favVisible, favSnap: favSnap, checkFavText: checkFavText, favScale: favScale, clusterFav: clusterFav,
    favFamilies: favFamilies, favTonight: favTonight, favRateOk: favRateOk
  };
});
