import { getRandomOpenMarket, bpsToFloat, snapPrice, sleep, randomInt } from "../market-utils.js";
export const pennyBidder = {
    name: "penny-bidder",
    description: "Places extreme low bids at $0.01-$0.05 to test edge of book",
    tier: "candid",
    act: async (ctx) => {
        try {
            const market = await getRandomOpenMarket(ctx.candid);
            if (!market) {
                ctx.log("penny-bidder", "skip", "No open market found");
                return;
            }
            await sleep(2500);
            const size = randomInt(5, 10);
            // Random penny price: $0.01-$0.05 → 100-500 bps
            const yesBps = snapPrice(randomInt(1, 5) * 100);
            const yesPrice = bpsToFloat(yesBps);
            const yesResult = await ctx.candid.placeOrder(market.marketId, "Yes", yesPrice, size);
            await sleep(2500);
            const noBps = snapPrice(randomInt(1, 5) * 100);
            const noPrice = bpsToFloat(noBps);
            const noResult = await ctx.candid.placeOrder(market.marketId, "No", noPrice, size);
            ctx.log("penny-bidder", "success", `Penny bids in ${market.marketId.slice(0, 8)}… — ` +
                `${size} Yes @ ${yesPrice.toFixed(4)} (${yesResult.ok ? "ok" : yesResult.message}), ` +
                `${size} No @ ${noPrice.toFixed(4)} (${noResult.ok ? "ok" : noResult.message})`);
        }
        catch (e) {
            ctx.log("penny-bidder", "error", `Unexpected error: ${String(e).slice(0, 200)}`);
        }
    },
};
