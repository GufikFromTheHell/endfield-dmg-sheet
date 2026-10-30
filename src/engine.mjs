// src/engine.mjs — Endfield damage engine (vanilla ES module, zero dependencies)
//
// Formulas follow Taksumii/Arknights-Endfield-DPS-Calc (MIT license),
// specifically AKEndfieldDmgCalc/Calculators/DamageCalculator.cs (kept in
// tools/DamageCalculator.cs for reference).
//
// Model summary
//   StatBonus   = 1 + MainStat × 0.005 + SubStat × 0.002
//                 (MainStat/SubStat = the operator's main/sub attribute values
//                  at the current character level, from CharacterTable.
//                  e.g. Laevatain L90: WIS 177.985 / STR 121.374 → ×2.132673)
//   FinalAttack = ((BaseATK + WeaponATK) × (1 + ATK%) + FlatATK) × StatBonus
//   (FlatATK = gear flat ATK; the reference sheet's "Base atk" column is
//    exactly this sum: Laevatain L90 318 + Tarr 11 283 + gear 128 = 729,
//    and 729 × 2.1326753 × 1.025 × 10.7975 = 17,206.8, the sheet's Battle
//    Skill row, reproduces it exactly.)
//
//   BaseDamage  = Σscales × FinalAttack          (scales are fractions of ATK,
//                                                      taken from SkillPatchTable)
//   FinalDamage = BaseDamage × AnomalyMult × CritZone × (1 + ΣDmgBonus)
//                 × (1 − DmgTaken) × (1 + Vulnerability) × (1 + Amplification)
//                 × (1 − Sanctuary) × (1 + Fragility) × (Staggered ? 1.3 : 1)
//                 × SpellLevel × 100/(Def+100) × (1 − Resist)
//
//   Min/Max/Average use critRate/critDmg; average = min×(1−CR) + max×CR.
//
// Data bundles (data/*.json, built by tools/normalize.mjs):
//   operators: [{id,name,element,profession,rarity,weaponType,mainAttr,subAttr,
//                defaultWeapon, levels:[{b,a:[hp,atk,def,critRate,critDmg,str,agi,wis,will]}]}]
//   weapons:   {curves:{id:[[lv,atk]]}, weapons:[{id,name,rarity,typeName,curve,...}]}
//   skills:    [{id,op,kind,hit,passive,damage,levels:[{lv,scales,poise,atb,cd,display,bb}]}]
//   enemies:   [{id,name,base,dummy,levels:[{lv,def}],res}]
//   traits:    {traitDefs:{}, potentialSkills:{id:[{lv,bb}]}}
//   equipment: {items:{id:{name,tier,slot,suit,minLv,st:[4×{attrType:value}]}},
//               suits:{id:{name,req:[{cnt,skill,bb}]}}}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Game default crit damage when the operator table stores 0 (Endfield gives
// every operator a fixed 50% base crit damage; the CharacterTable only stores
// bonuses).
export const CRIT_DMG_BASE = 50;

// Anomaly types with their multipliers (Taksumii reference).
export const ANOMALIES = {
  'Knockback': (lv) => 1.2,
  'Knockdown': (lv) => 1.2,
  'Armor Shatter': (lv) => 0.5 + 0.5 * lv,
  'Smash': (lv) => 1.5 + 1.5 * lv,
  'Electrification': (lv) => 0.8 + 0.8 * lv,
  'Corrosion': (lv) => 0.8 + 0.8 * lv,
  'Burning': (lv) => 0.12 + 0.12 * lv,
  'Freeze': (lv) => 1.3,
  'Shatter Ice': (lv) => 1.2 + 1.2 * lv,
  'Spell Burst': (lv) => 1.6,
};

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** Stat bonus multiplier from the operator's main/sub attribute values:
 *  1 + main × 0.005 + sub × 0.002. */
export function statBonusMultiplier(mainStat = 0, subStat = 0) {
  return 1 + (mainStat || 0) * 0.005 + (subStat || 0) * 0.002;
}

/** Final attack power from base + weapon ATK, ATK%, gear flat ATK,
 *  and the operator's stat bonus (applied to the whole sum, as in the
 *  game and in the Taksumii reference). */
export function finalAttack({ baseAtk = 0, weaponAtk = 0, atkPct = 0, flatAtk = 0, mainStat = 0, subStat = 0 } = {}) {
  return ((baseAtk + weaponAtk) * (1 + atkPct / 100) + flatAtk) * statBonusMultiplier(mainStat, subStat);
}

