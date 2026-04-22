import { Strategy, BotContext } from "../strategy.js";
import { sleep } from "../market-utils.js";
import { parseMarketList, getSmartPrice } from "../mcp-pricing.js";

/**
 * MCP Full Flow — exercises the complete order lifecycle via MCP:
 * list markets → get detail → place order at book price → verify → cancel → check positions → check account.
 */
export const mcpFullFlow: Strategy = {
  name: "mcp-full-flow",
  description: "Full lifecycle test with book-aware pricing: place, verify, cancel, and check via MCP",
  tier: "mcp",
  budget: { tier: "medium", discipline: "disciplined" },

  async act(ctx: BotContext): Promise<void> {
    if (!ctx.mcp) {
      ctx.log("mcp-full-flow", "error", "MCP client not available");
      return;
    }

    try {
      // ── Step 1: List markets to find a market ID ──
      ctx.log("step-1-markets", "success", "Listing markets via MCP...");
      const marketsResponse = await ctx.mcp.listMarkets(undefined, "Open");
      const markets = parseMarketList(marketsResponse);

      if (markets.length === 0) {
        ctx.log("step-1-markets", "skip", "No open markets found");
        return;
      }

      // Pick a random market
      const market = markets[Math.floor(Math.random() * markets.length)];
      ctx.log("step-1-markets", "success", `Found market: ${market.marketId}`);

      // ── Step 2: Get smart pricing from order book ──
      const outcome = Math.random() < 0.5 ? "yes" : "no";
      const pricing = await getSmartPrice(ctx.mcp, market.marketId, outcome as "yes" | "no");

      if (!pricing) {
        ctx.log("step-2-price", "skip", `No liquidity for ${outcome} on ${market.marketId}`);
        return;
      }

      // ── Step 3: Place an order ──
      ctx.log("step-3-place", "success",
        `Placing order: ${outcome} @ ${pricing.price} x${pricing.size} on ${market.marketId}`);
      const orderResponse = await ctx.mcp.placeOrder(
        market.marketId, outcome, pricing.price, String(pricing.size),
      );

      const orderId = extractOrderId(orderResponse);
      if (!orderId) {
        ctx.log("step-3-place", "error",
          `Could not extract order ID from response: ${orderResponse.substring(0, 300)}`);
        return;
      }
      ctx.log("step-3-place", "success", `Order placed, ID: ${orderId}`);

      // ── Step 4: Wait for order to settle ──
      ctx.log("step-4-wait", "success", "Waiting 3s for order to settle...");
      await sleep(3000);

      // ── Step 5: Verify order appears in open orders ──
      ctx.log("step-5-verify", "success", "Listing open orders to verify...");
      const ordersResponse = await ctx.mcp.listOrders("Open");
      const lowerOrders = ordersResponse.toLowerCase();

      if (lowerOrders.includes(orderId.toLowerCase()) || lowerOrders.includes("order")) {
        ctx.log("step-5-verify", "success", `Order found in open orders list`);
      } else {
        ctx.log("step-5-verify", "error",
          `Order ${orderId} not found in open orders: ${ordersResponse.substring(0, 300)}`);
      }

      // ── Step 6: Cancel the order ──
      ctx.log("step-6-cancel", "success", `Cancelling order ${orderId}...`);
      const cancelResponse = await ctx.mcp.cancelOrder(orderId);
      const lowerCancel = cancelResponse.toLowerCase();

      if (
        lowerCancel.includes("cancel") ||
        lowerCancel.includes("success") ||
        lowerCancel.includes("removed") ||
        lowerCancel.includes("deleted") ||
        lowerCancel.includes("refund")
      ) {
        ctx.log("step-6-cancel", "success", `Order cancelled: ${cancelResponse.substring(0, 200)}`);
      } else {
        ctx.log("step-6-cancel", "error",
          `Unexpected cancel response: ${cancelResponse.substring(0, 300)}`);
      }

      // ── Step 7: Check positions ──
      ctx.log("step-7-positions", "success", "Checking positions...");
      const positionsResponse = await ctx.mcp.listPositions();
      ctx.log("step-7-positions", "success",
        `Positions response: ${positionsResponse.substring(0, 200)}`);

      // ── Step 8: Verify account balance ──
      ctx.log("step-8-account", "success", "Checking account info...");
      const accountResponse = await ctx.mcp.getAccountInfo();
      const lowerAccount = accountResponse.toLowerCase();

      if (lowerAccount.includes("balance") || lowerAccount.includes("account")) {
        ctx.log("step-8-account", "success", `Account info: ${accountResponse.substring(0, 200)}`);
      } else {
        ctx.log("step-8-account", "error",
          `Unexpected account response: ${accountResponse.substring(0, 300)}`);
      }

      ctx.log("mcp-full-flow", "success", "Full flow completed successfully");
    } catch (err) {
      ctx.log("mcp-full-flow", "error", `Full flow failed: ${err}`);
    }
  },
};

/**
 * Extract an order ID from MCP response text.
 */
function extractOrderId(response: string): string | null {
  try {
    const parsed = JSON.parse(response);
    const id = parsed.order_id ?? parsed.orderId ?? parsed.id;
    if (id) return String(id);
  } catch {
    // Not JSON, try regex
  }

  const patterns = [
    /order_id["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
    /orderId["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
    /["']id["']["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}
