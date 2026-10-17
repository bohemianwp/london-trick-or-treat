/* Hotspot hexagon layer: ONE <canvas> for all hexes, no per-hex DOM or listeners.
   Uses h3-js (resolution 8) when it loaded from the CDN, otherwise the local hex grid in lib.js.
   Glow = canvas shadowBlur (the canvas equivalent of CSS drop-shadow), only on "very busy" cells. */
(function (root) {
  'use strict';
  var L = root.L, LIB = root.TOT_LIB;
  if (!L || !LIB) return;

  var STYLE = {
    quiet: { fill: 'rgba(45,212,191,0.28)', stroke: 'rgba(45,212,191,0.75)', glow: null },
    busy: { fill: 'rgba(255,122,24,0.42)', stroke: 'rgba(255,160,70,0.95)', glow: 'rgba(255,122,24,0.7)' },
    very: { fill: 'rgba(255,45,120,0.5)', stroke: 'rgba(255,110,190,1)', glow: 'rgba(255,40,140,1)' }
  };
  var MAX = 400;

  var HexLayer = L.Layer.extend({
    initialize: function (grid) { this.grid = grid; this.plan = []; this.live = []; this.mode = 'plan'; this.lastDrawMs = 0; },
    onAdd: function (map) {
      this._map = map;
      if (!map.getPane('hexPane')) {
        var pane = map.createPane('hexPane');
        pane.style.zIndex = 350;              // under area circles & markers
        pane.style.pointerEvents = 'none';
      }
      this._c = L.DomUtil.create('canvas', 'hex-canvas leaflet-zoom-hide', map.getPane('hexPane'));
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
    },
    onRemove: function (map) {
      map.off('moveend zoomend resize', this._reset, this);
      L.DomUtil.remove(this._c);
      this._c = null;
    },
    // plan: [{cell, score}], live: [{cell, count}] (already >= min count), mode: 'plan' | 'live'
    setData: function (plan, live, mode) {
      this.plan = plan || []; this.live = live || []; this.mode = mode;
      if (this._c) this._draw();
    },
    _reset: function () {
      var map = this._map, size = map.getSize(), dpr = Math.min(root.devicePixelRatio || 1, 2);
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      this._dpr = dpr;
      this._draw();
    },
    _bounds: function () {
      var b = this._map.getBounds().pad(0.15);
      return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
    },
    _path: function (ctx, cell) {
      var map = this._map, pts = this.grid.boundary(cell);
      for (var i = 0; i < pts.length; i++) {
        var p = map.latLngToContainerPoint(pts[i]);
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
    },
    _pass: function (ctx, items, bucketOf, alpha) {
      var self = this, groups = { quiet: [], busy: [], very: [] };
      items.forEach(function (h) { groups[bucketOf(h)].push(h); });
      ['quiet', 'busy', 'very'].forEach(function (k) {
        var st = STYLE[k];
        if (!groups[k].length) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = st.fill; ctx.strokeStyle = st.stroke; ctx.lineWidth = k === 'very' ? 2 : 1.2;
        ctx.shadowColor = st.glow || 'transparent'; ctx.shadowBlur = st.glow && alpha > 0.5 ? (k === 'very' ? 18 : 8) : 0;
        groups[k].forEach(function (h) { ctx.beginPath(); self._path(ctx, h.cell); ctx.fill(); ctx.stroke(); });
      });
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    },
    _draw: function () {
      if (!this._c) return;
      var t0 = (root.performance || Date).now();
      var ctx = this._c.getContext('2d'), b = this._bounds();
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this._c.width, this._c.height);
      var plan = LIB.clipToBounds(this.plan, this.grid, b, MAX);
      if (this.mode === 'live') {
        var live = LIB.clipToBounds(this.live, this.grid, b, MAX);
        this._pass(ctx, plan.slice(0, Math.max(0, MAX - live.length)), function (h) { return LIB.planBucket(h.score); }, 0.3);
        this._pass(ctx, live, function (h) { return LIB.liveBucket(h.count); }, 1);
        this.drawn = plan.length + live.length;
      } else {
        this._pass(ctx, plan, function (h) { return LIB.planBucket(h.score); }, 1);
        this.drawn = plan.length;
      }
      this.lastDrawMs = Math.round(((root.performance || Date).now() - t0) * 10) / 10;
    },
    // Tap lookup without DOM listeners: lat/lng -> cell id -> data.
    lookup: function (latlng) {
      var cell = this.grid.cell(latlng.lat, latlng.lng);
      var live = this.live.filter(function (h) { return h.cell === cell; })[0];
      var plan = this.plan.filter(function (h) { return h.cell === cell; })[0];
      return { cell: cell, live: live || null, plan: plan || null };
    }
  });

  root.TOT_HEX = {
    makeGrid: function () { return LIB.makeGrid(root.h3); },
    createLayer: function (grid) { return new HexLayer(grid); }
  };
})(typeof self !== 'undefined' ? self : this);
