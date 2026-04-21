import { randomChoice } from "../market-utils.js";
/**
 * MCP Casual Bettor — browses markets via MCP and places bets.
 * Validates MCP response format (raw text, not typed objects).
 */
export const mcpCasualBettor = {
    name: "mcp-casual-bettor",
    description: "Uses MCP tools to browse markets and place casual bets",
    tier: "mcp",
    async act(ctx) {
        if (!ctx.mcp) {
            ctx.log("mcp-casual-bettor", "error", "MCP client not available");
            return;
        }
        try {
            // Step 1: List markets via MCP
            const sports = ["nba", "nfl", "mlb", "nhl", "soccer"];
            const sport = randomChoice(sports);
            ctx.log("list-markets", "success", `Browsing ${sport} markets via MCP`);
            const marketsResponse = await ctx.mcp.listMarkets(sport, "Open");
            // Parse market IDs from the response text
            // MCP responses are raw text — look for market IDs (patterns like UUIDs or numeric IDs)
            const marketIdMatches = marketsResponse.match(/market_id["\s:]+([a-zA-Z0-9_-]+)/gi)
                ?? marketsResponse.match(/id["\s:]+([a-zA-Z0-9_-]+)/gi)
                ?? [];
            if (marketIdMatches.length === 0) {
                // Try to parse as JSON as a fallback
                try {
                    const parsed = JSON.parse(marketsResponse);
                    const markets = parsed.markets ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
                    if (markets.length === 0) {
                        ctx.log("list-markets", "skip", `No open ${sport} markets found`);
                        return;
                    }
                    const market = randomChoice(markets);
                    const m = market;
                    const marketId = m.market_id ?? m.marketId ?? m.id;
                    if (!marketId) {
                        ctx.log("list-markets", "skip", "Could not extract market ID from parsed response");
                        return;
                    }
                    await placeBet(ctx, String(marketId));
                    return;
                }
                catch {
                    ctx.log("list-markets", "skip", `No markets found in response (raw): ${marketsResponse.substring(0, 200)}`);
                    return;
                }
            }
            // Extract the ID value from the match
            const rawMatch = randomChoice(marketIdMatches);
            const idExtract = rawMatch.match(/([a-zA-Z0-9_-]+)$/);
            if (!idExtract) {
                ctx.log("list-markets", "skip", `Could not parse market ID from: ${rawMatch}`);
                return;
            }
            const marketId = idExtract[1];
            await placeBet(ctx, marketId);
        }
        catch (err) {
            ctx.log("mcp-casual-bettor", "error", `Unexpected error: ${err}`);
        }
    },
};
async function placeBet(ctx, marketId) {
    // Step 2: Place a bet via MCP
    const outcome = randomChoice(["yes", "no"]);
    const prices = ["0.25", "0.35", "0.45", "0.50", "0.55", "0.65", "0.75"];
    const price = randomChoice(prices);
    const amounts = ["3", "5", "8", "10"];
    const amount = randomChoice(amounts);
    ctx.log("place-order", "success", `Placing MCP order: ${outcome} @ ${price} x${amount} on market ${marketId}`);
    const orderResponse = await ctx.mcp.placeOrder(marketId, outcome, price, amount);
    // Validate the response contains order confirmation
    const lowerResp = orderResponse.toLowerCase();
    if (lowerResp.includes("order placed") ||
        lowerResp.includes("order_id") ||
        lowerResp.includes("orderid") ||
        lowerResp.includes("success") ||
        lowerResp.includes("created")) {
        ctx.log("place-order", "success", `Order confirmed: ${orderResponse.substring(0, 200)}`);
    }
    else {
        ctx.log("place-order", "error", `Unexpected order response format: ${orderResponse.substring(0, 300)}`);
    }
}
