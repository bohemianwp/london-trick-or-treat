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
  const skip = new Set(['.langBtn', '.demoChip', '.charCount', '.hoursFmt', '.votesN', '.ageTeen']);
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
  for (const k of ['mt_candy', 'mt_teal', 'mt_fullsize', 'mt_decor', 'mt_pet', 'mt_early', 'st_giving', 'st_later', 'st_out',
                   'err_empty', 'err_tooLong', 'err_url', 'err_email', 'err_phone', 'err_profanity', 'err_rate', 'err_forbidden',
                   'err_invalid', 'err_closed', 'err_outside', 'err_network', 'legendQuiet', 'legendBusy', 'legendVery']) {
    assert.ok(k in I18N.en && k in I18N.zh, 'missing dynamic key ' + k);
  }
});

test('consent text is exactly the wording from the spec', () => {
  assert.equal(I18N.en.consent, "Share an anonymous dot so other families can see where it's busy. No name, rough location only, disappears after 30 minutes.");
});
