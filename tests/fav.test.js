'use strict';
// v14: "Best streets from past years / 往年最佳街区" board + Web Audio sounds.
// lib rules, local adapter, "harmless until the SQL is run", Oct 31 memory prompt, bilingual copy, sfx rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const B = require('../backend.js');
const I = require('../i18n.js');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const CFG = { backend: 'local', markWindowMin: 45, pollSec: 45, liveWindow: { date: '2026-10-31', start: '15:00', end: '23:00', tz: 'America/Toronto' } };
const OCT18 = Date.parse('2026-10-18T20:00:00Z');

test('favSnap: ~50 m street grid, same as the server (_ltot_fav_snap)', () => {
  const [a, b] = L.favSnap(42.987654, -81.243219);
  assert.deepEqual([a, b], [42.9876, -81.243]);
  assert.ok(L.distM([a, b], [42.987654, -81.243219]) < 40, 'moved at most half a grid cell');
  assert.deepEqual(L.favSnap(a, b), [a, b], 'snapping twice changes nothing');
  assert.equal(L.FAV_LAT_STEP, 0.00045); assert.equal(L.FAV_LNG_STEP, 0.0006);
  const sql = read('supabase/v14_board.sql');
  assert.match(sql, /_ltot_fav_snap\(p_lat, 0\.00045\)/); assert.match(sql, /_ltot_fav_snap\(p_lng, 0\.0006\)/);
});

test('checkFavText mirrors the server filter (EN + ZH): phones, emails, links, addresses, house numbers, postal codes, profanity', () => {
  const bad = { 'call 519-555-1234': 'phone', '５１９５５５１２３４': 'phone', 'mom@mail.com': 'email', 'www.spam.com': 'url',
    '123 Elm Street': 'address', 'the house at 1234': 'address', 'house 7 has candy': 'address', '#42 gives full bars': 'address',
    'N6A 1B2 area': 'address', '大街12号最好': 'address', '１２３号': 'address', '门牌很好找': 'address',
    'this is shit': 'profanity', 'wtf': 'profanity', '傻逼': 'profanity', '草泥马': 'profanity' };
  for (const [s, code] of Object.entries(bad)) assert.equal(L.checkFavText(s, 80, true).error, code, s);
  for (const s of ['Best in 2023 and 2024!', '#1 street for little kids', 'Busy 5:30-8:30', '这条街每年都超有气氛', 'Lots of candy, easy sidewalks'])
    assert.ok(L.checkFavText(s, 80, true).ok, s);
  assert.equal(L.checkFavText('x'.repeat(81), 80, true).error, 'tooLong');
  assert.equal(L.checkFavText('y'.repeat(61), 60, false).error, 'tooLong');
  assert.equal(L.checkFavText('  ', 60, false).error, 'empty');
  assert.ok(L.checkFavText('', 80, true).ok, 'the note is optional');
});

test('bubbles grow with likes, clusters at low zoom, families shown only from 3, Oct 31 3–11 PM prompt', () => {
  assert.equal(L.favScale(0, 0), 1); assert.ok(L.favScale(3, 2) > 1 && L.favScale(3, 2) < L.favScale(30, 20)); assert.equal(L.favScale(1e6, 0), 1.6);
  const pins = [{ id: 'a', lat: 42.98, lng: -81.24, likes: 1, hearts: 0, createdAt: 1 }, { id: 'b', lat: 42.9801, lng: -81.2401, likes: 5, hearts: 1, createdAt: 2 },
                { id: 'c', lat: 42.90, lng: -81.30, likes: 0, hearts: 0, createdAt: 3 }];
  const proj = (z) => (la, ln) => ({ x: (ln + 180) * 2 ** z, y: (90 - la) * 2 ** z });
  const g = L.clusterFav(pins, proj(8), 64);
  assert.equal(g.length, 2); assert.equal(g[0].pins.length, 2); assert.equal(g[0].pins[0].id, 'b', 'most liked first'); assert.equal(g[0].score, 7);
  assert.equal(L.clusterFav(pins, proj(20), 64).length, 3, 'zoomed in: no clustering');
  assert.equal(L.favFamilies('a', ['b']), null); assert.equal(L.favFamilies('a', ['b', 'c', 'b', 'a']), 3);
  assert.equal(L.favTonight(Date.parse('2026-10-31T18:59:00Z'), CFG), false, '2:59 PM');
  assert.equal(L.favTonight(Date.parse('2026-10-31T21:30:00Z'), CFG), true, '5:30 PM');
  assert.equal(L.favTonight(Date.parse('2026-11-01T03:00:00Z'), CFG), false, '11 PM');
  assert.equal(L.favTonight(OCT18, Object.assign({ testWindow: { from: '2026-10-17', to: '2026-10-20', tz: 'America/Toronto' } }, CFG)), false, 'not on test days');
});

