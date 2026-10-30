// normalize.mjs — parses the EndfieldData dump (.data/endfieldata/TableCfg) into
// compact browser-ready bundles in data/. Run: node tools/normalize.mjs
// Int64-safe: game ids are 64-bit ints; JS JSON.parse corrupts them, so we quote
// bare long integers before parsing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TBL = join(ROOT, '.data', 'endfieldata', 'TableCfg');
const OUT = join(ROOT, 'data');
mkdirSync(OUT, { recursive: true });

function raw(name) {
  const p = join(TBL, name);
  if (!existsSync(p)) throw new Error('missing table: ' + name);
  return readFileSync(p, 'utf8');
}
function load(name) {
  const text = raw(name);
  // quote bare integers with >= 15 digits (int64 ids) so JSON.parse keeps precision
  const fixed = text.replace(/(^|[,{\[:\s])(-?\d{15,})(?=[,\s}\]:]|$)/gm, (m, pre, num) => `${pre}"${num}"`);
  return JSON.parse(fixed);
}
const r3 = (v) => Math.round(v * 1000) / 1000;
const pct = (v) => r3(v * 100);
const diag = { warnings: [], facts: [] };
const note = (m) => diag.warnings.push(m);
const fact = (m) => diag.facts.push(m);

// ---------------------------------------------------------------- tables
const i18n = JSON.parse(raw('I18nTextTable_EN.json')); // keys are quoted strings -> safe
const T = (obj) => (obj && typeof obj.id === 'string' ? i18n[obj.id] ?? '' : '');

const attrMeta = load('AttributeMetaTable.json');
const attrShow = load('AttributeShowConfigTable.json');
const charTable = load('CharacterTable.json');
const professionTable = load('CharProfessionTable.json');
const wpnBasic = load('WeaponBasicTable.json');
const wpnCurves = load('WeaponUpgradeTemplateTable.json');
const skillPatch = load('SkillPatchTable.json');
const enemyTable = load('EnemyAttributeTemplateTable.json');

// ------------------------------------------------------- attribute names
const attrNames = {};
for (const key of Object.keys(attrShow)) {
  for (const item of attrShow[key]?.list ?? []) {
    const code = item.attributeModifier;
    if (code && !attrNames[code]) {
      const nm = T(item.name) || T(item.attributeHint);
      if (nm) attrNames[code] = nm;
    }
  }
}
// fallback: iconName from AttributeMetaTable
for (const [k, v] of Object.entries(attrMeta)) {
  if (!attrNames[v.attributeType] && v.iconName) {
    const pretty = v.iconName
      .replace(/^icon_(?:attribute_|normal_atk_efficiency|ultimate_skill_efficiency|poise_efficiency|normal_skill_efficiency|combo_skill_efficiency|heal_output_increase|heal_taken_increase)/, '')
      .replace(/_/g, ' ');
    attrNames[v.attributeType] = pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }
}
attrNames[0] = attrNames[0] || 'Level';
attrNames[1] = attrNames[1] || 'Max HP';
attrNames[2] = attrNames[2] || 'ATK';
attrNames[3] = attrNames[3] || 'DEF';
attrNames[9] = attrNames[9] || 'Crit Rate';
attrNames[10] = attrNames[10] || 'Crit DMG';
attrNames[39] = attrNames[39] || 'Strength';
attrNames[40] = attrNames[40] || 'Agility';
attrNames[41] = attrNames[41] || 'Wisdom';
attrNames[42] = attrNames[42] || 'Will';
for (const code of [0, 1, 2, 3, 9, 10, 39, 40, 41, 42]) {
  if (!attrNames[code]) note(`attribute code ${code} has no display name`);
}

// ------------------------------------------------------- weapon type names
const wpnPrefixNames = { sword: 'Sword', lance: 'Lance', claym: 'Claymore', pistol: 'Pistol', funnel: 'Funnel' };
const wpnTypeByCode = {};
for (const [id, w] of Object.entries(wpnBasic)) {
  const nm = wpnPrefixNames[id.split('_')[1]];
  if (nm) wpnTypeByCode[w.weaponType] = nm;
}
const wpnTypeName = (code) => wpnTypeByCode[code] || `Type ${code}`;

