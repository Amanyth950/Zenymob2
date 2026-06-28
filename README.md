# Zenymob2

Zenymob2 is the static frontend successor to the Streamlit Mob Value Planner. The goal is to keep the data-generation idea from the old Python project and move the user-facing app to a fast browser UI.

## Current state

This repository contains a Vite + React + TypeScript app. During `npm run build`, it downloads the Hercules repository archive, parses the pre-renewal monster/item/spawn/experience data, and writes a generated frontend dataset to `public/data/monsters.json` before Vite builds the static app.

Implemented:

- client-side monster search and sorting
- full generated Hercules pre-renewal monster dataset at build time
- spawn parsing from Hercules NPC mob files
- base EXP and job EXP enrichment from Hercules monster database files
- experience farming tab with base/job/total EXP, EXP per HP, spawn-weighted EXP, target-kill estimates, and EXP/hour estimates
- UARO price switch
- Merchant Overcharge switch
- Great Nature conversion at `7.5 * Green Live`
- optional Poring Coin EV support
- manual price overrides stored in `localStorage`
- manual price import/export JSON
- selected-monster drop breakdown
- MVP drops excluded from EV unless the MVP toggle is enabled
- kills-per-30-min zeny/hour and experience/hour estimates
- filtered raw-data CSV/JSON exports including EXP columns

## Local development

```bash
npm install
npm run generate:data
npm run dev
```

`npm run dev` uses the current `public/data/monsters.json` file. Run `npm run generate:data` first when you want to refresh the generated dataset locally.

## Production build

```bash
npm run build
```

The build command runs:

```bash
npm run generate:data && tsc -b && vite build
```

The static build output is written to `dist/`.

## Cloudflare Workers & Pages setup

Use these settings in the Workers static assets flow:

```text
Build command: npm run build
Deploy command: npm run deploy
Build output directory: dist
Root directory: /
```

`wrangler.jsonc` points Wrangler at `./dist` and enables single-page app fallback.

## Data generation

The main generator is:

```bash
node scripts/generate-data.mjs
```

The full generated-data pipeline is:

```bash
npm run generate:data
```

That runs the Hercules data generator, adds base/job EXP data, then refreshes sprite names.

By default it uses the Hercules `master` branch. To pin another branch or SHA-compatible archive ref:

```bash
HERCULES_REF=master npm run generate:data
```

Generated files:

```text
public/data/monsters.json
public/data/metadata.json
```

A temporary CSV converter is also included for old Streamlit-era CSV files:

```bash
python scripts/convert_monster_ev_csv.py monster_ev.csv public/data/monsters.json
```

The converter expects `monster_ev.csv` to contain `drops_json` and `spawn_summary` columns.

## Data contract

The frontend expects monsters from:

```text
public/data/monsters.json
```

Each monster should look like:

```json
{
  "id": 1368,
  "name": "Sleeper",
  "level": 67,
  "hp": 8237,
  "baseExp": 3603,
  "jobExp": 2144,
  "element": "Earth 2",
  "race": "Formless",
  "size": "Medium",
  "isBoss": false,
  "hasMvpDrops": false,
  "spawns": [{ "map": "yuno_fild06", "count": 70 }],
  "drops": [
    {
      "itemId": 997,
      "itemKey": "Great_Nature",
      "name": "Great Nature",
      "chance": 2500,
      "baseSellPrice": 1500,
      "ignoreOvercharge": false,
      "type": "normal"
    }
  ]
}
```

Drop chance uses the same Hercules scale as before:

```text
10000 = 100%
```

## Experience workflow

The experience tab is meant for leveling decisions rather than loot decisions. It compares:

- base EXP per kill
- job EXP per kill
- total EXP per kill
- total EXP per HP as a rough kill-efficiency proxy
- selected EXP focus multiplied by best-map spawn count as a density proxy
- kills to a target base/job EXP gap
- selected EXP focus per hour from a user-entered kills-per-30-min value

Use EXP per HP when kill speed is the limiting factor, spawn-weighted EXP when density is the limiting factor, and the target EXP inputs when planning a short grind to the next level or job level.

## Notes

This is intentionally not a Streamlit app. All user interactions run in the browser without server reruns.