test('LocalAdapter board: snapped pin, required tag, limits, once-per-phone reactions, replies, 3 reports hide, delete, Nov 2 purge', async () => {
  const clock = { t: OCT18 };
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, now: () => clock.t });
  api.local.store = memStore();
  const D = 'device-fav-0001', T = 'tok'.padEnd(40, 'x');
  await assert.rejects(api.favCreate({ device: D, lat: 42.98, lng: -81.24, tag: null }, T), { code: 'invalid' }, 'tag required');
  await assert.rejects(api.favCreate({ device: D, lat: 43.65, lng: -79.38, tag: 'candy' }, T), { code: 'outside' });
  await assert.rejects(api.favCreate({ device: D, lat: 42.98, lng: -81.24, tag: 'candy', body: '42 Elm St' }, T), { code: 'text:address' });
  const r = await api.favCreate({ device: D, lat: 42.987654, lng: -81.243219, tag: 'festive', body: 'Best street every year!' }, T);
  assert.deepEqual([r.lat, r.lng], [42.9876, -81.243]);
  const raw = api.local._get('fav', null).pins[0];
  assert.ok(!JSON.stringify(raw).includes(D), 'device stored only as a hash');
  await assert.rejects(api.favCreate({ device: D, lat: 42.98766, lng: -81.24322, tag: 'candy' }, T), { code: 'rate' }, 'same spot');
  for (let i = 0; i < 4; i++) await api.favCreate({ device: D, lat: 42.95 + i * 0.01, lng: -81.25, tag: 'candy' }, T);
  await assert.rejects(api.favCreate({ device: D, lat: 42.93, lng: -81.25, tag: 'candy' }, T), { code: 'rate' }, '5 per day');
  clock.t += 864e5;
  assert.ok(await api.favCreate({ device: D, lat: 42.93, lng: -81.25, tag: 'walking' }, T), 'next Toronto day: ok');
  const a = await api.favReact('liker-0001', r.id, 'like'), b = await api.favReact('liker-0001', r.id, 'like'), c = await api.favReact('liker-0002', r.id, 'heart');
  assert.ok(a.added && !b.added && b.likes === 1 && c.hearts === 1);
  let list = await api.favList('liker-0001');
  const p = list.find((x) => x.id === r.id);
  assert.equal(list[0].id, r.id, 'most liked first'); assert.ok(p.myLike && !p.myHeart); assert.equal(p.families, 3, 'author + 2 phones');
  assert.ok(list.filter((x) => x.id !== r.id).every((x) => x.families === null), 'below 3: hidden');
  await assert.rejects(api.favReply('replier-01', r.id, 'y'.repeat(61), T), { code: 'text:tooLong' });
  for (let i = 0; i < 20; i++) await api.favReply('replier-01', r.id, 'nice ' + i, T);
  await assert.rejects(api.favReply('replier-01', r.id, 'one more', T), { code: 'rate' }, '20 replies a day');
  const reps = await api.favReplies(r.id);
  assert.equal(reps.length, 20); assert.deepEqual(Object.keys(reps[0]).sort(), ['body', 'createdAt', 'id']);
  for (const who of ['rep-a-0001', 'rep-b-0001']) await api.favReport(who, 'pin', r.id);
  assert.equal((await api.favReport('rep-a-0001', 'pin', r.id)).count, -1, 'duplicate report');
  assert.ok((await api.favList()).some((x) => x.id === r.id), '2 reports: still visible');
  await api.favReport('rep-c-0001', 'pin', r.id);
  assert.ok(!(await api.favList()).some((x) => x.id === r.id), '3 reports hide it');
  const mine = (await api.favList()).find((x) => x.tag === 'walking');
  await assert.rejects(api.favDelete('pin', mine.id, 'wrong-token-wrong'), { code: 'forbidden' });
  assert.equal(await api.favDelete('pin', mine.id, T), true);
  clock.t = L.DECOR_PURGE_MS;
  assert.deepEqual(await api.favList(), [], 'Nov 2 00:00 Toronto: everything deleted');
  await assert.rejects(api.favCreate({ device: D, lat: 42.98, lng: -81.24, tag: 'candy' }, T), { code: 'closed' });
});

