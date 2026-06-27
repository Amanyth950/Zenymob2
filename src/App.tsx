import { useEffect, useMemo, useState } from 'react';
import { filterValues, sortValues } from './search';
import { exportManualPrices, importManualPrices, loadManualPrices, saveManualPrices } from './storage';
import { valueMonster } from './pricing';
import type { DropValue, ManualPrices, Monster, MonsterValue, Settings } from './types';

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

function compactZeny(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) return `${(rounded / 1_000_000).toFixed(rounded >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}Mz`;
  if (Math.abs(rounded) >= 1_000) return `${(rounded / 1_000).toFixed(rounded >= 100_000 ? 0 : 1).replace(/\.0$/, '')}Kz`;
  return `${rounded.toLocaleString()}z`;
}

function percentFromChance(chance: number): string {
  return `${(chance / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

function numberValue(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bestSpawnCount(monster: Monster): number {
  return monster.spawns.reduce((best, spawn) => Math.max(best, spawn.count), 0);
}

function bestSpawnMap(monster: Monster): string {
  return monster.spawns[0]?.map ?? 'No spawn data';
}

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralValue}`;
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
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [priceMessage, setPriceMessage] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy export JSON');

  useEffect(() => {
    setDataStatus('loading');
    fetch('/data/monsters.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Dataset request failed: ${response.status}`);
        return response.json();
      })
      .then((data: Monster[]) => {
        setMonsters(data);
        setDataStatus('ready');
      })
      .catch(() => {
        setMonsters([]);
        setDataStatus('error');
      });
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

  const selected = useMemo(
    () => filtered.find((value) => value.monster.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const shownValues = filtered.slice(0, 100);
  const manualPriceCount = Object.keys(manualPrices).length;
  const bossCount = monsters.filter((monster) => monster.isBoss).length;
  const hourlyEstimate = selected ? selected.expectedValue * killsPer30 * 2 : 0;

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  function setManualPrice(key: string, rawValue: string) {
    setPriceMessage('');
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
      const imported = importManualPrices(importText);
      setManualPrices(imported);
      setImportText('');
      setPriceMessage(`Imported ${plural(Object.keys(imported).length, 'price override')}.`);
    } catch {
      setPriceMessage('Import failed. Paste valid Zenymob2 price JSON and try again.');
    }
  }

  async function handleCopyExport() {
    const exported = exportManualPrices(manualPrices);
    try {
      await navigator.clipboard.writeText(exported);
      setCopyLabel('Copied');
      setPriceMessage(`Exported ${plural(manualPriceCount, 'price override')}.`);
      window.setTimeout(() => setCopyLabel('Copy export JSON'), 1600);
    } catch {
      setImportText(exported);
      setPriceMessage('Clipboard access was blocked, so the export JSON was placed in the import box.');
    }
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    setKillsPer30(0);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Zenymob2 home">
          <span className="brand-mark">Z2</span>
          <span>
            <strong>Zenymob2</strong>
            <small>Farming value planner</small>
          </span>
        </a>
        <nav className="topnav" aria-label="Product navigation">
          <a href="#planner">Planner</a>
          <a href="#prices">Prices</a>
          <a href="#drops">Drops</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Pre-renewal Ragnarok farming intelligence</p>
          <h1>Find the mobs worth your time.</h1>
          <p>
            Compare expected zeny per kill, map density, server-specific item prices, and manual market overrides in one static, browser-native planner.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#planner">Start planning</a>
            <a className="secondary-action" href="#prices">Manage prices</a>
          </div>
        </div>
        <div className="hero-card" aria-label="Dataset summary">
          <span className="hero-card__label">Dataset</span>
          <strong>{dataStatus === 'loading' ? 'Loading' : monsters.length.toLocaleString()}</strong>
          <span>{dataStatus === 'ready' ? 'monsters indexed' : dataStatus === 'error' ? 'dataset unavailable' : 'loading monsters'}</span>
          <div className="hero-card__grid">
            <div><strong>{bossCount.toLocaleString()}</strong><span>Boss flagged</span></div>
            <div><strong>{manualPriceCount.toLocaleString()}</strong><span>Overrides</span></div>
          </div>
        </div>
      </section>

      <main className="dashboard" id="planner">
        <aside className="control-rail" aria-label="Planner assumptions">
          <section className="panel control-panel">
            <div className="panel-heading">
              <span className="section-kicker">Controls</span>
              <h2>Assumptions</h2>
              <p>Tune server rules and personal pricing before comparing monsters.</p>
            </div>

            <div className="control-group">
              <label>
                <span>Drop multiplier</span>
                <input type="number" min="0" step="0.5" value={settings.dropMultiplier} onChange={(event) => updateSetting('dropMultiplier', numberValue(event.target.value) as Settings['dropMultiplier'])} />
              </label>
              <label>
                <span>Overcharge rate</span>
                <input type="number" min="1" step="0.01" value={settings.overchargeRate} onChange={(event) => updateSetting('overchargeRate', numberValue(event.target.value, 1) as Settings['overchargeRate'])} />
              </label>
              <label>
                <span>Poring Coin price</span>
                <input type="number" min="0" step="500" value={settings.poringCoinPrice} onChange={(event) => updateSetting('poringCoinPrice', numberValue(event.target.value) as Settings['poringCoinPrice'])} />
              </label>
            </div>

            <div className="toggle-list">
              <label className="toggle-row">
                <input type="checkbox" checked={settings.overcharge} onChange={(event) => updateSetting('overcharge', event.target.checked)} />
                <span><strong>Merchant Overcharge</strong><small>Apply sell-price multiplier where allowed.</small></span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.uaro} onChange={(event) => updateSetting('uaro', event.target.checked)} />
                <span><strong>UARO prices</strong><small>Use known server prices and conversions.</small></span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.poringCoin} onChange={(event) => updateSetting('poringCoin', event.target.checked)} />
                <span><strong>Include Poring Coin</strong><small>Add optional custom EV to every monster.</small></span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.showBoss} onChange={(event) => updateSetting('showBoss', event.target.checked)} />
                <span><strong>Show boss-flagged mobs</strong><small>Include monsters marked with the boss flag.</small></span>
              </label>
              <label className="toggle-row">
                <input type="checkbox" checked={settings.showMvp} onChange={(event) => updateSetting('showMvp', event.target.checked)} />
                <span><strong>Show MVP monsters and drops</strong><small>Include MVP entries and MVP-only loot.</small></span>
              </label>
            </div>

            <button className="ghost-button" type="button" onClick={resetSettings}>Reset defaults</button>
          </section>
        </aside>

        <section className="workbench">
          <section className="panel search-panel">
            <div>
              <span className="section-kicker">Monster search</span>
              <h2>Compare farming targets</h2>
            </div>
            <div className="toolbar">
              <label className="search-field">
                <span>Search monsters, maps, items, IDs</span>
                <input placeholder="Try Sleeper, yuno_fild06, Great Nature..." value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <label>
                <span>Sort by</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                  <option value="expectedValue">Expected value</option>
                  <option value="mapScore">Map score</option>
                  <option value="spawns">Best-map spawns</option>
                  <option value="level">Level</option>
                </select>
              </label>
            </div>
            <div className="result-summary">
              <span>{plural(filtered.length, 'match', 'matches')}</span>
              <span>{shownValues.length < filtered.length ? `Showing top ${shownValues.length}` : 'All matching results shown'}</span>
            </div>
          </section>

          {dataStatus === 'loading' ? (
            <section className="panel empty-state">
              <span className="loader" aria-hidden="true" />
              <h2>Loading monster data</h2>
              <p>The planner is preparing the dataset and pricing model.</p>
            </section>
          ) : dataStatus === 'error' ? (
            <section className="panel empty-state empty-state--danger">
              <h2>Dataset unavailable</h2>
              <p>Could not load <code>/data/monsters.json</code>. Generate the dataset and rebuild before release.</p>
            </section>
          ) : shownValues.length === 0 ? (
            <section className="panel empty-state">
              <h2>No matching monsters</h2>
              <p>Clear the search or enable boss/MVP filters to expand the result set.</p>
              <button className="ghost-button" type="button" onClick={() => setQuery('')}>Clear search</button>
            </section>
          ) : (
            <section className="results-grid" aria-label="Monster results">
              {shownValues.map((value, index) => (
                <MonsterResultCard
                  key={value.monster.id}
                  value={value}
                  rank={index + 1}
                  active={selected?.monster.id === value.monster.id}
                  onSelect={() => setSelectedId(value.monster.id)}
                />
              ))}
            </section>
          )}
        </section>

        <aside className="inspector" id="drops">
          <section className="panel detail-panel">
            {selected ? (
              <MonsterDetail
                value={selected}
                killsPer30={killsPer30}
                setKillsPer30={setKillsPer30}
                hourlyEstimate={hourlyEstimate}
                manualPrices={manualPrices}
                setManualPrice={setManualPrice}
              />
            ) : (
              <div className="empty-state empty-state--compact">
                <h2>Select a monster</h2>
                <p>Choose a result to inspect drops, spawns, and zeny/hour.</p>
              </div>
            )}
          </section>
        </aside>
      </main>

      <section className="panel prices-panel" id="prices">
        <div className="panel-heading prices-heading">
          <div>
            <span className="section-kicker">Market controls</span>
            <h2>Manual prices</h2>
            <p>Override NPC, UARO, and conversion prices. Overrides are stored locally in this browser.</p>
          </div>
          <span className="price-count">{plural(manualPriceCount, 'override')}</span>
        </div>
        <div className="price-tools">
          <label>
            <span>Import or stage export JSON</span>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste manual price JSON here" />
          </label>
          <div className="price-actions">
            <button type="button" className="primary-button" onClick={handleImport}>Import prices</button>
            <button type="button" className="secondary-button" onClick={handleCopyExport}>{copyLabel}</button>
            <button type="button" className="danger-button" onClick={() => { setManualPrices({}); setPriceMessage('Manual prices cleared.'); }}>Clear overrides</button>
          </div>
          {priceMessage ? <p className="status-message">{priceMessage}</p> : null}
        </div>
      </section>
    </div>
  );
}

