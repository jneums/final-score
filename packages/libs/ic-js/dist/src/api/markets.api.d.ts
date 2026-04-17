export interface MarketCount {
    total: number;
    open: number;
    closed: number;
    resolved: number;
    cancelled: number;
}
export interface PlatformStats {
    totalTrades: number;
    activeMarkets: number;
    totalVolume: number;
    totalUsers: number;
    resolvedMarkets: number;
}
export interface MarketInfo {
    marketId: string;
    question: string;
    eventTitle: string;
    sport: string;
    status: string;
    polymarketSlug: string;
    endDate: bigint;
    totalVolume: bigint;
    lastYesPrice: bigint;
    lastNoPrice: bigint;
}
/**
 * Gets the count of markets by status.
 */
export declare const getMarketCount: () => Promise<MarketCount>;
/**
 * Gets platform-wide statistics.
 */
export declare const getPlatformStats: () => Promise<PlatformStats>;
/**
 * Gets a specific market by ID (debug endpoint).
 * @param marketId The market ID string
 * @returns The market info or null if not found
 */
export declare const getMarket: (marketId: string) => Promise<MarketInfo | null>;
