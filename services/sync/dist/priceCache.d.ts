/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts, consumed by maker.ts.
 */
export interface PriceEntry {
    conditionId: string;
    slug: string;
    yesPrice: number;
    noPrice: number;
    updatedAt: Date;
}
/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export declare function setPrice(conditionId: string, slug: string, yesPrice: number, noPrice: number): void;
/** Get price for a conditionId. Returns undefined if not cached. */
export declare function getPrice(conditionId: string): PriceEntry | undefined;
/** Get all cached prices. */
export declare function getAllPrices(): Map<string, PriceEntry>;
/** How many entries in cache. */
export declare function cacheSize(): number;
/** Check if a price is stale (older than maxAgeMs). */
export declare function isStale(conditionId: string, maxAgeMs: number): boolean;