// ------------------------------------------------------- professions
const professions = {};
for (const [k, v] of Object.entries(professionTable)) professions[v.profession] = T(v.name) || `Profession ${v.profession}`;

// ------------------------------------------------------- operators
const SLOT_CODES = [1, 2, 3, 9, 10, 39, 40, 41, 42]; // hp, atk, def, critRate, critDmg, str, agi, wis, wil
const operators = [];
for (const [id, op] of Object.entries(charTable)) {
  if (id === 'chr_9000_endmin') { note('skipped mannequin chr_9000_endmin'); continue; }
  const byLevel = new Map();
  for (const entry of op.attributes ?? []) {
    const map = {};
    for (const { attrType, attrValue } of entry.Attribute?.attrs ?? []) map[attrType] = attrValue;
    const lvl = Math.round(map[0]);
    const stage = entry.breakStage ?? 0;
    const prev = byLevel.get(lvl);
    if (!prev || stage > prev.stage) byLevel.set(lvl, { stage, map });
  }
  const levels = [];
  for (let lvl = 1; lvl <= 99; lvl++) {
    const e = byLevel.get(lvl);
    if (!e) { note(`${id} missing level ${lvl}`); continue; }
    levels.push({ b: e.stage, a: SLOT_CODES.map((c) => r3(e.map[c] ?? 0)) });
  }
  const mainAttr = op.mainAttrType, subAttr = op.subAttrType;
  operators.push({
    id,
    name: op.engName || T(op.name) || id,
    element: op.charTypeId || '',
    profession: op.profession,
    professionName: professions[op.profession] || '',
    rarity: op.rarity ?? 0,
    weaponType: op.weaponType,
    weaponTypeName: wpnTypeName(op.weaponType),
    mainAttr, subAttr,
    mainAttrName: attrNames[mainAttr] || '',
    subAttrName: attrNames[subAttr] || '',
    defaultWeapon: op.defaultWeaponId || '',
    poiseFactor: r3(op.resilienceDeductionFactor ?? 0),
    maxLevel: Math.max(...[...byLevel.keys()]),
    levels,
  });
}
// sanity: Laevatain L90 base ATK
const laev = operators.find((o) => o.id === 'chr_0016_laevat');
if (laev) fact(`Laevatain L90: HP=${laev.levels[89].a[0]} ATK=${laev.levels[89].a[1]} crit=${laev.levels[89].a[3]} wis=${laev.levels[89].a[7]}`);

// ------------------------------------------------------- weapons
const curveIds = new Set();
const weapons = [];
for (const [id, w] of Object.entries(wpnBasic)) {
  curveIds.add(w.levelTemplateId);
  weapons.push({
    id,
    name: T(w.engName) || id,
    desc: T(w.weaponDesc) || '',
    rarity: w.rarity ?? 0,
    type: w.weaponType,
    typeName: wpnTypeName(w.weaponType),
    maxLv: w.maxLv ?? 90,
    curve: w.levelTemplateId,
    potentialSkill: w.weaponPotentialSkill || '',
    traits: (w.weaponSkillList ?? []).filter((t) => t !== w.weaponPotentialSkill),
  });
}
const curves = {};
for (const cid of curveIds) {
  const entry = wpnCurves[cid];
  if (!entry) { note(`missing curve ${cid}`); continue; }
  curves[cid] = (entry.list ?? entry).map((e) => [e.weaponLv, r3(e.baseAtk)]);
}
const tarr = weapons.find((w) => w.id === 'wpn_sword_0003');
if (tarr && laev) {
  const wAtk = curves[tarr.curve]?.[89]?.[1];
  fact(`Tarr 11 L90 weapon ATK=${wAtk}; Laevatain+Tarr11 total base ATK=${laev.levels[89].a[1] + (wAtk ?? '?')}`);
}

