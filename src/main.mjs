// src/main.mjs — UI for the Endfield DMG calculator (vanilla ES module).
// Loads the data bundles (data/*.json, built by tools/normalize.mjs) and
// renders: build controls (operator, weapon, gear, target), operator stat
// card, gear/set summary, per-hit damage table, DPS, and a team composer
// where each member snapshots the current build and picks a skill sequence.
import {
  operatorAtLevel,
  operatorSkills,
  buildAttack,
  gearContribution,
  calcHit,
  dps,
} from './engine.mjs';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadJson(name) {
  const res = await fetch(new URL(name, document.baseURI), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`failed to load ${name}: ${res.status}`);
  return res.json();
}

const DATA = {};
try {
  [DATA.meta, DATA.operators, DATA.weapons, DATA.skills,
   DATA.traits, DATA.equipment] =
    await Promise.all([
      loadJson('data/meta.json'),
      loadJson('data/operators.json'),
      loadJson('data/weapons.json'),
      loadJson('data/skills.json'),
      loadJson('data/traits.json'),
      loadJson('data/equipment.json'),
    ]);
} catch (err) {
  const badge = document.getElementById('dataBadge');
  badge.innerHTML = `<span class="bad">data load failed: ${String(err.message)}</span>`;
  throw err;
}

const badge = document.getElementById('dataBadge');
badge.innerHTML =
  `<b>${DATA.meta.operators}</b> operators · <b>${DATA.meta.weapons}</b> weapons · ` +
  `<b>${DATA.meta.equipment}</b> gear · ` +
  `dump <code>${DATA.meta.commit.slice(0, 7)}</code> · updated ${String(DATA.meta.builtAt).slice(0, 10)}`;

// ---------------------------------------------------------------------------
// State + helpers
// ---------------------------------------------------------------------------

const SLOTS = [
  { key: 'body', name: 'Body', partType: 0, tip: 'Torso armor piece' },
  { key: 'hand', name: 'Hand', partType: 1, tip: 'Gloves piece' },
  { key: 'd1', name: 'Device 1', partType: 2, tip: 'First device (EDC) piece' },
  { key: 'd2', name: 'Device 2', partType: 2, tip: 'Second device (EDC) piece' },
];

const state = {
  opId: 'chr_0016_laevat',
  opLv: 90,
  weaponId: '',
  weaponLv: 90,
  pot: 0,
  skillLv: { basic: 12, skill: 12, ult: 12 }, // skill tree -> level (1-12)
  essRanks: { main: 0, sub: 0, skill: 0 },
  // configurable mob: plain numbers, no enemy presets
  mobDef: 0,
  resist: 0,
  dmgBonus: 0,
  dmgReduction: 0,
  staggered: false,
  windowSecs: 10,
  gear: { body: null, hand: null, d1: null, d2: null },
  team: [],
  teamWindow: 10,
};

const $ = (id) => document.getElementById(id);
const fmt = (v, digits = 0) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 }) : '—';
const fmt1 = (v) => fmt(v, 1);

function operatorById(id) {
  return DATA.operators.find((o) => o.id === id);
}

// Resolve the full attack stack for the current single-operator panel.
function currentBuild() {
  const op = operatorAtLevel(DATA.operators, state.opId, state.opLv);
  if (!op) return null;
  const gear = gearContribution(DATA.equipment, state.gear, op.element);
  const build = buildAttack(DATA.operators, DATA.weapons, {
    opId: state.opId,
    opLv: state.opLv,
    weaponId: state.weaponId || op.defaultWeapon,
    weaponLv: state.weaponLv,
    pot: state.pot,
    essRanks: state.essRanks,
    gear,
  });
  return { op, gear, build };
}

// Shared target modifiers (single panel and team use the same target).
function targetParams() {
  const { op, gear, build } = currentBuild();
  let taken = gear.takenMult;
  for (const b of gear.suitBonuses) taken *= (b.bb?.dmg_taken_down ?? 1);
  return {
    targetDef: state.mobDef,
    targetResistPct: state.resist,
    damageBonusPct: (op ? state.dmgBonus + gear.elemBonusPct + build.suitPct.dmg + build.essDmgPct : 0),
    damageReductionPct: state.dmgReduction,
    damageTakenMult: op ? taken : 1,
    staggered: state.staggered,
  };
}

function affixLabel(key) {
  return DATA.equipment?.affixNames?.[key] || String(key);
}

// The six taken-scalar affixes (damage-taken multipliers and the like) are
// aggregated into a single product in the gear summary, so they are hidden
// from the per-affix enhancement sliders and previews.
const TAKEN_KEYS = ['4', '5', '6', '7', '48', '60'];

// DEF (attrType 3): constant at every stage in the dump (not enhanceable
// in-game) and does not affect outgoing damage — hidden from all armor
// displays.
const DEF_KEY = '3';