test('harmless until v14_board.sql is run: a missing RPC (PGRST202) hides the board, nothing falls back to local', async () => {
  const missing = () => Promise.reject(Object.assign(new Error('missing'), { code: 'missing' }));
  const remote = { ping: () => Promise.resolve(), favList: missing, favCreate: missing, zoneCounts: missing };
  const api = B.createBackend(CFG, { storage: memStore(), channel: null, remote, timeoutMs: 50, now: () => OCT18 });
  assert.equal(api.favAvailable(), true); assert.equal(api.favConfirmed, false, 'not confirmed before the first answer');
  assert.deepEqual(await api.favList('d-0000001'), []);
  assert.equal(api.favMissing, true); assert.equal(api.favAvailable(), false); assert.equal(api.favConfirmed, false);
  await assert.rejects(api.favCreate({ device: 'd-0000001', lat: 42.98, lng: -81.24, tag: 'candy' }, 'x'.repeat(40)), { code: 'missing' });
  assert.equal(api.local._get('fav', null), null, 'nothing stored on the phone');
  assert.equal(api.mode, 'supabase', 'the rest of the app stays shared');
  const off = B.createBackend(Object.assign({}, CFG, { favBoard: false }), { storage: memStore(), channel: null });
  assert.equal(off.favAvailable(), false); assert.deepEqual(await off.favList(), []);
  const ok = { ping: () => Promise.resolve(), favList: () => Promise.resolve([{ id: 'x', lat: 42.98, lng: -81.24, tag: 'candy', likes: 0, hearts: 0 }]) };
  const api2 = B.createBackend(CFG, { storage: memStore(), channel: null, remote: ok, timeoutMs: 50 });
  assert.equal((await api2.favList()).length, 1); assert.equal(api2.favConfirmed, true);
  assert.match(read('config.js'), /favBoard: true/);
  const app = read('app.js');
  assert.match(app, /favReady = backend\.favAvailable\(\) && backend\.favConfirmed;/, 'the board shows only after the server answered');
  assert.match(app, /t\(favOn\(\) \? 'phasePreFav' : 'phasePre'\)/, 'banner keeps the v13 copy until the board is on');
});