// ------------------------------------------------------- weapon traits (passives + potential skills)
const traitDefs = {};
const potentialSkills = {};
for (const [sid, s] of Object.entries(skillPatch)) {
  if (!sid.startsWith('wpn_') && !sid.startsWith('sk_wpn_')) continue;
  const bundle = s.SkillPatchDataBundle ?? [];
  if (!bundle.length) continue;
  if (sid.startsWith('wpn_')) {
    traitDefs[sid] = { bb: {} };
    for (const { key, value } of bundle[0].blackboard ?? []) traitDefs[sid].bb[key] = r3(value);
  } else {
    const levels = [];
    for (const e of bundle.slice(0, 10)) {
      const bb = {};
      for (const { key, value } of e.blackboard ?? []) bb[key] = r3(value);
      levels.push({ lv: e.level, bb });
    }
    potentialSkills[sid] = levels;
  }
}
const LABELS = {
  mainattr: (v) => `+${v} Main Attribute`,
  subattr: (v) => `+${v} Sub Attribute`,
  atk: (v) => `+${pct(v)}% ATK`,
  crirate: (v) => `+${pct(v)}% Crit Rate`,
  critdmg: (v) => `+${pct(v)}% Crit DMG`,
  cridmg: (v) => `+${pct(v)}% Crit DMG`,
  firedam: (v) => `+${pct(v)}% Fire Damage`,
  pulsedam: (v) => `+${pct(v)}% Pulse Damage`,
  crystdam: (v) => `+${pct(v)}% Crystal Damage`,
  phydam: (v) => `+${pct(v)}% Physical Damage`,
  electrondam: (v) => `+${pct(v)}% Electro Damage`,
  naturaldam: (v) => `+${pct(v)}% Natural Damage`,
  spelldam: (v) => `+${pct(v)}% Spell Damage`,
  atkdmg: (v) => `+${pct(v)}% Normal ATK`,
  physpell: (v) => `+${v} Physical & Spell DMG`,
  usgs: (v) => `+${pct(v)}% SP Gain`,
  heal: (v) => `+${pct(v)}% Heal Output`,
  hp: (v) => `+${pct(v)}% Max HP`,
  wisd: (v) => `+${v} Wisdom`,
  agi: (v) => `+${v} Agility`,
  will: (v) => `+${v} Will`,
  str: (v) => `+${v} Strength`,
};
const traitLabel = (sid, bb) => {
  const parts = Object.entries(bb).map(([k, v]) => (LABELS[k] ? LABELS[k](v) : `${k} +${v}`));
  return `${sid}: ${parts.join(', ')}`;
};
for (const sid of Object.keys(traitDefs)) fact('trait ' + traitLabel(sid, traitDefs[sid].bb));

