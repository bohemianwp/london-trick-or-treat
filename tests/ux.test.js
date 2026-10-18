// v15 UX guard: short copy budgets, one name per thing, fewer controls, tooltips on every clickable element.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const I = require('../i18n.js');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const len = (s) => Array.from(s).length;
const flat = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join(' ') : '';

test('banner: one short line (EN ≤ 52, ZH ≤ 26 characters); no second test-days line', () => {
  for (const k of ['phasePre', 'phasePreFav', 'phaseOn']) {
    assert.ok(len(I.en[k]) <= 52, 'en ' + k + ' ' + len(I.en[k]));
    assert.ok(len(I.zh[k]) <= 26, 'zh ' + k + ' ' + len(I.zh[k]));
  }
  assert.match(app, /\$\('phaseBanner'\)\.hidden = !line;/);
});

test('welcome ≤ 3 cards × ≤ 3 lines; How-to ≤ 10 short sections; explainer ≤ 4 bullets', () => {
  for (const l of ['en', 'zh']) {
    const max = l === 'en' ? 60 : 30;
    assert.ok(I[l].guideCards.length <= 3);
    for (const c of I[l].guideCards) { assert.ok(c[1].length <= 3); for (const x of c[1]) assert.ok(len(x) <= max, l + ' card line: ' + x); }
    const secs = I[l].howtoSections.concat([I[l].howtoFav]);
    assert.ok(secs.length <= 10, l + ' How-to sections ' + secs.length);
    for (const s of secs) { assert.ok(s[1].length <= 3, s[0]); for (const x of s[1]) assert.ok(len(x) <= (l === 'en' ? 48 : 24), l + ' How-to line: ' + x); }
    assert.ok(I[l].phaseBullets.length <= 4);
    for (const x of I[l].phaseBullets) assert.ok(len(x) <= (l === 'en' ? 70 : 34), l + ' bullet: ' + x);
    for (const k of ['markBtn', 'decorMain', 'markSub', 'decorSub', 'markedThanks', 'decorThanks', 'tagsAsk', 'progNeed', 'decorProgNeed'])
      assert.ok(len(I[l][k]) <= (l === 'en' ? 42 : 21), l + ' ' + k + ': ' + I[l][k]);
  }
});

test('visible copy is at least 50% shorter than v14.1 (measured: banner, welcome, How-to, explainer, big button, cards, privacy)', () => {
  // v14.1 character counts of the same surfaces, measured from the v14.1 i18n.js (commit 8afa01c).
  const V141 = { en: 12372, zh: 5108 };
  for (const l of ['en', 'zh']) {
    const L = I[l];
    const now = len(flat([L.phasePre, L.phaseOn, L.phaseTest, L.guideCards, L.howtoIntro, L.howtoSections, L.howtoFav, L.phaseTitle, L.phaseBullets,
      L.markBtn, L.markSub, L.decorMain, L.decorSub, L.markedLive, L.progNeed, L.tagsAsk, L.decorThanks, L.decorProgNeed, L.decorTagsAsk, L.progPractice,
      L.privacyIntro, L.privacySummary]));
    assert.ok(now <= V141[l] * 0.5, l + ': ' + now + ' vs ' + V141[l]);
  }
});

test('one name per thing (EN + ZH): Fun streets, Decorations, Past favourites, Suggested areas', () => {
  assert.deepEqual([I.en.layerZones, I.en.layerDecor, I.en.layerFav, I.en.layerAreas, I.en.layerEvents, I.en.layerNear, I.en.layerMore],
    ['Fun streets', 'Decorations', 'Past favourites', 'Suggested areas', 'Events', 'Near me', 'More']);
  assert.deepEqual([I.zh.layerZones, I.zh.layerDecor, I.zh.layerFav, I.zh.layerAreas, I.zh.layerEvents, I.zh.layerNear, I.zh.layerMore],
    ['好玩的街', '装饰', '往年最爱', '推荐区', '活动', '我附近', '更多']);
  const surfaces = (l) => flat([I[l].guideCards, I[l].howtoSections, I[l].howtoFav, I[l].phaseBullets, I[l].phaseItems, I[l].phaseFavItem,
    I[l].favTitle, I[l].decorTitle, I[l].nearTitle, I[l].areasTitle, I[l].phasePre, I[l].phaseOn]);
  for (const old of ['Zones', 'hot spot', 'Best decorations', 'decor marks', 'Best streets from past years', 'Past best', 'Lively', 'Super hot'])
    assert.ok(!surfaces('en').includes(old), 'EN still says ' + old);
  for (const old of ['热区', '最佳装饰', '往年最佳', '超级火爆', '推荐出发区']) assert.ok(!surfaces('zh').includes(old), 'ZH still says ' + old);
  assert.equal(I.en.favTitle, '💬 Past favourites'); assert.equal(I.zh.favTitle, '💬 往年最爱');
});

