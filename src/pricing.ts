import type { DropValue, ManualPrices, Monster, MonsterDrop, MonsterValue, PriceResolution, Settings } from './types';

const GREAT_NATURE_AVERAGE_GREEN_LIVES = 7.5;
const PORING_COIN_CHANCE = 500; // 5%, where 10000 = 100%.

const UARO_PRICE_BY_KEY: Record<string, number> = {
  Yellow_Live: 400,
  Green_Live: 400,
  Mastela_Fruit: 3500,
  Mastela: 3500,
  Crystal_Mirror: 6000,
  Royal_Jelly: 2750,
};

const UARO_PRICE_BY_NAME: Record<string, number> = {
  'green live': 400,
  'green lives': 400,
  'mastela fruit': 3500,
  mastela: 3500,
  'crystal mirror': 6000,
  'royal jelly': 2750,
};

function normalizeName(value: string): string {
  return value.replaceAll('_', ' ').trim().toLowerCase();
}

function isGreatNature(drop: MonsterDrop): boolean {
  return drop.itemKey === 'Great_Nature' || normalizeName(drop.name) === 'great nature';
}

function uaroBasePrice(drop: MonsterDrop): number | undefined {
  if (isGreatNature(drop)) {
    return GREAT_NATURE_AVERAGE_GREEN_LIVES * 400;
  }
  return UARO_PRICE_BY_KEY[drop.itemKey] ?? UARO_PRICE_BY_NAME[normalizeName(drop.name)];
}

function manualPrice(drop: MonsterDrop, manualPrices: ManualPrices): number | undefined {
  return manualPrices[drop.itemKey] ?? manualPrices[drop.name];
}

export function resolvePrice(drop: MonsterDrop, settings: Settings, manualPrices: ManualPrices): PriceResolution {
  const manual = manualPrice(drop, manualPrices);
  if (manual !== undefined && Number.isFinite(manual) && manual >= 0) {
    return { basePrice: manual, activePrice: manual, manualPrice: manual, source: 'Manual' };
  }

  if (drop.type === 'custom') {
    return { basePrice: drop.baseSellPrice, activePrice: drop.baseSellPrice, source: 'Custom' };
  }

  const serverPrice = settings.uaro ? uaroBasePrice(drop) : undefined;
  const basePrice = serverPrice ?? drop.baseSellPrice;
  let source = serverPrice === undefined ? 'NPC' : isGreatNature(drop) ? 'UARO conversion' : 'UARO';
  let activePrice = basePrice;

  if (settings.overcharge && !drop.ignoreOvercharge) {
    activePrice = Math.floor(basePrice * settings.overchargeRate);
    source += ' + Overcharge';
  }

  return { basePrice, activePrice, source };
}

export function adjustedChance(drop: MonsterDrop, settings: Settings): number {
  const multiplier = drop.type === 'custom' ? 1 : settings.dropMultiplier;
  return Math.min(Math.max(drop.chance * multiplier, 0), 10000);
}

export function poringCoinDrop(price: number): MonsterDrop {
  return {
    itemKey: '__poring_coin__',
    name: 'Poring Coin',
    chance: PORING_COIN_CHANCE,
    baseSellPrice: price,
    ignoreOvercharge: true,
    type: 'custom',
  };
}

export function valueDrops(monster: Monster, settings: Settings, manualPrices: ManualPrices): DropValue[] {
  const regularDrops = settings.showMvp ? monster.drops : monster.drops.filter((drop) => drop.type !== 'mvp');
  const drops = settings.poringCoin ? [...regularDrops, poringCoinDrop(settings.poringCoinPrice)] : regularDrops;
  const values = drops.map((drop) => {
    const chance = adjustedChance(drop, settings);
    const price = resolvePrice(drop, settings, manualPrices);
    return {
      ...drop,
      adjustedChance: chance,
      price,
      expectedValue: (price.activePrice * chance) / 10000,
      share: 0,
    };
  });

  const total = values.reduce((sum, drop) => sum + drop.expectedValue, 0);
  return values
    .map((drop) => ({ ...drop, share: total > 0 ? (drop.expectedValue / total) * 100 : 0 }))
    .sort((a, b) => b.expectedValue - a.expectedValue);
}

export function valueMonster(monster: Monster, settings: Settings, manualPrices: ManualPrices): MonsterValue {
  const drops = valueDrops(monster, settings, manualPrices);
  const expectedValue = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);
  const bestSpawn = monster.spawns.reduce((best, spawn) => Math.max(best, spawn.count), 0);
  return {
    monster,
    drops,
    expectedValue,
    mapScore: expectedValue * bestSpawn,
    topDrops: drops.slice(0, 3),
  };
}
