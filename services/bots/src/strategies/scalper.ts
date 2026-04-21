import { Strategy } from "../strategy.js";
import { getRandomOpenMarket, snapPrice, bpsToFloat, sleep, randomInt } from "../market-utils.js";

export const scalper: Strategy = {
  name: "scalper",
  description: "Places resting limit orders away from mid on both sides",
  tier: "candid",
  act: async (ctx) => {
    try {
      const market = await getRandomOpenMarket(ctx.candid);
      if (!market) {
        ctx.log("scalper", "skip", "No open market found");
        return;
      }

      await sleep(2500);

      const book = await ctx.candid.getOrderBook(market.marketId, 5);
      const impliedYesAsk = Number(book.impliedYesAsk);
      const impliedNoAsk = Number(book.impliedNoAsk);
      const bestYesBid = Number(book.bestYesBid);
      const bestNoBid = Number(book.bestNoBid);

      // Mid prices in bps
      const midYes = Math.round((bestYesBid + impliedYesAsk) / 2);
      const midNo = Math.round((bestNoBid + impliedNoAsk) / 2);

      await sleep(2500);

      // Cancel existing orders in this market
      const existingOrders = await ctx.candid.getMyOrders("Open", market.marketId);
      for (const order of existingOrders) {
        try {
          await ctx.candid.cancelOrder(order.orderId);
          await sleep(2500);
        } catch {
          // ignore cancel failures
        }
      }

      const size = randomInt(2, 5);
      const offsetBps = 500;

      // Place Yes bid below mid
      const yesBidBps = snapPrice(midYes - offsetBps);
      const yesBidPrice = bpsToFloat(yesBidBps);
      const yesResult = await ctx.candid.placeOrder(market.marketId, "Yes", yesBidPrice, size);

      await sleep(2500);

      // Place No bid below mid
      const noBidBps = snapPrice(midNo - offsetBps);
      const noBidPrice = bpsToFloat(noBidBps);
      const noResult = await ctx.candid.placeOrder(market.marketId, "No", noBidPrice, size);

      ctx.log("scalper", "success",
        `Placed Yes bid @ ${yesBidPrice.toFixed(4)} (${yesResult.ok ? "ok" : yesResult.message}), ` +
        `No bid @ ${noBidPrice.toFixed(4)} (${noResult.ok ? "ok" : noResult.message}) ` +
        `in ${market.marketId.slice(0, 8)}…`);
    } catch (e) {
      ctx.log("scalper", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
    }
  },
};
