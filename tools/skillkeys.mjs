import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';
const sp = JSON.parse(readFileSync(base + 'SkillPatchTable.json', 'utf8'));
const keys = Object.keys(sp);
console.log('total skills:', keys.length);
console.log('first 40 keys:');
console.log(keys.slice(0, 40).join('\n'));
console.log('\nkeys containing laevat:');
console.log(keys.filter(k => k.toLowerCase().includes('laevat')).join('\n'));
console.log('\nkeys containing 0016:');
console.log(keys.filter(k => k.includes('0016')).join('\n'));
// prefixes histogram
const pref = {};
for (const k of keys) {
  const p = k.split('_').slice(0, 3).join('_');
  pref[p] = (pref[p] || 0) + 1;
}
console.log('\nprefix histogram:');
Object.entries(pref).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`${n}\t${p}`));