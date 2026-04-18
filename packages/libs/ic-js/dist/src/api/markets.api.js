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
/**
 * Lists markets with optional sport filter and pagination.
 * Uses the canister's debug_list_markets query (no API key needed).
 */
export const queryMarkets = async (sportFilter, offset = 0, limit = 50) => {
    const actor = await getFinalScoreActor();
    const result = await actor.debug_list_markets(sportFilter ? [sportFilter] : [], BigInt(offset), BigInt(limit));
    return {
        total: Number(result.total),
        returned: Number(result.returned),
        markets: result.markets.map((m) => ({
            marketId: m.marketId,
            question: m.question,
            eventTitle: m.eventTitle,
            sport: m.sport,
            status: m.status,
            yesPrice: Number(m.yesPrice),
            noPrice: Number(m.noPrice),
            polymarketSlug: m.polymarketSlug,
        })),
    };
};
