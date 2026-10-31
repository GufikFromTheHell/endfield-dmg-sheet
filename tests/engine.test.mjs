// tests/engine.test.mjs — engine verification against settled ground truth.
//
// Anchors (validated against the reference Google Sheet and the rmxlinux/
// EndfieldData dump):
//   Laevatain L90 (chr_0016_laevat): base ATK 318, WIS(main, 41) 177.985,
//     STR(sub, 39) 121.374, CR 5%, CD bonus 0 (total 50).
//   Tarr 11 (wpn_sword_0003) L90: ATK 283; essence R1/R9: +12 / +33.6 flat
//   ATK (skill slot), main gem R9 adds +79 WIS (joins the main stat).
//   Sheet "Base atk" 729 = 318 + 283 + 128 (gear flat).
//   FA = 729 × (1 + 177.985×0.005 + 121.374×0.002) = 1,554.7186...
//   Sheet Battle Skill row 17,206.8 = FA × avgCrit(1.025) × scale 10.7975.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRIT_DMG_BASE,
  statBonusMultiplier,
  finalAttack,
  calcHit,
  calcSequence,
  dps,
  defenseZone,
  anomalyMultiplier,
  operatorAtLevel,
  weaponAtk,
  operatorSkills,
  buildAttack,
  gearContribution,
} from '../src/engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = (name) => JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8'));
const operators = bundle('operators.json');
const weapons = bundle('weapons.json');
const skills = bundle('skills.json');
const equipment = bundle('equipment.json');

