// v14 design system guard: one font stack, 3 text sizes, 2 weights, no neon glows, AA contrast for the core tokens.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rules() {
  const out = [];
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { out.push({ sel: sel.trim(), body }); return m; });
  return out;
}
// emoji / icon glyph boxes may be sized freely (they are pictures, not text)
const ICON = /\.(ti|mb-icon|tg-i|bp|langpick-icon|tour-drop|fab-icon|fr-i|li|mine-spark|mc-x|leaflet-popup-close-button|chip-icon|ev-pin|start-pin)\b|\.fb-l1 i\b/;

test('text uses only the 3 size tokens (13 / 16 / 20 px)', () => {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
  assert.match(root, /--fs-s:\s*13px/); assert.match(root, /--fs-m:\s*16px/); assert.match(root, /--fs-l:\s*20px/);
  const bad = [];
  for (const r of rules()) {
    if (ICON.test(r.sel) || /^(from|to|\d+%)/.test(r.sel)) continue;
    for (const m of r.body.matchAll(/font-size:\s*([^;]+)/g)) if (!/^var\(--fs-[sml]\)$/.test(m[1].trim()) && m[1].trim() !== '0') bad.push(r.sel + ' → ' + m[1]);
    for (const m of r.body.matchAll(/font:\s*([^;]+)/g)) if (/\d+(px|rem)/.test(m[1].replace(/\/[\d.]+/, ''))) bad.push(r.sel + ' → font: ' + m[1]);
  }
  assert.deepEqual(bad, []);
});

test('two weights only (400 / 700) and one font stack', () => {
  const weights = new Set();
  for (const m of css.matchAll(/font-weight:\s*([^;}\s]+)/g)) weights.add(m[1]);
  for (const m of css.matchAll(/font:\s*(\d{3})\s/g)) weights.add(m[1]);
  for (const w of weights) assert.ok(['var(--fw)', 'var(--fw-b)', '400', '700'].includes(w), 'weight ' + w);
  const fams = [...css.matchAll(/font-family:\s*([^;}]+)/g)].map((m) => m[1].trim());
  for (const f of fams) assert.ok(['inherit', 'var(--font)', 'var(--mono)'].includes(f), 'font-family ' + f);
  assert.match(css, /--mono:\s*var\(--font\)/);
  assert.match(css, /--font:[^;]*system-ui[^;]*"Noto Sans SC"/);
});

test('no neon: no text-shadow, no glow box-shadows, no drop-shadow filters, no gradients outside the faint HUD grid', () => {
  assert.doesNotMatch(css, /text-shadow:\s*(?!none)/);
  assert.doesNotMatch(css, /drop-shadow\(/);
  for (const m of css.matchAll(/box-shadow:\s*([^;}]+)/g)) {
    for (const part of m[1].split(/,(?![^()]*\))/)) {
      const p = part.trim();
      if (p === 'none' || /200vmax/.test(p) || /^0 0 0 \d+px/.test(p) || /var\(--(elev|glow-[op])\)/.test(p)) continue;
      assert.ok(!/^(inset\s+)?0\s+0\s+\d+px/.test(p), 'glow: ' + p);
    }
  }
  const grads = (css.match(/gradient\(/g) || []).length;
  assert.ok(grads <= 6, 'gradients: ' + grads);   // HUD grid lines + its mask only
  assert.match(css, /--glow-o:\s*none/);
});

test('core colour pairs meet WCAG AA (4.5:1)', () => {
  const L = (h) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const v = (n) => css.match(new RegExp('--' + n + ':\\s*(#[0-9a-f]{6})'))[1];
  const pairs = [['text', 'panel-2'], ['muted', 'panel'], ['muted', 'panel-2'], ['muted', 'surface-3'], ['orange-2', 'panel'], ['purple-2', 'panel'], ['on-accent', 'orange'], ['muted', 'bg']];
  for (const [f, b] of pairs) assert.ok(cr(v(f), v(b)) >= 4.5, f + ' on ' + b + ' = ' + cr(v(f), v(b)).toFixed(2));
  assert.ok(cr('#ffffff', v('purple-btn')) >= 4.5, 'white on purple button');
});

test('two accents: orange = fun streets, purple = decorations; tab bar and top bar use line icons', () => {
  assert.match(css, /\.zone-hot\s*\{[^}]*var\(--orange-deep\)/);
  assert.match(css, /\.zone-decor\s*\{[^}]*var\(--purple\)/);
  assert.match(css, /--teal:\s*#cbd5e1/);           // the old teal / magenta are retired to grey / orange
  assert.match(css, /--magenta:\s*var\(--orange\)|--magenta:\s*#ff8a3d/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const tabbar = html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  assert.equal((tabbar.match(/<svg class="ico"/g) || []).length, 4);
  assert.doesNotMatch(tabbar, /🗺️|🚶|✨|📖/);
  assert.doesNotMatch(html, /id="boardBtn"|id="helpBtn"|id="tourBtn"/);       // v15: top bar = brand, status, Safety, 🔊, 中文
  assert.match(html, /id="locateBtn"[^>]*>\s*<span class="fab-icon"><svg class="ico"/);
  assert.doesNotMatch(html, /🦺/);
});
