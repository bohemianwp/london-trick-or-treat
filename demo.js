/* Demo data for ?demo=1 only — loaded on demand by app.js, never on a normal visit.
   Adds synthetic "other families" (dots), a few board posts and house markers to the LOCAL adapter,
   stored under the separate ltot.demo.* keys so demo data never mixes with real data. */
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

  // seed(localAdapter, areas): refresh demo dots (called every poll) and add demo posts/markers once.
  function seed(local, areas) {
    var now = local.now(), dots = LIB.pruneDots(local._get('dots', []), now, 30).filter(function (d) { return d.sidHash.indexOf('demo') !== 0; });
    var plan = [[0, 22], [1, 8], [3, 5], [7, 4], [4, 2]];          // [area index, dots]; area 0 is dense enough for "very busy"
    var rnd = mulberry(Math.floor(now / 600000));
    plan.forEach(function (pl) {
      var a = areas[pl[0]];
      if (!a) return;
      for (var i = 0; i < pl[1]; i++) {
        var ang = rnd() * 6.283, r = pl[0] === 0 && i < 14 ? 30 + rnd() * 150 : 60 + rnd() * 380;
        dots.push({ sidHash: 'demo' + pl[0] + '-' + i, lat: LIB.round(a.lat + r * Math.sin(ang) / 111320, 4),
                    lng: LIB.round(a.lng + r * Math.cos(ang) / 81450, 4), h3: null, updatedAt: now - Math.floor(rnd() * 9) * 60000 });
      }
    });
    local._set('dots', dots);
    if (!local._get('demoSeeded', false)) {
      var posts = local._get('posts', []);
      [['fun', 'old-south-baker', 'Baker St is the place! Go before 6 PM if your kids are little. / Baker 街最热闹，孩子小就 6 点前去。', 12],
       ['fun', 'old-north', 'Old North was busy but friendly, lots of porch lights. / 老北区人多但很友好。', 7],
       ['decor', 'east-wethered', 'Camp Weathered display is huge, bring a food donation. / Camp Weathered 装饰超大。', 9],
       ['decor', 'old-south-baker', 'Haunted garage on Askin St, not too scary for 5-year-olds. / Askin 街鬼屋车库，不太吓人。', 4],
       ['fun', 'carling-heights', 'Quieter streets, good for toddlers. / 街道安静，适合小小孩。', 3]].forEach(function (x, i) {
        posts.push({ id: 'demo-post-' + i, board: x[0], areaId: x[1], lat: null, lng: null, body: x[2], votes: x[3], reports: 0,
                     createdAt: now - (i + 1) * 3600000, tokenHash: 'demo' });
      });
      var mk = local._get('markers', []);
      [[42.9675, -81.2462, ['candy', 'fullsize'], 'giving', 'Full-size bars while they last! 🍫'],
       [42.9661, -81.2440, ['teal', 'candy'], 'giving', 'Teal pumpkin: non-food treats in a separate bowl.'],
       [42.9684, -81.2475, ['decor'], 'later', 'Haunted garage opens at 6 PM.'],
       [42.9652, -81.2468, ['candy', 'early'], 'out', 'All out, thank you!'],
       [42.9690, -81.2450, ['candy', 'pet'], 'giving', 'Dog treats for your four-legged trick-or-treaters.']].forEach(function (x, i) {
        mk.push({ id: 'demo-mk-' + i, lat: x[0], lng: x[1], types: x[2], status: x[3], note: x[4], start: '17:30', end: '20:30',
                  expiresAt: LIB.MARKER_EXPIRES_MS, createdAt: now, tokenHash: 'demo' });
      });
      local._set('markers', mk);
      local._set('posts', posts);
      local._set('demoSeeded', true);
    }
  }
  root.TOT_DEMO = { seed: seed };
})(typeof self !== 'undefined' ? self : this);
