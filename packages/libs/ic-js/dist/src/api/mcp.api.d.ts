export interface McpToolResult {
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}
/**
 * Calls an MCP tool on the Final Score canister via JSON-RPC over HTTP.
 *
 * @param apiKey  The user's API key for authentication
 * @param toolName  The MCP tool name (e.g. 'markets_list')
 * @param args  Arguments object for the tool
 * @param canisterIdOverride  Optional override for the canister ID
 * @returns Parsed tool result
 */
export declare function callMcpTool(apiKey: string, toolName: string, args?: Record<string, unknown>, canisterIdOverride?: string): Promise<McpToolResult>;
/**
 * List markets with optional filters.
 */
export declare function listMarkets(apiKey: string, args?: {
    sport?: string;
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<any>;
/**
 * Get detailed info about a specific market.
 */
export declare function getMarketDetail(apiKey: string, marketId: string): Promise<any>;
/**
 * Place an order on a market.
 */
export declare function placeOrder(apiKey: string, args: {
    market_id: string;
    side: string;
    outcome: string;
    amount: number;
    price: number;
}): Promise<any>;
/**
 * Cancel an existing order.
 */
export declare function cancelOrder(apiKey: string, orderId: string): Promise<any>;
/**
 * List the user's orders.
 */
export declare function listOrders(apiKey: string, args?: {
    market_id?: string;
    status?: string;
}): Promise<any>;
/**
 * List the user's positions.
 */
export declare function listPositions(apiKey: string, args?: {
    market_id?: string;
}): Promise<any>;
/**
 * Get account info for the authenticated user.
 */
export declare function getAccountInfo(apiKey: string): Promise<any>;
/**
 * Get account history (trades, deposits, withdrawals).
 */
export declare function getAccountHistory(apiKey: string, args?: {
    limit?: number;
    offset?: number;
}): Promise<any>;
/**
 * List available sports.
 */
export declare function listSports(apiKey: string): Promise<any>;
/**
 * Get leaderboard via MCP (alternative to the direct Candid call).
 */
export declare function getLeaderboard(apiKey: string, args?: {
    limit?: number;
}): Promise<any>;