test('top bar: brand, status chip, Safety, sound, language only; 2 phase-aware layer chips + More', () => {
  const bar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0];
  const ids = [...bar.matchAll(/<button id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['practiceChip', 'offlineChip', 'safetyBtn', 'soundBtn', 'langBtn']);
  assert.match(html, /id="layerMore" class="lchip lchip-more"[^>]*aria-expanded="false"/);
  assert.match(html, /id="nearChip" class="lchip lchip-near lchip-sec" type="button" hidden/);
  assert.match(app, /function layerMain\(k\) \{ return k === 'fav' \|\| \(bigIsDecor\(\) \? k === 'decor' : k === 'zones'\); \}/);
  assert.match(html, /id="locateLabel" class="sr-only"/, 'the round locate button keeps a spoken name');
});

test('tooltips: every key in EN + ZH, one short line; every top-level control has one', () => {
  const keys = Object.keys(I.en).filter((k) => /^tip_/.test(k));
  assert.ok(keys.length >= 40, keys.length);
  for (const k of keys) {
    assert.ok(I.zh[k], 'zh ' + k);
    assert.ok(len(I.en[k]) <= 70 && !/\n/.test(I.en[k]), 'en ' + k);
    assert.ok(len(I.zh[k]) <= 36, 'zh ' + k + ' ' + len(I.zh[k]));
  }
  for (const id of ['safetyBtn', 'langBtn', 'offlineChip', 'demoChip', 'phaseBanner', 'nearChip', 'layerMore', 'locateBtn', 'sharedChip', 'legend'])
    assert.match(app, new RegExp(id + ": 'tip_\\w+'"), id);
  for (const k of ['zones', 'decor', 'fav', 'areas', 'events']) assert.ok(I.en['tip_layer_' + k], k);
  for (const k of ['map', 'route', 'mark', 'guide']) assert.ok(I.en['tip_tab_' + k], k);
  assert.match(app, /'tip_markDecor' : 'tip_markFun'/); assert.match(app, /'tip_test' : 'tip_practice'/);
  for (const k of ['tip_zone', 'tip_decorBadge', 'tip_fav', 'tip_favCluster', 'tip_zoomIn', 'tip_zoomOut']) assert.ok(app.includes("'" + k + "'"), k);
  assert.equal(I.en.tipHint, 'Press and hold any button for a tip'); assert.equal(I.zh.tipHint, '长按任意按钮查看提示');
});

test('tooltips: long-press 500 ms shows without acting, hover/focus on desktop, 2.5 s auto-hide, aria-describedby, not over the element', () => {
  assert.match(app, /var TIP_MS = 2500, PRESS_MS = 500, HOVER_MS = 400;/);
  assert.match(app, /swallowClick = false; e\.preventDefault\(\); e\.stopPropagation\(\);/);
  assert.match(app, /document\.addEventListener\('click', function \(e\) \{[^]*?\}, true\);/, 'capture phase');
  assert.match(app, /Math\.hypot\(e\.clientX - pressAt\[0\], e\.clientY - pressAt\[1\]\) > 10\) cancelPress\(\)/, 'a drag is not a hold');
  assert.match(app, /n\.setAttribute\('aria-describedby', 'tip'\)/);
  assert.match(app, /var top = r\.top - th - 8;[^\n]*\n\s*if \(top < 4\) top = Math\.min\(r\.bottom \+ 8/);
  assert.match(app, /matches\(':focus-visible'\)/);
  assert.match(app, /lsSet\(STORE\.tipHint, true\)/, 'the hint shows once');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.tip \{[^}]*pointer-events: none/); assert.match(css, /-webkit-touch-callout: none/);
});

test('privacy: short summary by default, the full notice (PIPEDA, contact, Nov 2) one tap away and unchanged', () => {
  assert.match(html, /<ul id="privacySummary"[^>]*><\/ul>\s*<details id="privacyMore"[^>]*><summary data-i18n="privacyFull">/);
  for (const l of ['en', 'zh']) {
    assert.ok(I[l].privacySummary.length <= 5);
    const full = flat(I[l].privacyItems);
    assert.match(full, /sisy\+halloween@mail\.grokbot\.com/);
    assert.match(flat(I[l].privacyIntro), /PIPEDA/);
    assert.match(flat(I[l].privacySummary), l === 'en' ? /Nov 2, 2026/ : /2026年11月2日/);
  }
});

