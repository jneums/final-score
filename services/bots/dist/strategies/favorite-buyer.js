import { getMarketWithLiquidity, bpsToFloat, sleep, randomInt } from "../market-utils.js";
export const favoriteBuyer = {
    name: "favorite-buyer",
    description: "Buys the favorite (lower implied ask)",
    tier: "candid",
    budget: { tier: "medium", discipline: "moderate" },
    act: async (ctx) => {
        try {
            const market = await getMarketWithLiquidity(ctx.candid, ctx.sport);
            if (!market) {
                ctx.log("favorite-buyer", "skip", "No market with liquidity found");
                return;
            }
            await sleep(2500);
            // Determine favorite: the side with the lower implied ask
            const isFavoriteYes = market.yesAsk <= market.noAsk;
            const outcome = isFavoriteYes ? "Yes" : "No";
            const askBps = isFavoriteYes ? market.yesAsk : market.noAsk;
            const price = bpsToFloat(askBps);
            const size = randomInt(1, 5);
            const result = await ctx.candid.placeOrder(market.marketId, outcome, price, size);
            if (result.ok) {
                ctx.log("favorite-buyer", "success", `Bought ${size} ${outcome} @ ${price.toFixed(4)} in ${market.marketId.slice(0, 8)}… — ${result.message}`);
            }
            else {
                ctx.log("favorite-buyer", "error", `Order failed: ${result.message}`);
            }
        }
        catch (e) {
            ctx.log("favorite-buyer", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
        }
    },
};
