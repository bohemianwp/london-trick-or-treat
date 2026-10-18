'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18N = require('../i18n.js');

function shape(v, p, out) {
  if (Array.isArray(v)) { out.push(p + '[' + v.length + ']'); v.forEach((x, i) => shape(x, p + '[' + i + ']', out)); }
  else if (v && typeof v === 'object') Object.keys(v).sort().forEach((k) => shape(v[k], p + '.' + k, out));
  else out.push(p + ':' + typeof v);
  return out;
}
function leaves(v, p, out) {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, p + '[' + i + ']', out));
  else if (v && typeof v === 'object') Object.keys(v).forEach((k) => leaves(v[k], p + '.' + k, out));
  else out.push([p, v]);
  return out;
}

test('en and zh have exactly the same keys (deep, including array lengths)', () => {
  assert.deepEqual(shape(I18N.zh, '', []), shape(I18N.en, '', []));
});

test('no empty strings, and {placeholders} match between languages', () => {
  const en = new Map(leaves(I18N.en, '', [])), zh = new Map(leaves(I18N.zh, '', []));
  for (const [k, v] of en) {
    assert.ok(String(v).trim().length > 0, 'empty en ' + k);
    assert.ok(String(zh.get(k)).trim().length > 0, 'empty zh ' + k);
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(zh.get(k)), ph(v), 'placeholders differ for ' + k);
  }
});

test('Chinese strings are actually Chinese (not copied English)', () => {
  const skip = new Set(['.langBtn', '.demoChip', '.ageTeen']);
  const same = leaves(I18N.en, '', []).filter(([k, v]) => !skip.has(k) && /[a-z]{4,}/i.test(v) && leaves(I18N.zh, '', []).find(([k2]) => k2 === k)[1] === v);
  assert.deepEqual(same.map((x) => x[0]), []);
});

test('every data-i18n key used in index.html exists', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 40);
  keys.forEach((k) => assert.ok(k in I18N.en && k in I18N.zh, 'missing ' + k));
});

test("every t('key') used in app.js exists", () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const keys = new Set([...js.matchAll(/\bt\('(\w+)'[,)]/g)].map((m) => m[1]));
  keys.forEach((k) => assert.ok(k in I18N.en && k in I18N.zh, 'missing ' + k));
  for (const k of ['tag_candy', 'tag_decor', 'tag_crowded', 'tapForStart', 'tapForMark', 'tapForSuggest', 'rateZone', 'rateDevice',
                   'nearFromMe', 'nearFromMap', 'nearFromDemo', 'suggestRateHex', 'zoneTarget', 'layerZones', 'layerAreas', 'layerEvents', 'err_tooLong80',
                   'err_empty', 'err_tooLong', 'err_url', 'err_email', 'err_phone', 'err_profanity', 'err_rate', 'err_forbidden',
                   'err_invalid', 'err_closed', 'err_outside', 'err_network', 'legendQuiet', 'legendLively', 'legendHot']) {
    assert.ok(k in I18N.en && k in I18N.zh, 'missing dynamic key ' + k);
  }
});

test('no house / live-dot strings are left over from v2', () => {
  for (const k of ['addHouse', 'mt_teal', 'st_giving', 'fTeal', 'shareHouses', 'consent', 'shareToggle', 'layerHouses', 'layerDots', 'tabPins', 'tabLive', 'hintShare', 'hintFilters']) {
    assert.ok(!(k in I18N.en) && !(k in I18N.zh), 'left over: ' + k);
  }
});

test('big kid-friendly wording from the spec, in both languages (v15 short copy)', () => {
  assert.equal(I18N.en.markBtn, 'Fun street? Share it 🔥');
  assert.equal(I18N.zh.markBtn, '这条街好玩？分享 🔥');
  assert.deepEqual([I18N.en.tag_candy, I18N.en.tag_decor, I18N.en.tag_crowded], ['Lots of candy', 'Great decorations', 'Crowded']);
  assert.deepEqual([I18N.zh.tag_candy, I18N.zh.tag_decor, I18N.zh.tag_crowded], ['糖很多', '装饰超棒', '人很多']);
  assert.deepEqual([I18N.en.tabMap, I18N.en.tabRoute, I18N.en.tabMark, I18N.en.tabGuide], ['Map', 'Route', 'Mark it!', 'Guide']);
  assert.deepEqual([I18N.zh.tabMap, I18N.zh.tabRoute, I18N.zh.tabMark, I18N.zh.tabGuide], ['地图', '路线', '标记！', '指南']);
  assert.deepEqual([I18N.en.legendQuiet, I18N.en.legendLively, I18N.en.legendHot, I18N.en.legendDecor], ['Quiet', 'Busy', 'Very busy', 'Decorations']);
  assert.deepEqual([I18N.zh.legendLively, I18N.zh.legendHot, I18N.zh.legendDecor], ['热闹', '非常热闹', '装饰']);
  assert.equal(I18N.en.zoneCount.replace('{n}', 23), '🔥 23 marks');   // v15.1: Peng found “now 23” vague
  assert.equal(I18N.zh.zoneCount.replace('{n}', 23), '🔥 23 个标记');
  assert.equal(I18N.en.decorBadge.replace('{n}', 14), '🎃 14 likes'); assert.equal(I18N.zh.decorBadge.replace('{n}', 14), '🎃 14 个赞');
  assert.equal(I18N.en.newBadge, 'NEW'); assert.equal(I18N.zh.newBadge, '新发现');
  assert.equal(I18N.en.practiceChip, '🧪 Practice'); assert.equal(I18N.zh.practiceChip, '🧪 练习');
  assert.equal(I18N.en.testChip, '🧪 Test days'); assert.equal(I18N.zh.testChip, '🧪 试用期');
  assert.equal(I18N.en.nearBtn, '📍 Near me'); assert.equal(I18N.zh.layerNear, '我附近');
  assert.equal(I18N.en.suggestBtn, '📌 Suggest an area'); assert.equal(I18N.zh.suggestBtn, '📌 推荐一个区域');
  assert.equal(I18N.en.communityTag, 'Community suggested'); assert.equal(I18N.zh.communityTag, '社区推荐');
  assert.equal(I18N.en.notOnMap, 'Your street isn’t lit? Share it. 3 marks light it up.');
});
