/* London Trick-or-Treat Map v2 — plain JS, no build step.
   Loads after: Leaflet, h3-js (optional), config.js, lib.js, i18n.js, data/areas.js, backend.js, hex.js */
(function () {
  'use strict';

  var LIB = window.TOT_LIB, I18N = window.TOT_I18N, RAW = window.TOT_AREAS_RAW || { meta: {}, areas: [] };
  var CFG = Object.assign({ backend: 'local', liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' },
                            dotTtlMin: 30, hexWindowMin: 20, hexMinCount: 3, pollSec: 60 }, window.TOT_CONFIG || {});
  CFG.hexWindowMin = Math.min(30, Math.max(15, CFG.hexWindowMin));

  // ==== constants ====
  var LONDON = [42.9849, -81.2453];
  var DEMO = /[?&]demo=1(&|$)/.test(location.search);
  var P = DEMO ? 'ltot.demo.' : 'ltot.v2.';           // demo data never mixes with real data
  var STORE = { lang: 'ltot.lang', locOk: 'ltot.locExplained', device: 'ltot.device', layers: 'ltot.layers', filters: 'ltot.filters',
                v1pins: 'ltot.pins.v1', migrated: 'ltot.v2.migrated', tokens: P + 'mine.markers', postTokens: P + 'mine.posts',
                votes: P + 'mine.votes', reports: P + 'mine.reports', localMk: P + 'mine.local' };
  var PACE = { 'u5': 1.5, '5-8': 2.0, '9-12': 2.5, 'teen': 3.0 };   // km/h including door stops
  var MAX_WALK_TO_AREA_KM = 1.5;
  var TYPE_ICON = { candy: '🍬', teal: '🩵', fullsize: '🍫', decor: '🎃', pet: '🐶', early: '🕔' };
  var AREAS = (RAW.areas || []).map(LIB.mapArea);
  var EVENTS = ((RAW.meta || {}).events || []);
  var AREA_BY_ID = {};
  AREAS.forEach(function (a) { AREA_BY_ID[a.id] = a; });

  // ==== i18n ====
  var lang = (function () { try { return localStorage.getItem(STORE.lang) === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; } })();
  function t(key, vars) {
    var s = I18N[lang][key];
    if (s === undefined) s = I18N.en[key];
    if (s === undefined) return key;
    if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
    return s;
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
  function ssGet(key, fb) { try { var v = sessionStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function ssSet(key, val) { try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
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
  function scoreColor(o) { return o >= 4.5 ? '#ff7a18' : o >= 4 ? '#ffa24d' : '#a855f7'; }
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

  // ==== device identity (random, local only) ====
  var DEVICE = lsGet(STORE.device, null);
  if (!DEVICE) { DEVICE = LIB.uuid(); lsSet(STORE.device, DEVICE); }
  var myTokens = lsGet(STORE.tokens, {}), myPostTokens = lsGet(STORE.postTokens, {});
  var myVotes = lsGet(STORE.votes, {}), myReports = lsGet(STORE.reports, {});

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

  var grid = window.TOT_HEX ? window.TOT_HEX.makeGrid() : LIB.makeGrid(null);
  var hexLayer = window.TOT_HEX ? window.TOT_HEX.createLayer(grid) : null;
  var dotRenderer = L.canvas({ padding: 0.2 });
  var layers = {
    areas: L.layerGroup(), hex: hexLayer || L.layerGroup(), houses: L.layerGroup(), dots: L.layerGroup(), events: L.layerGroup()
  };
  var sharedLayer = L.layerGroup().addTo(map);
  var routeLayer = L.layerGroup().addTo(map);
  var layerOn = Object.assign({ areas: true, hex: true, houses: true, dots: true, events: true }, lsGet(STORE.layers, {}));

  function sheetHeight() { var s = $('sheet'); return s.dataset.open === 'true' && narrow() ? s.offsetHeight : 0; }
  function focusBounds(b) { map.fitBounds(b, { paddingTopLeft: [20, 110], paddingBottomRight: [20, sheetHeight() + 20], maxZoom: 16 }); }

  // ==== backend ====
  var backend = window.TOT_BACKEND.createBackend(CFG, { demo: DEMO });
  var data = { markers: [], posts: { fun: [], decor: [] }, dots: [], live: [], linkMarkers: [], localMarkers: [] };
  function renderBackendChip() {
    var chip = $('offlineChip');
    chip.hidden = backend.mode !== 'offline';
    document.querySelectorAll('.local-note').forEach(function (n) { n.hidden = backend.mode === 'supabase'; });
  }
  backend.onStatus(renderBackendChip);
  $('offlineChip').addEventListener('click', function () {
    toast(backend.reason === 'notConfigured' ? t('offlineWhy_notConfigured') : t('offlineWhy'), 7000);
  });
  $('demoChip').hidden = !DEMO;

  // ==== layer chips ====
  var LAYER_ICONS = { areas: '🏘️', hex: '⬡', houses: '🎃', dots: '👥', events: '📅' };
  var LAYER_KEYS = { areas: 'layerAreas', hex: 'layerHex', houses: 'layerHouses', dots: 'layerDots', events: 'layerEvents' };
  function applyLayers() {
    Object.keys(layers).forEach(function (k) {
      var on = !!layerOn[k];
      if (on && !map.hasLayer(layers[k])) layers[k].addTo(map);
      if (!on && map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    });
    $('legend').hidden = !layerOn.hex;
    $('hexToggle').checked = !!layerOn.hex;
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
  }
  function setLayer(k, on) {
    layerOn[k] = on;
    lsSet(STORE.layers, layerOn);
    applyLayers();
    if (k === 'hex' && on) scheduleHex(true);
  }
  $('hexToggle').addEventListener('change', function () { setLayer('hex', this.checked); });

  // ==== areas ====
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
  function renderAreaLayer() {
    layers.areas.clearLayers();
    AREAS.forEach(function (a) {
      var c = scoreColor(LIB.overall(a));
      // No bindPopup: Leaflet's popup handler would swallow taps meant for "tap the map" modes.
      L.circle([a.lat, a.lng], { radius: a.r, color: c, weight: 2, fillColor: c, fillOpacity: 0.08, dashArray: '6 6', bubblingMouseEvents: false, className: 'area-circle' })
        .bindTooltip(shortName(a), { permanent: true, direction: 'center', className: 'area-label' })
        .on('click', function (e) {
          if (mode) handleMapTap(e.latlng);
          else L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(areaPopup(a)).openOn(map);
        })
        .addTo(layers.areas);
    });
  }
  function shortName(a) { return a.name[lang].split(/ \(| \/ | near |（| \/|附近/)[0].trim(); }
  function zoomClass() { map.getContainer().classList.toggle('zoom-far', map.getZoom() < 12); }
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
  function areaOptions(sel, firstVal, firstText, withScore) {
    var cur = sel.value || firstVal;
    sel.textContent = '';
    sel.appendChild(el('option', { value: firstVal, text: firstText }));
    AREAS.forEach(function (a) { sel.appendChild(el('option', { value: a.id, text: a.name[lang] + (withScore ? ' (' + LIB.overall(a) + ')' : '') })); });
    sel.value = cur;
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

  // ==== live location (v1) ====
  var geo = { watchId: null, pos: null, acc: 0, following: false, marker: null, circle: null, onFix: [] };
  function isSecure() { return window.isSecureContext || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname); }
  function updateLocateBtn() {
    $('locateBtn').classList.toggle('on', geo.watchId !== null);
    $('locateLabel').textContent = geo.watchId === null ? t('showMyLocation') : geo.following ? t('following') : t('recenter');
  }
  function requestLocation(cb) {
    if (cb) geo.onFix.push(cb);
    if (geo.watchId !== null) { if (geo.pos) flushFix(); return; }
    if (!('geolocation' in navigator)) { toast(t('locUnsupported')); return; }
    if (!isSecure()) { toast(t('locInsecure'), 6000); return; }
    if (lsGet(STORE.locOk, false)) { startWatch(); return; }
    var d = $('locDialog');
    if (typeof d.showModal === 'function') d.showModal(); else startWatch();
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
  function onPos(p) {
    var first = !geo.pos;
    geo.pos = [p.coords.latitude, p.coords.longitude];
    geo.acc = Math.round(p.coords.accuracy || 0);
    if (!geo.marker) {
      geo.circle = L.circle(geo.pos, { radius: geo.acc, color: '#2f80ff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      geo.marker = L.marker(geo.pos, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
                                       zIndexOffset: 1000, keyboard: false }).addTo(map);
    } else {
      geo.marker.setLatLng(geo.pos);
      geo.circle.setLatLng(geo.pos).setRadius(geo.acc);
    }
    geo.marker.bindTooltip(t('youAreHere', { a: geo.acc }));
    if (geo.following) { if (first) map.setView(geo.pos, Math.max(map.getZoom(), 16)); else map.panTo(geo.pos, { animate: true }); }
    updateLocateBtn();
    flushFix();
  }
  function onPosErr(err) {
    if (err.code === 1) { stopWatch(); toast(t('locDenied'), 8000); geo.onFix = []; if (live.on) stopSharing(null); }
    else if (!geo.pos) toast(t('locUnavailable'), 5000);
  }
  map.on('dragstart', function () { if (geo.following) { geo.following = false; updateLocateBtn(); } });
  $('locateBtn').addEventListener('click', function () {
    if (geo.watchId === null) { requestLocation(); return; }
    if (geo.following) { if (live.on) stopSharing(null); stopWatch(); toast(t('locStopped')); return; }
    geo.following = true;
    if (geo.pos) map.setView(geo.pos, Math.max(map.getZoom(), 16));
    updateLocateBtn();
  });
  $('locYes').addEventListener('click', function () { lsSet(STORE.locOk, true); $('locDialog').close(); startWatch(); });
  $('locNo').addEventListener('click', function () {
    $('locDialog').close(); geo.onFix = [];
    if (live.on) stopSharing(null);
  });

  // ==== map tap modes ====
  var mode = null; // 'start' | 'house' | null
  function setMode(m) {
    mode = m;
    $('modeBanner').hidden = !m;
    if (m) { $('modeText').textContent = m === 'start' ? t('tapForStart') : t('tapForHouse'); if (narrow()) setSheetOpen(false); }
    map.getContainer().style.cursor = m ? 'crosshair' : '';
  }
  $('modeCancel').addEventListener('click', function () { setMode(null); setSheetOpen(true); });
  function handleMapTap(ll) {
    if (mode === 'start') { setMode(null); setStart([ll.lat, ll.lng], 'map'); openTab('route'); return true; }
    if (mode === 'house') { setMode(null); openHouseDialog(null, [ll.lat, ll.lng]); return true; }
    return false;
  }
  map.on('click', function (e) {
    if (handleMapTap(e.latlng)) return;
    if (layerOn.hex && hexLayer) hexPopup(e.latlng);
  });

  // ==== route planner (v1) ====
  var route = { start: null, startKind: null, startMarker: null, minutes: 60, age: '5-8', last: null };
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
    if (forcedId && forcedId !== 'auto') return AREA_BY_ID[forcedId];
    var best = null, bestScore = -Infinity;
    AREAS.forEach(function (a) {
      var d = haversineKm(start, [a.lat, a.lng]);
      var crowdPenalty = age === 'u5' ? Math.max(0, a.s.crowd - 3) * 0.3 : 0;   // little kids: avoid the busiest areas
      var score = LIB.overall(a) - crowdPenalty - 0.35 * d;
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return best;
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

  // ==== house markers ====
  var filters = Object.assign({ teal: false, fullsize: false, early: false, hideOut: false }, lsGet(STORE.filters, {}));
  data.localMarkers = lsGet(STORE.localMk, []).map(LIB.sanitizeMarker).filter(Boolean);
  // One-time migration of v1 pins into the v2 marker model (kept on this phone only: they were not placed by the household).
  (function migrate() {
    if (DEMO || lsGet(STORE.migrated, false)) return;
    var old = LIB.migrateV1Pins(lsGet(STORE.v1pins, []));
    lsSet(STORE.migrated, true);
    if (!old.length) return;
    data.localMarkers = data.localMarkers.concat(old);
    lsSet(STORE.localMk, data.localMarkers);
    setTimeout(function () { toast(t('migrated', { n: old.length }), 6000); }, 800);
  })();
  function saveLocalMarkers() { lsSet(STORE.localMk, data.localMarkers); }
  function isMine(m) { return !!myTokens[m.id] || (m.localOnly && !String(m.id).match(/^link-/)); }
  function allMarkers() { return data.markers.concat(data.localMarkers); }

  var PUMPKIN = '<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">' +
    '<path d="M20 10c0-4 2-6 5-7" stroke="#3ddc84" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="13" cy="24" rx="9" ry="12" fill="currentColor"/><ellipse cx="27" cy="24" rx="9" ry="12" fill="currentColor"/>' +
    '<ellipse cx="20" cy="24" rx="8" ry="13" fill="currentColor" opacity=".85"/>' +
    '<path d="M13 21l3-4 3 4zM21 21l3-4 3 4zM13 28q7 5 14 0l-3 1-2-1-2 1-2-1-2 1z" fill="#1a0b00"/></svg>';
  function markerIcon(m, shared) {
    var badge = m.types.filter(function (x) { return x !== 'candy'; })[0];
    var cls = 'pk pk-' + m.status + (m.types.indexOf('teal') >= 0 ? ' pk-teal' : '') + (shared ? ' pk-shared' : '');
    return L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 36], popupAnchor: [0, -32],
      html: '<div class="' + cls + '">' + PUMPKIN + (badge ? '<span class="pk-badge">' + TYPE_ICON[badge] + '</span>' : '') + '</div>' });
  }
  function hoursText(m) { return m.start || m.end ? t('hoursFmt', { a: m.start || '…', b: m.end || '…' }) : ''; }
  function markerPopup(m, shared) {
    var mine = !shared && isMine(m);
    var kids = [
      el('div', { class: 'pop-title', text: m.types.map(function (x) { return TYPE_ICON[x]; }).join(' ') }),
      el('div', { class: 'st-pill st-' + m.status, text: t('st_' + m.status) }),
      el('ul', { class: 'type-list' }, m.types.map(function (x) { return el('li', { text: TYPE_ICON[x] + ' ' + t('mt_' + x) }); })),
      hoursText(m) ? el('div', { class: 'mono-num', text: '🕔 ' + hoursText(m) }) : null,
      m.note ? el('div', { class: 'pop-p', text: m.note }) : null,
      shared ? el('div', { class: 'pop-small', text: t('fromLink') }) : m.localOnly ? el('div', { class: 'pop-small', text: t('localOnlyNote') }) : null
    ];
    if (mine) {
      kids.push(el('div', { class: 'pop-small', text: t('yourMarker') }));
      kids.push(statusButtons(m));
      kids.push(el('div', { class: 'row row-tight' }, [
        el('button', { class: 'btn btn-small', type: 'button', text: t('edit'), onclick: function () { map.closePopup(); openHouseDialog(m); } }),
        el('button', { class: 'btn btn-small btn-danger', type: 'button', text: t('del'), onclick: function () { map.closePopup(); deleteMarker(m); } })
      ]));
    } else if (!shared) kids.push(el('div', { class: 'pop-small', text: t('ownerOnly') }));
    kids.push(el('div', { class: 'pop-small', text: t('expiresNote') }));
    return el('div', { class: 'pop' }, kids);
  }
  function statusButtons(m) {
    return el('div', { class: 'seg seg-small' }, LIB.STATUSES.map(function (s) {
      return el('button', { type: 'button', role: 'radio', 'aria-checked': String(m.status === s), text: t('st_' + s),
        onclick: function () { map.closePopup(); setStatus(m, s); } });
    }));
  }
  function renderMarkers() {
    layers.houses.clearLayers();
    var now = Date.now(), shown = LIB.filterMarkers(allMarkers(), filters, now);
    shown.forEach(function (m) {
      L.marker([m.lat, m.lng], { icon: markerIcon(m, false), riseOnHover: true })
        .bindPopup(function () { return markerPopup(m, false); }, { maxWidth: 280 }).addTo(layers.houses);
    });
    sharedLayer.clearLayers();
    LIB.filterMarkers(data.linkMarkers, filters, now).forEach(function (m) {
      L.marker([m.lat, m.lng], { icon: markerIcon(m, true) }).bindPopup(function () { return markerPopup(m, true); }).addTo(sharedLayer);
    });
    $('shownN').textContent = t('shownN', { n: shown.length });
    $('sharedBanner').hidden = !data.linkMarkers.length;
    $('sharedText').textContent = t('sharedBanner', { n: data.linkMarkers.length });
    renderFilterChips();
    renderMyHouses();
  }
  function renderFilterChips() {
    var box = $('filterChips');
    box.textContent = '';
    [['teal', 'fTeal'], ['fullsize', 'fFull'], ['early', 'fEarly'], ['hideOut', 'fHideOut']].forEach(function (f) {
      box.appendChild(el('button', { type: 'button', class: 'fchip', 'aria-pressed': String(!!filters[f[0]]), text: t(f[1]), onclick: function () {
        filters[f[0]] = !filters[f[0]];
        lsSet(STORE.filters, filters);
        renderMarkers();
      } }));
    });
  }
  function renderMyHouses() {
    var list = $('myHouseList'), mine = allMarkers().filter(isMine);
    list.textContent = '';
    if (!mine.length) list.appendChild(el('li', { class: 'hint', text: t('noMyHouses') }));
    mine.forEach(function (m) {
      list.appendChild(el('li', null, [
        el('div', { class: 'pl-main', onclick: function () { if (narrow()) setSheetOpen(false); map.setView([m.lat, m.lng], 17); } }, [
          el('div', null, [el('b', { text: m.types.map(function (x) { return TYPE_ICON[x]; }).join(' ') + ' ' }),
                           el('span', { class: 'st-pill st-' + m.status, text: t('st_' + m.status) })]),
          m.note ? el('div', { class: 'pl-note', text: m.note }) : null,
          m.localOnly ? el('div', { class: 'pl-note', text: t('localOnlyNote') }) : null
        ]),
        statusButtons(m),
        el('div', { class: 'row row-tight' }, [
          el('button', { class: 'btn btn-small', type: 'button', text: t('edit'), onclick: function () { openHouseDialog(m); } }),
          el('button', { class: 'btn btn-small btn-danger', type: 'button', text: t('del'), onclick: function () { deleteMarker(m); } })
        ])
      ]));
    });
  }
  function setStatus(m, s) {
    if (m.localOnly) {
      m.status = s; saveLocalMarkers(); renderMarkers(); scheduleHex(false); toast(t('statusSet'));
      return;
    }
    backend.setMarkerStatus(m.id, s, myTokens[m.id]).then(function () { toast(t('statusSet')); return refreshMarkers(); },
      function (e) { toast(errText(e)); });
  }
  function deleteMarker(m) {
    if (!window.confirm(t('confirmDel'))) return;
    if (m.localOnly) {
      data.localMarkers = data.localMarkers.filter(function (x) { return x !== m; });
      saveLocalMarkers(); renderMarkers(); toast(t('houseDeleted'));
      return;
    }
    backend.deleteMarker(m.id, myTokens[m.id]).then(function () {
      delete myTokens[m.id]; lsSet(STORE.tokens, myTokens); toast(t('houseDeleted')); return refreshMarkers();
    }, function (e) { toast(errText(e)); });
  }

  // House dialog
  var draft = null;
  function openHouseDialog(m, ll) {
    draft = m ? { ref: m, id: m.id, ll: [m.lat, m.lng], types: m.types.slice(), status: m.status, localOnly: m.localOnly }
              : { ref: null, id: null, ll: ll, types: ['candy'], status: 'giving', localOnly: false };
    $('hStart').value = m ? m.start || '' : '';
    $('hEnd').value = m ? m.end || '' : '';
    $('hNote').value = m ? m.note || '' : '';
    $('hErr').hidden = true;
    renderHouseDialog();
    $('houseDialog').showModal();
  }
  function renderHouseDialog() {
    if (!draft) return;
    var grid2 = $('typeGrid');
    grid2.textContent = '';
    LIB.MARKER_TYPES.forEach(function (ty) {
      grid2.appendChild(el('button', { type: 'button', 'aria-pressed': String(draft.types.indexOf(ty) >= 0), class: 'tchip tchip-' + ty,
        text: TYPE_ICON[ty] + ' ' + t('mt_' + ty), onclick: function () {
          var i = draft.types.indexOf(ty);
          if (i >= 0) draft.types.splice(i, 1); else draft.types.push(ty);
          renderHouseDialog();
        } }));
    });
    var seg = $('statusSeg');
    seg.textContent = '';
    LIB.STATUSES.forEach(function (s) {
      seg.appendChild(el('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.status === s), text: t('st_' + s),
        onclick: function () { draft.status = s; renderHouseDialog(); } }));
    });
    var tc = $('tplChips');
    tc.textContent = '';
    t('tpl').forEach(function (line) {
      tc.appendChild(el('button', { type: 'button', class: 'fchip', text: line, onclick: function () {
        var cur = $('hNote').value.trim(), next = cur ? cur + ' ' + line : line;
        if (LIB.charCount(next) <= 140) { $('hNote').value = next; updateCount('hNote', 'hCount'); }
      } }));
    });
    $('hNote').placeholder = t('notePh');
    updateCount('hNote', 'hCount');
  }
  function updateCount(inputId, outId) { $(outId).textContent = t('charCount', { n: LIB.charCount($(inputId).value) }); }
  $('hNote').addEventListener('input', function () { updateCount('hNote', 'hCount'); });
  $('hCancel').addEventListener('click', function () { $('houseDialog').close(); draft = null; });
  function showErr(id, msg) { $(id).textContent = msg; $(id).hidden = !msg; }
  $('hSave').addEventListener('click', function () {
    if (!draft) return;
    if (!draft.types.length) { showErr('hErr', t('pickType')); return; }
    var note = LIB.checkText($('hNote').value, { optional: true });
    if (!note.ok) { showErr('hErr', t('err_' + note.error)); return; }
    var rec = { id: draft.id, lat: draft.ll[0], lng: draft.ll[1], types: LIB.MARKER_TYPES.filter(function (x) { return draft.types.indexOf(x) >= 0; }),
                status: draft.status, note: note.text, start: $('hStart').value, end: $('hEnd').value, device: DEVICE };
    if (!LIB.inLondonBox(rec.lat, rec.lng)) { showErr('hErr', t('err_outside')); return; }
    if (draft.localOnly) {
      var idx = data.localMarkers.indexOf(draft.ref);
      var clean = LIB.sanitizeMarker(Object.assign({}, rec, { localOnly: true }));
      if (idx >= 0) data.localMarkers[idx] = clean;
      saveLocalMarkers(); $('houseDialog').close(); renderMarkers(); toast(t('houseSaved'));
      return;
    }
    var token = draft.id ? myTokens[draft.id] : LIB.randomHex(40);
    var btn = $('hSave');
    btn.disabled = true;
    backend.upsertMarker(rec, token).then(function (r) {
      myTokens[r.id] = token; lsSet(STORE.tokens, myTokens);
      $('houseDialog').close(); draft = null;
      toast(t('houseSaved'));
      return refreshMarkers();
    }, function (e) { showErr('hErr', errText(e)); }).then(function () { btn.disabled = false; });
  });
  $('addHouseBtn').addEventListener('click', function () { setMode('house'); });

  // Share links (#m=...; old v1 links #pins=... still open)
  $('shareBtn').addEventListener('click', function () {
    var list = allMarkers().filter(isMine);
    if (!list.length) { toast(t('nothingToShare')); return; }
    var url = location.href.split('#')[0] + '#m=' + LIB.encodeMarkers(list);
    if (url.length > 6000) toast(t('linkLong'), 5000);
    if (navigator.share) navigator.share({ title: t('appTitle'), text: t('shareText'), url: url }).catch(function (e) { if (e && e.name !== 'AbortError') copyLink(url); });
    else copyLink(url);
  });
  function copyLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast(t('copied')); }, function () { window.prompt(t('copyFail'), url); });
    else window.prompt(t('copyFail'), url);
  }
  function readHash() {
    var m = /[#&]m=([A-Za-z0-9_-]+)/.exec(location.hash), v1 = /[#&]pins=([A-Za-z0-9_-]+)/.exec(location.hash);
    data.linkMarkers = m ? LIB.decodeMarkers(m[1]) : v1 ? LIB.decodeV1Pins(v1[1]) : [];
    renderMarkers();
    if (!data.linkMarkers.length) return false;
    openTab('pins');
    focusBounds(L.latLngBounds(data.linkMarkers.map(function (p) { return [p.lat, p.lng]; })).pad(0.3));
    return true;
  }
  window.addEventListener('hashchange', readHash);
  function clearHash() { history.replaceState(null, '', location.href.split('#')[0]); }
  $('saveShared').addEventListener('click', function () {
    var key = function (p) { return p.lat + ',' + p.lng + ',' + p.types.join(); }, have = {}, added = 0;
    allMarkers().forEach(function (p) { have[key(p)] = true; });
    data.linkMarkers.forEach(function (p) {
      if (have[key(p)]) return;
      data.localMarkers.push(Object.assign({}, p, { id: 'saved-' + LIB.randomHex(8), localOnly: true }));
      have[key(p)] = true; added++;
    });
    saveLocalMarkers(); data.linkMarkers = []; clearHash(); renderMarkers();
    toast(t('savedN', { n: added }));
  });
  $('hideShared').addEventListener('click', function () { data.linkMarkers = []; clearHash(); renderMarkers(); });

  // ==== board ====
  var board = { which: 'fun', sort: 'top' };
  segInit('pinsSub', function (v) { $('sub-houses').hidden = v !== 'houses'; $('sub-board').hidden = v !== 'board'; });
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
          onclick: function () { doVote(p); } }, [el('span', { text: '▲' }), el('b', { class: 'mono-num', text: t('votesN', { n: p.votes }) })]),
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

  // ==== hotspot hexes ====
  var hex = { last: 0, timer: null, updatedAt: 0 };
  function liveOpen() { return LIB.isLiveOpen(Date.now(), CFG, DEMO); }
  function scheduleHex(force) {
    if (!hexLayer) return;
    var wait = force ? 0 : Math.max(0, CFG.pollSec * 1000 - (Date.now() - hex.last));
    if (hex.timer && !force) return;               // already scheduled: at most one recompute per minute
    clearTimeout(hex.timer);
    hex.timer = setTimeout(computeHex, wait);
  }
  function computeHex() {
    hex.timer = null; hex.last = Date.now();
    var votes = LIB.areaVoteTotals(data.posts.fun.concat(data.posts.decor));
    var plan = LIB.planningHexes(AREAS, allMarkers(), votes, grid, Date.now(), 400);
    var okId = grid.kind === 'h3' ? /^[0-9a-f]{15}$/ : /^L-?\d+_-?\d+$/;
    var live = data.live.filter(function (c) { return okId.test(c.cell) && c.count >= CFG.hexMinCount; });
    hexLayer.setData(plan, live, liveOpen() ? 'live' : 'plan');
    hex.updatedAt = Date.now();
    if (window.console && console.debug) console.debug('[hex] draw ' + hexLayer.lastDrawMs + ' ms, ' + hexLayer.drawn + ' hexes, grid=' + grid.kind);
    renderHexInfo();
  }
  function renderHexInfo() {
    $('hexMode').textContent = liveOpen() ? t('hexModeLive', { m: CFG.hexWindowMin }) : t('hexModePlan');
    $('hexUpdated').textContent = hex.updatedAt ? t('hexUpdated', { t: fmtClock(hex.updatedAt) }) : '';
    $('hexFallback').hidden = grid.kind === 'h3';
  }
  function hexPopup(ll) {
    var r = hexLayer.lookup(ll), kids = [];
    if (liveOpen()) {
      kids.push(el('div', { class: 'pop-title', text: r.live ? t('legend' + { quiet: 'Quiet', busy: 'Busy', very: 'Very' }[LIB.liveBucket(r.live.count)]) : '⬡' }));
      kids.push(el('div', { text: r.live ? t('hexLiveInfo', { n: r.live.count, m: CFG.hexWindowMin }) : t('hexNoData') }));
    } else {
      if (!r.plan) return;
      kids.push(el('div', { class: 'pop-title', text: t('legend' + { quiet: 'Quiet', busy: 'Busy', very: 'Very' }[LIB.planBucket(r.plan.score)]) }));
      kids.push(el('div', { class: 'mono-num', text: t('hexPlanInfo', { s: Math.round(r.plan.score * 100) }) }));
    }
    L.popup({ maxWidth: 240 }).setLatLng(ll).setContent(el('div', { class: 'pop' }, kids)).openOn(map);
  }

  // ==== live dots ====
  var live = { on: false, startedAt: 0, lastSentAt: 0, timer: null, warnedOutside: false };
  var ownSids = ssGet(P + 'ownSids', []), drawnDots = 0;
  function renderDots() {
    layers.dots.clearLayers();
    var others = data.dots.filter(function (d) { return ownSids.indexOf(d.sidHash) < 0; });   // never echo my own dot
    drawnDots = others.length;
    others.forEach(function (d) {
      L.circleMarker([d.lat, d.lng], { renderer: dotRenderer, radius: 5, weight: 1, color: '#e9d5ff', fillColor: '#c084fc', fillOpacity: 0.85, interactive: false })
        .addTo(layers.dots);
    });
    $('othersN').textContent = liveOpen() ? t('othersN', { n: others.length }) : '';
  }
  function renderLiveGate() {
    var open = liveOpen();
    $('shareToggle').disabled = !open;
    $('shareToggle').checked = live.on;
    $('liveGate').hidden = open;
    $('demoNote').hidden = !DEMO;
    renderLiveStatus();
  }
  function renderLiveStatus() {
    var box = $('liveStatus'), now = Date.now();
    if (!live.on) { box.textContent = liveOpen() ? t('sharingOff') : ''; box.classList.remove('on'); return; }
    box.classList.add('on');
    if (document.visibilityState !== 'visible') { box.textContent = t('sharingPaused'); return; }
    var next = live.lastSentAt ? Math.max(0, Math.ceil((live.lastSentAt + 60000 - now) / 1000)) : 0;
    box.textContent = geo.pos ? t('sharingOn', { s: next, m: Math.ceil(LIB.sharingLeftMs(live.startedAt, now) / 60000) }) : t('liveNeedsLoc');
  }
  function startSharing() {
    if (!liveOpen()) { $('shareToggle').checked = false; toast(t('opensHalloween')); return; }
    live.on = true; live.startedAt = Date.now(); live.lastSentAt = 0; live.warnedOutside = false;
    requestLocation(function () { liveTick(); });
    clearInterval(live.timer);
    live.timer = setInterval(liveTick, 1000);
    renderLiveGate();
  }
  function stopSharing(msgKey) {
    live.on = false;
    clearInterval(live.timer); live.timer = null;
    var s = ssGet(P + 'session', null);
    if (s) backend.removeDot(s.id).then(refreshLive, function () { /* it will expire anyway */ });
    if (msgKey) toast(t(msgKey), 6000);
    renderLiveGate();
  }
  function liveTick() {
    if (!live.on) return;
    var now = Date.now();
    if (!liveOpen()) { stopSharing('windowClosed'); return; }
    if (LIB.sharingExpired(live.startedAt, now)) { stopSharing('sharingStopped'); return; }
    var visible = document.visibilityState === 'visible';
    if (geo.pos && LIB.shouldSendDot(live.lastSentAt, now, visible, 60000)) sendMyDot(now);
    renderLiveStatus();
  }
  function sendMyDot(now) {
    live.lastSentAt = now;
    var prev = ssGet(P + 'session', null), s = LIB.nextSession(prev, now);
    if (s !== prev) ssSet(P + 'session', s);
    var sid = LIB.sha256Hex(s.id);
    if (ownSids.indexOf(sid) < 0) { ownSids = ownSids.concat(sid).slice(-6); ssSet(P + 'ownSids', ownSids); }
    var c = LIB.coarsen(geo.pos[0], geo.pos[1]);
    if (!LIB.inLondonBox(c[0], c[1])) {
      if (!live.warnedOutside) { toast(t('dotOutside'), 5000); live.warnedOutside = true; }
      return;
    }
    backend.sendDot({ session: s.id, lat: c[0], lng: c[1], h3: grid.kind === 'h3' ? grid.cell(c[0], c[1]) : null })
      .then(refreshLive, function (e) { if (e && e.code === 'closed') stopSharing('windowClosed'); });
  }
  $('shareToggle').addEventListener('change', function () { if (this.checked) startSharing(); else stopSharing(null); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { liveTick(); refreshAll(); }
    renderLiveStatus();
  });

  // ==== data refresh (polling, not sockets) ====
  function refreshMarkers() {
    return backend.listMarkers().then(function (l) { data.markers = l; renderMarkers(); scheduleHex(false); }, function () { /* keep last */ });
  }
  function refreshPosts() {
    return Promise.all([backend.listPosts('fun'), backend.listPosts('decor')]).then(function (r) {
      data.posts.fun = r[0]; data.posts.decor = r[1]; renderPosts(); scheduleHex(false);
    }, function () { /* keep last */ });
  }
  function refreshLive() {
    if (!liveOpen()) { data.dots = []; data.live = []; renderDots(); return Promise.resolve(); }
    if (DEMO && window.TOT_DEMO) window.TOT_DEMO.seed(backend.local, AREAS);
    return Promise.all([backend.listDots(), backend.liveHexCounts(CFG.hexWindowMin, grid.cell)]).then(function (r) {
      data.dots = r[0]; data.live = r[1]; renderDots(); scheduleHex(false);
    }, function () { /* keep last */ });
  }
  var refreshing = null;
  function refreshAll() {
    if (refreshing) return refreshing;
    refreshing = Promise.all([refreshMarkers(), refreshPosts(), refreshLive()]).then(function () { refreshing = null; }, function () { refreshing = null; });
    return refreshing;
  }
  setInterval(function () {
    if (document.visibilityState === 'visible') refreshAll();
    renderLiveGate(); renderCountdown();
  }, CFG.pollSec * 1000);
  // Another tab (BroadcastChannel) or this tab wrote local data: refresh soon (hexes stay throttled).
  var changeTimer;
  backend.onChange(function () { clearTimeout(changeTimer); changeTimer = setTimeout(refreshAll, 250); });

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
  $('safetyBtn').addEventListener('click', function () { openTab(currentTab === 'safety' && $('sheet').dataset.open === 'true' ? null : 'safety'); });

  // ==== tabs / sheet / language ====
  var currentTab = null;
  var PANELS = ['areas', 'route', 'pins', 'live', 'safety', 'privacy'];
  function setSheetOpen(open) {
    $('sheet').dataset.open = String(open);
    $('sheetHandle').setAttribute('aria-expanded', String(open));
    if (!open) document.querySelectorAll('.tabbar button').forEach(function (b) { b.removeAttribute('aria-current'); });
    else if (currentTab) document.querySelectorAll('.tabbar button').forEach(function (b) { if (b.dataset.tab === currentTab) b.setAttribute('aria-current', 'page'); });
  }
  function openTab(name) {
    if (!name) { setSheetOpen(false); return; }
    currentTab = name;
    PANELS.forEach(function (n) { $('panel-' + n).hidden = n !== name; });
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    setSheetOpen(true);
    $('sheet').scrollTop = 0;
    if (name === 'live') renderLiveGate();
  }
  document.querySelector('.tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab === currentTab && $('sheet').dataset.open === 'true') setSheetOpen(false);
    else openTab(b.dataset.tab);
  });
  $('sheetHandle').addEventListener('click', function () {
    if ($('sheet').dataset.open === 'true') setSheetOpen(false); else openTab(currentTab || 'areas');
  });
  // Swipe the handle down/up to close/open the panel (passive listeners keep scrolling smooth).
  var swipeY = null;
  $('sheetHandle').addEventListener('touchstart', function (e) { swipeY = e.touches[0].clientY; }, { passive: true });
  $('sheetHandle').addEventListener('touchend', function (e) {
    if (swipeY === null) return;
    var dy = e.changedTouches[0].clientY - swipeY;
    swipeY = null;
    if (dy > 40) setSheetOpen(false); else if (dy < -40) openTab(currentTab || 'areas');
  }, { passive: true });

  function applyStaticText() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('appTitle');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = t(n.dataset.i18n); });
    var lb = $('langBtn');
    lb.textContent = t('langBtn'); lb.setAttribute('aria-label', t('langAria'));
    $('sheetHandle').setAttribute('aria-label', t('sheetToggle'));
    $('postBody').placeholder = t('composePh');
  }
  function renderAll() {
    applyStaticText();
    renderLayerBar();
    renderAreaLayer(); renderAreaList(); renderEvents();
    areaOptions($('areaSelect'), 'auto', t('autoArea'), true);
    areaOptions($('postArea'), '', t('noArea'), false);
    renderStartStatus(); renderRouteResult();
    renderMarkers(); renderPosts(); renderDots();
    renderTips(); renderCountdown(); renderPrivacy();
    renderLiveGate(); renderHexInfo(); renderBackendChip();
    updateCount('postBody', 'postCount');
    updateLocateBtn();
    if (mode) $('modeText').textContent = mode === 'start' ? t('tapForStart') : t('tapForHouse');
    if (route.startMarker) route.startMarker.setTooltipContent(t('startLabel'));
    if ($('houseDialog').open) renderHouseDialog();
  }
  $('langBtn').addEventListener('click', function () {
    lang = lang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem(STORE.lang, lang); } catch (e) { /* ignore */ }
    map.closePopup();
    renderAll();
  });

  // ==== boot ====
  applyLayers();
  renderAll();
  if (!readHash()) map.setView(L.latLngBounds(AREAS.map(function (a) { return [a.lat, a.lng]; })).getCenter(), 12);
  zoomClass();
  // ?demo=1 loads demo.js (test data) first; normal visits never download it.
  (DEMO ? new Promise(function (resolve) {
    var sc = document.createElement('script');
    sc.src = 'demo.js'; sc.onload = sc.onerror = resolve;
    document.head.appendChild(sc);
  }) : Promise.resolve()).then(refreshAll).then(function () { scheduleHex(true); });

  // Hook for automated checks (harmless in normal use).
  window.__ltot = {
    t: t, lib: LIB, backend: backend, grid: grid, demo: DEMO, map: map,
    hexPerf: function () { return hexLayer ? { ms: hexLayer.lastDrawMs, drawn: hexLayer.drawn, plan: hexLayer.plan.length, live: hexLayer.live.length, grid: grid.kind } : null; },
    refresh: refreshAll, computeHex: computeHex, setStart: setStart, buildLoop: buildLoop, openTab: openTab, setLayer: setLayer,
    state: function () {
      return { lang: lang, mode: backend.mode, markers: data.markers.length, local: data.localMarkers.length, link: data.linkMarkers.length,
               posts: data.posts.fun.length + data.posts.decor.length, dots: data.dots.length, drawnDots: drawnDots, ownSids: ownSids.slice(),
               live: live.on, liveOpen: liveOpen(), layers: Object.assign({}, layerOn) };
    }
  };
})();
