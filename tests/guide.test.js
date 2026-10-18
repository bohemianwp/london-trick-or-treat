'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const I18N = require('../i18n.js');

const root = path.join(__dirname, '..');

// A tiny stand-in for window.localStorage.
function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };

test('guide / How-to / hint strings exist in both languages', () => {
  const keys = ['helpAria', 'guideTitle', 'guideSkip', 'guideDone', 'guidePrev', 'guideNext', 'guideStep', 'guideDotAria', 'guideLegend',
    'guideCards', 'howtoTitle', 'howtoIntro', 'howtoReplay', 'howtoSections', 'infoAria', 'hintMark', 'hintLegend', 'notOnMap'];
  for (const k of keys) for (const l of ['en', 'zh']) assert.ok(I18N[l][k], `${l}.${k} missing`);
  for (const l of ['en', 'zh']) {
    assert.equal(I18N[l].guideCards.length, 3, l + ': exactly 3 welcome cards');
    assert.equal(I18N[l].howtoSections.length, 14, l + ': 14 How-to sections');
    for (const c of I18N[l].guideCards) assert.ok(typeof c[0] === 'string' && c[1].length >= 2, l + ' card ' + c[0]);
  }
});

test('welcome cards and How-to cover the new product (EN + 中文)', () => {
  const cards = I18N.en.guideCards.map((c) => c[0] + ' ' + c[1].join(' '));
  assert.match(cards[0], /^See where it’s fun!/); assert.match(cards[0], /Glowing hexagons/); assert.match(cards[0], /3 or more/); assert.match(cards[0], /NEW/);
  assert.match(cards[0], /Your area isn’t on the map\? Mark it! Once 3 people mark it, it lights up\./);
  assert.match(cards[1], /^Great street\? Share it with one tap!/); assert.match(cards[1], /Great street\? Share it!/); assert.match(cards[1], /While the kids knock on doors/);
  assert.match(cards[1], /Lots of candy, Great decorations, Crowded/); assert.match(cards[1], /skip/);
  assert.match(cards[2], /^Plan your walk & stay safe/); assert.match(cards[2], /Show my location/); assert.match(cards[2], /Route/);
  assert.match(cards[2], /Safety/); assert.match(cards[2], /grown-up/); assert.match(cards[2], /50 m/);
  const zc = I18N.zh.guideCards.map((c) => c[0] + ' ' + c[1].join(' '));
  assert.match(zc[0], /你家附近不在地图上？标记它！3 个人标记后就会亮起来。/);
  assert.match(zc[1], /这条街不错？分享给大家！/); assert.match(zc[1], /孩子们敲门的时候/); assert.match(zc[1], /糖很多、装饰超棒、人很多/); assert.match(zc[2], /大人/);
  const howto = I18N.en.howtoSections.map((s) => s[0] + ' ' + s[1].join(' ')).join('\n');
  for (const w of ['big button', 'Great street? Share it!', 'Street Scout', 'Tags', 'Teal = Quiet', 'Orange = Lively', 'Hot pink = Super hot', '🔥 23 marked',
    '3 or more', 'Bottom tabs', 'Mark it!', 'Layer chips', 'Near me', 'Route', 'Suggest an area', 'Board', 'Safety', 'Privacy', '50 m', '2 hours',
    'Your area isn’t on the map? Mark it! Once 3 people mark it, it lights up.']) {
    assert.ok(howto.includes(w), 'How-to mentions ' + w);
  }
  for (const w of ['Add my house', 'Share link', 'Teal only', 'Giving now']) assert.ok(!howto.includes(w), 'house feature gone: ' + w);
  const zh = I18N.zh.howtoSections.map((s) => s[0] + ' ' + s[1].join(' ')).join('\n');
  for (const w of ['大按钮', '标签', '超级火爆', '🔥 23 人标记', '3 个人', '我附近', '推荐一个区域', '投票板', '50 米', '2 小时',
    '你家附近不在地图上？标记它！3 个人标记后就会亮起来。']) assert.ok(zh.includes(w), 'zh How-to mentions ' + w);
});

test('index.html: 4 tabs with Mark it! in the centre, big button ≥ 64 px, hints, guide dialog, all assets ?v=5', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="helpBtn"/);
  assert.match(html, /id="guide" class="guide" role="dialog" aria-modal="true"/);
  assert.match(html, /id="panel-guide"/);
  assert.deepEqual([...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]), ['map', 'route', 'mark', 'guide']);
  assert.match(html, /data-tab="mark" class="tab-mark"/);
  assert.match(html, /id="markBtn" class="markbtn"/);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.ok(Number(/\.markbtn \{[^}]*min-height: (\d+)px/.exec(css)[1]) >= 64, 'big button at least 64 px tall');
  for (const id of ['hintMark', 'hintLegend']) assert.match(html, new RegExp(`aria-controls="${id}"`));
  for (const gone of ['addHouseBtn', 'filterChips', 'shareBtn', 'houseDialog', 'shareToggle', 'panel-live', 'panel-pins']) assert.doesNotMatch(html, new RegExp(gone));
  const own = [...html.matchAll(/(?:src|href)="((?!https?:)[^"]+\.(?:js|css)[^"]*)"/g)].map((m) => m[1]);
  assert.ok(own.length >= 8, own.join());
  own.forEach((u) => assert.match(u, /\?v=12$/, u));
  assert.doesNotMatch(html, /\?v=[345]\b/);
});

