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
// attr 41: the EN dump never spells it out (only an icon_attribute_wisd asset,
// from which the icon fallback derives "Wisd") — but the in-game name is
// "Intellect" (confirmed in the game's own suit descriptions, e.g.
// "Intellect +50. When HP > 80%, Arts DMG +20%"). Force the curated label.
attrNames[41] = 'Intellect';
attrNames[42] = attrNames[42] || 'Will';
for (const code of [0, 1, 2, 3, 9, 10, 39, 40, 41, 42]) {
  if (!attrNames[code]) note(`attribute code ${code} has no display name`);
}

// ------------------------------------------------------- weapon type names
// "claym" is the EN "Greatsword" (confirmed in I18nTextTable_EN: the only
// weapon-type label among sword/lance/claym/pistol/funnel besides "Funnel");
// "funnel" has no EN type label in-game, keep the raw prefix.
const wpnPrefixNames = { sword: 'Sword', lance: 'Lance', claym: 'Greatsword', pistol: 'Pistol', funnel: 'Funnel' };
const wpnTypeByCode = {};
for (const [id, w] of Object.entries(wpnBasic)) {
  const nm = wpnPrefixNames[id.split('_')[1]];
  if (nm) wpnTypeByCode[w.weaponType] = nm;
}
const wpnTypeName = (code) => wpnTypeByCode[code] || `Type ${code}`;

// ------------------------------------------------------- professions
const professions = {};
for (const [k, v] of Object.entries(professionTable)) professions[v.profession] = T(v.name) || `Profession ${v.profession}`;

// ------------------------------------------------------- operator potential
// CharacterPotentialTable: each operator -> a 5-tier unlock bundle. Each tier's
// effect row (PotentialTalentEffectTable.dataList) may carry:
//   - attribute modifiers: 39–42 (Str/Agi/Intel/Will flats; P2-style rows grant
//     all four, but only the operator's main/sub attributes affect damage —
//     the engine buckets by attr code) and 9 (crit rate fraction) — these are
//     folded into the model
//   - per-skill tweaks, buffs, other attribute types — described via the
//     effect row's i18n text so nothing is silently dropped
const POTENTIAL_FLAT_ATTRS = new Set([39, 40, 41, 42]);
// strip the dump's rich-text markup: <@ba.x>…</> / <#ba.x> tags;
// {value} placeholders (game injects numbers at runtime) become a visible {n}
const stripMarkup = (t) => String(t || '').replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '{n}').trim();
const potentialTable = load('CharacterPotentialTable.json'); // keyed by operator id
const potentialFx = new Map(Object.entries(load('PotentialTalentEffectTable.json'))); // keyed by effect id
function operatorPotential(opId) {
  const row = potentialTable[opId];
  if (!row) { note(`${opId}: missing from CharacterPotentialTable`); return null; }
  const bundle = (row.potentialUnlockBundle ?? []).slice().sort((a, b) => a.level - b.level);
  const tiers = bundle.map((e) => {
    const fx = e.potentialEffectId ? potentialFx.get(e.potentialEffectId) : undefined;
    if (!fx) {
      note(`${opId} P${e.level}: effect ${e.potentialEffectId} not found`);
      return { attrs: [], info: [] };
    }
    const attrs = [];
    for (const d of fx.dataList ?? []) {
      const m = d.attrModifier;
      if (!m) continue;
      if (m.attrType === 9) attrs.push({ cr: r3(m.attrValue) });
      else if (POTENTIAL_FLAT_ATTRS.has(m.attrType)) attrs.push({ attr: m.attrType, flat: r3(m.attrValue) });
    }
    const info = stripMarkup(fx.desc?.text || T(fx.desc));
    return { attrs, info: info ? [info] : [] };
  });
  while (tiers.length < 5) tiers.push({ attrs: [], info: [] });
  return tiers;
}

