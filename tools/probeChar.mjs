// Dump raw CharacterTable entries for a given op id (all fields at L90 + L1)
// Usage: node tools/probeChar.mjs <opIdPrefix>
import { readFileSync } from 'node:fs';

const prefix = process.argv[2] || 'chr_0016_laevat';
const text = readFileSync(new URL('../.data/endfieldata/TableCfg/CharacterTable.json', import.meta.url), 'utf8');
const fixed = text.replace(/(^|[,{\[:\s])(-?\d{15,})(?=[,\s}\]:]|$)/gm, (m, pre, num) => `${pre}"${num}"`);
const t = JSON.parse(fixed);

const ids = Object.keys(t).filter((k) => k.startsWith(prefix));
for (const id of ids) {
  const bundle = t[id].CharacterDataBundle ?? t[id];
  const levels = Array.isArray(bundle) ? bundle : [bundle];
  for (const lv of [1, 90]) {
    const row = levels.find((r) => (r.level ?? r.lv) === lv) ?? levels[levels.length - 1];
    console.log(`== ${id} L${lv}:`);
    console.log(JSON.stringify(row, null, 0));
  }
}