function MonsterResultCard({ value, rank, active, onSelect }: {
  value: MonsterValue;
  rank: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { monster } = value;
  const topDrops = value.topDrops.slice(0, 3);

  return (
    <button className={active ? 'monster-card monster-card--active' : 'monster-card'} type="button" onClick={onSelect} aria-pressed={active}>
      <div className="monster-card__topline">
        <span className="rank">#{rank}</span>
        <span className={monster.isBoss ? 'badge badge--warning' : 'badge'}>{monster.isBoss ? 'Boss' : 'Regular'}</span>
      </div>
      <div className="monster-card__identity">
        <strong>{monster.name}</strong>
        <span>ID {monster.id} / Lv {monster.level} / {monster.element}</span>
      </div>
      <div className="monster-card__metrics">
        <div><span>EV / kill</span><strong>{compactZeny(value.expectedValue)}</strong></div>
        <div><span>Map score</span><strong>{compactZeny(value.mapScore)}</strong></div>
        <div><span>Best map</span><strong>{bestSpawnMap(monster)}</strong></div>
      </div>
      <div className="chip-row">
        <span>{monster.race}</span>
        <span>{monster.size}</span>
        <span>{plural(bestSpawnCount(monster), 'spawn')}</span>
      </div>
      {topDrops.length > 0 ? (
        <div className="top-drops">
          {topDrops.map((drop) => <span key={`${drop.itemKey}-${drop.type ?? 'normal'}`}>{drop.name}</span>)}
        </div>
      ) : <span className="muted">No valued drops</span>}
    </button>
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
  const { monster } = value;

  return (
    <>
      <div className="detail-header">
        <span className="section-kicker">Selected target</span>
        <h2>{monster.name}</h2>
        <p>ID {monster.id} / Lv {monster.level} / {monster.race} / {monster.size} / {monster.element}</p>
      </div>

      <div className="metric-grid">
        <div><span>EV / kill</span><strong>{zeny(value.expectedValue)}</strong></div>
        <div><span>Map score</span><strong>{zeny(value.mapScore)}</strong></div>
        <div><span>Best map</span><strong>{bestSpawnMap(monster)}</strong></div>
      </div>

      <label className="kills-input">
        <span>Kills per 30 minutes</span>
        <input type="number" min="0" step="25" value={killsPer30} onChange={(event) => setKillsPer30(numberValue(event.target.value))} />
      </label>
      <div className="hourly-card">
        <span>Estimated zeny/hour</span>
        <strong>{zeny(hourlyEstimate)}</strong>
        <small>Based on current EV and kill pace.</small>
      </div>

      <section className="detail-section">
        <div className="section-title-row">
          <h3>Drops</h3>
          <span>{plural(value.drops.length, 'drop')}</span>
        </div>
        <div className="drop-list">
          {value.drops.map((drop) => (
            <DropRow key={`${drop.itemKey}-${drop.type ?? 'normal'}-${drop.chance}`} drop={drop} manualPrices={manualPrices} setManualPrice={setManualPrice} />
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-title-row">
          <h3>Spawns</h3>
          <span>{plural(monster.spawns.length, 'map')}</span>
        </div>
        {monster.spawns.length > 0 ? (
          <div className="spawn-list">
            {monster.spawns.map((spawn) => (
              <div className="spawn-row" key={spawn.map}>
                <span>{spawn.map}</span>
                <strong>{spawn.count.toLocaleString()}</strong>
              </div>
            ))}
          </div>
        ) : <p className="muted">No permanent spawn data available.</p>}
      </section>
    </>
  );
}

function DropRow({ drop, manualPrices, setManualPrice }: {
  drop: DropValue;
  manualPrices: ManualPrices;
  setManualPrice: (key: string, value: string) => void;
}) {
  return (
    <article className="drop-card">
      <div className="drop-card__main">
        <strong>{drop.name}</strong>
        <span>{percentFromChance(drop.adjustedChance)} chance / {drop.price.source}</span>
      </div>
      <div className="drop-card__value">
        <strong>{zeny(drop.expectedValue)}</strong>
        <span>{zeny(drop.price.activePrice)} each</span>
      </div>
      <label className="manual-price-field">
        <span>Manual price</span>
        <input placeholder="Override" value={manualPrices[drop.itemKey] ?? ''} onChange={(event) => setManualPrice(drop.itemKey, event.target.value)} />
      </label>
    </article>
  );
}
