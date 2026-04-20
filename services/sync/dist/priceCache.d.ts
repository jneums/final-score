/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts and ws.ts, consumed by maker.ts.
 */
export interface PriceEntry {
    conditionId: string;
    slug: string;
    yesPrice: number;
    noPrice: number;
    updatedAt: Date;
    /** Polymarket CLOB token IDs: [yesTokenId, noTokenId] */
    clobTokenIds?: [string, string];
}
/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export declare function setPrice(conditionId: string, slug: string, yesPrice: number, noPrice: number, clobTokenIds?: [string, string], inverted?: boolean): void;
/** Update price for a single side from a WebSocket event.
 * Fans out to ALL conditionIds sharing this asset (base + split markets).
 * Returns all affected conditionIds that exceeded the threshold. */
export declare function updatePriceFromWs(assetId: string, newPriceBps: number): {
    conditionIds: string[];
    maxDeltaBps: number;
} | null;
/** Get price for a conditionId. Returns undefined if not cached. */
export declare function getPrice(conditionId: string): PriceEntry | undefined;
/** Get all cached prices. */
export declare function getAllPrices(): Map<string, PriceEntry>;
/** How many entries in cache. */
export declare function cacheSize(): number;
/** Check if a price is stale (older than maxAgeMs). */
export declare function isStale(conditionId: string, maxAgeMs: number): boolean;
/** Look up conditionId from an asset ID. Returns first (non-inverted) mapping. */
export declare function lookupAsset(assetId: string): {
    conditionId: string;
    side: "yes" | "no";
} | undefined;
/** Get all subscribed asset IDs (for WebSocket subscription). */
export declare function getAllAssetIds(): string[];
