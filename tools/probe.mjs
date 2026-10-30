// probe.mjs — exploration of the EndfieldData dump structures.
// Run: node tools/probe.mjs [filter...]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.data', 'endfieldata', 'TableCfg');

function load(name) {
  const p = join(ROOT, name);
  if (!existsSync(p)) { console.log(`!! ${name} not present`); return null; }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const filters = process.argv.slice(2);
const show = (name) => !filters.length || filters.some(f => name.toLowerCase().includes(f.toLowerCase()));

const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---- 1. AttributeMetaTable ----
if (show('attributemeta')) {
  const t = load('AttributeMetaTable.json');
  console.log('=== AttributeMetaTable ===');
  const keys = Object.keys(t);
  console.log('keys:', keys.length);
  console.log(JSON.stringify(t, null, 1).slice(0, 6000));
}

// ---- 2. CharLevelUpTable ----
if (show('charlevelup')) {
  const t = load('CharLevelUpTable.json');
  console.log('\n=== CharLevelUpTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length, ks.slice(0, 5));
  console.log(JSON.stringify(t[ks[0]], null, 1).slice(0, 3000));
}

// ---- 3. CharacterTable ----
if (show('charactertable')) {
  const t = load('CharacterTable.json');
  console.log('\n=== CharacterTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length);
  console.log(ks.join(', '));
  const first = ks.find(k => k.includes('laevat'));
  const op = t[first ?? ks[0]];
  console.log(`\nsample operator: ${first ?? ks[0]}`);
  console.log('top-level fields:', Object.keys(op));
  console.log(JSON.stringify(op, null, 1).slice(0, 8000));
}

// ---- 4. CharGrowthTable ----
if (show('chargrowth')) {
  const t = load('CharGrowthTable.json');
  console.log('\n=== CharGrowthTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length, 'first 5:', ks.slice(0, 5));
  const sample = t[ks[0]];
  console.log('entry type:', Array.isArray(sample) ? `array len=${sample.length}` : typeof sample);
  console.log(JSON.stringify(Array.isArray(sample) ? sample.slice(0, 3) : sample, null, 1).slice(0, 3000));
}

// ---- 5. SkillPatchTable ----
if (show('skillpatch')) {
  const t = load('SkillPatchTable.json');
  console.log('\n=== SkillPatchTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length);
  console.log('first 10:', ks.slice(0, 10).join(', '));
  const sample = t[ks[0]];
  console.log('bundle len:', sample?.SkillPatchDataBundle?.length);
  console.log('level1 entry:');
  console.log(JSON.stringify(sample.SkillPatchDataBundle[0], null, 1).slice(0, 4000));
}

// ---- 6. WeaponBasicTable ----
if (show('weaponbasic')) {
  const t = load('WeaponBasicTable.json');
  console.log('\n=== WeaponBasicTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length);
  console.log(ks.join(', '));
  const w = t[ks[0]];
  console.log('sample:', JSON.stringify(w, null, 1));
}

// ---- 7. WeaponUpgradeTemplateSumTable ----
if (show('weaponupgradesum')) {
  const t = load('WeaponUpgradeTemplateSumTable.json');
  console.log('\n=== WeaponUpgradeTemplateSumTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length, 'first 5:', ks.slice(0, 5));
  const sample = t[ks[0]];
  console.log('entry:', Array.isArray(sample) ? `array len=${sample.length}` : typeof sample);
  console.log(JSON.stringify(Array.isArray(sample) ? sample.slice(0, 3) : sample, null, 1).slice(0, 3500));
}

// ---- 8. I18nTextTable_EN ----
if (show('i18n')) {
  const t = load('I18nTextTable_EN.json');
  console.log('\n=== I18nTextTable_EN ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length);
  const sample = ks.slice(0, 8).map(k => [k, t[k]]);
  console.log(JSON.stringify(sample, null, 1));
}

// ---- 9. NumIdStrTable / StrIdNumTable ----
if (show('numidstr')) {
  const t1 = load('NumIdStrTable.json');
  console.log('\n=== NumIdStrTable ===');
  const ks = Object.keys(t1);
  console.log('keys:', ks.length);
  console.log(ks.slice(0, 8).map(k => [k, t1[k]]).map(p => JSON.stringify(p)).join('\n'));
}

// ---- 10. EquipTable / EquipSuitTable ----
if (show('equip')) {
  const t = load('EquipTable.json');
  console.log('\n=== EquipTable ===');
  const ks = Object.keys(t);
  console.log('keys:', ks.length, 'first 5:', ks.slice(0, 5));
  console.log(JSON.stringify(t[ks[0]], null, 1).slice(0, 3000));
  const ts = load('EquipSuitTable.json');
  console.log('\n=== EquipSuitTable ===');
  const sks = Object.keys(ts);
  console.log('keys:', sks.length, sks.join(', '));
  console.log(JSON.stringify(ts[sks[0]], null, 1).slice(0, 3000));
}

// ---- 11. Misc small tables ----
if (show('misc')) {
  for (const name of ['CharWpnRecommendTable.json', 'CharProfessionTable.json', 'CharTypeTable.json', 'CharTagTable.json', 'CharTagDesTable.json', 'CharBreakTable.json', 'CharBreakStageTable.json', 'CharBreakNodeTable.json', 'WeaponTalentTemplateTable.json', 'GemTable.json', 'BattleConst.json']) {
    const t = load(name);
    if (!t) continue;
    console.log(`\n=== ${name} ===`);
    const ks = Object.keys(t);
    console.log('keys:', ks.length, 'first 6:', ks.slice(0, 6).join(', '));
    console.log(JSON.stringify(ks.length <= 200 ? t : t[ks[0]], null, 1).slice(0, 2500));
  }
}