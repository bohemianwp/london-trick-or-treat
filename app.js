/* Mark it! London — trick-or-treat map for kids & families (v3). Plain JS, no build step.
   Loads after: Leaflet, h3-js (optional), config.js, lib.js, i18n.js, data/areas.js, backend.js, hex.js
   Core loop: tap the big button -> one-shot location -> blurred mark -> zones (H3 res 8) light up at 3+ marks. */
(function () {
  'use strict';

  var LIB = window.TOT_LIB, I18N = window.TOT_I18N, RAW = window.TOT_AREAS_RAW || { meta: {}, areas: [] };
  var CFG = Object.assign({ backend: 'local', liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
                            markWindowMin: 45, pollSec: 45 }, window.TOT_CONFIG || {});
  CFG.markWindowMin = LIB.clampWindow(CFG.markWindowMin);
  CFG.pollSec = Math.min(60, Math.max(30, Number(CFG.pollSec) || 45));

  // ==== constants ====
  var LONDON = [42.9849, -81.2453];
  var FLAGS = LIB.parseUrlFlags(location.search);   // ?guide=1, ?howto=1, ?lang=zh|en, ?demo=1, ?near=1, ?feedback=1, ?tour=1&tourStep=N
  var DEMO = FLAGS.demo;
  var DEMO_HOME = [42.9628, -81.2390];                // ?demo=1&near=1 centres "Near me" here (Old South, near Wortley Rd)
  var P = DEMO ? 'ltot.demo.' : 'ltot.v3.';           // demo data never mixes with real data
  var STORE = { favTokens: P + 'mine.fav', favReports: P + 'mine.favReports', sound: 'ltot.sound', shared: 'ltot.sharedCount', lang: 'ltot.lang', locOk: 'ltot.locExplained', device: 'ltot.device', layers: 'ltot.v3.layers', markHint: 'ltot.markHintSeen', tipHint: 'ltot.tipHintSeen',
                session: P + 'session', markHist: P + 'mine.marks', suggestHist: P + 'mine.suggest',
                postTokens: P + 'mine.posts', decorHist: P + 'mine.decor', votes: P + 'mine.votes', reports: P + 'mine.reports' };
  var PACE = { 'u5': 1.5, '5-8': 2.0, '9-12': 2.5, 'teen': 3.0 };   // km/h including door stops
  var MAX_WALK_TO_AREA_KM = 1.5;
  var LOCAL_RECOUNT_MS = 12000;                       // local/demo mode: re-aggregate every 12 s
  var AREAS = (RAW.areas || []).map(LIB.mapArea);
  var EVENTS = ((RAW.meta || {}).events || []);
  var AREA_BY_ID = {};
  AREAS.forEach(function (a) { AREA_BY_ID[a.id] = a; });
  // v14: tiny Web Audio sounds (sfx.js). They play only right after a tap and respect the 🔊/🔇 toggle.
  var SFX = window.TOT_SFX || { play: function () { return false; }, isOn: function () { return false; }, toggle: function () { return false; } };
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==== i18n ====
  var SAVED_LANG = (function () { try { return localStorage.getItem(STORE.lang); } catch (e) { return null; } })();
  var lang = LIB.initialLang(FLAGS, SAVED_LANG);                       // English unless chosen; never the browser language
  if (FLAGS.lang) { try { localStorage.setItem(STORE.lang, FLAGS.lang); } catch (e) { /* ignore */ } }   // ?lang= link presets it
  // {win} anywhere (also inside the guide/How-to arrays) = the configured mark window, so the text follows config.js.
  function fillWin(x) {
    if (typeof x === 'string') return x.replace(/\{win\}/g, CFG.markWindowMin);
    if (Array.isArray(x)) return x.map(fillWin);
    return x;
  }
  function t(key, vars) {
    var s = I18N[lang][key];
    if (s === undefined) s = I18N.en[key];
    if (s === undefined) return key;
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
    return fillWin(s);
  }
  function errText(err) {
    var c = (err && err.code) || '';
    if (c.indexOf('text:') === 0) return t('err_' + c.slice(5));
    return I18N.en['err_' + c] ? t('err_' + c) : t('err_network');
  }

  // ==== helpers ====
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function lsGet(key, fb) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode / full */ } }
  function haversineKm(a, b) { return LIB.distM(a, b) / 1000; }
  var bearingDeg = LIB.bearingDeg;
  function dirName(deg) { return t('dirs')[Math.round(deg / 45) % 8]; }
  function fmtDist(km) { return km < 1 ? Math.round(km * 100) * 10 + (lang === 'zh' ? ' 米' : ' m') : km.toFixed(1) + (lang === 'zh' ? ' 公里' : ' km'); }
  function fmtMin(min) {
    min = Math.round(min);
    if (min < 60) return min + ' ' + t('min');
    var h = Math.floor(min / 60), m = min % 60;
    return m ? t('hInMin', { h: h, m: m }) : t('hOnly', { h: h });
  }
  function fmtClock(ms) { return new Date(ms).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-CA', { hour: 'numeric', minute: '2-digit', timeZone: LIB.TZ }); }
  function ago(ms) {
    var m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return t('justNow');
    if (m < 60) return t('agoMin', { n: m });
    if (m < 1440) return t('agoH', { n: Math.floor(m / 60) });
    return t('agoD', { n: Math.floor(m / 1440) });
  }
  function dots(n) {
    var span = el('span', { class: 'dots' });
    for (var i = 1; i <= 5; i++) span.appendChild(i <= n ? document.createTextNode('●') : el('span', { class: 'off', text: '●' }));
    return span;
  }
  function narrow() { return window.innerWidth < 760; }
  var toastTimer;
  function toast(msg, ms) {
    var box = $('toast');
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, ms || 3500);
  }
  function segInit(id, onPick) {
    var seg = $(id);
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !seg.contains(b)) return;
      Array.prototype.forEach.call(seg.children, function (c) { c.setAttribute('aria-checked', c === b ? 'true' : 'false'); });
      onPick(b.dataset.v);
    });
  }
  function segSet(id, v) { Array.prototype.forEach.call($(id).children, function (c) { c.setAttribute('aria-checked', String(c.dataset.v === v)); }); }
  function showErr(id, msg) { $(id).textContent = msg; $(id).hidden = !msg; }
  function updateCount(inputId, outId, max) { $(outId).textContent = LIB.charCount($(inputId).value) + '/' + (max || 140); }

  // ==== device identity (random, local only) ====
  var DEVICE = lsGet(STORE.device, null);
  if (!DEVICE) { DEVICE = LIB.uuid(); lsSet(STORE.device, DEVICE); }
  var myPostTokens = lsGet(STORE.postTokens, {}), myVotes = lsGet(STORE.votes, {}), myReports = lsGet(STORE.reports, {});

  // ==== map ====
  if (typeof L === 'undefined') {
    $('map').appendChild(el('div', { class: 'warn', style: 'margin:16px', text: t('leafletMissing') }));
    applyStaticText();
    return;
  }
  var map = L.map('map', { zoomControl: true, attributionControl: false, tap: true, zoomSnap: 0.25 }).setView(LONDON, 12);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'tiles-dark',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);

  var POP_TL = L.point(12, 190), POP_BR = L.point(12, 120);   // popups open below the top-right buttons
  var HEX = window.TOT_HEX;
  var grid = HEX ? HEX.makeGrid() : LIB.makeGrid(null);
  var baseLayer = HEX ? HEX.createBaseLayer(grid) : null;
  var decorLayer = HEX ? HEX.createZoneLayer(grid, { kind: 'decor', pane: 'decorPane', paneZ: 420, onTap: decorPopup, badgeHtml: decorBadgeHtml,
    avoid: function () { return zoneLayer && map.hasLayer(zoneLayer) ? zoneLayer.rects : []; } }) : null;
  var zoneLayer = HEX ? HEX.createZoneLayer(grid, { onTap: zonePopup, badgeHtml: badgeHtml,
    onLayout: function () { if (decorLayer && map.hasLayer(decorLayer)) decorLayer.setData(decorLayer.zones); } }) : null;
  map.createPane('favPane'); map.getPane('favPane').style.zIndex = 610;   // v14 bubbles: above the hexagons and pins
  var favLayer = L.layerGroup();
  var layers = {
    fav: favLayer,
    zones: zoneLayer || L.layerGroup(),
    decor: decorLayer || L.layerGroup(),
    areas: L.layerGroup(),
    events: L.layerGroup()
  };
  if (baseLayer) baseLayer.addTo(layers.areas);         // faint planning score lives with the "Suggested" base layer
  var mineLayer = L.layerGroup().addTo(map);            // sparkles where *I* marked (this phone only)
  var routeLayer = L.layerGroup().addTo(map);
  var layerOn = Object.assign({ fav: true, zones: true, decor: true, areas: true, events: true }, lsGet(STORE.layers, {}));

  function sheetHeight() { var s = $('sheet'); return s.dataset.open === 'true' && narrow() ? s.offsetHeight : 0; }
  function focusBounds(b) { map.fitBounds(b, { paddingTopLeft: [20, 110], paddingBottomRight: [20, sheetHeight() + 20], maxZoom: 16 }); }

  // ==== backend ====
  var backend = window.TOT_BACKEND.createBackend(CFG, { demo: DEMO });
  var data = { zones: [], decorZones: [], suggested: [], posts: { fun: [], decor: [] }, zonesAt: 0 };
  function markMode() { return LIB.markMode(Date.now(), CFG, DEMO); }
  function renderChips() {
    $('offlineChip').hidden = backend.mode !== 'offline';
    $('demoChip').hidden = !DEMO;
    var mm = markMode();                                   // v15: one status chip, words always visible: Practice / Test days
    $('practiceChip').hidden = mm !== 'practice' && mm !== 'test';
    $('practiceChip').textContent = t(mm === 'test' ? 'testChip' : 'practiceChip');
    $('practiceChip').dataset.tipKey = mm === 'test' ? 'tip_test' : 'tip_practice';
    document.querySelector('.topbar').classList.toggle('crowded', !$('offlineChip').hidden && !$('practiceChip').hidden);   // v14: room for 🔊
    renderPhase();
    document.querySelectorAll('.local-note').forEach(function (n) { n.hidden = backend.mode === 'supabase'; });
  }
  backend.onStatus(renderChips);
  $('offlineChip').addEventListener('click', function () {
    toast(backend.reason === 'notConfigured' ? t('offlineWhy_notConfigured') : t('offlineWhy'), 7000);
  });
  $('practiceChip').addEventListener('click', function () { toast(t(markMode() === 'test' ? 'testWhy' : 'practiceWhy'), 7000); });
  $('phaseBanner').addEventListener('click', openPhaseCard);

  // ==== layer chips ====
  var LAYER_ICONS = { zones: '🔥', decor: '🎃', fav: '💬', areas: '🧭', events: '📅' };   // v14: chips show a colour dot (.li-*), not the emoji
  var LAYER_KEYS = { zones: 'layerZones', decor: 'layerDecor', fav: 'layerFav', areas: 'layerAreas', events: 'layerEvents' };
  function decorLayerShown() { return LIB.decorVisible(Date.now(), DEMO); }
  function applyLayers() {
    Object.keys(layers).forEach(function (k) {
      var on = !!layerOn[k] && (k !== 'decor' || decorLayerShown()) && (k !== 'fav' || favOn());
      if (on && !map.hasLayer(layers[k])) layers[k].addTo(map);
      if (!on && map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    });
    $('legend').hidden = !layerOn.zones && !(layerOn.decor && decorLayerShown());
    $('legendDecor').hidden = !(layerOn.decor && decorLayerShown());
    renderLayerBar();
  }
  // v15: two main chips that follow the phase + "More ▾" (the rest). Before Oct 31 3 PM: Decorations, Past favourites;
  // on the night: Fun streets, Past favourites. Fits 390 px in EN and ZH; one primary layer per phase.
  var layerMoreOpen = false;
  function layerMain(k) { return k === 'fav' || (bigIsDecor() ? k === 'decor' : k === 'zones'); }
  function renderLayerBar() {
    var bar = $('layerbar'), nearChip = $('nearChip'), more = $('layerMore');   // More and Near me are static (index.html)
    bar.querySelectorAll('[data-layer]').forEach(function (b) { b.remove(); });
    bar.setAttribute('aria-label', t('layers'));
    Object.keys(LAYER_ICONS).forEach(function (k) {
      if (k === 'decor' && !decorLayerShown()) return;
      if (k === 'fav' && !favOn()) return;
      var main = layerMain(k);
      var b = el('button', { type: 'button', class: 'lchip' + (main ? '' : ' lchip-sec'), 'aria-pressed': String(!!layerOn[k]), 'data-layer': k,
        'data-tip-key': 'tip_layer_' + k, onclick: function () { setLayer(k, !layerOn[k]); } }, [el('span', { class: 'li li-' + k, 'aria-hidden': 'true' }), t(LAYER_KEYS[k])]);
      b.hidden = !main && !layerMoreOpen;
      bar.insertBefore(b, main ? more : nearChip);
    });
    nearChip.hidden = !layerMoreOpen;
    more.setAttribute('aria-expanded', String(layerMoreOpen));
    more.querySelector('.lm-arrow').textContent = layerMoreOpen ? '▴' : '▾';
  }
  $('layerMore').addEventListener('click', function () { layerMoreOpen = !layerMoreOpen; renderLayerBar(); });
  $('nearChip').addEventListener('click', function () { openNear(); });
  function setLayer(k, on) {
    layerOn[k] = on;
    lsSet(STORE.layers, layerOn);
    applyLayers();
  }

  // ==== researched areas ("Suggested / 推荐" base layer) ====
  function scoreGrid(a) {
    return el('div', { class: 'scores' }, [
      el('span', { text: '🍬 ' + t('scoreCandy') }), dots(a.s.candy),
      el('span', { text: '🎃 ' + t('scoreDecor') }), dots(a.s.decor),
      el('span', { text: '🚶 ' + t('scoreSafety') }), dots(a.s.safety),
      el('span', { text: '👥 ' + t('scoreCrowd') }), dots(a.s.crowd)
    ]);
  }
  function sourceList(a) {
    return el('div', { class: 'sources' }, [el('div', { class: 'src-h', text: t('sourcesLabel') })].concat(a.sources.map(function (s) {
      return el('div', null, [el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }), el('span', { class: 'mono-num', text: ' · ' + s.date })]);
    })));
  }
  function areaPopup(a) {
    return el('div', { class: 'pop' }, [
      el('div', { class: 'pop-kicker', text: '🧭 ' + t('suggestedTag') }),
      el('div', { class: 'pop-title', text: a.name[lang] }),
      el('div', { class: 'pop-sub', text: t('overall') + ' ' + LIB.overall(a) + ' / 5' }),
      el('div', { class: 'pop-label', text: t('unverified') }),
      scoreGrid(a),
      el('div', { class: 'pop-p', text: a.notes[lang] }),
      a.streets.length ? el('div', { class: 'pop-small', text: t('streetsLabel') + a.streets.join(', ') }) : null,
      a.cautions[lang] ? el('div', { class: 'pop-warn', text: t('cautionLabel') + a.cautions[lang] }) : null,
      sourceList(a),
      el('button', { class: 'btn btn-primary btn-small', type: 'button', text: t('planHere'), onclick: function () { map.closePopup(); planForArea(a.id); } })
    ]);
  }
  function shortName(a) { return a.name[lang].split(/ \(| \/ | near |（| \/|附近/)[0].trim(); }
  var communityGroup = L.layerGroup().addTo(layers.areas);
  function renderAreaLayer() {
    layers.areas.eachLayer(function (l) { if (l !== baseLayer && l !== communityGroup) layers.areas.removeLayer(l); });
    AREAS.forEach(function (a) {
      // Dashed outline + muted fill: visually separate from live zones, and drawn under them.
      L.circle([a.lat, a.lng], { radius: a.r, color: '#cbd5e1', weight: 1.5, opacity: 0.55, fillColor: '#cbd5e1', fillOpacity: 0.04,   // v15: grey, purple = decorations only
                                 dashArray: '5 7', bubblingMouseEvents: false, className: 'area-circle' })
        .bindTooltip(shortName(a) + ' · ' + t('suggestedTag'), { permanent: true, direction: 'center', className: 'area-label' })
        .on('click', function (e) {
          if (mode) handleMapTap(e.latlng);
          else L.popup({ maxWidth: 300, autoPanPaddingTopLeft: POP_TL, autoPanPaddingBottomRight: POP_BR }).setLatLng(e.latlng).setContent(areaPopup(a)).openOn(map);
        })
        .addTo(layers.areas);
    });
  }
  function renderCommunity() {
    communityGroup.clearLayers();
    data.suggested.forEach(function (s) {
      var pts = isCell(s.cell) ? grid.boundary(s.cell) : grid.boundary(grid.cell(s.lat, s.lng));
      L.polygon(pts, { color: '#cbd5e1', weight: 2, dashArray: '3 6', fillColor: '#cbd5e1', fillOpacity: 0.08, className: 'community-hex', bubblingMouseEvents: false })
        .bindTooltip('📌 ' + t('communityTag'), { permanent: true, direction: 'center', className: 'area-label community-label' })
        .on('click', function (e) {
          if (mode) { handleMapTap(e.latlng); return; }
          L.popup({ maxWidth: 260, autoPanPaddingTopLeft: POP_TL, autoPanPaddingBottomRight: POP_BR }).setLatLng(e.latlng).setContent(el('div', { class: 'pop' }, [
            el('div', { class: 'pop-kicker', text: '💜 ' + t('communityTag') }),
            el('div', { class: 'pop-sub', text: t('communityN', { n: s.n }) }),
            s.reasons.length ? el('ul', { class: 'type-list' }, s.reasons.map(function (r) { return el('li', { text: '“' + r + '”' }); })) : null,
            el('div', { class: 'pop-small', text: t('communityHelp') })
          ])).openOn(map);
        }).addTo(communityGroup);
    });
  }
  function isCell(c) { return grid.kind === 'h3' ? /^[0-9a-f]{15}$/.test(c || '') : /^L-?\d+_-?\d+$/.test(c || ''); }
  function zoomClass() { map.getContainer().classList.toggle('zoom-far', map.getZoom() < 13); }   // fewer labels when zoomed out
  map.on('zoomend', zoomClass);
  function renderAreaList() {
    var list = $('areaList');
    list.textContent = '';
    AREAS.slice().sort(function (a, b) { return LIB.overall(b) - LIB.overall(a); }).forEach(function (a) {
      list.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('span', { class: 'card-title', text: a.name[lang] }),
                                           el('span', { class: 'badge mono-num', text: LIB.overall(a) + ' / 5' })]),
        scoreGrid(a),
        el('p', { text: a.notes[lang] }),
        a.cautions[lang] ? el('p', { class: 'pop-warn', text: t('cautionLabel') + a.cautions[lang] }) : null,
        el('details', null, [el('summary', { text: t('sourcesLabel') + ' (' + a.sources.length + ')' }), sourceList(a)]),
        el('div', { class: 'row' }, [
          el('button', { class: 'btn', type: 'button', text: t('showOnMap'), onclick: function () {
            if (narrow()) setSheetOpen(false);
            focusBounds(L.latLng(a.lat, a.lng).toBounds(a.r * 2.2));
          } }),
          el('button', { class: 'btn btn-primary', type: 'button', text: t('planHere'), onclick: function () { planForArea(a.id); } })
        ])
      ]));
    });
  }
  function areaOptions(sel, firstVal, firstText, withScore, extra) {
    var cur = sel.value || firstVal;
    sel.textContent = '';
    sel.appendChild(el('option', { value: firstVal, text: firstText }));
    if (extra) sel.appendChild(el('option', { value: extra.value, text: extra.text }));
    AREAS.forEach(function (a) { sel.appendChild(el('option', { value: a.id, text: a.name[lang] + (withScore ? ' (' + LIB.overall(a) + ')' : '') })); });
    sel.value = cur;
    if (sel.value !== cur) sel.value = firstVal;
  }

  // ==== events ====
  function eventName(e) { return lang === 'zh' ? e.name_zh || e.name_en : e.name_en || e.name; }
  function eventWhen(e) { return lang === 'zh' ? e.when_zh || e.when : e.when_en || e.when; }
  function eventPopup(e) {
    return el('div', { class: 'pop' }, [
      el('div', { class: 'pop-title', text: '📅 ' + eventName(e) }),
      el('div', { class: 'pop-sub mono-num', text: eventWhen(e) }),
      e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer', text: t('eventOpen') + ' ↗' }) : null
    ]);
  }
  function renderEvents() {
    layers.events.clearLayers();
    var list = $('eventList');
    list.textContent = '';
    EVENTS.forEach(function (e) {
      if (e.map && e.lat != null) {
        L.marker([e.lat, e.lng], { icon: L.divIcon({ className: '', html: '<div class="ev-pin">📅</div>', iconSize: [36, 36], iconAnchor: [18, 18] }) })
          .bindPopup(function () { return eventPopup(e); }).addTo(layers.events);
      }
      list.appendChild(el('div', { class: 'card card-ev' }, [
        el('div', { class: 'card-title', text: eventName(e) }),
        el('div', { class: 'mono-num ev-when', text: eventWhen(e) }),
        el('div', { class: 'row' }, [
          e.map && e.lat != null ? el('button', { class: 'btn btn-small', type: 'button', text: t('showOnMap'), onclick: function () {
            if (narrow()) setSheetOpen(false);
            map.setView([e.lat, e.lng], 16);
          } }) : null,
          e.url ? el('a', { class: 'btn btn-small', href: e.url, target: '_blank', rel: 'noopener noreferrer', text: t('eventOpen') + ' ↗' }) : null
        ])
      ]));
    });
  }

  // ==== location: "Show my location" (follow) + one-shot fixes for marking ====
  var geo = { watchId: null, pos: null, posAt: 0, acc: 0, following: false, marker: null, circle: null, onFix: [] };
  function isSecure() { return window.isSecureContext || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); }
  function geoOk() { return 'geolocation' in navigator && isSecure(); }
  function updateLocateBtn() {
    $('locateBtn').classList.toggle('on', geo.watchId !== null);
    $('locateLabel').textContent = geo.watchId === null ? t('showMyLocation') : geo.following ? t('following') : t('recenter');
  }
  // The first time, explain why the browser is about to ask (then remember). next() runs after "Continue".
  var locNext = null, locCancel = null;
  function explainThen(next, cancel) {
    if (lsGet(STORE.locOk, false)) { next(); return; }
    var d = $('locDialog');
    if (typeof d.showModal !== 'function') { next(); return; }
    locNext = next; locCancel = cancel || null;
    d.showModal();
  }
  function requestLocation(cb) {
    if (cb) geo.onFix.push(cb);
    if (geo.watchId !== null) { if (geo.pos) flushFix(); return; }
    if (!('geolocation' in navigator)) { toast(t('locUnsupported')); return; }
    if (!isSecure()) { toast(t('locInsecure'), 6000); return; }
    explainThen(startWatch, function () { geo.onFix = []; });
  }
  function flushFix() { geo.onFix.splice(0).forEach(function (f) { f(geo.pos); }); }
  function startWatch() {
    geo.following = true;
    geo.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    updateLocateBtn();
  }
  function stopWatch() {
    if (geo.watchId !== null) navigator.geolocation.clearWatch(geo.watchId);
    geo.watchId = null; geo.following = false;
    if (geo.marker) { map.removeLayer(geo.marker); map.removeLayer(geo.circle); geo.marker = geo.circle = null; }
    updateLocateBtn();
  }
  function showMe() {
    if (!geo.marker) {
      geo.circle = L.circle(geo.pos, { radius: geo.acc, color: '#2f80ff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      geo.marker = L.marker(geo.pos, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
                                       zIndexOffset: 1000, keyboard: false }).addTo(map);
    } else {
      geo.marker.setLatLng(geo.pos);
      geo.circle.setLatLng(geo.pos).setRadius(geo.acc);
    }
    geo.marker.bindTooltip(t('youAreHere', { a: geo.acc }));
  }
  function onPos(p) {
    var first = !geo.pos;
    geo.pos = [p.coords.latitude, p.coords.longitude];
    geo.posAt = Date.now();
    geo.acc = Math.round(p.coords.accuracy || 0);
    showMe();
    if (geo.following) { if (first) map.setView(geo.pos, Math.max(map.getZoom(), 16)); else map.panTo(geo.pos, { animate: true }); }
    updateLocateBtn();
    flushFix();
  }
  function onPosErr(err) {
    if (err.code === 1) { stopWatch(); toast(t('locDenied'), 8000); geo.onFix = []; }
    else if (!geo.pos) toast(t('locUnavailable'), 5000);
  }
  // One-shot position for a mark. ok(pos) or fail() — never keeps watching.
  function oneShot(ok, fail) {
    if (geo.pos && Date.now() - geo.posAt < 60000) { ok(geo.pos.slice()); return; }
    if (!geoOk()) { fail(); return; }
    explainThen(function () {
      navigator.geolocation.getCurrentPosition(function (p) {
        geo.pos = [p.coords.latitude, p.coords.longitude]; geo.posAt = Date.now(); geo.acc = Math.round(p.coords.accuracy || 0);
        ok(geo.pos.slice());
      }, function () { fail(); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    }, fail);
  }
  map.on('dragstart', function () { if (geo.following) { geo.following = false; updateLocateBtn(); } });
  $('locateBtn').addEventListener('click', function () {
    if (geo.watchId === null) { requestLocation(); return; }
    if (geo.following) { stopWatch(); toast(t('locStopped')); return; }
    geo.following = true;
    if (geo.pos) map.setView(geo.pos, Math.max(map.getZoom(), 16));
    updateLocateBtn();
  });
  $('locYes').addEventListener('click', function () {
    lsSet(STORE.locOk, true); $('locDialog').close();
    var n = locNext; locNext = locCancel = null;
    if (n) n();
  });
  $('locNo').addEventListener('click', function () {
    $('locDialog').close();
    var c = locCancel; locNext = locCancel = null;
    if (c) c();
  });

  // ==== map tap modes ====
  var mode = null; // 'start' | 'mark' | 'suggest' | null
  var MODE_TEXT = { start: 'tapForStart', mark: 'tapForMark', suggest: 'tapForSuggest', decor: 'decorTapMap', fav: 'favTapMap' };
  function setMode(m) {
    mode = m;
    $('modeBanner').hidden = !m;
    if (m) { $('modeText').textContent = t(MODE_TEXT[m]); if (narrow()) setSheetOpen(false); }
    map.getContainer().style.cursor = m ? 'crosshair' : '';
  }
  $('modeCancel').addEventListener('click', function () { var was = mode; setMode(null); if (was === 'start') openTab('route'); });
  function handleMapTap(ll) {
    var m = mode;
    if (!m) return false;
    setMode(null);
    if (m === 'start') { setStart([ll.lat, ll.lng], 'map'); openTab('route'); }
    if (m === 'mark') doMark([ll.lat, ll.lng]);
    if (m === 'suggest') openSuggest([ll.lat, ll.lng]);
    if (m === 'decor') pendDecor([ll.lat, ll.lng]);
    if (m === 'fav') openFavForm([ll.lat, ll.lng]);
    return true;
  }
  map.on('click', function (e) { handleMapTap(e.latlng); });
  // An open popup gets the top-right corner: the purple decor button steps aside until it closes.
  map.on('popupopen', function () { map.getContainer().parentNode.classList.add('popup-open'); });
  map.on('popupclose', function () { map.getContainer().parentNode.classList.remove('popup-open'); });

  // ==== MARK IT! ====
  var markHist = LIB.pruneHistory(lsGet(STORE.markHist, []), Date.now());
  var lastMark = null;   // { id, token, tags }
  function waitText(ms) { return Math.max(1, Math.ceil(ms / 60000)); }
  function startMark() {
    map.closePopup();
    if (narrow()) setSheetOpen(false);
    var pre = LIB.markRate(markHist, null, Date.now());           // device limit can be checked before we know the spot
    if (!pre.ok) { openRateCard('device', pre.waitMs); return; }
    var btn = $('markBtn');
    btn.classList.add('busy');
    oneShot(function (pos) {
      btn.classList.remove('busy');
      if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('markOutside'), 6000); setMode('mark'); return; }
      doMark(pos);
    }, function () {
      btn.classList.remove('busy');
      toast(t('tapForMark'), 4000);
      setMode('mark');
    });
  }
  function doMark(pos) {
    if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('markOutside'), 6000); return; }
    var now = Date.now(), cell = grid.cell(pos[0], pos[1]);
    var r = LIB.markRate(markHist, cell, now);
    if (!r.ok) { openRateCard(r.reason, r.waitMs); return; }
    var before = zoneCount(cell);
    var s = LIB.nextSession(lsGet(STORE.session, null), now);
    lsSet(STORE.session, s);
    var token = LIB.randomHex(40);
    backend.sendMark({ session: s.id, lat: pos[0], lng: pos[1], tags: [] }, token, grid.cell).then(function (res) {
      markHist = LIB.pruneHistory(markHist.concat({ t: now, cell: cell, id: res.id }), now);
      lsSet(STORE.markHist, markHist);
      lastMark = { id: res.id, token: token, tags: [], at: now };
      lsSet(STORE.markHint, true);
      var mm = markMode(), badge = null;
      if (mm !== 'practice') {                         // badges count shared streets only (practice marks are not shared)
        var prevN = sharedCount();
        lsSet(sharedKey(), prevN + 1);
        badge = LIB.newBadge(prevN, prevN + 1);
        renderSharedChip();
      }
      celebrate();
      buzz();
      SFX.play('boo');                                 // soft playful ghost; a new badge adds a tiny fanfare
      if (badge) SFX.play('fanfare', 700);
      hideNudge();
      openMarkCard({ mode: mm, badge: badge });
      renderMine();
      refreshZones().then(function () { showProgress(mm, cell, before); });
    }, function (e) {
      if (e && e.code === 'rate') openRateCard('device', 5 * 60000);
      else toast(errText(e), 6000);
    });
  }
  // ---- value feedback (honest: real counts only, never invented viewers)
  function zoneCount(cell) {
    var z = data.zones.filter(function (x) { return x.cell === cell; })[0];
    return z ? z.count : null;
  }
  // Below 3 the server never tells anyone the count (privacy floor). Only marks stored on this phone can be counted
  // exactly: demo, practice, local or offline mode.
  function exactLocalCount(cell) {
    var cut = Date.now() - LIB.clampWindow(CFG.markWindowMin) * 60000;
    return backend.local._prune().filter(function (m) { return m.cell === cell && m.createdAt > cut; }).length;
  }
  function showProgress(mm, cell, before) {
    if ($('markCard').hidden || $('markCard').dataset.kind !== 'shared') return;
    var p = $('markCardProg');
    if (mm === 'practice') { p.textContent = t('progPractice'); return; }
    var exact = backend.mode !== 'supabase', after = zoneCount(cell);
    if (after == null && exact) after = exactLocalCount(cell);
    var pr = LIB.markProgress(before, after, exact), txt;
    if (pr.kind === 'lit') {
      txt = t('progLit', { k: pr.k, bucket: t(BUCKET_KEY[pr.bucket]), icon: LIB.BUCKET_ICON[pr.bucket] });
      if (pr.crossed) txt += ' ' + t('crossed_' + pr.crossed);
      p.classList.toggle('mc-crossed', !!pr.crossed);
      if (pr.crossed) celebrate();
    } else if (pr.kind === 'need') txt = pr.n === 1 ? t('progNeed1') : t('progNeed', { n: pr.n });
    else txt = t('progNeedSome');
    if (mm === 'test') txt += ' ' + t('progTest');
    p.textContent = txt;
    p.dataset.kind = pr.kind + (pr.crossed ? '-' + pr.crossed : '');
  }
  function buzz() {                                    // short buzz on Android (iPhone Safari has no vibrate); only after a real tap
    try { var ua = navigator.userActivation; if (navigator.vibrate && !REDUCED && (!ua || ua.hasBeenActive)) navigator.vibrate([30, 40, 60]); } catch (e) { /* not supported */ }
  }
  // v15: thank-you / rate cards no longer close by themselves (a shrinking bar that stops when touched looked like a bug):
  // they close with Done, ✕ or a tap outside. Only the decoration card that SHARES by itself after 8 s keeps a timer, with
  // words: "Shares in 5 s", and "⏸ Paused" + a dimmed bar while a finger / mouse / focus is on it (resumes with ≥ 2.5 s left).
  var CARD_MS = 8000;
  var cardT = { onEnd: null, ms: 0, left: 0, end: 0, paused: false, holds: 0 };
  function cardBar(frac, ms) {
    var bar = $('markCardBar');
    bar.style.transition = 'none'; bar.style.width = (frac * 100).toFixed(2) + '%'; void bar.offsetWidth;
    if (ms) { bar.style.transition = 'width ' + ms + 'ms linear'; bar.style.width = '0%'; }
  }
  function runCardTimer() {
    clearTimeout(openMarkCard.timer);
    cardT.paused = false; cardT.end = Date.now() + cardT.left;
    cardBar(cardT.left / cardT.ms, cardT.left);
    $('markCard').dataset.timer = 'running';
    openMarkCard.timer = setTimeout(function () { cardT.onEnd(); }, cardT.left);
    cardLabel();
  }
  function cardLabel() {
    clearInterval(cardLabel.iv);
    var lbl = $('markCardTimer');
    if (cardT.paused) { lbl.textContent = t('cardPaused'); return; }
    var tick = function () { lbl.textContent = t('cardSharesIn', { s: Math.max(1, Math.ceil((cardT.end - Date.now()) / 1000)) }); };
    tick(); cardLabel.iv = setInterval(tick, 250);
  }
  function stillCard() {                               // v15: no auto-close, no bar
    clearTimeout(openMarkCard.timer); clearInterval(cardLabel.iv);
    cardT.onEnd = null; cardT.paused = false;
    $('markCard').dataset.timer = 'off';
  }
  function armCardTimer(onEnd, ms) {
    cardT.onEnd = onEnd || closeMarkCard; cardT.ms = cardT.left = ms || CARD_MS; cardT.holds = 0;
    runCardTimer();
  }
  function pauseCard() {
    if ($('markCard').hidden || cardT.paused || !cardT.onEnd) return;
    clearTimeout(openMarkCard.timer);
    cardT.paused = true; cardT.left = Math.max(0, cardT.end - Date.now());
    cardBar(cardT.left / cardT.ms, 0);
    $('markCard').dataset.timer = 'paused';
    cardLabel();
  }
  function resumeCard() {
    if ($('markCard').hidden || !cardT.paused) return;
    cardT.left = Math.max(cardT.left, 2500);
    runCardTimer();
  }
  function openMarkCard(o) {
    var card = $('markCard');
    card.dataset.kind = 'shared';
    $('markCardTitle').textContent = t('markedTitle');
    $('markCardText').textContent = t('markedThanks');
    $('markCardProg').textContent = '…'; $('markCardProg').className = 'mc-prog'; delete $('markCardProg').dataset.kind;
    var b = $('markCardBadge');
    b.hidden = !o.badge;
    if (o.badge) b.textContent = t('badgeNew', { icon: o.badge.icon, name: t(o.badge.key) });
    $('markCardTags').hidden = false;
    $('markCardDone').textContent = t('done');
    renderTagRow();
    card.hidden = false;
    stillCard();                                     // v15: stays until Done / ✕ / a tap outside
  }
  function openRateCard(reason, waitMs) {
    var card = $('markCard');
    card.dataset.kind = 'rate';
    $('markCardTitle').textContent = t('rateTitle');
    $('markCardText').textContent = reason === 'zone' ? t('rateZoneFriendly') : t('rateDeviceFriendly', { m: waitText(waitMs) });
    $('markCardProg').textContent = ''; $('markCardBadge').hidden = true; $('markCardTags').hidden = true;
    $('markCardDone').textContent = t('done');
    card.hidden = false;
    stillCard();
  }
  function closeMarkCard() { $('markCard').hidden = true; clearTimeout(openMarkCard.timer); clearInterval(cardLabel.iv); cardT.onEnd = null; cardT.paused = false; pendingDecor = null; }
  (function () {
    var card = $('markCard'), inCard = function (e) { return !e.target.closest('#markCardDone, #markCardClose'); };
    card.addEventListener('pointerdown', function (e) { if (inCard(e)) pauseCard(); });
    card.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') pauseCard(); });
    card.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') resumeCard(); });
    document.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') setTimeout(resumeCard, 0); });
    document.addEventListener('pointercancel', function () { setTimeout(resumeCard, 0); });
    card.addEventListener('focusin', function (e) { if (e.target.closest('.tagbtn')) pauseCard(); });
    card.addEventListener('focusout', function (e) { if (!card.contains(e.relatedTarget)) resumeCard(); });
    document.addEventListener('pointerdown', function (e) {   // v15: a tap outside closes a card that has no timer
      if (card.hidden || card.dataset.timer !== 'off' || card.contains(e.target)) return;
      closeMarkCard();
    });
  })();

  // ---- personal badges (this phone only; demo keeps its own count)
  function sharedKey() { return STORE.shared + (DEMO ? '.demo' : ''); }
  function sharedCount() { var n = Number(lsGet(sharedKey(), 0)); return n > 0 ? Math.floor(n) : 0; }
  function renderSharedChip() {
    var n = sharedCount(), c = $('sharedChip'), b = LIB.badgeFor(n);
    c.hidden = !n;
    if (!n) return;
    c.textContent = n === 1 ? t('sharedChip1', { icon: b.icon }) : t('sharedChip', { icon: b.icon, n: n });
    c.setAttribute('aria-label', t('sharedChipAria') + ': ' + n);
  }
  $('sharedChip').addEventListener('click', function () {
    var n = sharedCount(), b = LIB.badgeFor(n);
    if (b) toast(t('sharedWhy', { icon: b.icon, name: t(b.key), n: n }), 7000);
  });

  // ---- gentle hint while waiting at the curb (in-app only, no push, no extra location)
  var lastNudgeAt = 0;
  function lastMarkAt() { return markHist.concat(decorHist).reduce(function (m, h) { return Math.max(m, h.t); }, 0); }
  function checkNudge(force) {
    if (document.visibilityState !== 'visible' || tour && tour.state().active) return;
    if (!$('markCard').hidden || !$('phaseCard').hidden || !$('guide').hidden || !$('langPick').hidden) return;
    var mm = markMode();
    if (mm === 'demo' && !FLAGS.nudge) return;
    if (!force && !LIB.shouldNudge(mm, lastMarkAt(), lastNudgeAt, Date.now())) return;
    lastNudgeAt = Date.now();
    $('nudge').textContent = t(bigIsDecor() ? 'nudgeDecor' : 'nudge'); $('nudge').hidden = false;
    $('markBtn').classList.add('nudging');
    clearTimeout(checkNudge.timer);
    checkNudge.timer = setTimeout(hideNudge, 9000);
  }
  function hideNudge() { $('nudge').hidden = true; $('markBtn').classList.remove('nudging'); }
  setInterval(function () { checkNudge(false); }, 60000);
  function renderTagRow() {
    var row = $('tagRow'), kind = $('markCard').dataset.kind;
    row.textContent = '';
    document.querySelector('#markCardTags .mc-label').textContent = t(kind === 'decorPending' ? 'decorTagsAsk' : 'tagsAsk');
    row.classList.toggle('tagrow-4', kind === 'decorPending');
    if (kind === 'decorPending') { renderDecorTags(row); return; }
    LIB.MARK_TAGS.forEach(function (tag) {
      var on = !!(lastMark && lastMark.tags.indexOf(tag) >= 0);
      row.appendChild(el('button', { type: 'button', class: 'tagbtn', 'aria-pressed': String(on), 'data-tag': tag, onclick: function () { addTag(tag); } },
        [el('span', { class: 'tg-i', text: LIB.TAG_ICON[tag] }), t('tag_' + tag)]));
    });
  }
  function addTag(tag) {
    if (!lastMark || lastMark.tags.indexOf(tag) >= 0) return;
    lastMark.tags.push(tag);
    renderTagRow();
    backend.tagMark(lastMark.id, lastMark.token, tag).then(function () { refreshZones(); },
      function (e) { lastMark.tags = lastMark.tags.filter(function (x) { return x !== tag; }); renderTagRow(); toast(errText(e)); });
  }
  $('markCardDone').addEventListener('click', function () { if ($('markCard').dataset.kind === 'decorPending') sendPendingDecor(); else closeMarkCard(); });
  $('markCardClose').addEventListener('click', closeMarkCard);
  $('markBtn').addEventListener('click', function () { if (bigIsDecor()) startDecor(); else startMark(); });
  // Small celebration: CSS particles (none with prefers-reduced-motion).
  var celebrations = 0;
  function celebrate() {
    var b = $('markBtn');
    celebrations++;
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (REDUCED) return;
    var box = $('burst'), r = b.getBoundingClientRect(), w = $('burst').parentNode.getBoundingClientRect();
    box.textContent = '';
    box.style.left = (r.left - w.left + r.width / 2) + 'px';
    box.style.top = (r.top - w.top + r.height / 2) + 'px';
    var glyphs = ['✨', '🍬', '🎃', '⭐', '🍭', '👻'];
    for (var i = 0; i < 14; i++) {
      var ang = (i / 14) * Math.PI * 2, d = 70 + (i % 3) * 30;
      box.appendChild(el('span', { class: 'bp', text: glyphs[i % glyphs.length],
        style: '--dx:' + Math.round(Math.cos(ang) * d) + 'px;--dy:' + Math.round(Math.sin(ang) * d - 40) + 'px;animation-delay:' + (i % 4) * 30 + 'ms' }));
    }
    clearTimeout(celebrate.timer);
    celebrate.timer = setTimeout(function () { box.textContent = ''; }, 1400);
  }
  // My own marks (this phone): a small sparkle at the hexagon centre. Never sent anywhere.
  function renderMine() {
    mineLayer.clearLayers();
    var now = Date.now();
    markHist.forEach(function (h) {
      if (now - h.t > CFG.markWindowMin * 60000 || !isCell(h.cell)) return;
      L.marker(grid.center(h.cell), { interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: '<div class="mine-spark">✨</div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(mineLayer);
    });
  }

  // ==== v11: Best decorations / 最佳装饰 (pre-Halloween layer) ====
  // One tap on "Cool decorations here! 🎃" opens a short card: optional tags, then it shares by itself after ~8 s
  // (or at once with "Share now"; ✕ cancels). Zone level only: blurred ~50 m, the hexagon shows at 3+ marks.
  var DECOR_PEND_MS = 8000;
  var decorHist = (lsGet(STORE.decorHist, []) || []).filter(function (h) { return Date.now() - h.t < LIB.DECOR_KEEP_MS; });
  var pendingDecor = null;   // { pos, cell, tags }
  // ---- v13: two phases. Until Oct 31 3 PM the BIG button is the purple decor button and the fun-street mark is a small
  // orange "practice / test" pill; from Oct 31 3 PM the big button is the orange fun-street button and decor is the pill.
  function phaseNow() { return Date.now() + (NOW_OFFSET || 0); }           // ?now= previews a phase (display only)
  function bigIsDecor() { return !tourZones && LIB.appPhase(phaseNow()) === 'decor' && LIB.isDecorOpen(phaseNow(), DEMO); }
  function renderPhase() {
    var ph = LIB.appPhase(phaseNow()), test = markMode() === 'test', dec = bigIsDecor();
    var line = ph === 'decor' ? t(favOn() ? 'phasePreFav' : 'phasePre') : ph === 'night' ? t('phaseOn') : '';
    $('phaseBanner').hidden = !line;                     // v15: one short line; test days live in the 🧪 chip
    $('phaseBanner').dataset.phase = ph;
    $('phaseLine').textContent = line; $('phaseLine').hidden = !line;
    var b = $('markBtn');
    b.classList.toggle('mb-decor', dec);
    document.querySelector('.tab-mark').classList.toggle('tab-decor', dec);
    if (renderPhase.dec !== dec) { var first = renderPhase.dec === undefined; renderPhase.dec = dec; if (!first) renderLayerBar(); }   // 3 PM Oct 31: main chips swap   // v15: the Mark tab wears the big button's colour
    b.querySelector('.mb-icon').textContent = dec ? '🎃' : '✨';
    $('mbMain').textContent = dec ? t('decorMain') : t('markBtn');
    $('mbSub').textContent = dec ? t('decorSub') : t('markSub');
    var alt = $('altBtn'), decorOpen = LIB.isDecorOpen(Date.now(), DEMO);
    alt.classList.toggle('fab-fun', dec);
    $('altLabel').textContent = dec ? t(test ? 'altFunTest' : 'altFunPractice') : t('decorBtn');
    alt.hidden = !!tourZones || (!dec && !decorOpen);
    b.dataset.tipKey = dec ? 'tip_markDecor' : 'tip_markFun';
    alt.dataset.tipKey = dec ? 'tip_altFun' : 'tip_altDecor';
    $('decorPanelBtn').disabled = !decorOpen;
  }
  function renderDecorBtn() { renderPhase(); }
  // The banner links to the "What's different on Oct 31" section: a jump button before Halloween, opened right there on the night.
  // v15: 4 one-line bullets; the longer explanation sits behind "More details" (opened at the Oct 31 section on the night).
  function openPhaseCard() {
    var list = $('phaseList'), win = String(CFG.markWindowMin || 45), bl = $('phaseBullets');
    list.textContent = ''; bl.textContent = '';
    t('phaseBullets').forEach(function (x, i) { if (i !== 1 || favOn()) bl.appendChild(el('li', { text: x })); });
    var items = t('phaseItems').slice(), oct31 = items[1][0];
    if (favOn()) {                                      // v14: the past-years board, and what it does on Oct 31
      items[1] = [items[1][0], items[1][1].concat(t('phaseOct31Fav'))];
      items.splice(1, 0, t('phaseFavItem'));
    }
    items.forEach(function (it) {
      var body = Array.isArray(it[1]) ? el('ul', null, it[1].map(function (x) { return el('li', { text: x.replace('{win}', win) }); })) : document.createTextNode(it[1]);
      list.appendChild(el('dt', { id: it[0] === oct31 ? 'phaseOct31' : null, text: it[0] }));
      list.appendChild(el('dd', null, [body]));
    });
    $('phaseDecor').hidden = !LIB.decorVisible(Date.now(), DEMO);
    $('phaseFav').hidden = true;                        // v15: one primary action here; Past favourites is a layer chip
    closeMarkCard();
    $('phaseCard').hidden = false;
    $('phaseOk').focus();
    var night = LIB.appPhase(phaseNow()) !== 'decor';
    $('phaseMore').open = night;
    if (night) jumpOct31(); else $('phaseCard').scrollTop = 0;
  }
  function jumpOct31() {
    var h = $('phaseOct31'); if (!h) return;
    $('phaseMore').open = true;
    $('phaseCard').scrollTop = h.offsetTop - 8;
    h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash');
  }
  function closePhaseCard() { $('phaseCard').hidden = true; }
  $('phaseOk').addEventListener('click', closePhaseCard);
  $('phaseClose').addEventListener('click', closePhaseCard);
  $('phaseDecor').addEventListener('click', function () { closePhaseCard(); openTab('decor'); });
  function startDecor() {
    map.closePopup();
    if (!LIB.isDecorOpen(Date.now(), DEMO)) { toast(t('decorClosed'), 6000); return; }
    if (narrow()) setSheetOpen(false);
    var btn = bigIsDecor() ? $('markBtn') : $('altBtn');
    btn.classList.add('busy');
    oneShot(function (pos) {
      btn.classList.remove('busy');
      if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('markOutside'), 6000); setMode('decor'); return; }
      pendDecor(pos);
    }, function () {
      btn.classList.remove('busy');
      toast(t('decorTapMap'), 4000);
      setMode('decor');
    });
  }
  function openDecorRate(reason) {
    var card = $('markCard');
    card.dataset.kind = 'rate';
    $('markCardTitle').textContent = t('rateTitle');
    $('markCardText').textContent = t(reason === 'day' ? 'decorRateDay' : 'decorRateZone');
    $('markCardProg').textContent = ''; $('markCardBadge').hidden = true; $('markCardTags').hidden = true;
    $('markCardDone').textContent = t('done');
    card.hidden = false;
    stillCard();
  }
  function pendDecor(pos) {
    if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('markOutside'), 6000); return; }
    var now = Date.now(), cell = grid.cell(pos[0], pos[1]), r = LIB.decorRate(decorHist, cell, now);
    if (!r.ok) { openDecorRate(r.reason); return; }
    pendingDecor = { pos: pos, cell: cell, tags: [] };
    var card = $('markCard');
    card.dataset.kind = 'decorPending';
    $('markCardTitle').textContent = t('decorPendTitle');
    $('markCardText').textContent = t('decorPending');
    $('markCardProg').textContent = ''; $('markCardProg').className = 'mc-prog'; $('markCardBadge').hidden = true;
    $('markCardTags').hidden = false;
    $('markCardDone').textContent = t('decorShareNow');
    renderTagRow();
    card.hidden = false;
    armCardTimer(sendPendingDecor, DECOR_PEND_MS);
  }
  function renderDecorTags(row) {
    LIB.DECOR_TAGS.forEach(function (tag) {
      var on = !!(pendingDecor && pendingDecor.tags.indexOf(tag) >= 0);
      row.appendChild(el('button', { type: 'button', class: 'tagbtn tagbtn-decor', 'aria-pressed': String(on), 'data-tag': tag, onclick: function () {
        if (!pendingDecor) return;
        var i = pendingDecor.tags.indexOf(tag);
        if (i >= 0) pendingDecor.tags.splice(i, 1); else pendingDecor.tags.push(tag);
        renderTagRow();                                      // the timer is paused while the finger is down, then resumes
      } }, [el('span', { class: 'tg-i', text: LIB.DECOR_ICON[tag] }), t('dtag_' + tag)]));
    });
  }
  function decorCount(cell) { var z = data.decorZones.filter(function (x) { return x.cell === cell; })[0]; return z ? z.count : null; }
  function sendPendingDecor() {
    var d = pendingDecor;
    if (!d || $('markCard').dataset.kind !== 'decorPending') return;
    pendingDecor = null;
    clearTimeout(openMarkCard.timer);
    var now = Date.now(), before = decorCount(d.cell);
    $('markCardDone').disabled = true;
    backend.sendDecor({ device: DEVICE, lat: d.pos[0], lng: d.pos[1], tags: d.tags }, grid.cell).then(function () {
      $('markCardDone').disabled = false;
      decorHist = decorHist.concat({ t: now, cell: d.cell }).filter(function (h) { return now - h.t < LIB.DECOR_KEEP_MS; }).slice(-60);
      lsSet(STORE.decorHist, decorHist);
      var card = $('markCard');
      card.dataset.kind = 'decor';
      $('markCardTitle').textContent = t('markedTitle');
      $('markCardText').textContent = t('decorThanks');
      $('markCardProg').textContent = '…';
      $('markCardTags').hidden = true;
      $('markCardDone').textContent = t('done');
      celebrate(); buzz(); SFX.play('twinkle');
      stillCard();
      refreshDecor().then(function () { showDecorProgress(d.cell, before); });
    }, function (e) {
      $('markCardDone').disabled = false;
      if (e && e.code === 'rate') { openDecorRate('zone'); return; }
      closeMarkCard();
      toast(e && e.code === 'closed' ? t('decorClosed') : errText(e), 6000);
    });
  }
  function showDecorProgress(cell, before) {
    if ($('markCard').hidden || $('markCard').dataset.kind !== 'decor') return;
    var p = $('markCardProg');
    if (!backend.decorShared() && !DEMO) { p.textContent = t('decorLocal'); p.dataset.kind = 'local'; return; }
    var exact = backend.mode !== 'supabase', after = decorCount(cell);
    if (after == null && exact) after = backend.local.decorCountIn(cell);
    var pr = LIB.markProgress(before, after, exact), txt;
    if (pr.kind === 'lit') {
      txt = t('decorProgLit', { k: pr.k });
      var crossed = pr.k === LIB.MIN_ZONE && (before == null || before < LIB.MIN_ZONE);
      if (crossed) { txt += (lang === 'zh' ? '' : ' ') + t('decorCrossed'); celebrate(); }
      p.classList.toggle('mc-crossed', crossed);
      p.dataset.kind = 'lit' + (crossed ? '-crossed' : '');
    } else {
      txt = pr.kind === 'need' ? (pr.n === 1 ? t('decorProgNeed1') : t('decorProgNeed', { n: pr.n })) : t('decorProgNeedSome');
      p.dataset.kind = pr.kind;
    }
    p.textContent = txt;
  }
  function refreshDecor() {
    if (!decorLayerShown()) { data.decorZones = []; if (decorLayer) decorLayer.setData([]); return Promise.resolve(); }
    return backend.listDecor(grid.cell).then(function (zones) {
      data.decorZones = zones.filter(function (z) { return isCell(z.cell); });
      if (decorLayer && !tourZones) decorLayer.setData(data.decorZones);
      if (currentTab === 'decor' && $('sheet').dataset.open === 'true') renderDecorList();
    }, function () { /* keep last */ });
  }
  function decorBadgeHtml(z, compact) {
    // Only numbers and our own strings (no user text).
    return '<div class="zbadge zb-decor' + (compact ? ' zb-compact' : '') + '"><span class="mono-num">' +
      (compact ? '🎃 ' + z.count : t('decorBadge', { n: z.count })) + '</span>' + (z.topTag ? '<i>' + LIB.DECOR_ICON[z.topTag] + '</i>' : '') + '</div>';
  }
  function decorPopup(z, ll) {
    if (mode) { handleMapTap(ll); return; }
    var c = grid.center(z.cell);
    L.popup({ maxWidth: 260, autoPanPaddingTopLeft: POP_TL, autoPanPaddingBottomRight: POP_BR }).setLatLng(ll).setContent(el('div', { class: 'pop' }, [
      el('div', { class: 'pop-title', text: t('decorZoneTitle') }),
      el('div', { class: 'mono-num', text: t('decorInfo', { n: z.count }) }),
      z.topTag ? el('div', { text: LIB.DECOR_ICON[z.topTag] + ' ' + t('dtag_' + z.topTag) }) : null,
      el('div', { class: 'row row-tight' }, [
        el('button', { class: 'btn btn-primary btn-small', type: 'button', text: t('routeThere'), onclick: function () { map.closePopup(); routeToZone(z, c); } }),
        el('button', { class: 'btn btn-small', type: 'button', text: t('decorListBtn'), onclick: function () { map.closePopup(); openTab('decor'); } })
      ])
    ])).openOn(map);
  }
  function decorRow(z, nc) {
    var c = z.center || grid.center(z.cell);
    return el('li', { class: 'near-row' }, [
      el('button', { type: 'button', class: 'near-main', onclick: function () {
        if (narrow()) setSheetOpen(false);
        map.flyTo(c, Math.max(map.getZoom(), 15), { duration: REDUCED ? 0 : 0.8 });
      } }, [
        el('i', { class: 'lg lg-decor' }),
        z.distM != null ? el('b', { class: 'mono-num', text: fmtDist(z.distM / 1000) }) : null,
        el('span', { class: 'decor-n', text: t('decorRow', { n: z.count }) + (z.topTag ? ' · ' + LIB.DECOR_ICON[z.topTag] + ' ' + t('dtag_' + z.topTag) : '') })
      ]),
      el('button', { type: 'button', class: 'btn btn-small', text: t('routeBtn'), onclick: function () { routeToZone(z, c, nc); } })
    ]);
  }
  function renderDecorList() {
    var zs = data.decorZones, nc = nearCenter(), nearL = $('decorNearList'), city = $('decorCityList');
    nearL.textContent = ''; city.textContent = '';
    var st = $('decorStatus');
    st.hidden = backend.decorShared() || DEMO;
    st.textContent = backend.decorMissing ? t('decorSoon') + ': ' + t('decorLocal') : t('decorLocal');
    if (nc.from === 'map') nearL.appendChild(el('li', { class: 'hint', text: t('decorNearNoLoc') }));
    else {
      var near2 = LIB.nearZones(zs, nc.c, 2, grid.center).slice(0, 5);
      if (!near2.length) nearL.appendChild(el('li', { class: 'hint', text: t('decorNearNone') }));
      near2.forEach(function (z) { nearL.appendChild(decorRow(z, nc)); });
    }
    if (!zs.length) city.appendChild(el('li', { class: 'hint', text: t('decorNone') }));
    zs.slice(0, 10).forEach(function (z) { city.appendChild(decorRow(z, nc.from === 'map' ? null : nc)); });
    city.dataset.count = String(zs.length);
  }
  $('altBtn').addEventListener('click', function () { if (bigIsDecor()) startMark(); else startDecor(); });
  $('decorPanelBtn').addEventListener('click', startDecor);
  $('openDecor').addEventListener('click', function () { openTab('decor'); });

  // ==== zones ====
  var BUCKET_KEY = { quiet: 'legendQuiet', lively: 'legendLively', hot: 'legendHot' };
  function badgeHtml(z, compact) {
    // Only numbers and our own strings go into this HTML (no user text). Zoomed out: just "🔥 23" so the glow stays visible.
    return '<div class="zbadge zb-' + z.bucket + (compact ? ' zb-compact' : '') + '"><span class="mono-num">' +
      (compact ? '🔥 ' + z.count : t('zoneCount', { n: z.count })) + '</span>' +
      (z.topTag ? '<i>' + LIB.TAG_ICON[z.topTag] + '</i>' : '') + (z.isNew ? '<em>' + t('newBadge') + '</em>' : '') + '</div>';
  }
  function zonePopup(z, ll) {
    if (mode) { handleMapTap(ll); return; }
    var c = grid.center(z.cell);
    L.popup({ maxWidth: 260, autoPanPaddingTopLeft: POP_TL, autoPanPaddingBottomRight: POP_BR }).setLatLng(ll).setContent(el('div', { class: 'pop' }, [
      el('div', { class: 'pop-title', text: (z.bucket === 'hot' ? '🔥 ' : z.bucket === 'lively' ? '🎉 ' : '✨ ') + t(BUCKET_KEY[z.bucket]) +
        (z.isNew ? ' · ' + t('newBadge') : '') }),
      el('div', { class: 'mono-num', text: t('zoneInfo', { n: z.count, m: CFG.markWindowMin }) }),
      z.topTag ? el('div', { text: LIB.TAG_ICON[z.topTag] + ' ' + t('tag_' + z.topTag) }) : null,
      el('div', { class: 'row row-tight' }, [
        el('button', { class: 'btn btn-primary btn-small', type: 'button', text: t('routeThere'), onclick: function () { map.closePopup(); routeToZone(z, c); } })
      ])
    ])).openOn(map);
  }
  function refreshZones() {
    return backend.listZones(CFG.markWindowMin, grid.cell).then(function (zones) {
      data.zones = zones.filter(function (z) { return isCell(z.cell); });
      data.zonesAt = Date.now();
      if (zoneLayer && !tourZones) zoneLayer.setData(data.zones);
      renderMine();
      if (currentTab === 'near' && $('sheet').dataset.open === 'true') renderNear();
    }, function () { /* keep last */ });
  }
  function refreshSuggested() {
    return backend.communitySuggested().then(function (l) { data.suggested = l; renderCommunity(); }, function () { /* keep last */ });
  }
  function computeBase() {
    if (!baseLayer) return;
    var votes = LIB.areaVoteTotals(data.posts.fun.concat(data.posts.decor));
    baseLayer.setData(LIB.planningHexes(AREAS, votes, grid, 400));
  }

  // ==== Near me ====
  var near = { km: 2 };
  segInit('radiusSeg', function (v) { near.km = Number(v); renderNear(); });
  function nearCenter() {
    if (geo.pos) return { c: geo.pos, from: 'me' };
    if (DEMO && FLAGS.near) return { c: DEMO_HOME, from: 'demo' };
    var m = map.getCenter();
    return { c: [m.lat, m.lng], from: 'map' };
  }
  function openNear() {
    openTab('near');
    if (!geo.pos && geoOk() && !(DEMO && FLAGS.near) && lsGet(STORE.locOk, false)) {
      navigator.geolocation.getCurrentPosition(function (p) {
        geo.pos = [p.coords.latitude, p.coords.longitude]; geo.posAt = Date.now(); geo.acc = Math.round(p.coords.accuracy || 0);
        renderNear();
      }, function () { /* sort from the map centre */ }, { timeout: 8000, maximumAge: 60000 });
    }
  }
  $('openNear').addEventListener('click', openNear);
  function renderNear() {
    var nc = nearCenter(), list = $('nearList');
    var rows = LIB.nearZones(data.zones, nc.c, near.km, grid.center);
    $('nearFrom').textContent = t(nc.from === 'me' ? 'nearFromMe' : nc.from === 'demo' ? 'nearFromDemo' : 'nearFromMap');
    list.textContent = '';
    if (!rows.length) list.appendChild(el('li', { class: 'hint', text: t('nearNone', { km: near.km }) }));
    rows.slice(0, 30).forEach(function (z) {
      list.appendChild(el('li', { class: 'near-row' }, [
        el('button', { type: 'button', class: 'near-main', onclick: function () {
          if (narrow()) setSheetOpen(false);
          map.flyTo(z.center, Math.max(map.getZoom(), 15), { duration: REDUCED ? 0 : 0.8 });
        } }, [
          el('i', { class: 'lg lg-' + z.bucket }),
          el('b', { class: 'mono-num', text: fmtDist(z.distM / 1000) }),
          el('span', { class: 'mono-num', text: t('zoneCount', { n: z.count }) }),
          z.topTag ? el('span', { text: LIB.TAG_ICON[z.topTag] }) : null,
          z.isNew ? el('em', { class: 'new-pill', text: t('newBadge') }) : null
        ]),
        el('button', { type: 'button', class: 'btn btn-small', text: t('routeBtn'), onclick: function () { routeToZone(z, z.center, nc); } })
      ]));
    });
    $('nearList').dataset.count = String(rows.length);
  }

  // ==== route planner ====
  var route = { start: null, startKind: null, startMarker: null, minutes: 60, age: '5-8', last: null, target: null };
  segInit('timeSeg', function (v) { route.minutes = Number(v); renderRouteHints(); });
  segInit('ageSeg', function (v) { route.age = v; renderRouteHints(); });
  // Stamina + start-time hints under the age picker (PACE above is unchanged).
  function renderRouteHints() {
    var h = LIB.staminaHint(route.age, route.minutes), box = $('routeHints');
    box.textContent = '';
    box.appendChild(el('div', { id: 'staminaHint', class: h.warn ? 'warn' : 'hint', text: (h.warn ? '⚠️ ' : '') + t(h.key) }));
    box.appendChild(el('div', { id: 'startHint', class: 'hint', text: t(LIB.startTimeHintKey(route.age)) }));
  }
  function setStart(ll, kind) {
    route.start = ll; route.startKind = kind;
    if (route.startMarker) map.removeLayer(route.startMarker);
    route.startMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="start-pin">🏁</div>', iconSize: [34, 34], iconAnchor: [17, 17] }) })
      .bindTooltip(t('startLabel')).addTo(map);
    renderStartStatus();
  }
  function renderStartStatus() {
    $('startStatus').textContent = !route.start ? t('startNotSet') : route.startKind === 'me' ? t('startMyLoc') : t('startMap');
    $('startMyLoc').classList.toggle('active', route.startKind === 'me');
    $('startTap').classList.toggle('active', route.startKind === 'map');
  }
  $('startMyLoc').addEventListener('click', function () {
    if (!geo.pos) $('startStatus').textContent = t('waitingFix');
    requestLocation(function (pos) { setStart(pos.slice(), 'me'); });
  });
  $('startTap').addEventListener('click', function () { setMode('start'); });
  function pickArea(start, age, forcedId) {
    if (forcedId === 'target' && route.target) return route.target;
    if (forcedId && forcedId !== 'auto' && AREA_BY_ID[forcedId]) return AREA_BY_ID[forcedId];
    var best = null, bestScore = -Infinity;
    AREAS.forEach(function (a) {
      var d = haversineKm(start, [a.lat, a.lng]);
      var crowdPenalty = age === 'u5' ? Math.max(0, a.s.crowd - 3) * 0.3 : 0;   // little kids: avoid the busiest areas
      var score = LIB.overall(a) - crowdPenalty - 0.35 * d;
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return best;
  }
  function targetOption() { return route.target ? { value: 'target', text: '🔥 ' + route.target.name[lang] } : null; }
  // Walk to a live zone: the zone becomes the loop's destination.
  function routeToZone(z, c, nc) {
    route.target = { id: 'target', lat: c[0], lng: c[1], r: 350,
                     name: { en: I18N.en.zoneTarget.replace('{n}', z.count), zh: I18N.zh.zoneTarget.replace('{n}', z.count) } };
    areaOptions($('areaSelect'), 'auto', t('autoArea'), true, targetOption());
    $('areaSelect').value = 'target';
    if (!route.start && nc && nc.from !== 'map') setStart(nc.c.slice(), nc.from === 'me' ? 'me' : 'map');
    if (!route.start && geo.pos) setStart(geo.pos.slice(), 'me');
    openTab('route');
    if (route.start) buildLoop(); else toast(t('needStart'));
  }
  function fetchWithTimeout(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }
  // OSRM with a real foot profile first; the public demo (car-only in practice) as backup. Called only when the user presses Build.
  function osrmRoute(wps) {
    var coords = wps.map(function (p) { return p[1].toFixed(6) + ',' + p[0].toFixed(6); }).join(';');
    var q = '?overview=full&geometries=geojson&steps=true';
    var urls = ['https://routing.openstreetmap.de/routed-foot/route/v1/foot/' + coords + q, 'https://router.project-osrm.org/route/v1/foot/' + coords + q];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error('all routers failed'));
      return fetchWithTimeout(urls[i++], 9000).then(function (j) {
        if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code || 'no route');
        return j.routes[0];
      }).catch(next);
    }
    return next();
  }
  function planForArea(id) {
    $('areaSelect').value = id;
    openTab('route');
    if (route.start) buildLoop(); else toast(t('needStart'));
  }
  var buildSeq = 0;
  function buildLoop() {
    if (!route.start) { toast(t('needStart')); return; }
    var area = pickArea(route.start, route.age, $('areaSelect').value);
    var cp = LIB.loopWaypoints(route.start, area, PACE[route.age] * route.minutes / 60, MAX_WALK_TO_AREA_KM);   // ends where it starts
    var btn = $('buildBtn'), seq = ++buildSeq;
    btn.disabled = true; btn.textContent = t('building');
    osrmRoute(cp.waypoints).then(function (r) {
      return { method: 'osrm', line: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), km: r.distance / 1000,
               steps: r.legs.reduce(function (all, leg, li) {
                 return all.concat(leg.steps.map(function (s) { s._leg = li; s._lastLeg = li === r.legs.length - 1; return s; }));
               }, []) };
    }).catch(function () {
      var km = 0;
      for (var i = 1; i < cp.waypoints.length; i++) km += haversineKm(cp.waypoints[i - 1], cp.waypoints[i]);
      return { method: 'straight', line: cp.waypoints, km: km, steps: null };
    }).then(function (res) {
      if (seq !== buildSeq) return;
      // Close the loop on the map: the router snaps to the nearest path, so join both ends to the real start (car / home).
      if (LIB.distM(res.line[0], cp.origin) > 1) res.line.unshift(cp.origin.slice());
      if (LIB.distM(res.line[res.line.length - 1], cp.origin) > 1) res.line.push(cp.origin.slice());
      res.area = area; res.cp = cp; res.age = route.age;
      route.last = res;
      drawRoute(res);
      renderRouteResult();
    }).then(function () { btn.disabled = false; btn.textContent = t('buildLoop'); });
  }
  $('buildBtn').addEventListener('click', buildLoop);
  function drawRoute(res) {
    routeLayer.clearLayers();
    var line = L.polyline(res.line, { color: '#eef2f8', weight: 5,   // v15: white route; orange = fun streets only
      opacity: 0.95, className: 'route-line', dashArray: res.method === 'straight' ? '10 10' : null }).addTo(routeLayer);
    res.cp.waypoints.slice(1, -1).forEach(function (p, i) {
      L.circleMarker(p, { radius: 9, color: '#0f1626', weight: 2, fillColor: '#eef2f8', fillOpacity: 1 })
        .bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'area-label' }).addTo(routeLayer);
    });
    if (res.cp.drive) {
      L.marker(res.cp.origin, { icon: L.divIcon({ className: '', html: '<div class="start-pin park">🅿️</div>', iconSize: [34, 34], iconAnchor: [17, 17] }) })
        .bindTooltip(t('parkLabel')).addTo(routeLayer);
    }
    focusBounds(line.getBounds());
  }
  function turnText(s) {
    var m = s.maneuver || {}, name = s.name || t('unnamed');
    if (m.type === 'depart') return s._leg === 0 ? t('depart') + ' ' + t('along', { name: name }) : null;
    if (m.type === 'arrive') return s._lastLeg ? t('arrive') : t('checkpoint', { n: s._leg + 1 }) + ' ✓';
    if (m.type === 'roundabout' || m.type === 'rotary') return t('roundabout') + ' → ' + name;
    return (t('mod')[m.modifier] || t('mod').straight) + ' ' + t('onto', { name: name });
  }
  function renderRouteResult() {
    var res = route.last, box = $('routeResult');
    box.textContent = '';
    if (!res) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('div', { class: 'stats' }, [
      el('div', { class: 'stat' }, [el('small', { text: t('resArea') }), el('b', { text: res.area.name[lang] })]),
      el('div', { class: 'stat' }, [el('small', { text: t('resDistance') }), el('b', { class: 'mono-num', text: fmtDist(res.km) })]),
      el('div', { class: 'stat' }, [el('small', { text: t('resTime') }),
        el('b', { class: 'mono-num', text: '≈ ' + fmtMin(res.km / PACE[res.age] * 60) }), el('small', { text: t('inclStops') })]),
      el('div', { class: 'stat' }, [el('small', { text: t('resHouses') }), el('b', { id: 'housesEst', class: 'mono-num', text: t('housesEst', { n: LIB.estimateHouses(res.km) }) })])
    ]));
    box.appendChild(el('p', { class: 'hint loop-note', text: (res.cp.drive ? '🅿️ ' : '🏁 ') + t('startFinish') }));
    if (res.cp.drive) box.appendChild(el('div', { class: 'warn', text: t('driveNote', { d: fmtDist(res.cp.dStart) }) }));
    box.appendChild(el('p', { class: 'hint', text: res.method === 'osrm' ? t('methodOsrm') : t('methodStraight') }));
    box.appendChild(el('div', { class: 'label', text: t('turnList') }));
    var ol = el('ol', { class: 'turns' });
    if (res.method === 'osrm') {
      var items = [];   // sidewalks are mostly unnamed in OSM: merge runs of unnamed steps
      res.steps.forEach(function (s) {
        var txt = turnText(s);
        if (!txt) return;
        var type = (s.maneuver || {}).type, plain = !s.name && type !== 'depart' && type !== 'arrive', prev = items[items.length - 1];
        if (plain && prev && prev.plain) { prev.dist += s.distance; prev.txt = t('followPath'); return; }
        items.push({ txt: txt, dist: s.distance, plain: plain });
      });
      items.forEach(function (it) { ol.appendChild(el('li', null, [it.txt + ' ', it.dist > 0 ? el('small', { text: '(' + fmtDist(it.dist / 1000) + ')' }) : null])); });
    } else {
      var w = res.cp.waypoints;
      for (var i = 1; i < w.length; i++) {
        var dir = dirName(bearingDeg(w[i - 1], w[i]));
        ol.appendChild(el('li', null, [(i === w.length - 1 ? t('headBack', { dir: dir }) : t('headTo', { dir: dir, n: i })) + ' ',
          el('small', { text: '(' + fmtDist(haversineKm(w[i - 1], w[i])) + ')' })]));
      }
    }
    box.appendChild(ol);
    box.appendChild(el('button', { class: 'btn btn-block', type: 'button', text: t('clearRoute'), onclick: function () {
      route.last = null; routeLayer.clearLayers(); renderRouteResult();
    } }));
  }

  // ==== Suggest an area ====
  var suggestHist = lsGet(STORE.suggestHist, []), pendingSuggest = null;
  $('suggestBtn').addEventListener('click', function () { setMode('suggest'); });
  function openSuggest(pos) {
    if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('err_outside')); return; }
    var cell = grid.cell(pos[0], pos[1]), r = LIB.suggestRate(suggestHist, cell, Date.now());
    if (!r.ok) { toast(t(r.reason === 'hex' ? 'suggestRateHex' : 'suggestRateDay'), 6000); return; }
    pendingSuggest = { cell: cell, center: grid.center(cell) };   // blurred to the hexagon: only its centre is sent
    $('suggestReason').value = '';
    showErr('suggestErr', '');
    updateCount('suggestReason', 'suggestCount', 80);
    $('suggestDialog').showModal();
  }
  $('suggestReason').addEventListener('input', function () { updateCount('suggestReason', 'suggestCount', 80); showErr('suggestErr', ''); });
  $('suggestCancel').addEventListener('click', function () { $('suggestDialog').close(); pendingSuggest = null; });
  $('suggestSend').addEventListener('click', function () {
    if (!pendingSuggest) return;
    var chk = LIB.checkReason($('suggestReason').value);
    if (!chk.ok) { showErr('suggestErr', t('err_' + chk.error + (chk.error === 'tooLong' ? '80' : ''))); return; }
    var ps = pendingSuggest, btn = $('suggestSend');
    btn.disabled = true;
    backend.suggestArea({ device: DEVICE, cell: ps.cell, lat: LIB.round(ps.center[0], 4), lng: LIB.round(ps.center[1], 4), reason: chk.text })
      .then(function () {
        suggestHist = suggestHist.concat({ t: Date.now(), cell: ps.cell });
        lsSet(STORE.suggestHist, suggestHist);
        $('suggestDialog').close(); pendingSuggest = null;
        toast(t('suggested'), 6000);
        return refreshSuggested();
      }, function (e) { showErr('suggestErr', e && e.code === 'rate' ? t('suggestRateDay') : errText(e)); })
      .then(function () { btn.disabled = false; });
  });

  // ==== v14: "Best streets from past years / 往年最佳街区" board ====
  // Speech bubbles on streets (snapped to ~50 m, never a house). Hidden until the server has the board (v14_board.sql):
  // favReady turns true only after the first list call succeeds, so a missing server never flashes anything.
  var favPins = [], favReady = false, pendingFav = null, favTag = null, giftI = 0;
  var favTokens = lsGet(STORE.favTokens, {}), favReportedMine = lsGet(STORE.favReports, {});
  function favOn() { return favReady && backend.favAvailable() && LIB.favVisible(Date.now(), DEMO); }
  function favTonightNow() { return LIB.favTonight(phaseNow(), CFG); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function trunc(s, n) { var a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); }
  function favZone(p) { var c = grid.cell(p.lat, p.lng); return (tourZones || data.zones).filter(function (z) { return z.cell === c; })[0] || null; }
  function giftToast() { var m = t('giftToasts'); toast(m[giftI++ % m.length], 1800); }
  function favErrText(e, max) {
    var c = (e && e.code) || '';
    if (c === 'rate') return t('favRate');
    if (c === 'closed') return t('favClosed');
    if (c === 'text:tooLong') return t('err_tooLong' + (max || 80));
    return errText(e);
  }
  function favBubbleHtml(p, tonight, full) {
    // User text is escaped; everything else is our own strings and numbers.
    var line2, z = tonight ? favZone(p) : null;
    if (tonight) line2 = (p.families ? '🏆 ' + p.families + ' · ' : '') + (z ? '🔥 ' + esc(t('favBubbleNow', { n: z.count })) : '🔥 ' + esc(t('favBubbleAsk')));
    else line2 = '👍 ' + (p.likes || 0) + ' ❤️ ' + (p.hearts || 0);
    if (!full) {   // v14 tidy: zoomed out = one small pill (tag icon + likes), no scaling, so it never covers the zone badges
      return '<div class="favb favb-mini' + (tonight ? ' favb-night' : '') + (favTokens[p.id] ? ' favb-mine' : '') + '"><div class="fb-l1"><i>' + LIB.FAV_ICON[p.tag] + '</i>' +
        '<b class="mono-num">' + ((p.likes || 0) + (p.hearts || 0)) + '</b></div></div>';
    }
    return '<div class="favb' + (tonight ? ' favb-night' : '') + (favTokens[p.id] ? ' favb-mine' : '') + '" style="--s:' + LIB.favScale(p.likes, p.hearts) + '">' +
      '<div class="fb-l1"><i>' + LIB.FAV_ICON[p.tag] + '</i>' + (full && p.body ? '<span class="fb-t">' + esc(trunc(p.body, 24)) + '</span>' : '') + '</div>' +
      '<div class="fb-l2 mono-num">' + line2 + '</div></div>';
  }
  function renderFavLayer() {
    favLayer.clearLayers();
    if (!favOn() || tourZones) return;
    var zm = map.getZoom(), tonight = favTonightNow(), full = zm >= 15;
    var groups = full ? favPins.map(function (p) { return { pins: [p], lat: p.lat, lng: p.lng }; })
      : LIB.clusterFav(favPins, function (la, ln) { return map.project([la, ln], zm); }, 72);
    groups.forEach(function (g) {
      var p = g.pins[0], many = g.pins.length > 1;
      var html = many ? '<div class="favb favb-mini favb-cluster"><div class="fb-l1"><i>💬</i><b class="mono-num">' + g.pins.length + '</b></div></div>'
        : favBubbleHtml(p, tonight, full);
      L.marker([g.lat, g.lng], { pane: 'favPane', keyboard: true, title: many ? t('favCluster', { n: g.pins.length }) : t('ftag_' + p.tag),
        icon: L.divIcon({ className: 'favicon', html: html, iconSize: null }) })
        .on('click', function (e) {
          if (mode) { handleMapTap(e.latlng); return; }
          if (many) map.flyTo([g.lat, g.lng], Math.min(16, Math.max(zm + 2, 15)), { duration: REDUCED ? 0 : 0.6 });
          else favPopup(p);
        }).addTo(favLayer);
    });
  }
  function reactBtn(p, kind) {
    var on = kind === 'like' ? p.myLike : p.myHeart, n = kind === 'like' ? p.likes : p.hearts;
    return el('button', { type: 'button', class: 'btn btn-small fav-rx' + (on ? ' on' : ''), 'aria-pressed': String(!!on), 'data-kind': kind,
      'aria-label': t(kind === 'like' ? 'favLike' : 'favHeart'), onclick: function (e) { doFavReact(p, kind, e.currentTarget); } },
      [kind === 'like' ? '👍 ' : '❤️ ', el('b', { class: 'mono-num', text: String(n || 0) })]);
  }
  function doFavReact(p, kind, btn) {
    if (kind === 'like' ? p.myLike : p.myHeart) { toast(t('favAlready'), 1800); return; }
    btn.disabled = true;
    backend.favReact(DEVICE, p.id, kind).then(function (r) {
      p.likes = r.likes; p.hearts = r.hearts;
      if (kind === 'like') p.myLike = true; else p.myHeart = true;
      btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
      btn.querySelector('b').textContent = String(kind === 'like' ? r.likes : r.hearts);
      if (r.added) { giftToast(); SFX.play('chime'); } else toast(t('favAlready'), 1800);
      renderFavLayer(); if (currentTab === 'fav') renderFavList();
    }, function (e) { toast(favErrText(e), 4000); }).then(function () { btn.disabled = false; });
  }
  function doFavReport(kind, id, after) {
    if (favReportedMine[id]) { toast(t('favAlreadyReported'), 2500); return; }
    backend.favReport(DEVICE, kind, id).then(function (r) {
      favReportedMine[id] = 1; lsSet(STORE.favReports, favReportedMine);
      toast(r && r.already ? t('favAlreadyReported') : t('favReported'), 3000);
      if (after) after();
    }, function (e) { toast(favErrText(e), 4000); });
  }
  function loadReplies(p, ul) {
    backend.favReplies(p.id).then(function (list) {
      ul.textContent = '';
      if (!list.length) ul.appendChild(el('li', { class: 'pop-small', text: t('favNoReplies') }));
      list.forEach(function (r) {
        var mine = !!favTokens['r:' + r.id];
        ul.appendChild(el('li', { class: 'fav-reply' }, [
          el('span', { class: 'fr-body', text: r.body }),
          el('small', { class: 'mono-num', text: ' · ' + ago(r.createdAt) }),
          mine ? el('button', { type: 'button', class: 'fr-x', 'aria-label': t('del'), text: '✕', onclick: function () {
            backend.favDelete('reply', r.id, favTokens['r:' + r.id]).then(function () { delete favTokens['r:' + r.id]; lsSet(STORE.favTokens, favTokens); p.replies = Math.max(0, p.replies - 1); loadReplies(p, ul); }, function (e) { toast(favErrText(e), 4000); });
          } }) : el('button', { type: 'button', class: 'fr-x', 'aria-label': t('report'), title: t('report'), text: '⚑', onclick: function () { doFavReport('reply', r.id, function () { loadReplies(p, ul); }); } })
        ]));
      });
    }, function () { /* keep */ });
  }
  function favPopup(p) {
    var mine = !!favTokens[p.id], tonight = favTonightNow(), z = tonight ? favZone(p) : null;
    var ul = el('ul', { class: 'fav-replies' });
    var inp = el('input', { type: 'text', class: 'fav-reply-in', maxlength: '60', placeholder: t('favReplyPh'), 'aria-label': t('favReplyPh') });
    var err = el('div', { class: 'err', role: 'alert', hidden: 'hidden' });
    var send = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: t('favReplySend'), onclick: function () {
      var chk = LIB.checkFavText(inp.value, LIB.FAV_REPLY_MAX, false);
      var showE = function (m) { err.textContent = m; err.hidden = !m; };
      if (!chk.ok) { showE(chk.error === 'tooLong' ? t('err_tooLong60') : t('err_' + chk.error)); return; }
      var token = LIB.randomHex(40);
      send.disabled = true;
      backend.favReply(DEVICE, p.id, chk.text, token).then(function (r) {
        favTokens['r:' + r.id] = token; lsSet(STORE.favTokens, favTokens);
        inp.value = ''; showE(''); p.replies = (p.replies || 0) + 1;
        giftToast(); SFX.play('chime');
        loadReplies(p, ul);
      }, function (e) { showE(favErrText(e, 60)); }).then(function () { send.disabled = false; });
    } });
    inp.addEventListener('input', function () { err.hidden = true; });
    var mem = p.families ? t('favMemory', { n: p.families }) : null;
    var box = el('div', { class: 'pop pop-fav' }, [
      el('div', { class: 'pop-title', text: LIB.FAV_ICON[p.tag] + ' ' + t('ftag_' + p.tag) + (mine ? ' · ' + t('favMine') : '') }),
      p.body ? el('p', { class: 'pop-p fav-body', text: p.body }) : null,
      tonight ? el('button', { type: 'button', class: 'btn btn-primary btn-block fav-tonight', onclick: function () { map.closePopup(); startMark(); } }, [
        mem ? el('span', { class: 'ft-line', text: mem }) : null,
        z ? el('span', { class: 'ft-line', text: t('favTonightLit', { n: z.count, bucket: t(BUCKET_KEY[z.bucket]), icon: LIB.BUCKET_ICON[z.bucket] }) }) : null,
        el('span', { class: 'ft-ask', text: t('favTonightAsk') })
      ]) : (mem ? el('div', { class: 'pop-sub fav-mem', text: mem }) : null),
      el('div', { class: 'row row-tight fav-rxrow' }, [reactBtn(p, 'like'), reactBtn(p, 'heart'), el('small', { class: 'pop-small mono-num', text: ago(p.createdAt) })]),
      el('div', { class: 'pop-label', text: t('favReplies', { n: p.replies || 0 }) }),
      ul,
      el('div', { class: 'fav-replyrow' }, [inp, send]), err,
      el('div', { class: 'row row-tight' }, [mine
        ? el('button', { type: 'button', class: 'btn btn-small btn-danger', text: t('del'), onclick: function () {
            if (!window.confirm(t('favConfirmDel'))) return;
            backend.favDelete('pin', p.id, favTokens[p.id]).then(function () { delete favTokens[p.id]; lsSet(STORE.favTokens, favTokens); map.closePopup(); refreshFav(); }, function (e) { toast(favErrText(e), 4000); });
          } })
        : el('button', { type: 'button', class: 'btn btn-small btn-ghost', text: t('favReport'), onclick: function () { doFavReport('pin', p.id, function () { map.closePopup(); refreshFav(); }); } })])
    ]);
    L.popup({ maxWidth: 290, minWidth: 250, className: 'fav-popup', autoPanPaddingTopLeft: POP_TL, autoPanPaddingBottomRight: POP_BR })
      .setLatLng([p.lat, p.lng]).setContent(box).openOn(map);
    loadReplies(p, ul);
  }
  function renderFavList() {
    var ul = $('favList'); if (!ul) return;
    ul.textContent = '';
    $('favStatus').hidden = backend.favShared() || DEMO;
    $('favStatus').textContent = t('favLocal');
    $('favPinBtn').disabled = !LIB.isFavOpen(Date.now(), DEMO);
    if (!favPins.length) { ul.appendChild(el('li', { class: 'hint', text: t('favEmpty') })); return; }
    favPins.slice(0, 12).forEach(function (p) {
      ul.appendChild(el('li', { class: 'near-row' }, [el('button', { type: 'button', class: 'near-main fav-row', onclick: function () {
        if (narrow()) setSheetOpen(false);
        map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: false });
        favPopup(p);
      } }, [el('span', { class: 'fr-i', text: LIB.FAV_ICON[p.tag] }), el('span', { class: 'fr-t', text: p.body ? trunc(p.body, 40) : t('ftag_' + p.tag) }),
        el('b', { class: 'mono-num', text: '👍 ' + (p.likes || 0) + ' ❤️ ' + (p.hearts || 0) })])]));
    });
  }
  function renderFavAll() { renderFavLayer(); if (currentTab === 'fav') renderFavList(); }
  function favStatusChanged() {
    applyLayers(); renderPhase(); renderHowto(); renderPrivacy();
    if (!$('guide').hidden) renderGuide();
    if (!favOn() && currentTab === 'fav') openTab('board');
    renderFavAll();
  }
  function refreshFav() {
    if (CFG.favBoard === false || !LIB.favVisible(Date.now(), DEMO)) {
      var was0 = favReady; favReady = false; favPins = [];
      if (was0) favStatusChanged(); else renderFavAll();
      return Promise.resolve();
    }
    return backend.favList(DEVICE).then(function (rows) {
      var was = favReady;
      favReady = backend.favAvailable() && backend.favConfirmed;
      favPins = (rows || []).filter(function (p) { return LIB.inLondonBox(p.lat, p.lng) && LIB.FAV_TAGS.indexOf(p.tag) >= 0; });
      if (was !== favReady) favStatusChanged(); else renderFavAll();
    }, function () { /* keep last */ });
  }
  map.on('zoomend', renderFavLayer);
  // posting: tap the button, then the street; pick one tag (required) and an optional note
  $('favPinBtn').addEventListener('click', function () {
    if (!LIB.isFavOpen(Date.now(), DEMO)) { toast(t('favClosed'), 5000); return; }
    map.closePopup(); setMode('fav');
  });
  function openFavForm(pos) {
    if (!LIB.inLondonBox(pos[0], pos[1])) { toast(t('err_outside'), 5000); return; }
    pendingFav = LIB.favSnap(pos[0], pos[1]); favTag = null;
    renderFavTags();
    $('favNote').value = ''; updateCount('favNote', 'favCount', 80); showErr('favErr', '');
    $('favDialog').showModal();
  }
  function renderFavTags() {
    var box = $('favTags'); box.textContent = '';
    LIB.FAV_TAGS.forEach(function (tag) {
      box.appendChild(el('button', { type: 'button', class: 'tagbtn tagbtn-fav', role: 'radio', 'aria-checked': String(favTag === tag), 'aria-pressed': String(favTag === tag), 'data-tag': tag,
        onclick: function () { favTag = tag; renderFavTags(); showErr('favErr', ''); } }, [el('span', { class: 'tg-i', text: LIB.FAV_ICON[tag] }), t('ftag_' + tag)]));
    });
  }
  $('favNote').addEventListener('input', function () { updateCount('favNote', 'favCount', 80); showErr('favErr', ''); });
  $('favCancel').addEventListener('click', function () { $('favDialog').close(); pendingFav = null; });
  $('favSend').addEventListener('click', function () {
    if (!pendingFav) return;
    if (!favTag) { showErr('favErr', t('favNeedTag')); return; }
    var chk = LIB.checkFavText($('favNote').value, LIB.FAV_MAX, true);
    if (!chk.ok) { showErr('favErr', chk.error === 'tooLong' ? t('err_tooLong80') : t('err_' + chk.error)); return; }
    var token = LIB.randomHex(40), btn = $('favSend'), pos = pendingFav;
    btn.disabled = true;
    backend.favCreate({ device: DEVICE, lat: pos[0], lng: pos[1], tag: favTag, body: chk.text || null }, token).then(function (r) {
      favTokens[r.id] = token; lsSet(STORE.favTokens, favTokens);
      $('favDialog').close(); pendingFav = null;
      giftToast(); SFX.play('chime');
      if (!layerOn.fav) setLayer('fav', true);
      return refreshFav().then(function () {
        var p = favPins.filter(function (x) { return x.id === r.id; })[0];
        if (p) { if (narrow()) setSheetOpen(false); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: false }); favPopup(p); }
      });
    }, function (e) { showErr('favErr', favErrText(e, 80)); }).then(function () { btn.disabled = false; });
  });
  $('favBoardLink').addEventListener('click', function () { openTab('board'); });
  $('phaseFav').addEventListener('click', function () { closePhaseCard(); openTab('fav'); });

  // ==== board ====
  var board = { which: 'fun', sort: 'top' };
  segInit('boardSeg', function (v) { board.which = v; renderPosts(); });
  segInit('sortSeg', function (v) { board.sort = v; renderPosts(); });
  $('postBody').addEventListener('input', function () { updateCount('postBody', 'postCount'); showErr('postErr', ''); });
  $('postLoc').addEventListener('change', function () { if (this.checked) requestLocation(); });
  $('postBtn').addEventListener('click', function () {
    var chk = LIB.checkText($('postBody').value);
    if (!chk.ok) { showErr('postErr', t('err_' + chk.error)); return; }
    var useLoc = $('postLoc').checked && geo.pos;
    var token = LIB.randomHex(40), btn = $('postBtn');
    btn.disabled = true;
    backend.createPost({ board: board.which, areaId: $('postArea').value || null, body: chk.text,
                         lat: useLoc ? LIB.round(geo.pos[0], 3) : null, lng: useLoc ? LIB.round(geo.pos[1], 3) : null }, DEVICE, token)
      .then(function (r) {
        myPostTokens[r.id] = token; lsSet(STORE.postTokens, myPostTokens);
        $('postBody').value = ''; updateCount('postBody', 'postCount');
        toast(t('posted'));
        segSet('sortSeg', 'new'); board.sort = 'new';
        return refreshPosts();
      }, function (e) { showErr('postErr', errText(e)); })
      .then(function () { btn.disabled = false; });
  });
  function renderPosts() {
    var list = $('postList'), posts = LIB.sortPosts(data.posts[board.which] || [], board.sort);
    list.textContent = '';
    if (!posts.length) list.appendChild(el('li', { class: 'hint', text: t('noPosts') }));
    posts.forEach(function (p) {
      var a = p.areaId && AREA_BY_ID[p.areaId], voted = !!myVotes[p.id], mine = !!myPostTokens[p.id];
      list.appendChild(el('li', { class: 'post' }, [
        el('button', { type: 'button', class: 'vote' + (voted ? ' voted' : ''), 'aria-pressed': String(voted), 'aria-label': voted ? t('voted') : t('upvote'),
          onclick: function () { doVote(p); } }, [el('span', { text: '▲' }), el('b', { class: 'mono-num', text: String(p.votes) })]),
        el('div', { class: 'post-main' }, [
          el('div', { class: 'post-body', text: p.body }),
          el('div', { class: 'post-meta' }, [
            a ? el('span', { class: 'post-area', text: '📍 ' + a.name[lang].split(' / ')[0] }) : null,
            el('span', { class: 'mono-num', text: ago(p.createdAt) }),
            mine ? el('span', { class: 'mine', text: t('mine') }) : null
          ]),
          el('div', { class: 'row row-tight' }, [
            mine ? el('button', { class: 'btn btn-small btn-danger', type: 'button', text: t('del'), onclick: function () { doDeletePost(p); } })
                 : el('button', { class: 'btn btn-small btn-ghost', type: 'button', text: '⚑ ' + t('report'), disabled: myReports[p.id] ? 'disabled' : null,
                                  onclick: function () { doReport(p); } })
          ])
        ])
      ]));
    });
  }
  function doVote(p) {
    if (myVotes[p.id]) { toast(t('alreadyVoted')); return; }
    backend.vote(p.id, DEVICE).then(function (r) {
      myVotes[p.id] = 1; lsSet(STORE.votes, myVotes);
      if (r && r.already) toast(t('alreadyVoted'));
      return refreshPosts();
    }, function (e) { toast(errText(e)); });
  }
  function doReport(p) {
    backend.report(p.id, DEVICE).then(function (r) {
      myReports[p.id] = 1; lsSet(STORE.reports, myReports);
      toast(r && r.already ? t('alreadyReported') : t('reported'));
      return refreshPosts();
    }, function (e) { toast(errText(e)); });
  }
  function doDeletePost(p) {
    if (!window.confirm(t('confirmDel'))) return;
    backend.deletePost(p.id, myPostTokens[p.id]).then(function () {
      delete myPostTokens[p.id]; lsSet(STORE.postTokens, myPostTokens); return refreshPosts();
    }, function (e) { toast(errText(e)); });
  }

  // ==== data refresh ====
  function refreshPosts() {
    return Promise.all([backend.listPosts('fun'), backend.listPosts('decor')]).then(function (r) {
      data.posts.fun = r[0]; data.posts.decor = r[1]; renderPosts(); computeBase();
    }, function () { /* keep last */ });
  }
  var refreshing = null;
  function refreshAll() {
    if (refreshing) return refreshing;
    refreshing = Promise.all([refreshZones(), refreshPosts(), refreshSuggested(), refreshDecor(), refreshFav()]).then(function () { refreshing = null; }, function () { refreshing = null; });
    return refreshing;
  }
  // Shared server: poll every 30–60 s. Local/demo: re-count every 12 s (and at once when another tab marks).
  function zonesShared() { return backend.mode === 'supabase' && backend.isLive(); }
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (!zonesShared()) refreshZones();
    if (!backend.decorShared()) refreshDecor();
  }, LOCAL_RECOUNT_MS);
  setInterval(function () {
    if (document.visibilityState === 'visible') refreshAll();
    renderChips();
  }, CFG.pollSec * 1000);
  var changeTimer;
  backend.onChange(function () { clearTimeout(changeTimer); changeTimer = setTimeout(refreshAll, 250); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshAll(); });

  // ==== safety, countdown, privacy ====
  function renderTips() {
    var ul = $('tipList');
    ul.textContent = '';
    t('tips').forEach(function (tip) { ul.appendChild(el('li', { text: tip })); });
  }
  // Countdown to Oct 31 5 PM Toronto with live seconds (top bar + Safety panel). The DOM is rebuilt only when the phase or
  // language changes; each tick just swaps digits in fixed-width boxes. ?now=… shifts this clock (screenshots only).
  var NOW_OFFSET = (function () { var n = LIB.parseNowParam(location.search); return n === null ? 0 : n - Date.now(); })();
  function appNow() { return Date.now() + NOW_OFFSET; }
  var cd = { key: '', nums: [], secs: [] };
  function renderCountdown() {
    var now = appNow(), phase = LIB.countdownPhase(now);
    if (cd.key !== phase + lang) {
      cd.key = phase + lang; cd.nums = []; cd.secs = [];
      [$('countdown'), $('bigCountdown')].forEach(function (n, i) {
        n.textContent = '';
        n.dataset.phase = phase;
        if (phase !== 'before') { n.appendChild(el('span', { class: 'cd-msg', text: t(phase === 'on' ? 'cdNow' : 'cdAfter') })); return; }
        n.appendChild(el('span', { class: 'cd-lbl', text: '🎃 ' + t('cdBefore') + ' ' }));
        var digits = el('span', { class: 'cd-digits mono-num' });
        t('cdUnits').forEach(function (u, k) {
          var b = el('b', { class: k === 3 ? 'cd-n cd-s' : 'cd-n' });
          cd.nums.push(b);
          if (k === 3) cd.secs.push(b);
          if (k) digits.appendChild(document.createTextNode(' '));
          digits.appendChild(el('span', { class: 'cd-u' }, [b, el('i', { text: u })]));
        });
        n.appendChild(digits);
        if (i === 1) n.appendChild(el('div', { class: 'cd-on', text: t('cdOn') }));
      });
    }
    if (phase !== 'before') return;
    var u = LIB.countdownUnits(LIB.HALLOWEEN.start - now, t('cdUnits')), odd = Math.floor(now / 1000) % 2 === 1;
    cd.nums.forEach(function (b, i) { var v = u[i % 4][0]; if (b.textContent !== v) b.textContent = v; });
    cd.secs.forEach(function (b) { b.classList.toggle('odd', odd); });   // swapping the animation name replays the flicker, no reflow
  }
  // One interval, started on the next second boundary (+20 ms), stopped while the page is hidden.
  var cdTimer = null, cdAlign = null;
  function stopTicker() { clearTimeout(cdAlign); clearInterval(cdTimer); cdAlign = cdTimer = null; }
  function startTicker() {
    stopTicker();
    renderCountdown();
    cdAlign = setTimeout(function () { cdAlign = null; renderCountdown(); cdTimer = setInterval(renderCountdown, 1000); }, LIB.msToNextSecond(appNow()) + 20);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') startTicker(); else stopTicker(); });
  function renderPrivacy() {
    var dl = $('privacyList');
    dl.textContent = '';
    var items = t('privacyItems').slice();
    if (favOn()) items.splice(6, 0, t('privacyFav'));   // v14: after "Decoration marks"
    items.forEach(function (it) { dl.appendChild(el('dt', { text: it[0] })); dl.appendChild(el('dd', { text: it[1] })); });
    var sum = $('privacySummary'); sum.textContent = '';    // v15: 5-line summary; the full notice (unchanged) sits behind "Full privacy notice"
    t('privacySummary').forEach(function (x) { sum.appendChild(el('li', { text: x })); });
  }
  document.querySelectorAll('.privacy-link').forEach(function (b) { b.addEventListener('click', function () { openTab('privacy'); }); });
  function toggleTab(name) { openTab(currentTab === name && $('sheet').dataset.open === 'true' ? null : name); }
  $('safetyBtn').addEventListener('click', function () { toggleTab('safety'); });
  var SOUND_ICON_ON = '<svg class="ico" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>';
  var SOUND_ICON_OFF = '<svg class="ico" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  function renderSoundBtn() {
    var on = SFX.isOn(), b = $('soundBtn');
    b.innerHTML = on ? SOUND_ICON_ON : SOUND_ICON_OFF;          // v14: line icons in the top bar (emoji stay in content)
    b.dataset.on = on ? '1' : '0';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', t(on ? 'soundOnAria' : 'soundOffAria')); b.title = t(on ? 'soundOnAria' : 'soundOffAria');
  }
  $('soundBtn').addEventListener('click', function () {
    var on = SFX.toggle();
    renderSoundBtn();
    toast(t(on ? 'soundToastOn' : 'soundToastOff'), 1800);
    if (on) SFX.play('chime');                         // the tap itself is the user action
  });
  // v15: the top bar keeps brand, status chip, Safety, 🔊 and 中文. Demo / How-to live in the Guide tab; Past favourites is a layer chip.

  // ==== tabs / sheet / language ====
  var currentTab = null;
  var PANELS = ['map', 'near', 'decor', 'fav', 'route', 'guide', 'board', 'safety', 'privacy', 'feedback'];
  var TAB_OF = { decor: 'mark', near: 'map', fav: 'guide', board: 'guide', safety: 'guide', privacy: 'guide', feedback: 'guide' };
  function markCurrent() {
    var open = $('sheet').dataset.open === 'true', tab = TAB_OF[currentTab] || currentTab;
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      if (open && b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function setSheetOpen(open) {
    $('sheet').dataset.open = String(open);
    $('sheetHandle').setAttribute('aria-expanded', String(open));
    markCurrent();
  }
  function openTab(name) {
    if (!name) { setSheetOpen(false); return; }
    currentTab = name;
    PANELS.forEach(function (n) { $('panel-' + n).hidden = n !== name; });
    setSheetOpen(true);
    $('sheet').scrollTop = 0;
    if (name === 'near') renderNear();
    if (name === 'decor') renderDecorList();
    if (name === 'fav') renderFavList();
    if (name === 'feedback') updateFeedback();
  }
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    // centre tab = the same flow as the big button; before Oct 31 3 PM it opens Best decorations
    if (b.dataset.tab === 'mark') { if (bigIsDecor()) toggleTab('decor'); else startMark(); return; }
    if ((TAB_OF[currentTab] || currentTab) === b.dataset.tab && $('sheet').dataset.open === 'true') setSheetOpen(false);
    else openTab(b.dataset.tab);
  });
  $('sheetHandle').addEventListener('click', function () {
    if ($('sheet').dataset.open === 'true') setSheetOpen(false); else openTab(currentTab || 'map');
  });
  // Swipe the handle down/up to close/open the panel (passive listeners keep scrolling smooth).
  var swipeY = null;
  $('sheetHandle').addEventListener('touchstart', function (e) { swipeY = e.touches[0].clientY; }, { passive: true });
  $('sheetHandle').addEventListener('touchend', function (e) {
    if (swipeY === null) return;
    var dy = e.changedTouches[0].clientY - swipeY;
    swipeY = null;
    if (dy > 40) setSheetOpen(false); else if (dy < -40) openTab(currentTab || 'map');
  }, { passive: true });

  function applyStaticText() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('appTitle');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.dataset.i18n); });
    var lb = $('langBtn');
    lb.textContent = t('langBtn'); lb.setAttribute('aria-label', t('langAria'));
    $('sheetHandle').setAttribute('aria-label', t('sheetToggle'));
    $('postBody').placeholder = t('composePh');
    $('suggestReason').placeholder = t('suggestPh');
    $('markCardClose').setAttribute('aria-label', t('close'));
    renderSoundBtn();
    $('offlineChip').textContent = t('offlineChip');      // v15: short words, always visible (no icon-only state)
    renderChips();
    $('fbNameIn').placeholder = t('fbName');
  }
  function renderAll() {
    applyStaticText();
    renderLayerBar();
    renderAreaLayer(); renderCommunity(); renderAreaList(); renderEvents();
    areaOptions($('areaSelect'), 'auto', t('autoArea'), true, targetOption());
    areaOptions($('postArea'), '', t('noArea'), false);
    renderStartStatus(); renderRouteResult(); renderRouteHints();
    renderPosts(); renderTips(); renderCountdown(); renderPrivacy(); renderHowto();
    if (zoneLayer) zoneLayer.setData(tourZones || data.zones);
    if (decorLayer) decorLayer.setData(tourZones ? [] : data.decorZones);
    renderDecorBtn();
    if (currentTab === 'decor') renderDecorList();
    renderFavAll();
    if (!$('guide').hidden) renderGuide();
    if (!$('markCard').hidden) { renderTagRow(); }
    if (currentTab === 'near') renderNear();
    if (currentTab === 'feedback') updateFeedback();
    renderChips(); renderSharedChip();
    if (!$('nudge').hidden) $('nudge').textContent = t(bigIsDecor() ? 'nudgeDecor' : 'nudge');
    updateCount('postBody', 'postCount');
    updateLocateBtn();
    if (mode) $('modeText').textContent = t(MODE_TEXT[mode]);
    if (route.startMarker) route.startMarker.setTooltipContent(t('startLabel'));
  }
  $('langBtn').addEventListener('click', function () {
    lang = lang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem(STORE.lang, lang); } catch (e) { /* ignore */ }
    map.closePopup();
    renderAll();
  });

  // ==== 💬 Feedback (mailto + copy, no backend) and 🔗 Share ====
  var FB_INPUTS = ['fbConfusingIn', 'fbLikedIn', 'fbMissingIn'];
  function feedbackMail() {
    return LIB.buildFeedbackMail({ confusing: $('fbConfusingIn').value, liked: $('fbLikedIn').value, missing: $('fbMissingIn').value,
      name: $('fbNameIn').value, version: LIB.APP_VERSION, lang: lang, ua: navigator.userAgent, time: new Date().toISOString(),
      screen: screen.width + '×' + screen.height + ' (window ' + window.innerWidth + '×' + window.innerHeight + ')' });
  }
  function fbEmpty() { return !FB_INPUTS.some(function (id) { return $(id).value.trim(); }); }
  function updateFeedback() { $('fbSend').href = feedbackMail().href; }
  FB_INPUTS.concat('fbNameIn').forEach(function (id) {
    $(id).addEventListener('input', function () { updateFeedback(); showErr('fbErr', ''); $('fbCopied').hidden = true; });
  });
  $('fbSend').addEventListener('click', function (e) {
    if (fbEmpty()) { e.preventDefault(); showErr('fbErr', t('fbEmpty')); return; }
    this.href = feedbackMail().href;                       // fresh time stamp
  });
  // Clipboard API first; old browsers / http pages: a hidden textarea + execCommand('copy').
  function copyText(text) {
    function legacy() {
      var ta = el('textarea', { readonly: '', style: 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, legacy);
    return Promise.resolve(legacy());
  }
  $('fbCopy').addEventListener('click', function () {
    if (fbEmpty()) { showErr('fbErr', t('fbEmpty')); return; }
    var text = feedbackMail().text;
    copyText(text).then(function (ok) {
      $('fbCopied').textContent = ok ? '✅ ' + t('fbCopied') : t('fbCopyFail');
      $('fbCopied').hidden = false;
      $('fbOut').hidden = ok;
      if (!ok) { $('fbOut').value = text; $('fbOut').select(); }
    });
  });
  $('feedbackBtn').addEventListener('click', function () { openTab('feedback'); });
  $('shareAppBtn').addEventListener('click', function () {
    var url = location.href.split(/[?#]/)[0];
    if (navigator.share) { navigator.share({ title: t('appTitle'), text: t('shareText'), url: url }).catch(function () { /* cancelled */ }); return; }
    copyText(url).then(function (ok) { toast(ok ? t('shareCopied') : url, 5000); });
  });

  // ==== ▶ How to use: auto-play tour (tour.js). Its demo zones live in this closure only (never localStorage);
  // the real zones, layers, map view and panel come back when it ends. ====
  var tourLayer = L.layerGroup().addTo(map), tourZones = null, tourStore = null;
  var TOUR_VIEW = [42.9640, -81.2420], TOUR_SPOT = [42.9705, -81.2330];
  var TOUR_BG = [[42.9655, -81.2470, 23, 'candy'], [42.9560, -81.2330, 9, 'decor'], [42.9590, -81.2560, 4, null]];
  function tourZone(ll, n, tag, isNew, now) {
    return { cell: grid.cell(ll[0], ll[1]), count: n, tags: {}, topTag: tag, firstLitAt: isNew ? now : now - 3600000,
             isNew: isNew, bucket: LIB.zoneBucket(n) };
  }
  function tourDraw() {
    var now = Date.now(), n = tourStore.marks.length;
    tourZones = TOUR_BG.map(function (z) { return tourZone(z, z[2], z[3], false, now); });
    if (n >= LIB.MIN_ZONE) tourZones.push(tourZone(TOUR_SPOT, n, null, true, now));   // 3+ rule applies to the demo too
    if (zoneLayer) zoneLayer.setData(tourZones);
    if (decorLayer) decorLayer.setData([]);
    favLayer.clearLayers();
    renderPhase();
  }
  function tourReset() {
    tourStore = { marks: [TOUR_SPOT.slice(), TOUR_SPOT.slice()] };   // 2 marks: not shown yet
    tourLayer.clearLayers();
    setSheetOpen(false);
    map.setView(TOUR_VIEW, 14, { animate: false });
    tourDraw();
  }
  var TOUR_ACTIONS = {
    setup: function () {
      map.closePopup(); closeMarkCard(); hideTip(); setMode(null);
      if (!$('guide').hidden) closeGuide('done');
      layerOn.zones = true; applyLayers();                  // in memory only (setLayer would save it)
      tourReset();
    },
    zones: tourReset,
    markStart: tourReset,
    map: function () { setSheetOpen(false); },
    guide: function () { openTab('guide'); },
    markDrop: function () {
      var p = [TOUR_SPOT[0] + (Math.random() - 0.5) * 0.002, TOUR_SPOT[1] + (Math.random() - 0.5) * 0.003];
      tourStore.marks.push(p);
      L.marker(p, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="tour-drop">✨</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .addTo(tourLayer);
      tourDraw();
    }
  };
  function tourSnapshot() {
    var c = map.getCenter();
    return { center: [c.lat, c.lng], zoom: map.getZoom(), layers: Object.assign({}, layerOn), tab: currentTab, open: $('sheet').dataset.open === 'true' };
  }
  function tourRestore(snap) {
    tourZones = tourStore = null;
    tourLayer.clearLayers();
    Object.keys(snap.layers).forEach(function (k) { layerOn[k] = snap.layers[k]; });
    applyLayers();
    map.setView(snap.center, snap.zoom, { animate: false });
    if (zoneLayer) zoneLayer.setData(data.zones);
    if (decorLayer) decorLayer.setData(data.decorZones);
    renderDecorBtn(); renderFavLayer();
    if (snap.open && snap.tab) openTab(snap.tab); else { currentTab = snap.tab; setSheetOpen(false); }
  }
  function tourRect(step) {                                 // step 4: ring around the demo zone instead of the whole map
    if (step.target !== '#map') return null;
    var p = map.latLngToContainerPoint(grid.center(grid.cell(TOUR_SPOT[0], TOUR_SPOT[1]))), m = map.getContainer().getBoundingClientRect();
    return { left: m.left + p.x - 75, top: m.top + p.y - 75, width: 150, height: 150 };
  }
  var tour = window.TOT_TOUR ? window.TOT_TOUR.mount({ t: t, reduced: REDUCED, snapshot: tourSnapshot, restore: tourRestore, rect: tourRect,
    run: function (name) { if (TOUR_ACTIONS[name]) TOUR_ACTIONS[name](); } }) : null;
  function startTour(i, pause) { if (tour) tour.start(i || 0, pause); }
  $('guideTour').addEventListener('click', function () { startTour(); });

  // ==== welcome guide, How-to panel, inline hints ====
  function safeLS() { try { return window.localStorage; } catch (e) { return null; } }
  var guideIdx = 0, guideReturn = null;
  function guideCount() { return t('guideCards').length; }
  function renderGuide() {
    var track = $('guideTrack'), dotBox = $('guideDots');
    track.textContent = ''; dotBox.textContent = '';
    t('guideCards').forEach(function (c, i) {
      var card = el('section', { class: 'gcard', 'aria-labelledby': 'gcardH' + i }, [
        el('div', { class: 'gnum mono', text: '0' + (i + 1) }),
        el('h2', { id: 'gcardH' + i, text: c[0] }),
        el('ul', { class: 'glist' }, c[1].map(function (line) { return el('li', { text: line }); }))
      ]);
      // v15: 3 cards. 1 = what the colours mean, 2 = the two buttons, 3 = safety + the 25-second demo.
      if (i === 0) card.appendChild(el('div', { class: 'glegend', 'aria-hidden': 'true' }, ['quiet', 'lively', 'hot'].map(function (k) {
        return el('span', null, [el('i', { class: 'lg lg-' + k }), t(BUCKET_KEY[k])]);
      }).concat(el('span', null, [el('i', { class: 'lg lg-decor' }), t('legendDecor')]))));
      if (i === 1) card.appendChild(el('div', { class: 'gbtn-pair', 'aria-hidden': 'true' }, [
        el('div', { class: 'gbtn-demo gbtn-decor' }, [el('span', { text: t('decorMain') })]),
        el('div', { class: 'gbtn-demo' }, [el('span', { text: t('markBtn') })])]));
      if (i === 2) card.appendChild(el('button', { id: 'guideTourBtn', class: 'btn btn-primary btn-block', type: 'button', text: t('tourBtn'),
        onclick: function () { closeGuide('done'); startTour(); } }));
      track.appendChild(card);
      dotBox.appendChild(el('button', { type: 'button', class: 'gdot', 'aria-label': t('guideDotAria', { n: i + 1 }), onclick: function () { guideGo(i); } }));
    });
    $('guidePrev').setAttribute('aria-label', t('guidePrev'));
    $('guideNext').setAttribute('aria-label', t('guideNext'));
    guideGo(guideIdx);
  }
  function guideGo(i) {
    var n = guideCount(), hadFocus = document.activeElement;
    guideIdx = Math.max(0, Math.min(n - 1, i));
    $('guideTrack').style.transform = 'translateX(' + (-100 * guideIdx) + '%)';
    Array.prototype.forEach.call($('guideTrack').children, function (c, k) { c.setAttribute('aria-hidden', String(k !== guideIdx)); });
    Array.prototype.forEach.call($('guideDots').children, function (d, k) {
      if (k === guideIdx) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
    });
    function pad(x) { return (x < 10 ? '0' : '') + x; }
    var step = $('guideStep');
    step.textContent = pad(guideIdx + 1) + ' / ' + pad(n);
    step.setAttribute('aria-label', t('guideStep', { n: guideIdx + 1, total: n }));
    var last = guideIdx === n - 1;
    $('guidePrev').disabled = guideIdx === 0;
    $('guideNext').hidden = last;
    $('guideDone').hidden = !last;
    if (last && hadFocus === $('guideNext')) $('guideDone').focus();
    if (!last && hadFocus === $('guideDone')) $('guideNext').focus();
    if (guideIdx === 0 && hadFocus === $('guidePrev')) $('guideNext').focus();
  }
  function openGuide() {
    guideReturn = document.activeElement;
    guideIdx = 0;
    $('guide').hidden = false;
    renderGuide();
    $('guideNext').focus();
  }
  function closeGuide(how) {
    if ($('guide').hidden) return;
    $('guide').hidden = true;
    LIB.markGuideSeen(safeLS(), how);
    setTimeout(maybeTipHint, 600);                      // v15: the one-time "press and hold" hint comes right after the welcome
    if (guideReturn && guideReturn.focus && document.contains(guideReturn)) guideReturn.focus();
    guideReturn = null;
  }
  function guideFocusables() {
    return Array.prototype.filter.call($('guide').querySelectorAll('button'), function (b) { return !b.hidden && !b.disabled; });
  }
  $('guideSkip').addEventListener('click', function () { closeGuide('skipped'); });
  $('guideDone').addEventListener('click', function () { closeGuide('done'); });
  $('guidePrev').addEventListener('click', function () { guideGo(guideIdx - 1); });
  $('guideNext').addEventListener('click', function () { guideGo(guideIdx + 1); });
  $('guide').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closeGuide('skipped'); return; }
    if (e.key === 'ArrowRight') { guideGo(guideIdx + 1); return; }
    if (e.key === 'ArrowLeft') { guideGo(guideIdx - 1); return; }
    if (e.key !== 'Tab') return;
    var f = guideFocusables(), first = f[0], lastF = f[f.length - 1];   // focus trap
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastF.focus(); }
    else if (!e.shiftKey && document.activeElement === lastF) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener('focusin', function (e) {
    if (!$('guide').hidden && !$('guide').contains(e.target)) { var f = guideFocusables(); if (f.length) f[f.length - 1].focus(); }
  });
  // Swipe left/right between cards (passive listeners keep the page smooth).
  var gx = null, gy = null;
  $('guideViewport').addEventListener('touchstart', function (e) { gx = e.touches[0].clientX; gy = e.touches[0].clientY; }, { passive: true });
  $('guideViewport').addEventListener('touchend', function (e) {
    if (gx === null) return;
    var dx = e.changedTouches[0].clientX - gx, dy = e.changedTouches[0].clientY - gy;
    gx = gy = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) guideGo(guideIdx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  function renderHowto() {
    var box = $('howtoList');
    box.textContent = '';
    var secs = t('howtoSections').slice();
    if (favOn()) {                                      // v14 section right after "Best decorations"
      var di = secs.map(function (x) { return x[0]; }).findIndex(function (h) { return h.indexOf('🎃') === 0; });
      secs.splice(di + 1, 0, t('howtoFav'));
    }
    secs.forEach(function (sec) {
      box.appendChild(el('h3', { text: sec[0] }));
      box.appendChild(el('ul', null, sec[1].map(function (line) { return el('li', { text: line }); })));
    });
  }
  $('replayGuide').addEventListener('click', openGuide);

  // ==== v15: tooltips on every clickable element ====
  // Desktop: hover (~400 ms) or keyboard focus. Phones: press and hold ~500 ms shows the tip and does NOT act (the click
  // that follows is swallowed). One line, EN/ZH, never over the element, gone after 2.5 s, linked with aria-describedby.
  var TIP_IDS = { safetyBtn: 'tip_safety', langBtn: 'tip_lang', offlineChip: 'tip_offline', demoChip: 'tip_demo', phaseBanner: 'tip_banner',
    nearChip: 'tip_near', layerMore: 'tip_more', locateBtn: 'tip_locate', sharedChip: 'tip_shared', legend: 'tip_legend', favPinBtn: 'tip_favPin',
    guideTour: 'tip_tour', replayGuide: 'tip_replay', feedbackBtn: 'tip_feedback', shareAppBtn: 'tip_shareApp', phaseOk: 'tip_phaseOk',
    markCardDone: 'tip_done', markCardClose: 'tip_close', phaseClose: 'tip_close' };
  var TIP_SEL = 'button, a[href], summary, select, .legend, .leaflet-marker-icon, .leaflet-control-zoom a';
  var TIP_MS = 2500, PRESS_MS = 500, HOVER_MS = 400;
  var tipEl = $('tip'), tipFor = null, tipHide = null, pressT = null, pressAt = null, swallowClick = false, hoverT = null;
  function tipTarget(n) { return n && n.closest ? n.closest(TIP_SEL) : null; }
  function tipText(n) {
    var win = String(CFG.markWindowMin || 45), k = null;
    if (n.id === 'soundBtn') k = SFX.isOn() ? 'tip_soundOn' : 'tip_soundOff';
    else if (n.dataset && n.dataset.tipKey) k = n.dataset.tipKey;
    else if (TIP_IDS[n.id]) k = TIP_IDS[n.id];
    else if (n.dataset && n.dataset.tab) k = 'tip_tab_' + n.dataset.tab;
    else if (n.classList.contains('leaflet-control-zoom-in')) k = 'tip_zoomIn';
    else if (n.classList.contains('leaflet-control-zoom-out')) k = 'tip_zoomOut';
    else if (n.querySelector && n.querySelector('.favb-cluster')) k = 'tip_favCluster';
    else if (n.querySelector && n.querySelector('.favb')) k = 'tip_fav';
    else if (n.querySelector && n.querySelector('.zb-decor')) k = 'tip_decorBadge';
    else if (n.querySelector && n.querySelector('.zbadge')) k = 'tip_zone';
    if (k && I18N.en[k]) return t(k).replace('{win}', win);
    return n.getAttribute('aria-label') || n.getAttribute('title') || (n.textContent || '').trim().slice(0, 60);   // text buttons: their own words
  }
  function showTip(n) {
    var txt = tipText(n); if (!txt) return;
    hideTip();
    tipEl.textContent = txt; tipEl.hidden = false;
    var r = n.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var top = r.top - th - 8;                            // above the element; below it if there is no room; never on top of it
    if (top < 4) top = Math.min(r.bottom + 8, vh - th - 4);
    var left = Math.max(6, Math.min(vw - tw - 6, r.left + r.width / 2 - tw / 2));
    tipEl.style.top = Math.round(top) + 'px'; tipEl.style.left = Math.round(left) + 'px';
    tipEl.classList.toggle('tip-below', top > r.top);
    tipFor = n; n.setAttribute('aria-describedby', 'tip');
    tipHide = setTimeout(hideTip, TIP_MS);
  }
  function hideTip() {
    clearTimeout(tipHide); tipHide = null;
    if (tipFor && tipFor.getAttribute('aria-describedby') === 'tip') tipFor.removeAttribute('aria-describedby');
    tipFor = null; if (tipEl) tipEl.hidden = true;
  }
  function cancelPress() { clearTimeout(pressT); pressT = null; pressAt = null; }
  document.addEventListener('pointerdown', function (e) {
    hideTipHint();
    if (e.pointerType === 'mouse') return;
    var n = tipTarget(e.target); if (!n) return;
    cancelPress(); pressAt = [e.clientX, e.clientY];
    pressT = setTimeout(function () { pressT = null; swallowClick = true; showTip(n); buzz(); }, PRESS_MS);
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (pressAt && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) cancelPress();   // a drag/scroll, not a hold
  }, true);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  document.addEventListener('click', function (e) {     // the click after a long-press only shows the tip
    if (!swallowClick) return;
    swallowClick = false; e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('contextmenu', function (e) { if (tipTarget(e.target)) e.preventDefault(); });
  document.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;
    var n = tipTarget(e.target); if (!n || n === tipFor) return;
    clearTimeout(hoverT); hoverT = setTimeout(function () { showTip(n); }, HOVER_MS);
  });
  document.addEventListener('pointerout', function (e) {
    if (e.pointerType !== 'mouse') return;
    var n = tipTarget(e.target); if (!n || (e.relatedTarget && n.contains(e.relatedTarget))) return;
    clearTimeout(hoverT); if (tipFor === n) hideTip();
  });
  document.addEventListener('focusin', function (e) {
    var n = tipTarget(e.target); if (!n) return;
    try { if (!n.matches(':focus-visible')) return; } catch (x) { /* old browsers: show on focus */ }
    showTip(n);
  });
  document.addEventListener('focusout', function (e) { if (tipFor && tipFor === tipTarget(e.target)) hideTip(); });
  window.addEventListener('scroll', hideTip, true);
  // One-time hint on the first visit (after the welcome cards): "Press and hold any button for a tip".
  var tipHintT = null;
  function hideTipHint() { var h = $('tipHint'); if (h && !h.hidden) { h.hidden = true; clearTimeout(tipHintT); } }
  function maybeTipHint() {
    if (lsGet(STORE.tipHint, false) || !$('guide').hidden || !$('tour').hidden) return;
    lsSet(STORE.tipHint, true);
    var hover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches, h = $('tipHint');
    h.textContent = '👆 ' + t(hover ? 'tipHintHover' : 'tipHint'); h.hidden = false;
    tipHintT = setTimeout(hideTipHint, 6000);
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideTip(); closeMarkCard(); closePhaseCard(); } });

  // ?demo=1: frame every visible demo zone (3+ marks) and suggestion so no hexagon or badge sits under the chips, legend or Mark button.
  function fitDemoZones() {
    var D = window.TOT_DEMO; if (!D || !D.ZONES) return;
    var pts = D.ZONES.filter(function (z) { return z[3] >= 3; }).map(function (z) { return grid.center(grid.cell(z[1], z[2])); });
    (D.SUGGEST || []).forEach(function (s) { pts.push(grid.center(grid.cell(s[0], s[1]))); });
    (D.DECOR || []).forEach(function (z) { if (z[3] >= 3) pts.push(grid.center(grid.cell(z[1], z[2]))); });
    if (!pts.length) return;
    var wrap = map.getContainer().getBoundingClientRect();
    var top = $('layerbar').getBoundingClientRect().bottom - wrap.top + 45;      // badge sits above its hexagon
    var bottom = wrap.bottom - Math.min($('legend').getBoundingClientRect().top, $('markBtn').getBoundingClientRect().top) + 30;
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [lang === 'zh' ? 74 : 58, Math.max(60, top)], paddingBottomRight: [40, Math.max(60, bottom)], maxZoom: 14, animate: false });
  }

  // ==== first-visit language chooser (before the welcome cards and the tour) ====
  var langReady = new Promise(function (resolve) {
    if (!LIB.shouldShowLangChooser(FLAGS, SAVED_LANG)) { resolve(); return; }
    var box = $('langPick');
    box.hidden = false;
    box.querySelectorAll('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () {
        lang = b.getAttribute('data-pick') === 'zh' ? 'zh' : 'en';
        try { localStorage.setItem(STORE.lang, lang); } catch (e) { /* ignore */ }
        box.hidden = true;
        renderAll();
        resolve();
      });
    });
    setTimeout(function () { var f = box.querySelector('[data-pick="en"]'); if (f) f.focus(); }, 0);
  });

  // ==== boot ====
  applyLayers();
  renderAll();
  map.setView(L.latLngBounds(AREAS.map(function (a) { return [a.lat, a.lng]; })).getCenter(), 12);
  zoomClass();
  if (DEMO && FLAGS.near) {
    map.setView(DEMO_HOME, 14);
    L.marker(DEMO_HOME, { interactive: false, icon: L.divIcon({ className: '', html: '<div class="start-pin">🏠</div>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(map);
  }
  // ?demo=1 loads demo.js (fake marks) first; normal visits never download it.
  (DEMO ? new Promise(function (resolve) {
    var sc = document.createElement('script');
    sc.src = 'demo.js?' + LIB.APP_VERSION; sc.onload = sc.onerror = resolve;
    document.head.appendChild(sc);
  }) : Promise.resolve()).then(function () {
    if (DEMO && window.TOT_DEMO) window.TOT_DEMO.seed(backend.local, grid);
    return refreshAll();
  }).then(function () {
    if (DEMO && !FLAGS.near && !FLAGS.tour) fitDemoZones();
    if (FLAGS.near) openNear();
    if (FLAGS.decor) openTab('decor');
    if (FLAGS.fav && favOn()) openTab('fav');
    return langReady;                                   // the tour waits for the language choice
  }).then(function () {
    if (FLAGS.tour) startTour(FLAGS.tourStep ? FLAGS.tourStep - 1 : 0, !!FLAGS.tourStep);
  });
  startTicker();
  langReady.then(function () {                          // welcome cards / deep links only after English / 中文 is chosen
    if (FLAGS.howto) openTab('guide');
    if (FLAGS.feedback) openTab('feedback');
    if (LIB.shouldShowGuide(FLAGS, LIB.guideSeen(safeLS()))) openGuide(); else setTimeout(maybeTipHint, 1500);
    if (DEMO && FLAGS.nudge) setTimeout(function () { checkNudge(true); }, 1500);   // ?demo=1&nudge=1 previews the hint
  });

  // Hook for automated checks (harmless in normal use).
  window.__ltot = {
    t: t, lib: LIB, backend: backend, grid: grid, demo: DEMO, map: map, flags: FLAGS,
    zonePerf: function () { return zoneLayer ? { ms: zoneLayer.lastDrawMs, drawn: zoneLayer.drawn, badges: zoneLayer.badges, zones: data.zones.length,
                                                 base: baseLayer ? baseLayer.drawn : 0, baseMs: baseLayer ? baseLayer.lastDrawMs : 0, grid: grid.kind } : null; },
    refresh: refreshAll, refreshZones: refreshZones, setStart: setStart, buildLoop: buildLoop, openTab: openTab, setLayer: setLayer,
    openGuide: openGuide, closeGuide: closeGuide, startMark: startMark, tour: tour, startTour: startTour, appNow: appNow,
    feedbackMail: feedbackMail, openPhaseCard: openPhaseCard, pauseCard: pauseCard, resumeCard: resumeCard, pendDecor: pendDecor, sendPendingDecor: sendPendingDecor, refreshFav: refreshFav, favPopup: favPopup, openFavForm: openFavForm, favPins: function () { return favPins; }, renderFavLayer: renderFavLayer, SFX: SFX, refreshDecor: refreshDecor, decorLayer: decorLayer, tourZones: function () { return tourZones; }, doMark: doMark, openNear: openNear, openSuggest: openSuggest,
    state: function () {
      return { lang: lang, mode: backend.mode, markMode: markMode(), marks: backend.local.markCount(), zones: data.zones.map(function (z) {
                 return { cell: z.cell, count: z.count, bucket: z.bucket, isNew: z.isNew, topTag: z.topTag };
               }), suggested: data.suggested.length, posts: data.posts.fun.length + data.posts.decor.length,
               decorZones: data.decorZones.map(function (z) { return { cell: z.cell, count: z.count, topTag: z.topTag }; }),
               decorShared: backend.decorShared(), decorMissing: !!backend.decorMissing, myDecor: decorHist.length,
               phase: LIB.appPhase(phaseNow()), bigIsDecor: bigIsDecor(),
               favOn: favOn(), favMissing: !!backend.favMissing, favPins: favPins.length, favTonight: favTonightNow(), sound: SFX.isOn(),
               myMarks: markHist.length, celebrations: celebrations, layers: Object.assign({}, layerOn), tab: currentTab };
    }
  };
})();
