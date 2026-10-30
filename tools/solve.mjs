// Try to express sheet Laevatain numbers (17206.8 / 217514) as L12 scale sums
// target_scale = DMG / (ATK * avgCrit * defZone)
import { readFileSync } from 'node:fs';

const ATK = 729;
// L12 scales from dump (raw, fractions of ATK)
const S = {
  bs1: 1.4, bs2: 0.14, bs3: 7.7,          // battle skill (total 9.24)
  combo: 5.4,
  heavy: 9.0,
  dash: 1.4,
  fall: 2.8,
  u1: 1.46, u2a: 0.91, u2b: 0.91, u3: 2.6, u4a: 2.28, u4b: 2.28,
  dur1: 3.3, dur2: 3.7, dur3: 9.0,         // battle skill during ult
  n1: 0.54, n2: 0.56, n3: 0.57, n4: 0.88, n5: 1.19, n6: 1.32, n7: 1.8,
};
const names = Object.keys(S);

function avgCrit(cr, cdr) { return 1 + cr * cdr; }

const targets = [
  { label: 'BS 17206.8', dmg: 17206.8 },
  { label: 'RXN 217514', dmg: 217514.0 },
];
const crits = [
  { cr: 0, cdr: 0, tag: 'noCrit' },
  { cr: 0.195, cdr: 0.5, tag: 'cr19.5/cd50' },
  { cr: 0.195, cdr: 0.65, tag: 'cr19.5/cd65' },
  { cr: 0.345, cdr: 0.5, tag: 'cr34.5/cd50' },
];
const defs = [ { d: 0, tag: 'def0' }, { d: 100, tag: 'def100' } ];

for (const t of targets) {
  console.log('==', t.label);
  for (const c of crits) {
    for (const d of defs) {
      const mult = avgCrit(c.cr, c.cdr) * (100 / (d.d + 100));
      const target = t.dmg / (ATK * mult);
      console.log(`  ${c.tag} ${d.tag}: target scale-sum = ${target.toFixed(4)}`);
    }
  }
}

// Brute force: sums of up to 3 skills (with repetition allowed up to 2) that hit target within 0.5%
console.log('\n-- combos (up to 3 picks, each pick any skill, repeats allowed) --');
for (const c of [crits[0], crits[1]]) {
  for (const d of defs) {
    const mult = avgCrit(c.cr, c.cdr) * (100 / (d.d + 100));
    for (const t of targets) {
      const target = t.dmg / (ATK * mult);
      const found = [];
      for (const a of names) for (const b of names) {
        const s2 = S[a] + S[b];
        if (Math.abs(s2 - target) / target < 0.005) found.push(`${a}+${b}=${s2}`);
        for (const e of names) {
          const s3 = s2 + S[e];
          if (Math.abs(s3 - target) / target < 0.005) found.push(`${a}+${b}+${e}=${s3.toFixed(3)}`);
        }
      }
      if (found.length) console.log(`  ${c.tag} ${d.tag} ${t.label}: ${[...new Set(found)].join(' | ')}`);
    }
  }
}