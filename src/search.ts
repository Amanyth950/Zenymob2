import type { MonsterValue, Settings } from './types';

export function filterValues(values: MonsterValue[], query: string, settings: Settings): MonsterValue[] {
  const q = query.trim().toLowerCase();
  return values.filter(({ monster, drops }) => {
    if (!settings.showBoss && monster.isBoss) return false;
    if (!settings.showMvp && monster.hasMvpDrops) return false;
    if (!q) return true;

    const searchable = [
      monster.name,
      String(monster.id),
      monster.element,
      monster.race,
      monster.size,
      ...monster.spawns.map((spawn) => spawn.map),
      ...drops.map((drop) => drop.name),
      ...drops.map((drop) => String(drop.itemId ?? '')),
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(q);
  });
}

export function sortValues(values: MonsterValue[], sortBy: string): MonsterValue[] {
  const sorted = [...values];
  if (sortBy === 'mapScore') return sorted.sort((a, b) => b.mapScore - a.mapScore);
  if (sortBy === 'level') return sorted.sort((a, b) => a.monster.level - b.monster.level);
  if (sortBy === 'spawns') {
    return sorted.sort((a, b) => Math.max(...b.monster.spawns.map((s) => s.count), 0) - Math.max(...a.monster.spawns.map((s) => s.count), 0));
  }
  return sorted.sort((a, b) => b.expectedValue - a.expectedValue);
}
