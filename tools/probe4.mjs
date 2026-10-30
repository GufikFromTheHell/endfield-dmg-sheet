// probe4.mjs — enemy structure + skill blackboard key survey
import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';
function safeParse(text) {
  const fixed = text.replace(/(^|[,{\[:\s])(-?\d{15,})(?=[,\s}\]:]|$)/gm, (m, pre, num) => `${pre}"${num}"`);
  return JSON.parse(fixed);
}

// ---- enemies ----
const eat = safeParse(readFileSync(base + 'EnemyAttributeTemplateTable.json', 'utf8'));
const eks = Object.keys(eat);
console.log('enemy count:', eks.length);
// show a couple full entries compactly (top-level keys + structure)
for (const k of ['eny_0007_mimicw', 'eny_0057_dog', 'eny_0062_paletent']) {
  const e = eat[k];
  if (!e) { console.log(k, 'MISSING'); continue; }
  console.log(`\n=== ${k} top keys:`, Object.keys(e).join(', '));
  console.log(JSON.stringify(e, null, 1).slice(0, 1800));
}

// ---- skill blackboard keys survey ----
const sp = safeParse(readFileSync(base + 'SkillPatchTable.json', 'utf8'));
const chrKeys = Object.keys(sp).filter(k => k.startsWith('chr_'));
const scaleKeyFreq = {};
const nonScaleKeyFreq = {};
for (const k of chrKeys) {
  for (const e of sp[k].SkillPatchDataBundle ?? []) {
    for (const { key } of e.blackboard ?? []) {
      if (/^atk_scale(_\d+)?$/.test(key)) scaleKeyFreq[key] = (scaleKeyFreq[key] ?? 0) + 1;
      else nonScaleKeyFreq[key] = (nonScaleKeyFreq[key] ?? 0) + 1;
    }
  }
}
console.log('\n--- atk_scale-family keys (frequency) ---');
Object.entries(scaleKeyFreq).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(n, k));
console.log('\n--- other keys (top 40) ---');
Object.entries(nonScaleKeyFreq).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(n, k));

// ---- specific unclassified skills ----
for (const k of ['chr_0017_yvonne_ult_attack_end', 'chr_0031_mifu_normalskill_3', 'chr_0034_typhoea_normal_skill_floating_loop', 'chr_0042_namtch_attack5_2']) {
  const s = sp[k];
  const b = s?.SkillPatchDataBundle?.[0];
  console.log(`\n${k}: L1 bb=`, JSON.stringify(b?.blackboard), 'cd=', b?.coolDown, 'sub=', JSON.stringify(b?.subDescDataList?.map(x => x.desc)));
}