/* ▶ How to use — a ~25 s auto-play tour. A dimmed overlay with a glowing ring moves from control to control.
   app.js supplies the hooks (snapshot / restore / actions); demo zones live in app.js memory only, never in localStorage.
   Works in the browser (window.TOT_TOUR) and in Node (require('./tour.js')) so the timeline and controller can be tested. */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.TOT_TOUR = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // target = selector in index.html, cap = i18n key, act = app action when the step starts, ms = how long it plays,
  // beats = [[at ms, action]] inside a step. Step 4: a mark drops in and the zone goes 2 → 3 (lights up, NEW) → 4 → 5.
  var TIMELINE = [
    { target: '#legend', cap: 'tour1', act: 'zones', ms: 4000 },
    { target: '#nearChip', cap: 'tour2', act: 'map', ms: 3000 },
    { target: '#markBtn', cap: 'tour3', act: 'map', ms: 3500 },
    { target: '#map', cap: 'tour4', act: 'markStart', ms: 6500, beats: [[700, 'markDrop'], [2600, 'markDrop'], [4400, 'markDrop']] },
    { target: '[data-tab="route"]', cap: 'tour5', act: 'map', ms: 3000 },
    { target: '#shareAppBtn', cap: 'tour6', act: 'guide', ms: 3000 },
    { target: '#feedbackBtn', cap: 'tour7', act: 'guide', ms: 3500 }
  ];
  var TICK = 100;

  // api: snapshot(), restore(snap), run(action, step), open(), close(), show(i, step), progress(i, 0..1), finish(), controls(state)
  // opts.reduced: no timer and no animation; Next/Back cards instead.
  function createTour(api, opts) {
    opts = opts || {};
    var reduced = !!opts.reduced, setT = opts.setTimeout || setTimeout, clearT = opts.clearTimeout || clearTimeout;
    var st = { active: false, idx: 0, at: 0, paused: false, done: false, snap: null, timer: null };
    function state() { return { active: st.active, idx: st.idx, paused: st.paused, done: st.done, reduced: reduced, total: TIMELINE.length }; }
    function clear() { if (st.timer) clearT(st.timer); st.timer = null; }
    function loop() { clear(); st.timer = setT(tick, TICK); }
    function tick() {
      st.timer = null;
      if (!st.active || st.paused || st.done) return;
      var step = TIMELINE[st.idx], prev = st.at;
      st.at += TICK;
      (step.beats || []).forEach(function (b) { if (b[0] > prev && b[0] <= st.at) api.run(b[1], step); });
      api.progress(st.idx, Math.min(1, st.at / step.ms));
      if (st.at < step.ms) loop();
      else if (st.idx < TIMELINE.length - 1) go(st.idx + 1);
      else finish();
    }
    function go(i) {
      clear();
      st.idx = Math.max(0, Math.min(TIMELINE.length - 1, i)); st.at = 0; st.done = false;
      var step = TIMELINE[st.idx];
      api.run(step.act, step);
      // Reduced motion: show the step's end state at once. Paused jump (?tourStep=N): show it half-way, for screenshots.
      if (reduced || st.paused) st.at = reduced ? step.ms : Math.round(step.ms / 2);
      (step.beats || []).forEach(function (b) { if (b[0] <= st.at) api.run(b[1], step); });
      api.show(st.idx, step);
      if (st.at) api.progress(st.idx, st.at / step.ms);
      if (!reduced && !st.paused) loop();
      api.controls(state());
    }
    function finish() { clear(); st.done = true; api.finish(); api.controls(state()); }
    function start(i, pause) {
      if (!st.active) { st.snap = api.snapshot(); st.active = true; api.open(); api.run('setup'); }
      st.paused = !!pause && !reduced;
      go(i || 0);
    }
    function stop() {
      if (!st.active) return;
      clear(); st.active = st.paused = st.done = false;
      api.close(); api.restore(st.snap); st.snap = null;
    }
    function pause() { if (st.active && !reduced && !st.done) { st.paused = true; clear(); api.controls(state()); } }
    function resume() { if (st.active && !reduced && !st.done) { st.paused = false; loop(); api.controls(state()); } }
    return {
      start: start, stop: stop, skip: stop, pause: pause, resume: resume, state: state,
      toggle: function () { if (st.paused) resume(); else pause(); },
      replay: function () { start(0); },
      next: function () { if (st.idx < TIMELINE.length - 1) go(st.idx + 1); else finish(); },
      back: function () { go(st.idx - 1); }
    };
  }

  // Browser glue. app = { t, reduced, snapshot, restore, run(action), rect(step) -> optional custom ring rect }.
  function mount(app) {
    function $(id) { return document.getElementById(id); }
    var box = $('tour'), ring = $('tourRing'), card = $('tourCard'), bar = $('tourBar'), cur = null, reT = null, opener = null;
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function place() {
      var r = null, e;
      if (cur) { r = app.rect && app.rect(cur); e = document.querySelector(cur.target); if (!r && e) r = e.getBoundingClientRect(); }
      if (!r || !r.width) r = { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
      var p = r.width ? 6 : 0, x = r.left - p, y = r.top - p, w = r.width + 2 * p, h = r.height + 2 * p;
      ring.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      ring.style.width = Math.round(w) + 'px'; ring.style.height = Math.round(h) + 'px';
      card.classList.toggle('tour-card-top', y + h / 2 > innerHeight * 0.55);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); ctl.stop(); }
      else if (e.key === 'ArrowRight' && app.reduced) ctl.next();
      else if (e.key === 'ArrowLeft' && app.reduced) ctl.back();
    }
    var ctl = createTour({
      snapshot: app.snapshot, restore: app.restore, run: app.run,
      open: function () {
        opener = document.activeElement;
        box.hidden = false;
        bar.textContent = '';
        TIMELINE.forEach(function () { bar.appendChild(document.createElement('i')).appendChild(document.createElement('b')); });
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', place);
      },
      close: function () {
        box.hidden = true; cur = null; clearTimeout(reT);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', place);
        if (opener && opener.focus && document.contains(opener)) opener.focus();
      },
      show: function (i, step) {
        cur = step; place();
        clearTimeout(reT); reT = setTimeout(place, 420);        // again once a panel has slid in
        $('tourCap').textContent = app.t(step.cap);
        $('tourCount').textContent = pad(i + 1) + ' / ' + pad(TIMELINE.length);
        $('tourCount').setAttribute('aria-label', app.t('tourProgress', { n: i + 1, total: TIMELINE.length }));
        Array.prototype.forEach.call(bar.children, function (s, k) { s.className = k < i ? 'done' : k === i ? 'cur' : ''; s.style.setProperty('--p', k < i ? 1 : 0); });
      },
      progress: function (i, f) { bar.children[i].style.setProperty('--p', f.toFixed(2)); },
      finish: function () {
        cur = null; place();
        $('tourCap').textContent = app.t('tourEnd');
        Array.prototype.forEach.call(bar.children, function (s) { s.className = 'done'; s.style.setProperty('--p', 1); });
      },
      controls: function (s) {
        $('tourPause').hidden = s.reduced || s.done;
        $('tourPause').textContent = app.t(s.paused ? 'tourResume' : 'tourPause');
        $('tourPause').setAttribute('aria-pressed', String(s.paused));
        $('tourBack').hidden = !s.reduced || s.done;
        $('tourBack').disabled = s.idx === 0;
        $('tourNext').hidden = !s.reduced || s.done;
        $('tourReplay').textContent = app.t('tourReplay');
        $('tourBack').textContent = app.t('tourBack'); $('tourNext').textContent = app.t('tourNext');
        $('tourSkip').textContent = app.t(s.done ? 'tourDone' : 'tourSkip');
        var f = s.done ? $('tourReplay') : s.reduced ? $('tourNext') : $('tourPause');
        if (box.contains(document.activeElement) && !document.activeElement.hidden) return;
        f.focus({ preventScroll: true });
      }
    }, { reduced: app.reduced });
    $('tourPause').addEventListener('click', ctl.toggle);
    $('tourSkip').addEventListener('click', ctl.stop);
    $('tourReplay').addEventListener('click', ctl.replay);
    $('tourNext').addEventListener('click', ctl.next);
    $('tourBack').addEventListener('click', ctl.back);
    return ctl;
  }

  return { TIMELINE: TIMELINE, TICK: TICK, createTour: createTour, mount: mount };
});
