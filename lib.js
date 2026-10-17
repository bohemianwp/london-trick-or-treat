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
  var MARKER_TYPES = ['candy', 'teal', 'fullsize', 'decor', 'pet', 'early'];
  var STATUSES = ['giving', 'later', 'out'];
  var BOARDS = ['fun', 'decor'];
  var DEFAULT_WINDOW = { date: '2026-10-31', start: '15:00', end: '23:00', tz: TZ };

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
  function liveWindow(cfg) {
    var w = (cfg && cfg.liveWindow) || DEFAULT_WINDOW;
    return { start: zonedToUtcMs(w.date, w.start, w.tz), end: zonedToUtcMs(w.date, w.end, w.tz) };
  }
  // Live features are open only inside the window (inclusive start, exclusive end), or always in demo mode.
  function isLiveOpen(nowMs, cfg, demo) {
    if (demo) return true;
    var w = liveWindow(cfg);
    return nowMs >= w.start && nowMs < w.end;
  }
  // Nov 1, 2026 06:00 in Toronto. DST ends at 2 AM that morning, so this is 06:00 EST (UTC-5) = 11:00 UTC.
  var MARKER_EXPIRES_MS = zonedToUtcMs('2026-11-01', '06:00', TZ);
  function isMarkerExpired(m, nowMs) {
    var exp = m && m.expiresAt ? Number(m.expiresAt) : MARKER_EXPIRES_MS;
    return nowMs >= exp;
  }

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

  // Coarsen a live position before it leaves the phone: snap to a ~50 m grid, then add up to 25 m of random jitter.
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

  // ==== ids, sessions, dots ====
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
  // Random live-dot session id, not tied to the device; a new one every 30 minutes.
  function nextSession(prev, nowMs, rnd) {
    if (prev && prev.id && nowMs - prev.startedAt < SESSION_MS && nowMs >= prev.startedAt) return prev;
    return { id: randomHex(32, rnd), startedAt: nowMs };
  }
  function shouldSendDot(lastSentAt, nowMs, visible, minMs) {
    if (!visible) return false;
    return !lastSentAt || nowMs - lastSentAt >= (minMs || 60000);
  }
  var SHARE_MAX_MS = 90 * 60000;
  function sharingLeftMs(startedAt, nowMs) { return Math.max(0, startedAt + SHARE_MAX_MS - nowMs); }
  function sharingExpired(startedAt, nowMs) { return nowMs - startedAt >= SHARE_MAX_MS; }
  function isDotFresh(dot, nowMs, ttlMin) { return nowMs - dot.updatedAt < (ttlMin || 30) * 60000; }
  function pruneDots(dots, nowMs, ttlMin) { return dots.filter(function (d) { return isDotFresh(d, nowMs, ttlMin); }); }

  // ==== hex aggregation & scores ====
  function countDotsByCell(dots, cellFn, nowMs, windowMin) {
    var out = {}, cut = nowMs - (windowMin || 20) * 60000;
    dots.forEach(function (d) {
      if (d.updatedAt < cut) return;
      var c = d.h3 || cellFn(d.lat, d.lng);
      if (c) out[c] = (out[c] || 0) + 1;
    });
    return out;
  }
  // Privacy floor: cells with fewer than `min` dots are dropped entirely ("no data").
  function suppressSmall(counts, min) {
    min = min || 3;
    return Object.keys(counts).filter(function (k) { return counts[k] >= min; })
      .map(function (k) { return { cell: k, count: counts[k] }; });
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function normalise(v, max) { return max > 0 ? clamp01(v / max) : 0; }
  function blendHexScore(area, votes, pins) { return clamp01(0.5 * area + 0.3 * votes + 0.2 * pins); }
  function areaBaseScore(a) { return (a.s.candy + a.s.decor + a.s.safety) / 15; }
  // 1 at the centre, 0.6 at the radius, fading to 0 at radius + 500 m.
  function areaFalloff(d, r) {
    if (d <= r) return 1 - 0.4 * d / r;
    return Math.max(0, 0.6 * (1 - (d - r) / 500));
  }
  function planBucket(s) { return s < 0.45 ? 'quiet' : s < 0.7 ? 'busy' : 'very'; }
  function liveBucket(n) { return n < 6 ? 'quiet' : n < 12 ? 'busy' : 'very'; }

  // Planning-mode score for every hex near an area or containing a marker.
  function planningHexes(areas, markers, voteTotals, grid, nowMs, max) {
    var cells = {}, k;
    var maxVotes = 0;
    Object.keys(voteTotals || {}).forEach(function (id) { maxVotes = Math.max(maxVotes, voteTotals[id]); });
    areas.forEach(function (a) {
      var base = areaBaseScore(a), vNorm = normalise((voteTotals || {})[a.id] || 0, maxVotes);
      var ring = Math.ceil((a.r + 500) / grid.spacingM);
      grid.disk(grid.cell(a.lat, a.lng), ring).forEach(function (c) {
        var w = areaFalloff(distM(grid.center(c), [a.lat, a.lng]), a.r);
        if (w <= 0) return;
        var e = cells[c] || (cells[c] = { cell: c, a: 0, v: 0, p: 0, n: 0 });
        e.a = Math.max(e.a, w * base);
        e.v = Math.max(e.v, w * vNorm);
      });
    });
    var maxPins = 0;
    (markers || []).forEach(function (m) {
      if (isMarkerExpired(m, nowMs)) return;
      if (!(m.status === 'giving' || (m.types || []).indexOf('decor') >= 0)) return;
      var c = grid.cell(m.lat, m.lng);
      var e = cells[c] || (cells[c] = { cell: c, a: 0, v: 0, p: 0, n: 0 });
      e.n++;
      if (e.n > maxPins) maxPins = e.n;
    });
    var out = [];
    for (k in cells) {
      var e = cells[k];
      e.p = normalise(e.n, maxPins);
      e.score = blendHexScore(e.a, e.v, e.p);
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

  // ==== text checks (board posts & marker notes) ====
  var RE_URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ca|net|org|io|ly|co|me|app|info|biz|xyz|link|site|gg|tv|to)\b)/i;
  var RE_EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
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
    if (hasBadWord(s)) return { ok: false, error: 'profanity' };
    return { ok: true, text: s };
  }
  function charCount(s) { return Array.from(String(s || '')).length; }

  // ==== house markers ====
  var RE_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  function sanitizeMarker(m) {
    if (!m || typeof m !== 'object') return null;
    var lat = Number(m.lat), lng = Number(m.lng);
    if (!inLondonBox(lat, lng)) return null;
    var types = (Array.isArray(m.types) ? m.types : []).filter(function (t, i, a) {
      return MARKER_TYPES.indexOf(t) >= 0 && a.indexOf(t) === i;
    });
    if (!types.length) return null;
    var note = checkText(m.note, { optional: true });
    if (!note.ok) return null;
    return {
      id: m.id ? String(m.id).slice(0, 40) : null,
      lat: round(lat, 5), lng: round(lng, 5), types: types,
      status: STATUSES.indexOf(m.status) >= 0 ? m.status : 'giving',
      note: note.text,
      start: RE_HHMM.test(m.start || '') ? m.start : '',
      end: RE_HHMM.test(m.end || '') ? m.end : '',
      expiresAt: Number(m.expiresAt) || MARKER_EXPIRES_MS,
      localOnly: !!m.localOnly
    };
  }
  // v1 pins (candy / fullsize / decor / avoid + rating) -> v2 markers. "avoid" becomes a greyed "out" marker with a ⚠️ note.
  function migrateV1Pins(pins) {
    if (!Array.isArray(pins)) return [];
    return pins.map(function (p) {
      if (!p) return null;
      var map = { candy: ['candy'], fullsize: ['fullsize'], decor: ['decor'], avoid: ['candy'] };
      var types = map[p.type] || ['candy'];
      var note = String(p.note || '').slice(0, 130);
      if (p.type === 'avoid') note = ('⚠️ ' + note).trim();
      var ok = checkText(note, { optional: true });
      return sanitizeMarker({
        id: 'v1-' + String(p.id || Math.random().toString(36).slice(2, 9)).slice(0, 24),
        lat: p.lat, lng: p.lng, types: types, status: p.type === 'avoid' ? 'out' : 'giving',
        note: ok.ok ? ok.text : '', localOnly: true
      });
    }).filter(Boolean);
  }
  // filters: { teal, fullsize, early, hideOut } — all active filters must match.
  function filterMarkers(markers, f, nowMs) {
    f = f || {};
    return markers.filter(function (m) {
      if (isMarkerExpired(m, nowMs)) return false;
      if (f.hideOut && m.status === 'out') return false;
      if (f.teal && m.types.indexOf('teal') < 0) return false;
      if (f.fullsize && m.types.indexOf('fullsize') < 0) return false;
      if (f.early && m.types.indexOf('early') < 0) return false;
      return true;
    });
  }
  // Compact share links: #m=<base64url of [[lat,lng,typeBits,statusIdx,note,start,end],...]>
  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeMarkers(list) {
    return b64urlEncode(JSON.stringify(list.map(function (m) {
      var bits = 0;
      m.types.forEach(function (t) { bits |= 1 << MARKER_TYPES.indexOf(t); });
      return [m.lat, m.lng, bits, STATUSES.indexOf(m.status), m.note || '', m.start || '', m.end || ''];
    })));
  }
  function decodeMarkers(s) {
    try {
      var arr = JSON.parse(b64urlDecode(s));
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, 300).map(function (a, i) {
        if (!Array.isArray(a)) return null;
        var types = MARKER_TYPES.filter(function (t, k) { return (a[2] >> k) & 1; });
        return sanitizeMarker({ id: 'link-' + i, lat: a[0], lng: a[1], types: types, status: STATUSES[a[3]],
                                note: a[4], start: a[5], end: a[6], localOnly: true });
      }).filter(Boolean);
    } catch (e) { return []; }
  }
  // v1 links used #pins=...; decode them through the v1 migration.
  function decodeV1Pins(s) {
    try {
      var arr = JSON.parse(b64urlDecode(s)), types = ['candy', 'fullsize', 'decor', 'avoid'];
      if (!Array.isArray(arr)) return [];
      return migrateV1Pins(arr.slice(0, 300).map(function (a, i) {
        return Array.isArray(a) ? { id: 'link' + i, lat: a[0], lng: a[1], type: types[a[2]], note: a[4] } : null;
      }));
    } catch (e) { return []; }
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
    TZ: TZ, LONDON_BOX: LONDON_BOX, MARKER_TYPES: MARKER_TYPES, STATUSES: STATUSES, BOARDS: BOARDS,
    MARKER_EXPIRES_MS: MARKER_EXPIRES_MS, SESSION_MS: SESSION_MS, SHARE_MAX_MS: SHARE_MAX_MS,
    tzOffsetMin: tzOffsetMin, zonedToUtcMs: zonedToUtcMs, liveWindow: liveWindow, isLiveOpen: isLiveOpen,
    isMarkerExpired: isMarkerExpired, distM: distM, inLondonBox: inLondonBox, round: round, coarsen: coarsen,
    randomHex: randomHex, uuid: uuid, nextSession: nextSession, shouldSendDot: shouldSendDot,
    sharingLeftMs: sharingLeftMs, sharingExpired: sharingExpired, isDotFresh: isDotFresh, pruneDots: pruneDots,
    countDotsByCell: countDotsByCell, suppressSmall: suppressSmall, normalise: normalise, blendHexScore: blendHexScore,
    areaBaseScore: areaBaseScore, areaFalloff: areaFalloff, planBucket: planBucket, liveBucket: liveBucket,
    planningHexes: planningHexes, clipToBounds: clipToBounds, makeGrid: makeGrid, localCell: localCell,
    localCenter: localCenter, localBoundary: localBoundary, localDisk: localDisk,
    invertCrowd: invertCrowd, mapArea: mapArea, overall: overall,
    checkText: checkText, charCount: charCount, sanitizeMarker: sanitizeMarker, migrateV1Pins: migrateV1Pins,
    filterMarkers: filterMarkers, encodeMarkers: encodeMarkers, decodeMarkers: decodeMarkers, decodeV1Pins: decodeV1Pins,
    visiblePosts: visiblePosts, sortPosts: sortPosts, areaVoteTotals: areaVoteTotals, rateOk: rateOk,
    countdownParts: countdownParts, sha256Hex: sha256Hex
  };
});
