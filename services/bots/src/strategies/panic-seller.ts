import { Strategy } from "../strategy.js";
import { getMarketWithLiquidity, bpsToFloat, sleep, randomInt } from "../market-utils.js";

export const panicSeller: Strategy = {
  name: "panic-seller",
  description: "Buys one side then immediately exits by buying the opposite to trigger netting",
  tier: "candid",
  budget: { tier: "medium", discipline: "impulsive" },
  act: async (ctx) => {
    try {
      const market = await getMarketWithLiquidity(ctx.candid, ctx.sport);
      if (!market) {
        ctx.log("panic-seller", "skip", "No market with liquidity found");
        return;
      }

      await sleep(2500);

      const size = randomInt(2, 5);
      const yesPrice = bpsToFloat(market.yesAsk);

      // Buy Yes first
      const buyResult = await ctx.candid.placeOrder(market.marketId, "Yes", yesPrice, size);

      if (!buyResult.ok) {
        ctx.log("panic-seller", "error", `Initial buy failed: ${buyResult.message}`);
        return;
      }

      ctx.log("panic-seller", "success",
        `Bought ${size} Yes @ ${yesPrice.toFixed(4)} in ${market.marketId.slice(0, 8)}…`);

      // Wait then panic-sell by buying No (triggers netting)
      await sleep(3000);

      // Re-fetch market to get current No ask
      const freshMarket = await getMarketWithLiquidity(ctx.candid, ctx.sport);
      const noAskBps = freshMarket ? freshMarket.noAsk : market.noAsk;
      const noPrice = bpsToFloat(noAskBps);

      const exitResult = await ctx.candid.placeOrder(market.marketId, "No", noPrice, size);

      if (exitResult.ok) {
        ctx.log("panic-seller", "success",
          `Panic exit: ${size} No @ ${noPrice.toFixed(4)} in ${market.marketId.slice(0, 8)}… — ${exitResult.message}`);
      } else {
        ctx.log("panic-seller", "error", `Exit order failed: ${exitResult.message}`);
      }
    } catch (e) {
      ctx.log("panic-seller", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
    }
  },
};
