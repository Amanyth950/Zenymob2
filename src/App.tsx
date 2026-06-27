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
type SortKey = 'expectedValue' | 'mapScore' | 'spawns' | 'level' | 'hp' | 'name';
type TabKey = 'farms' | 'maps' | 'items' | 'raw';

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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function matchesText(value: MonsterValue, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    value.monster.name,
    String(value.monster.id),
    value.monster.element,
    value.monster.race,
    value.monster.size,
    ...value.monster.spawns.map((spawn) => spawn.map),
    ...value.drops.map((drop) => drop.name),
    ...value.drops.map((drop) => String(drop.itemId ?? '')),
  ].join(' ').toLowerCase().includes(q);
}

function sortValues(values: MonsterValue[], sortBy: SortKey, ascending: boolean): MonsterValue[] {
  const dir = ascending ? 1 : -1;
  const sorted = [...values];
  if (sortBy === 'mapScore') return sorted.sort((a, b) => (a.mapScore - b.mapScore) * dir);
  if (sortBy === 'spawns') return sorted.sort((a, b) => (bestSpawnCount(a.monster) - bestSpawnCount(b.monster)) * dir);
  if (sortBy === 'level') return sorted.sort((a, b) => (a.monster.level - b.monster.level) * dir);
  if (sortBy === 'hp') return sorted.sort((a, b) => (a.monster.hp - b.monster.hp) * dir);
  if (sortBy === 'name') return sorted.sort((a, b) => a.monster.name.localeCompare(b.monster.name) * dir);
  return sorted.sort((a, b) => (a.expectedValue - b.expectedValue) * dir);
}

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [manualPrices, setManualPrices] = useState<ManualPrices>(() => loadManualPrices());
  const [activeTab, setActiveTab] = useState<TabKey>('farms');
  const [query, setQuery] = useState('');
  const [mapQuery, setMapQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('expectedValue');
  const [ascending, setAscending] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [killsPer30, setKillsPer30] = useState(0);
  const [importText, setImportText] = useState('');
  const [dataStatus, setDataStatus] = useState<DataStatus>('loading');
  const [priceMessage, setPriceMessage] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy export');
  const [raceFilter, setRaceFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [elementFilter, setElementFilter] = useState('all');
  const [minEv, setMinEv] = useState('');
  const [levelMin, setLevelMin] = useState('');
  const [levelMax, setLevelMax] = useState('');
  const [spawnMin, setSpawnMin] = useState('');
  const [spawnMax, setSpawnMax] = useState('');
  const [itemQuery, setItemQuery] = useState('');

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

  const values = useMemo(() => monsters.map((monster) => valueMonster(monster, settings, manualPrices)), [monsters, settings, manualPrices]);
  const levelBounds = useMemo(() => ({ min: Math.min(...monsters.map((m) => m.level), 0), max: Math.max(...monsters.map((m) => m.level), 0) }), [monsters]);
  const spawnBounds = useMemo(() => ({ min: Math.min(...monsters.map(bestSpawnCount), 0), max: Math.max(...monsters.map(bestSpawnCount), 0) }), [monsters]);
  const raceOptions = useMemo(() => [...new Set(monsters.map((monster) => monster.race).filter(Boolean))].sort(), [monsters]);
  const sizeOptions = useMemo(() => [...new Set(monsters.map((monster) => monster.size).filter(Boolean))].sort(), [monsters]);
  const elementOptions = useMemo(() => [...new Set(monsters.map((monster) => elementFamily(monster.element)).filter(Boolean))].sort(), [monsters]);

  const filtered = useMemo(() => {
    const minEvValue = minEv.trim() === '' ? 0 : parseNumber(minEv);
    const lowLevel = Math.min(levelMin === '' ? levelBounds.min : parseNumber(levelMin), levelMax === '' ? levelBounds.max : parseNumber(levelMax));
    const highLevel = Math.max(levelMin === '' ? levelBounds.min : parseNumber(levelMin), levelMax === '' ? levelBounds.max : parseNumber(levelMax));
    const lowSpawn = Math.min(spawnMin === '' ? spawnBounds.min : parseNumber(spawnMin), spawnMax === '' ? spawnBounds.max : parseNumber(spawnMax));
    const highSpawn = Math.max(spawnMin === '' ? spawnBounds.min : parseNumber(spawnMin), spawnMax === '' ? spawnBounds.max : parseNumber(spawnMax));
    const mapQ = mapQuery.trim().toLowerCase();

    return sortValues(values.filter((value) => {
      const monster = value.monster;
      const spawnCount = bestSpawnCount(monster);
      if (!settings.showBoss && monster.isBoss) return false;
      if (!settings.showMvp && monster.hasMvpDrops) return false;
      if (raceFilter !== 'all' && monster.race !== raceFilter) return false;
      if (sizeFilter !== 'all' && monster.size !== sizeFilter) return false;
      if (elementFilter !== 'all' && elementFamily(monster.element) !== elementFilter) return false;
      if (monster.level < lowLevel || monster.level > highLevel) return false;
      if (spawnCount < lowSpawn || spawnCount > highSpawn) return false;
      if (value.expectedValue < minEvValue) return false;
      if (mapQ && !monster.spawns.some((spawn) => spawn.map.toLowerCase().includes(mapQ))) return false;
      return matchesText(value, query);
    }), sortBy, ascending);
  }, [values, query, mapQuery, settings.showBoss, settings.showMvp, raceFilter, sizeFilter, elementFilter, minEv, levelMin, levelMax, spawnMin, spawnMax, levelBounds, spawnBounds, sortBy, ascending]);

  const selected = useMemo(() => filtered.find((value) => value.monster.id === selectedId) ?? filtered[0] ?? null, [filtered, selectedId]);
  const visibleResults = filtered.slice(0, 100);
  const manualPriceCount = Object.keys(manualPrices).length;
  const hourlyEstimate = selected ? selected.expectedValue * killsPer30 * 2 : 0;
  const activeFilterCount = [query, mapQuery, minEv, levelMin, levelMax, spawnMin, spawnMax].filter((value) => value.trim() !== '').length
    + [raceFilter, sizeFilter, elementFilter].filter((value) => value !== 'all').length
    + [settings.showBoss, settings.showMvp, settings.poringCoin].filter(Boolean).length;

  const mapRows = useMemo(() => filtered.flatMap((value) => value.monster.spawns.map((spawn) => ({ map: spawn.map, value, count: spawn.count, score: value.expectedValue * spawn.count }))), [filtered]);
  const maps = useMemo(() => {
    const grouped = new Map<string, typeof mapRows>();
    for (const row of mapRows) grouped.set(row.map, [...(grouped.get(row.map) ?? []), row]);
    return [...grouped.entries()].map(([map, rows]) => {
      const best = [...rows].sort((a, b) => b.score - a.score)[0];
      const evs = rows.map((row) => row.value.expectedValue);
      return { map, rows, mobs: new Set(rows.map((row) => row.value.monster.id)).size, spawns: rows.reduce((sum, row) => sum + row.count, 0), score: rows.reduce((sum, row) => sum + row.score, 0), averageEv: evs.reduce((sum, ev) => sum + ev, 0) / Math.max(evs.length, 1), bestEv: Math.max(...evs, 0), bestMob: best?.value.monster.name ?? '-' };
    }).sort((a, b) => b.score - a.score);
  }, [mapRows]);
  const selectedMapData = selectedMap ? maps.find((map) => map.map === selectedMap) ?? maps[0] : maps[0];

  const items = useMemo(() => {
    const catalog = new Map<string, { key: string; name: string; itemId?: number; active: number; base: number; source: string; usedBy: Set<number>; examples: string[] }>();
    for (const value of values) {
      for (const drop of value.drops) {
        const key = drop.itemKey || drop.name;
        const row = catalog.get(key);
        if (row) {
          row.usedBy.add(value.monster.id);
          if (row.examples.length < 3 && !row.examples.includes(value.monster.name)) row.examples.push(value.monster.name);
          if (drop.price.activePrice > row.active) {
            row.active = drop.price.activePrice;
            row.base = drop.price.basePrice;
            row.source = drop.price.source;
          }
        } else {
          catalog.set(key, { key, name: drop.name, itemId: drop.itemId, active: drop.price.activePrice, base: drop.price.basePrice, source: drop.price.source, usedBy: new Set([value.monster.id]), examples: [value.monster.name] });
        }
      }
    }
    const q = itemQuery.trim().toLowerCase();
    return [...catalog.values()].filter((item) => !q || [item.name, item.key, String(item.itemId ?? ''), ...item.examples].join(' ').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
  }, [values, itemQuery]);

  const metrics = {
    highestEv: Math.max(...filtered.map((value) => value.expectedValue), 0),
    medianEv: median(filtered.map((value) => value.expectedValue)),
    highestMapScore: Math.max(...filtered.map((value) => value.mapScore), 0),
  };

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  function clearFilters() {
    setQuery(''); setMapQuery(''); setRaceFilter('all'); setSizeFilter('all'); setElementFilter('all'); setMinEv(''); setLevelMin(''); setLevelMax(''); setSpawnMin(''); setSpawnMax('');
  }

  function setManualPrice(key: string, rawValue: string) {
    setPriceMessage('');
    setManualPrices((previous) => {
      const next = { ...previous };
      if (rawValue.trim() === '') delete next[key];
      else {
        const price = Number(rawValue);
        if (Number.isFinite(price) && price >= 0) next[key] = price;
      }
      return next;
    });
  }

  function handleImport(replace = true) {
    try {
      const imported = importManualPrices(importText);
      setManualPrices((previous) => replace ? imported : { ...previous, ...imported });
      setImportText('');
      setPriceMessage(`${replace ? 'Imported' : 'Merged'} ${plural(Object.keys(imported).length, 'override')}.`);
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
        <div><p className="eyebrow">Zenymob2</p><h1>Farming mob finder</h1></div>
        <div className="header-stats"><span>{dataStatus === 'loading' ? 'Loading data' : dataStatus === 'error' ? 'Data error' : plural(monsters.length, 'mob')}</span><span>{manualPriceCount.toLocaleString()} overrides</span></div>
      </header>

      <section className="panel filters-panel">
        <div className="primary-controls">
          <label className="search-control"><span>Search all</span><input placeholder="Monster, item, ID..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="search-control"><span>Map contains</span><input placeholder="pay_fild, gef_dun..." value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} /></label>
          <label><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}><option value="expectedValue">EV / kill</option><option value="mapScore">Map score</option><option value="spawns">Best-map spawns</option><option value="level">Level</option><option value="hp">HP</option><option value="name">Monster name</option></select></label>
          <Toggle checked={ascending} label="Ascending" onChange={setAscending} />
        </div>
        <div className="quick-filters">
          <label><span>Race</span><select value={raceFilter} onChange={(event) => setRaceFilter(event.target.value)}><option value="all">All races</option>{raceOptions.map((race) => <option key={race} value={race}>{race}</option>)}</select></label>
          <label><span>Element</span><select value={elementFilter} onChange={(event) => setElementFilter(event.target.value)}><option value="all">All elements</option>{elementOptions.map((element) => <option key={element} value={element}>{element}</option>)}</select></label>
          <label><span>Size</span><select value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}><option value="all">All sizes</option>{sizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <label><span>Min EV</span><input inputMode="numeric" placeholder="0" value={minEv} onChange={(event) => setMinEv(event.target.value)} /></label>
        </div>
        <div className="switch-strip"><Toggle checked={settings.uaro} label="UARO" onChange={(checked) => updateSetting('uaro', checked)} /><Toggle checked={settings.overcharge} label="Overcharge" onChange={(checked) => updateSetting('overcharge', checked)} /><Toggle checked={settings.poringCoin} label="Poring Coin" onChange={(checked) => updateSetting('poringCoin', checked)} /><Toggle checked={settings.showBoss} label="Bosses" onChange={(checked) => updateSetting('showBoss', checked)} /><Toggle checked={settings.showMvp} label="MVP" onChange={(checked) => updateSetting('showMvp', checked)} /><button type="button" className="text-button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</button></div>
        <details className="advanced-controls"><summary>Advanced filters and assumptions</summary><div className="range-grid"><RangeControl label="Level" min={levelBounds.min} max={levelBounds.max} low={levelMin === '' ? levelBounds.min : parseNumber(levelMin)} high={levelMax === '' ? levelBounds.max : parseNumber(levelMax)} onLowChange={(value) => setLevelMin(String(value))} onHighChange={(value) => setLevelMax(String(value))} /><RangeControl label="Best-map spawns" min={spawnBounds.min} max={spawnBounds.max} low={spawnMin === '' ? spawnBounds.min : parseNumber(spawnMin)} high={spawnMax === '' ? spawnBounds.max : parseNumber(spawnMax)} onLowChange={(value) => setSpawnMin(String(value))} onHighChange={(value) => setSpawnMax(String(value))} /></div><div className="advanced-grid"><label><span>Drop multiplier</span><input type="number" min="0" step="0.5" value={settings.dropMultiplier} onChange={(event) => updateSetting('dropMultiplier', parseNumber(event.target.value) as Settings['dropMultiplier'])} /></label><label><span>Overcharge rate</span><input type="number" min="1" step="0.01" value={settings.overchargeRate} onChange={(event) => updateSetting('overchargeRate', parseNumber(event.target.value, 1) as Settings['overchargeRate'])} /></label><label><span>Poring Coin price</span><input type="number" min="0" step="500" value={settings.poringCoinPrice} onChange={(event) => updateSetting('poringCoinPrice', parseNumber(event.target.value) as Settings['poringCoinPrice'])} /></label><button type="button" className="secondary-button" onClick={() => { setSettings(DEFAULT_SETTINGS); setKillsPer30(0); }}>Reset assumptions</button></div></details>
      </section>

      <section className="metrics-grid"><Metric label="Matching mobs" value={filtered.length.toLocaleString()} /><Metric label="Highest EV" value={compactZeny(metrics.highestEv)} /><Metric label="Median EV" value={compactZeny(metrics.medianEv)} /><Metric label="Highest map score" value={compactZeny(metrics.highestMapScore)} /><Metric label="Price profile" value={settings.uaro ? 'UARO' : 'NPC'} /><Metric label="Manual prices" value={manualPriceCount.toLocaleString()} /></section>
      <nav className="tab-bar"><Tab active={activeTab === 'farms'} onClick={() => setActiveTab('farms')}>Best farms</Tab><Tab active={activeTab === 'maps'} onClick={() => setActiveTab('maps')}>Maps</Tab><Tab active={activeTab === 'items'} onClick={() => setActiveTab('items')}>Items</Tab><Tab active={activeTab === 'raw'} onClick={() => setActiveTab('raw')}>Raw data</Tab></nav>
      <Help tab={activeTab} />

      {activeTab === 'farms' ? <main className="workspace"><section className="panel results-panel"><div className="panel-bar"><div><strong>{plural(filtered.length, 'mob')}</strong><span>{visibleResults.length < filtered.length ? `Showing top ${visibleResults.length}` : 'All results shown'}</span></div><span>{activeFilterCount} active filters</span></div><MonsterResults dataStatus={dataStatus} values={visibleResults} selectedId={selected?.monster.id ?? null} clearFilters={clearFilters} onSelect={setSelectedId} /></section><aside className="panel detail-panel">{selected ? <MonsterDetail value={selected} killsPer30={killsPer30} setKillsPer30={setKillsPer30} hourlyEstimate={hourlyEstimate} manualPrices={manualPrices} setManualPrice={setManualPrice} /> : <EmptyState title="Select a mob" body="Click a result to inspect drops, maps, and hourly EV." />}<PriceBox importText={importText} setImportText={setImportText} priceMessage={priceMessage} copyLabel={copyLabel} manualPriceCount={manualPriceCount} onImport={handleImport} onCopy={handleCopyExport} onClear={() => { setManualPrices({}); setPriceMessage('Manual prices cleared.'); }} /></aside></main> : null}
      {activeTab === 'maps' ? <MapsView maps={maps} selectedMap={selectedMapData?.map ?? null} onSelectMap={setSelectedMap} /> : null}
      {activeTab === 'items' ? <ItemsView items={items} itemQuery={itemQuery} setItemQuery={setItemQuery} manualPrices={manualPrices} setManualPrice={setManualPrice} importText={importText} setImportText={setImportText} priceMessage={priceMessage} copyLabel={copyLabel} manualPriceCount={manualPriceCount} onImport={handleImport} onCopy={handleCopyExport} onClear={() => { setManualPrices({}); setPriceMessage('Manual prices cleared.'); }} /> : null}
      {activeTab === 'raw' ? <RawView values={filtered} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button type="button" className={active ? 'tab-button is-active' : 'tab-button'} onClick={onClick}>{children}</button>; }
function Help({ tab }: { tab: TabKey }) { const text = { farms: 'Best farms is the main mob table. EV is recalculated from current pricing assumptions. Map score is EV multiplied by best-map spawns.', maps: 'Maps groups matching mobs by parsed spawn map. Use it when you want to start from a location.', items: 'Items lets you inspect active prices and edit manual market overrides.', raw: 'Raw data is an audit view of the generated browser dataset after current filters.' }[tab]; return <details className="help-panel"><summary>Help / explanations</summary><p>{text}</p></details>; }

function RangeControl({ label, min, max, low, high, onLowChange, onHighChange }: { label: string; min: number; max: number; low: number; high: number; onLowChange: (value: number) => void; onHighChange: (value: number) => void }) {
  return <div className="range-control"><div className="range-header"><strong>{label}</strong><span>{Math.min(low, high).toLocaleString()} - {Math.max(low, high).toLocaleString()}</span></div><label><span>Min</span><input type="range" min={min} max={max} value={low} onChange={(event) => onLowChange(Number(event.target.value))} /></label><label><span>Max</span><input type="range" min={min} max={max} value={high} onChange={(event) => onHighChange(Number(event.target.value))} /></label></div>;
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className={checked ? 'toggle is-on' : 'toggle'}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function MonsterResults({ dataStatus, values, selectedId, clearFilters, onSelect }: { dataStatus: DataStatus; values: MonsterValue[]; selectedId: number | null; clearFilters: () => void; onSelect: (id: number) => void }) {
  if (dataStatus === 'loading') return <EmptyState title="Loading monster data" body="Preparing the mob list." />;
  if (dataStatus === 'error') return <EmptyState title="Dataset unavailable" body="Could not load /data/monsters.json. Generate data before release." tone="danger" />;
  if (!values.length) return <EmptyState title="No mobs match" body="Loosen the search or filters to broaden the list." action={<button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>} />;
  return <div className="mob-table"><div className="mob-row mob-row--head"><span>Mob</span><span>EV / kill</span><span>Map score</span><span>Best map</span><span>Top drops</span></div>{values.map((value) => <MobRow key={value.monster.id} value={value} selected={selectedId === value.monster.id} onSelect={() => onSelect(value.monster.id)} />)}</div>;
}

function MobRow({ value, selected, onSelect }: { value: MonsterValue; selected: boolean; onSelect: () => void }) {
  const topDrops = value.topDrops.slice(0, 2).map((drop) => `${drop.name} ${drop.share.toFixed(0)}%`).join(', ');
  return <button type="button" className={selected ? 'mob-row is-selected' : 'mob-row'} onClick={onSelect}><span className="mob-cell"><strong>{value.monster.name}</strong><small>ID {value.monster.id} / Lv {value.monster.level} / HP {value.monster.hp.toLocaleString()} / {value.monster.race} / {value.monster.element}</small></span><span className="metric-cell">{compactZeny(value.expectedValue)}z</span><span className="metric-cell">{compactZeny(value.mapScore)}z</span><span>{bestSpawnMap(value.monster)} <small>({bestSpawnCount(value.monster)})</small></span><span className="drop-preview">{topDrops || 'No valued drops'}</span></button>;
}

function MonsterDetail({ value, killsPer30, setKillsPer30, hourlyEstimate, manualPrices, setManualPrice }: { value: MonsterValue; killsPer30: number; setKillsPer30: (value: number) => void; hourlyEstimate: number; manualPrices: ManualPrices; setManualPrice: (key: string, value: string) => void }) {
  const capped = value.drops.filter((drop) => drop.adjustedChance >= 10000).length;
  return <div className="detail-stack"><header className="detail-header"><div><p className="eyebrow">Selected mob</p><h2>{value.monster.name}</h2><span>ID {value.monster.id} / Lv {value.monster.level} / HP {value.monster.hp.toLocaleString()} / {value.monster.race} / {value.monster.size} / {value.monster.element}</span></div>{value.monster.isBoss ? <span className="badge">Boss</span> : null}</header><div className="metric-grid"><div><span>EV / kill</span><strong>{zeny(value.expectedValue)}</strong></div><div><span>Map score</span><strong>{zeny(value.mapScore)}</strong></div><div><span>Best map</span><strong>{bestSpawnMap(value.monster)}</strong></div></div><div className="hourly-box"><label><span>Kills / 30 min</span><input type="number" min="0" step="25" value={killsPer30} onChange={(event) => setKillsPer30(parseNumber(event.target.value))} /></label><div><span>Zeny / hour</span><strong>{zeny(hourlyEstimate)}</strong></div></div><p className="detail-note">Main value: {value.topDrops.slice(0, 5).map((drop) => `${drop.name} ${drop.share.toFixed(0)}%`).join(', ') || '-'} / capped drops: {capped}</p><section><div className="section-row"><h3>Drops</h3><span>{plural(value.drops.length, 'drop')}</span></div><div className="drops-table">{value.drops.map((drop) => <DropRow key={`${drop.itemKey}-${drop.type ?? 'normal'}-${drop.chance}`} drop={drop} manualPrices={manualPrices} setManualPrice={setManualPrice} />)}</div></section><section><div className="section-row"><h3>Spawns</h3><span>{plural(value.monster.spawns.length, 'map')}</span></div><div className="spawn-list">{value.monster.spawns.map((spawn) => <div className="spawn-row" key={spawn.map}><span>{spawn.map}</span><strong>{spawn.count.toLocaleString()}</strong></div>)}</div></section></div>;
}

function DropRow({ drop, manualPrices, setManualPrice }: { drop: DropValue; manualPrices: ManualPrices; setManualPrice: (key: string, value: string) => void }) {
  return <div className="drop-row"><span><strong>{drop.name}</strong><small>{percentFromChance(drop.adjustedChance)} / {drop.price.source} / {drop.type ?? 'normal'}</small></span><span>{zeny(drop.expectedValue)}</span><input aria-label={`Manual price for ${drop.name}`} placeholder="Manual" value={manualPrices[drop.itemKey] ?? ''} onChange={(event) => setManualPrice(drop.itemKey, event.target.value)} /></div>;
}

function MapsView({ maps, selectedMap, onSelectMap }: { maps: { map: string; rows: { value: MonsterValue; count: number; score: number }[]; mobs: number; spawns: number; score: number; bestMob: string }[]; selectedMap: string | null; onSelectMap: (map: string) => void }) {
  const selected = selectedMap ? maps.find((map) => map.map === selectedMap) ?? maps[0] : maps[0];
  if (!maps.length) return <section className="panel"><EmptyState title="No map data" body="No spawn locations are available under the current filters." /></section>;
  return <main className="workspace"><section className="panel results-panel"><div className="panel-bar"><strong>{plural(maps.length, 'map')}</strong><span>Sorted by total map score</span></div><div className="map-table"><div className="map-row map-row--head"><span>Map</span><span>Mobs</span><span>Total spawns</span><span>Total score</span><span>Best mob</span></div>{maps.slice(0, 150).map((map) => <button key={map.map} type="button" className={selected?.map === map.map ? 'map-row is-selected' : 'map-row'} onClick={() => onSelectMap(map.map)}><strong>{map.map}</strong><span>{map.mobs}</span><span>{map.spawns.toLocaleString()}</span><span>{compactZeny(map.score)}z</span><span>{map.bestMob}</span></button>)}</div></section><aside className="panel detail-panel"><div className="section-row"><h3>{selected?.map ?? 'Select a map'}</h3><span>{plural(selected?.rows.length ?? 0, 'mob')}</span></div><div className="mini-table">{selected?.rows.sort((a, b) => b.score - a.score).map((row) => <div className="mini-row" key={`${selected.map}-${row.value.monster.id}`}><span><strong>{row.value.monster.name}</strong><small>Lv {row.value.monster.level} / {row.value.monster.element}</small></span><span>{row.count.toLocaleString()} spawns</span><span>{compactZeny(row.score)}z</span></div>)}</div></aside></main>;
}

function ItemsView({ items, itemQuery, setItemQuery, manualPrices, setManualPrice, importText, setImportText, priceMessage, copyLabel, manualPriceCount, onImport, onCopy, onClear }: { items: { key: string; name: string; itemId?: number; active: number; source: string; usedBy: Set<number>; examples: string[] }[]; itemQuery: string; setItemQuery: (value: string) => void; manualPrices: ManualPrices; setManualPrice: (key: string, value: string) => void; importText: string; setImportText: (value: string) => void; priceMessage: string; copyLabel: string; manualPriceCount: number; onImport: (replace?: boolean) => void; onCopy: () => void; onClear: () => void }) {
  return <main className="workspace"><section className="panel results-panel"><div className="panel-bar"><strong>{plural(items.length, 'item')}</strong><span>Showing up to 200</span></div><div className="item-search"><input placeholder="Search items, IDs, mobs..." value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} /></div><div className="item-table"><div className="item-row item-row--head"><span>Item</span><span>Active</span><span>Source</span><span>Used by</span><span>Manual price</span></div>{items.map((item) => <div className="item-row" key={item.key}><span><strong>{item.name}</strong><small>{item.itemId ? `ID ${item.itemId}` : item.key} / {item.examples.join(', ')}</small></span><span>{zeny(item.active)}</span><span>{item.source}</span><span>{item.usedBy.size.toLocaleString()}</span><input aria-label={`Manual price for ${item.name}`} placeholder="Manual" value={manualPrices[item.key] ?? ''} onChange={(event) => setManualPrice(item.key, event.target.value)} /></div>)}</div></section><aside className="panel detail-panel"><PriceBox importText={importText} setImportText={setImportText} priceMessage={priceMessage} copyLabel={copyLabel} manualPriceCount={manualPriceCount} onImport={onImport} onCopy={onCopy} onClear={onClear} /></aside></main>;
}

function PriceBox({ importText, setImportText, priceMessage, copyLabel, manualPriceCount, onImport, onCopy, onClear }: { importText: string; setImportText: (value: string) => void; priceMessage: string; copyLabel: string; manualPriceCount: number; onImport: (replace?: boolean) => void; onCopy: () => void; onClear: () => void }) {
  return <details className="price-box" open><summary>Manual prices</summary><p>{manualPriceCount.toLocaleString()} overrides stored in this browser. Manual prices replace NPC/UARO/conversion values.</p><textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste manual price JSON here" /><div className="price-actions"><button type="button" className="primary-button" onClick={() => onImport(true)}>Import replace</button><button type="button" className="secondary-button" onClick={() => onImport(false)}>Import merge</button><button type="button" className="secondary-button" onClick={onCopy}>{copyLabel}</button><button type="button" className="danger-button" onClick={onClear}>Clear</button></div>{priceMessage ? <p className="status-message">{priceMessage}</p> : null}</details>;
}

function RawView({ values }: { values: MonsterValue[] }) {
  const rows = values.slice(0, 200);
  return <section className="panel results-panel raw-panel"><div className="panel-bar"><strong>{plural(values.length, 'filtered mob')}</strong><span>Showing first {rows.length.toLocaleString()}</span></div>{!rows.length ? <EmptyState title="No raw rows" body="No mobs match the current filters." /> : <div className="raw-table"><div className="raw-row raw-row--head"><span>ID</span><span>Name</span><span>Level</span><span>EV</span><span>Map score</span><span>Best map</span></div>{rows.map((value) => <div className="raw-row" key={value.monster.id}><span>{value.monster.id}</span><span>{value.monster.name}</span><span>{value.monster.level}</span><span>{zeny(value.expectedValue)}</span><span>{zeny(value.mapScore)}</span><span>{bestSpawnMap(value.monster)}</span></div>)}</div>}</section>;
}

function EmptyState({ title, body, tone, action }: { title: string; body: string; tone?: 'danger'; action?: ReactNode }) {
  return <div className={tone === 'danger' ? 'empty-state empty-state--danger' : 'empty-state'}><h2>{title}</h2><p>{body}</p>{action}</div>;
}
