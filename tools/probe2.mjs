// probe2.mjs — target checks: levels array, name field, weapon entry, I18n resolution
import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';

// int64-safe parse: quote bare long integers (>= 15 digits)
function safeParse(text) {
  const fixed = text.replace(/(^|[,{\[:\s])(-?\d{15,})(?=[,\s}\]:]|$)/gm, (m, pre, num) => `${pre}"${num}"`);
  return JSON.parse(fixed);
}

const ct = safeParse(readFileSync(base + 'CharacterTable.json', 'utf8'));
const laev = ct['chr_0016_laevat'];
console.log('Laevatain top-level fields:', Object.keys(laev));
console.log('attributes array length:', laev.attributes.length);
const lv = laev.attributes.map(a => a.Attribute.attrs.find(x => x.attrType === 0)?.attrValue);
console.log('level range:', Math.min(...lv), '..', Math.max(...lv));
// per-level ATK/HP/crit samples
const getLv = (n) => {
  const a = laev.attributes.find(x => x.Attribute.attrs.find(v => v.attrType === 0)?.attrValue === n);
  const m = {};
  for (const { attrType, attrValue } of a.Attribute.attrs) m[attrType] = attrValue;
  return m;
};
for (const n of [1, 10, 30, 45, 60, 75, 90]) {
  const m = getLv(n);
  if (!m) { console.log(`L${n}: (missing)`); continue; }
  console.log(`L${n}: HP=${m[1]} ATK=${m[2]} DEF=${m[3]} CR=${m[9]} CD=${m[10]} STR=${m[39]?.toFixed(2)} AGI=${m[40]?.toFixed(2)} WIS=${m[41]?.toFixed(2)} WIL=${m[42]?.toFixed(2)} a49=${m[49]?.toFixed(4)} a25=${m[25]?.toFixed(4)}`);
}
// break stages: which levels appear
const allLv = [...new Set(lv)].sort((a, b) => a - b);
console.log('distinct levels:', allLv.length, 'first/last:', allLv[0], allLv[allLv.length - 1]);
// any breakStage values?
const bs = [...new Set(laev.attributes.map(a => a.breakStage))];
console.log('breakStage values:', bs);
// other top-level fields content
for (const [k, v] of Object.entries(laev)) {
  if (k === 'attributes') continue;
  console.log(`field ${k}:`, JSON.stringify(v)?.slice(0, 400));
}

// ---- name resolution via I18n ----
const i18nEn = safeParse(readFileSync(base + 'I18nTextTable_EN.json', 'utf8'));
console.log('\nI18n EN entries:', Object.keys(i18nEn).length);
// find the name field id: print raw id token from CharacterTable around laev
const raw = readFileSync(base + 'CharacterTable.json', 'utf8');
const seg = raw.slice(raw.indexOf('"chr_0016_laevat"'), raw.indexOf('"chr_0016_laevat"') + 300);
console.log('raw head of laevatain entry:', seg);

// ---- WeaponBasicTable full entry ----
const wb = safeParse(readFileSync(base + 'WeaponBasicTable.json', 'utf8'));
const wks = Object.keys(wb);
console.log('\nWeaponBasicTable count:', wks.length);
console.log('all wpn ids:', wks.join(', '));
console.log('sample weapon (wpn_lance_0011):', JSON.stringify(wb['wpn_lance_0011'], null, 1)?.slice(0, 2500));

// ---- CharLevelUpTable / CharGrowthTable quick look ----
for (const name of ['CharLevelUpTable.json', 'CharGrowthTable.json', 'CharBreakTable.json']) {
  const t = safeParse(readFileSync(base + name, 'utf8'));
  const ks = Object.keys(t);
  console.log(`\n=== ${name} keys=${ks.length} sample=${ks[0]}`);
  console.log(JSON.stringify(t[ks[0]], null, 1)?.slice(0, 1200));
}