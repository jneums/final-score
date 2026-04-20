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
            impliedYesAsk: Number(m.impliedYesAsk),
            impliedNoAsk: Number(m.impliedNoAsk),
            polymarketSlug: m.polymarketSlug,
            endDate: m.endDate,
            totalVolume: m.totalVolume,
        })),
    };
};
export const getOrderBook = async (marketId, maxLevels = 20) => {
    const actor = await getFinalScoreActor();
    const result = await actor.debug_get_order_book(marketId, BigInt(maxLevels));
    return {
        yesBids: result.yesBids.map((l) => ({
            price: Number(l.price),
            totalSize: Number(l.totalSize),
            orderCount: Number(l.orderCount),
        })),
        noBids: result.noBids.map((l) => ({
            price: Number(l.price),
            totalSize: Number(l.totalSize),
            orderCount: Number(l.orderCount),
        })),
        bestYesBid: Number(result.bestYesBid),
        bestNoBid: Number(result.bestNoBid),
        impliedYesAsk: Number(result.impliedYesAsk),
        impliedNoAsk: Number(result.impliedNoAsk),
        spread: Number(result.spread),
    };
};
export const placeOrderCandid = async (identity, marketId, outcome, price, size) => {
    const actor = await getFinalScoreActor(identity);
    const result = await actor.place_order(marketId, outcome, price, BigInt(size));
    if ('err' in result)
        throw new Error(result.err);
    const ok = result.ok;
    return {
        orderId: ok.orderId,
        status: ok.status,
        filled: Number(ok.filled),
        remaining: Number(ok.remaining),
        fills: ok.fills.map((f) => ({
            tradeId: f.tradeId,
            price: Number(f.price),
            size: Number(f.size),
        })),
    };
};
export const cancelOrderCandid = async (identity, orderId) => {
    const actor = await getFinalScoreActor(identity);
    const result = await actor.cancel_order(orderId);
    if ('err' in result)
        throw new Error(result.err);
    return result.ok;
};
export const getMyOrders = async (identity, statusFilter, marketFilter) => {
    const actor = await getFinalScoreActor(identity);
    const result = await actor.my_orders(statusFilter ? [statusFilter] : [], marketFilter ? [marketFilter] : []);
    return result.map((o) => ({
        orderId: o.orderId,
        marketId: o.marketId,
        outcome: o.outcome,
        price: Number(o.price),
        size: Number(o.size),
        filledSize: Number(o.filledSize),
        status: o.status,
        timestamp: Number(o.timestamp),
    }));
};
export const getMyPositions = async (identity, marketFilter) => {
    const actor = await getFinalScoreActor(identity);
    const result = await actor.my_positions(marketFilter ? [marketFilter] : []);
    return result.map((p) => ({
        positionId: p.positionId,
        marketId: p.marketId,
        question: p.question,
        outcome: p.outcome,
        shares: Number(p.shares),
        costBasis: Number(p.costBasis),
        averagePrice: Number(p.averagePrice),
        currentPrice: Number(p.currentPrice),
        marketStatus: p.marketStatus,
    }));
};
// ─── Event Markets ────────────────────────────────────────────────────────────
export const getEventMarkets = async (polymarketSlug) => {
    const actor = await getFinalScoreActor();
    const result = await actor.get_event_markets(polymarketSlug);
    return result.map((m) => ({
        marketId: m.marketId,
        question: m.question,
        eventTitle: m.eventTitle,
        sport: m.sport,
        status: m.status,
        polymarketSlug: m.polymarketSlug,
        endDate: m.endDate,
        totalVolume: m.totalVolume,
        lastYesPrice: m.lastYesPrice,
        lastNoPrice: m.lastNoPrice,
    }));
};