const closeTo = (actual, expected, tol, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg} got ${actual}, expected ${expected} ± ${tol}`);

// ------------------------------------------------------------- stat bonus

test('statBonusMultiplier matches the confirmed formula', () => {
  // raw (unrounded) CharacterTable values
  closeTo(statBonusMultiplier(177.98527, 121.37446), 2.13267527, 1e-6);
  // bundle values (rounded to 3 decimals by normalize)
  closeTo(statBonusMultiplier(177.985, 121.374), 2.132673, 1e-6);
  closeTo(statBonusMultiplier(0, 0), 1, 0);
  closeTo(statBonusMultiplier(undefined, undefined), 1, 0);
});

// ------------------------------------------------------------- final attack

test('finalAttack: Laevatain L90 anchor (raw attrs)', () => {
  const fa = finalAttack({
    baseAtk: 318,
    weaponAtk: 283,
    flatAtk: 128,
    mainStat: 177.98527,
    subStat: 121.37446,
  });
  closeTo(fa, 1554.720272, 0.0001, 'FA raw');
});

test('finalAttack: atk% applies to (base+weapon) before flat, stat bonus to the whole', () => {
  const basePart = (318 + 283) * 1.08 + 128; // 869.6
  const fa = finalAttack({
    baseAtk: 318,
    weaponAtk: 283,
    atkPct: 8,
    flatAtk: 128,
    mainStat: 177.98527,
    subStat: 121.37446,
  });
  closeTo(fa, basePart * statBonusMultiplier(177.98527, 121.37446), 1e-9);
});

test('finalAttack: no stats -> plain sum', () => {
  closeTo(finalAttack({ baseAtk: 300, weaponAtk: 200, flatAtk: 50 }), 550, 0);
  closeTo(finalAttack({}), 0, 0);
});

// ------------------------------------------------------------- bundle lookups

test('operatorAtLevel: Laevatain L90', () => {
  const r = operatorAtLevel(operators, 'chr_0016_laevat', 90);
  assert.equal(r.name, 'Laevatain');
  assert.equal(r.atk, 318);
  assert.equal(r.hp, 5495);
  closeTo(r.mainValue, 177.985, 1e-9); // attrType 41 (WIS)
  closeTo(r.subValue, 121.374, 1e-9); // attrType 39 (STR)
  closeTo(r.statBonus, 2.132673, 1e-6);
  assert.equal(r.critRate, 5);
  assert.equal(r.critDmg, 50); // stored bonus 0 -> game base 50
  assert.equal(r.mainAttr, 41);
  assert.equal(r.subAttr, 39);
  assert.equal(r.defaultWeapon, 'wpn_sword_0003');
});

test('operatorAtLevel: unknown op returns null; level clamps', () => {
  assert.equal(operatorAtLevel(operators, 'chr_nope', 90), null);
  const low = operatorAtLevel(operators, 'chr_0016_laevat', 5);
  const maxed = operatorAtLevel(operators, 'chr_0016_laevat', 99);
  const hi = operatorAtLevel(operators, 'chr_0016_laevat', 500);
  assert.ok(low.atk > 0 && low.atk < 318);
  assert.ok(maxed.atk >= 318);
  assert.equal(hi.atk, maxed.atk); // clamped to the highest available level
});

test('weaponAtk: Tarr 11 curve', () => {
  assert.equal(weaponAtk(weapons, 'wpn_sword_0003', 90), 283);
  assert.equal(weaponAtk(weapons, 'wpn_sword_0003', 1), 29);
  assert.equal(weaponAtk(weapons, 'wpn_nope', 90), 0);
});

test('weapons: every weapon has an origin; bundle split is 13 bp / 17 sig / 54 std', () => {
  const list = weapons.weapons;
  assert.ok(list.length >= 80, `bundle should hold ~84 weapons, got ${list.length}`);
  const bad = list.filter((w) => !['bp', 'sig', 'std'].includes(w.origin));
  assert.equal(bad.length, 0, `weapons with missing/unknown origin: ${bad.map((w) => w.id).join(', ')}`);
  const bp = list.filter((w) => w.origin === 'bp').length;
  const sig = list.filter((w) => w.origin === 'sig').length;
  const std = list.filter((w) => w.origin === 'std').length;
  assert.equal(bp, 13, `bp count ${bp}`);
  assert.equal(sig, 17, `sig count ${sig}`);
  assert.equal(std, 54, `std count ${std}`);
  assert.equal(bp + sig + std, list.length, 'origins partition the whole bundle');
});

test('buildAttack: Tarr 11 essence ranks (skill slot atkUp, main slot WIS)', () => {
  const r0 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponId: 'wpn_sword_0003',
    essRanks: { main: 0, sub: 0, skill: 0 },
  });
  closeTo(r0.finalAttack, 1281.7, 0.05, 'no-essence anchor');
  assert.equal(r0.essAtkFlat, 0);

  const r1 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponId: 'wpn_sword_0003',
    essRanks: { main: 1, sub: 0, skill: 1 },
  });
  closeTo(r1.essAtkFlat, 12, 1e-9, 'skill R1 atkUp 12 -> flat weapon ATK');
  closeTo(r1.finalAttack, 1338.0, 0.05, 'essence R1 anchor');

  const r9 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponId: 'wpn_sword_0003',
    essRanks: { main: 9, sub: 0, skill: 9 },
  });
  closeTo(r9.essAtkFlat, 33.6, 1e-9, 'skill R9 atkUp 33.6');
  closeTo(r9.mainTotal, 177.985 + 79, 1e-9, 'main R9 {main:79} -> +79 WIS');
  closeTo(r9.finalAttack, 1604.1, 0.05, 'essence R9 anchor');
});

test('buildAttack: operator potential tiers (Laevatain P2, Wulfgard P1, Yvonne P2)', () => {
  const l0 = buildAttack(operators, weapons, { opId: 'chr_0016_laevat', opLv: 90 });
  closeTo(l0.finalAttack, 1281.7, 0.05, 'no-potential anchor');

  const l2 = buildAttack(operators, weapons, { opId: 'chr_0016_laevat', opLv: 90, pot: 2 });
  assert.deepEqual(l2.potGain, { main: 20, sub: 0, crit: 0 });
  closeTo(l2.mainTotal, 177.985 + 20, 1e-9, 'P2 WIS +20 joins main before the stat bonus');
  closeTo(l2.finalAttack, 1341.8, 0.05, 'Laevatain P2 anchor');

  const w0 = buildAttack(operators, weapons, { opId: 'chr_0006_wolfgd', opLv: 90 });
  closeTo(w0.finalAttack, 1153.7, 0.05, 'Wulfgard base anchor');
  const w1 = buildAttack(operators, weapons, { opId: 'chr_0006_wolfgd', opLv: 90, pot: 1 });
  assert.deepEqual(w1.potGain, { main: 15, sub: 15, crit: 0 });
  closeTo(w1.finalAttack, 1214.3, 0.05, 'Wulfgard P1 anchor');

  const y0 = buildAttack(operators, weapons, { opId: 'chr_0017_yvonne', opLv: 90 });
  const y2 = buildAttack(operators, weapons, { opId: 'chr_0017_yvonne', opLv: 90, pot: 2 });
  closeTo(y2.critRate, y0.critRate + 7, 1e-6, 'Yvonne P2 CR +7%');
  closeTo(y2.potGain.main, 20, 1e-9, 'Yvonne P2 main +20');
});

test('buildAttack: essence extraHit + atkPct (Lance 0010)', () => {
  const e1 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponId: 'wpn_lance_0010',
    essRanks: { main: 1, sub: 0, skill: 1 },
  });
  closeTo(e1.extraHit, 1.2, 1e-9, 'extra-hit scale R1');
  closeTo(e1.essAtkPct, 10, 1e-9, 'atkUp 0.1 -> +10% ATK');

  const e9 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponId: 'wpn_lance_0010',
    essRanks: { main: 0, sub: 0, skill: 9 },
  });
  closeTo(e9.extraHit, 3.36, 1e-9, 'extra-hit scale R9');
  closeTo(e9.essAtkPct, 28, 1e-9, 'atkUp 0.28 -> +28% ATK');
});

test('buildAttack: full Laevatain build (sheet-flat gear)', () => {
  const b = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat',
    opLv: 90,
    weaponLv: 90,
    flatAtk: 128,
  });
  assert.ok(b);
  assert.equal(b.op.atk, 318);
  assert.equal(b.weaponId, 'wpn_sword_0003');
  assert.equal(b.weaponAtk, 283);
  closeTo(b.finalAttack, 1554.718617, 0.002, 'FA from bundles');

  const b2 = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat',
    opLv: 90,
    weaponLv: 90,
    flatAtk: 128,
    essRanks: { main: 0, sub: 0, skill: 9 },
  });
  // essence skill R9 atkUp (33.6) behaves like weapon ATK (inside the atk%
  // zone, before the stat bonus multiply)
  const expected = ((318 + 283 + 33.6) + 128) * statBonusMultiplier(177.985, 121.374);
  closeTo(b2.finalAttack, expected, 1e-6);
});

// ------------------------------------------------------------- crit / zones

test('avgCrit mechanics: 5% CR with 50% total CD -> avg = min × 1.025', () => {
  const r = calcHit({ atk: 1000, scales: 1, critRate: 5, critDmg: 50, targetDef: 0 });
  closeTo(r.min, 1000, 1e-9);
  closeTo(r.max, 1500, 1e-9);
  closeTo(r.avg, 1025, 1e-9);
  closeTo(r.avg / r.min, 1.025, 1e-9, 'avgCrit factor');
});

test('critDmg defaults to the 50% base when omitted', () => {
  const r = calcHit({ atk: 1000, scales: 1, critRate: 10, targetDef: 0 });
  closeTo(r.max, 1500, 1e-9);
  assert.equal(CRIT_DMG_BASE, 50);
});

test('defense zone and resistance', () => {
  closeTo(defenseZone(0), 1, 1e-12);
  closeTo(defenseZone(100), 0.5, 1e-12);
  closeTo(defenseZone(140), 100 / 240, 1e-9);
  const r = calcHit({ atk: 1000, scales: 1, targetDef: 100, targetResistPct: 25 });
  closeTo(r.min, 375, 1e-9);
});

test('additive bonus zones and staggered', () => {
  const r = calcHit({
    atk: 1000,
    scales: 1,
    damageBonusPct: 20,
    vulnerabilityPct: 10,
    amplificationPct: 5,
    fragilityPct: 2,
    sanctuaryPct: 4,
    damageReductionPct: 10,
    staggered: true,
    targetDef: 0,
  });
  const expected = 1000 * 1.2 * 1.1 * 1.05 * 1.02 * 0.96 * 0.9 * 1.3;
  closeTo(r.min, expected, 1e-6);
});

test('anomaly multipliers follow the reference table', () => {
  // per Taksumii reference: Burning/Electrification/Corrosion are
  // base + increment per level (0.12 + 0.12·lv, 0.8 + 0.8·lv, ...)
  closeTo(anomalyMultiplier('Burning', 3), 0.12 + 0.12 * 3, 1e-12);
  closeTo(anomalyMultiplier('Freeze', 5), 1.3, 1e-12);
  closeTo(anomalyMultiplier('Electrification', 2), 0.8 + 0.8 * 2, 1e-12);
  closeTo(anomalyMultiplier('Knockback', 1), 1.2, 1e-12);
  closeTo(anomalyMultiplier('Nothing', 1), 1, 1e-12);
  closeTo(anomalyMultiplier('', 0), 1, 1e-12);
});

// ------------------------------------------------------------- sheet parity

test('sheet cross-check: Battle Skill row 17,206.8 reproduced', () => {
  const b = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat',
    opLv: 90,
    weaponLv: 90,
    flatAtk: 128,
  });
  const r = calcHit({
    atk: b.finalAttack,
    scales: 10.7975, // sheet BS scale (displayed as 10.8 in the reference)
    critRate: b.op.critRate,
    critDmg: b.op.critDmg,
    targetDef: 0, // the reference sheet targets a DEF 0 dummy
  });
  closeTo(r.avg, 17206.8, 0.15, 'sheet BS avg');
  closeTo(r.min, 17206.8 / 1.025, 0.2, 'sheet BS min');
});

// ------------------------------------------------------------- skill data

test('skill scale sums (Laevatain, skill level 12, current dump)', () => {
  const list = operatorSkills(skills, 'chr_0016_laevat', 12);
  assert.ok(list.length >= 10);
  const sum = (id) => {
    const s = list.find((x) => x.id === id);
    return s ? s.scales.reduce((a, b) => a + b, 0) : NaN;
  };
  closeTo(sum('chr_0016_laevat_normal_skill'), 9.24, 0.0005, 'battle skill');
  closeTo(sum('chr_0016_laevat_normal_skill_during_ult'), 16.0, 0.0005, 'during ult');
  closeTo(sum('chr_0016_laevat_combo_skill'), 5.4, 0.0005, 'combo');
  closeTo(sum('chr_0016_laevat_ultimate_skill'), 6.08, 0.0005, 'ultimate');
  closeTo(sum('chr_0016_laevat_power_attack'), 9.0, 0.0005, 'heavy');
});

test('operatorSkills: per-tree level map (missing trees default to 12)', () => {
  const all12 = operatorSkills(skills, 'chr_0016_laevat', 12);
  // every Laevatain damage skill must belong to one of the three in-game trees
  for (const s of all12) assert.ok(['basic', 'skill', 'ult'].includes(s.tree), s.id + ' has no tree');
  const mixed = operatorSkills(skills, 'chr_0016_laevat', { ult: 1 });
  assert.equal(mixed.length, all12.length, 'same skill list');
  const u1 = mixed.find((s) => s.id === 'chr_0016_laevat_ultimate_skill');
  const u12 = all12.find((s) => s.id === 'chr_0016_laevat_ultimate_skill');
  closeTo(u1.scales.reduce((a, b) => a + b, 0), 2.7, 1e-9, 'ultimate tree at level 1');
  assert.notDeepEqual(u1.scales, u12.scales, 'lowered tree differs from lv12');
  // the ult follow-up hits ride on the same tree
  const ua1 = mixed.find((s) => s.id === 'chr_0016_laevat_ult_attack1');
  const ua12 = all12.find((s) => s.id === 'chr_0016_laevat_ult_attack1');
  assert.notDeepEqual(ua1.scales, ua12.scales, 'ult follow-up hit follows the ult tree');
  // unlisted trees stay at level 12
  const n12 = all12.find((s) => s.id === 'chr_0016_laevat_normal_skill');
  const nM = mixed.find((s) => s.id === 'chr_0016_laevat_normal_skill');
  assert.deepEqual(nM.scales, n12.scales, 'skill tree stays at level 12');
  const p12 = all12.find((s) => s.id === 'chr_0016_laevat_power_attack');
  const pM = mixed.find((s) => s.id === 'chr_0016_laevat_power_attack');
  assert.deepEqual(pM.scales, p12.scales, 'basic tree stays at level 12');
});

// ------------------------------------------------------------- sequences

test('calcSequence sums hits; dps divides by window', () => {
  const seq = calcSequence({ atk: 100, targetDef: 0 }, [
    { label: 'a', scales: 1, count: 2 },
    { label: 'b', scales: 3 },
  ]);
  closeTo(seq.min, 500, 1e-9); // 2×100 + 300
  closeTo(seq.avg, 500, 1e-9); // no crit in this setup
  assert.equal(seq.rows.length, 2);
  closeTo(dps(1000, 10), 100, 1e-12);
  closeTo(dps(1000, 0), 0, 0);
});

// ------------------------------------------------------------- coverage

test('all operators resolve (bundle coverage smoke test)', () => {
  assert.ok(operators.length >= 30, `operator count ${operators.length}`);
  for (const op of operators) {
    const r = operatorAtLevel(operators, op.id, 90);
    assert.ok(r, `missing L90 for ${op.id}`);
    assert.ok(Number.isFinite(r.atk) && r.atk > 0, `${op.id} atk`);
    assert.ok(Number.isFinite(r.mainValue) && r.mainValue > 0, `${op.id} main stat`);
    assert.ok(Number.isFinite(r.subValue) && r.subValue > 0, `${op.id} sub stat`);
    const wAtk = weaponAtk(weapons, r.defaultWeapon, 90);
    assert.ok(wAtk > 0, `${op.id} default weapon ${r.defaultWeapon}`);
    assert.ok(r.mainAttrName && r.subAttrName, `${op.id} attr names`);
  }
});

// ------------------------------------------------------------- gear

test('gearContribution: flat ATK vs ATK% affixes (attrType 2 by magnitude)', () => {
  // modifierType 6 fraction -> ATK %; modifierType 7 value >= 1 -> flat ATK
  const g1 = gearContribution(equipment, { d1: { id: 'item_equip_t2_suit_wisd01_edc_01', en: 0 } }, 'Fire');
  closeTo(g1.atkPct, 10.5, 1e-9, 'ATK% 0.105 -> 10.5%');
  closeTo(g1.flatAtk, 0, 0);
  closeTo(g1.main[41], 21, 1e-9, 'Wis main stat');

  const g2 = gearContribution(equipment, { body: { id: 'item_equip_t1_parts_tundra01_body_03', en: 0 } }, 'Fire');
  closeTo(g2.flatAtk, 11.717, 1e-9, 'flat ATK');
  closeTo(g2.atkPct, 0, 0);
  closeTo(g2.main[39], 37, 1e-9, 'Str main stat');
  closeTo(g2.main[41], 25, 1e-9, 'Wis main stat');
});

test('gearContribution: enhance level changes stats (stage 0 vs 3)', () => {
  const it = 'item_equip_t4_suit_atb01_hand_02';
  const a = gearContribution(equipment, { hand: { id: it, en: 0 } }, 'Fire');
  const b = gearContribution(equipment, { hand: { id: it, en: 3 } }, 'Fire');
  closeTo(a.main[39], 43, 1e-9, 'stage 0 Str');
  closeTo(a.main[42], 65, 1e-9, 'stage 0 Will');
  closeTo(b.main[39], 55, 1e-9, 'stage 3 Str');
  closeTo(b.main[42], 84, 1e-9, 'stage 3 Will');
});

test('gearContribution: per-affix enhancement map (en as {affixKey: stage})', () => {
  // item stages: Str(39) 43/47/51/55, Will(42) 65/71/78/84
  const it = 'item_equip_t4_suit_atb01_hand_02';

  // one affix maxed, the other untouched — the in-game choice
  const mixed = gearContribution(equipment, { hand: { id: it, en: { 39: 3, 42: 0 } } }, 'Fire');
  closeTo(mixed.main[39], 55, 1e-9, 'Str at stage 3');
  closeTo(mixed.main[42], 65, 1e-9, 'Will at stage 0 (missing map key -> 0)');

  // empty map = nothing enhanced (the UI default right after picking a piece)
  const none = gearContribution(equipment, { hand: { id: it, en: {} } }, 'Fire');
  closeTo(none.main[39], 43, 1e-9, 'empty map Str stage 0');
  closeTo(none.main[42], 65, 1e-9, 'empty map Will stage 0');

  // partial map: only Will enhanced
  const willOnly = gearContribution(equipment, { hand: { id: it, en: { 42: 2 } } }, 'Fire');
  closeTo(willOnly.main[42], 78, 1e-9, 'Will at stage 2');
  closeTo(willOnly.main[39], 43, 1e-9, 'Str stays stage 0');

  // numeric en stays uniform (legacy/tests compatibility)
  const uni = gearContribution(equipment, { hand: { id: it, en: 3 } }, 'Fire');
  closeTo(uni.main[39], 55, 1e-9, 'uniform stage 3 Str');
  closeTo(uni.main[42], 84, 1e-9, 'uniform stage 3 Will');
});

test('gearContribution: taken scalars multiply; crit rate and elemental apply', () => {
  const taken = gearContribution(equipment, { body: { id: 'item_equip_t1_suit_stragi01_body_01', en: 0 } }, 'Physical');
  closeTo(taken.takenMult, Math.pow(0.961, 6), 1e-9, 'six 0.961 scalars');

  const cr = gearContribution(equipment, { d2: { id: 'item_equip_t2_suit_wisd01_edc_03', en: 0 } }, 'Fire');
  closeTo(cr.critRatePct, 5.3, 1e-9, '0.053 -> +5.3% CR');

  // elemental increase only counts for the operator's element (50 = Physical)
  const elem = gearContribution(equipment, { hand: { id: 'item_equip_t2_suit_agi01_hand_01', en: 0 } }, 'Physical');
  closeTo(elem.elemBonusPct, 9.7, 1e-9, 'physical bonus for physical op');
  const other = gearContribution(equipment, { hand: { id: 'item_equip_t2_suit_agi01_hand_01', en: 0 } }, 'Fire');
  closeTo(other.elemBonusPct, 0, 0, 'physical bonus ignored for fire op');
});

test('gearContribution: Main/Sub attribute affixes (attrType-0 pseudo-keys)', () => {
  // flat points: Main 27 / Secondary 18 (wuling00 edc_05, stage 0)
  const flat = gearContribution(equipment, { d1: { id: 'item_equip_t4_parts_wuling00_edc_05', en: 0 } }, 'Fire');
  closeTo(flat.mainFlat, 27, 1e-9, 'Main Attribute flat points');
  closeTo(flat.subFlat, 18, 1e-9, 'Secondary Attribute flat points');

  // fraction: Main 20.7% (heal01 edc_03, stage 0 -> 26.9% at stage 3)
  const frac = gearContribution(equipment, { d2: { id: 'item_equip_t4_suit_heal01_edc_03', en: 0 } }, 'Fire');
  closeTo(frac.mainFrac, 0.207, 1e-9, 'Main Attribute fraction');
  closeTo(frac.subFrac, 0, 0, 'no sub fraction on this piece');
  const frac3 = gearContribution(equipment, { d2: { id: 'item_equip_t4_suit_heal01_edc_03', en: 3 } }, 'Fire');
  closeTo(frac3.mainFrac, 0.269, 1e-9, 'stage 3 fraction');
});

test('buildAttack: Main/Sub affixes fold into the stat bonus (Laevatain)', () => {
  // Laevatain L90: main WIS 177.985, sub STR 121.374
  const b = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponLv: 90,
    gear: gearContribution(equipment, {
      d1: { id: 'item_equip_t4_parts_wuling00_edc_05', en: 0 }, // Main 27, Sub 18
    }, 'Fire'),
  });
  closeTo(b.mainTotal, 177.985 + 27, 1e-3, 'main = base + flat');
  closeTo(b.subTotal, 121.374 + 18, 1e-3, 'sub = base + flat');
  const bonus = 1 + (177.985 + 27) * 0.005 + (121.374 + 18) * 0.002;
  closeTo(b.statBonus, bonus, 1e-6, 'stat bonus from new totals');

  // fraction multiplies AFTER flat points are added
  const f = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat', opLv: 90, weaponLv: 90,
    gear: gearContribution(equipment, {
      d1: { id: 'item_equip_t4_parts_wuling00_edc_05', en: 0 }, // Main 27 flat
      d2: { id: 'item_equip_t4_suit_heal01_edc_03', en: 0 },   // Main 20.7%
    }, 'Fire'),
  });
  // heal01 edc_03 also grants 21 flat Wisd (plain main-stat affix)
  closeTo(f.mainTotal, (177.985 + 21 + 27) * 1.207, 1e-3, '(base + flats) x (1 + frac)');
});

test('gearContribution: set passive activates at 3 pieces of the same suit', () => {
  const three = gearContribution(equipment, {
    body: { id: 'item_equip_t4_suit_atb01_body_01', en: 0 },
    hand: { id: 'item_equip_t4_suit_atb01_hand_01', en: 0 },
    d1: { id: 'item_equip_t4_suit_atb01_edc_01', en: 0 },
  }, 'Fire');
  assert.equal(three.suitBonuses.length, 1);
  assert.equal(three.suitBonuses[0].cnt, 3);
  closeTo(three.suitBonuses[0].bb.dmg_up, 0.16, 1e-9, 'Frontiers 3pc +16% DMG');

  const two = gearContribution(equipment, {
    body: { id: 'item_equip_t4_suit_atb01_body_01', en: 0 },
    hand: { id: 'item_equip_t4_suit_atb01_hand_01', en: 0 },
  }, 'Fire');
  assert.equal(two.suitBonuses.length, 0, '2 pieces do not activate the 3pc passive');
});

test('buildAttack with gear: Laevatain (flat+%, main stats, CR, set)', () => {
  const b = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat',
    opLv: 90,
    weaponLv: 90,
    gear: gearContribution(equipment, {
      body: { id: 'item_equip_t1_parts_tundra01_body_03', en: 0 }, // flat 11.717, Str 37, Wis 25
      hand: { id: 'item_equip_t4_suit_atb01_hand_02', en: 0 },     // Str 43, Will 65
      d1: { id: 'item_equip_t2_suit_wisd01_edc_01', en: 0 },       // ATK% 10.5, Wis 21
      d2: { id: 'item_equip_t2_suit_wisd01_edc_03', en: 0 },       // CR 5.3, Wis 21
    }, 'Fire'),
  });
  assert.ok(b);
  closeTo(b.gear.flatAtk, 11.717, 1e-9);
  closeTo(b.gear.atkPct, 10.5, 1e-9);
  closeTo(b.gear.critRatePct, 5.3, 1e-9);
  // Wis: 177.985 + 25 + 21 + 21 = 244.985 ; Str: 121.374 + 37 + 43 = 201.374
  closeTo(b.mainTotal, 244.985, 1e-9, 'main total');
  closeTo(b.subTotal, 201.374, 1e-9, 'sub total');
  closeTo(b.statBonus, 1 + 244.985 * 0.005 + 201.374 * 0.002, 1e-9, 'stat bonus');
  closeTo(b.critRate, 10.3, 1e-9, 'crit rate 5 + 5.3');
  // FA order: ATK% applies to (base + weapon) BEFORE flat ATK is added
  const expected = ((318 + b.weaponAtk) * 1.105 + 11.717) * b.statBonus;
  closeTo(b.finalAttack, expected, 1e-6, 'FA with gear');
  assert.equal(b.suitPct.dmg, 0, 'only one Frontiers piece -> no 3pc passive');
});

test('buildAttack: 3pc Frontiers set feeds suitPct.dmg', () => {
  const b = buildAttack(operators, weapons, {
    opId: 'chr_0016_laevat',
    opLv: 90,
    weaponLv: 90,
    gear: gearContribution(equipment, {
      body: { id: 'item_equip_t4_suit_atb01_body_01', en: 0 },
      hand: { id: 'item_equip_t4_suit_atb01_hand_01', en: 0 },
      d1: { id: 'item_equip_t4_suit_atb01_edc_01', en: 0 },
    }, 'Fire'),
  });
  closeTo(b.suitPct.dmg, 16, 1e-9, 'dmg_up 0.16 -> 16%');
  assert.ok(b.finalAttack > 0);
});