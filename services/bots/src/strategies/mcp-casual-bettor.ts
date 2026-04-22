import { Strategy, BotContext } from "../strategy.js";
import { randomChoice } from "../market-utils.js";
import { parseMarketList, getSmartPrice } from "../mcp-pricing.js";

/**
 * MCP Casual Bettor — browses markets via MCP and places bets at smart prices.
 * Uses market_detail to get order book depth and prices near the implied ask.
 */
export const mcpCasualBettor: Strategy = {
  name: "mcp-casual-bettor",
  description: "Uses MCP tools to browse markets and place bets at book-aware prices",
  tier: "mcp",
  budget: { tier: "medium", discipline: "moderate" },

  async act(ctx: BotContext): Promise<void> {
    if (!ctx.mcp) {
      ctx.log("mcp-casual-bettor", "error", "MCP client not available");
      return;
    }

    try {
      // Step 1: List markets via MCP
      const sport = ctx.sport;
      ctx.log("list-markets", "success", `Browsing ${sport} markets via MCP`);

      const marketsResponse = await ctx.mcp.listMarkets(sport, "Open");
      const markets = parseMarketList(marketsResponse);

      if (markets.length === 0) {
        ctx.log("list-markets", "skip", `No open ${sport} markets found`);
        return;
      }

      const market = randomChoice(markets);
      const outcome = randomChoice(["yes", "no"] as const);

      // Step 2: Get smart pricing from order book
      const pricing = await getSmartPrice(ctx.mcp, market.marketId, outcome);

      if (!pricing) {
        ctx.log("place-order", "skip",
          `No liquidity for ${outcome} on market ${market.marketId} — skipping`);
        return;
      }

      ctx.log("place-order", "success",
        `Placing MCP order: ${outcome} @ ${pricing.price} x${pricing.size} on market ${market.marketId}`);

      const orderResponse = await ctx.mcp.placeOrder(
        market.marketId, outcome, pricing.price, String(pricing.size),
      );

      // Validate the response
      const lowerResp = orderResponse.toLowerCase();
      if (
        lowerResp.includes("order_id") ||
        lowerResp.includes("orderid") ||
        lowerResp.includes("success") ||
        lowerResp.includes("created") ||
        lowerResp.includes("filled") ||
        lowerResp.includes("open")
      ) {
        ctx.log("place-order", "success", `Order confirmed: ${orderResponse.substring(0, 200)}`);
      } else {
        ctx.log("place-order", "error", `Unexpected order response: ${orderResponse.substring(0, 300)}`);
      }
    } catch (err) {
      ctx.log("mcp-casual-bettor", "error", `Unexpected error: ${err}`);
    }
  },
};