// ------------------------------------------------------- weapon essence (gems)
// Slot roles from WeaponBasicTable.weaponSkillList prefixes:
//   wpn_attr_*    = main-stat gem (mainattr / raw Str|Agi|Intel|Will flats)
//   wpn_sp_attr_* = sub-stat gem (ATK %, crit rate, elemental/Arts DMG %)
//   sk_wpn_*      = weapon-skill gem (the weapon passive)
// Ranks R1–R9 are levels 1–9 of the gem's own SkillPatchTable bundle — the
// bundle stores absolute per-rank values, so rank N is the level-N row.
// Rank entry keys: main (wielder-main-attr flat), attr39..42 (raw attr flats,
// engine buckets by main/sub code), atkPct / cr / cridmg / dmgBonus (summed
// fractions), atkUp (<=1 ATK% fraction, >1 flat ATK — branched in engine),
// extraHit (extra-hit scale), elem* / primaryUp / secondUp / allUp (summed
// % fractions), rest (unmapped / conditional keys — info only).
const gemNameOf = (g) => {
  const entry = (skillPatch[g]?.SkillPatchDataBundle ?? [])[0];
  return entry ? T(entry.skillName) || g : g;
};
const GEM_ELEM_KEY = { phy: 'elemPhy', fire: 'elemFire', pulse: 'elemPulse', cryst: 'elemCryst', nature: 'elemNature' };
// Sub-stat gems spell the element out in full (no underscore):
// phydam / firedam / electrondam / crystdam / naturaldam
const GEM_ELEM_FULL = { phydam: 'elemPhy', firedam: 'elemFire', electrondam: 'elemPulse', crystdam: 'elemCryst', naturaldam: 'elemNature' };

// L1 gate: a gem's blackboard mixes always-on effects with conditional
// (team/buff) effects. A bb key is always-on iff its {key} placeholder
// appears on the FIRST line of the gem's level-1 description (resolved via
// i18n, markup stripped). Validated across all 128 essence gems — every other
// key is surfaced as info only (its text rides along in `lines`).
const gemL1 = (g) => {
  const bundle = skillPatch[g]?.SkillPatchDataBundle ?? [];
  const entry = bundle.find((p) => p.level === 1) ?? bundle[0];
  if (!entry) return { lines: [], fold: new Set() };
  // extract the L1 placeholder set from tag-stripped text BEFORE stripMarkup
  // rewrites {key:..} into the display-safe {n}
  const rawLines = String(T(entry.description) || '').replace(/<[^>]*>/g, '')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fold = new Set();
  for (const m of (rawLines[0] || '').matchAll(/\{([a-zA-Z0-9_ ]+?)(?::|})/g)) fold.add(m[1].trim());
  return { lines: rawLines.map(stripMarkup), fold };
};

const notedUnmapped = new Set();
function mapGemRank(bb, fold, g) {
  const mapped = {};
  const rest = [];
  for (const [k, v] of Object.entries(bb)) {
    // atk_scale is exempt from the L1 gate: it exists in exactly one gem
    // (sk_wpn_lance_0010) whose placeholder sits on line 2, but the extra hit
    // is the skill's base effect, always on.
    if (k === 'atk_scale') { mapped.extraHit = v; continue; }
    if (!fold.has(k)) { rest.push(k); continue; }
    if (k === 'mainattr') mapped.main = v; // wielder's main attribute, flat
    else if (k === 'str') mapped.attr39 = v;
    else if (k === 'agi') mapped.attr40 = v;
    else if (k === 'wisd') mapped.attr41 = v;
    else if (k === 'will') mapped.attr42 = v;
    else if (['atk', 'atk_up1', 'atk_up2', 'atk_up_add', 'atk_up_mult'].includes(k)) mapped.atkPct = r3((mapped.atkPct ?? 0) + v);
    else if (['crirate', 'crit_up', 'crit_up2'].includes(k)) mapped.cr = r3((mapped.cr ?? 0) + v);
    else if (k === 'cridmg') mapped.cridmg = v;
    else if (k === 'atk_up') mapped.atkUp = v; // <=1 = ATK % fraction, >1 = flat ATK (branched in the engine)
    else if (k === 'spelldam' || k === 'dmg_up' || k === 'dmg_up2' || k.startsWith('spell_dmg_up')) mapped.dmgBonus = r3((mapped.dmgBonus ?? 0) + v);
    else if (GEM_ELEM_FULL[k]) mapped[GEM_ELEM_FULL[k]] = r3((mapped[GEM_ELEM_FULL[k]] ?? 0) + v);
    else {
      const ek = GEM_ELEM_KEY[String(k).split('_')[0]];
      if (ek && /dam|dmg/.test(k)) mapped[ek] = r3((mapped[ek] ?? 0) + v);
      else if (k === 'primary_attr_up') mapped.primaryUp = r3((mapped.primaryUp ?? 0) + v);
      else if (k === 'second_attr_up') mapped.secondUp = r3((mapped.secondUp ?? 0) + v);
      else if (k === 'all_attr_up' || k === 'all_attr_up2') mapped.allUp = r3((mapped.allUp ?? 0) + v);
      else if (!notedUnmapped.has(`${g}:${k}`)) {
        rest.push(k);
        notedUnmapped.add(`${g}:${k}`);
        note(`essence ${g}: L1 key "${k}" has no mapping — treated as info`);
      } else rest.push(k);
    }
  }
  return rest.length ? { ...mapped, rest } : mapped;
}

