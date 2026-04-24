import { type Identity } from '@icp-sdk/core/agent';
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
export interface MarketListItem {
    marketId: string;
    question: string;
    eventTitle: string;
    sport: string;
    status: string;
    yesPrice: number;
    noPrice: number;
    impliedYesAsk: number;
    impliedNoAsk: number;
    polymarketSlug: string;
    endDate: bigint;
    totalVolume: bigint;
}
export interface MarketListResult {
    total: number;
    returned: number;
    markets: MarketListItem[];
}
export declare const queryMarkets: (sportFilter?: string, offset?: number, limit?: number, statusFilter?: string) => Promise<MarketListResult>;
export interface DepthLevel {
    price: number;
    totalSize: number;
    orderCount: number;
}
export interface OrderBookData {
    yesBids: DepthLevel[];
    noBids: DepthLevel[];
    bestYesBid: number;
    bestNoBid: number;
    impliedYesAsk: number;
    impliedNoAsk: number;
    spread: number;
}
export declare const getOrderBook: (marketId: string, maxLevels?: number) => Promise<OrderBookData>;
export interface PlaceOrderResult {
    orderId: string;
    status: string;
    filled: number;
    remaining: number;
    fills: {
        tradeId: string;
        price: number;
        size: number;
    }[];
}
export declare const placeOrderCandid: (identity: Identity, marketId: string, outcome: string, price: number, size: number) => Promise<PlaceOrderResult>;
export declare const cancelOrderCandid: (identity: Identity, orderId: string) => Promise<string>;
export interface UserOrder {
    orderId: string;
    marketId: string;
    question: string;
    outcome: string;
    price: number;
    size: number;
    filledSize: number;
    status: string;
    timestamp: number;
}
export declare const getMyOrders: (identity: Identity, statusFilter?: string, marketFilter?: string) => Promise<UserOrder[]>;
export interface UserPosition {
    positionId: string;
    marketId: string;
    question: string;
    outcome: string;
    shares: number;
    costBasis: number;
    averagePrice: number;
    currentPrice: number;
    marketStatus: string;
}
export declare const getMyPositions: (identity: Identity, marketFilter?: string) => Promise<UserPosition[]>;
export declare const getEventMarkets: (polymarketSlug: string) => Promise<MarketInfo[]>;
export declare const getTopMarketsByVolume: (limit?: number) => Promise<MarketListItem[]>;