// Affix keys a piece has, unioned across its 4 stages (dump order; the
// affix set is identical at every stage of a piece).
function affixKeysOf(item) {
  const keys = [];
  const seen = new Set();
  for (const s of item.st) for (const k of Object.keys(s)) {
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

// Enhancement stage of one affix for a slot selection. `en` is either a
// number (uniform, legacy/tests) or a {affixKey: 0-3} map (the UI keeps it
// as a map, possibly empty = all stage 0). Missing map keys → stage 0.
function enStageOf(sel, key) {
  if (!sel) return 0;
  const raw = (typeof sel.en === 'object' && sel.en !== null) ? sel.en[key] : sel.en;
  return Math.min(3, Math.max(0, (raw | 0)));
}

// The piece's current per-affix values (each affix at its own stage).
function pieceStats(sel, item) {
  const st = {};
  for (const k of affixKeysOf(item)) st[k] = item.st[enStageOf(sel, k)][k];
  return st;
}

// Human value for one affix (mirrors the results formatting).
function affixValueText(t, v) {
  if (t === '0fm' || t === '0fs') return `+${v} pts`;
  if (t === '0pm' || t === '0ps') return `+${(v * 100).toFixed(1)}%`;
  if (v < 1 && [2, 9, 10, 17, 28, 29, 32, 33, 44, 50, 51, 52, 53, 54, 61, 87].includes(+t)) {
    return `+${(v * 100).toFixed(1)}%`;
  }
  return `+${fmt(v, 2)}`;
}

// "+N" or "+a/b/c" (ascending distinct stages) for the piece line in the
// gear summary; '' when nothing is enhanced.
function enSummaryText(sel, item) {
  const stages = affixKeysOf(item)
    .filter((k) => !TAKEN_KEYS.includes(k))
    .map((k) => enStageOf(sel, k));
  if (!stages.length || stages.every((s) => s === 0)) return '';
  const uniq = [...new Set(stages)].sort((a, b) => a - b);
  return uniq.length === 1 ? ` +${uniq[0]}` : ` +${uniq.join('/')}`;
}

// "( +N Label, +N Label )" stage-0 preview appended to gear option labels.
function gearAffixPreview(item) {
  const st = item.st[0];
  const parts = [];
  for (const [t, v] of Object.entries(st)) {
    if (TAKEN_KEYS.includes(t) || t === DEF_KEY) continue;
    parts.push(`${affixValueText(t, v)} ${affixLabel(t)}`);
  }
  return parts.length ? ` ( ${parts.join(', ')} )` : '';
}

// Rebuild the per-affix enhancement box for one gear slot. Each affix the
// piece actually has gets its own 0-3 slider (in-game you choose which
// affixes to enhance, independently); affixes that never change across
// stages are shown as fixed lines. The six taken-scalars are skipped here
// (they are summarized in the gear results), as is DEF (constant, not
// enhanceable in-game, and irrelevant to outgoing damage).
function renderEnhSlot(slot) {
  const box = $(`enh_${slot.key}`);
  if (!box) return;
  box.innerHTML = '';
  const sel = state.gear[slot.key];
  const item = sel ? DATA.equipment.items[sel.id] : null;
  if (!item) {
    box.appendChild(el('div', 'enhempty', 'Pick a piece to adjust its affixes.'));
    return;
  }
  for (const k of affixKeysOf(item)) {
    if (TAKEN_KEYS.includes(k) || k === DEF_KEY) continue;
    const grows = item.st.some((s) => s[k] !== item.st[0][k]);
    const row = el('div', 'enhrow');
    const lab = el('label', null, affixLabel(k));
    if (grows) {
      lab.title = `Enhancement stage (0–3) of the ${affixLabel(k)} affix on this piece — each affix is enhanced independently, like in-game.`;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.id = `enh_${slot.key}_${k}`;
      inp.min = 0;
      inp.max = 3;
      inp.step = 1;
      inp.value = enStageOf(sel, k);
      inp.title = lab.title;
      const val = el('span', 'val', affixValueText(k, item.st[+inp.value][k]));
      val.id = `enh_${slot.key}_${k}V`;
      inp.oninput = () => {
        sel.en = sel.en || {};
        sel.en[k] = +inp.value;
        val.textContent = affixValueText(k, item.st[+inp.value][k]);
        renderResults();
      };
      row.appendChild(lab);
      row.appendChild(inp);
      row.appendChild(val);
    } else {
      lab.title = `The ${affixLabel(k)} affix on this piece is the same at every enhancement stage.`;
      row.appendChild(lab);
      row.appendChild(el('span', 'val', affixValueText(k, item.st[0][k])));
    }
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function ctlRow(label, node, tip) {
  const d = el('div', 'ctl');
  const l = el('label', null, label);
  if (tip) l.title = tip;
  d.appendChild(l);
  d.appendChild(node);
  return d;
}

function range(id, label, min, max, value, tip) {
  const d = el('div', 'ctl');
  const l = el('label', null, `${label} <span class="val" id="${id}V">${value}</span>`);
  if (tip) l.title = tip;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.id = id;
  inp.min = min;
  inp.max = max;
  inp.step = 1;
  inp.value = value;
  d.appendChild(l);
  d.appendChild(inp);
  return { el: inp, wrap: d, render: () => { $(id + 'V').textContent = inp.value; } };
}

function numInput(id, label, value, step, tip) {
  const d = el('div', 'ctl');
  const l = el('label', null, label);
  if (tip) l.title = tip;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.id = id;
  inp.min = 0;
  inp.step = step ?? 1;
  inp.value = value;
  d.appendChild(l);
  d.appendChild(inp);
  return { el: inp, wrap: d };
}

// attribute names for potential tier lines
const POT_ATTR_NAMES = { 39: 'Strength', 40: 'Agility', 41: 'Intellect', 42: 'Willpower' };

// renders the active potential tier lines (P1..P{pot}) under the slider
function renderPotInfo() {
  const box = $('potInfo');
  if (!box) return;
  const op = operatorById(state.opId);
  box.innerHTML = '';
  (op?.potential || []).slice(0, state.pot).forEach((t, i) => {
    const line = el('div', 'potline');
    if (t.attrs && t.attrs.length) {
      line.textContent = `P${i + 1}: ` + t.attrs.map((a) => a.attr != null
        ? `${POT_ATTR_NAMES[a.attr] || 'Attr ' + a.attr} +${a.flat}`
        : `Critical Rate +${Math.round((a.cr || 0) * 100)}%`).join(', ');
    } else {
      line.textContent = `P${i + 1}: ` + ((t.info && t.info[0]) || 'Bonus improved').replace(/\{n\}/g, '?');
      line.classList.add('dim');
    }
    box.appendChild(line);
  });
}

// re-evaluates gear option locks in place; renderControls() must not be used
// here — rebuilding while the level slider is being dragged would kill the
// slider under the cursor (the old drag bug)
function updateGearLocks() {
  for (const slot of SLOTS) {
    const sel = $(`slot_${slot.key}`);
    if (!sel) continue;
    for (const o of sel.options) {
      if (!o.value || o.dataset.minlv == null) continue;
      o.disabled = +o.dataset.minlv > state.opLv;
    }
  }
}

function renderControls() {
  const c = $('controls');
  c.innerHTML = '';

  // --- operator card -------------------------------------------------------
  const oc = el('div', 'card');
  oc.appendChild(el('h2', null, 'Operator'));

  const opSel = el('select');
  opSel.id = 'opSel';
  const byProf = {};
  for (const op of DATA.operators) {
    (byProf[op.professionName || 'Other'] ||= []).push(op);
  }
  for (const prof of Object.keys(byProf).sort()) {
    const og = el('optgroup');
    og.label = prof;
    for (const op of byProf[prof].sort((a, b) => a.name.localeCompare(b.name))) {
      const o = el('option', null, op.name);
      o.value = op.id;
      o.selected = op.id === state.opId;
      og.appendChild(o);
    }
    opSel.appendChild(og);
  }
  oc.appendChild(ctlRow('Operator', opSel, 'Pick the operator to calculate'));

  const opLv = range('opLv', 'Level', 1, 90, state.opLv,
    'Operator level (1–90, in-game max). Base ATK and main/sub attributes scale with it; ' +
    'raising the level also unlocks higher gear.');
  oc.appendChild(opLv.wrap);

  // three level trees, exactly as in-game: every operator can only level up
  // Basic Attack, Battle Skill (incl. the combo/follow-up skills) and the
  // Ultimate. All other damage rows (dash/plunge/heavy hits, during-ult
  // variants, ult follow-up hits) ride on one of these three.
  const TREES = [
    ['basic', 'Basic Attack', 'all basic hits — light/heavy chain, dash, plunge, and during-ult basics'],
    ['skill', 'Battle Skill', 'the battle skill plus its combo/follow-up hits'],
    ['ult', 'Ultimate', 'the ultimate plus its follow-up hits'],
  ];
  for (const [tree, label, cover] of TREES) {
    const sk = range('sklv_' + tree, `${label} (1–12)`, 1, 12, state.skillLv[tree] ?? 12,
      `Level (1–12) of the ${label} tree — raises every ${cover}.`);
    sk.el.oninput = () => { state.skillLv[tree] = +sk.el.value; sk.render(); renderResults(); };
    oc.appendChild(sk.wrap);
  }

  const pot = range('pot', 'Potential (0–5)', 0, 5, state.pot,
    'Operator potential (0–5). Each tier unlocks a bonus; the active tiers are listed below.');
  pot.el.oninput = () => {
    state.pot = +pot.el.value;
    pot.render();
    renderPotInfo();
    renderResults();
  };
  oc.appendChild(pot.wrap);
  const potInfo = el('div', 'potinfo');
  potInfo.id = 'potInfo';
  oc.appendChild(potInfo);
  renderPotInfo();

  c.appendChild(oc);

  // --- weapon card ----------------------------------------------------------
  const wc = el('div', 'card');
  wc.appendChild(el('h2', null, 'Weapon'));

  const wSel = el('select');
  wSel.id = 'weaponSel';
  // empty state.weaponId means "the operator's default weapon"
  const effWeaponId = state.weaponId || operatorById(state.opId)?.defaultWeapon || '';
  // all weapons, grouped by weapon type (rarity is shown per option, so the
  // old per-rarity groups were replaced by type groups)
  const byType = {};
  for (const w of DATA.weapons.weapons) {
    (byType[w.typeName || 'Other'] ||= []).push(w);
  }
  for (const tn of Object.keys(byType).sort()) {
    const og = el('optgroup');
    og.label = tn;
    for (const w of byType[tn].sort((a, b) =>
      (b.rarity || 0) - (a.rarity || 0) || a.name.localeCompare(b.name))) {
      const tag = w.origin === 'bp' ? ' [BP]' : w.origin === 'sig' ? ' [SIG]' : '';
      const o = el('option', null, `${'★'.repeat(w.rarity || 0)} ${w.name}${tag}`);
      o.value = w.id;
      o.selected = w.id === effWeaponId;
      og.appendChild(o);
    }
    wSel.appendChild(og);
  }
  wc.appendChild(ctlRow('Weapon', wSel,
    'Weapon, all of them, grouped by type. ★ = rarity; [BP] = battle-pass weapon, [SIG] = signature (paid gacha) weapon.'));

  wc.appendChild(range('weaponLv', 'Weapon level', 1, 90, state.weaponLv,
    'Weapon upgrade level (1–90). Raises weapon ATK.').wrap);

  // weapon essence (gems): one slider per slot the selected weapon has
  const curWeapon = DATA.weapons.weapons.find((w) => w.id === effWeaponId);
  for (const role of ['main', 'sub', 'skill']) {
    const slot = curWeapon?.essence?.find((s) => s.role === role);
    if (!slot) continue;
    const ess = range('ess_' + role, `Essence: ${slot.name} (0–9)`, 0, 9, state.essRanks[role],
      `Essence rank (0–9) of the ${slot.name} slot — the gem’s level. Higher rank = stronger bonus.`);
    ess.el.oninput = () => { state.essRanks[role] = +ess.el.value; ess.render(); renderResults(); };
    wc.appendChild(ess.wrap);
  }

  c.appendChild(wc);

  // --- gear card ------------------------------------------------------------
  const gc = el('div', 'card');
  gc.appendChild(el('h2', null, 'Gear (armor)'));

  for (const slot of SLOTS) {
    const sel = el('select');
    sel.id = `slot_${slot.key}`;
    const none = el('option', null, '— none —');
    none.value = '';
    const cur = state.gear[slot.key];
    if (!cur) none.selected = true;

    // group pieces by suit
    const items = Object.values(DATA.equipment.items)
      .filter((x) => x.slot === slot.partType)
      .sort((a, b) => {
        const sa = a.suit || '', sb = b.suit || '';
        if (!!sa !== !!sb) return sa ? -1 : 1;
        if (sa && sa !== sb) return sa.localeCompare(sb);
        if (a.tier !== b.tier) return b.tier - a.tier;
        return String(a.name).localeCompare(String(b.name));
      });
    let lastGroup = null;
    for (const it of items) {
      const group = it.suit ? (DATA.equipment.suits[it.suit]?.name || it.suit) : 'Generic (no set)';
      if (group !== lastGroup) {
        gcSlotOptgroup(sel, group);
        lastGroup = group;
      }
      const locked = it.minLv > state.opLv;
      const o = el('option', null, `${'★'.repeat(it.rarity || 0)} ${it.name}` +
        gearAffixPreview(it) +
        (locked ? ` — needs Lv ${it.minLv}` : ''));
      o.value = it.id;
      o.dataset.minlv = it.minLv ?? 0;
      o.disabled = locked;
      o.selected = cur?.id === it.id;
      sel.appendChild(o);
    }
    // keep the current selection visible even if it is locked out by level
    if (cur && ![...sel.options].some((o) => o.value === cur.id)) {
      const it = DATA.equipment.items[cur.id];
      const o = el('option', null, `${it ? it.name : cur.id} (Lv ${state.opLv} — locked)`);
      o.value = cur.id;
      o.selected = true;
      sel.appendChild(o);
    }
    gc.appendChild(ctlRow(slot.name, sel, `${slot.tip}. Locked pieces need a higher operator level.`));

    // per-affix enhancement sliders (rebuilt when the piece changes)
    const enh = el('div', 'enhbox');
    enh.id = `enh_${slot.key}`;
    gc.appendChild(enh);
    renderEnhSlot(slot);
  }

  gc.appendChild(el('p', 'hint',
    'Pick up to 4 pieces (body / hand / 2 devices). Matching 3 pieces of a set activates its passive below. ' +
    'Each piece’s affixes are enhanced separately (0–3 per affix) — just like in-game, where you choose what to enhance; ' +
    'affixes shown without a slider are the same at every stage. Leave “none” for a no-gear baseline.'));

  c.appendChild(gc);

  // --- target card ----------------------------------------------------------
  const tc = el('div', 'card');
  tc.appendChild(el('h2', null, 'Target (mob)'));

  tc.appendChild(numInput('mobDef', 'Mob DEF', state.mobDef, 1,
    'Defense of the mob you are fighting (0 = no mitigation, like the test dummy). ' +
    'Damage is scaled by 100/(DEF+100). Type any value from the game — no enemy presets needed.').wrap);
  tc.appendChild(numInput('resist', 'Elemental resistance %', state.resist, 1,
    'Target’s resistance to your element (0–100). Reduces your damage accordingly.').wrap);
  tc.appendChild(numInput('dmgBonus', 'Extra damage bonus %', state.dmgBonus, 1,
    'Additive damage bonus % from team abilities, artifacts, buffs, etc.').wrap);
  tc.appendChild(numInput('dmgReduction', 'Damage taken reduction %', state.dmgReduction, 1,
    'Reduces the damage you deal by this % (e.g. target armor/shield effects).').wrap);

  const chk = el('div', 'ctl chk');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'staggered';
  cb.checked = state.staggered;
  chk.appendChild(cb);
  chk.appendChild(el('label', null, 'Target staggered (×1.3 damage)'));
  chk.lastChild.title = 'A staggered (broken) target takes 30% more damage.';
  tc.appendChild(chk);

  c.appendChild(tc);

  // --- bindings --------------------------------------------------------------
  const re = () => renderResults();
  const bindNum = (id) => {
    $(id).oninput = () => {
      state[id] = +$(id).value || 0;
      re();
    };
  };
  opSel.onchange = () => {
    state.opId = opSel.value;
    const op = operatorById(state.opId);
    if (op && op.defaultWeapon) state.weaponId = op.defaultWeapon;
    renderControls();
    re();
  };
  opLv.el.oninput = () => {
    state.opLv = +opLv.el.value;
    opLv.render();
    updateGearLocks(); // gear availability depends on operator level (in place: drag-safe)
    re();
  };
  wSel.onchange = () => { state.weaponId = wSel.value; renderControls(); re(); };
  $('weaponLv').oninput = () => { state.weaponLv = +$('weaponLv').value; $('weaponLvV').textContent = state.weaponLv; re(); };
  for (const slot of SLOTS) {
    $(`slot_${slot.key}`).onchange = () => {
      const v = $(`slot_${slot.key}`).value;
      // switching pieces resets per-affix stages (fresh piece, stage 0 each)
      state.gear[slot.key] = v ? { id: v, en: {} } : null;
      renderEnhSlot(slot);
      re();
    };
  }
  bindNum('mobDef');
  bindNum('resist');
  bindNum('dmgBonus');
  bindNum('dmgReduction');
  $('staggered').onchange = () => { state.staggered = $('staggered').checked; re(); };
}

function gcSlotOptgroup(sel, label) {
  const og = el('optgroup');
  og.label = label;
  sel.appendChild(og);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

// display order for skill kinds (sheet-like layout: basics, then abilities).
// Kinds come from the dump, e.g. 'Battle Skill (during Ult)', 'Ultimate (2)'.
function kindRank(kind) {
  const base = String(kind).split(' (')[0];
  const rank = {
    'Basic Hit': 0,
    'Dash Attack': 1,
    'Falling Attack': 2,
    'Heavy Attack': 3,
    'Battle Skill': 4,
    'Combo': 5,
    'Ultimate': 6,
    'Ult Hit': 7,
    'Ult Finisher': 7,
    'Floating Hit': 8,
    'Passive': 9,
  };
  return rank[base] ?? 99;
}

// Sort skills by display order and number duplicate kinds ("Basic Hit 1..5").
function numberSkills(list) {
  const sorted = list.slice().sort((a, b) => {
    const ka = kindRank(a.kind);
    const kb = kindRank(b.kind);
    if (ka !== kb) return ka - kb;
    const tail = (id) => parseInt(String(id).match(/(\d+)\s*$/)?.[1] ?? 0, 10);
    return tail(a.id) - tail(b.id);
  });
  const kindCount = {};
  for (const s of sorted) kindCount[s.kind] = (kindCount[s.kind] || 0) + 1;
  const kindSeen = {};
  for (const s of sorted) {
    if (kindCount[s.kind] > 1) {
      kindSeen[s.kind] = (kindSeen[s.kind] || 0) + 1;
      s.name = `${s.kind} ${kindSeen[s.kind]}`;
    } else {
      s.name = s.kind;
    }
  }
  return sorted;
}

// Human-readable line for a suit passive blackboard.
function bbDesc(bb) {
  const parts = [];
  const frac = (v) => `${(v * 100).toFixed(0)}%`;
  if (bb.dmg_up) parts.push(`+${frac(bb.dmg_up)} DMG`);
  if (bb.atk_up != null) parts.push(bb.atk_up <= 1 ? `+${frac(bb.atk_up)} ATK` : `+${bb.atk_up} ATK`);
  if (bb.crit_up) parts.push(`+${frac(bb.crit_up)} crit rate`);
  if (bb.crit_up2) parts.push(`+${frac(bb.crit_up2)} crit rate (2nd)`);
  if (bb.hp_up) parts.push(`+${bb.hp_up} HP`);
  if (bb.hp_add) parts.push(`+${bb.hp_add} HP`);
  if (bb.hp_ratio) parts.push(`${frac(bb.hp_ratio)} max HP`);
  if (bb.dmg_taken_down) parts.push(`takes −${(100 - bb.dmg_taken_down * 100).toFixed(0)}% DMG`);
  if (bb.comboskill_cooldown) parts.push(`combo CD ×${bb.comboskill_cooldown}`);
  if (bb.ultimate_gain_up) parts.push(`+${frac(bb.ultimate_gain_up)} ULT gauge`);
  if (bb.atb_recover) parts.push(`+${bb.atb_recover} ATB`);
  if (bb.spell_dmg_up) parts.push(`+${frac(bb.spell_dmg_up)} Arts DMG`);
  if (bb.skill_dmg_up) parts.push(`+${frac(bb.skill_dmg_up)} Skill DMG`);
  if (bb.spell_up) parts.push(`+${frac(bb.spell_up)} Arts DMG`);
  if (bb.phy_dmg_up) parts.push(`+${frac(bb.phy_dmg_up)} Physical DMG`);
  if (bb.phy_dmg_up_perstack) parts.push(`+${frac(bb.phy_dmg_up_perstack)} Physical DMG/stack`);
  if (bb.fire_dmg_up) parts.push(`+${frac(bb.fire_dmg_up)} Heat DMG`);
  if (bb.nature_dmg_up) parts.push(`+${frac(bb.nature_dmg_up)} Nature DMG`);
  if (bb.pulse_dmg_up) parts.push(`+${frac(bb.pulse_dmg_up)} Electric DMG`);
  if (bb.cryst_dmg_up) parts.push(`+${frac(bb.cryst_dmg_up)} Cryo DMG`);
  if (bb.heal_up) parts.push(`+${frac(bb.heal_up)} healing`);
  if (bb.atk_scale) parts.push(`atk scale ×${bb.atk_scale}`);
  if (bb.special_multi) parts.push(`special ×${bb.special_multi}`);
  if (bb.phy_spell_up) parts.push(`+${bb.phy_spell_up} Physical Arts`);
  if (bb.max_stack) parts.push(`max ${bb.max_stack} stacks`);
  if (bb.duration) parts.push(`lasts ${bb.duration}s`);
  return parts.join(', ') || JSON.stringify(bb);
}

function renderResults() {
  const r = $('results');
  r.innerHTML = '';

  const cur = currentBuild();
  if (!cur) {
    r.appendChild(el('div', 'card', '<p>No operator selected.</p>'));
    return;
  }
  const { op, gear, build } = cur;

  // --- operator / attack card ------------------------------------------------
  const card = el('div', 'card');
  const line = el('div', 'opline');
  line.appendChild(el('span', 'name', op.name));
  for (const tag of [
    op.element,
    operatorById(op.id)?.professionName || operatorById(op.id)?.profession || '',
    `${'★'.repeat(operatorById(op.id)?.rarity || 0)} ★`,
    build.weapon ? build.weapon.typeName : '',
    `Lv ${state.opLv}`,
  ]) {
    if (tag) line.appendChild(el('span', 'tag', tag));
  }
  card.appendChild(line);

  const atkLine = el('div', 'ctl');
  atkLine.appendChild(
    el('div', null, `<span class="big">${fmt(build.finalAttack, 1)}</span> <span class="tag">Final Attack</span>`)
  );
  card.appendChild(atkLine);

  const g = gear;
  const anyGear = SLOTS.some((s) => state.gear[s.key]);
  const sg = el('div', 'statgrid');
  const add = (k, v, hl) => {
    const row = el('div', 'statrow' + (hl ? ' hl' : ''));
    row.appendChild(el('span', 'k', k));
    row.appendChild(el('span', 'v', String(v)));
    sg.appendChild(row);
  };
  add('Base ATK', `${op.atk} + ${fmt1(build.weaponAtk)}${build.essAtkFlat ? ` + ${fmt1(build.essAtkFlat)} (essence)` : ''}${build.suitPct.flat ? ` + ${fmt(build.suitPct.flat)} (set)` : ''}`);
  add('ATK %', `${fmt1(build.suitPct.atk + g.atkPct + build.essAtkPct)}%${build.essAtkPct ? ` (incl. ${fmt1(build.essAtkPct)}% essence)` : ''}`);
  add(`Main (${op.mainAttrName})`, `${fmt1(build.mainTotal)}${build.mainTotal !== op.mainValue ? ' (incl. gear/pot/essence)' : ''}`);
  add(`Sub (${op.subAttrName})`, `${fmt1(build.subTotal)}${build.subTotal !== op.subValue ? ' (incl. gear/pot/essence)' : ''}`);
  add('Stat bonus', `× ${fmt(build.statBonus, 4)}`);
  add('Weapon', `${build.weapon ? build.weapon.name : '—'} (Lv ${state.weaponLv})`);
  const essParts = [];
  for (const [name, rank] of [['Main', state.essRanks.main], ['Sub', state.essRanks.sub], ['Skill', state.essRanks.skill]]) {
    if (rank > 0) essParts.push(`${name} R${rank}`);
  }
  if (essParts.length) add('Essence', essParts.join(' · '), true);
  add('Operator potential', state.pot > 0 ? `P${state.pot}` : '—');
  add('HP', fmt(op.hp));
  add('DEF', fmt(op.def));
  add('Crit rate', `${fmt1(build.critRate)}%${build.critRate !== op.critRate ? ' (incl. pot/essence/gear)' : ''}`);
  add('Crit damage', `${fmt1(build.critDmg)}%${build.critDmg !== op.critDmg ? ' (incl. pot/essence/gear)' : ''}`);
  card.appendChild(sg);
  r.appendChild(card);

  // --- gear summary card --------------------------------------------------------
  const gcard = el('div', 'card');
  gcard.appendChild(el('h2', null, 'Gear & set bonuses'));
  if (!anyGear) {
    gcard.appendChild(el('p', 'hint', 'No gear equipped. Use the “Gear (armor)” panel on the left.'));
  } else {
    const glist = el('div', 'statgrid');
    for (const slot of SLOTS) {
      const sel = state.gear[slot.key];
      const it = sel ? DATA.equipment.items[sel.id] : null;
      const g2 = el('div', 'statrow');
      g2.appendChild(el('span', 'k', slot.name));
      g2.appendChild(el('span', 'v', it ? `${it.name}${enSummaryText(sel, it)}` : '—'));
      glist.appendChild(g2);
    }
    gcard.appendChild(glist);

    // aggregate affix lines (skip the six taken-scalar keys: shown as one product)
    const affRows = [];
    const seenKeys = {};
    for (const slot of SLOTS) {
      const sel = state.gear[slot.key];
      if (!sel) continue;
      const it = DATA.equipment.items[sel.id];
      const st = it ? pieceStats(sel, it) : {};
      for (const [t, v] of Object.entries(st)) {
        if (TAKEN_KEYS.includes(t) || t === DEF_KEY) continue;
        seenKeys[t] = (seenKeys[t] ?? 0) + v;
      }
    }
    for (const [t, v] of Object.entries(seenKeys)) {
      affRows.push(`${affixLabel(t)} <b>${affixValueText(t, v)}</b>`);
    }
    if (g.takenMult !== 1) affRows.push(`Final DMG reduction <b>×${g.takenMult.toFixed(3)}</b>`);
    if (g.elemBonusPct) {
      // already in affRows via 50-54; nothing extra
    }
    if (affRows.length) {
      const al = el('div', 'affixlist');
      al.innerHTML = affRows.map((x) => `<div>${x}</div>`).join('');
      gcard.appendChild(al);
    }
    if (g.suitBonuses.length) {
      const sdiv = el('div', 'sets');
      sdiv.appendChild(el('div', 'sethead', 'Active set bonuses'));
      for (const b of g.suitBonuses) {
        sdiv.appendChild(el('div', 'setline', `${b.cnt}-pc · <b>${b.name}</b> — ${bbDesc(b.bb)}`));
      }
      gcard.appendChild(sdiv);
    }
  }
  r.appendChild(gcard);

  // --- per-hit table ----------------------------------------------------------
  const skills = numberSkills(operatorSkills(DATA.skills, op.id, state.skillLv));
  const tgt = {
    atk: build.finalAttack,
    critRate: build.critRate,
    critDmg: build.critDmg,
    ...targetParams(),
  };

  const tcard = el('div', 'card');
  const lvVals = Object.values(state.skillLv);
  const lvTxt = !lvVals.length ? '12 (default)'
    : lvVals.every((v) => v === lvVals[0]) ? `${lvVals[0]}` : 'mixed (per tree)';
  tcard.appendChild(el('h2', null, `Damage per skill — Lv ${lvTxt}, target DEF ${fmt(state.mobDef)}`));
  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr><th>Skill</th><th>Hits</th><th>Scale</th><th>Base</th><th>Min</th><th>Avg</th><th>Max</th></tr></thead>';
  const tbody = document.createElement('tbody');
  let totMin = 0, totAvg = 0, totMax = 0, totBase = 0;
  const rowsHtml = [];
  const eh = build.extraHit || 0; // essence extra-hit scale: added once per cast
  for (const s of skills) {
    const scales = eh ? [...s.scales, eh] : s.scales;
    const res = calcHit({ ...tgt, scales });
    totMin += res.min; totAvg += res.avg; totMax += res.max; totBase += res.base;
    const name = s.name + (s.passive ? ' <span class="sub">passive</span>' : '');
    const scale = scales.length ? scales.reduce((a, b) => a + b, 0) : 0;
    const hits = s.hit ? `${s.hit} hit${s.hit > 1 ? 's' : ''}` : '—';
    rowsHtml.push(
      `<tr><td>${name}</td><td>${hits}</td><td>${(scale * 100).toFixed(1)}%${eh ? ' <span class="sub">incl. extra hit</span>' : ''}</td>` +
      `<td>${fmt(res.base)}</td><td>${fmt(res.min)}</td><td>${fmt(res.avg)}</td><td>${fmt(res.max)}</td></tr>`
    );
  }
  tbody.innerHTML =
    rowsHtml.join('') +
    `<tr class="total"><td>All skills</td><td></td><td></td>` +
    `<td>${fmt(totBase)}</td><td>${fmt(totMin)}</td><td>${fmt(totAvg)}</td><td>${fmt(totMax)}</td></tr>`;
  table.appendChild(tbody);
  tcard.appendChild(table);
  r.appendChild(tcard);

  // --- dps card ---------------------------------------------------------------
  const dcard = el('div', 'card');
  dcard.appendChild(el('h2', null, 'DPS (all skills per window)'));
  const wrow = el('div', 'ctl');
  wrow.appendChild(el('label', null, 'Window, seconds <span class="val" id="winV">' + state.windowSecs + '</span>'));
  wrow.lastChild.title = 'Length of the DPS window in seconds. Shorter = burst, longer = sustained.';
  const win = document.createElement('input');
  win.type = 'range';
  win.id = 'winSecs';
  win.min = 1;
  win.max = 60;
  win.step = 0.1;
  win.value = state.windowSecs;
  win.oninput = () => {
    state.windowSecs = +win.value;
    $('winV').textContent = win.value;
    renderResults();
  };
  wrow.appendChild(win);
  dcard.appendChild(wrow);

  const dbox = el('div', 'dpsbox');
  dbox.appendChild(
    el('div', null, `<span class="big">${fmt(dps(totAvg, state.windowSecs))}</span> <span class="tag">avg DPS</span>`)
  );
  dbox.appendChild(
    el('div', null, `<span style="font-size:15px;font-weight:650">${fmt(dps(totMin, state.windowSecs))}</span> <span class="tag">min</span>`)
  );
  dbox.appendChild(
    el('div', null, `<span style="font-size:15px;font-weight:650">${fmt(dps(totMax, state.windowSecs))}</span> <span class="tag">max</span>`)
  );
  dcard.appendChild(dbox);
  dcard.appendChild(
    el('p', 'hint',
      `Avg = min×(1−CR) + max×CR with CD ${fmt1(build.critDmg)}%. Window covers every listed skill once; ` +
      'tune the window to your actual rotation for realistic DPS.')
  );
  r.appendChild(dcard);

  // --- team card ---------------------------------------------------------------
  renderTeam(r, tgt);
}

// ---------------------------------------------------------------------------
// Team builder
// ---------------------------------------------------------------------------

function addTeamMember() {
  const cur = currentBuild();
  if (!cur) return;
  const { op, gear, build } = cur;
  const tp = targetParams();
  const eh = build.extraHit || 0;
  const skills = numberSkills(operatorSkills(DATA.skills, op.id, state.skillLv))
    .filter((s) => s.scales.length || eh)
    .map((s) => ({ id: s.id, label: s.name, hit: s.hit, scales: eh ? [...s.scales, eh] : s.scales }));
  state.team.push({
    key: Date.now() + Math.random(),
    opId: op.id,
    name: op.name,
    atk: build.finalAttack,
    critRate: build.critRate,
    critDmg: build.critDmg,
    // member-specific: element bonus + active set passives + essence (snapshot)
    elemSetPct: gear.elemBonusPct + build.suitPct.dmg + build.essDmgPct,
    takenMult: tp.damageTakenMult,
    skills,
    seq: [],
  });
  renderResults();
}

function memberTotals(m) {
  const tp = targetParams();
  let min = 0, avg = 0, max = 0;
  for (const idx of m.seq) {
    const s = m.skills[idx];
    if (!s) continue;
    // Shared target settings come from the live panel; the damage bonus and
    // taken multiplier are the member's own (element + set passives + gear
    // scalars captured at snapshot time) plus the panel's global bonus.
    const res = calcHit({
      atk: m.atk,
      critRate: m.critRate,
      critDmg: m.critDmg,
      damageBonusPct: m.elemSetPct + state.dmgBonus,
      scales: s.scales,
      targetDef: tp.targetDef,
      targetResistPct: tp.targetResistPct,
      damageReductionPct: tp.damageReductionPct,
      damageTakenMult: m.takenMult,
      staggered: tp.staggered,
    });
    min += res.min; avg += res.avg; max += res.max;
  }
  return { min, avg, max };
}

function renderTeam(r, /* unused; team recomputes target itself */ _tgt) {
  const card = el('div', 'card');
  card.appendChild(el('h2', null, 'Team (skill sequences)'));
  card.appendChild(el('p', 'hint',
    '“Add current build” snapshots the operator above (level, skill trees, weapon, essence, potential, gear) as a team member. ' +
    'Add skills to each member’s sequence in cast order — totals combine every hit, crits included. ' +
    'Target settings (DEF, resistance, staggered, global bonus) are shared across all members.'));

  const btn = el('button', 'btn', 'Add current build to team');
  btn.title = 'Snapshot the operator, weapon, gear and target above as a new team member';
  btn.onclick = addTeamMember;
  card.appendChild(btn);

  if (!state.team.length) {
    card.appendChild(el('p', 'hint', 'No team members yet.'));
  } else {
    let teamMin = 0, teamAvg = 0, teamMax = 0;
    state.team.forEach((m, mi) => {
      const tot = memberTotals(m);
      teamMin += tot.min; teamAvg += tot.avg; teamMax += tot.max;

      const box = el('div', 'member');
      box.appendChild(el('div', 'memberhead',
        `<b>${m.name}</b> <span class="tag">FA ${fmt(m.atk, 1)}</span>` +
        `<span class="tag">${fmt(tot.avg)} avg / ${m.seq.length} casts</span>`));

      const addRow = el('div', 'memberadd');
      const mmLbl = el('label', 'mmlabel', 'Cast skill');
      mmLbl.title = 'Pick the skill to append to this member’s sequence (in cast order)';
      const sel = el('select');
      sel.title = mmLbl.title;
      m.skills.forEach((s, i) => {
        const o = el('option', null, `${s.label}${s.hit ? ` (${s.hit} hits)` : ''}`);
        o.value = i;
        sel.appendChild(o);
      });
      const addBtn = el('button', 'btn sm', '+');
      addBtn.title = 'Append this skill to the sequence';
      addBtn.onclick = () => { m.seq.push(+sel.value); renderResults(); };
      addRow.appendChild(mmLbl);
      addRow.appendChild(sel);
      addRow.appendChild(addBtn);
      box.appendChild(addRow);

      if (m.seq.length) {
        const chips = el('div', 'chips');
        m.seq.forEach((idx, ci) => {
          const s = m.skills[idx];
          const chip = el('span', 'chip', `${ci + 1}. ${s ? s.label : '?'}`);
          const x = el('span', 'chipx', '×');
          x.title = 'Remove this cast from the sequence';
          x.onclick = () => { m.seq.splice(ci, 1); renderResults(); };
          chip.appendChild(x);
          chips.appendChild(chip);
        });
        box.appendChild(chips);
      }

      const rm = el('button', 'btn sm ghost', 'Remove member');
      rm.title = 'Remove this operator from the team';
      rm.onclick = () => { state.team.splice(mi, 1); renderResults(); };
      box.appendChild(rm);
      card.appendChild(box);
    });

    const trow = el('div', 'teamrow');
    trow.appendChild(el('span', null, `Team total (all members, all casts): <b>${fmt(teamAvg)}</b> avg · ${fmt(teamMin)} min · ${fmt(teamMax)} max`));

    const wrow = el('div', 'ctl');
    const wl = el('label', null, `Team window, seconds <span class="val">${state.teamWindow}</span>`);
    wl.title = 'Seconds over which the team sequence is repeated';
    const win = document.createElement('input');
    win.type = 'range';
    win.min = 1;
    win.max = 120;
    win.step = 0.1;
    win.value = state.teamWindow;
    win.oninput = () => { state.teamWindow = +win.value; renderResults(); };
    wrow.appendChild(wl);
    wrow.appendChild(win);
    card.appendChild(wrow);

    card.appendChild(el('div', 'teamdps',
      `<span class="big">${fmt(dps(teamAvg, state.teamWindow))}</span> <span class="tag">team avg DPS</span>`));
  }
  r.appendChild(card);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function render() {
  renderControls();
  renderResults();
}

render();