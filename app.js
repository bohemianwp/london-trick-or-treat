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
  var FLAGS = LIB.parseUrlFlags(location.search);   // ?guide=1, ?howto=1, ?lang=zh|en, ?demo=1, ?near=1
  var DEMO = FLAGS.demo;
  var DEMO_HOME = [42.9628, -81.2390];                // ?demo=1&near=1 centres "Near me" here (Old South, near Wortley Rd)
  var P = DEMO ? 'ltot.demo.' : 'ltot.v3.';           // demo data never mixes with real data
  var STORE = { lang: 'ltot.lang', locOk: 'ltot.locExplained', device: 'ltot.device', layers: 'ltot.v3.layers', markHint: 'ltot.markHintSeen',
                session: P + 'session', markHist: P + 'mine.marks', suggestHist: P + 'mine.suggest',
                postTokens: P + 'mine.posts', votes: P + 'mine.votes', reports: P + 'mine.reports' };
  var PACE = { 'u5': 1.5, '5-8': 2.0, '9-12': 2.5, 'teen': 3.0 };   // km/h including door stops
  var MAX_WALK_TO_AREA_KM = 1.5;
  var LOCAL_RECOUNT_MS = 12000;                       // local/demo mode: re-aggregate every 12 s
  var AREAS = (RAW.areas || []).map(LIB.mapArea);
  var EVENTS = ((RAW.meta || {}).events || []);
  var AREA_BY_ID = {};
  AREAS.forEach(function (a) { AREA_BY_ID[a.id] = a; });
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ==== i18n ====
  var lang = FLAGS.lang || (function () { try { return localStorage.getItem(STORE.lang) === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; } })();
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
  function bearingDeg(a, b) {
    var r = Math.PI / 180;
    var y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    var x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
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
  var map = L.map('map', { zoomControl: true, attributionControl: false, tap: true }).setView(LONDON, 12);
  L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'tiles-dark',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  var HEX = window.TOT_HEX;
  var grid = HEX ? HEX.makeGrid() : LIB.makeGrid(null);
  var baseLayer = HEX ? HEX.createBaseLayer(grid) : null;
  var zoneLayer = HEX ? HEX.createZoneLayer(grid, { onTap: zonePopup, badgeHtml: badgeHtml }) : null;
  var layers = {
    zones: zoneLayer || L.layerGroup(),
    areas: L.layerGroup(),
    events: L.layerGroup()
  };
  if (baseLayer) baseLayer.addTo(layers.areas);         // faint planning score lives with the "Suggested" base layer
  var mineLayer = L.layerGroup().addTo(map);            // sparkles where *I* marked (this phone only)
  var routeLayer = L.layerGroup().addTo(map);
  var layerOn = Object.assign({ zones: true, areas: true, events: true }, lsGet(STORE.layers, {}));

  function sheetHeight() { var s = $('sheet'); return s.dataset.open === 'true' && narrow() ? s.offsetHeight : 0; }
  function focusBounds(b) { map.fitBounds(b, { paddingTopLeft: [20, 110], paddingBottomRight: [20, sheetHeight() + 20], maxZoom: 16 }); }

  // ==== backend ====
  var backend = window.TOT_BACKEND.createBackend(CFG, { demo: DEMO });
  var data = { zones: [], suggested: [], posts: { fun: [], decor: [] }, zonesAt: 0 };
  function markMode() { return LIB.markMode(Date.now(), CFG, DEMO); }
  function renderChips() {
    $('offlineChip').hidden = backend.mode !== 'offline';
    $('demoChip').hidden = !DEMO;
    $('practiceChip').hidden = markMode() !== 'practice';
    document.querySelectorAll('.local-note').forEach(function (n) { n.hidden = backend.mode === 'supabase'; });
  }
  backend.onStatus(renderChips);
  $('offlineChip').addEventListener('click', function () {
    toast(backend.reason === 'notConfigured' ? t('offlineWhy_notConfigured') : t('offlineWhy'), 7000);
  });
  $('practiceChip').addEventListener('click', function () { toast(t('practiceWhy'), 7000); });

  // ==== layer chips ====
  var LAYER_ICONS = { zones: '🔥', areas: '🧭', events: '📅' };
  var LAYER_KEYS = { zones: 'layerZones', areas: 'layerAreas', events: 'layerEvents' };
  function applyLayers() {
    Object.keys(layers).forEach(function (k) {
      var on = !!layerOn[k];
      if (on && !map.hasLayer(layers[k])) layers[k].addTo(map);
      if (!on && map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    });
    $('legend').hidden = !layerOn.zones;
    renderLayerBar();
  }
  function renderLayerBar() {
    var bar = $('layerbar');
    bar.textContent = '';
    bar.setAttribute('aria-label', t('layers'));
    Object.keys(LAYER_ICONS).forEach(function (k) {
      bar.appendChild(el('button', { type: 'button', class: 'lchip', 'aria-pressed': String(!!layerOn[k]), 'data-layer': k,
        onclick: function () { setLayer(k, !layerOn[k]); } }, [el('span', { class: 'li', text: LAYER_ICONS[k] }), t(LAYER_KEYS[k])]));
    });
    bar.appendChild(el('button', { type: 'button', class: 'lchip lchip-near', id: 'nearChip', onclick: function () { openNear(); } },
      [el('span', { class: 'li', text: '📍' }), t('layerNear')]));
  }
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
      L.circle([a.lat, a.lng], { radius: a.r, color: '#a78bfa', weight: 1.5, opacity: 0.6, fillColor: '#a78bfa', fillOpacity: 0.05,
                                 dashArray: '5 7', bubblingMouseEvents: false, className: 'area-circle' })
        .bindTooltip(shortName(a) + ' · ' + t('suggestedTag'), { permanent: true, direction: 'center', className: 'area-label' })
        .on('click', function (e) {
          if (mode) handleMapTap(e.latlng);
          else L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(areaPopup(a)).openOn(map);
        })
        .addTo(layers.areas);
    });
  }
  function renderCommunity() {
    communityGroup.clearLayers();
    data.suggested.forEach(function (s) {
      var pts = isCell(s.cell) ? grid.boundary(s.cell) : grid.boundary(grid.cell(s.lat, s.lng));
      L.polygon(pts, { color: '#c4b5fd', weight: 2, dashArray: '3 6', fillColor: '#7c3aed', fillOpacity: 0.12, className: 'community-hex', bubblingMouseEvents: false })
        .bindTooltip('💜 ' + t('communityTag'), { permanent: true, direction: 'center', className: 'area-label community-label' })
        .on('click', function (e) {
          if (mode) { handleMapTap(e.latlng); return; }
          L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(el('div', { class: 'pop' }, [
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
  var MODE_TEXT = { start: 'tapForStart', mark: 'tapForMark', suggest: 'tapForSuggest' };
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
    return true;
  }
  map.on('click', function (e) { handleMapTap(e.latlng); });

  // ==== MARK IT! ====
  var markHist = LIB.pruneHistory(lsGet(STORE.markHist, []), Date.now());
  var lastMark = null;   // { id, token, tags }
  function waitText(ms) { return Math.max(1, Math.ceil(ms / 60000)); }
  function startMark() {
    map.closePopup();
    if (narrow()) setSheetOpen(false);
    var pre = LIB.markRate(markHist, null, Date.now());           // device limit can be checked before we know the spot
    if (!pre.ok) { toast(t('rateDevice', { m: waitText(pre.waitMs) }), 5000); return; }
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
    if (!r.ok) { toast(t(r.reason === 'zone' ? 'rateZone' : 'rateDevice', { m: waitText(r.waitMs) }), 6000); return; }
    var s = LIB.nextSession(lsGet(STORE.session, null), now);
    lsSet(STORE.session, s);
    var token = LIB.randomHex(40);
    backend.sendMark({ session: s.id, lat: pos[0], lng: pos[1], tags: [] }, token, grid.cell).then(function (res) {
      markHist = LIB.pruneHistory(markHist.concat({ t: now, cell: cell, id: res.id }), now);
      lsSet(STORE.markHist, markHist);
      lastMark = { id: res.id, token: token, tags: [], at: now };
      lsSet(STORE.markHint, true);
      $('markHintBtn').hidden = true; $('hintMark').hidden = true;
      celebrate();
      openMarkCard();
      renderMine();
      refreshZones();
    }, function (e) {
      if (e && e.code === 'rate') toast(t('rateDevice', { m: 5 }), 6000);
      else toast(errText(e), 6000);
    });
  }
  function openMarkCard() {
    var mm = markMode();
    $('markCardText').textContent = mm === 'practice' ? t('markedPractice') : t('markedLive', { m: CFG.markWindowMin });
    renderTagRow();
    $('markCard').hidden = false;
    clearTimeout(openMarkCard.timer);
    openMarkCard.timer = setTimeout(closeMarkCard, 20000);
  }
  function closeMarkCard() { $('markCard').hidden = true; clearTimeout(openMarkCard.timer); }
  function renderTagRow() {
    var row = $('tagRow');
    row.textContent = '';
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
  $('markCardDone').addEventListener('click', closeMarkCard);
  $('markCardClose').addEventListener('click', closeMarkCard);
  $('markBtn').addEventListener('click', startMark);
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
    L.popup({ maxWidth: 260 }).setLatLng(ll).setContent(el('div', { class: 'pop' }, [
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
      if (zoneLayer) zoneLayer.setData(data.zones);
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
  segInit('timeSeg', function (v) { route.minutes = Number(v); });
  segInit('ageSeg', function (v) { route.age = v; });
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
  function buildCheckpoints(start, area, targetKm) {
    var center = [area.lat, area.lng], dStart = haversineKm(start, center);
    var drive = dStart > MAX_WALK_TO_AREA_KM, origin = drive ? center : start;
    var loopKm = drive ? targetKm : Math.max(targetKm - 2 * dStart, 0.6);
    var rKm = Math.min(Math.max(loopKm / (2 * Math.PI * 1.3), 0.12), area.r / 1000);
    var n = 5, startAngle = drive ? 0 : bearingDeg(center, start), pts = [];
    for (var i = 0; i < n; i++) {
      var ang = (startAngle + i * 360 / n) * Math.PI / 180;
      pts.push([center[0] + (rKm / 111.32) * Math.cos(ang), center[1] + (rKm / (111.32 * Math.cos(center[0] * Math.PI / 180))) * Math.sin(ang)]);
    }
    return { origin: origin, drive: drive, dStart: dStart, waypoints: [origin].concat(pts, [origin]) };
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
    var cp = buildCheckpoints(route.start, area, PACE[route.age] * route.minutes / 60);
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
      res.area = area; res.cp = cp; res.age = route.age;
      route.last = res;
      drawRoute(res);
      renderRouteResult();
    }).then(function () { btn.disabled = false; btn.textContent = t('buildLoop'); });
  }
  $('buildBtn').addEventListener('click', buildLoop);
  function drawRoute(res) {
    routeLayer.clearLayers();
    var line = L.polyline(res.line, { color: '#ff7a18', weight: 6, opacity: 0.95, className: 'route-line', dashArray: res.method === 'straight' ? '10 10' : null }).addTo(routeLayer);
    res.cp.waypoints.slice(1, -1).forEach(function (p, i) {
      L.circleMarker(p, { radius: 9, color: '#fff', weight: 2, fillColor: '#a855f7', fillOpacity: 1 })
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
      el('div', { class: 'stat', style: 'grid-column: span 2' }, [el('small', { text: t('resTime') }),
        el('b', { class: 'mono-num', text: '≈ ' + fmtMin(res.km / PACE[res.age] * 60) }), el('small', { text: t('inclStops') })])
    ]));
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
    refreshing = Promise.all([refreshZones(), refreshPosts(), refreshSuggested()]).then(function () { refreshing = null; }, function () { refreshing = null; });
    return refreshing;
  }
  // Shared server: poll every 30–60 s. Local/demo: re-count every 12 s (and at once when another tab marks).
  function zonesShared() { return backend.mode === 'supabase' && backend.isLive(); }
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    if (!zonesShared()) refreshZones();
  }, LOCAL_RECOUNT_MS);
  setInterval(function () {
    if (document.visibilityState === 'visible') refreshAll();
    renderChips(); renderCountdown();
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
  var NIGHT = { start: LIB.zonedToUtcMs('2026-10-31', '18:00'), end: LIB.zonedToUtcMs('2026-10-31', '21:30') };
  function renderCountdown() {
    var now = Date.now(), box = $('countdown'), big = $('bigCountdown');
    box.textContent = ''; big.textContent = '';
    if (now >= NIGHT.start && now <= NIGHT.end) { box.textContent = t('cdNow'); big.textContent = t('cdNow'); return; }
    if (now > NIGHT.end) { box.textContent = t('cdAfter'); big.textContent = t('cdAfter'); return; }
    var p = LIB.countdownParts(NIGHT.start - now), u = t('cdUnits');
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var digits = (p.d ? p.d + u[0] + ' ' : '') + pad(p.h) + u[1] + ' ' + pad(p.m) + u[2];
    [box, big].forEach(function (n) {
      n.appendChild(el('span', { text: '🎃 ' + t('cdBefore') + ' ' }));
      n.appendChild(el('span', { class: 'mono-num cd-digits', text: digits }));
    });
    big.appendChild(el('div', { class: 'cd-on', text: t('cdOn') }));
  }
  function renderPrivacy() {
    var dl = $('privacyList');
    dl.textContent = '';
    t('privacyItems').forEach(function (it) { dl.appendChild(el('dt', { text: it[0] })); dl.appendChild(el('dd', { text: it[1] })); });
  }
  document.querySelectorAll('.privacy-link').forEach(function (b) { b.addEventListener('click', function () { openTab('privacy'); }); });
  function toggleTab(name) { openTab(currentTab === name && $('sheet').dataset.open === 'true' ? null : name); }
  $('safetyBtn').addEventListener('click', function () { toggleTab('safety'); });
  $('helpBtn').addEventListener('click', function () { toggleTab('guide'); });
  $('boardBtn').addEventListener('click', function () { toggleTab('board'); });
  $('guideBoard').addEventListener('click', function () { openTab('board'); });
  $('guideSafety').addEventListener('click', function () { openTab('safety'); });

  // ==== tabs / sheet / language ====
  var currentTab = null;
  var PANELS = ['map', 'near', 'route', 'guide', 'board', 'safety', 'privacy'];
  var TAB_OF = { near: 'map', board: 'guide', safety: 'guide', privacy: 'guide' };
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
  }
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab === 'mark') { startMark(); return; }      // centre tab = the same flow as the big button
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
    $('helpBtn').setAttribute('aria-label', t('helpAria')); $('helpBtn').title = t('helpAria');
    $('boardBtn').setAttribute('aria-label', t('boardAria')); $('boardBtn').title = t('boardAria');
    $('markCardClose').setAttribute('aria-label', t('close'));
    document.querySelectorAll('.ibtn').forEach(function (b) { b.setAttribute('aria-label', t('infoAria')); });
  }
  function renderAll() {
    applyStaticText();
    renderLayerBar();
    renderAreaLayer(); renderCommunity(); renderAreaList(); renderEvents();
    areaOptions($('areaSelect'), 'auto', t('autoArea'), true, targetOption());
    areaOptions($('postArea'), '', t('noArea'), false);
    renderStartStatus(); renderRouteResult();
    renderPosts(); renderTips(); renderCountdown(); renderPrivacy(); renderHowto();
    if (zoneLayer) zoneLayer.setData(data.zones);
    if (!$('guide').hidden) renderGuide();
    if (!$('markCard').hidden) { renderTagRow(); }
    if (currentTab === 'near') renderNear();
    renderChips();
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
      if (i === 0) card.appendChild(el('div', { class: 'glegend' }, [el('b', { text: t('guideLegend') })].concat(['quiet', 'lively', 'hot'].map(function (k) {
        return el('span', null, [el('i', { class: 'lg lg-' + k }), t(BUCKET_KEY[k])]);
      }))));
      if (i === 1) card.appendChild(el('div', { class: 'gbtn-demo', 'aria-hidden': 'true' }, [el('span', { text: '✨ ' + t('markBtn') })]));
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
    t('howtoSections').forEach(function (sec) {
      box.appendChild(el('h3', { text: sec[0] }));
      box.appendChild(el('ul', null, sec[1].map(function (line) { return el('li', { text: line }); })));
    });
  }
  $('replayGuide').addEventListener('click', openGuide);

  // ⓘ hints: tap to show a one-line note, tap again (or Esc) to hide. The big-button hint shows until the first mark.
  $('markHintBtn').hidden = !!lsGet(STORE.markHint, false);
  function closeHints(except) {
    document.querySelectorAll('.ibtn').forEach(function (b) {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      $(b.getAttribute('aria-controls')).hidden = true;
    });
  }
  document.querySelectorAll('.ibtn').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') !== 'true';
      closeHints(b);
      b.setAttribute('aria-expanded', String(open));
      $(b.getAttribute('aria-controls')).hidden = !open;
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeHints(null); closeMarkCard(); } });

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
    sc.src = 'demo.js?v=5'; sc.onload = sc.onerror = resolve;
    document.head.appendChild(sc);
  }) : Promise.resolve()).then(function () {
    if (DEMO && window.TOT_DEMO) window.TOT_DEMO.seed(backend.local, grid);
    return refreshAll();
  }).then(function () { if (FLAGS.near) openNear(); });
  if (FLAGS.howto) openTab('guide');
  if (LIB.shouldShowGuide(FLAGS, LIB.guideSeen(safeLS()))) openGuide();

  // Hook for automated checks (harmless in normal use).
  window.__ltot = {
    t: t, lib: LIB, backend: backend, grid: grid, demo: DEMO, map: map, flags: FLAGS,
    zonePerf: function () { return zoneLayer ? { ms: zoneLayer.lastDrawMs, drawn: zoneLayer.drawn, badges: zoneLayer.badges, zones: data.zones.length,
                                                 base: baseLayer ? baseLayer.drawn : 0, baseMs: baseLayer ? baseLayer.lastDrawMs : 0, grid: grid.kind } : null; },
    refresh: refreshAll, refreshZones: refreshZones, setStart: setStart, buildLoop: buildLoop, openTab: openTab, setLayer: setLayer,
    openGuide: openGuide, closeGuide: closeGuide, startMark: startMark, doMark: doMark, openNear: openNear, openSuggest: openSuggest,
    state: function () {
      return { lang: lang, mode: backend.mode, markMode: markMode(), marks: backend.local.markCount(), zones: data.zones.map(function (z) {
                 return { cell: z.cell, count: z.count, bucket: z.bucket, isNew: z.isNew, topTag: z.topTag };
               }), suggested: data.suggested.length, posts: data.posts.fun.length + data.posts.decor.length,
               myMarks: markHist.length, celebrations: celebrations, layers: Object.assign({}, layerOn), tab: currentTab };
    }
  };
})();
