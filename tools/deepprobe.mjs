// deepprobe.mjs — full structure dump of key tables
import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';
const load = (n) => JSON.parse(readFileSync(base + n, 'utf8'));

// 1) AttributeMetaTable — compact list
const am = load('AttributeMetaTable.json');
console.log('=== AttributeMetaTable (all) ===');
for (const [k, v] of Object.entries(am)) {
  console.log(`${k}\t${v.iconName || '(no icon)'}\tdef=${v.defaultValue}${v.maxValue ? ' max=' + v.maxValue : ''}${v.minValue ? ' min=' + v.minValue : ''}`);
}

// 2) CharacterTable — one full operator (laevatain)
const ct = load('CharacterTable.json');
const keys = Object.keys(ct);
console.log('\n=== CharacterTable: all chr ids ===');
console.log(keys.join(', '));
const laev = ct['chr_0016_laevat'];
console.log('\n=== Laevatain entry ===');
console.log(JSON.stringify(laev, null, 1).slice(0, 12000));

// 3) SkillPatchTable — one full skill, all levels, compact
const sp = load('SkillPatchTable.json');
const sk = sp['chr_0016_laevat_combo_skill'];
console.log('\n=== SkillPatchTable: laev combo (levels) ===');
for (const lvl of sk.SkillPatchDataBundle) {
  console.log(`L${lvl.level}: bb=${JSON.stringify(lvl.blackboard)} cd=${lvl.coolDown} sub=${JSON.stringify(lvl.subDescDataList?.map(s => s.desc))}`);
}
// list all skill ids for laevatain
console.log('\nLaevatain skills in patch table:');
console.log(Object.keys(sp).filter(k => k.startsWith('chr_0016_laevat')).join(', '));

// 4) WeaponBasicTable — all keys
const wb = load('WeaponBasicTable.json');
console.log('\n=== WeaponBasicTable: all wpn ids ===');
console.log(Object.keys(wb).join(', '));
const w = wb[Object.keys(wb)[0]];
console.log('\nfirst weapon full:', JSON.stringify(w, null, 1));

// 5) WeaponUpgradeTemplateSumTable
const sum = load('WeaponUpgradeTemplateSumTable.json');
const skeys = Object.keys(sum);
console.log('\n=== WeaponUpgradeTemplateSumTable ===');
console.log('keys:', skeys.length, skeys.slice(0, 8).join(', '));
const s = sum[skeys[0]];
console.log('entry type:', Array.isArray(s) ? `array(${s.length})` : typeof s);
console.log(JSON.stringify(Array.isArray(s) ? s.slice(0, 2) : s, null, 1).slice(0, 2500));