function essenceSlots(w) {
  const slots = [];
  for (const g of w.weaponSkillList ?? []) {
    const role = g.startsWith('wpn_attr_') ? 'main' : g.startsWith('wpn_sp_attr_') ? 'sub' : g.startsWith('sk_wpn_') ? 'skill' : null;
    if (!role) { note(`weapon ${w.id}: unrecognized essence slot "${g}"`); continue; }
    const { lines, fold } = gemL1(g);
    const ranks = [];
    for (let r = 1; r <= 9; r++) {
      const entry = (skillPatch[g]?.SkillPatchDataBundle ?? []).find((p) => p.level === r);
      if (!entry) note(`essence ${g}: rank ${r} missing from SkillPatchTable`);
      const bb = {};
      for (const { key, value } of entry?.blackboard ?? []) {
        const k = String(key).trim(); // one bundle ships a trailing-space key ("cd ")
        if (k === 'lv') continue; // level echo, not a bonus
        bb[k] = r3(value);
      }
      ranks.push(mapGemRank(bb, fold, g));
    }
    slots.push({ id: g, role, name: gemNameOf(g), lines, ranks });
  }
  return slots;
}

// ------------------------------------------------------- operators
const SLOT_CODES = [1, 2, 3, 9, 10, 39, 40, 41, 42]; // hp, atk, def, critRate, critDmg, str, agi, intellect, will
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
    potential: operatorPotential(id),
  });
}
// sanity: Laevatain L90 base ATK
const laev = operators.find((o) => o.id === 'chr_0016_laevat');
if (laev) fact(`Laevatain L90: HP=${laev.levels[89].a[0]} ATK=${laev.levels[89].a[1]} crit=${laev.levels[89].a[3]} intellect=${laev.levels[89].a[7]}`);

