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

// In-game composite slots: one slider covers the whole group of bundle keys
// (the dump's displayAttrModifiers lists exactly those groups, at most 3 per
// piece). Keyed by the sorted bundle-key signature.
const COMPOSITE_LABELS = {
  '28|32|33': 'All Skill DMG',
  '51|52|53|54': 'All Element DMG',
  '51|54': 'Fire & Natural DMG',
  '52|53': 'Pulse & Cryst DMG',
  '4|5|6|7|48|60': 'Final DMG Reduction',
};

// The piece's enhanceable groups (arrays of bundle-key strings, <=3), from
// the normalized `enh` field. Legacy fallback: one group per growing key.
function enhGroupsOf(item) {
  if (Array.isArray(item.enh)) return item.enh;
  const groups = [];
  for (const k of affixKeysOf(item)) {
    if (TAKEN_KEYS.includes(k) || k === DEF_KEY) continue;
    if (item.st.some((s) => s[k] !== item.st[0][k])) groups.push([k]);
  }
  return groups;
}

// Display label for an enhanceable group (composite or single affix).
function groupLabel(grp) {
  if (grp.length === 1) return affixLabel(grp[0]);
  const sig = grp.slice().sort().join('|');
  return COMPOSITE_LABELS[sig] || grp.map(affixLabel).join(' / ');
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

// "( +N Label, +N Label )" stage-0 preview appended to gear option labels:
// one entry per enhanceable group (a composite as a single entry), then
// affixes that belong to no group.
function gearAffixPreview(item) {
  const st = item.st[0];
  const parts = [];
  const grouped = new Set();
  for (const grp of enhGroupsOf(item)) {
    if (grp.every((k) => TAKEN_KEYS.includes(k))) continue;
    if (st[grp[0]] == null) continue;
    for (const k of grp) grouped.add(k);
    parts.push(`${affixValueText(grp[0], st[grp[0]])} ${groupLabel(grp)}`);
  }
  for (const k of affixKeysOf(item)) {
    if (TAKEN_KEYS.includes(k) || k === DEF_KEY || grouped.has(k)) continue;
    parts.push(`${affixValueText(k, st[k])} ${affixLabel(k)}`);
  }
  return parts.length ? ` ( ${parts.join(', ')} )` : '';
}

// Rebuild the enhancement box for one gear slot. Each *enhanceable slot*
// the piece has (at most 3, as in-game) gets one 0-3 slider; composite
// slots (e.g. “All Skill DMG”) cover their whole bundle of affix keys with
// a single slider. Affixes outside any enhanceable slot (fixed at every
// stage, or the six taken-scalars / DEF that are summarized in the gear
// results) are shown as fixed lines.
function renderEnhSlot(slot, givenBox) {
  // the card may not be attached to the document yet (renderControls builds
  // it before appending), so callers pass the box element explicitly; the id
  // lookup is kept only as a fallback
  const box = givenBox || $(`enh_${slot.key}`);
  if (!box) return;
  box.innerHTML = '';
  const sel = state.gear[slot.key];
  const item = sel ? DATA.equipment.items[sel.id] : null;
  if (!item) {
    box.appendChild(el('div', 'enhempty', 'Pick a piece to adjust its affixes.'));
    return;
  }
  const groups = enhGroupsOf(item);
  const grouped = new Set();
  for (const grp of groups) for (const k of grp) grouped.add(k);
  for (const grp of groups) {
    if (grp.every((k) => TAKEN_KEYS.includes(k))) continue; // summarized in the gear results
    const label = groupLabel(grp);
    // group members share one 4-stage value array, so any member shows the
    // stage value; prefer a non-taken key when the group mixes both
    const showKey = grp.find((k) => !TAKEN_KEYS.includes(k)) ?? grp[0];
    const row = el('div', 'enhrow');
    const lab = el('label', null, label);
    lab.title = `Enhancement stage (0–3) of the ${label} slot on this piece — up to 3 slots per piece, as in-game.`;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.id = `enh_${slot.key}_${grp[0]}`;
    inp.min = 0;
    inp.max = 3;
    inp.step = 1;
    inp.value = enStageOf(sel, showKey);
    inp.title = lab.title;
    const val = el('span', 'val', affixValueText(showKey, item.st[+inp.value][showKey]));
    val.id = `enh_${slot.key}_${grp[0]}V`;
    inp.oninput = () => {
      sel.en = sel.en || {};
      for (const k of grp) sel.en[k] = +inp.value; // one slider = one slot: the whole bundle moves together
      val.textContent = affixValueText(showKey, item.st[+inp.value][showKey]);
      renderResults();
    };
    row.appendChild(lab);
    row.appendChild(inp);
    row.appendChild(val);
    box.appendChild(row);
  }
  for (const k of affixKeysOf(item)) {
    if (TAKEN_KEYS.includes(k) || k === DEF_KEY || grouped.has(k)) continue;
    const row = el('div', 'enhrow');
    const lab = el('label', null, affixLabel(k));
    lab.title = `The ${affixLabel(k)} affix on this piece is the same at every enhancement stage.`;
    row.appendChild(lab);
    row.appendChild(el('span', 'val', affixValueText(k, item.st[0][k])));
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

function range(id, label, min, max, value, tip, step = 1) {
  const d = el('div', 'ctl');
  const l = el('label', null, `${label} <span class="val" id="${id}V">${value}</span>`);
  if (tip) l.title = tip;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.id = id;
  inp.min = min;
  inp.max = max;
  inp.step = step;
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

// Searchable combobox: a text input that filters a dropdown of items while
// keeping the classic "pick from a list" behavior — you can browse the full
// list (grouped, with lock markers) or just start typing to search it.
// o = { label, tip, items: [{value, text, group?, minLv?}], selected, onChange }
// Returns { wrap, updateLocks() }; the widget owns its open/active state.
function combo(o) {
  const d = el('div', 'ctl');
  const l = el('label', null, o.label);
  if (o.tip) l.title = o.tip;
  d.appendChild(l);
  const box = el('div', 'combo');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'combo-input';
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.placeholder = o.placeholder || '';
  const list = el('div', 'combo-list');
  box.appendChild(inp);
  box.appendChild(list);
  d.appendChild(box);

  const byValue = new Map(o.items.map((it) => [it.value, it]));
  const textOf = (v) => (byValue.has(v) ? byValue.get(v).text : '');
  inp.value = textOf(o.selected); // show the current selection right away
  let open = false, active = -1, itemEls = [];

  const firstEnabled = () => {
    const i = itemEls.findIndex((b) => !b.classList.contains('disabled'));
    return i < 0 ? -1 : i;
  };
  const markActive = () => {
    itemEls.forEach((b, i) => b.classList.toggle('active', i === active));
  };

  function renderList(filter) {
    list.innerHTML = '';
    itemEls = [];
    const f = (filter || '').trim().toLowerCase();
    let lastGroup = null;
    for (const it of o.items) {
      if (f && !it.text.toLowerCase().includes(f)) continue;
      if (it.group && it.group !== lastGroup) {
        list.appendChild(el('div', 'combo-grp', it.group));
        lastGroup = it.group;
      }
      const b = el('button', 'combo-item', it.text);
      b.type = 'button';
      b.dataset.value = it.value;
      const locked = it.minLv != null && +it.minLv > state.opLv;
      if (locked) b.title = `Locked — needs operator Lv ${it.minLv}`;
      b.classList.toggle('disabled', locked);
      if (it.value === o.selected) b.classList.add('selected');
      b.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in the input, no blur race
        if (b.classList.contains('disabled')) return;
        choose(b.dataset.value);
      });
      list.appendChild(b);
      itemEls.push(b);
    }
    if (!itemEls.length) list.appendChild(el('div', 'combo-empty', 'No matches — try fewer letters.'));
  }

  function choose(v) {
    o.selected = v;
    inp.value = textOf(v);
    itemEls.forEach((b) => b.classList.toggle('selected', b.dataset.value === v));
    close();
    if (o.onChange) o.onChange(v);
  }

  function close() {
    if (!open) return;
    open = false;
    box.classList.remove('open');
    inp.value = textOf(o.selected); // cancel any in-progress filter text
    active = -1;
  }

  function doOpen() {
    if (open) return;
    open = true;
    box.classList.add('open');
    renderList('');
    const selIdx = itemEls.findIndex((b) => b.dataset.value === o.selected);
    active = (selIdx >= 0 && !itemEls[selIdx].classList.contains('disabled')) ? selIdx : firstEnabled();
    markActive();
    inp.select(); // typing replaces the selection instead of inserting mid-word
  }

  inp.addEventListener('focus', doOpen);
  inp.addEventListener('input', () => {
    if (!open) doOpen();
    renderList(inp.value);
    active = firstEnabled();
    markActive();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { doOpen(); return; }
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (!itemEls.length) return;
      let i = active;
      for (let n = 0; n < itemEls.length; n++) {
        i = (i + dir + itemEls.length * 2) % itemEls.length;
        if (!itemEls[i].classList.contains('disabled')) { active = i; markActive(); break; }
      }
      if (active >= 0) itemEls[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (open && itemEls[active] && !itemEls[active].classList.contains('disabled')) {
        e.preventDefault();
        choose(itemEls[active].dataset.value);
      }
    } else if (e.key === 'Escape') {
      close();
      inp.blur();
    }
  });
  inp.addEventListener('blur', () => close());

  // re-evaluate min-Lv lock markers in place (called on operator-level change
  // while the list may be open — the widget itself is not rebuilt)
  function updateLocks() {
    for (const b of list.querySelectorAll('.combo-item')) {
      const it = byValue.get(b.dataset.value);
      const locked = it && it.minLv != null && +it.minLv > state.opLv;
      b.classList.toggle('disabled', locked);
      if (locked) b.title = `Locked — needs operator Lv ${it.minLv}`;
      else b.removeAttribute('title');
    }
  }

  return { wrap: d, input: inp, updateLocks };
}

// gear-slot comboboxes (rebuilt on every renderControls; used by updateGearLocks)
const gearCombos = {};

// attribute names for potential tier lines
const POT_ATTR_NAMES = { 39: 'Strength', 40: 'Agility', 41: 'Intellect', 42: 'Will' };

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

// re-evaluates gear item locks in place; renderControls() must not be used
// here — rebuilding while the level slider is being dragged would kill the
// slider under the cursor (the old drag bug)
function updateGearLocks() {
  for (const k of Object.keys(gearCombos)) gearCombos[k].updateLocks();
}

function renderControls() {
  const c = $('controls');
  c.innerHTML = '';

  // --- operator card -------------------------------------------------------
  const oc = el('div', 'card');
  oc.appendChild(el('h2', null, 'Operator'));

  const byProf = {};
  for (const op of DATA.operators) {
    (byProf[op.professionName || 'Other'] ||= []).push(op);
  }
  const opItems = [];
  for (const prof of Object.keys(byProf).sort()) {
    for (const op of byProf[prof].sort((a, b) => a.name.localeCompare(b.name))) {
      opItems.push({ value: op.id, text: op.name, group: prof });
    }
  }
  oc.appendChild(combo({
    label: 'Operator',
    tip: 'Pick the operator to calculate — start typing to search by name.',
    items: opItems,
    selected: state.opId,
    onChange: (v) => {
      state.opId = v;
      const op = operatorById(v);
      if (op && op.defaultWeapon) state.weaponId = op.defaultWeapon;
      renderControls();
      re();
    },
  }).wrap);

  const opLv = range('opLv', 'Level', 1, 90, state.opLv,
    'Operator level (1–90, in-game max). Base ATK and main/sub attributes scale with it; ' +
    'raising the level also unlocks higher gear.');
  oc.appendChild(opLv.wrap);

  // three level trees, exactly as in-game: every operator can only level up
  // Basic Attack, Battle Skill (incl. the combo/follow-up skills) and the
  // Ultimate. All other damage rows (dive/finisher hits, during-ult
  // variants, ult follow-up hits) ride on one of these three.
  const TREES = [
    ['basic', 'Basic Attack', 'all basic hits — light/heavy chain, dive, finisher, and during-ult basics'],
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

  // empty state.weaponId means "the operator's default weapon"
  const curOp = operatorById(state.opId);
  const effWeaponId = state.weaponId || curOp?.defaultWeapon || '';
  // an operator can only wield weapons of their own type — so the list is
  // pre-filtered to that type and grouped by star count (highest stars first)
  const byRarity = {};
  for (const w of DATA.weapons.weapons) {
    if (curOp && w.typeName !== curOp.weaponTypeName) continue;
    (byRarity[w.rarity || 0] ||= []).push(w);
  }
  const wItems = [];
  for (const r of Object.keys(byRarity).sort((a, b) => b - a)) {
    for (const w of byRarity[r].sort((a, b) => a.name.localeCompare(b.name))) {
      const tag = w.origin === 'bp' ? ' [BP]' : w.origin === 'sig' ? ' [SIG]' : '';
      wItems.push({ value: w.id, text: `${'★'.repeat(r)} ${w.name}${tag}`, group: '★'.repeat(r) });
    }
  }
  wc.appendChild(combo({
    label: 'Weapon',
    tip: `Weapons of this operator's ${curOp?.weaponTypeName || 'own'} type only, grouped by ` +
      '★ count (highest first) — start typing to search by name. [BP] = battle-pass weapon, ' +
      '[SIG] = signature (paid gacha) weapon.',
    items: wItems,
    selected: effWeaponId,
    onChange: (v) => { state.weaponId = v; renderControls(); re(); },
  }).wrap);

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
    const cur = state.gear[slot.key];
    const gItems = [{ value: '', text: '— none —' }];
    for (const it of items) {
      gItems.push({
        value: it.id,
        text: `${'★'.repeat(it.rarity || 0)} ${it.name}` + gearAffixPreview(it),
        group: it.suit ? (DATA.equipment.suits[it.suit]?.name || it.suit) : 'Generic (no set)',
        minLv: it.minLv ?? 0,
      });
    }
    const gCombo = combo({
      label: slot.name,
      tip: `${slot.tip} — start typing to search by piece or suit name. ` +
        'Locked pieces need a higher operator level.',
      items: gItems,
      selected: cur ? cur.id : '',
      onChange: (v) => {
        // switching pieces resets per-affix stages (fresh piece, stage 0 each)
        state.gear[slot.key] = v ? { id: v, en: {} } : null;
        renderEnhSlot(slot, enh);
        re();
      },
    });
    gc.appendChild(gCombo.wrap);
    gearCombos[slot.key] = gCombo;

    // per-affix enhancement sliders (rebuilt when the piece changes)
    const enh = el('div', 'enhbox');
    enh.id = `enh_${slot.key}`;
    gc.appendChild(enh);
    renderEnhSlot(slot, enh);
  }

  gc.appendChild(el('p', 'hint',
    'Pick up to 4 pieces (body / hand / 2 devices). Matching 3 pieces of a set activates its passive below — ' +
    'set passives are fixed in-game and cannot be toggled on/off. Each piece has up to 3 enhanceable slots ' +
    '(0–3 per slot, as in-game); a composite slot like “All Skill DMG” is a single slider covering its whole bundle. ' +
    'Affixes shown without a slider are fixed at every stage. Leave “none” for a no-gear baseline.'));

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

  // --- DPS window card ---------------------------------------------------------
  // These sliders live in the static controls column, NOT inside the results
  // cards: renderResults() rebuilds the results on every input, and a slider
  // recreated there dies mid-drag, making it feel stuck and stuttery.
  const dwc = el('div', 'card');
  dwc.appendChild(el('h2', null, 'DPS window'));
  const win1 = range('winSecs', 'Window, seconds', 1, 60, state.windowSecs,
    'Length of the single-operator DPS window in seconds. Shorter = burst, longer = sustained.', 0.1);
  win1.el.oninput = () => { state.windowSecs = +win1.el.value; win1.render(); renderResults(); };
  dwc.appendChild(win1.wrap);
  const win2 = range('teamWinSecs', 'Team window, seconds', 1, 120, state.teamWindow,
    'Seconds over which the whole team sequence is repeated (team DPS).', 0.1);
  win2.el.oninput = () => { state.teamWindow = +win2.el.value; win2.render(); renderResults(); };
  dwc.appendChild(win2.wrap);
  c.appendChild(dwc);

  // --- bindings --------------------------------------------------------------
  // (the operator / weapon / gear comboboxes wire their onChange inside the
  //  combo() calls above; only the sliders and number inputs are bound here)
  const re = () => renderResults();
  const bindNum = (id) => {
    $(id).oninput = () => {
      state[id] = +$(id).value || 0;
      re();
    };
  };
  opLv.el.oninput = () => {
    state.opLv = +opLv.el.value;
    opLv.render();
    updateGearLocks(); // gear availability depends on operator level (in place: drag-safe)
    re();
  };
  $('weaponLv').oninput = () => { state.weaponLv = +$('weaponLv').value; $('weaponLvV').textContent = state.weaponLv; re(); };
  bindNum('mobDef');
  bindNum('resist');
  bindNum('dmgBonus');
  bindNum('dmgReduction');
  $('staggered').onchange = () => { state.staggered = $('staggered').checked; re(); };
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
    'Dive Attack': 2,
    'Finisher': 3,
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
      const sh = el('div', 'sethead', 'Active set bonuses');
      sh.title = 'Set passives are fixed in-game: wearing 3 pieces of a suit activates the bonus automatically — it cannot be toggled on/off.';
      sdiv.appendChild(sh);
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
  const dbox = el('div', 'dpsbox');
  dbox.appendChild(
    el('div', null, `<span class="big">${fmt(dps(totAvg, state.windowSecs))}</span> <span class="tag">avg DPS</span> <span class="tag">${state.windowSecs}s window</span>`)
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
    // full copy of the panel's build inputs, so the member can be reopened
    // and edited later (shared target fields are intentionally excluded)
    buildState: snapshotBuildState(),
  });
  renderResults();
}

// Clones the panel's build inputs — everything the snapshot above depends on.
// Cloned in both directions so panel edits never mutate a member's saved build.
function snapshotBuildState() {
  const gear = {};
  for (const s of SLOTS) {
    const g = state.gear[s.key];
    gear[s.key] = g ? { id: g.id, en: { ...g.en } } : null;
  }
  return {
    opId: state.opId,
    opLv: state.opLv,
    weaponId: state.weaponId,
    weaponLv: state.weaponLv,
    pot: state.pot,
    skillLv: { ...state.skillLv },
    essRanks: { ...state.essRanks },
    gear,
  };
}

// Restores a team member's build into the panel so it can be inspected and
// edited; “Add current build to team” then snapshots the edited version.
function loadMemberBuild(bs) {
  if (!bs) return;
  state.opId = bs.opId;
  state.opLv = bs.opLv;
  state.weaponId = bs.weaponId;
  state.weaponLv = bs.weaponLv;
  state.pot = bs.pot;
  state.skillLv = { ...bs.skillLv };
  state.essRanks = { ...bs.essRanks };
  state.gear = {};
  for (const s of SLOTS) {
    const g = bs.gear && bs.gear[s.key];
    state.gear[s.key] = g ? { id: g.id, en: { ...g.en } } : null;
  }
  renderControls();
  renderResults();
  $('controls').scrollIntoView({ behavior: 'smooth' });
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
    'Click a member’s name to load that build back into the controls panel for editing. ' +
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
      const head = el('div', 'memberhead');
      const nameBtn = el('button', 'membername');
      nameBtn.textContent = m.name;
      nameBtn.title = 'Open this member’s build in the controls panel — edit it there, then “Add current build to team” snapshots the changes';
      nameBtn.onclick = () => loadMemberBuild(m.buildState);
      head.appendChild(nameBtn);
      head.appendChild(el('span', 'tag', `FA ${fmt(m.atk, 1)}`));
      head.appendChild(el('span', 'tag', `${fmt(tot.avg)} avg / ${m.seq.length} casts`));
      box.appendChild(head);

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

    card.appendChild(el('div', 'teamdps',
      `<span class="big">${fmt(dps(teamAvg, state.teamWindow))}</span> <span class="tag">team avg DPS</span> <span class="tag">${state.teamWindow}s window</span>`));
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