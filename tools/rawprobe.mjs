// raw inspection of I18n key format
import { readFileSync } from 'node:fs';
const base = '.data/endfieldata/TableCfg/';
const raw = readFileSync(base + 'I18nTextTable_EN.json', 'utf8');
console.log('I18n EN length:', raw.length);
console.log(raw.slice(0, 1500));
console.log('...');
const m = raw.match(/"(?:-?\d{15,25})"\s*:/);
console.log('\nfirst long-numeric QUOTED key:', m ? m[0] : 'NONE');
const m2 = raw.match(/(^|[,{\s])(?:-?\d{15,25})\s*:/);
console.log('first long-numeric BARE key:', m2 ? m2[0] : 'NONE');

// Also check raw text of a name.id from CharacterTable to see exact digits
const ct = readFileSync(base + 'CharacterTable.json', 'utf8');
const mi = ct.indexOf('"text"');
const idm = ct.match(/"id"\s*:\s*(-?\d+)/g);
console.log('\nfirst 5 raw id tokens in CharacterTable:', idm?.slice(0, 5));
// check one profession name id raw
const prof = readFileSync(base + 'CharProfessionTable.json', 'utf8');
const pid = prof.match(/"id"\s*:\s*(-?\d+)/g);
console.log('raw id tokens in CharProfessionTable:', pid?.slice(0, 8));