// ------------------------------------------------------- operator skills
// Classify by the tail after "chr_XXXX_<surname>_". Order matters: more
// specific tails first. Always returns a label (fall back to pretty tail) so
// no damage skill is dropped; unknown tails are logged for review.
function classifySkill(sid) {
  const tail = sid.replace(/^chr_\d+_[a-z]+_/, '');
  if (tail === 'normal_skill_during_ult') return { kind: 'Battle Skill (during Ult)', hit: '' };
  let m = tail.match(/^normalskill_?(\d*)$/);
  if (m) return { kind: 'Battle Skill', hit: m[1] };
  m = tail.match(/^floating_attack(\d*)(_\d+)?$/);
  if (m) return { kind: 'Floating Hit', hit: m[1] || '' };
  m = tail.match(/^passive_?(\d*)$/);
  if (m) return { kind: 'Passive', hit: m[1] || '', passive: true };
  m = tail.match(/^attack(\d*)_ult$/);
  if (m) return { kind: 'Basic Hit (during Ult)', hit: m[1] || '' };
  m = tail.match(/^combo_?(\d*)_skill$/);
  if (m) return { kind: 'Combo', hit: m[1] || '' };
  if (tail === 'normal_skill') return { kind: 'Battle Skill', hit: '' };
  m = tail.match(/^normal_skill_(.+)$/);
  if (m) return { kind: 'Battle Skill (' + m[1].replace(/_/g, ' ') + ')', hit: '' };
  m = tail.match(/^ultimate_skill_?(\w*)$/);
  if (m) return { kind: m[1] ? 'Ultimate (' + m[1] + ')' : 'Ultimate', hit: '' };
  if (tail === 'combo_skill_ult') return { kind: 'Combo Skill (during Ult)', hit: '' };
  m = tail.match(/^combo_skill_?(\w*)$/);
  if (m) return { kind: m[1] ? 'Combo Skill (' + m[1] + ')' : 'Combo Skill', hit: '' };
  m = tail.match(/^ult_attack(\d*)(_end|_\d+)?$/);
  if (m) return { kind: m[2] === '_end' ? 'Ult Finisher' : 'Ult Hit', hit: m[1] || '' };
  if (/^plunging_attack/.test(tail)) return { kind: 'Falling Attack', hit: '' };
  m = tail.match(/^power_?attack(\d*)$/);
  if (m) return { kind: 'Heavy Attack', hit: m[1] };
  if (tail === 'dash_attack') return { kind: 'Dash Attack', hit: '' };
  m = tail.match(/^attack(\d*)(_\d+)?$/);
  if (m) return { kind: 'Basic Hit', hit: m[1] || '' };
  if (/^reaction/.test(tail)) return { kind: 'Reaction', hit: '' };
  return { kind: tail.replace(/_/g, ' '), hit: '', unknown: true };
}
// Any blackboard key starting with "atk_scale" (except display mirrors) is a
// damage scale = multiplier of FinalAttack. Order hits: bare "atk_scale" is
// the primary (0), "atk_scale_N" -> N, named variants (pull/explosion/base/
// extra/boom/trigger) sort after numbered ones by name.
function scaleIdx(k) {
  if (!/^atk_scale/.test(k) || /display/.test(k)) return null;
  if (k === 'atk_scale') return 0;
  const m = k.match(/^atk_scale_?(\d+)$/);
  if (m) return parseInt(m[1], 10);
  // named variants (pull/explosion/base/extra/boom/persistent/main/center/...)
  return 100;
}
const skillList = [];
for (const [sid, s] of Object.entries(skillPatch)) {
  if (!sid.startsWith('chr_')) continue;
  const c = classifySkill(sid);
  if (c.unknown) note(`unrecognized skill tail: ${sid}`);
  const opId = sid.split('_').slice(0, 3).join('_');
  const levels = [];
  let hasScales = false;
  for (const e of s.SkillPatchDataBundle ?? []) {
    const bb = {};
    for (const { key, value } of e.blackboard ?? []) bb[key] = r3(value);
    const scales = [];
    for (const [k, v] of Object.entries(bb)) {
      const idx = scaleIdx(k);
      if (idx !== null) scales.push({ key: k, idx, v });
    }
    scales.sort((a, b) => a.idx - b.idx || a.key.localeCompare(b.key));
    if (scales.length) hasScales = true;
    const descs = (e.subDescDataList ?? []).map((d) => d.desc);
    levels.push({
      lv: e.level,
      scales: scales.map((x) => x.v),
      scaleKeys: scales.map((x) => x.key),
      poise: bb.poise ?? null,
      atb: bb.atb ?? null,
      cd: e.coolDown ?? null,
      display: descs[0] || null,
      bb,
    });
  }
  if (!hasScales && !c.passive) note(`skill without atk_scale: ${sid}`);
  skillList.push({ id: sid, op: opId, kind: c.kind, hit: c.hit || '', passive: !!c.passive, damage: hasScales, levels });
}
fact(`skills total=${skillList.length}; damage skills=${skillList.filter((s) => s.damage).length}`);

