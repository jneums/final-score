import { getMarketWithLiquidity, bpsToFloat, sleep, randomInt, randomChoice } from "../market-utils.js";
export const whale = {
    name: "whale",
    description: "Drops a large order to sweep multiple maker levels",
    tier: "candid",
    budget: { tier: "high", discipline: "impulsive" },
    act: async (ctx) => {
        try {
            const market = await getMarketWithLiquidity(ctx.candid);
            if (!market) {
                ctx.log("whale", "skip", "No market with liquidity found");
                return;
            }
            await sleep(2500);
            const outcome = randomChoice(["Yes", "No"]);
            const askBps = outcome === "Yes" ? market.yesAsk : market.noAsk;
            // Place at or slightly above implied ask to sweep
            const price = bpsToFloat(askBps);
            const size = randomInt(20, 50);
            const result = await ctx.candid.placeOrder(market.marketId, outcome, price, size);
            if (result.ok) {
                const filled = result.data ? Number(result.data.filled) : 0;
                const fills = result.data ? result.data.fills.length : 0;
                ctx.log("whale", "success", `Whale order: ${size} ${outcome} @ ${price.toFixed(4)} in ${market.marketId.slice(0, 8)}… — ` +
                    `filled ${filled}, ${fills} fills, status: ${result.message}`);
            }
            else {
                ctx.log("whale", "error", `Order failed: ${result.message}`);
            }
        }
        catch (e) {
            ctx.log("whale", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
        }
    },
};
