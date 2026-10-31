# Endfield DMG Calculator

A **truly free** (no signup, no subscription) damage calculator for
**Arknights: Endfield**. Static site, zero backend, zero runtime dependencies.

- **Data** is ingested automatically from the public game-table dump
  [`rmxlinux/EndfieldData`](https://github.com/rmxlinux/EndfieldData) —
  34 operators, 84 weapons, 394 skills, 276 gear pieces, 24 suits.
- **Formulas** follow
  [`Taksumii/Arknights-Endfield-DPS-Calc`](https://github.com/Taksumii/Arknights-Endfield-DPS-Calc)
  (MIT), verified against published sheet anchors (Laevatain + Tarr 11:
  17,206.8 with the reference gear loadout).

## Features

- Operator + weapon + potential picker (weapon list filters by weapon type)
- Gear picker: 4 slots (body / hand / 2 devices); up to 3 enhanceable
  affix slots per piece (0–3 each, composite slots as one slider — as
  in-game), suit detection with the fixed 3-piece passive bonus
- Target editor: fully configurable mob (manual DEF), elemental resistance,
  staggered toggle, extra damage bonus — no enemy presets
- Per-skill damage table (min / avg / max, crit included) + DPS
- **Team builder**: snapshot the current build as a team member, define
  each member's skill cast sequence, combined total damage and
  team-average DPS over a configurable window
- Every control has a visible label and a tooltip explaining it

## Local development

```sh
npm install
npm run normalize   # fetch upstream tables + build data bundles
npm run dev         # Vite dev server on :5173
npm test            # engine unit tests (node --test)
npm run build       # vite build -> dist/ (+ copy data bundles)
```

The raw dump lives in `.data/endfieldata/TableCfg` (git-ignored).
`tools/fetchData.mjs` downloads only the ~13 tables the normalizer needs,
pinned to the upstream HEAD commit (atomic snapshot), and skips the
download when the commit is unchanged.

## Auto-update + hosting (GitHub Actions + Pages)

`.github/workflows/deploy.yml` runs every 6 hours (and on push):

1. `tools/fetchData.mjs` — check upstream HEAD vs last-used commit
2. `tools/normalize.mjs` — regenerate the `data/` bundles
3. `npm test` — engine tests must pass
4. `npm run build` — produce `dist/`
5. if the dump changed, commit the refreshed `data/` back to the repo
6. deploy `dist/` to GitHub Pages

One-time setup:

1. Create a new (empty) GitHub repo, e.g. `endfield-dmg-calc`
2. In the repo: **Settings → Pages → Source: GitHub Actions**
3. Push this project to the repo (`main` branch)
4. The workflow deploys to `https://<username>.github.io/<repo>/`
   (site URL appears under Settings → Pages after the first run)

The Vite build uses relative paths (`base: './'`), so the site works both
at the repo root and in a `/project/` subpath.

## Project layout

```
index.html              page shell
src/main.mjs            UI (vanilla ES module, renders everything)
src/engine.mjs          damage engine (tested)
src/style.css           dark theme
data/                   generated bundles (committed; refreshed by CI)
tools/fetchData.mjs     upstream table downloader (SHA-pinned)
tools/normalize.mjs     dump -> browser bundles
tools/copyData.mjs      build step: data/ -> dist/data/
tests/engine.test.mjs   26 engine tests
tools/reference/        reference .cs files from the MIT formula repo
```

## Attribution & license

- Game data © Hypergryph; dumped by the community
  ([rmxlinux/EndfieldData](https://github.com/rmxlinux/EndfieldData)).
- Damage formula reference:
  [Taksumii/Arknights-Endfield-DPS-Calc](https://github.com/Taksumii/Arknights-Endfield-DPS-Calc) (MIT).
- This project is MIT-licensed, non-commercial.