// ------------------------------------------------------- equipment (armor)
// EquipTable: 276 pieces, ids item_equip_t{0-4}_{parts|suit}_{set}_{body|hand|edc}_{n}.
// partType: 0=body, 1=hand, 2=device (edc). Each piece has 4 enhance stages
// (EquipConst.maxAttrEnhanceLevel = 3) with parallel attrValues arrays.
// Names come from ItemTable (int64 i18n refs — only safe with the quoting fix).
const equipTable = load('EquipTable.json');
const suitTable = load('EquipSuitTable.json');
const itemTable = load('ItemTable.json');
const SLOT_NAMES = { 0: 'Body', 1: 'Hand', 2: 'Device' };
// attrType-0 rows are Main/Sub attribute affixes. The dump disambiguates them
// via modifyAttributeType (1=Main, 2=Sub) and modifierType (5=flat points,
// 6=fraction of the attribute). A single dense-object key '0' would collide,
// so use pseudo-keys: 0fm/0pm (Main flat/frac), 0fs/0ps (Sub flat/frac).
const keyOf = (am) => {
  if (am.attrType !== 0) return am.attrType;
  const main = am.modifyAttributeType === 1;
  const frac = am.modifierType === 6;
  return (frac ? '0p' : '0f') + (main ? 'm' : 's');
};
const equipItems = {};
let equipNoName = 0;
for (const [id, rec] of Object.entries(equipTable)) {
  const m = id.match(/^item_equip_t(\d)_(?:parts|suit)_(\w+)_(body|hand|edc)_(\d+)$/);
  const itemRec = itemTable[id];
  const name = (itemRec && T(itemRec.name)) || '';
  if (!name) equipNoName++;
  const st = [{}, {}, {}, {}];
  for (const am of rec.equipAttrModifiers ?? []) {
    const key = keyOf(am);
    const vals = am.attrValues ?? [];
    for (let s = 0; s < 4; s++) {
      const v = vals[s];
      if (!v) continue;
      st[s][key] = st[s][key] == null ? r3(v) : r3(st[s][key] + v);
    }
  }
  equipItems[id] = {
    id,
    name: name || id.replace(/^item_equip_/, ''),
    tier: m ? +m[1] : 0,
    slot: rec.partType ?? 0,
    suit: rec.suitID || '',
    minLv: rec.minWearLv ?? 0,
    rarity: itemRec?.rarity ?? 0,
    st,
  };
}
if (equipNoName) note(`${equipNoName} equip pieces have no i18n name`);
const suits = {};
for (const [sid, rec] of Object.entries(suitTable)) {
  const name = (rec.list ?? []).map((l) => T(l.suitName)).find(Boolean) || sid;
  const req = [];
  for (const l of rec.list ?? []) {
    const skill = skillPatch[l.skillID];
    const bb = {};
    for (const { key, value } of skill?.SkillPatchDataBundle?.[0]?.blackboard ?? []) bb[key] = r3(value);
    req.push({ cnt: l.equipCnt, skill: l.skillID, bb });
  }
  suits[sid] = { name, req };
}
fact(`equipment: ${Object.keys(equipItems).length} pieces, ${Object.keys(suits).length} suits`);
// Display labels for gear affix bundle-keys. Base labels come from the i18n
// filter dictionary (and the attribute table); a curated override map then
// replaces the raw internal strings ("PhysicalDamageTakenScalar",
// "Icon fire damage increase", ...) with readable ones, and disambiguates the
// attrType-0 pseudo-keys (0fm/0pm/0fs/0ps). Used by the UI gear picker.
const attrFilter = load('AttributeFilterTable.json');
const affixNames = { ...attrNames };
for (const row of attrFilter.equipExtraAttr?.list ?? []) {
  const label = T(row.name);
  if (!label) continue;
  if (row.attributeType === 0 && row.compositeAttr === 'Main') { affixNames['0fm'] = label; affixNames['0pm'] = label; }
  else if (row.attributeType === 0 && row.compositeAttr === 'Sub') { affixNames['0fs'] = label; affixNames['0ps'] = label; }
  else affixNames[String(row.attributeType)] = label;
}
for (const [k, label] of Object.entries({
  // six per-element scalar rows the game displays as one composite
  4: 'Final DMG Reduction', 5: 'Final DMG Reduction', 6: 'Final DMG Reduction',
  7: 'Final DMG Reduction', 48: 'Final DMG Reduction', 60: 'Final DMG Reduction',
  // elemental damage bonuses, named after the in-game elements
  50: 'Physical DMG Bonus', 51: 'Fire DMG Bonus', 52: 'Pulse DMG Bonus',
  53: 'Cryst DMG Bonus', 54: 'Natural DMG Bonus',
  10: 'Critical DMG', 17: 'Basic ATK DMG Bonus', 28: 'Ultimate Skill DMG Bonus',
  32: 'Battle Skill DMG Bonus', 33: 'Combo Skill DMG Bonus',
  39: 'Strength', 40: 'Agility', 41: 'Wisdom', 42: 'Will',
  '0fm': 'Main Attribute', '0pm': 'Main Attribute', '0fs': 'Secondary Attribute', '0ps': 'Secondary Attribute',
})) affixNames[k] = label;
delete affixNames['0']; // pseudo-keys replace the old colliding "0"
const atb = Object.values(equipItems).find((x) => x.id === 'item_equip_t4_suit_atb01_hand_02') ||
  equipItems['item_equip_t4_suit_atb01_hand_02'];
