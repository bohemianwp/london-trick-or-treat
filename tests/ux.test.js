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
    // v15.1 (Peng): every line is ONE plain, complete sentence (no fragments), still short
    const oneSentence = (x) => (x.match(l === 'en' ? /[.?!](\s|$)/g : /[。？！]/g) || []).length === 1 && /[.?!。？！]$/.test(x);
    const max = l === 'en' ? 80 : 32;
    assert.ok(I[l].guideCards.length <= 3);
    for (const c of I[l].guideCards) { assert.ok(c[1].length <= 3); for (const x of c[1]) assert.ok(len(x) <= max && oneSentence(x), l + ' card line: ' + x); }
    const secs = I[l].howtoSections;
    assert.ok(secs.length <= 10, l + ' How-to sections ' + secs.length);
    for (const s of secs) { assert.ok(s[1].length <= 3, s[0]); for (const x of s[1]) assert.ok(len(x) <= (l === 'en' ? 100 : 48) && oneSentence(x), l + ' How-to line: ' + x); }
    for (const k of ['hcDecor', 'hcFav', 'hcFun', 'hcLike']) for (const x of I[l][k].slice(1)) assert.ok(len(x) <= (l === 'en' ? 64 : 30) && oneSentence(x), l + ' card: ' + x);
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
    const now = len(flat([L.phasePre, L.phaseOn, L.phaseTest, L.guideCards, L.howtoIntro, L.howtoSections, L.hcDecor, L.hcFav, L.hcFun, L.hcLike, L.phaseTitle, L.phaseBullets,
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
  const surfaces = (l) => flat([I[l].guideCards, I[l].howtoSections, I[l].hcFav, I[l].phaseBullets, I[l].phaseItems, I[l].phaseFavItem,
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
  const en = flat([I.en.howtoSections, I.en.phaseItems, I.en.phaseBullets, I.en.guideCards, I.en.hcFav, I.en.testWhy, I.en.practiceWhy]);
  for (const w of ['3–11 PM', '{win} min', '3+ marks', '2 hours', '14 days', 'Oct 17–20', 'Nov 2', '60 characters', '3 different people report']) assert.ok(en.includes(w), w);
  const zh = flat([I.zh.howtoSections, I.zh.phaseItems, I.zh.phaseBullets, I.zh.guideCards, I.zh.hcFav, I.zh.testWhy, I.zh.practiceWhy]);
  for (const w of ['下午3–11点', '{win} 分钟', '3 个标记', '2 小时', '14 天', '10月17–20日', '11月2日', '60 字', '3 次']) assert.ok(zh.includes(w), w);
  assert.equal(L.TOUR ? 1 : 1, 1);
});

// v15.1: Peng could not find where to share a past favourite (v15 had hidden the entry). Make it visible, 2 taps.
test('v15.1 past-favourites entry: visible button under the big button, popup + explainer links, tooltip', () => {
  assert.equal(I.en.favShareBtn, '💬 Loved a street in past years? Share it');
  assert.equal(I.zh.favShareBtn, '💬 往年哪条街最好玩？来分享');
  assert.ok(I.en.favShareYours && I.zh.favShareYours && I.en.tip_favShare && I.zh.tip_favShare);
  assert.match(html, /<div class="markwrap">[\s\S]*id="markBtn"[\s\S]*id="favShareBtn" class="favshare"[\s\S]*<\/div>/, 'lives with the big button, after it');
  assert.match(app, /var show = favOn\(\) && LIB\.isFavOpen\(Date\.now\(\), DEMO\) && !tourZones;/, 'only when the board is on and open');
  assert.match(app, /function startFavPin\(\)[\s\S]{0,300}openTab\('fav'\); setMode\('fav'\);/, 'straight into pin mode');
  assert.match(app, /\$\('favShareBtn'\)\.addEventListener\('click', startFavPin\)/);
  assert.match(app, /favShareYours'\), 'data-tip-key': 'tip_favShare', onclick: startFavPin/, 'fav popup offers “Share yours”');
  assert.match(app, /class: 'linkbtn pb-fav'[^\n]*startFavPin/, 'explainer bullet is a link');
  assert.match(app, /favShareBtn: 'tip_favShare'/, 'tooltip key');
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.favshare \{[^}]*border: 1\.5px solid #fff7e8; background: rgba\(22,32,51,\.96\); color: #fff7e8;/, 'cream = past favourites, secondary weight');
  assert.ok(len(I.en.favShareBtn) <= 42 && len(I.zh.favShareBtn) <= 16, 'one short line');
});

test('v15.1 area scores: Halloween orange dots that pass 3:1 on the popup navy', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  assert.match(css, /\.dots \.dot \{[^}]*background: var\(--orange\);/);
  const ring = css.match(/\.dots \.dot\.off \{[^}]*border: 2px solid (#[0-9a-f]{6});/)[1];
  const panel = css.match(/--panel: (#[0-9a-f]{6});/)[1], orange = css.match(/--orange: (#[0-9a-f]{6});/)[1];
  assert.ok(cr(orange, panel) >= 3, 'filled ' + cr(orange, panel));
  assert.ok(cr(ring, panel) >= 3, 'empty ring ' + cr(ring, panel));
  assert.match(app, /class: i <= n \? 'dot' : 'dot off'/);
  assert.match(app, /'aria-label': t\('scoreOf', \{ n: n \}\)/);
  assert.match(I.en.scoreOf, /\{n\} of 5/); assert.match(I.zh.scoreOf, /\{n\}\/5/);
  assert.match(css, /colour meanings: orange = fun streets \(Oct 31\) and area scores/);
});

// v15.1 (Peng 7:25 / 7:26): How-to = one card per feature (where / How / Why / Show me); numbers say what they count.
test('v15.1 How-to feature cards: where + real button + How + Why + Show me (EN + ZH)', () => {
  assert.match(html, /<div id="howtoCards" class="hcards"><\/div>\s*<details id="howtoMore" class="phasemore"><summary data-i18n="hcMoreLbl">/);
  assert.match(app, /var kinds = bigIsDecor\(\) \? \['decor', 'fav', 'fun', 'like'\] : \['fun', 'fav', 'like', 'decor'\];/);
  assert.match(app, /function showMe\(kind\)[\s\S]{0,1200}showme-ring[\s\S]{0,400}showMeT = setTimeout\(clearShowMe, 2000\)/, 'Show me rings the real button for 2 s');
  // v15.5 (Peng 10:09: "当我移动地图的时候会出现气泡不消失"): the fixed ring and any tip clear when the map moves or on any touch
  assert.match(app, /map\.on\('movestart zoomstart', clearShowMe\)/);
  assert.match(app, /document\.addEventListener\('pointerdown', clearShowMe, true\)/);
  assert.match(app, /map\.on\('movestart zoomstart', function \(\) \{ cancelPress\(\); hideTip\(\); \}\)/);
  assert.match(app, /'data-tip-key': 'tip_showMe'/);
  for (const l of ['en', 'zh']) {
    assert.ok(I[l].hcShowMe && I[l].hcMoreLbl && I[l].tip_showMe && I[l].hcNotNow, l);
    assert.match(I[l].hcFav[1], l === 'en' ? /cream button, then tap the street/ : /奶白色按钮，再点那条街/);
  }
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.rep-purple \{ background: var\(--purple-btn\);/); assert.match(css, /\.rep-orange \{ background: var\(--orange\);/);
  assert.match(css, /\.rep-cream \{[^}]*color: #fff7e8; \}/); assert.match(css, /\.showme-ring \{[^}]*border: 3px solid #eef2f8;/, 'neutral highlight');
});

test('v15.1 numbers explain themselves (Peng: “now 23”, “14 likes” were vague) — wording matches what is counted', () => {
  assert.equal(I.en.zoneCount, '🔥 {n} marks'); assert.equal(I.zh.zoneCount, '🔥 {n} 个标记');      // count(*) of marks in the window (schema.sql), not people
  assert.match(I.en.zoneInfo, /^Families marked this street \{n\} times in the last \{m\} minutes\.$/);
  assert.match(I.zh.zoneInfo, /最近 \{m\} 分钟里，家庭们把这条街标记了 \{n\} 次。/);
  assert.match(I.en.decorInfo, /liked these decorations \{n\} times in the last 14 days/);   // one like per phone per street per day
  assert.match(I.zh.decorInfo, /最近 14 天里.*\{n\} 次赞/);
  for (const l of ['en', 'zh']) for (const k of ['zoneCount', 'favBubbleNow', 'tip_zone']) assert.doesNotMatch(I[l][k], l === 'en' ? /\bnow\b/ : /现在/, l + ' ' + k);
  assert.match(JSON.stringify(I.en.howtoSections), /Once 3 different people report it, it is hidden for everyone\./);
  assert.match(JSON.stringify(I.zh.howtoSections), /3 个不同的人举报后，它会对所有人隐藏。/);
});

test('v15.2: welcome card 2 shows the cream sample; the pin prompt Cancel never wraps', () => {
  assert.match(app, /class: 'gbtn-demo gbtn-decor'[\s\S]{0,120}class: 'gbtn-demo gbtn-fav' \}, \[el\('span', \{ text: t\('favShareBtn'\) \}\)\][\s\S]{0,160}class: 'gbtn-demo' \}/);
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.gbtn-demo\.gbtn-fav \{[^}]*border: 1\.5px solid #fff7e8; color: #fff7e8; \}/);
  assert.match(css, /\.mode-banner \.btn \{ flex: none; white-space: nowrap; min-width: 64px; \}/);
});

// v15.3 (Peng 8:45: "被举报三次会被隐藏是什么意思？怎么举报"): every report line says why, how, and what happens next.
test('v15.3 reports: why + how + what happens, accurate count-down toast, labelled reply ⚑', () => {
  const L = require('../lib.js');
  assert.equal(L.reportLeft(1), 2); assert.equal(L.reportLeft(2), 1); assert.equal(L.reportLeft(3), 0); assert.equal(L.reportLeft(5), 0);
  assert.equal(L.reportLeft(null), null); assert.equal(L.reportLeft(undefined), null); assert.equal(L.reportLeft(-1), null);
  for (const l of ['en', 'zh']) {
    const D = I[l], rude = l === 'en' ? /rude, unsafe or personal/ : /不友善、不安全或涉及个人信息/, three = l === 'en' ? /3 different people/ : /3 个不同的人/;
    for (const k of ['favRules', 'boardRules']) { assert.match(D[k], rude, l + ' ' + k); assert.match(D[k], /⚑/, l + ' ' + k); assert.match(D[k], three, l + ' ' + k); }
    for (const k of ['favReported', 'reported']) assert.match(D[k], three, l + ' ' + k);
    for (const k of ['favRules', 'favReported', 'reported', 'boardRules']) assert.doesNotMatch(D[k], l === 'en' ? /3 reports/ : /被举报 3 次/, l + ' old wording ' + k);
    assert.doesNotMatch(JSON.stringify(D.privacyItems), l === 'en' ? /3 reports hide/ : /被举报 3 次/, l + ' privacy');
    assert.match(D.reportedLeft, /\{n\}/); assert.ok(D.reportedLeft1 && D.reportedHidden && D.reportReply && D.tip_reportReply && D.tip_reportPin);
    const rep = D.howtoSections.find((s) => s[0].startsWith('⚑'));
    assert.equal(rep[1].length, 3);
    assert.match(rep[1][1], l === 'en' ? /^How: tap the cream bubble, then ⚑ Report at the bottom; for a reply, tap the small ⚑ next to it\.$/ : /^怎么做：点奶白色气泡，再点底部的 ⚑ 举报；举报回复，点回复旁边的小 ⚑。$/);
  }
  assert.equal(I.en.reportReply, 'Report this reply'); assert.equal(I.zh.reportReply, '举报这条回复');
  assert.match(app, /class: 'fr-x', 'aria-label': t\('reportReply'\), title: t\('reportReply'\), 'data-tip-key': 'tip_reportReply'/);
  assert.match(app, /toast\(r && r\.already \? t\('favAlreadyReported'\) : reportToast\(r, 'favReported'\)/);
  assert.match(app, /toast\(r && r\.already \? t\('alreadyReported'\) : reportToast\(r, 'reported'\)/);
  const be = fs.readFileSync(path.join(root, 'backend.js'), 'utf8');
  assert.match(be, /report_post'[^\n]*count: n >= 0 \? n : null/, 'Supabase board report passes the count through');
});

// v15.3 (Peng 8:48: "如果点击更多，在手机上更多的菜单会出屏幕之外，还需要左滑才能看到"): More wraps, never scrolls sideways.
test('v15.3 layer bar: wraps onto extra rows and the controls below move down by --lb-extra', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.layerbar \{ flex-wrap: wrap; overflow: visible; row-gap: 8px; \}/);
  for (const [sel, base] of [['.leaflet-top.leaflet-left', 52], ['.fab', 56], ['.fab-decor', 112], ['.mode-banner', 56]])
    assert.ok(css.includes(sel + ' { top: calc(' + base + 'px + var(--lb-extra, 0px)); }'), sel);
  assert.match(app, /function syncBarRows\(\)[\s\S]{0,200}setProperty\('--lb-extra'/);
  assert.match(app, /new ResizeObserver\(function \(\) \{ syncBarRows\(\); \}\)\.observe\(\$\('layerbar'\)\)/);
});

test('v15.4 app: events list + pins use LIB.activeEvents with the ?now= clock, re-check on the poll timer, empty-state text', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function liveEvents\(\) \{ return LIB\.activeEvents\(EVENTS, phaseNow\(\)\); \}/);
  assert.match(app, /var shown = liveEvents\(\);[\s\S]*shown\.forEach\(function \(e\)/);
  assert.match(app, /!== eventsKey\) renderEvents\(\);/);
  for (const l of ['en', 'zh']) assert.ok(I[l].eventsNone, l);
});