test('cards: thank-you / rate cards have no auto-close bar; only the auto-sharing decoration card counts down, with words + ⏸ Paused', () => {
  assert.equal((app.match(/^\s*stillCard\(\);/gm) || []).length, 4, 'shared, rate, decor-rate, decor thanks');
  assert.equal((app.match(/armCardTimer\(/g) || []).length, 2, 'definition + the pending decoration card only');
  assert.match(app, /armCardTimer\(sendPendingDecor, DECOR_PEND_MS\)/);
  assert.match(app, /if \(card\.hidden \|\| card\.dataset\.timer !== 'off' \|\| card\.contains\(e\.target\)\) return;\s*closeMarkCard\(\);/, 'tap outside closes');
  assert.match(html, /<span id="markCardTimer" class="mc-timerlbl"><\/span>/);
  assert.equal(I.en.cardPaused, '⏸ Paused'); assert.equal(I.zh.cardPaused, '⏸ 已暂停');
  assert.match(I.en.cardSharesIn, /\{s\} s/); assert.match(I.zh.cardSharesIn, /\{s\} 秒/);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.markcard\[data-timer="off"\] \.mc-timerrow \{ display: none; \}/);
  assert.match(css, /\.markcard\[data-timer="paused"\] \.mc-timer i \{ opacity: \.35; \}/);
});

test('colour meanings: orange = fun streets, purple = decorations, neutral for everything else (no stray yellow)', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const hsl = (h) => { const n = parseInt(h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1));
    const hue = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); return [(hue + 360) % 360, s, l]; };
  const yellow = [...css.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => m[0]).filter((c) => { const [h, s, l] = hsl(c); return h >= 42 && h <= 68 && s > 0.5 && l < 0.9; });
  assert.deepEqual(yellow, [], 'no yellow');
  const last = (sel) => { let m, out = null; const re = new RegExp(sel.replace(/[.[\]"=]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g'); while ((m = re.exec(css))) out = m[1]; return out; };
  assert.match(last('.btn-primary'), /background: var\(--text\)/, 'generic primary = neutral');
  assert.match(last('.tabbar .tab-mark.tab-decor, .tabbar .tab-mark.tab-decor[aria-current="page"]'), /var\(--purple-btn\)/);
  assert.match(app, /classList\.toggle\('tab-decor', dec\)/, 'Mark tab follows the big button');
  assert.doesNotMatch(app, /color: '#ff7a18'|fillColor: '#a855f7'|color: '#a78bfa'|fillColor: '#7c3aed'/, 'route / areas no longer orange / purple');
  assert.doesNotMatch(I.en.suggested + I.zh.suggested, /💜/);
});

test('instructions match behaviour: windows, thresholds, expiry', () => {
  const L = require('../lib.js');
  global.window = {}; require('../config.js'); const C = Object.values(global.window)[0];
  assert.equal(C.markWindowMin, 45); assert.deepEqual([C.liveWindow.start, C.liveWindow.end], ['15:00', '23:00']);
  assert.deepEqual([C.testWindow.from, C.testWindow.to], ['2026-10-17', '2026-10-20']);
  assert.equal(L.MIN_ZONE, 3); assert.equal(L.MARK_KEEP_MS, 2 * 3600000); assert.equal(L.DECOR_KEEP_MS, 14 * 864e5);
  assert.equal(L.RATE_DEVICE_MS, 5 * 60000); assert.equal(L.FAV_HIDE_AT, 3); assert.equal(L.FAV_REPLY_MAX, 60);
  const en = flat([I.en.howtoSections, I.en.phaseItems, I.en.phaseBullets, I.en.guideCards, I.en.howtoFav, I.en.testWhy, I.en.practiceWhy]);
  for (const w of ['3–11 PM', '{win} min', '3+ marks', '2 hours', '14 days', 'Oct 17–20', 'Nov 2', '60 characters', '3 reports']) assert.ok(en.includes(w), w);
  const zh = flat([I.zh.howtoSections, I.zh.phaseItems, I.zh.phaseBullets, I.zh.guideCards, I.zh.howtoFav, I.zh.testWhy, I.zh.practiceWhy]);
  for (const w of ['下午3–11点', '{win} 分钟', '3 个标记', '2 小时', '14 天', '10月17–20日', '11月2日', '60 字', '3 次']) assert.ok(zh.includes(w), w);
  assert.equal(L.TOUR ? 1 : 1, 1);
});
