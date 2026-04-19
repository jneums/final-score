interface UnresolvedMarket {
    marketId: string;
    polymarketSlug: string;
    polymarketConditionId: string;
    status: string;
}
interface PlaceOrderFill {
    tradeId: string;
    price: bigint;
    size: bigint;
}
interface PlaceOrderOk {
    orderId: string;
    status: string;
    filled: bigint;
    remaining: bigint;
    fills: PlaceOrderFill[];
}
interface OrderRecord {
    orderId: string;
    marketId: string;
    outcome: string;
    price: bigint;
    size: bigint;
    filledSize: bigint;
    status: string;
    timestamp: bigint;
}
interface MarketRecord {
    marketId: string;
    question: string;
    eventTitle: string;
    sport: string;
    status: string;
    yesPrice: bigint;
    noPrice: bigint;
    polymarketSlug: string;
}
interface DepthLevel {
    price: bigint;
    totalSize: bigint;
    orderCount: bigint;
}
interface OrderBookResult {
    yesBids: DepthLevel[];
    noBids: DepthLevel[];
    bestYesBid: bigint;
    bestNoBid: bigint;
    impliedYesAsk: bigint;
    impliedNoAsk: bigint;
    spread: bigint;
}
interface CanisterActor {
    admin_create_market(question: string, eventTitle: string, sport: string, polymarketSlug: string, polymarketConditionId: string, endDateSeconds: bigint, yesPrice: bigint, noPrice: bigint): Promise<{
        ok: string;
    } | {
        err: string;
    }>;
    try_resolve_market(marketId: string): Promise<{
        ok: string;
    } | {
        err: string;
    }>;
    get_unresolved_markets(): Promise<UnresolvedMarket[]>;
    place_order(marketId: string, outcome: string, price: number, size: bigint): Promise<{
        ok: PlaceOrderOk;
    } | {
        err: string;
    }>;
    cancel_order(orderId: string): Promise<{
        ok: string;
    } | {
        err: string;
    }>;
    my_orders(statusFilter: [string] | [], marketFilter: [string] | []): Promise<OrderRecord[]>;
    debug_list_markets(sportFilter: [string] | [], offset: bigint, limit: bigint): Promise<{
        total: bigint;
        returned: bigint;
        markets: MarketRecord[];
    }>;
    debug_get_order_book(marketId: string, maxLevels: bigint): Promise<OrderBookResult>;
}
export declare function getActor(): Promise<CanisterActor>;
export declare function getMakerActor(): Promise<CanisterActor>;
export declare function createMarket(question: string, eventTitle: string, sport: string, slug: string, conditionId: string, endDateSeconds: number, yesPrice: number, noPrice: number): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function tryResolveMarket(marketId: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function getUnresolvedMarkets(): Promise<UnresolvedMarket[]>;
export declare function placeOrder(marketId: string, outcome: string, price: number, size: number): Promise<{
    ok: boolean;
    message: string;
    data?: PlaceOrderOk;
}>;
export declare function cancelOrder(orderId: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function getMyOrders(statusFilter?: string, marketFilter?: string): Promise<OrderRecord[]>;
export declare function listMarkets(sportFilter?: string, offset?: number, limit?: number): Promise<{
    total: bigint;
    returned: bigint;
    markets: MarketRecord[];
}>;
export declare function getOrderBook(marketId: string, maxLevels?: number): Promise<OrderBookResult>;
export type { UnresolvedMarket, OrderRecord, MarketRecord, PlaceOrderOk, OrderBookResult, DepthLevel };
