import { getMarketWithLiquidity, bpsToFloat, sleep, randomInt } from "../market-utils.js";
export const hedger = {
    name: "hedger",
    description: "Buys both Yes and No in the same market to trigger position netting",
    tier: "candid",
    act: async (ctx) => {
        try {
            const market = await getMarketWithLiquidity(ctx.candid);
            if (!market) {
                ctx.log("hedger", "skip", "No market with liquidity found");
                return;
            }
            await sleep(2500);
            const size = randomInt(2, 5);
            const yesPrice = bpsToFloat(market.yesAsk);
            const noPrice = bpsToFloat(market.noAsk);
            const yesResult = await ctx.candid.placeOrder(market.marketId, "Yes", yesPrice, size);
            await sleep(2500);
            const noResult = await ctx.candid.placeOrder(market.marketId, "No", noPrice, size);
            ctx.log("hedger", "success", `Hedged ${size} shares in ${market.marketId.slice(0, 8)}… — ` +
                `Yes @ ${yesPrice.toFixed(4)} (${yesResult.ok ? "ok" : yesResult.message}), ` +
                `No @ ${noPrice.toFixed(4)} (${noResult.ok ? "ok" : noResult.message})`);
        }
        catch (e) {
            ctx.log("hedger", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
        }
    },
};
