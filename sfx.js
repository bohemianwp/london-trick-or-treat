/* sfx.js — v14 tiny sound effects, synthesised with the Web Audio API (no sound files, so no licences).
   Spooky-but-cute and gentle for small kids: every sound is shorter than 1 second and quiet (master volume 0.14).
     boo     fun-street mark: a soft, playful "boo-oo" ghost with a breathy whoosh
     twinkle decoration mark: a spooky little minor twinkle
     chime   like / ❤️ / post / reply: a sparkle chime
     fanfare badge earned: a tiny four-note fanfare
   Rules: ON by default but quiet; the 🔊/🔇 toggle is remembered in localStorage ('ltot.sound' = '1' | '0').
   Sounds play only right after a real tap or key press (within GESTURE_MS), never on their own, never on page load.
   The AudioContext is created inside the first tap, which is what iPhone/Android autoplay rules require. */
(function (root, factory) {
  var S = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.TOT_SFX = S;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var KEY = 'ltot.sound', VOLUME = 0.14, GESTURE_MS = 20000;   // a mark waits for GPS + server: allow 20 s after the tap
  var DUR = { boo: 0.75, twinkle: 0.6, chime: 0.55, fanfare: 0.85 };   // seconds, all < 1
  var NAMES = Object.keys(DUR);
  var ctx = null, master = null, lastGesture = 0, store = null, now = function () { return Date.now(); };
  try { store = root.localStorage; } catch (e) { store = null; }

  function isOn() { try { var v = store && store.getItem(KEY); return v === null || v === undefined ? true : v !== '0'; } catch (e) { return true; } }
  function setOn(on) { try { if (store) store.setItem(KEY, on ? '1' : '0'); } catch (e) { /* private mode */ } if (!on && ctx && ctx.suspend) try { ctx.suspend(); } catch (e) { /* ignore */ } return !!on; }
  function toggle() { return setOn(!isOn()); }

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = VOLUME; master.connect(ctx.destination);
    return ctx;
  }
  // Called from real user events (pointerdown / keydown, capture phase).
  function gesture() {
    lastGesture = now();
    if (!isOn()) return;
    var c = ensureCtx();
    if (c && c.state === 'suspended' && c.resume) try { c.resume(); } catch (e) { /* ignore */ }
  }
  function allowed() { return isOn() && lastGesture > 0 && now() - lastGesture <= GESTURE_MS; }

  // ---- tiny synth helpers (t0 = start time in seconds on the context clock)
  function env(c, t0, a, d, peak) {
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    g.connect(master);
    return g;
  }
  function tone(c, type, f0, f1, t0, a, d, peak) {
    var o = c.createOscillator(), g = env(c, t0, a, d, peak);
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + a + d);
    o.connect(g); o.start(t0); o.stop(t0 + a + d + 0.02);
    return o;
  }
  function noise(c, t0, dur, fFrom, fTo, peak) {
    var len = Math.max(1, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, len, c.sampleRate), ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(), bp = c.createBiquadFilter(), g = env(c, t0, dur * 0.35, dur * 0.65, peak);
    src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(fFrom, t0); bp.frequency.exponentialRampToValueAtTime(fTo, t0 + dur);
    src.connect(bp); bp.connect(g); src.start(t0); src.stop(t0 + dur + 0.02);
  }
  var RENDER = {
    // soft "boo-oo": a sine that wobbles and slides down, plus a breathy whoosh. Not scary: high, round, short.
    boo: function (c, t0) {
      var o = tone(c, 'sine', 520, 300, t0, 0.08, 0.6, 0.8);
      var lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 7; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t0); lfo.stop(t0 + 0.7);
      noise(c, t0, 0.55, 1400, 400, 0.25);
    },
    // spooky twinkle: A minor arpeggio (A5 C6 E6 A6) on a soft triangle, with a little shimmer on top
    twinkle: function (c, t0) {
      [880, 1046.5, 1318.5, 1760].forEach(function (f, i) { tone(c, 'triangle', f, f * 0.99, t0 + i * 0.09, 0.01, 0.3, 0.45); });
      tone(c, 'sine', 2637, 2637, t0 + 0.3, 0.01, 0.25, 0.12);
    },
    // sparkle chime: two bell partials (C6 + G6) and a faint high glint
    chime: function (c, t0) {
      tone(c, 'sine', 1046.5, 1046.5, t0, 0.005, 0.5, 0.6);
      tone(c, 'sine', 1568, 1568, t0 + 0.06, 0.005, 0.45, 0.4);
      tone(c, 'sine', 3136, 3136, t0 + 0.06, 0.005, 0.2, 0.1);
    },
    // tiny fanfare: C5 E5 G5 then a held C6
    fanfare: function (c, t0) {
      [[523.25, 0, 0.12], [659.25, 0.12, 0.12], [783.99, 0.24, 0.12], [1046.5, 0.36, 0.45]].forEach(function (n) {
        tone(c, 'triangle', n[0], n[0], t0 + n[1], 0.01, n[2], 0.55);
      });
    }
  };
  // Returns true if the sound was scheduled.
  function play(name, delayMs) {
    if (!RENDER[name] || !allowed()) return false;
    var c = ensureCtx();
    if (!c) return false;
    if (c.state === 'suspended' && c.resume) try { c.resume(); } catch (e) { /* ignore */ }
    try { RENDER[name](c, c.currentTime + 0.02 + (delayMs || 0) / 1000); } catch (e) { return false; }
    return true;
  }
  if (root.addEventListener) {
    root.addEventListener('pointerdown', gesture, true);
    root.addEventListener('keydown', function (e) { if (!e.repeat) gesture(); }, true);
  }
  return {
    play: play, isOn: isOn, setOn: setOn, toggle: toggle, gesture: gesture, allowed: allowed, KEY: KEY, VOLUME: VOLUME, GESTURE_MS: GESTURE_MS,
    DUR: DUR, NAMES: NAMES, RENDER: RENDER,
    // tests only: inject a fake AudioContext, storage and clock
    _setTestEnv: function (o) { if (o.ctx !== undefined) { ctx = o.ctx; if (ctx) { master = ctx.createGain(); master.connect(ctx.destination); } } if (o.store !== undefined) store = o.store; if (o.now) now = o.now; if (o.reset) lastGesture = 0; }
  };
});
