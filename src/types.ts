export type DropType = 'normal' | 'mvp' | 'custom';

export type MonsterDrop = {
  itemId?: number;
  itemKey: string;
  name: string;
  chance: number; // 10000 = 100%.
  baseSellPrice: number;
  ignoreOvercharge?: boolean;
  type?: DropType;
};

export type MonsterSpawn = {
  map: string;
  count: number;
};

export type Monster = {
  id: number;
  spriteName?: string;
  name: string;
  level: number;
  hp: number;
  element: string;
  race: string;
  size: string;
  isBoss: boolean;
  hasMvpDrops: boolean;
  spawns: MonsterSpawn[];
  drops: MonsterDrop[];
};

export type Item = {
  id?: number;
  key: string;
  name: string;
  baseSellPrice: number;
  ignoreOvercharge?: boolean;
};

export type Settings = {
  dropMultiplier: number;
  overcharge: boolean;
  overchargeRate: number;
  uaro: boolean;
  poringCoin: boolean;
  poringCoinPrice: number;
  showBoss: boolean;
  showMvp: boolean;
};

export type ManualPrices = Record<string, number>;

export type PriceResolution = {
  basePrice: number;
  activePrice: number;
  source: string;
  manualPrice?: number;
};

export type DropValue = MonsterDrop & {
  adjustedChance: number;
  price: PriceResolution;
  expectedValue: number;
  share: number;
};

export type MonsterValue = {
  monster: Monster;
  expectedValue: number;
  mapScore: number;
  topDrops: DropValue[];
  drops: DropValue[];
};
