/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts, consumed by maker.ts.
 */

export interface PriceEntry {
  conditionId: string;
  slug: string;
  yesPrice: number;  // 0-10000 bps
  noPrice: number;   // 0-10000 bps
  updatedAt: Date;
}

// Map: conditionId → PriceEntry
const cache = new Map<string, PriceEntry>();

/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export function setPrice(conditionId: string, slug: string, yesPrice: number, noPrice: number): void {
  cache.set(conditionId, {
    conditionId,
    slug,
    yesPrice,
    noPrice,
    updatedAt: new Date(),
  });
}

/** Get price for a conditionId. Returns undefined if not cached. */
export function getPrice(conditionId: string): PriceEntry | undefined {
  return cache.get(conditionId);
}

/** Get all cached prices. */
export function getAllPrices(): Map<string, PriceEntry> {
  return cache;
}

/** How many entries in cache. */
export function cacheSize(): number {
  return cache.size;
}

/** Check if a price is stale (older than maxAgeMs). */
export function isStale(conditionId: string, maxAgeMs: number): boolean {
  const entry = cache.get(conditionId);
  if (!entry) return true;
  return Date.now() - entry.updatedAt.getTime() > maxAgeMs;
}
