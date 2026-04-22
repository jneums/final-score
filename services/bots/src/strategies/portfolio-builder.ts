import { Strategy } from "../strategy.js";
import { getRandomOpenMarket, bpsToFloat, sleep, randomInt } from "../market-utils.js";

export const portfolioBuilder: Strategy = {
  name: "portfolio-builder",
  description: "Spreads small bets across multiple markets, skipping ones already held",
  tier: "candid",
  budget: { tier: "medium", discipline: "moderate" },
  act: async (ctx) => {
    try {
      const numMarkets = randomInt(3, 5);
      const visited = new Set<string>();

      // Get existing positions to avoid duplicates
      const positions = await ctx.candid.getMyPositions();
      const heldMarkets = new Set(positions.map(p => p.marketId));

      await sleep(2500);

      let placed = 0;
      for (let i = 0; i < numMarkets + 3; i++) { // extra attempts for collisions/skips
        if (placed >= numMarkets) break;

        const market = await getRandomOpenMarket(ctx.candid, ctx.sport);
        if (!market) continue;
        if (visited.has(market.marketId)) continue;
        visited.add(market.marketId);

        if (heldMarkets.has(market.marketId)) {
          ctx.log("portfolio-builder", "skip", `Already holding position in ${market.marketId.slice(0, 8)}…`);
          await sleep(2500);
          continue;
        }

        await sleep(2500);

        // Get order book to find the favorite
        try {
          const book = await ctx.candid.getOrderBook(market.marketId, 3);
          const yesAsk = Number(book.impliedYesAsk);
          const noAsk = Number(book.impliedNoAsk);

          const isFavoriteYes = yesAsk <= noAsk;
          const outcome = isFavoriteYes ? "Yes" : "No";
          const askBps = isFavoriteYes ? yesAsk : noAsk;

          // If no liquidity (ask at 10000), place at a reasonable default
          const priceBps = askBps < 10000 ? askBps : 5000;
          const price = bpsToFloat(priceBps);
          const size = randomInt(1, 3);

          await sleep(2500);

          const result = await ctx.candid.placeOrder(market.marketId, outcome, price, size);
          if (result.ok) {
            placed++;
            ctx.log("portfolio-builder", "success",
              `[${placed}/${numMarkets}] ${size} ${outcome} @ ${price.toFixed(4)} in ${market.marketId.slice(0, 8)}…`);
          } else {
            ctx.log("portfolio-builder", "error", `Order failed in ${market.marketId.slice(0, 8)}…: ${result.message}`);
          }
        } catch {
          // Order book fetch failed, skip
          continue;
        }
      }

      if (placed === 0) {
        ctx.log("portfolio-builder", "skip", "Could not place any orders");
      }
    } catch (e) {
      ctx.log("portfolio-builder", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
    }
  },
};
