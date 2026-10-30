// fetchData.mjs — keeps the local table snapshot (.data/endfieldata/TableCfg)
// in sync with the upstream dump (rmxlinux/EndfieldData, branch main).
//
// Instead of cloning the ~2 GB repo, it downloads only the table files that
// tools/normalize.mjs consumes, pinned to the upstream HEAD commit (atomic
// snapshot — every file comes from the same SHA). The SHA is stored in
// .data/endfieldata/.commit; if it is unchanged nothing is downloaded.
//
// Run: node tools/fetchData.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, '.data', 'endfieldata');
const TBL = join(DATA, 'TableCfg');
const MARKER = join(DATA, '.commit');
const REPO = 'rmxlinux/EndfieldData';

// exactly the files tools/normalize.mjs loads
const TABLES = [
  'I18nTextTable_EN.json',
  'AttributeMetaTable.json',
  'AttributeShowConfigTable.json',
  'CharacterTable.json',
  'CharProfessionTable.json',
  'WeaponBasicTable.json',
  'WeaponUpgradeTemplateTable.json',
  'SkillPatchTable.json',
  'EnemyAttributeTemplateTable.json',
  'EquipTable.json',
  'EquipSuitTable.json',
  'ItemTable.json',
  'AttributeFilterTable.json',
];

async function headSha() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/HEAD`, {
    headers: { 'User-Agent': 'endfield-dmg-sheet' },
  });
  if (!res.ok) throw new Error(`upstream HEAD lookup failed: HTTP ${res.status}`);
  const j = await res.json();
  return { sha: j.sha, date: j.commit?.committer?.date ?? '' };
}

const saved = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : '';
const { sha, date } = await headSha();

const allPresent = TABLES.every((f) => existsSync(join(TBL, f)));
if (sha === saved && saved !== '' && allPresent) {
  console.log(`data up to date (${sha.slice(0, 7)}, ${TABLES.length} tables present)`);
  process.exit(0);
}

mkdirSync(TBL, { recursive: true });
for (const f of TABLES) {
  const url = `https://raw.githubusercontent.com/${REPO}/${sha}/TableCfg/${f}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${f} -> HTTP ${res.status}`);
  writeFileSync(join(TBL, f), Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${f}`);
}
writeFileSync(MARKER, sha);
console.log(`\nsnapshot ${sha.slice(0, 7)} (${date}) -> ${TBL}`);