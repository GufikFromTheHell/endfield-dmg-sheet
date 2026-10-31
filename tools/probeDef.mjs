// probeDef.mjs — verify DEF (attrType 3) is constant across all stages for every piece
import { readFileSync } from 'node:fs';
const eq = JSON.parse(readFileSync(new URL('../data/equipment.json', import.meta.url), 'utf8'));
const items = eq.items;
let growing = 0, hasDef = 0;
const samples = [];
for (const [id, it] of Object.entries(items)) {
  const vals = it.st.map((s) => s['3']);
  if (vals.some((v) => v == null)) continue;
  hasDef++;
  const first = vals[0];
  if (vals.some((v) => v !== first)) {
    growing++;
    if (samples.length < 10) samples.push({ id, vals });
  }
}
console.log(`pieces: ${Object.keys(items).length}, with DEF: ${hasDef}, DEF growing across stages: ${growing}`);
console.log('samples:', JSON.stringify(samples));