// Show an operator bundle entry (L90 row) + weapon curve at L90
// Usage: node tools/showOp.mjs <opIdPrefix>
import { readFileSync } from 'node:fs';
const ops = JSON.parse(readFileSync(new URL('../data/operators.json', import.meta.url), 'utf8'));
const wps = JSON.parse(readFileSync(new URL('../data/weapons.json', import.meta.url), 'utf8'));
const prefix = process.argv[2] || 'chr_0016_laevat';
for (const o of ops.operators) {
  if (!o.id.startsWith(prefix)) continue;
  const l90 = o.levels[o.levels.length - 1];
  console.log('OP:', o.id, o.name, 'rarity=' + o.rarity, 'el=' + o.element, 'main=' + o.mainAttr, 'sub=' + o.subAttr, 'wpn=' + o.defaultWeapon);
  console.log('  L90:', JSON.stringify(l90));
  const w = wps.weapons.find(x => x.id === o.defaultWeapon);
  if (w) {
    console.log('  weapon:', w.name, 'curve=' + (w.curve || ''));
    const c = wps.curves[w.curve || ''];
    const row = c.find(r => r[0] === 90) || c[c.length - 1];
    console.log('  weapon ATK L90:', JSON.stringify(row));
  }
}