test('Oct 31 bubbles: memory + tonight prompt leads into the fun-street mark; both counts when the zone is lit', () => {
  const app = read('app.js');
  assert.match(app, /fav-tonight', onclick: function \(\) \{ map\.closePopup\(\); startMark\(\); \}/);
  assert.match(app, /favTonightLit/); assert.match(app, /favMemory/);
  assert.equal(I.en.favMemory.replace('{n}', 12), '🏆 12 families remember this street as unforgettable');
  assert.equal(I.en.favTonightAsk, '🔥 How is it tonight? Tap to share!');
  assert.equal(I.zh.favMemory.replace('{n}', 12), '🏆 12 个家庭说这里往年难忘');
  assert.equal(I.zh.favTonightAsk, '🔥 今晚怎么样？点一下分享！');
  for (const l of ['en', 'zh']) assert.ok(I[l].phaseOct31Fav.length > 20 && I[l].phaseFavItem[1].length > 40, l);
  const sql = read('supabase/v14_board.sql');
  assert.match(sql, /when count\(\*\) >= 3 then count\(\*\)::int end/, 'families: aggregate only, null below 3');
});

test('bilingual board copy everywhere: tags, privacy, How-to, guide line, gift toasts (2–3 short variations)', () => {
  for (const l of ['en', 'zh']) {
    for (const tag of L.FAV_TAGS) assert.ok(I[l]['ftag_' + tag], l + ' ' + tag);
    assert.ok(I[l].privacyFav[1].includes(l === 'en' ? 'Nov 2' : '11 月 2 日'), l);
    assert.equal(I[l].hcFav.length, 3, l); assert.ok(I[l].guideFavLine, l);
    assert.ok(I[l].giftToasts.length >= 2 && I[l].giftToasts.length <= 3 && I[l].giftToasts.every((s) => Array.from(s).length <= 60), l + ' short toasts');
  }
  assert.deepEqual([I.en.ftag_festive, I.en.ftag_candy, I.en.ftag_littlekids, I.en.ftag_walking], ['Most festive', 'Lots of candy', 'Great for little kids', 'Easy walking']);
  assert.deepEqual([I.zh.ftag_festive, I.zh.ftag_candy, I.zh.ftag_littlekids, I.zh.ftag_walking], ['最有氛围', '糖果多', '适合小朋友', '好走']);
  assert.deepEqual(L.FAV_ICON, { festive: '🏆', candy: '🍬', littlekids: '👨‍👩‍👧', walking: '🚶' });
  const app = read('app.js');
  assert.match(app, /function giftToast\(\) \{ var m = t\('giftToasts'\); toast\(m\[giftI\+\+ % m\.length\], 1800\); \}/, '1.8 s toast, rotating');
  assert.ok((app.match(/giftToast\(\); SFX\.play\('chime'\)/g) || []).length >= 3, 'like/heart, reply and post');
  assert.match(app, /esc\(trunc\(p\.body, 24\)\)/, 'user text in bubbles is escaped');
});

// ---------------------------------------------------------------- sounds
function fakeCtx() {
  const ends = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect() {}, gain: param(), frequency: param(), Q: param(), type: '', buffer: null, start() {}, stop(t) { ends.push(t); } });
  return { ends, state: 'running', currentTime: 10, sampleRate: 8000, destination: {}, resume() {},
    createGain: node, createOscillator: node, createBiquadFilter: node, createBufferSource: node,
    createBuffer: (c, len) => ({ getChannelData: () => new Float32Array(len) }) };
}
test('sounds: Web Audio only (no files), each under 1 s, quiet, only right after a tap, 🔊/🔇 remembered, default ON', () => {
  const S = require('../sfx.js');
  const store = memStore(); let now = 1e9;
  S._setTestEnv({ store, now: () => now, reset: true });
  assert.equal(S.isOn(), true, 'default ON');
  assert.ok(S.VOLUME <= 0.2, 'quiet');
  assert.deepEqual(S.NAMES.sort(), ['boo', 'chime', 'fanfare', 'twinkle']);
  for (const n of S.NAMES) assert.ok(S.DUR[n] < 1, n + ' < 1 s');
  const ctx = fakeCtx(); S._setTestEnv({ ctx });
  assert.equal(S.play('boo'), false, 'never without a user action (page load, timers)');
  S.gesture(); assert.equal(S.play('boo'), true, 'right after a tap');
  now += S.GESTURE_MS + 1; assert.equal(S.play('chime'), false, 'not long after the tap');
  for (const n of S.NAMES) {
    ctx.ends.length = 0; S.gesture(); assert.equal(S.play(n), true, n);
    const last = Math.max(...ctx.ends) - (ctx.currentTime + 0.02);
    assert.ok(last > 0.2 && last <= S.DUR[n] + 0.001 && last < 1, `${n} ends after ${last.toFixed(3)} s`);
  }
  assert.equal(S.toggle(), false); assert.equal(store.getItem('ltot.sound'), '0', 'remembered');
  S.gesture(); assert.equal(S.play('chime'), false, 'muted');
  assert.equal(S.toggle(), true); assert.equal(store.getItem('ltot.sound'), '1');
  const src = read('sfx.js');
  assert.doesNotMatch(src, /\.(mp3|wav|ogg|m4a)\b|new Audio\(/, 'no audio files');
  const app = read('app.js'), html = read('index.html');
  assert.match(html, /id="soundBtn"/); assert.match(html, /src="sfx\.js\?v=15\.5"/);
  for (const [n, where] of [['boo', 'fun-street mark'], ['twinkle', 'decor mark'], ['chime', 'like/post/reply'], ['fanfare', 'badge']])
    assert.match(app, new RegExp("SFX\\.play\\('" + n + "'"), where);
  for (const l of ['en', 'zh']) { assert.ok(I[l].soundOnAria && I[l].soundOffAria && I[l].howtoSound[1].length >= 2 && I[l].guideSoundLine, l); }
});
