import type { ManualPrices } from './types';

const KEY = 'zenymob2.manualPrices';

export function loadManualPrices(): ManualPrices {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key, Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value >= 0),
    );
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
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>)
      .map(([key, value]) => [key, typeof value === 'object' && value !== null && 'price' in value ? Number((value as { price: unknown }).price) : Number(value)])
      .filter(([, value]) => Number.isFinite(value) && value >= 0),
  );
}
