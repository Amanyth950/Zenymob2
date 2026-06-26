import type { ManualPrices } from './types';

const KEY = 'zenymob2.manualPrices';

type PriceEntry = [string, number];

function cleanEntries(source: Record<string, unknown>): PriceEntry[] {
  return Object.entries(source)
    .map(([key, value]): PriceEntry => {
      const price = typeof value === 'object' && value !== null && 'price' in value ? Number((value as { price: unknown }).price) : Number(value);
      return [key, price];
    })
    .filter((entry): entry is PriceEntry => Number.isFinite(entry[1]) && entry[1] >= 0);
}

export function loadManualPrices(): ManualPrices {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(cleanEntries(parsed as Record<string, unknown>));
  } catch {
    return {};
  }
}

export function saveManualPrices(prices: ManualPrices): void {
  localStorage.setItem(KEY, JSON.stringify(prices));
}

export function exportManualPrices(prices: ManualPrices): string {
  return JSON.stringify({ format: 'zenymob2.manual-prices.v1', prices }, null, 2);
}

export function importManualPrices(text: string): ManualPrices {
  const parsed = JSON.parse(text) as unknown;
  const source = parsed && typeof parsed === 'object' && 'prices' in parsed ? (parsed as { prices: unknown }).prices : parsed;
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(cleanEntries(source as Record<string, unknown>));
}
