'use strict';
/* Removes duplicate keys from the i18n.js language blocks (first occurrence stays) */
const fs = require('node:fs');
const path = require('node:path');
const FILE = path.join(__dirname, '..', 'src', 'renderer', 'i18n.js');

const ev = (lit) => { try { return eval(lit); } catch { return null; } };
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

const seen = { en: new Set(), de: new Set(), fr: new Set(), it: new Set(), bs: new Set(), sr: new Set() };
const toRemove = new Set();
let cur = null;

lines.forEach((line, i) => {
  if (/^    (en|de|fr|it|bs|sr): \{/.test(line)) { cur = /^    (\w+): \{/.exec(line)[1]; return; }
  if (/^  \};/.test(line) || /^};/.test(line)) { cur = null; return; }
  if (!cur) return;
  const m = line.match(/^\s+(['"])((?:\\.|[^'\\\n])*)\1\s*:/);
  if (!m) return;
  const key = ev(m[1] + m[2] + m[1]);
  if (key == null) return;
  if (seen[cur].has(key)) toRemove.add(i);
  else seen[cur].add(key);
});

if (!toRemove.size) { console.log('[DEDUPE] no duplicates found'); return; }
const out = lines.filter((_, i) => !toRemove.has(i)).join('\n');
fs.writeFileSync(FILE, out);
console.log(`[DEDUPE] removed ${toRemove.size} duplicate(s)`);