/** Anomaly damage multiplier; unknown/none -> 1.0. `level` is anomaly level 0-5. */
export function anomalyMultiplier(type, level = 0) {
  const f = ANOMALIES[type];
  return f ? f(level) : 1.0;
}

/** Spell level zone: 1 + 5/980 × (level − 1), except knockback/knockdown,
 *  armor shatter and smash (no spell level scaling). `level` = spell level 1-5. */
export function spellLevelZone(type, level = 1) {
  if (!type || type === 'None') return 1.0;
  if (/^knock/i.test(type) || type === 'Armor Shatter' || type === 'Smash') return 1.0;
  return 1 + (5 / 980) * (level - 1);
}

/** Defense zone: 100/(Def+100) for Def ≥ 0; 2 − 0.99^−Def below zero. */
export function defenseZone(def) {
  return def >= 0 ? 100 / (def + 100) : 2 - Math.pow(0.99, -def);
}

// ---------------------------------------------------------------------------
// Core damage
// ---------------------------------------------------------------------------

/**
 * Calculate one hit (or one skill cast = sum of its scales).
 *
 * p:
 *   atk            number  FinalAttack (use finalAttack() to build it)
 *   scales         number[]|number  fraction(s) of ATK (SkillPatchTable values)
 *   anomaly        string   anomaly type ('Burning', 'Freeze', ...) or ''
 *   anomalyLevel   number   0-5
 *   spellLevel     number   1-5 (for spell-type anomalies)
 *   critRate       number   % (0-100)
 *   critDmg        number   % (bonus over the 50% base, i.e. 50 = +50% point? no:
 *                            this is the TOTAL crit damage %, e.g. 50 means ×1.5)
 *   damageBonusPct number   summed elemental/skill/other damage bonuses, %
 *   staggered      bool     target is staggered/unbalanced (×1.3)
 *   vulnerabilityPct, amplificationPct, fragilityPct  number, % (additive, +)
 *   sanctuaryPct, damageReductionPct                 number, % (multiplicative, −)
 *   damageTakenMult    number  extra damage-taken multiplier (gear scalars, 1 = none)
 *   targetDef      number   target DEF
 *   targetResistPct number  elemental resistance %
 *   stonePct       number   source stone artistry %
 *
 * Returns { base, min, max, avg, zones } where base = damage with no crit,
 * min/max are non-crit/crit results and avg is the weighted average.
 */
export function calcHit(p) {
  const atk = p.atk ?? 0;
  const scales = Array.isArray(p.scales) ? p.scales : [p.scales ?? 0];
  const scaleSum = scales.reduce((s, v) => s + (v || 0), 0);
  const baseDamage = scaleSum * atk;

  const cr = clamp(p.critRate ?? 0, 0, 100) / 100;
  const cd = Math.max(p.critDmg ?? CRIT_DMG_BASE, 0); // total crit damage %
  const critZone = 1 + cd / 100;

  const bonus = 1 + (p.damageBonusPct ?? 0) / 100;
  const vuln = 1 + (p.vulnerabilityPct ?? 0) / 100;
  const ampl = 1 + (p.amplificationPct ?? 0) / 100;
  const sanct = 1 - (p.sanctuaryPct ?? 0) / 100;
  const frage = 1 + (p.fragilityPct ?? 0) / 100;
  const taken = (1 - (p.damageReductionPct ?? 0) / 100) * (p.damageTakenMult ?? 1);
  const stag = p.staggered ? 1.3 : 1.0;
  const anom = anomalyMultiplier(p.anomaly, p.anomalyLevel ?? 0);
  const spell = spellLevelZone(p.anomaly, p.spellLevel ?? 1);
  const stone = 1 + (p.stonePct ?? 0) / 100;
  const def = defenseZone(p.targetDef ?? 0);
  const res = 1 - (p.targetResistPct ?? 0) / 100;

  const core =
    baseDamage * anom * bonus * taken * vuln * ampl * sanct * frage * stag * spell * stone;
  const min = core * def * res;
  const max = core * critZone * def * res;
  const avg = min * (1 - cr) + max * cr;

  return {
    base: baseDamage,
    min,
    max,
    avg,
    zones: {
      anomaly: anom,
      crit: critZone,
      bonus,
      staggered: stag,
      spell,
      stone,
      vulnerability: vuln,
      amplification: ampl,
      sanctuary: sanct,
      fragility: frage,
      damageTaken: taken,
      defense: def,
      resistance: res,
    },
  };
}

