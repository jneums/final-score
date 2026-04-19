/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts, consumed by maker.ts.
 */
// Map: conditionId → PriceEntry
const cache = new Map();
/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export function setPrice(conditionId, slug, yesPrice, noPrice) {
    cache.set(conditionId, {
        conditionId,
        slug,
        yesPrice,
        noPrice,
        updatedAt: new Date(),
    });
}
/** Get price for a conditionId. Returns undefined if not cached. */
export function getPrice(conditionId) {
    return cache.get(conditionId);
}
/** Get all cached prices. */
export function getAllPrices() {
    return cache;
}
/** How many entries in cache. */
export function cacheSize() {
    return cache.size;
}
/** Check if a price is stale (older than maxAgeMs). */
export function isStale(conditionId, maxAgeMs) {
    const entry = cache.get(conditionId);
    if (!entry)
        return true;
    return Date.now() - entry.updatedAt.getTime() > maxAgeMs;
}
