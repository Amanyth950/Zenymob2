import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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

type DataStatus = 'loading' | 'ready' | 'error';
type SortKey = 'expectedValue' | 'mapScore' | 'spawns' | 'level';

function zeny(value: number): string {
  return `${Math.round(value).toLocaleString()}z`;
}

function compactZeny(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) return `${(rounded / 1_000_000).toFixed(rounded >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
  if (Math.abs(rounded) >= 1_000) return `${(rounded / 1_000).toFixed(rounded >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return rounded.toLocaleString();
}

function percentFromChance(chance: number): string {
  return `${(chance / 100).toFixed(2).replace(/\.00$/, '')}%`;
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bestSpawnCount(monster: Monster): number {
  return monster.spawns.reduce((best, spawn) => Math.max(best, spawn.count), 0);
}

function bestSpawnMap(monster: Monster): string {
  return monster.spawns[0]?.map ?? '-';
}

function elementFamily(element: string): string {
  return element.split(' ')[0]?.trim() || 'Unknown';
}

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
  return `${value.toLocaleString()} ${value === 1 ? singular : pluralValue}`;
}

function matchesQuery(value: MonsterValue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const searchable = [
    value.monster.name,
    String(value.monster.id),
    value.monster.element,
    value.monster.race,
    value.monster.size,
    ...value.monster.spawns.map((spawn) => spawn.map),
    ...value.drops.map((drop) => drop.name),
    ...value.drops.map((drop) => String(drop.itemId ?? '')),
  ]
    .join(' ')
    .toLowerCase();

  return searchable.includes(q);
}

function sortValues(values: MonsterValue[], sortBy: SortKey): MonsterValue[] {
  const sorted = [...values];
  if (sortBy === 'mapScore') return sorted.sort((a, b) => b.mapScore - a.mapScore);
  if (sortBy === 'spawns') return sorted.sort((a, b) => bestSpawnCount(b.monster) - bestSpawnCount(a.monster));
  if (sortBy === 'level') return sorted.sort((a, b) => a.monster.level - b.monster.level);
  return sorted.sort((a, b) => b.expectedValue - a.expectedValue);
}

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [manualPrices, setManualPrices] = useState<ManualPrices>(() => loadManualPrices());
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('expectedValue');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [killsPer30, setKillsPer30] = useState(0);
  const [importText, setImportText] = useState('');
  const [dataStatus, setDataStatus] = useState<DataStatus>('loading');
  const [priceMessage, setPriceMessage] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy export');
  const [raceFilter, setRaceFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [elementFilter, setElementFilter] = useState('all');
  const [minEv, setMinEv] = useState('');
  const [minSpawn, setMinSpawn] = useState('');

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

  const raceOptions = useMemo(() => [...new Set(monsters.map((monster) => monster.race).filter(Boolean))].sort(), [monsters]);
  const sizeOptions = useMemo(() => [...new Set(monsters.map((monster) => monster.size).filter(Boolean))].sort(), [monsters]);
  const elementOptions = useMemo(() => [...new Set(monsters.map((monster) => elementFamily(monster.element)).filter(Boolean))].sort(), [monsters]);

  const filtered = useMemo(() => {
    const minEvValue = minEv.trim() === '' ? 0 : parseNumber(minEv);
    const minSpawnValue = minSpawn.trim() === '' ? 0 : parseNumber(minSpawn);

    return sortValues(
      values.filter((value) => {
        const monster = value.monster;
        if (!settings.showBoss && monster.isBoss) return false;
        if (!settings.showMvp && monster.hasMvpDrops) return false;
        if (raceFilter !== 'all' && monster.race !== raceFilter) return false;
        if (sizeFilter !== 'all' && monster.size !== sizeFilter) return false;
        if (elementFilter !== 'all' && elementFamily(monster.element) !== elementFilter) return false;
        if (value.expectedValue < minEvValue) return false;
        if (bestSpawnCount(monster) < minSpawnValue) return false;
        return matchesQuery(value, query);
      }),
      sortBy,
    );
  }, [values, query, settings.showBoss, settings.showMvp, raceFilter, sizeFilter, elementFilter, minEv, minSpawn, sortBy]);

  const selected = useMemo(
    () => filtered.find((value) => value.monster.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const visibleResults = filtered.slice(0, 100);
  const manualPriceCount = Object.keys(manualPrices).length;
  const hourlyEstimate = selected ? selected.expectedValue * killsPer30 * 2 : 0;
  const activeFilterCount = [query, minEv, minSpawn].filter((value) => value.trim() !== '').length
    + [raceFilter, sizeFilter, elementFilter].filter((value) => value !== 'all').length
    + [settings.showBoss, settings.showMvp, settings.poringCoin].filter(Boolean).length;

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  function clearFilters() {
    setQuery('');
    setRaceFilter('all');
    setSizeFilter('all');
    setElementFilter('all');
    setMinEv('');
    setMinSpawn('');
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
      setPriceMessage(`Imported ${plural(Object.keys(imported).length, 'override')}.`);
    } catch {
      setPriceMessage('Import failed. Paste valid Zenymob2 price JSON and try again.');
    }
  }

  async function handleCopyExport() {
    const exported = exportManualPrices(manualPrices);
    try {
      await navigator.clipboard.writeText(exported);
      setCopyLabel('Copied');
      setPriceMessage(`Copied ${plural(manualPriceCount, 'override')} to clipboard.`);
      window.setTimeout(() => setCopyLabel('Copy export'), 1500);
    } catch {
      setImportText(exported);
      setPriceMessage('Clipboard access was blocked, so the export JSON was placed in the import box.');
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Zenymob2</p>
          <h1>Farming mob finder</h1>
        </div>
        <div className="header-stats" aria-label="Dataset summary">
          <span>{dataStatus === 'loading' ? 'Loading data' : dataStatus === 'error' ? 'Data error' : plural(monsters.length, 'mob')}</span>
          <span>{manualPriceCount.toLocaleString()} overrides</span>
        </div>
      </header>

      <section className="panel filters-panel" aria-label="Search and filters">
        <div className="primary-controls">
          <label className="search-control">
            <span>Search</span>
            <input placeholder="Monster, map, item, ID..." value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
              <option value="expectedValue">EV / kill</option>
              <option value="mapScore">Map score</option>
              <option value="spawns">Best-map spawns</option>
              <option value="level">Level</option>
            </select>
          </label>
        </div>

        <div className="quick-filters">
          <label>
            <span>Race</span>
            <select value={raceFilter} onChange={(event) => setRaceFilter(event.target.value)}>
              <option value="all">All races</option>
              {raceOptions.map((race) => <option key={race} value={race}>{race}</option>)}
            </select>
          </label>
          <label>
            <span>Element</span>
            <select value={elementFilter} onChange={(event) => setElementFilter(event.target.value)}>
              <option value="all">All elements</option>
              {elementOptions.map((element) => <option key={element} value={element}>{element}</option>)}
            </select>
          </label>
          <label>
            <span>Size</span>
            <select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}>
              <option value="all">All sizes</option>
              {sizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <label>
            <span>Min EV</span>
            <input inputMode="numeric" placeholder="0" value={minEv} onChange={(event) => setMinEv(event.target.value)} />
          </label>
          <label>
            <span>Min spawns</span>
            <input inputMode="numeric" placeholder="0" value={minSpawn} onChange={(event) => setMinSpawn(event.target.value)} />
          </label>
        </div>

        <div className="switch-strip" aria-label="Common toggles">
          <Toggle checked={settings.uaro} label="UARO" onChange={(checked) => updateSetting('uaro', checked)} />
          <Toggle checked={settings.overcharge} label="Overcharge" onChange={(checked) => updateSetting('overcharge', checked)} />
          <Toggle checked={settings.poringCoin} label="Poring Coin" onChange={(checked) => updateSetting('poringCoin', checked)} />
          <Toggle checked={settings.showBoss} label="Bosses" onChange={(checked) => updateSetting('showBoss', checked)} />
          <Toggle checked={settings.showMvp} label="MVP" onChange={(checked) => updateSetting('showMvp', checked)} />
          <button type="button" className="text-button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</button>
        </div>

        <details className="advanced-controls">
          <summary>Advanced assumptions</summary>
          <div className="advanced-grid">
            <label>
              <span>Drop multiplier</span>
              <input type="number" min="0" step="0.5" value={settings.dropMultiplier} onChange={(event) => updateSetting('dropMultiplier', parseNumber(event.target.value) as Settings['dropMultiplier'])} />
            </label>
            <label>
              <span>Overcharge rate</span>
              <input type="number" min="1" step="0.01" value={settings.overchargeRate} onChange={(event) => updateSetting('overchargeRate', parseNumber(event.target.value, 1) as Settings['overchargeRate'])} />
            </label>
            <label>
              <span>Poring Coin price</span>
              <input type="number" min="0" step="500" value={settings.poringCoinPrice} onChange={(event) => updateSetting('poringCoinPrice', parseNumber(event.target.value) as Settings['poringCoinPrice'])} />
            </label>
            <button type="button" className="secondary-button" onClick={() => { setSettings(DEFAULT_SETTINGS); setKillsPer30(0); }}>Reset assumptions</button>
          </div>
        </details>
      </section>

      <main className="workspace">
        <section className="panel results-panel" aria-label="Monster results">
          <div className="panel-bar">
            <div>
              <strong>{plural(filtered.length, 'mob')}</strong>
              <span>{visibleResults.length < filtered.length ? `Showing top ${visibleResults.length}` : 'All results shown'}</span>
            </div>
            <span>{activeFilterCount} active filters</span>
          </div>

          {dataStatus === 'loading' ? (
            <EmptyState title="Loading monster data" body="Preparing the mob list." />
          ) : dataStatus === 'error' ? (
            <EmptyState title="Dataset unavailable" body="Could not load /data/monsters.json. Generate data before release." tone="danger" />
          ) : visibleResults.length === 0 ? (
            <EmptyState title="No mobs match" body="Loosen the search or filters to broaden the list." action={<button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>} />
          ) : (
            <div className="mob-table">
              <div className="mob-row mob-row--head" aria-hidden="true">
                <span>Mob</span>
                <span>EV / kill</span>
                <span>Map score</span>
                <span>Best map</span>
                <span>Top drops</span>
              </div>
              {visibleResults.map((value) => (
                <MobRow
                  key={value.monster.id}
                  value={value}
                  selected={selected?.monster.id === value.monster.id}
                  onSelect={() => setSelectedId(value.monster.id)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="panel detail-panel" aria-label="Selected monster details">
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
            <EmptyState title="Select a mob" body="Click a result to inspect drops, maps, and hourly EV." />
          )}

          <details className="price-box">
            <summary>Manual prices</summary>
            <p>Overrides are stored in this browser and replace NPC/UARO/conversion values.</p>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste manual price JSON here" />
            <div className="price-actions">
              <button type="button" className="primary-button" onClick={handleImport}>Import</button>
              <button type="button" className="secondary-button" onClick={handleCopyExport}>{copyLabel}</button>
              <button type="button" className="danger-button" onClick={() => { setManualPrices({}); setPriceMessage('Manual prices cleared.'); }}>Clear</button>
            </div>
            {priceMessage ? <p className="status-message">{priceMessage}</p> : null}
          </details>
        </aside>
      </main>
    </div>
  );
}

function Toggle({ checked, label, onChange }: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={checked ? 'toggle is-on' : 'toggle'}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function MobRow({ value, selected, onSelect }: {
  value: MonsterValue;
  selected: boolean;
  onSelect: () => void;
}) {
  const { monster } = value;
  const topDrops = value.topDrops.slice(0, 2).map((drop) => drop.name).join(', ');

  return (
    <button type="button" className={selected ? 'mob-row is-selected' : 'mob-row'} onClick={onSelect} aria-pressed={selected}>
      <span className="mob-cell">
        <strong>{monster.name}</strong>
        <small>ID {monster.id} / Lv {monster.level} / {monster.race} / {monster.element}</small>
      </span>
      <span className="metric-cell">{compactZeny(value.expectedValue)}z</span>
      <span className="metric-cell">{compactZeny(value.mapScore)}z</span>
      <span>{bestSpawnMap(monster)} <small>({bestSpawnCount(monster)})</small></span>
      <span className="drop-preview">{topDrops || 'No valued drops'}</span>
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
    <div className="detail-stack">
      <header className="detail-header">
        <div>
          <p className="eyebrow">Selected mob</p>
          <h2>{monster.name}</h2>
          <span>ID {monster.id} / Lv {monster.level} / {monster.race} / {monster.size} / {monster.element}</span>
        </div>
        {monster.isBoss ? <span className="badge">Boss</span> : null}
      </header>

      <div className="metric-grid">
        <div><span>EV / kill</span><strong>{zeny(value.expectedValue)}</strong></div>
        <div><span>Map score</span><strong>{zeny(value.mapScore)}</strong></div>
        <div><span>Best map</span><strong>{bestSpawnMap(monster)}</strong></div>
      </div>

      <div className="hourly-box">
        <label>
          <span>Kills / 30 min</span>
          <input type="number" min="0" step="25" value={killsPer30} onChange={(event) => setKillsPer30(parseNumber(event.target.value))} />
        </label>
        <div>
          <span>Zeny / hour</span>
          <strong>{zeny(hourlyEstimate)}</strong>
        </div>
      </div>

      <section>
        <div className="section-row">
          <h3>Drops</h3>
          <span>{plural(value.drops.length, 'drop')}</span>
        </div>
        <div className="drops-table">
          {value.drops.map((drop) => (
            <DropRow key={`${drop.itemKey}-${drop.type ?? 'normal'}-${drop.chance}`} drop={drop} manualPrices={manualPrices} setManualPrice={setManualPrice} />
          ))}
        </div>
      </section>

      <section>
        <div className="section-row">
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
    </div>
  );
}

function DropRow({ drop, manualPrices, setManualPrice }: {
  drop: DropValue;
  manualPrices: ManualPrices;
  setManualPrice: (key: string, value: string) => void;
}) {
  return (
    <div className="drop-row">
      <span>
        <strong>{drop.name}</strong>
        <small>{percentFromChance(drop.adjustedChance)} / {drop.price.source}</small>
      </span>
      <span>{zeny(drop.expectedValue)}</span>
      <input aria-label={`Manual price for ${drop.name}`} placeholder="Manual" value={manualPrices[drop.itemKey] ?? ''} onChange={(event) => setManualPrice(drop.itemKey, event.target.value)} />
    </div>
  );
}

function EmptyState({ title, body, tone, action }: {
  title: string;
  body: string;
  tone?: 'danger';
  action?: ReactNode;
}) {
  return (
    <div className={tone === 'danger' ? 'empty-state empty-state--danger' : 'empty-state'}>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
