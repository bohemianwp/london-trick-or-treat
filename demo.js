/* Demo data for ?demo=1 only — loaded on demand by app.js, never on a normal visit.
   Seeds realistic fake marks into the LOCAL adapter (separate ltot.demo.* keys, so demo data never mixes with real data):
   zones of 4, 6, 9, 23 marks around researched areas, hot NEW zones in Hyde Park and Lambeth (no researched area nearby),
   a 2-mark cell that stays hidden (3+ rule), one "community suggested" hexagon, and a few board posts.
   start() then adds a fake mark every few seconds so zones visibly pulse and their counts tick up. */
(function (root) {
  'use strict';
  var LIB = root.TOT_LIB;
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // [name, lat, lng, marks, tag, isNew]
  var ZONES = [
    ['Old South / Baker St', 42.9668, -81.2455, 23, 'candy', false],
    ['Wortley Village', 42.9605, -81.2470, 6, 'decor', false],
    ['Old North', 42.9990, -81.2475, 9, 'decor', false],
    ['Carling Heights', 43.0020, -81.2220, 4, null, false],
    ['Ferndale', 42.9420, -81.2660, 5, 'candy', false],
    ['Hyde Park', 43.0100, -81.3350, 16, 'candy', true],      // no researched area nearby
    ['Lambeth', 42.9050, -81.3000, 7, 'crowded', true],      // no researched area nearby
    ['Pond Mills (only 2: stays hidden)', 42.9440, -81.2070, 2, null, false]
  ];
  // v11 decor demo: [name, lat, lng, decor marks, main tag]
  var DECOR = [
    ['Askin St haunted garages', 42.9712, -81.2398, 14, 'spooky'],
    ['Woodfield lights', 42.9935, -81.2405, 9, 'lights'],
    ['Byron front yards', 42.9615, -81.3290, 6, 'funny'],
    ['Westmount must-see', 42.9465, -81.2930, 4, 'mustsee'],
    ['Huron Heights (only 2: stays hidden)', 43.0180, -81.2150, 2, 'lights']
  ];
  // v14 board demo: [lat, lng, tag, note, likes, hearts, families, replies]
  var FAV = [
    [42.9672, -81.2449, 'festive', 'Best street every year! Whole block goes all out 🎃 / 每年都超有气氛！', 14, 9, 21, ['So true, we go every year!', '同意！小朋友超喜欢']],
    [42.9606, -81.2466, 'littlekids', 'Gentle and friendly, perfect for toddlers / 很适合小小孩', 6, 5, 9, ['Thanks for the tip!']],
    [42.9989, -81.2470, 'candy', 'Full-size bars on this stretch in 2024 🍫', 8, 2, 11, []],
    [42.9420, -81.2655, 'walking', 'Wide sidewalks, easy stroller loop / 人行道宽，推车方便', 3, 1, 4, []],
    [43.0101, -81.3352, 'festive', 'Huge light show last year ✨', 4, 4, 6, []],
    [42.9050, -81.2995, 'candy', '', 1, 0, null, []]
  ];
  var SUGGEST = [
    [43.0262, -81.2765, 'Lots of porch lights on our crescent'],
    [43.0262, -81.2765, '很多人家装饰，街道安静'],
    [43.0262, -81.2765, 'Quiet loop, great for toddlers'],
    [43.0200, -81.1700, 'East-end kids go out early']               // only 1: not promoted
  ];
  var rnd = mulberry(Math.floor(Date.now() / 3600000));
  // A random point inside the zone's hexagon (keeps it in the same cell).
  function near(grid, cell) {
    var c = grid.center(cell), r = 60 + rnd() * 140, a = rnd() * 6.283;
    var p = [c[0] + r * Math.sin(a) / 111320, c[1] + r * Math.cos(a) / 81450];
    return grid.cell(p[0], p[1]) === cell ? p : c;
  }
  function demoMark(grid, cell, tag, at, i) {
    var p = near(grid, cell), b = LIB.blurPoint(p[0], p[1], rnd);
    return { id: 'demo-' + cell + '-' + i + '-' + at, sidHash: 'demo' + Math.floor(rnd() * 1e9), lat: LIB.round(b[0], 4), lng: LIB.round(b[1], 4),
             cell: cell, tags: tag && rnd() < 0.6 ? [tag] : [], createdAt: at, tokenHash: 'demo' };
  }

  // seed(localAdapter, grid): replace old demo marks with fresh ones (relative to now), add suggestions/posts once.
  function seed(local, grid) {
    var now = local.now(), win = LIB.clampWindow(local.cfg.markWindowMin) * 60000;
    var marks = local._get('marks', []).filter(function (m) { return String(m.id).indexOf('demo-') !== 0; });
    ZONES.forEach(function (z) {
      var cell = grid.cell(z[1], z[2]);
      for (var i = 0; i < z[3]; i++) {
        // NEW zones lit up in the last ~20 min; the others' first 3 marks are 32–40 min old (lit up earlier, still in the window).
        var age = z[5] ? (20 - i) * 60000 * (0.4 + rnd() * 0.6) : i < 3 ? (32 + i * 3) * 60000 : rnd() * (win - 6 * 60000);
        marks.push(demoMark(grid, cell, z[4], now - Math.max(15000, Math.round(age)), i));
      }
    });
    local._set('marks', marks);
    // Decor marks spread over the last 13 days (counted over 14 days), ~60% with the zone's main tag.
    var decor = local._get('decor', []).filter(function (m) { return String(m.id).indexOf('demo-') !== 0; });
    DECOR.forEach(function (z) {
      var cell = grid.cell(z[1], z[2]);
      for (var i = 0; i < z[3]; i++) {
        var p = near(grid, cell), b = LIB.blurPoint(p[0], p[1], rnd), tags = rnd() < 0.6 ? [z[4]] : rnd() < 0.3 ? ['mustsee'] : [];
        decor.push({ id: 'demo-decor-' + cell + '-' + i, dayHash: 'demo' + i, lat: LIB.round(b[0], 4), lng: LIB.round(b[1], 4), cell: cell,
                     tags: tags, createdAt: now - Math.round((0.05 + rnd() * 12.9) * 864e5) });
      }
    });
    local._set('decor', decor);
    if (!local._get('demoSeeded', false)) {
      var sug = local._get('suggestions', []);
      SUGGEST.forEach(function (s, i) {
        var cell = grid.cell(s[0], s[1]), c = grid.center(cell);
        sug.push({ id: 'demo-sug-' + i, deviceHash: 'demo' + i, cell: cell, lat: LIB.round(c[0], 4), lng: LIB.round(c[1], 4), reason: s[2],
                   createdAt: now - (i + 1) * 3600000 });
      });
      local._set('suggestions', sug);
      var posts = local._get('posts', []);
      [['fun', 'old-south-baker', 'Baker St is the place! Go before 6 PM if your kids are little. / Baker 街最热闹，孩子小就 6 点前去。', 12],
       ['fun', 'old-north', 'Old North was busy but friendly, lots of porch lights. / 老北区人多但很友好。', 7],
       ['decor', 'east-wethered', 'Camp Weathered display is huge, bring a food donation. / Camp Weathered 装饰超大。', 9],
       ['decor', 'old-south-baker', 'Haunted garage on Askin St, not too scary for 5-year-olds. / Askin 街鬼屋车库，不太吓人。', 4],
       ['fun', 'carling-heights', 'Quieter streets, good for toddlers. / 街道安静，适合小小孩。', 3]].forEach(function (x, i) {
        posts.push({ id: 'demo-post-' + i, board: x[0], areaId: x[1], lat: null, lng: null, body: x[2], votes: x[3], reports: 0,
                     createdAt: now - (i + 1) * 3600000, tokenHash: 'demo' });
      });
      local._set('posts', posts);
      local._set('demoSeeded', true);
    }
    if (!local._get('demoFavSeeded', false)) {
      var f = local._get('fav', null) || { pins: [], replies: [], reactions: [], reports: [] };
      FAV.forEach(function (x, i) {
        var pos = LIB.favSnap(x[0], x[1]), id = 'demo-fav-' + i;
        f.pins.push({ id: id, dev: 'demo-fav-dev-' + i, lat: pos[0], lng: pos[1], tag: x[2], body: x[3] || null, likes: x[4], hearts: x[5],
                      families: x[6], reports: 0, tokenHash: 'demo', createdAt: now - (i + 2) * 3600000 });
        x[7].forEach(function (b, j) {
          f.replies.push({ id: id + '-r' + j, pin: id, dev: 'demo-r' + j, body: b, reports: 0, tokenHash: 'demo', createdAt: now - (i + 1) * 3600000 + j * 60000 });
        });
      });
      local._set('fav', f);
      local._set('demoFavSeeded', true);
    }
    start(local, grid);
  }
  // A new fake mark every ~4 s, mostly in the hot zones, so counts tick up while you watch.
  var timer = null, n = 0;
  function tick(local, grid) {
    var weights = [6, 1, 2, 1, 1, 4, 2, 0], sum = 15, r = rnd() * sum, k = 0;
    while (r > weights[k]) { r -= weights[k]; k++; }
    var z = ZONES[k], cell = grid.cell(z[1], z[2]);
    var marks = local._get('marks', []);
    marks.push(demoMark(grid, cell, z[4], local.now(), 'live' + (n++)));
    local._set('marks', marks);
  }
  function start(local, grid) {
    if (timer) return;
    timer = setInterval(function () { if (root.document && root.document.visibilityState === 'visible') tick(local, grid); }, 4000);
  }
  root.TOT_DEMO = { seed: seed, tick: function () { /* start() drives the ticks */ }, addOne: tick, ZONES: ZONES, SUGGEST: SUGGEST, DECOR: DECOR, FAV: FAV };
})(typeof self !== 'undefined' ? self : this);
