'use strict';
// v15.7 phone sizes (friend's feedback 4: bottom bar on different phones, accidental taps).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const I = require('../i18n.js');

test('Oct 31: the bottom-bar Mark tab opens a share sheet (two taps), the big map button stays one tap', () => {
  const app = read('app.js'), html = read('index.html');
  assert.match(app, /if \(b\.dataset\.tab === 'mark'\) \{ toggleTab\(bigIsDecor\(\) \? 'decor' : 'mark'\); return; \}/);
  assert.doesNotMatch(app, /if \(bigIsDecor\(\)\) toggleTab\('decor'\); else startMark\(\);/);
  assert.match(app, /\$\('markPanelBtn'\)\.addEventListener\('click', function \(\) \{ startMark\(\); \}\);/);
  assert.match(app, /\$\('markBtn'\)\.addEventListener\('click'/, 'big button still marks directly');
  assert.match(html, /<div class="panel" id="panel-mark" hidden>[\s\S]*?id="markPanelBtn" class="btn btn-block mark-big"/);
  for (const l of ['en', 'zh']) assert.ok(I[l].markPanelTitle && I[l].markPanelHint, l);
  assert.match(I.zh.markPanelHint, /2 小时后自动删除/);
});

test('320 px phones: compact one-line legend, bottom bar keeps the safe-area padding', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(max-width: 340px\) \{\s*\.legend \{ gap: 4px 6px; padding: 6px 8px; \}/);
  assert.match(css, /--safe-b: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /\.tabbar \{[^}]*padding: 8px 8px calc\(8px \+ var\(--safe-b\)\)/);
  assert.match(read('index.html'), /viewport-fit=cover/);
});
