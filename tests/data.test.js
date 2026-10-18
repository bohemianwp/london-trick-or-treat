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
// v=6 (Oct 17) raised it to 195 KB, now counting tour.js too: live countdown, feedback panel, route hints and the ▶ How to use tour
// (≈ +28 KB raw JS, ≈ +11 KB gzipped incl. CSS). Peng asked for all four; see SUMMARY_countdown.md.
// v=7 (Oct 17) raised it to 205 KB: test-days window + banner, Supabase config, privacy notice (bilingual text).
// v=10 (Oct 17) raised it to 220 KB: parent-focused share button, honest progress card, badges, curb hint (bilingual).
// v=11/12 (Oct 17) raised it to 250 KB: Best decorations layer (decor marks, purple zones, list panel, bilingual guide/privacy text).
// v=13 (Oct 17) raised it to 270 KB: two-phase banner + explainer, welcome card and How-to sections (bilingual text), 8 s card timer.
// v=14 (Oct 17) raised it to 310 KB, now counting sfx.js too: "Best streets from past years" board (bubbles, clustering, post form,
// replies, reports, local adapter), bilingual board/privacy/How-to text, and Web Audio sound effects (no audio files).
// v=15.3 (Oct 18) raised it to 320 KB: v15.1 How-to feature cards + Show me, the past-favourite entry, and plain-sentence
// bilingual Guide / report copy (Peng: every line must say what it is and how to use it).
test('size budget: own JS ≤ 320 KB (SPEC 8.4 was 150 KB, raised in v4, v6, v7, v10, v11, v13, v14 and v15.3; CDN libraries excluded); report JS + CSS', () => {
  const files = ['app.js', 'lib.js', 'backend.js', 'hex.js', 'i18n.js', 'config.js', 'data/areas.js', 'tour.js', 'sfx.js'];
  const js = files.reduce((n, f) => n + fs.statSync(path.join(root, f)).size, 0);
  const css = fs.statSync(path.join(root, 'styles.css')).size;
  const gz = require('node:zlib').gzipSync(Buffer.concat(files.concat('styles.css').map((f) => fs.readFileSync(path.join(root, f)))), { level: 9 }).length;
  const demo = fs.statSync(path.join(root, 'demo.js')).size;
  console.log(`# own JS ${(js / 1024).toFixed(1)} KB + CSS ${(css / 1024).toFixed(1)} KB = ${((js + css) / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzipped` +
              ` (+ demo.js ${(demo / 1024).toFixed(1)} KB, loaded only with ?demo=1)`);
  assert.ok(js <= 320 * 1024, 'own JS ' + js);
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
  assert.deepEqual(json.meta.events.map((e) => e.id), ['pumpkins-after-dark', 'st-thomas-prowl', 'hitv', 'ingersoll-pumpkin-fest', 'candy-crawl', 'clovermead', 'somerset', 'camp-weathered', 'ctv-map']);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'data/areas.js'), 'utf8'), /argyle/i);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'demo.js'), 'utf8'), /argyle/i);
});

// v15.4 (Peng 9:25: "不要添加完，要添加评价最好的，最popular的"; 9:27: "核实活动今年是否存在，确保100%真实")
test('v15.4 events: 5 popular picks, verified 2026 sources, bilingual, out-of-town lines show town + km, every event has an end', () => {
  const byId = Object.fromEntries(json.meta.events.map((e) => [e.id, e]));
  const picks = { 'pumpkins-after-dark': 'pumpkinsafterdark.com', 'st-thomas-prowl': 'downtownpumpkinprowl.ca',
    'ingersoll-pumpkin-fest': 'ingersoll.ca', 'candy-crawl': 'canadalifeplace.com', clovermead: 'clovermead.com' };
  for (const [id, host] of Object.entries(picks)) {
    const e = byId[id];
    assert.ok(e && e.map && typeof e.lat === 'number' && typeof e.lng === 'number', id);
    assert.ok(e.url.includes(host), id + ' links to the organizer (' + host + ')');
    assert.ok(e.name_zh && e.when_zh && e.when_en && /2026/.test(e.when_en) && /2026 年/.test(e.when_zh), id + ' bilingual with 2026 dates');
    assert.ok(L.distM([42.9849, -81.2453], [e.lat, e.lng]) <= 50000, id + ' within 50 km');
  }
  assert.match(byId['st-thomas-prowl'].when_en, /^St\. Thomas · 23 km · /); assert.match(byId['st-thomas-prowl'].when_zh, /^圣托马斯 · 23 公里 · /);
  assert.match(byId['ingersoll-pumpkin-fest'].when_en, /^Ingersoll · 31 km · /); assert.match(byId['ingersoll-pumpkin-fest'].when_zh, /^英格索尔 · 31 公里 · /);
  assert.match(byId.clovermead.when_en, /^Aylmer · 30 km · /); assert.match(byId.clovermead.when_zh, /^艾尔默 · 30 公里 · /);
  assert.ok(!byId.kustermans, 'Kustermans dropped: its page shows no year for the Halloween dates');
  for (const e of json.meta.events) assert.ok(L.eventEndMs(e) !== null, e.id + ' has a valid end');
});

test('v15.4 events hide by themselves once they end (Toronto time; date = through that day, date+time = that minute)', () => {
  const ev = json.meta.events;
  const at = (d, t) => L.zonedToUtcMs ? L.zonedToUtcMs(d, t) : null;
  const ms = (iso) => Date.parse(iso);
  const ids = (now) => L.activeEvents(ev, now).map((e) => e.id);
  // Today (Oct 18, 9 AM EDT): all 9 still to come.
  assert.equal(ids(ms('2026-10-18T13:00:00Z')).length, 9);
  // St. Thomas ends Oct 23 7 PM EDT (23:00Z): shown at 6:59 PM, gone at 7:00 PM.
  assert.ok(ids(ms('2026-10-23T22:59:00Z')).includes('st-thomas-prowl'));
  assert.ok(!ids(ms('2026-10-23T23:00:00Z')).includes('st-thomas-prowl'));
  // Oct 26 noon: the Oct 23/24/25 events are gone, ongoing ones remain.
  assert.deepEqual(ids(ms('2026-10-26T16:00:00Z')), ['pumpkins-after-dark', 'clovermead', 'somerset', 'camp-weathered', 'ctv-map']);
  // Date-only end = through that local day: Oct 31 11:59 PM EDT shown, Nov 1 00:00 EDT gone.
  assert.ok(ids(ms('2026-11-01T03:59:00Z')).includes('pumpkins-after-dark'));
  assert.deepEqual(ids(ms('2026-11-01T04:00:00Z')), []);
  // No / bad end = always shown.
  assert.equal(L.eventActive({ id: 'x' }, ms('2030-01-01T00:00:00Z')), true);
  assert.equal(L.eventEndMs({ end: 'Oct 31' }), null);
  void at;
});
