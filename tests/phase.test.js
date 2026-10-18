'use strict';
// v13: two phases (decorations now, fun streets on Oct 31), banner/explainer copy, 8 s cards, quiet-zone emoji.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const I = require('../i18n.js');
const root = path.join(__dirname, '..');

test('appPhase: decor until Oct 31 3 PM Toronto, night until Nov 1 00:00, then after', () => {
  assert.equal(L.appPhase(Date.parse('2026-10-17T20:00:00Z')), 'decor');
  assert.equal(L.appPhase(Date.parse('2026-10-31T18:59:59Z')), 'decor', '2:59:59 PM');
  assert.equal(L.appPhase(Date.parse('2026-10-31T19:00:00Z')), 'night', '3 PM');
  assert.equal(L.appPhase(Date.parse('2026-11-01T03:59:59Z')), 'night', '11:59:59 PM');
  assert.equal(L.appPhase(Date.parse('2026-11-01T04:00:00Z')), 'after');
  assert.equal(L.decorPrimary(Date.parse('2026-10-31T19:00:00Z'), true), false, 'demo follows the calendar too');
});

test('banner + explainer copy (EN + ZH)', () => {
  assert.equal(I.en.phasePre, '🎃 Now: mark the best decorations · 🔥 Oct 31: mark the most fun streets');
  assert.equal(I.zh.phasePre, '🎃 现在：标记最棒的装饰 · 🔥 10月31日：标记最好玩的街');
  assert.equal(I.en.phaseOn, 'Halloween is ON! Mark the most fun streets 🔥');
  for (const l of ['en', 'zh']) {
    assert.equal(I[l].phaseItems.length, 4);
    const all = I[l].phaseItems.map((x) => x.join(' ')).join(' ');
    assert.match(all, l === 'en' ? /14 days.*deleted after Halloween/ : /14 天.*万圣节后/);
    assert.ok(I[l].howtoSections[0][0].includes('🗓️'), l + ' How-to starts with the two phases');
    const oct = I[l].phaseItems[1];
    assert.match(oct[0], l === 'en' ? /What’s different on Oct 31/ : /31号有什么不同/);
    assert.equal(oct[1].length, 5); assert.match(oct[1].join(' '), l === 'en' ? /3 PM.*\{win\} minutes.*2 hours.*3–11 PM.*Nov 2/ : /下午 3 点.*\{win\} 分钟.*2 小时.*11 月 2 日/);
    assert.ok(I[l].howtoSections[1][0].includes(l === 'en' ? 'Oct 31' : '31号'));
  }
});

test('quiet zones get a non-fire emoji in the progress line', () => {
  assert.deepEqual(L.BUCKET_ICON, { quiet: '🕯️', lively: '🎉', hot: '🔥' });
  assert.match(I.en.progLit, /\{bucket\} \{icon\}$/);
  assert.doesNotMatch(I.en.progLit + I.zh.progLit, /🔥/);
});

test('cards stay ~8 s, pause while touched, decor auto-share 8 s; Done/✕ kept', () => {
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(js, /var CARD_MS = 8000;/); assert.match(js, /var DECOR_PEND_MS = 8000;/);
  assert.match(js, /addEventListener\('pointerdown', function \(e\) \{ if \(inCard\(e\)\) pauseCard\(\); \}\)/);
  assert.match(html, /id="markCardDone"/); assert.match(html, /id="markCardClose"/);
  assert.match(html, /id="phaseBanner"/); assert.doesNotMatch(html, /id="testBanner"/);
});

test('"every action is a gift" line on the explainer and the thank-you cards (EN + ZH, exact copy)', () => {
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(I.en.giftLine, 'Every mark, like and comment helps another family have a happier, more magical Halloween 🎃');
  assert.equal(I.zh.giftLine, '你的每一次标记、点赞和留言，都在帮助另一个家庭和小朋友过一个更快乐、更难忘的万圣节 🎃');
  assert.match(html, /id="phaseGift"[^>]*data-i18n="giftLine"/);
  assert.match(html, /id="markCardGift"[^>]*data-i18n="giftLine"/);
  assert.equal((js.match(/\$\('markCardGift'\)\.hidden = false;/g) || []).length, 2, 'shown on the fun-street and decor thank-you cards');
  assert.equal((js.match(/\$\('markCardGift'\)\.hidden = true;/g) || []).length, 3, 'hidden on rate / pending cards');
});