/**
 * Sum several hits (a rotation window): hits = [{label, scales, count, ...calcHit params}].
 * Shared params (atk, crit, target, ...) may be passed once in `base`.
 */
export function calcSequence(base, hits) {
  const rows = [];
  let sumMin = 0, sumMax = 0, sumAvg = 0;
  for (const h of hits) {
    const r = calcHit({ ...base, ...h });
    const n = h.count ?? 1;
    rows.push({ label: h.label, scales: h.scales, count: n, min: r.min * n, max: r.max * n, avg: r.avg * n });
    sumMin += r.min * n;
    sumMax += r.max * n;
    sumAvg += r.avg * n;
  }
  return { rows, min: sumMin, max: sumMax, avg: sumAvg };
}

/** DPS from a window total and its duration (seconds). */
export function dps(total, seconds) {
  return seconds > 0 ? total / seconds : 0;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Data-bundle helpers (pure; bundles loaded by the UI)
// ---------------------------------------------------------------------------

/**
 * Operator stat row at character level (1-99).
 * `a[]` order is [hp, atk, def, critRate, critDmg, str, agi, wis, will],
 * so the attribute value for attrType c (39-42) is a[c - 34]
 * (39->a[5], 40->a[6], 41->a[7], 42->a[8]).
 */
export function operatorAtLevel(operators, opId, lvl) {
  const op = operators.find((o) => o.id === opId);
  if (!op) return null;
  const row = op.levels[Math.min(op.levels.length - 1, Math.max(1, lvl)) - 1];
  if (!row) return null;
  const [hp, atk, def, cr, cd, str, agi, wis, will] = row.a;
  const mainValue = row.a[op.mainAttr - 34] ?? 0;
  const subValue = row.a[op.subAttr - 34] ?? 0;
  return {
    id: op.id,
    name: op.name,
    element: op.element,
    mainAttr: op.mainAttr,
    subAttr: op.subAttr,
    mainAttrName: op.mainAttrName,
    subAttrName: op.subAttrName,
    mainValue,
    subValue,
    statBonus: statBonusMultiplier(mainValue, subValue),
    defaultWeapon: op.defaultWeapon,
    hp,
    atk,
    def,
    critRate: Math.round(cr * 10000) / 100, // fraction -> % (rounded: 0.05*100 = 5.000000000000001)
    critDmg: CRIT_DMG_BASE + Math.round(cd * 10000) / 100, // table stores bonus over the 50% base
    attrs: { str, agi, wis, will },
  };
}

/** Weapon ATK at weapon level (1-90). */
export function weaponAtk(weapons, weaponId, lvl) {
  const w = weapons.weapons.find((x) => x.id === weaponId);
  if (!w) return 0;
  const curve = weapons.curves[w.curve] ?? [];
  const row = curve.find((r) => r[0] >= lvl) ?? curve[curve.length - 1];
  return row ? row[1] : 0;
}

/** All damage skills of an operator with their scales at skill level (1-12+). */
export function operatorSkills(skills, opId, skillLv = 12) {
  return skills
    .filter((s) => s.op === opId && s.damage)
    .map((s) => {
      const row = s.levels.find((r) => r.lv === skillLv) ?? s.levels[s.levels.length - 1];
      return {
        id: s.id,
        kind: s.kind,
        name: s.kind, // UI may number duplicates by display order
        hit: s.hit,
        passive: s.passive,
        scales: row ? row.scales : [],
        cd: row?.cd ?? null,
        atb: row?.atb ?? null,
        poise: row?.poise ?? null,
      };
    });
}

/** Enemy preset row at level (falls back to nearest available). */
export function enemyAtLevel(enemies, id, lvl) {
  const e = enemies.find((x) => x.id === id);
  if (!e) return null;
  const row =
    e.levels.find((r) => r.lv === lvl) ??
    e.levels.reduce((best, r) => (Math.abs(r.lv - lvl) < Math.abs(best.lv - lvl) ? r : best), e.levels[0]);
  return { id: e.id, name: e.name, dummy: e.dummy, level: row.lv, def: row.def, res: e.res };
}

// ---------------------------------------------------------------------------
// Gear (armor) contributions
// ---------------------------------------------------------------------------

// attrType -> operator element for elemental damage increase affixes.
export const ELEMENT_ATTR = {
  Physical: 50,
  Fire: 51,
  Pulse: 52,
  Cryst: 53,
  Natural: 54,
};

/**
 * Aggregate the four equipped pieces into one contribution object.
 *
 * `equipment` = the data/equipment.json bundle ({items, suits}).
 * `gear` = { body, hand, d1, d2 } where each is null or {id, en} (enhance
 *           level 0-3).
 * `element` = the operator's element ('Physical', 'Fire', ...) — only the
 *              matching elemental increase affix applies to damage.
 *
 * Returns:
 *   flatAtk      flat ATK from gear (attrType 2, modifierType 7; values >= 1)
 *   atkPct       ATK % from gear (attrType 2, modifierType 6 fraction ×100)
 *   main         {39|40|41|42: value} — Str/Agi/Wis/Will; added to the
 *                 character's main/sub attribute values BEFORE the stat
 *                 bonus multiplier (as in-game)
 *   critRatePct  crit rate bonus % (attrType 9, fraction ×100)
 *   critDmg      crit damage bonus % (attrType 10, fraction × 100)
 *   elemBonusPct damage bonus % for the operator's element
 *   takenMult    damage-taken multiplier (product of attrTypes
  *                 4/5/6/7/48/60 — the dump stores six per-element
  *                 scalar rows that the game displays as one "Final DMG
  *                 Reduction" composite; all six apply multiplicatively)
 *   suitBonuses  active set passives: [{id,name,cnt,bb}] (bb from the
 *                 suit's passive skill; dmg_up = damage bonus fraction)
 *   spPct, effInfo  informational sums (SP gain, efficiency affixes, arts)
 *
 * Note: the dump stores flat-vs-percent via modifierType (6 = fraction,
 * 7 = flat); in practice every flat ATK affix is >= 1 and every percent
 * fraction is < 1, so the magnitude test below is safe.
 */
export function gearContribution(equipment, gear, element) {
  const out = {
    flatAtk: 0,
    atkPct: 0,
    main: {},
    mainFlat: 0,
    mainFrac: 0,
    subFlat: 0,
    subFrac: 0,
    critRatePct: 0,
    critDmg: 0,
    elemBonusPct: 0,
    takenMult: 1,
    suitBonuses: [],
    spPct: 0,
    effInfo: [],
  };
  const slotKeys = ['body', 'hand', 'd1', 'd2'];
  const suitCount = {};
  for (const key of slotKeys) {
    const g = gear?.[key];
    if (!g?.id) continue;
    const item = equipment?.items?.[g.id];
    if (!item) continue;
    const st = item.st[Math.min(3, Math.max(0, g.en | 0))] ?? {};
    for (const [t, v] of Object.entries(st)) {
      if (v == null) continue;
      // Main/Sub attribute pseudo-keys (attrType 0, disambiguated in the
      // normalizer via modifyAttributeType + modifierType)
      if (t === '0fm') { out.mainFlat += v; continue; }
      if (t === '0pm') { out.mainFrac += v; continue; }
      if (t === '0fs') { out.subFlat += v; continue; }
      if (t === '0ps') { out.subFrac += v; continue; }
      const c = +t;
      switch (c) {
        case 2:
          if (v >= 1) out.flatAtk += v;
          else out.atkPct += v * 100;
          break;
        case 39: case 40: case 41: case 42: out.main[c] = (out.main[c] || 0) + v; break;
        case 9: out.critRatePct += v * 100; break;
        case 10: out.critDmg += v * 100; break;
        case 4: case 5: case 6: case 7: case 48: case 60: out.takenMult *= v; break;
        case 87: out.effInfo.push(['Arts', v]); break;
        default: {
          if ([17, 28, 32, 33].includes(c)) out.effInfo.push([EFF_NAMES[c], v * 100]);
          else if (c === 44) out.spPct += v * 100;
          else if (ELEMENT_ATTR[element] === c) out.elemBonusPct += v * 100;
          break;
        }
      }
    }
    if (item.suit) suitCount[item.suit] = (suitCount[item.suit] || 0) + 1;
  }
  // set passives: apply when the equipped count reaches the requirement
  for (const [sid, cnt] of Object.entries(suitCount)) {
    const suit = equipment?.suits?.[sid];
    for (const r of suit?.req ?? []) {
      if (cnt >= r.cnt) out.suitBonuses.push({ id: sid, name: suit.name, cnt, bb: r.bb || {} });
    }
  }
  return out;
}

const EFF_NAMES = { 17: 'Normal ATK efficiency', 28: 'Ult efficiency', 32: 'Normal skill efficiency', 33: 'Combo skill efficiency' };

/**
 * Flat ATK granted by the weapon's potential skill at potential level (0-9).
 * Potential skill ids in the bundle are 'sk_' + weaponId (e.g. weapon
 * 'wpn_sword_0003' -> 'sk_wpn_sword_0003'); the bonus is stored per level
 * as bb.atk_up (some weapons grant other effects instead — those return 0
 * here and can be surfaced separately by the UI).
 */
export function weaponPotentialAtk(traits, weaponId, potLv = 0) {
  const rows = weaponId && traits?.potentialSkills ? traits.potentialSkills['sk_' + weaponId] : undefined;
  if (!rows || !rows.length || potLv <= 0) return 0;
  let bestLv = 0;
  for (const r of rows) if (r.lv <= potLv && r.lv > bestLv) bestLv = r.lv;
  const row = rows.find((r) => r.lv === bestLv);
  return row?.bb?.atk_up ?? 0;
}

/**
 * Resolve the full attack stack for an operator build.
 * Returns { op, weaponId, weapon, weaponAtk, potentialAtk, flatAtk, atkPct,
 *           gear, mainTotal, subTotal, critDmg, finalAttack, statBonus,
 *           suitPct: {atk, dmg} }.
 * `weaponId` falls back to the operator's default weapon when omitted.
 * `gear` is the output of gearContribution() — its flat ATK joins `flatAtk`,
 * its main stats join the operator's main/sub values before the stat bonus
 * multiplier, its crit damage joins the operator's total crit damage, and
 * its Main/Sub attribute affixes add flat points and then multiply the
 * respective attribute: total = (base + flats) × (1 + fraction).
 * Active set passives feed `suitPct`: `atk_up` (fraction ×100) is folded into
 * the ATK % used for Final Attack, and `dmg_up` (fraction ×100) is returned
 * for the caller to add to `damageBonusPct` in calcHit.
 */
export function buildAttack(operators, weapons, traits, opts = {}) {
  const { opId, opLv = 90, weaponId, weaponLv = 90, potLv = 0, flatAtk = 0, atkPct = 0, gear = null } = opts;
  const op = operatorAtLevel(operators, opId, opLv);
  if (!op) return null;
  const wid = weaponId || op.defaultWeapon || '';
  const weapon = weapons.weapons.find((x) => x.id === wid) || null;
  const wpnAtk = weaponAtk(weapons, wid, weaponLv);
  const potentialAtk = weaponPotentialAtk(traits, wid, potLv);
  const g = gear || {};
  const mainTotal = (op.mainValue + (g.main?.[op.mainAttr] ?? 0) + (g.mainFlat ?? 0)) * (1 + (g.mainFrac ?? 0));
  const subTotal = (op.subValue + (g.main?.[op.subAttr] ?? 0) + (g.subFlat ?? 0)) * (1 + (g.subFrac ?? 0));
  // Set passives (gearContribution -> suitBonuses[].bb):
  //   dmg_up   fraction            -> additive damage bonus %
  //   atk_up   fraction (<=1)      -> ATK %; flat value (>1) -> flat ATK
  //   crit_up  fraction            -> crit rate bonus %
  let suitAtk = 0, suitDmg = 0, suitCrit = 0, suitFlat = 0;
  for (const b of g.suitBonuses ?? []) {
    const bb = b.bb ?? {};
    const au = bb.atk_up ?? 0;
    if (au > 1) suitFlat += au;
    else suitAtk += au * 100;
    suitDmg += (bb.dmg_up ?? 0) * 100;
    suitCrit += (bb.crit_up ?? 0) * 100;
  }
  const atkTotal = atkPct + suitAtk + (g.atkPct || 0);
  const fa = finalAttack({
    baseAtk: op.atk,
    weaponAtk: wpnAtk + potentialAtk,
    atkPct: atkTotal,
    flatAtk: flatAtk + (g.flatAtk || 0) + suitFlat,
    mainStat: mainTotal,
    subStat: subTotal,
  });
  return {
    op,
    weaponId: wid,
    weapon,
    weaponAtk: wpnAtk,
    potentialAtk,
    flatAtk,
    atkPct,
    gear: g,
    mainTotal,
    subTotal,
    critRate: op.critRate + suitCrit + (g.critRatePct || 0),
    critDmg: op.critDmg + (g.critDmg || 0),
    finalAttack: fa,
    statBonus: statBonusMultiplier(mainTotal, subTotal),
    suitPct: { atk: suitAtk, dmg: suitDmg, crit: suitCrit, flat: suitFlat },
  };
}