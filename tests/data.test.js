'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../lib.js');

const root = path.join(__dirname, '..');
const json = JSON.parse(fs.readFileSync(path.join(root, 'data/areas_researched.json'), 'utf8'));
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'data/areas.js'), 'utf8'), sandbox);

test('data/areas.js is generated from areas_researched.json (run tools/gen_areas.py if this fails)', () => {
  const shipped = JSON.parse(JSON.stringify(sandbox.window.TOT_AREAS_RAW));
  assert.deepEqual(shipped.areas, json.areas);
  for (const k of ['generated', 'label_en', 'label_zh', 'events']) assert.deepEqual(shipped.meta[k], json.meta[k], k);
});

// SPEC 8.4 said 150 KB. v4 (Oct 17) raised it to 170 KB for the bilingual welcome guide + How-to text, which must live in
// i18n.js (Chinese is 3 bytes per character). Cost over the network: about +5 KB gzipped. Keep new features under this line.
test('size budget: own JS ≤ 170 KB (SPEC 8.4 was 150 KB, raised in v4; CDN libraries excluded); report JS + CSS', () => {
  const files = ['app.js', 'lib.js', 'backend.js', 'hex.js', 'i18n.js', 'config.js', 'data/areas.js'];
  const js = files.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  const css = fs.statSync(path.join(root, 'styles.css')).size;
  const gz = require('node:zlib').gzipSync(Buffer.concat(files.concat('styles.css').map((f) => fs.readFileSync(path.join(root, f)))), { level: 9 }).length;
  const demo = fs.statSync(path.join(root, 'demo.js')).size;
  console.log(`# own JS ${(js / 1024).toFixed(1)} KB + CSS ${(css / 1024).toFixed(1)} KB = ${((js + css) / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzipped` +
              ` (+ demo.js ${(demo / 1024).toFixed(1)} KB, loaded only with ?demo=1)`);
  assert.ok(js <= 170 * 1024, 'own JS ' + js);
});

test('10 researched areas, bilingual, inside London, sources dated Oct 2024–Oct 2026', () => {
  assert.equal(json.areas.length, 10);
  assert.equal(json.meta.label_en, 'Based on local news and parent reports, 2026');
  assert.equal(json.meta.label_zh, '根据本地新闻和家长反馈整理，2026');
  for (const a of json.areas) {
    assert.ok(L.inLondonBox(a.lat, a.lng), a.id);
    for (const k of ['name_en', 'name_zh', 'notes_en', 'notes_zh', 'cautions', 'cautions_zh']) assert.ok(a[k], a.id + ' ' + k);
    assert.ok(a.sources.length > 0, a.id + ' has sources');
    for (const s of a.sources) {
      assert.match(s.date, /^(2024-1[0-2]|2025|2026)/, a.id + ' source date ' + s.date);
      assert.match(s.url, /^https:\/\//);
    }
    const m = L.mapArea(a);
    assert.equal(m.s.crowd, 6 - a.scores.crowd, 'crowd inverted for ' + a.id);
  }
});

test('events: HitV (Oct 24), Camp Weathered (65 Wethered St), Somerset Monster House (71 Somerset Cres) on the map', () => {
  const byId = Object.fromEntries(json.meta.events.map((e) => [e.id, e]));
  for (const id of ['hitv', 'camp-weathered', 'somerset']) {
    const e = byId[id];
    assert.ok(e && e.map, id);
    assert.ok(L.inLondonBox(e.lat, e.lng), id + ' inside London');
    assert.ok(e.name_zh && e.when_zh && e.when_en, id + ' bilingual');
  }
  assert.match(byId.hitv.when_en, /Oct 24, 2026/);
  assert.match(byId['camp-weathered'].name_en, /65 Wethered St/);
  assert.match(byId.somerset.name_en, /71 Somerset Cres/);
});

test('past "Halloween in Argyle" event (Oct 17) is gone from the data and the shipped JS', () => {
  assert.ok(!json.meta.events.some((e) => e.id === 'argyle'));
  assert.deepEqual(json.meta.events.map((e) => e.id), ['hitv', 'somerset', 'camp-weathered', 'ctv-map']);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'data/areas.js'), 'utf8'), /argyle/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'demo.js'), 'utf8'), /argyle/i);
});
