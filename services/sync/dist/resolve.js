import { getUnresolvedMarkets, tryResolveMarket } from "./agent.js";
const resolveLogs = [];
const MAX_LOGS = 200;
function log(action, status, msg) {
    const entry = `[${new Date().toISOString()}] [resolve] [${action}] [${status}] ${msg}`;
    console.log(entry);
    resolveLogs.push(entry);
    if (resolveLogs.length > MAX_LOGS)
        resolveLogs.shift();
}
export function getResolveLogs() {
    return resolveLogs;
}
export async function runResolve() {
    log("start", "info", "Fetching unresolved markets from canister...");
    const markets = await getUnresolvedMarkets();
    log("fetch", "info", `Found ${markets.length} unresolved markets`);
    let resolved = 0;
    let cancelled = 0;
    let waiting = 0;
    let errors = 0;
    // Group by slug so the canister can cache HTTP responses
    // (each try_resolve_market call is independent, but same-slug
    // markets hit the same Polymarket endpoint)
    for (const market of markets) {
        try {
            const result = await tryResolveMarket(market.marketId);
            if (result.ok) {
                // Check message to categorize
                const msg = result.message.toLowerCase();
                if (msg.includes("cancel") || msg.includes("refund")) {
                    cancelled++;
                    log("cancel", "success", `${market.marketId}: ${result.message}`);
                }
                else {
                    resolved++;
                    log("resolve", "success", `${market.marketId}: ${result.message}`);
                }
            }
            else {
                const msg = result.message.toLowerCase();
                if (msg.includes("not closed yet")) {
                    waiting++;
                }
                else if (msg.includes("already resolved") || msg.includes("already cancelled")) {
                    // Skip silently — already handled
                }
                else {
                    errors++;
                    log("resolve", "error", `${market.marketId}: ${result.message}`);
                }
            }
        }
        catch (e) {
            errors++;
            log("resolve", "error", `${market.marketId}: ${String(e).slice(0, 200)}`);
        }
    }
    log("done", "info", `resolved=${resolved} cancelled=${cancelled} waiting=${waiting} errors=${errors} total=${markets.length}`);
    return { resolved, cancelled, waiting, errors, total: markets.length };
}
