// Dump full level table for given SkillPatchTable keys
// Usage: node tools/dumpSkillLevels.mjs <idPrefix>
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(new URL('../.data/endfieldata/TableCfg/SkillPatchTable.json', import.meta.url), 'utf8'));
const prefix = process.argv[2] || 'chr_0016_laevat_normal_skill';
for (const k of Object.keys(s).filter(k => k.startsWith(prefix))) {
  const b = s[k].SkillPatchDataBundle;
  console.log('==', k);
  for (const e of b) {
    const bb = (e.blackboard || []).map(x => `${x.key}=${typeof x.value === 'number' ? +x.value.toFixed(4) : x.value}`).join(', ');
    console.log(`  L${e.level}: ${bb}`);
  }
}