/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts and ws.ts, consumed by maker.ts.
 */
// Map: conditionId → PriceEntry
const cache = new Map();
// Reverse map: assetId (CLOB token ID) → { conditionId, side }
const assetIndex = new Map();
/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export function setPrice(conditionId, slug, yesPrice, noPrice, clobTokenIds) {
    const existing = cache.get(conditionId);
    const tokens = clobTokenIds || existing?.clobTokenIds;
    cache.set(conditionId, {
        conditionId,
        slug,
        yesPrice,
        noPrice,
        updatedAt: new Date(),
        clobTokenIds: tokens,
    });
    // Update reverse index
    if (tokens) {
        assetIndex.set(tokens[0], { conditionId, side: "yes" });
        assetIndex.set(tokens[1], { conditionId, side: "no" });
    }
}
/** Update price for a single side from a WebSocket event. Returns the price delta in bps, or 0 if no change. */
export function updatePriceFromWs(assetId, newPriceBps) {
    const mapping = assetIndex.get(assetId);
    if (!mapping)
        return null;
    const entry = cache.get(mapping.conditionId);
    if (!entry)
        return null;
    const oldPrice = mapping.side === "yes" ? entry.yesPrice : entry.noPrice;
    const deltaBps = Math.abs(newPriceBps - oldPrice);
    if (mapping.side === "yes") {
        entry.yesPrice = newPriceBps;
        entry.noPrice = 10000 - newPriceBps;
    }
    else {
        entry.noPrice = newPriceBps;
        entry.yesPrice = 10000 - newPriceBps;
    }
    entry.updatedAt = new Date();
    return { conditionId: mapping.conditionId, deltaBps };
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
/** Look up conditionId from an asset ID. */
export function lookupAsset(assetId) {
    return assetIndex.get(assetId);
}
/** Get all subscribed asset IDs (for WebSocket subscription). */
export function getAllAssetIds() {
    return [...assetIndex.keys()];
}