test('URL params: ?guide=1, ?howto=1, ?lang=zh|en, ?demo=1, ?near=1', () => {
  const none = { guide: false, howto: false, lang: null, demo: false, near: false, feedback: false, tour: false, tourStep: null, nudge: false, decor: false };
  assert.deepEqual(L.parseUrlFlags(''), none);
  assert.deepEqual(L.parseUrlFlags('?guide=1'), { ...none, guide: true });
  assert.deepEqual(L.parseUrlFlags('?howto=1&lang=zh'), { ...none, howto: true, lang: 'zh' });
  assert.deepEqual(L.parseUrlFlags('?demo=1&lang=en&guide=true'), { ...none, guide: true, lang: 'en', demo: true });
  assert.deepEqual(L.parseUrlFlags('?demo=1&near=1&lang=zh'), { ...none, demo: true, near: true, lang: 'zh' });
  assert.equal(L.parseUrlFlags('?lang=zh-CN').lang, 'zh');
  assert.equal(L.parseUrlFlags('?LANG=ZH').lang, 'zh');
  assert.equal(L.parseUrlFlags('?lang=fr').lang, null);
  assert.equal(L.parseUrlFlags('?guide=0').guide, false);
  assert.equal(L.parseUrlFlags('?guide').guide, false);
  assert.equal(L.parseUrlFlags('?lang=%E0%A4%A').lang, null, 'bad encoding is ignored, not thrown');
  assert.equal(L.parseUrlFlags('lang=zh').lang, 'zh', 'works without the leading ?');
  assert.equal(L.parseUrlFlags('?demo=0').demo, false);
});

test('guide-seen v2: shows on first visit only, remembers Skip / Got it in ltot.guideSeen.v2 (v1 users see the new cards once)', () => {
  assert.equal(L.GUIDE_KEY, 'ltot.guideSeen.v2');
  assert.equal(L.guideSeen(fakeStorage({ 'ltot.guideSeen.v1': 'done' })), false, 'old v1 flag does not hide the new guide');
  const none = L.parseUrlFlags('');
  const s = fakeStorage();
  assert.equal(L.guideSeen(s), false);
  assert.equal(L.shouldShowGuide(none, L.guideSeen(s)), true, 'first visit');
  assert.equal(L.markGuideSeen(s, 'skipped'), true);
  assert.equal(s.getItem('ltot.guideSeen.v2'), 'skipped');
  assert.equal(L.shouldShowGuide(none, L.guideSeen(s)), false, 'second visit');
  L.markGuideSeen(s, 'done');
  assert.equal(s.getItem('ltot.guideSeen.v2'), 'done');
  L.markGuideSeen(s);
  assert.equal(s.getItem('ltot.guideSeen.v2'), 'done', 'default is done');
  assert.equal(L.guideSeen(fakeStorage({ 'ltot.guideSeen.v2': 'done' })), true);
});

test('guide-seen: URL flags override, and broken storage never throws', () => {
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?guide=1'), true), true, '?guide=1 forces it even when seen');
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?howto=1'), false), false, '?howto=1 alone opens the panel, not the cards');
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?howto=1&guide=1'), false), true);
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?demo=1&near=1'), false), false, '?near=1 opens the Near me panel, not the cards');
  assert.equal(L.shouldShowGuide(L.parseUrlFlags('?demo=1&near=1&guide=1'), false), true);
  assert.equal(L.guideSeen(null), false);
  assert.equal(L.guideSeen(throwing), false);
  assert.equal(L.markGuideSeen(throwing), false);
  assert.equal(L.markGuideSeen(null), false);
});

test('app.js wires the guide to the shared helpers (key, Esc, focus trap, passive swipe)', () => {
  const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(js, /LIB\.parseUrlFlags\(location\.search\)/);
  assert.match(js, /LIB\.shouldShowGuide\(FLAGS, LIB\.guideSeen\(/);
  assert.match(js, /LIB\.markGuideSeen\(/);
  assert.match(js, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); closeGuide/);
  assert.match(js, /focus trap/);
  assert.equal((js.match(/'guideViewport'\)\.addEventListener\('touch(start|end)'[\s\S]*?\{ passive: true \}\)/g) || []).length, 2);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(rm, /\.guide \{ animation: none; \}/);
  assert.match(rm, /\.guide-track[^}]*transition: none/);
});
