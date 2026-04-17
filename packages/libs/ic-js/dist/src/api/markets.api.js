// packages/libs/ic-js/src/api/markets.api.ts
import { getFinalScoreActor } from '../actors.js';
/**
 * Gets the count of markets by status.
 */
export const getMarketCount = async () => {
    const actor = await getFinalScoreActor();
    const result = await actor.get_market_count();
    return {
        total: Number(result.total),
        open: Number(result.open),
        closed: Number(result.closed),
        resolved: Number(result.resolved),
        cancelled: Number(result.cancelled),
    };
};
/**
 * Gets platform-wide statistics.
 */
export const getPlatformStats = async () => {
    const actor = await getFinalScoreActor();
    const result = await actor.get_platform_stats();
    return {
        totalTrades: Number(result.totalTrades),
        activeMarkets: Number(result.activeMarkets),
        totalVolume: Number(result.totalVolume),
        totalUsers: Number(result.totalUsers),
        resolvedMarkets: Number(result.resolvedMarkets),
    };
};
/**
 * Gets a specific market by ID (debug endpoint).
 * @param marketId The market ID string
 * @returns The market info or null if not found
 */
export const getMarket = async (marketId) => {
    const actor = await getFinalScoreActor();
    const result = await actor.debug_get_market(marketId);
    if (result.length === 0)
        return null;
    return result[0] ?? null;
};
