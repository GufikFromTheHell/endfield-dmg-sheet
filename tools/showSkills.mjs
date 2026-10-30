// Show skills for an operator from data/skills.json
// Usage: node tools/showSkills.mjs <opIdPrefix>
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(new URL('../data/skills.json', import.meta.url), 'utf8'));
const prefix = process.argv[2] || 'chr_0016_laevat';
const l = s.filter(x => x.op.startsWith(prefix) || (x.id || '').startsWith(prefix));
for (const k of l) {
  const e = k.levels.find(r => r.lv === 1);
  console.log(`${k.id} | kind=${k.kind} | hit=${JSON.stringify(k.hit)} | passive=${k.passive} | dmg=${k.damage}`);
  console.log(`   L1 scales=${JSON.stringify(e.scales)} keys=${(e.scaleKeys||[]).join('/')} poise=${e.poise} atb=${e.atb} cd=${e.cd} display=${e.display}`);
}
console.log('total:', l.length);