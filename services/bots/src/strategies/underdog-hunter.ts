import { Strategy } from "../strategy.js";
import { getMarketWithLiquidity, bpsToFloat, sleep, randomInt } from "../market-utils.js";

export const underdogHunter: Strategy = {
  name: "underdog-hunter",
  description: "Buys the underdog (higher implied ask)",
  tier: "candid",
  act: async (ctx) => {
    try {
      const market = await getMarketWithLiquidity(ctx.candid);
      if (!market) {
        ctx.log("underdog-hunter", "skip", "No market with liquidity found");
        return;
      }

      await sleep(2500);

      // Underdog: the side with the higher implied ask
      const isUnderdogYes = market.yesAsk >= market.noAsk;
      const outcome = isUnderdogYes ? "Yes" : "No";
      const askBps = isUnderdogYes ? market.yesAsk : market.noAsk;
      const price = bpsToFloat(askBps);
      const size = randomInt(1, 3);

      const result = await ctx.candid.placeOrder(market.marketId, outcome, price, size);

      if (result.ok) {
        ctx.log("underdog-hunter", "success",
          `Bought ${size} ${outcome} @ ${price.toFixed(4)} in ${market.marketId.slice(0, 8)}… — ${result.message}`);
      } else {
        ctx.log("underdog-hunter", "error", `Order failed: ${result.message}`);
      }
    } catch (e) {
      ctx.log("underdog-hunter", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
    }
  },
};
