import type { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
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
interface PositionRecord {
    positionId: string;
    marketId: string;
    outcome: string;
    shares: bigint;
    costBasis: bigint;
    avgPrice: bigint;
}
type CanisterActor = any;
export declare class CandidClient {
    private actor;
    private tokenActor;
    private identity;
    constructor(actor: CanisterActor, tokenActor: CanisterActor, identity: Secp256k1KeyIdentity);
    static create(identity: Secp256k1KeyIdentity, host?: string): Promise<CandidClient>;
    getPrincipal(): string;
    placeOrder(marketId: string, outcome: string, price: number, size: number): Promise<{
        ok: boolean;
        message: string;
        data?: PlaceOrderOk;
    }>;
    cancelOrder(orderId: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    getMyOrders(statusFilter?: string, marketFilter?: string): Promise<OrderRecord[]>;
    getMyPositions(marketFilter?: string): Promise<PositionRecord[]>;
    listMarkets(sport?: string, offset?: number, limit?: number, status?: string): Promise<{
        total: bigint;
        returned: bigint;
        markets: MarketRecord[];
    }>;
    getOrderBook(marketId: string, depth?: number): Promise<OrderBookResult>;
    approve(spenderCanisterId: string, amount: bigint): Promise<void>;
    getBalance(): Promise<bigint>;
}
export declare class AdminClient {
    private actor;
    private faucetActor;
    constructor(actor: CanisterActor, faucetActor: CanisterActor);
    static create(identity: Secp256k1KeyIdentity, host?: string): Promise<AdminClient>;
    createApiKey(userPrincipal: string, name: string, scopes: string[]): Promise<string>;
    fundFromFaucet(principal: string): Promise<void>;
}
export declare class TokenClient {
    private tokenActor;
    private identity;
    constructor(tokenActor: CanisterActor, identity: Secp256k1KeyIdentity);
    static create(identity: Secp256k1KeyIdentity, host?: string): Promise<TokenClient>;
    approve(spenderCanisterId: string, amount: bigint): Promise<void>;
    getBalance(): Promise<bigint>;
}
export type { OrderRecord, MarketRecord, PlaceOrderOk, OrderBookResult, DepthLevel, PositionRecord, PlaceOrderFill, };
