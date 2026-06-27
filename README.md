# Zenymob2

Zenymob2 is the static frontend successor to the Streamlit Mob Value Planner. The goal is to keep Python for offline data generation and move the user-facing app to a fast browser UI.

## Current state

This repository currently contains a Vite + React + TypeScript prototype with sample data.

Implemented:

- client-side monster search and sorting
- UARO price switch
- Merchant Overcharge switch
- Great Nature conversion at `7.5 * Green Live`
- optional Poring Coin EV support
- manual price overrides stored in `localStorage`
- manual price import/export JSON
- selected-monster drop breakdown
- kills-per-30-min zeny/hour estimate

The sample dataset lives in `public/data/monsters.json`. Replace it with generated data before production use.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The static build output is written to `dist/`.

## Cloudflare Pages setup

Use these settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: /
Node version: Cloudflare default is fine for now
```

## Data conversion

A temporary converter is included so the old Streamlit-era CSV can feed this frontend before the generator is rewritten directly:

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
      "ignoreOvercharge": false
    }
  ]
}
```

Drop chance uses the same Hercules scale as before:

```text
10000 = 100%
```

## Migration plan

1. Keep the old Python parser/generator as the data source.
2. Use the temporary CSV converter to test the frontend with real data.
3. Add a direct JSON output mode to the old generator.
4. Replace the sample JSON file with generated production data.
5. Polish UI and split components once the data contract is stable.

## Notes

This is intentionally not a Streamlit app. All user interactions run in the browser without server reruns.
