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

test('banner + explainer copy (EN + ZH): one short line, 4 bullets, details behind More', () => {
  assert.equal(I.en.phasePre, '🎃 Now: decorations · 🔥 Oct 31: fun streets');
  assert.equal(I.zh.phasePre, '🎃 现在：装饰 · 🔥 10月31日：好玩的街');
  assert.equal(I.en.phaseOn, '🔥 Share fun streets until 11 PM');
  assert.ok(!/Halloween is ON/.test(I.en.phaseOn) && !/万圣节开始/.test(I.zh.phaseOn), 'v15: the countdown says it, the banner does not repeat it');
  for (const l of ['en', 'zh']) {
    assert.equal(I[l].phaseBullets.length, 4);
    assert.equal(I[l].phaseItems.length, 4);
    const all = I[l].phaseItems.map((x) => [].concat(x[0], x[1]).join(' ')).join(' ');
    assert.match(all, l === 'en' ? /14 days.*2 hours/ : /14 天.*2 小时/);
    assert.ok(I[l].howtoSections[0][0].includes('🎃'), l + ' How-to starts with what to do now');
    const oct = I[l].phaseItems[1];
    assert.match(oct[0], l === 'en' ? /Oct 31, 3–11 PM/ : /10月31日 下午3–11点/);
    assert.equal(oct[1].length, 3); assert.match(oct[1].join(' '), l === 'en' ? /orange.*\{win\} min.*2 hours/ : /橙色.*\{win\} 分钟.*2 小时/);
    assert.match(I[l].phaseBullets.join(' '), l === 'en' ? /Nov 2/ : /11月2日/);
    assert.ok(I[l].howtoSections[1][0].includes(l === 'en' ? 'Oct 31' : '10月31日'));
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<details id="phaseMore" class="phasemore"><summary data-i18n="phaseMoreLbl">/);
  assert.doesNotMatch(html, /id="phaseTestLine"/, 'test days live in the 🧪 chip, not a second banner line');
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

test('"every action is a gift" line: explainer + board toasts only (v15: off the thank-you cards and the board panel)', () => {
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(I.en.giftLine, 'Every mark, like and comment helps another family have a happier, more magical Halloween 🎃');
  assert.equal(I.zh.giftLine, '你的每一次标记、点赞和留言，都在帮助另一个家庭和小朋友过一个更快乐、更难忘的万圣节 🎃');
  assert.match(html, /id="phaseGift"[^>]*data-i18n="giftLine"/);
  assert.equal((html.match(/data-i18n="giftLine"/g) || []).length, 1, 'one place in the page');
  assert.doesNotMatch(html + js, /markCardGift/);
});
