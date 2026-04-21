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
export function parseMarketDetail(response: string): MarketPricing | null {
  try {
    const parsed = JSON.parse(response);
    const book = parsed.order_book;
    if (!book) return null;

    const bestYesBid = Number(book.best_yes_bid ?? 0);
    const bestNoBid = Number(book.best_no_bid ?? 0);
    const spread = Number(book.spread_bps ?? 0);

    // Implied ask: the price to BUY Yes shares = 10000 - bestNoBid
    // (because buying Yes means matching against resting No bids)
    const impliedYesAsk = bestNoBid > 0 ? 10000 - bestNoBid : 10000;
    const impliedNoAsk = bestYesBid > 0 ? 10000 - bestYesBid : 10000;

    return {
      marketId: String(parsed.market_id ?? ""),
      bestYesBid,
      bestNoBid,
      impliedYesAsk,
      impliedNoAsk,
      spread,
      polyYesPrice: Number(parsed.polymarket_yes_price ?? 5000),
      polyNoPrice: Number(parsed.polymarket_no_price ?? 5000),
    };
  } catch {
    return null;
  }
}

/**
 * Parse market IDs + prices from markets_list response.
 * Returns array of {marketId, yesPrice, noPrice} (bps).
 */
export function parseMarketList(response: string): Array<{
  marketId: string;
  yesPrice: number;
  noPrice: number;
}> {
  try {
    const parsed = JSON.parse(response);
    const markets = parsed.markets ?? parsed.data ?? (Array.isArray(parsed) ? parsed : []);
    return markets
      .filter((m: Record<string, unknown>) => m.market_id || m.marketId || m.id)
      .map((m: Record<string, unknown>) => ({
        marketId: String(m.market_id ?? m.marketId ?? m.id),
        yesPrice: Number(m.yes_price ?? m.yesPrice ?? 5000),
        noPrice: Number(m.no_price ?? m.noPrice ?? 5000),
      }));
  } catch {
    return [];
  }
}

/**
 * Get smart pricing for a market via MCP.
 * Calls market_detail and returns a sensible limit price based on the book.
 */
export async function getSmartPrice(
  mcp: McpClient,
  marketId: string,
  outcome: "yes" | "no",
): Promise<{ price: string; size: number } | null> {
  try {
    const detail = await mcp.getMarketDetail(marketId);
    const pricing = parseMarketDetail(detail);

    if (!pricing) return null;

    // Get the implied ask for our desired outcome
    const impliedAskBps = outcome === "yes" ? pricing.impliedYesAsk : pricing.impliedNoAsk;

    if (impliedAskBps >= 10000) {
      // No liquidity on this side — skip or use Polymarket reference
      const polyRef = outcome === "yes" ? pricing.polyYesPrice : pricing.polyNoPrice;
      if (polyRef > 0 && polyRef < 10000) {
        // Place a resting order near Polymarket price
        const priceBps = Math.round(polyRef / 100) * 100; // snap to cents
        const price = Math.max(100, Math.min(9900, priceBps));
        return {
          price: (price / 10000).toFixed(2),
          size: randomInt(1, 5),
        };
      }
      return null;
    }

    // Place at the implied ask (to get filled) with some randomization
    // Sometimes match exactly, sometimes slightly below (resting limit)
    const jitter = randomChoice([0, 0, 0, -100, -200]); // 60% at-market, 40% slightly below
    const priceBps = Math.max(100, Math.min(9900, impliedAskBps + jitter));
    const priceFloat = priceBps / 10000;

    // Size based on spread — tighter spread = more confident = bigger size
    const size = pricing.spread < 500 ? randomInt(3, 10) : randomInt(1, 5);

    return {
      price: priceFloat.toFixed(2),
      size,
    };
  } catch {
    return null;
  }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
