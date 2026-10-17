#!/usr/bin/env python3
"""Regenerate data/areas.js from data/areas_researched.json.
file:// pages cannot fetch() a JSON file, so the app loads the same data as a JS file.
Only the fields the app uses are shipped (areas + label + events) to keep the page small.
Usage: python3 tools/gen_areas.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((root / 'data/areas_researched.json').read_text(encoding='utf-8'))
keep = {k: d['meta'][k] for k in ('generated', 'label_en', 'label_zh', 'events')}
out = {'meta': keep, 'areas': d['areas']}
js = ('/* GENERATED from data/areas_researched.json — do not edit by hand.\n'
      '   Regenerate: python3 tools/gen_areas.py  (file:// pages cannot fetch() JSON, so the data ships as JS) */\n'
      'window.TOT_AREAS_RAW = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
(root / 'data/areas.js').write_text(js, encoding='utf-8')
print('wrote data/areas.js', len(js.encode()), 'bytes')
