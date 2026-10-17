/* Data-access layer: one interface, two adapters.
   LocalAdapter    — localStorage + BroadcastChannel (default, and the automatic fallback).
   SupabaseAdapter — supabase-js v2 from a CDN, loaded only when config.backend === 'supabase' and it is configured.
   Interface: listPosts, createPost, vote, report, deletePost (board),
              sendMark, tagMark, liveZoneCounts, listZones (marks → zones), suggestArea, communitySuggested.
   Every method returns a Promise.
   Privacy: sendMark() blurs the position (~50 m grid + jitter) BEFORE either adapter sees it, so the raw position
   is never stored or sent. Zones come back only when they have 3+ marks.
   Errors carry err.code: invalid | forbidden | rate | closed | outside | text:<empty|tooLong|url|email|phone|profanity> */
(function (root, factory) {
  var B = factory(root, root.TOT_LIB || (typeof require === 'function' ? require('./lib.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = B;
  else root.TOT_BACKEND = B;
})(typeof self !== 'undefined' ? self : this, function (root, LIB) {
  'use strict';

  var SB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
  var SB_SRI = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
  var METHODS = ['listPosts', 'createPost', 'vote', 'report', 'deletePost',
                 'sendMark', 'tagMark', 'liveZoneCounts', 'suggestArea', 'communitySuggested', 'sendDecor', 'decorCounts'];
  var DECOR_METHODS = { sendDecor: 1, decorCounts: 1 };   // v11: if the server has no decor RPCs yet, these stay on this phone
  var LIVE_METHODS = { sendMark: 1, tagMark: 1, liveZoneCounts: 1 };   // outside the live window these stay local (practice)
  var HOUR = 3600000;

  function fail(code) { var e = new Error(code); e.code = code; e.validation = true; return Promise.reject(e); }
  function ok(v) { return Promise.resolve(v); }

  // ==== LocalAdapter ====
  function LocalAdapter(opts) {
    opts = opts || {};
    var self = this;
    this.store = opts.storage || root.localStorage;
    this.prefix = opts.prefix || 'ltot.v2.';
    this.cfg = opts.cfg || {};
    this.demo = !!opts.demo;
    this.now = opts.now || function () { return Date.now(); };
    this.listeners = [];
    this.chan = opts.channel !== undefined ? opts.channel
      : (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ltot:' + this.prefix) : null);
    if (this.chan) this.chan.onmessage = function (e) { self._emit(e.data && e.data.kind, true); };
    else if (root.addEventListener) {
      root.addEventListener('storage', function (e) {
        if (e.key && e.key.indexOf(self.prefix) === 0) self._emit(e.key.slice(self.prefix.length), true);
      });
    }
  }
  LocalAdapter.prototype = {
    _get: function (k, fb) {
      try { var v = this.store.getItem(this.prefix + k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
    },
    _set: function (k, v) {
      try { this.store.setItem(this.prefix + k, JSON.stringify(v)); } catch (e) { /* full or private mode */ }
      this._emit(k, false);
    },
    _emit: function (kind, remote) {
      if (!remote && this.chan) try { this.chan.postMessage({ kind: kind }); } catch (e) { /* closed */ }
      this.listeners.forEach(function (f) { f(kind, remote); });
    },
    onChange: function (fn) { this.listeners.push(fn); },

    // ---------------- board
    listPosts: function (board) {
      var posts = LIB.visiblePosts(this._get('posts', []));
      if (board) posts = posts.filter(function (p) { return p.board === board; });
      return ok(posts.map(function (p) {
        return { id: p.id, board: p.board, areaId: p.areaId, lat: p.lat, lng: p.lng, body: p.body, votes: p.votes, createdAt: p.createdAt };
      }));
    },
    createPost: function (p, voter, token) {
      if (!p || LIB.BOARDS.indexOf(p.board) < 0 || !voter || !token) return fail('invalid');
      var tc = LIB.checkText(p.body);
      if (!tc.ok) return fail('text:' + tc.error);
      var lat = null, lng = null;
      if (p.lat != null && p.lng != null) {
        if (!LIB.inLondonBox(+p.lat, +p.lng)) return fail('outside');
        lat = LIB.round(+p.lat, 3); lng = LIB.round(+p.lng, 3);   // ~100 m: rough location only
      }
      var now = this.now(), who = LIB.sha256Hex('voter:' + voter);
      var times = this._get('postTimes', {});
      if (!LIB.rateOk(times[who] || [], now, HOUR, 5)) return fail('rate');
      times[who] = (times[who] || []).filter(function (t) { return now - t < HOUR; }).concat(now);
      var posts = this._get('posts', []);
      var rec = { id: LIB.uuid(), board: p.board, areaId: /^[a-z0-9-]{1,40}$/.test(p.areaId || '') ? p.areaId : null,
                  lat: lat, lng: lng, body: tc.text, votes: 0, reports: 0, createdAt: now, tokenHash: LIB.sha256Hex(token) };
      posts.push(rec);
      this._set('postTimes', times);
      this._set('posts', posts);
      return ok({ id: rec.id });
    },
    _tally: function (key, field, postId, voter) {
      var posts = this._get('posts', []), p = posts.find(function (x) { return x.id === postId; });
      if (!p) return fail('invalid');
      var all = this._get(key, {}), who = LIB.sha256Hex('voter:' + voter);
      var list = all[postId] || [];
      if (list.indexOf(who) >= 0) return ok({ ok: false, already: true, count: p[field] });
      all[postId] = list.concat(who);
      p[field] = (p[field] || 0) + 1;
      this._set(key, all);
      this._set('posts', posts);
      return ok({ ok: true, count: p[field] });
    },
    vote: function (postId, voter) { return voter ? this._tally('votes', 'votes', postId, voter) : fail('invalid'); },
    report: function (postId, voter) { return voter ? this._tally('reports', 'reports', postId, voter) : fail('invalid'); },
    deletePost: function (id, token) {
      var posts = this._get('posts', []), hash = LIB.sha256Hex(token || '');
      var keep = posts.filter(function (p) { return !(p.id === id && p.tokenHash === hash); });
      if (keep.length === posts.length) return fail('forbidden');
      this._set('posts', keep);
      return ok(true);
    },

    // ---------------- marks (already blurred by createBackend().sendMark)
    // m: { session, lat, lng, cell, tags }, token: random secret kept on this phone (lets it add tags later).
    sendMark: function (m, token) {
      var now = this.now();
      if (!m || !/^[a-f0-9]{16,64}$/.test(m.session || '') || !token || token.length < 16 || !m.cell) return fail('invalid');
      if (!LIB.inLondonBox(+m.lat, +m.lng)) return fail('outside');
      if (!LIB.tagsValid(m.tags)) return fail('invalid');
      var sid = LIB.sha256Hex(m.session), marks = this._prune();
      var mine = marks.filter(function (x) { return x.sidHash === sid; });
      if (mine.some(function (x) { return now - x.createdAt < LIB.RATE_DEVICE_MS; })) return fail('rate');
      if (mine.some(function (x) { return x.cell === m.cell && now - x.createdAt < LIB.RATE_ZONE_MS; })) return fail('rate');
      var rec = { id: LIB.uuid(), sidHash: sid, lat: LIB.round(+m.lat, 4), lng: LIB.round(+m.lng, 4), cell: String(m.cell).slice(0, 20),
                  tags: LIB.cleanTags(m.tags), createdAt: now, tokenHash: LIB.sha256Hex(token) };
      marks.push(rec);
      this._set('marks', marks);
      return ok({ id: rec.id });
    },
    tagMark: function (id, token, tag) {
      if (LIB.MARK_TAGS.indexOf(tag) < 0) return fail('invalid');
      var marks = this._get('marks', []), m = marks.find(function (x) { return x.id === id; });
      if (!m || m.tokenHash !== LIB.sha256Hex(token || '')) return fail('forbidden');
      if (this.now() - m.createdAt > 15 * 60000) return fail('closed');
      if (m.tags.indexOf(tag) < 0) m.tags.push(tag);
      this._set('marks', marks);
      return ok(m.tags.slice());
    },
    // Marks older than 2 hours are deleted on every read/write.
    _prune: function () {
      var now = this.now(), all = this._get('marks', []);
      var keep = all.filter(function (x) { return now - x.createdAt < LIB.MARK_KEEP_MS; });
      if (keep.length !== all.length) this._set('marks', keep);
      return keep;
    },
    // Same contract as the zone_counts RPC: only cells with 3+ marks, never ids, sessions or positions.
    liveZoneCounts: function (windowMin, cellFn) {
      var zones = LIB.aggregateZones(this._prune(), cellFn, this.now(), windowMin || this.cfg.markWindowMin, 300);
      return ok(zones.map(function (z) { return { cell: z.cell, count: z.count, tags: z.tags, topTag: z.topTag, firstLitAt: z.firstLitAt }; }));
    },
    markCount: function () { return this._prune().length; },

    // ---------------- community suggestions
    // s: { device, cell, lat, lng (hex centre), reason }
    suggestArea: function (s) {
      var now = this.now();
      if (!s || !s.device || String(s.device).length < 8 || !s.cell) return fail('invalid');
      if (!LIB.inLondonBox(+s.lat, +s.lng)) return fail('outside');
      if (now >= LIB.SEASON_END_MS) return fail('closed');
      var tc = LIB.checkReason(s.reason);
      if (!tc.ok) return fail('text:' + tc.error);
      var dev = LIB.sha256Hex('device:' + s.device), all = this._get('suggestions', []);
      var hist = all.filter(function (x) { return x.deviceHash === dev; }).map(function (x) { return { t: x.createdAt, cell: x.cell }; });
      if (!LIB.suggestRate(hist, s.cell, now).ok) return fail('rate');
      var rec = { id: LIB.uuid(), deviceHash: dev, cell: String(s.cell).slice(0, 20), lat: LIB.round(+s.lat, 4), lng: LIB.round(+s.lng, 4),
                  reason: tc.text || null, createdAt: now };
      all.push(rec);
      this._set('suggestions', all);
      return ok({ id: rec.id });
    },
    communitySuggested: function () { return ok(LIB.communitySuggested(this._get('suggestions', []))); },

    // ---------------- v11 decor marks (already blurred by createBackend().sendDecor)
    // d: { device, lat, lng, cell, tags }. Only a per-day device hash is kept (cannot be linked across days).
    sendDecor: function (d) {
      var now = this.now();
      if (!d || !d.device || String(d.device).length < 8 || !d.cell) return fail('invalid');
      if (!LIB.inLondonBox(+d.lat, +d.lng)) return fail('outside');
      if (!LIB.decorTagsValid(d.tags)) return fail('invalid');
      if (!LIB.isDecorOpen(now, this.demo)) return fail('closed');
      var day = LIB.torontoDay(now), dh = LIB.sha256Hex('decor:' + d.device + ':' + day), all = this._pruneDecor();
      var hist = all.filter(function (x) { return x.dayHash === dh; }).map(function (x) { return { t: x.createdAt, cell: x.cell }; });
      if (!LIB.decorRate(hist, d.cell, now).ok) return fail('rate');
      var rec = { id: LIB.uuid(), dayHash: dh, lat: LIB.round(+d.lat, 4), lng: LIB.round(+d.lng, 4), cell: String(d.cell).slice(0, 20),
                  tags: LIB.cleanDecorTags(d.tags), createdAt: now };
      all.push(rec);
      this._set('decor', all);
      return ok({ id: rec.id });
    },
    // 14-day retention; nothing at all after Nov 2 00:00 Toronto (demo excepted).
    _pruneDecor: function () {
      var now = this.now(), demo = this.demo, all = this._get('decor', []);
      var keep = all.filter(function (x) { return now - x.createdAt < LIB.DECOR_KEEP_MS && (demo || now < LIB.DECOR_PURGE_MS); });
      if (keep.length !== all.length) this._set('decor', keep);
      return keep;
    },
    // Same contract as the decor_counts RPC: only cells with 3+ decor marks.
    decorCounts: function (cellFn) {
      return ok(LIB.aggregateDecor(this._pruneDecor(), cellFn, this.now(), 400, this.demo).map(function (z) {
        return { cell: z.cell, count: z.count, topTag: z.topTag, topTagN: z.topTagN };
      }));
    },
    decorCountIn: function (cell) { return this._pruneDecor().filter(function (x) { return x.cell === cell; }).length; }
  };
  // ==== SupabaseAdapter ====
  function loadScript(src, sri) {
    return new Promise(function (resolve, reject) {
      if (root.supabase && root.supabase.createClient) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous'; s.integrity = sri;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('cdn')); };
      document.head.appendChild(s);
    });
  }
  function SupabaseAdapter(cfg) {
    var self = this;
    this.cfg = cfg;
    this.ready = loadScript(SB_CDN, SB_SRI).then(function () {
      self.db = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    });
  }
  // Our RPCs raise exceptions whose message starts with one of these codes; anything else is a network/server problem.
  var CODE_RE = /^(invalid|forbidden|rate|closed|outside|text:[a-zA-Z]+)\b/;
  function unwrap(res) {
    if (res.error && (res.error.code === 'PGRST202' || /Could not find the function/i.test(res.error.message || ''))) {
      var me = new Error('missing'); me.code = 'missing'; throw me;          // RPC not installed yet (SQL not run)
    }
    if (res.error) {
      var msg = String(res.error.message || ''), m = CODE_RE.exec(msg);
      var e = new Error(m ? m[1] : msg || 'server');
      if (m) { e.code = m[1]; e.validation = true; }
      throw e;
    }
    return res.data;
  }
  function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }
  SupabaseAdapter.prototype = {
    _q: function (fn) { var self = this; return this.ready.then(function () { return fn(self.db); }).then(unwrap); },
    rpc: function (name, args) { return this._q(function (db) { return db.rpc(name, args); }); },
    ping: function () { return this._q(function (db) { return db.from('posts').select('id').limit(1); }); },
    listPosts: function (board) {
      return this._q(function (db) {
        var q = db.from('posts').select('id,board,area_id,lat,lng,body,votes,created_at').eq('hidden', false);
        if (board) q = q.eq('board', board);
        return q.order('created_at', { ascending: false }).limit(200);
      }).then(function (rows) {
        return rows.map(function (r) {
          return { id: r.id, board: r.board, areaId: r.area_id, lat: r.lat, lng: r.lng, body: r.body, votes: r.votes, createdAt: Date.parse(r.created_at) };
        });
      });
    },
    createPost: function (p, voter, token) {
      return this.rpc('create_post', { p_board: p.board, p_area_id: p.areaId || null, p_lat: p.lat == null ? null : p.lat,
        p_lng: p.lng == null ? null : p.lng, p_body: p.body, p_voter: voter, p_token: token }).then(function (id) { return { id: id }; });
    },
    vote: function (postId, voter) {
      return this.rpc('vote_post', { p_post_id: postId, p_voter: voter }).then(function (n) { return { ok: n >= 0, already: n < 0, count: Math.abs(n) }; });
    },
    report: function (postId, voter) {
      return this.rpc('report_post', { p_post_id: postId, p_voter: voter }).then(function (n) { return { ok: n >= 0, already: n < 0 }; });
    },
    deletePost: function (id, token) { return this.rpc('delete_post', { p_id: id, p_token: token }); },
    sendMark: function (m, token) {
      return this.rpc('send_mark', { p_session: m.session, p_lat: m.lat, p_lng: m.lng, p_h3: m.cell, p_tags: m.tags || [], p_token: token })
        .then(function (id) { return { id: id }; });
    },
    tagMark: function (id, token, tag) { return this.rpc('tag_mark', { p_id: id, p_token: token, p_tag: tag }); },
    liveZoneCounts: function (windowMin) {
      return this.rpc('zone_counts', { p_window_min: LIB.clampWindow(windowMin) }).then(function (rows) {
        return rows.map(function (r) {
          return { cell: r.h3_r8, count: r.n, topTag: r.top_tag, topTagN: r.top_tag_n, firstLitAt: r.first_lit_at ? Date.parse(r.first_lit_at) : null };
        });
      });
    },
    suggestArea: function (s) {
      return this.rpc('suggest_area', { p_device: s.device, p_h3: s.cell, p_lat: s.lat, p_lng: s.lng, p_reason: s.reason || null })
        .then(function (id) { return { id: id }; });
    },
    communitySuggested: function () {
      return this.rpc('community_suggested', {}).then(function (rows) {
        return rows.map(function (r) { return { cell: r.h3_r8, n: r.n, lat: r.lat, lng: r.lng, reasons: r.reasons || [] }; });
      });
    },
    sendDecor: function (d) {
      return this.rpc('send_decor', { p_device: d.device, p_lat: d.lat, p_lng: d.lng, p_h3: d.cell, p_tags: d.tags || [] })
        .then(function (id) { return { id: id }; });
    },
    decorCounts: function () {
      return this.rpc('decor_counts', {}).then(function (rows) {
        return rows.map(function (r) { return { cell: r.h3_r8, count: r.n, topTag: r.top_tag, topTagN: r.top_tag_n }; });
      });
    }
  };

  // ==== Resilient wrapper with automatic local fallback ====
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function isConfigured(cfg) {
    return cfg.backend === 'supabase' && /^https:\/\/[^\s/]+\/?$/.test(cfg.supabaseUrl || '') && String(cfg.supabaseAnonKey || '').length > 20;
  }
  function createBackend(cfg, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var local = new LocalAdapter({ cfg: cfg, demo: opts.demo, prefix: opts.demo ? 'ltot.demo.' : 'ltot.v3.', storage: opts.storage, channel: opts.channel, now: opts.now });
    var api = { local: local, mode: 'local', reason: '', onChange: function (fn) { local.onChange(fn); } };
    var statusFns = [], remote = null, retry = null, cacheKey = 'ltot.cache.';
    api.onStatus = function (fn) { statusFns.push(fn); };
    function setMode(m, why) { api.mode = m; api.reason = why || ''; statusFns.forEach(function (f) { f(m, why); }); }
    function cache(k, v) { try { localStorage.setItem(cacheKey + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
    function cached(k) { try { return JSON.parse(localStorage.getItem(cacheKey + k)) || []; } catch (e) { return []; } }

    if (cfg.backend === 'supabase' && !isConfigured(cfg)) { api.mode = 'offline'; api.reason = 'notConfigured'; }
    if (opts.remote || (isConfigured(cfg) && !opts.demo)) { remote = opts.remote || new SupabaseAdapter(cfg); api.mode = 'supabase'; }
    var timeoutMs = opts.timeoutMs || 5000;

    function goOffline(err) {
      if (api.mode !== 'offline') setMode('offline', err && err.message);
      if (retry || !remote) return;
      retry = setInterval(function () {
        withTimeout(remote.ping(), timeoutMs).then(function () { clearInterval(retry); retry = null; setMode('supabase'); }, function () { /* still down */ });
      }, opts.retryMs || 120000);
      if (retry.unref) retry.unref();                 // Node tests: don't keep the process alive
    }
    function viaLocal(name, args) {
      var p = local[name].apply(local, args);
      if (name === 'listPosts') return p.then(function (l) { return cached('posts.' + (args[0] || '')).concat(l); });
      return p;
    }
    // Practice mode: outside Oct 31 3–11 PM marks never leave this browser.
    api.isLive = function () { return LIB.isLiveOpen(now(), cfg, false); };
    METHODS.forEach(function (name) {
      api[name] = function () {
        var args = arguments;
        if (api.mode !== 'supabase' || (LIVE_METHODS[name] && !api.isLive()) || (DECOR_METHODS[name] && api.decorMissing)) return viaLocal(name, args);
        return withTimeout(remote[name].apply(remote, args), timeoutMs).then(function (res) {
          if (name === 'listPosts') cache('posts.' + (args[0] || ''), res);
          return res;
        }, function (err) {
          // Test days, but the server still has the Oct 31-only window (v7_update.sql not run yet): keep it local.
          if (err && err.code === 'closed' && LIVE_METHODS[name] && LIB.isTestOpen(now(), cfg)) return viaLocal(name, args);
          // v11: decor RPCs not installed yet → decor stays on this phone ("sharing turns on soon"), everything else stays shared.
          if (err && err.code === 'missing' && DECOR_METHODS[name]) { api.decorMissing = true; return viaLocal(name, args); }
          if (err && err.validation) throw err;
          goOffline(err);
          return viaLocal(name, args);
        });
      };
    });
    // Blur first, then hand to an adapter: the raw position never reaches storage or the network.
    var rawSend = api.sendMark;
    api.sendMark = function (m, token, cellFn, rnd) {
      if (!m || !LIB.inLondonBox(+m.lat, +m.lng)) return fail('outside');
      var b = LIB.blurPoint(+m.lat, +m.lng, rnd);
      if (!LIB.inLondonBox(b[0], b[1])) return fail('outside');
      return rawSend({ session: m.session, lat: b[0], lng: b[1], cell: cellFn ? cellFn(b[0], b[1]) : m.cell, tags: m.tags || [] }, token);
    };
    var rawDecor = api.sendDecor;
    api.sendDecor = function (d, cellFn, rnd) {
      if (!d || !LIB.inLondonBox(+d.lat, +d.lng)) return fail('outside');
      var b = LIB.blurPoint(+d.lat, +d.lng, rnd);
      if (!LIB.inLondonBox(b[0], b[1])) return fail('outside');
      return rawDecor({ device: d.device, lat: b[0], lng: b[1], cell: cellFn ? cellFn(b[0], b[1]) : d.cell, tags: d.tags || [] });
    };
    // Is decor sharing really reaching other families? false while the server SQL is missing, offline or local-only.
    api.decorShared = function () { return api.mode === 'supabase' && !api.decorMissing; };
    api.listDecor = function (cellFn) { return api.decorCounts(cellFn).then(function (rows) { return LIB.decorateDecor(rows); }); };
    api.listZones = function (windowMin, cellFn) {
      return api.liveZoneCounts(windowMin, cellFn).then(function (rows) { return LIB.decorateZones(rows, now()); });
    };
    return api;
  }

  return { LocalAdapter: LocalAdapter, SupabaseAdapter: SupabaseAdapter, createBackend: createBackend, isConfigured: isConfigured, METHODS: METHODS, LIVE_METHODS: LIVE_METHODS, DECOR_METHODS: DECOR_METHODS };
});
