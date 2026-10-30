// probe3.mjs — weapon curves, attribute display names, professions, enemy dummy, talents
import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';
function safeParse(text) {
  const fixed = text.replace(/(^|[,{\[:\s])(-?\d{15,})(?=[,\s}\]:]|$)/gm, (m, pre, num) => `${pre}"${num}"`);
  return JSON.parse(fixed);
}

// 1) AttributeShowConfigTable
const asc = safeParse(readFileSync(base + 'AttributeShowConfigTable.json', 'utf8'));
const aks = Object.keys(asc);
console.log('AttributeShowConfigTable keys:', aks.length);
for (const k of aks.slice(0, 60)) console.log(k, JSON.stringify(asc[k]));

// 2) WeaponUpgradeTemplateTable
const wut = safeParse(readFileSync(base + 'WeaponUpgradeTemplateTable.json', 'utf8'));
const wks = Object.keys(wut);
console.log('\nWeaponUpgradeTemplateTable keys:', wks.length, wks.join(', '));
const c = wut['weapon_upgrade_curve_6star_1.01'];
console.log('curve entry type:', Array.isArray(c) ? `array(${c.length})` : typeof c);
const arr = Array.isArray(c) ? c : [c];
console.log('first 3:', JSON.stringify(arr.slice(0, 3), null, 1));
console.log('entry 90 (last?):', JSON.stringify(arr[arr.length - 1]));

// 3) CharProfessionTable
const cpt = safeParse(readFileSync(base + 'CharProfessionTable.json', 'utf8'));
console.log('\nCharProfessionTable:');
for (const [k, v] of Object.entries(cpt)) console.log(k, JSON.stringify(v)?.slice(0, 300));

// 4) EnemyAttributeTemplateTable — a few entries
const eat = safeParse(readFileSync(base + 'EnemyAttributeTemplateTable.json', 'utf8'));
const eks = Object.keys(eat);
console.log('\nEnemyAttributeTemplateTable keys:', eks.length, 'sample:', eks.slice(0, 6).join(', '));
console.log(JSON.stringify(eat[eks[0]], null, 1)?.slice(0, 1500));

// 5) WeaponTalentTemplateTable
const wtt = safeParse(readFileSync(base + 'WeaponTalentTemplateTable.json', 'utf8'));
const tks = Object.keys(wtt);
console.log('\nWeaponTalentTemplateTable keys:', tks.length, tks.slice(0, 10).join(', '));
console.log(JSON.stringify(wtt[tks[0]], null, 1)?.slice(0, 1500));

// 6) I18n lookups
const i18n = safeParse(readFileSync(base + 'I18nTextTable_EN.json', 'utf8'));
const probes = {
  'wpn_lance_0011 name': '7360030653851778802',
  'laevatain name': '-7854629517048772793',
  'laev CV eng': '5935677241367535201',
  'wpn funne 0019? check below': null,
};
const wbf = safeParse(readFileSync(base + 'WeaponBasicTable.json', 'utf8'));
// gather a few weapon name ids
const samples = ['wpn_lance_0011', 'wpn_sword_0003', 'wpn_funnel_0019', 'wpn_pistol_0001'];
for (const w of samples) {
  const e = wbf[w];
  const id = e.engName.id;
  console.log(`\n${w}: nameId=${id} -> ${JSON.stringify(i18n[id])} | descId=${e.weaponDesc.id} -> ${JSON.stringify(i18n[e.weaponDesc.id])?.slice(0, 200)}`);
}
// profession name via i18n: find profession id for code 8
const prof8 = cpt['8'] ?? cpt[8];
console.log('\nprofession 8 raw:', JSON.stringify(prof8));
if (prof8?.engName) console.log('  engName id ->', JSON.stringify(i18n[String(prof8.engName.id)]));

// 7) BattleConst full (small)
const bc = safeParse(readFileSync(base + 'BattleConst.json', 'utf8'));
console.log('\nBattleConst:', JSON.stringify(bc, null, 1)?.slice(0, 3000));