export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Pick a random open market (optionally filtered by sport)
export async function getRandomOpenMarket(candid, sport) {
    const probe = await candid.listMarkets(sport, 0, 1, "Open");
    const total = Number(probe.total);
    if (total === 0)
        return null;
    const randomOffset = randomInt(0, Math.max(0, total - 1));
    let result = await candid.listMarkets(sport, randomOffset, 20, "Open");
    if (result.markets.length === 0 && randomOffset > 0) {
        result = await candid.listMarkets(sport, 0, 20, "Open");
    }
    if (result.markets.length === 0)
        return null;
    const market = randomChoice(result.markets);
    return {
        marketId: market.marketId,
        question: market.question,
        sport: market.sport,
    };
}
// Pick a market that has liquidity (non-empty order book)
export async function getMarketWithLiquidity(candid, sport) {
    for (let i = 0; i < 5; i++) {
        const market = await getRandomOpenMarket(candid, sport);
        if (!market)
            return null;
        try {
            const book = await candid.getOrderBook(market.marketId, 3);
            const impliedYesAsk = Number(book.impliedYesAsk);
            const impliedNoAsk = Number(book.impliedNoAsk);
            // impliedYesAsk < 10000 means there are actual no-side bids creating a yes ask
            if (impliedYesAsk < 10000) {
                return {
                    marketId: market.marketId,
                    yesAsk: impliedYesAsk,
                    noAsk: impliedNoAsk,
                };
            }
        }
        catch {
            // Order book fetch failed, try next market
            continue;
        }
    }
    return null;
}
// Get a price that's valid for the canister (0.01 increments in bps: 100, 200, ... 9900)
export function snapPrice(priceBps) {
    const clamped = Math.max(100, Math.min(9900, priceBps));
    const snapped = Math.round(clamped / 100) * 100;
    return snapped;
}
// Convert bps to float with epsilon (same as maker)
export function bpsToFloat(bps) {
    const cents = Math.round(bps / 100);
    return cents / 100 + 1e-9;
}
// Random int between min and max (inclusive)
export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
// Random choice from array
export function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
