/* Map layers for zones. Uses h3-js (resolution 8) when it loaded from the CDN, otherwise the local hex grid in lib.js.
   - Base layer: ONE <canvas> with the faint planning score (researched areas + board votes). Never drawn over live zones.
   - Zone layer: live zones (3+ marks) as a few SVG hexagons in their own pane. The pulse/flash is a CSS animation on
     opacity (class per colour), so there is no per-frame JS. Only zones inside the viewport are drawn, capped at MAX_ZONES;
     count badges are capped at MAX_BADGES. */
(function (root) {
  'use strict';
  var L = root.L, LIB = root.TOT_LIB;
  if (!L || !LIB) return;
  var MAX_PLAN = 400, MAX_ZONES = 150, MAX_BADGES = 40;

  function viewBounds(map, pad) {
    var b = map.getBounds().pad(pad);
    return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
  }
  function ensurePane(map, name, z) {
    var p = map.getPane(name) || map.createPane(name);
    p.style.zIndex = z;
    return p;
  }

  // ---- faint planning base layer (canvas)
  var BaseLayer = L.Layer.extend({
    initialize: function (grid) { this.grid = grid; this.plan = []; this.lastDrawMs = 0; this.drawn = 0; },
    onAdd: function (map) {
      this._map = map;
      ensurePane(map, 'basePane', 340).style.pointerEvents = 'none';
      this._c = L.DomUtil.create('canvas', 'hex-canvas leaflet-zoom-hide', map.getPane('basePane'));
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove: function (map) {
      map.off('moveend zoomend resize', this._reset, this);
      L.DomUtil.remove(this._c);
      this._c = null;
    },
    setData: function (plan) { this.plan = plan || []; if (this._c) this._draw(); },
    _reset: function () {
      var map = this._map, size = map.getSize(), dpr = Math.min(root.devicePixelRatio || 1, 2);
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      this._dpr = dpr;
      this._draw();
    },
    _draw: function () {
      if (!this._c) return;
      var t0 = (root.performance || Date).now(), map = this._map, grid = this.grid;
      var ctx = this._c.getContext('2d');
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this._c.width, this._c.height);
      var plan = LIB.clipToBounds(this.plan, grid, viewBounds(map, 0.15), MAX_PLAN);
      ctx.strokeStyle = 'rgba(168,85,247,0.35)'; ctx.lineWidth = 1;
      plan.forEach(function (h) {
        var pts = grid.boundary(h.cell);
        ctx.beginPath();
        for (var i = 0; i < pts.length; i++) {
          var p = map.latLngToContainerPoint(pts[i]);
          if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(168,85,247,' + (0.04 + 0.14 * h.score).toFixed(3) + ')';   // faint: never competes with live zones
        ctx.fill(); ctx.stroke();
      });
      this.drawn = plan.length;
      this.lastDrawMs = Math.round(((root.performance || Date).now() - t0) * 10) / 10;
    }
  });

  // Badges are added hottest first. If a cooler zone's badge would overlap one already placed, try other spots around
  // its hexagon (below, right, left, higher) and keep the first free one, else the one with the least overlap,
  // so every count stays readable when zones are close together at city-wide zoom.
  var SPOTS = [['', ''], ['zb-below', 'translate(-50%, 10px)'], ['zb-side', 'translate(10px, -50%)'],
               ['zb-side', 'translate(calc(-100% - 10px), -50%)'], ['zb-side', 'translate(-50%, calc(-200% - 16px))']];
  function overlap(r, placed) {
    return placed.reduce(function (sum, q) {
      var w = Math.min(r.right, q.right + 3) - Math.max(r.left, q.left - 3), h = Math.min(r.bottom, q.bottom + 3) - Math.max(r.top, q.top - 3);
      return sum + (w > 0 && h > 0 ? w * h : 0);
    }, 0);
  }
  function setSpot(b, i) { b.classList.remove('zb-below', 'zb-side'); if (SPOTS[i][0]) b.classList.add(SPOTS[i][0]); b.style.transform = SPOTS[i][1]; }
  function declutter(group, avoid) {
    var placed = (avoid || []).slice(), mine = [];
    group.eachLayer(function (m) {
      var host = m.getElement && m.getElement(), b = host && host.querySelector('.zbadge');
      if (!b || !b.getBoundingClientRect) return;
      var best = 0, bestCost = Infinity, r;
      for (var i = 0; i < SPOTS.length; i++) {
        setSpot(b, i);
        var cost = overlap(b.getBoundingClientRect(), placed);
        if (cost < bestCost) { best = i; bestCost = cost; }
        if (cost === 0) break;
      }
      setSpot(b, best); r = b.getBoundingClientRect();
      placed.push(r); mine.push(r);
    });
    return mine;
  }

  // ---- live zones (SVG + CSS animation) with count badges
  var ZoneLayer = L.Layer.extend({
    initialize: function (grid, opts) {
      this.grid = grid; this.opts = opts || {}; this.zones = []; this.drawn = 0; this.badges = 0; this.rects = [];
      this._group = L.layerGroup(); this._badgeGroup = L.layerGroup();
    },
    onAdd: function (map) {
      this._map = map;
      if (this.opts.pane) ensurePane(map, this.opts.pane, this.opts.paneZ || 420);    // v11 decor zones: just under the live zones
      else ensurePane(map, 'zonePane', 430);
      ensurePane(map, 'badgePane', 660);          // above area labels (tooltipPane 650): nothing covers a live zone
      this._renderer = this._renderer || L.svg({ pane: this.opts.pane || 'zonePane', padding: 0.3 });
      this._group.addTo(map); this._badgeGroup.addTo(map);
      map.on('moveend', this._render, this);
      this._render();
      var self = this;   // badge widths change once web fonts arrive: lay the badges out again
      if (root.document && root.document.fonts && root.document.fonts.ready) root.document.fonts.ready.then(function () { if (self._map) self._render(); });
    },
    onRemove: function (map) {
      map.off('moveend', this._render, this);
      map.removeLayer(this._group); map.removeLayer(this._badgeGroup);
      this.rects = [];
      if (this.opts.onLayout) this.opts.onLayout();
    },
    // zones: output of LIB.aggregateZones / decorateZones (already 3+ only, hottest first)
    setData: function (zones) { this.zones = zones || []; if (this._map) this._render(); },
    _render: function () {
      var self = this, map = this._map, grid = this.grid, o = this.opts;
      var t0 = (root.performance || Date).now();
      this._group.clearLayers(); this._badgeGroup.clearLayers();
      var vis = LIB.clipToBounds(this.zones, grid, viewBounds(map, 0.25), MAX_ZONES);
      var zoom = map.getZoom(), showBadges = zoom >= 11, compact = zoom < 14, nb = 0;
      vis.forEach(function (z) {
        var cls = o.kind === 'decor' ? 'zone zone-decor' : 'zone zone-' + z.bucket + (z.isNew ? ' zone-new' : '');
        var poly = L.polygon(grid.boundary(z.cell), { renderer: self._renderer, className: cls, weight: 2, interactive: true, bubblingMouseEvents: false });
        poly.on('click', function (e) { if (o.onTap) o.onTap(z, e.latlng); });
        poly.addTo(self._group);
        if (showBadges && nb < MAX_BADGES) {
          nb++;
          L.marker(grid.center(z.cell), { pane: 'badgePane', keyboard: false, interactive: true, bubblingMouseEvents: false,
            icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html: o.badgeHtml ? o.badgeHtml(z, compact) : String(z.count) }) })
            .on('click', function (e) { if (o.onTap) o.onTap(z, e.latlng); })
            .addTo(self._badgeGroup);
        }
      });
      this.drawn = vis.length; this.badges = nb;
      // v11: two layers share the badge pane; each lays its badges out around the other layer's badges.
      this.rects = declutter(this._badgeGroup, o.avoid ? o.avoid() : null);
      if (o.onLayout) o.onLayout();
      this.lastDrawMs = Math.round(((root.performance || Date).now() - t0) * 10) / 10;
    }
  });

  root.TOT_HEX = {
    MAX_ZONES: MAX_ZONES, MAX_BADGES: MAX_BADGES,
    makeGrid: function () { return LIB.makeGrid(root.h3); },
    createBaseLayer: function (grid) { return new BaseLayer(grid); },
    createZoneLayer: function (grid, opts) { return new ZoneLayer(grid, opts); },
    declutter: declutter
  };
})(typeof self !== 'undefined' ? self : this);
