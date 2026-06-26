import { useEffect, useMemo, useState } from 'react';
import { filterValues, sortValues } from './search';
import { exportManualPrices, importManualPrices, loadManualPrices, saveManualPrices } from './storage';
import { valueMonster } from './pricing';
import type { ManualPrices, Monster, MonsterValue, Settings } from './types';

const DEFAULT_SETTINGS: Settings = {
  dropMultiplier: 5,
  overcharge: true,
  overchargeRate: 1.24,
  uaro: true,
  poringCoin: false,
  poringCoinPrice: 12000,
  showBoss: false,
  showMvp: false,
};

function zeny(value: number): string {
  return `${Math.round(value).toLocaleString()}z`;
}

function percent(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, '')}%`;
}

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [manualPrices, setManualPrices] = useState<ManualPrices>(() => loadManualPrices());
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('expectedValue');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [killsPer30, setKillsPer30] = useState(0);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    fetch('/data/monsters.json')
      .then((response) => response.json())
      .then((data: Monster[]) => setMonsters(data))
      .catch(() => setMonsters([]));
  }, []);

  useEffect(() => {
    saveManualPrices(manualPrices);
  }, [manualPrices]);

  const values = useMemo(
    () => monsters.map((monster) => valueMonster(monster, settings, manualPrices)),
    [monsters, settings, manualPrices],
  );

  const filtered = useMemo(
    () => sortValues(filterValues(values, query, settings), sortBy),
    [values, query, settings, sortBy],
  );

  const selected = filtered.find((value) => value.monster.id === selectedId) ?? filtered[0] ?? null;

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  function setManualPrice(key: string, rawValue: string) {
    setManualPrices((previous) => {
      const next = { ...previous };
      if (rawValue.trim() === '') {
        delete next[key];
      } else {
        const price = Number(rawValue);
        if (Number.isFinite(price) && price >= 0) next[key] = price;
      }
      return next;
    });
  }

  function handleImport() {
    try {
      setManualPrices(importManualPrices(importText));
      setImportText('');
    } catch {
      alert('Could not import manual prices. Check that the JSON is valid.');
    }
  }

  const hourlyEstimate = selected ? selected.expectedValue * killsPer30 * 2 : 0;

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Zenymob2</p>
          <h1>Ragnarok farming value planner</h1>
          <p>Static frontend prototype. Pricing and filtering run in the browser without Streamlit reruns.</p>
        </div>
        <div className="hero-stats">
          <span>{monsters.length} monsters</span>
          <span>{Object.keys(manualPrices).length} manual prices</span>
        </div>
      </header>

      <main className="layout">
        <aside className="panel controls">
          <h2>Assumptions</h2>
          <label>
            Drop multiplier
            <input type="number" min="0" step="0.5" value={settings.dropMultiplier} onChange={(event) => updateSetting('dropMultiplier', Number(event.target.value))} />
          </label>
          <label className="check"><input type="checkbox" checked={settings.overcharge} onChange={(event) => updateSetting('overcharge', event.target.checked)} /> Merchant Overcharge</label>
          <label>
            Overcharge rate
            <input type="number" min="1" step="0.01" value={settings.overchargeRate} onChange={(event) => updateSetting('overchargeRate', Number(event.target.value))} />
          </label>
          <label className="check"><input type="checkbox" checked={settings.uaro} onChange={(event) => updateSetting('uaro', event.target.checked)} /> UARO prices</label>
          <label className="check"><input type="checkbox" checked={settings.poringCoin} onChange={(event) => updateSetting('poringCoin', event.target.checked)} /> Include Poring Coin</label>
          <label>
            Poring Coin price
            <input type="number" min="0" step="500" value={settings.poringCoinPrice} onChange={(event) => updateSetting('poringCoinPrice', Number(event.target.value))} />
          </label>
          <label className="check"><input type="checkbox" checked={settings.showBoss} onChange={(event) => updateSetting('showBoss', event.target.checked)} /> Show boss-flagged</label>
          <label className="check"><input type="checkbox" checked={settings.showMvp} onChange={(event) => updateSetting('showMvp', event.target.checked)} /> Show MVP drops</label>
        </aside>

        <section className="content-stack">
          <section className="panel toolbar">
            <input className="search" placeholder="Search monsters, maps, items, IDs..." value={query} onChange={(event) => setQuery(event.target.value)} />
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="expectedValue">Sort by EV</option>
              <option value="mapScore">Sort by map score</option>
              <option value="spawns">Sort by best-map spawns</option>
              <option value="level">Sort by level</option>
            </select>
          </section>

          <section className="panel results">
            <h2>Monster results</h2>
            <div className="result-list">
              {filtered.slice(0, 100).map((value) => (
                <button key={value.monster.id} className={selected?.monster.id === value.monster.id ? 'result active' : 'result'} onClick={() => setSelectedId(value.monster.id)}>
                  <strong>{value.monster.name}</strong>
                  <span>ID {value.monster.id} · Lv {value.monster.level} · {value.monster.element}</span>
                  <span>EV {zeny(value.expectedValue)} · Map score {zeny(value.mapScore)}</span>
                </button>
              ))}
            </div>
          </section>
        </section>

        <aside className="panel detail">
          {selected ? <MonsterDetail value={selected} killsPer30={killsPer30} setKillsPer30={setKillsPer30} hourlyEstimate={hourlyEstimate} manualPrices={manualPrices} setManualPrice={setManualPrice} /> : <p>No monster selected.</p>}
        </aside>
      </main>

      <section className="panel prices-panel">
        <h2>Manual prices</h2>
        <p>Manual prices override NPC/UARO/conversion prices and are stored in this browser.</p>
        <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste manual price JSON here" />
        <div className="button-row">
          <button onClick={handleImport}>Import</button>
          <button onClick={() => navigator.clipboard.writeText(exportManualPrices(manualPrices))}>Copy export JSON</button>
          <button onClick={() => setManualPrices({})}>Clear manual prices</button>
        </div>
      </section>
    </div>
  );
}

function MonsterDetail({ value, killsPer30, setKillsPer30, hourlyEstimate, manualPrices, setManualPrice }: {
  value: MonsterValue;
  killsPer30: number;
  setKillsPer30: (value: number) => void;
  hourlyEstimate: number;
  manualPrices: ManualPrices;
  setManualPrice: (key: string, value: string) => void;
}) {
  return (
    <>
      <h2>{value.monster.name}</h2>
      <div className="metric-grid">
        <div><span>EV / kill</span><strong>{zeny(value.expectedValue)}</strong></div>
        <div><span>Map score</span><strong>{zeny(value.mapScore)}</strong></div>
        <div><span>Best map</span><strong>{value.monster.spawns[0]?.map ?? '-'}</strong></div>
      </div>
      <label>
        Kills per 30 min
        <input type="number" min="0" step="25" value={killsPer30} onChange={(event) => setKillsPer30(Number(event.target.value))} />
      </label>
      <div className="hourly">Estimated zeny/hour: <strong>{zeny(hourlyEstimate)}</strong></div>

      <h3>Drops</h3>
      <div className="drop-list">
        {value.drops.map((drop) => (
          <div className="drop" key={`${drop.itemKey}-${drop.type ?? 'normal'}`}>
            <div>
              <strong>{drop.name}</strong>
              <span>{percent(drop.adjustedChance / 100)} · {drop.price.source}</span>
            </div>
            <div>{zeny(drop.expectedValue)}</div>
            <input placeholder="Manual price" value={manualPrices[drop.itemKey] ?? ''} onChange={(event) => setManualPrice(drop.itemKey, event.target.value)} />
          </div>
        ))}
      </div>

      <h3>Spawns</h3>
      <ul className="spawn-list">
        {value.monster.spawns.map((spawn) => <li key={spawn.map}>{spawn.map}: {spawn.count}</li>)}
      </ul>
    </>
  );
}
