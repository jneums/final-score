import { Strategy, BotContext } from "../strategy.js";

/**
 * MCP Portfolio Viewer — read-heavy bot that checks account info,
 * positions, and orders via MCP. Occasionally places a small order.
 */
export const mcpPortfolioViewer: Strategy = {
  name: "mcp-portfolio-viewer",
  description: "Read-heavy MCP bot that monitors account, positions, and orders",
  tier: "mcp",

  async act(ctx: BotContext): Promise<void> {
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
      ctx.log(
        "portfolio-summary",
        "success",
        `Portfolio check complete — ~${posCount} position refs, ~${orderCount} order refs`,
      );

      // Step 4: Occasionally place a small order (20% chance)
      if (Math.random() < 0.2) {
        await placeSmallOrder(ctx);
      }
    } catch (err) {
      ctx.log("mcp-portfolio-viewer", "error", `Unexpected error: ${err}`);
    }
  },
};

function validateResponse(
  ctx: BotContext,
  action: string,
  response: string,
  expectedKeywords: string[],
): void {
  const lowerResp = response.toLowerCase();
  const found = expectedKeywords.filter((kw) => lowerResp.includes(kw.toLowerCase()));
  const missing = expectedKeywords.filter((kw) => !lowerResp.includes(kw.toLowerCase()));

  if (found.length > 0) {
    ctx.log(action, "success", `Response validated (found: ${found.join(", ")}): ${response.substring(0, 150)}`);
  } else if (lowerResp.includes("no ") || lowerResp.includes("empty") || lowerResp.includes("none") || lowerResp.includes("0 ")) {
    // Valid empty-state response
    ctx.log(action, "success", `Empty result (valid): ${response.substring(0, 150)}`);
  } else {
    ctx.log(
      action,
      "error",
      `Unexpected response format (missing: ${missing.join(", ")}): ${response.substring(0, 300)}`,
    );
  }
}

function countOccurrences(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

async function placeSmallOrder(ctx: BotContext): Promise<void> {
  try {
    // Use MCP to discover markets, then place a small bet
    const marketsResponse = await ctx.mcp!.listMarkets(undefined, "Open");

    // Try to extract a market ID
    let marketId: string | null = null;
    try {
      const parsed = JSON.parse(marketsResponse);
      const markets = parsed.markets ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
      if (markets.length > 0) {
        const market = markets[Math.floor(Math.random() * markets.length)] as Record<string, unknown>;
        marketId = String(market.market_id ?? market.marketId ?? market.id ?? "");
      }
    } catch {
      // Try regex extraction
      const match = marketsResponse.match(/(?:market_id|id)["\s:]+([a-zA-Z0-9_-]+)/i);
      if (match) marketId = match[1];
    }

    if (!marketId) {
      ctx.log("small-order", "skip", "No market found for small order");
      return;
    }

    const orderResponse = await ctx.mcp!.placeOrder(marketId, "yes", "0.40", "2");
    const lowerResp = orderResponse.toLowerCase();
    if (
      lowerResp.includes("order") ||
      lowerResp.includes("success") ||
      lowerResp.includes("created")
    ) {
      ctx.log("small-order", "success", `Small order placed: ${orderResponse.substring(0, 200)}`);
    } else {
      ctx.log("small-order", "error", `Unexpected order response: ${orderResponse.substring(0, 300)}`);
    }
  } catch (err) {
    ctx.log("small-order", "error", `Failed to place small order: ${err}`);
  }
}
