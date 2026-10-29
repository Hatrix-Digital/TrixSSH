'use strict';
/* Check coverage: S('...') strings in the renderers vs. the dictionary keys */
const fs = require('node:fs');
const path = require('node:path');
const R = path.join(__dirname, '..');

const i18nSrc = fs.readFileSync(path.join(R, 'src', 'renderer', 'i18n.js'), 'utf8');
const LANGS = ['en', 'de', 'fr', 'it', 'bs', 'sr'];
const ev = (lit) => { try { return eval(lit); } catch { return null; } };

/* keys per language — search for the "  xx: {" block in the D object */
const keys = {};
const re = /(?:^|\n)\s{4}(en|de|fr|it|bs|sr): \{/g;
let m; const marks = [];
while ((m = re.exec(i18nSrc))) marks.push({ lang: m[1], idx: m.index });
for (let i = 0; i < marks.length; i++) {
  const start = i18nSrc.indexOf('{', marks[i].idx);
  const end = i < marks.length - 1 ? marks[i + 1].idx : i18nSrc.length;
  const body = i18nSrc.slice(start, end);
  const set = new Set();
  const kre = /(['"])((?:\\.|[^'\\\n])*)\1\s*:/g;
  let k;
  while ((k = kre.exec(body))) set.add(ev(k[1] + k[2] + k[1]));
  keys[marks[i].lang] = set;
}

/* strings used from the renderers */
let used = new Set();
for (const f of ['sftp.js', 'app.js']) {
  const src = fs.readFileSync(path.join(R, 'src', 'renderer', f), 'utf8');
  const ure = /\bS\(\s*'((?:[^'\\]|\\.)*)'/g;
  let u;
  while ((u = ure.exec(src))) { const s = ev(`'${u[1]}'`); if (s) used.add(s); }
}

let total = 0;
for (const lang of LANGS) {
  const miss = [...used].filter((s) => !keys[lang].has(s));
  total += miss.length;
  console.log(`\n[${lang}] missing ${miss.length} / ${used.size}`);
  for (const s of miss) console.log('    ' + JSON.stringify(s));
}
console.log(total ? `\n[COVERAGE] UKUPNO NEDOSTAJE: ${total}` : '\n[COVERAGE] SVE PREVEDENO ✓');