if (atb) fact(`sample gear ${atb.name}: stage1 = ${JSON.stringify(atb.st[1])}`);

// ------------------------------------------------------- enemies (target presets)
// Per-level DEF from levelDependentAttributes + uniform elemental resistance at
// top level. Base ids match /^eny_\d+_[a-z]+$/ ; suffixed ids are dungeon/elite
// variants. `eny_0018_lbtough` is the in-game training dummy.
const dummyId = 'eny_0018_lbtough';
const enemies = [];
for (const [id, e] of Object.entries(enemyTable)) {
  const byLevel = new Map();
  for (const row of e.levelDependentAttributes ?? []) {
    const lvl = Math.round(row.attrs?.find((a) => a.attrType === 0)?.attrValue ?? 0);
    if (!lvl) continue;
    byLevel.set(lvl, row.attrs?.find((a) => a.attrType === 3)?.attrValue ?? 0);
  }
  if (!byLevel.size) continue;
  const lvls = [...byLevel.keys()].sort((a, b) => a - b);
  const res = r3(Math.max(
    e.physicalResistance ?? 0, e.fireResistance ?? 0,
    e.pulseResistance ?? 0, e.crystResistance ?? 0, e.naturalResistance ?? 0,
  ));
  enemies.push({
    id,
    name: id.replace(/^eny_\d+/, '').replace(/_/g, ' ').trim(),
    base: /^eny_\d+_[a-z]+$/.test(id),
    dummy: id === dummyId,
    levels: lvls.map((l) => ({ lv: l, def: byLevel.get(l) })),
    res,
  });
}
enemies.sort((a, b) => (b.dummy - a.dummy) || (b.base - a.base) || a.name.localeCompare(b.name));
const dummy = enemies.find((x) => x.dummy);
if (dummy) fact(`dummy ${dummy.id}: L20 DEF=${dummy.levels.find((l) => l.lv === 20)?.def ?? '?'} res=${dummy.res}%`);

// ------------------------------------------------------- meta
// Commit of the upstream dump: prefer the marker file written by
// tools/fetchData.mjs (raw-file snapshot), fall back to a git checkout.
let commit = 'unknown';
try {
  const marker = join(ROOT, '.data', 'endfieldata', '.commit');
  if (existsSync(marker)) commit = readFileSync(marker, 'utf8').trim();
} catch { /* no marker */ }
if (commit === 'unknown') {
  try { commit = execSync('git -C .data/endfieldata rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { /* offline */ }
}
let gameVersion = '';
try { gameVersion = (raw('README.md').match(/v?(\d+\.\d+[\.\d]*)/)?.[1]) || ''; } catch { /* no readme */ }

const bundles = {
  'meta.json': {
    source: 'https://github.com/rmxlinux/EndfieldData',
    commit,
    gameVersion,
    builtAt: new Date().toISOString(),
    operators: operators.length,
    weapons: weapons.length,
    skills: skillList.length,
    enemies: enemies.length,
    equipment: Object.keys(equipItems).length,
    suits: Object.keys(suits).length,
  },
  'operators.json': operators,
  'weapons.json': { curves, weapons },
  'skills.json': skillList,
  'attrnames.json': attrNames,
  'traits.json': { traitDefs, potentialSkills },
  'equipment.json': { items: equipItems, suits, affixNames },
  'enemies.json': enemies,
  'diagnostics.json': { warnings: diag.warnings.slice(0, 200), facts: diag.facts.slice(0, 200), warningCount: diag.warnings.length },
};
for (const [name, obj] of Object.entries(bundles)) {
  writeFileSync(join(OUT, name), JSON.stringify(obj));
  console.log(`data/${name}: ${(Buffer.byteLength(JSON.stringify(obj)) / 1024).toFixed(0)} KB`);
}
console.log('\n--- ground-truth facts ---');
diag.facts.forEach((f) => console.log(' ', f));
console.log(`\nwarnings: ${diag.warnings.length}`);
diag.warnings.slice(0, 15).forEach((w) => console.log(' !', w));