// ------------------------------------------------------- weapons
// Weapon origin (probed from the dump, the three sets do not overlap):
//   bp  — battle-pass weapons: item_wpnpotentialup_bp.weaponIds
//         (WeaponPotentialUpItemTable)
//   sig — signature (paid gacha) weapons: reward_payshop_wpn_<type>_<nnnn>
//         reward ids referenced from GachaWeaponPoolTable rows
//   std — everything else
const wpnPotTable = load('WeaponPotentialUpItemTable.json');
const gwpTable = load('GachaWeaponPoolTable.json');
const bpWeapons = new Set(Object.values(wpnPotTable).flatMap((v) => v.weaponIds ?? []));
const sigWeapons = new Set();
for (const v of Object.values(gwpTable)) {
  for (const m of JSON.stringify(v).matchAll(/reward_payshop_wpn_([a-z]+)_(\d{4})/g)) {
    sigWeapons.add(`wpn_${m[1]}_${m[2]}`);
  }
}
const originOf = (id) => (bpWeapons.has(id) ? 'bp' : sigWeapons.has(id) ? 'sig' : 'std');
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
    origin: originOf(id),
    maxLv: w.maxLv ?? 90,
    curve: w.levelTemplateId,
    potentialSkill: w.weaponPotentialSkill || '',
    traits: (w.weaponSkillList ?? []).filter((t) => t !== w.weaponPotentialSkill),
    essence: essenceSlots(w),
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
fact(`weapon origins: bp=${weapons.filter((w) => w.origin === 'bp').length} sig=${weapons.filter((w) => w.origin === 'sig').length} std=${weapons.filter((w) => w.origin === 'std').length}`);

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
  wisd: (v) => `+${v} Intellect`,
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
  if (/^plunging_attack/.test(tail)) return { kind: 'Dive Attack', hit: '' };
  m = tail.match(/^power_?attack(\d*)$/);
  if (m) return { kind: 'Finisher', hit: m[1] };
  // "dash_attack" has no in-game counterpart — in the client, dashing is pure
  // evasion (stamina cost, perfect-dodge SP). The dump row is dead data.
  if (tail === 'dash_attack') return null;
  m = tail.match(/^attack(\d*)(_\d+)?$/);
  if (m) return { kind: 'Basic Hit', hit: m[1] || '' };
  if (/^reaction/.test(tail)) return { kind: 'Reaction', hit: '' };
  return { kind: tail.replace(/_/g, ' '), hit: '', unknown: true };
}
// In-game, each operator has exactly THREE levelable skill trees — Basic
// Attack, Battle Skill (includes the combo/follow-up skills) and Ultimate.
// Every other skill row (dive/finisher hits, during-ult variants, ult
// follow-up hits) rides on one of those trees. The grouping is read from the
// level-1 icon (icon_attack_* / icon_skill_* / icon_combo_skill_* /
// icon_ultimate_skill_*) disambiguated by the id tail: "ult_attack*" rows
// wear the generic attack icon but belong to the Ultimate tree, while
// "attackN_ult" (basics performed during the ult) are Basic tree.
function iconPrefix(ic) {
  if (ic.startsWith('icon_ultimate_skill')) return 'ultimate';
  if (ic.startsWith('icon_combo_skill')) return 'combo';
  if (ic.startsWith('icon_skill_')) return 'skill';
  if (ic.startsWith('icon_attack_')) return 'attack';
  return 'other';
}
function skillTree(prefix, tail) {
  if (prefix === 'ultimate') return 'ult';
  if (/^ult(_|$)/.test(tail)) return 'ult'; // ult_attackN(_N)?, ult_attack_end
  if (prefix === 'skill' || prefix === 'combo') return 'skill';
  if (prefix === 'attack') return 'basic';
  // anomalous icon -> infer from the tail
  if (/skill/.test(tail)) return 'skill';
  return 'basic';
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
  if (!c) continue; // no in-game counterpart (dash_attack dead rows)
  if (c.unknown) note(`unrecognized skill tail: ${sid}`);
  const opId = sid.split('_').slice(0, 3).join('_');
  const ic = (s.SkillPatchDataBundle?.[0]?.iconId) || '';
  const ip = iconPrefix(ic);
  if (ip === 'other') note(`${sid}: unusual icon "${ic}"`);
  const tail = sid.replace(/^chr_\d+_[a-z]+_/, '');
  const tree = skillTree(ip, tail);
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
  skillList.push({ id: sid, op: opId, kind: c.kind, hit: c.hit || '', tree, passive: !!c.passive, damage: hasScales, levels });
}
fact(`skills total=${skillList.length}; damage skills=${skillList.filter((s) => s.damage).length}; trees basic=${skillList.filter((s) => s.tree === 'basic').length} skill=${skillList.filter((s) => s.tree === 'skill').length} ult=${skillList.filter((s) => s.tree === 'ult').length}`);

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
// Enhanceable slots per piece: the game caps them at 3 (EquipConst). The dump
// lists them in displayAttrModifiers — one row per slot, carrying the 4-stage
// value array (attrValue + enhancedAttrValues) and, for composites, the
// group of equip rows it covers (same 4-stage values). Rows with an empty
// enhancedAttrValues (t0–t3 pieces) are fixed in-game and get no slot.
// Match display rows to equip rows by attrIndex first (display numbering can
// drift from equip numbering on some pieces), falling back to the 4-stage
// value match (relative tolerance 1e-4) — validated against all 276 pieces.
const enhClose = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-4);
const enhSameArr = (a, b) => a.length === b.length && a.length > 0 && a.every((v, i) => enhClose(v, b[i]));
const equipItems = {};
let equipNoName = 0;
let enhSlotCount = 0;
let enhUnmatched = 0;
for (const [id, rec] of Object.entries(equipTable)) {
  const m = id.match(/^item_equip_t(\d)_(?:parts|suit)_(\w+)_(body|hand|edc)_(\d+)$/);
  const itemRec = itemTable[id];
  const name = (itemRec && T(itemRec.name)) || '';
  if (!name) equipNoName++;
  const st = [{}, {}, {}, {}];
  const rows = rec.equipAttrModifiers ?? [];
  for (const am of rows) {
    const key = keyOf(am);
    const vals = am.attrValues ?? [];
    for (let s = 0; s < 4; s++) {
      const v = vals[s];
      if (!v) continue;
      st[s][key] = st[s][key] == null ? r3(v) : r3(st[s][key] + v);
    }
  }
  // game slots -> groups of bundle keys (order: display rows, then rows)
  const byIdx = {};
  for (const am of rows) (byIdx[am.attrIndex] ||= []).push(am);
  const used = new Set();
  const enh = [];
  for (const d of rec.displayAttrModifiers ?? []) {
    const ev = d.enhancedAttrValues ?? [];
    if (!ev.length) continue; // fixed in-game — no enhanceable slot
    const dv = [d.attrValue, ...ev];
    const idxRows = (byIdx[d.attrIndex] ?? []).filter((am) => !used.has(am));
    const hit = (idxRows.length && idxRows.every((am) => enhSameArr(am.attrValues ?? [], dv)))
      ? idxRows
      : rows.filter((am) => !used.has(am) && enhSameArr(am.attrValues ?? [], dv));
    if (!hit.length) {
      enhUnmatched++;
      note(`${id}: display slot ${d.attrIndex} (pack ${d.packAttrType || '?'}) unmatched`);
      continue;
    }
    for (const am of hit) used.add(am);
    enh.push(hit.map((am) => String(keyOf(am))));
  }
  enhSlotCount += enh.length;
  equipItems[id] = {
    id,
    name: name || id.replace(/^item_equip_/, ''),
    tier: m ? +m[1] : 0,
    slot: rec.partType ?? 0,
    suit: rec.suitID || '',
    minLv: rec.minWearLv ?? 0,
    rarity: itemRec?.rarity ?? 0,
    st,
    enh,
  };
}
if (equipNoName) note(`${equipNoName} equip pieces have no i18n name`);
fact(`enhanceable slots: ${enhSlotCount} across ${Object.keys(equipItems).length} pieces (<=3 per piece, as in-game); unmatched display slots: ${enhUnmatched}`);
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
  39: 'Strength', 40: 'Agility', 41: 'Intellect', 42: 'Will',
  '0fm': 'Main Attribute', '0pm': 'Main Attribute', '0fs': 'Secondary Attribute', '0ps': 'Secondary Attribute',
})) affixNames[k] = label;
delete affixNames['0']; // pseudo-keys replace the old colliding "0"
const atb = Object.values(equipItems).find((x) => x.id === 'item_equip_t4_suit_atb01_hand_02') ||
  equipItems['item_equip_t4_suit_atb01_hand_02'];
if (atb) fact(`sample gear ${atb.name}: stage1 = ${JSON.stringify(atb.st[1])}`);

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
    equipment: Object.keys(equipItems).length,
    suits: Object.keys(suits).length,
  },
  'operators.json': operators,
  'weapons.json': { curves, weapons },
  'skills.json': skillList,
  'attrnames.json': attrNames,
  'traits.json': { traitDefs, potentialSkills },
  'equipment.json': { items: equipItems, suits, affixNames },
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