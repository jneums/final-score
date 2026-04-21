import { McpClient } from "./mcp-client.js";
/**
 * Parsed pricing data from market_detail response.
 * Prices are in bps (basis points): 5000 = $0.50.
 */
export interface MarketPricing {
    marketId: string;
    bestYesBid: number;
    bestNoBid: number;
    impliedYesAsk: number;
    impliedNoAsk: number;
    spread: number;
    polyYesPrice: number;
    polyNoPrice: number;
}
/**
 * Extract pricing from a market_detail MCP response.
 * Returns null if pricing can't be parsed.
 */
export declare function parseMarketDetail(response: string): MarketPricing | null;
/**
 * Parse market IDs + prices from markets_list response.
 * Returns array of {marketId, yesPrice, noPrice} (bps).
 */
export declare function parseMarketList(response: string): Array<{
    marketId: string;
    yesPrice: number;
    noPrice: number;
}>;
/**
 * Get smart pricing for a market via MCP.
 * Calls market_detail and returns a sensible limit price based on the book.
 */
export declare function getSmartPrice(mcp: McpClient, marketId: string, outcome: "yes" | "no"): Promise<{
    price: string;
    size: number;
} | null>;
