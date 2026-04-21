export declare class McpClient {
    private apiKey;
    constructor(apiKey: string);
    placeOrder(marketId: string, outcome: string, price: string, amount: string): Promise<string>;
    cancelOrder(orderId: string): Promise<string>;
    listOrders(status?: string, marketId?: string): Promise<string>;
    listPositions(marketId?: string): Promise<string>;
    listMarkets(sport?: string, status?: string): Promise<string>;
    getAccountInfo(): Promise<string>;
    getMarketDetail(marketId: string): Promise<string>;
}
