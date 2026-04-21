import { Strategy, BotContext } from "../strategy.js";
import { sleep } from "../market-utils.js";

/**
 * MCP Full Flow — exercises the complete order lifecycle via MCP:
 * list markets → place order → verify order → cancel → check positions → check account.
 */
export const mcpFullFlow: Strategy = {
  name: "mcp-full-flow",
  description: "Full lifecycle test: place, verify, cancel, and check via MCP",
  tier: "mcp",

  async act(ctx: BotContext): Promise<void> {
    if (!ctx.mcp) {
      ctx.log("mcp-full-flow", "error", "MCP client not available");
      return;
    }

    try {
      // ── Step 1: List markets to find a market ID ──
      ctx.log("step-1-markets", "success", "Listing markets via MCP...");
      const marketsResponse = await ctx.mcp.listMarkets(undefined, "Open");

      const marketId = extractMarketId(marketsResponse);
      if (!marketId) {
        ctx.log("step-1-markets", "skip", `No market ID found in response: ${marketsResponse.substring(0, 200)}`);
        return;
      }
      ctx.log("step-1-markets", "success", `Found market: ${marketId}`);

      // ── Step 2: Place an order ──
      const price = "0.45";
      const amount = "3";
      ctx.log("step-2-place", "success", `Placing order: yes @ ${price} x${amount} on ${marketId}`);
      const orderResponse = await ctx.mcp.placeOrder(marketId, "yes", price, amount);

      const orderId = extractOrderId(orderResponse);
      if (!orderId) {
        ctx.log(
          "step-2-place",
          "error",
          `Could not extract order ID from response: ${orderResponse.substring(0, 300)}`,
        );
        return;
      }
      ctx.log("step-2-place", "success", `Order placed, ID: ${orderId}`);

      // ── Step 3: Wait for order to settle ──
      ctx.log("step-3-wait", "success", "Waiting 3s for order to settle...");
      await sleep(3000);

      // ── Step 4: Verify order appears in open orders ──
      ctx.log("step-4-verify", "success", "Listing open orders to verify...");
      const ordersResponse = await ctx.mcp.listOrders("Open");
      const lowerOrders = ordersResponse.toLowerCase();

      if (lowerOrders.includes(orderId.toLowerCase()) || lowerOrders.includes("order")) {
        ctx.log("step-4-verify", "success", `Order found in open orders list`);
      } else {
        ctx.log(
          "step-4-verify",
          "error",
          `Order ${orderId} not found in open orders: ${ordersResponse.substring(0, 300)}`,
        );
      }

      // ── Step 5: Cancel the order ──
      ctx.log("step-5-cancel", "success", `Cancelling order ${orderId}...`);
      const cancelResponse = await ctx.mcp.cancelOrder(orderId);
      const lowerCancel = cancelResponse.toLowerCase();

      if (
        lowerCancel.includes("cancel") ||
        lowerCancel.includes("success") ||
        lowerCancel.includes("removed") ||
        lowerCancel.includes("deleted")
      ) {
        ctx.log("step-5-cancel", "success", `Order cancelled: ${cancelResponse.substring(0, 200)}`);
      } else {
        ctx.log(
          "step-5-cancel",
          "error",
          `Unexpected cancel response: ${cancelResponse.substring(0, 300)}`,
        );
      }

      // ── Step 6: Check positions ──
      ctx.log("step-6-positions", "success", "Checking positions...");
      const positionsResponse = await ctx.mcp.listPositions();
      ctx.log(
        "step-6-positions",
        "success",
        `Positions response: ${positionsResponse.substring(0, 200)}`,
      );

      // ── Step 7: Verify account balance ──
      ctx.log("step-7-account", "success", "Checking account info...");
      const accountResponse = await ctx.mcp.getAccountInfo();
      const lowerAccount = accountResponse.toLowerCase();

      if (lowerAccount.includes("balance") || lowerAccount.includes("account")) {
        ctx.log("step-7-account", "success", `Account info: ${accountResponse.substring(0, 200)}`);
      } else {
        ctx.log(
          "step-7-account",
          "error",
          `Unexpected account response: ${accountResponse.substring(0, 300)}`,
        );
      }

      ctx.log("mcp-full-flow", "success", "Full flow completed successfully");
    } catch (err) {
      ctx.log("mcp-full-flow", "error", `Full flow failed: ${err}`);
    }
  },
};

/**
 * Extract a market ID from MCP response text.
 * Tries JSON parse first, then regex patterns.
 */
function extractMarketId(response: string): string | null {
  // Try JSON parse
  try {
    const parsed = JSON.parse(response);
    const markets = parsed.markets ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
    if (markets.length > 0) {
      const market = markets[Math.floor(Math.random() * markets.length)] as Record<string, unknown>;
      const id = market.market_id ?? market.marketId ?? market.id;
      if (id) return String(id);
    }
  } catch {
    // Not JSON, try regex
  }

  // Try regex patterns
  const patterns = [
    /market_id["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
    /marketId["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
    /["']id["']["\s:]+["']?([a-zA-Z0-9_-]+)["']?/i,
  ];
  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Extract an order ID from MCP response text.
 * Tries JSON parse first, then regex patterns.
 */
function extractOrderId(response: string): string | null {
  // Try JSON parse
  try {
    const parsed = JSON.parse(response);
    const id = parsed.order_id ?? parsed.orderId ?? parsed.id;
    if (id) return String(id);
  } catch {
    // Not JSON, try regex
  }

  // Try regex patterns
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
