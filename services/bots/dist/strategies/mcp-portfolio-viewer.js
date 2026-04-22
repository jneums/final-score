import { parseMarketList, getSmartPrice } from "../mcp-pricing.js";
/**
 * MCP Portfolio Viewer — read-heavy bot that checks account info,
 * positions, and orders via MCP. Occasionally places a small order.
 */
export const mcpPortfolioViewer = {
    name: "mcp-portfolio-viewer",
    description: "Read-heavy MCP bot that monitors account, positions, and orders",
    tier: "mcp",
    budget: { tier: "low", discipline: "disciplined" },
    async act(ctx) {
        if (!ctx.mcp) {
            ctx.log("mcp-portfolio-viewer", "error", "MCP client not available");
            return;
        }
        try {
            // Step 1: Get account info
            const accountResponse = await ctx.mcp.getAccountInfo();
            validateResponse(ctx, "account-info", accountResponse, ["balance", "account"]);
            // Step 2: List positions
            const positionsResponse = await ctx.mcp.listPositions();
            validateResponse(ctx, "list-positions", positionsResponse, ["position", "market"]);
            // Step 3: List open orders
            const ordersResponse = await ctx.mcp.listOrders("Open");
            validateResponse(ctx, "list-orders", ordersResponse, ["order", "market"]);
            // Log a summary
            const posCount = countOccurrences(positionsResponse, /position|market_id/gi);
            const orderCount = countOccurrences(ordersResponse, /order_id|order/gi);
            ctx.log("portfolio-summary", "success", `Portfolio check complete — ~${posCount} position refs, ~${orderCount} order refs`);
            // Step 4: Occasionally place a small order (20% chance)
            if (Math.random() < 0.2) {
                await placeSmallOrder(ctx);
            }
        }
        catch (err) {
            ctx.log("mcp-portfolio-viewer", "error", `Unexpected error: ${err}`);
        }
    },
};
function validateResponse(ctx, action, response, expectedKeywords) {
    const lowerResp = response.toLowerCase();
    const found = expectedKeywords.filter((kw) => lowerResp.includes(kw.toLowerCase()));
    const missing = expectedKeywords.filter((kw) => !lowerResp.includes(kw.toLowerCase()));
    if (found.length > 0) {
        ctx.log(action, "success", `Response validated (found: ${found.join(", ")}): ${response.substring(0, 150)}`);
    }
    else if (lowerResp.includes("no ") || lowerResp.includes("empty") || lowerResp.includes("none") || lowerResp.includes("0 ")) {
        // Valid empty-state response
        ctx.log(action, "success", `Empty result (valid): ${response.substring(0, 150)}`);
    }
    else {
        ctx.log(action, "error", `Unexpected response format (missing: ${missing.join(", ")}): ${response.substring(0, 300)}`);
    }
}
function countOccurrences(text, pattern) {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
}
async function placeSmallOrder(ctx) {
    try {
        // Use MCP to discover markets, then get book-aware pricing
        const marketsResponse = await ctx.mcp.listMarkets(undefined, "Open");
        const markets = parseMarketList(marketsResponse);
        if (markets.length === 0) {
            ctx.log("small-order", "skip", "No market found for small order");
            return;
        }
        const market = markets[Math.floor(Math.random() * markets.length)];
        const outcome = Math.random() < 0.5 ? "yes" : "no";
        // Get smart pricing from order book
        const pricing = await getSmartPrice(ctx.mcp, market.marketId, outcome);
        if (!pricing) {
            ctx.log("small-order", "skip", `No liquidity for ${outcome} on ${market.marketId}`);
            return;
        }
        // Cap size small for viewer bot
        const size = Math.min(pricing.size, 3);
        const orderResponse = await ctx.mcp.placeOrder(market.marketId, outcome, pricing.price, String(size));
        const lowerResp = orderResponse.toLowerCase();
        if (lowerResp.includes("order") ||
            lowerResp.includes("success") ||
            lowerResp.includes("created") ||
            lowerResp.includes("filled") ||
            lowerResp.includes("open")) {
            ctx.log("small-order", "success", `Small order placed: ${outcome} @ ${pricing.price} x${size} — ${orderResponse.substring(0, 200)}`);
        }
        else {
            ctx.log("small-order", "error", `Unexpected order response: ${orderResponse.substring(0, 300)}`);
        }
    }
    catch (err) {
        ctx.log("small-order", "error", `Failed to place small order: ${err}`);
    }
}
