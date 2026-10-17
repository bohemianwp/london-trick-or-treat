/* Data-access layer: one interface, two adapters.
   LocalAdapter    — localStorage + BroadcastChannel (default, and the automatic fallback).
   SupabaseAdapter — supabase-js v2 from a CDN, loaded only when config.backend === 'supabase' and it is configured.
   Interface: listMarkers, upsertMarker, setMarkerStatus, deleteMarker, listPosts, createPost, vote, report, deletePost,
              sendDot, removeDot, listDots, liveHexCounts. Every method returns a Promise.
   Errors carry err.code: invalid | forbidden | rate | closed | outside | text:<empty|tooLong|url|email|phone|profanity> */
(function (root, factory) {
  var B = factory(root, root.TOT_LIB || (typeof require === 'function' ? require('./lib.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = B;
  else root.TOT_BACKEND = B;
})(typeof self !== 'undefined' ? self : this, function (root, LIB) {
  'use strict';

  var SB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
  var SB_SRI = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
  var METHODS = ['listMarkers', 'upsertMarker', 'setMarkerStatus', 'deleteMarker', 'listPosts', 'createPost',
                 'vote', 'report', 'deletePost', 'sendDot', 'removeDot', 'listDots', 'liveHexCounts'];
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

    // ---------------- markers
    listMarkers: function () {
      var now = this.now();
      return ok(this._get('markers', []).filter(function (m) { return !LIB.isMarkerExpired(m, now); })
        .map(function (m) { var c = Object.assign({}, m); delete c.tokenHash; delete c.deviceHash; return c; }));
    },
    upsertMarker: function (m, token) {
      if (!token || token.length < 16) return fail('invalid');
      if (m && m.note) { var tc = LIB.checkText(m.note, { optional: true }); if (!tc.ok) return fail('text:' + tc.error); }
      var clean = LIB.sanitizeMarker(m);
      if (!clean) return fail(m && !LIB.inLondonBox(+m.lat, +m.lng) ? 'outside' : 'invalid');
      if (this.now() >= LIB.MARKER_EXPIRES_MS) return fail('closed');
      var list = this._get('markers', []), hash = LIB.sha256Hex(token), now = this.now();
      if (clean.id) {
        var i = list.findIndex(function (x) { return x.id === clean.id; });
        if (i < 0) return fail('forbidden');
        if (list[i].tokenHash !== hash) return fail('forbidden');
        list[i] = Object.assign(list[i], clean, { tokenHash: hash, updatedAt: now });
      } else {
        var dev = m.device ? LIB.sha256Hex('device:' + m.device) : null;
        var mine = list.filter(function (x) { return dev && x.deviceHash === dev; }).length;
        if (mine >= 3) return fail('rate');                               // at most 3 houses per device
        clean.id = LIB.uuid();
        clean.deviceHash = dev;
        clean.createdAt = now;
        clean.tokenHash = hash;
        list.push(clean);
      }
      this._set('markers', list);
      return ok({ id: clean.id });
    },
    setMarkerStatus: function (id, status, token) {
      if (LIB.STATUSES.indexOf(status) < 0) return fail('invalid');
      var list = this._get('markers', []), hash = LIB.sha256Hex(token || '');
      var m = list.find(function (x) { return x.id === id; });
      if (!m || m.tokenHash !== hash) return fail('forbidden');
      m.status = status;
      m.updatedAt = this.now();
      this._set('markers', list);
      return ok(true);
    },
    deleteMarker: function (id, token) {
      var list = this._get('markers', []), hash = LIB.sha256Hex(token || '');
      var keep = list.filter(function (x) { return !(x.id === id && x.tokenHash === hash); });
      if (keep.length === list.length) return fail('forbidden');
      this._set('markers', keep);
      return ok(true);
    },

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

    // ---------------- live dots
    sendDot: function (d) {
      var now = this.now();
      if (!d || !/^[a-f0-9]{16,64}$/.test(d.session || '')) return fail('invalid');
      if (!LIB.inLondonBox(+d.lat, +d.lng)) return fail('outside');
      if (!LIB.isLiveOpen(now, this.cfg, this.demo)) return fail('closed');
      var ttl = this.cfg.dotTtlMin || 30, sid = LIB.sha256Hex(d.session);
      var dots = LIB.pruneDots(this._get('dots', []), now, ttl);
      var cur = dots.find(function (x) { return x.sidHash === sid; });
      if (cur && now - cur.updatedAt < 30000) return ok(false);          // one dot per session every 30 s
      var rec = { sidHash: sid, lat: LIB.round(+d.lat, 4), lng: LIB.round(+d.lng, 4),
                  h3: /^[0-9a-f]{15}$/.test(d.h3 || '') ? d.h3 : null, updatedAt: now };
      if (cur) Object.assign(cur, rec); else dots.push(rec);
      this._set('dots', dots);
      return ok(true);
    },
    // Turning sharing off removes your dot at once instead of waiting for the 30-minute expiry.
    removeDot: function (session) {
      var sid = LIB.sha256Hex(session || '');
      this._set('dots', this._get('dots', []).filter(function (x) { return x.sidHash !== sid; }));
      return ok(true);
    },
    listDots: function () {
      var now = this.now(), ttl = this.cfg.dotTtlMin || 30;
      return ok(LIB.pruneDots(this._get('dots', []), now, ttl).map(function (d) {
        return { sidHash: d.sidHash, lat: d.lat, lng: d.lng, updatedAt: d.updatedAt };
      }));
    },
    // Client-side aggregation (the server does this in SQL). cellFn maps lat,lng -> cell id.
    liveHexCounts: function (windowMin, cellFn) {
      var self = this;
      var w = Math.min(30, Math.max(15, windowMin || this.cfg.hexWindowMin || 20));
      return this.listDots().then(function (dots) {
        var counts = LIB.countDotsByCell(dots.map(function (d) { return { lat: d.lat, lng: d.lng, updatedAt: d.updatedAt }; }),
                                         cellFn, self.now(), w);
        return LIB.suppressSmall(counts, self.cfg.hexMinCount || 3);
      });
    }
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
    listMarkers: function () {
      return this._q(function (db) {
        return db.from('markers').select('id,lat,lng,types,status,note,start_time,end_time,expires_at')
          .gt('expires_at', new Date().toISOString()).limit(2000);
      }).then(function (rows) {
        return rows.map(function (r) {
          return { id: r.id, lat: r.lat, lng: r.lng, types: r.types, status: r.status, note: r.note || '',
                   start: hhmm(r.start_time), end: hhmm(r.end_time), expiresAt: Date.parse(r.expires_at) };
        });
      });
    },
    upsertMarker: function (m, token) {
      return this.rpc('upsert_marker', { p_id: m.id || null, p_lat: m.lat, p_lng: m.lng, p_types: m.types, p_status: m.status,
        p_note: m.note || null, p_start: m.start || null, p_end: m.end || null, p_token: token, p_device: m.device || null })
        .then(function (id) { return { id: id }; });
    },
    setMarkerStatus: function (id, status, token) { return this.rpc('set_marker_status', { p_id: id, p_token: token, p_status: status }); },
    deleteMarker: function (id, token) { return this.rpc('delete_marker', { p_id: id, p_token: token }); },
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
    sendDot: function (d) { return this.rpc('send_dot', { p_session: d.session, p_lat: d.lat, p_lng: d.lng, p_h3: d.h3 || null }); },
    removeDot: function (session) { return this.rpc('remove_dot', { p_session: session }); },
    listDots: function () {
      return this.rpc('live_dots_recent', {}).then(function (rows) {
        return rows.map(function (r) { return { sidHash: r.sid_hash, lat: r.lat, lng: r.lng, updatedAt: Date.parse(r.updated_at) }; });
      });
    },
    liveHexCounts: function (windowMin) {
      return this.rpc('live_hex_counts', { p_window_min: windowMin || 20 }).then(function (rows) {
        return rows.map(function (r) { return { cell: r.h3_r8, count: r.n }; });
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
    var local = new LocalAdapter({ cfg: cfg, demo: opts.demo, prefix: opts.demo ? 'ltot.demo.' : 'ltot.v2.', storage: opts.storage, channel: opts.channel });
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
      if (name === 'listMarkers') return p.then(function (l) { return cached('markers').concat(l); });
      if (name === 'listPosts') return p.then(function (l) { return cached('posts.' + (args[0] || '')).concat(l); });
      return p;
    }
    METHODS.forEach(function (name) {
      api[name] = function () {
        var args = arguments;
        if (api.mode !== 'supabase') return viaLocal(name, args);
        return withTimeout(remote[name].apply(remote, args), timeoutMs).then(function (res) {
          if (name === 'listMarkers') cache('markers', res);
          if (name === 'listPosts') cache('posts.' + (args[0] || ''), res);
          return res;
        }, function (err) {
          if (err && err.validation) throw err;
          goOffline(err);
          return viaLocal(name, args);
        });
      };
    });
    return api;
  }

  return { LocalAdapter: LocalAdapter, SupabaseAdapter: SupabaseAdapter, createBackend: createBackend, isConfigured: isConfigured, METHODS: METHODS };
});
