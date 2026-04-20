/**
 * Market Maker — Polymarket-following, two-sided quoting.
 *
 * Strategy: Read Polymarket reference prices, place symmetric Buy Yes + Buy No
 * orders around that reference. Cancel and re-quote when prices drift.
 *
 * Uses a separate DFX identity (MAKER_IDENTITY_PEM) so orders are distinguishable
 * from admin actions.
 */
import { CONFIG } from "./config.js";
import { placeOrder, cancelOrder, getMyOrders, listMarkets, getUnresolvedMarkets, } from "./agent.js";
import { getPrice, isStale, cacheSize } from "./priceCache.js";
// ─── Logging ─────────────────────────────────────────────────
const makerLogs = [];
const MAX_LOGS = 300;
function log(action, status, msg) {
    const entry = `[${new Date().toISOString()}] [maker] [${action}] [${status}] ${msg}`;
    console.log(entry);
    makerLogs.push(entry);
    if (makerLogs.length > MAX_LOGS)
        makerLogs.shift();
}
export function getMakerLogs() {
    return makerLogs;
}
// ─── Cursor (round-robin across markets) ─────────────────────
let makerCursor = "";
// ─── Helpers ─────────────────────────────────────────────────
function bpsToFloat(bps) {
    // Convert basis points to a float price for the canister's place_order(price: Float).
    // The canister does Float.toInt(price * 10000.0) and checks priceBps % 100 == 0.
    // To avoid IEEE754 drift (e.g., 0.43 * 10000 = 4299.999...), we snap to
    // the nearest cent and add a tiny epsilon so truncation lands on the right integer.
    const cents = Math.round(bps / 100);
    return cents / 100 + 1e-9; // 0.4300000001 * 10000 = 4300.000001 → truncates to 4300 ✓
}
/** Calculate desired orders for a market given reference prices. */
function calculateDesiredOrders(yesPriceBps, noPriceBps) {
    const mc = CONFIG.MAKER;
    const orders = [];
    // Skip markets with no clear signal (too close to 50/50)
    if (Math.abs(yesPriceBps - 5000) < mc.MIN_PRICE_EDGE_BPS &&
        Math.abs(noPriceBps - 5000) < mc.MIN_PRICE_EDGE_BPS) {
        return orders;
    }
    for (let i = 0; i < mc.LEVELS; i++) {
        const offset = mc.SPREAD_BPS * (i + 1); // 200, 400, 600 bps at default
        // Buy Yes: bid below reference
        const yesBid = yesPriceBps - offset;
        if (yesBid >= 100 && yesBid <= 9900) {
            orders.push({
                outcome: "yes",
                price: bpsToFloat(yesBid),
                size: mc.SIZE_PER_LEVEL,
            });
        }
        // Buy No: bid below reference
        const noBid = noPriceBps - offset;
        if (noBid >= 100 && noBid <= 9900) {
            orders.push({
                outcome: "no",
                price: bpsToFloat(noBid),
                size: mc.SIZE_PER_LEVEL,
            });
        }
    }
    return orders;
}
/** Check if an existing order matches a desired order within tolerance. */
function orderMatches(existing, desired, thresholdBps) {
    if (existing.outcome.toLowerCase() !== desired.outcome)
        return false;
    const existingBps = Number(existing.price);
    const desiredBps = Math.round(desired.price * 10000);
    return Math.abs(existingBps - desiredBps) <= thresholdBps;
}
/** Sleep for ms. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ─── Requote queue (fed by WebSocket price changes) ──────────
const requoteQueue = new Set(); // conditionIds needing re-quote
let isRequoteRunning = false;
/** Queue a conditionId for reactive re-quote (called from ws.ts). */
export function queueRequote(conditionId) {
    requoteQueue.add(conditionId);
    // Debounce — process the queue after a short delay
    if (!isRequoteRunning) {
        setTimeout(processRequoteQueue, 500);
    }
}
/** Process all queued re-quotes. */
async function processRequoteQueue() {
    if (isRequoteRunning || requoteQueue.size === 0)
        return;
    isRequoteRunning = true;
    const conditionIds = [...requoteQueue];
    requoteQueue.clear();
    log("requote", "info", `Processing ${conditionIds.length} reactive re-quote(s)`);
    // Need the conditionId → marketId reverse map
    // Fetch maker's current open orders once for all re-quotes
    let existingOrders = [];
    try {
        existingOrders = await getMyOrders("Open");
    }
    catch (e) {
        log("requote", "error", `Failed to fetch orders: ${String(e).slice(0, 100)}`);
        isRequoteRunning = false;
        return;
    }
    // We need conditionId → marketId mapping from the unresolved markets list
    let conditionToMarketId;
    try {
        const unresolved = await getUnresolvedMarkets();
        conditionToMarketId = new Map(unresolved.map((m) => [m.polymarketConditionId, m.marketId]));
    }
    catch (e) {
        log("requote", "error", `Failed to fetch unresolved markets: ${String(e).slice(0, 100)}`);
        isRequoteRunning = false;
        return;
    }
    const ordersByMarket = new Map();
    for (const order of existingOrders) {
        const list = ordersByMarket.get(order.marketId) || [];
        list.push(order);
        ordersByMarket.set(order.marketId, list);
    }
    for (const conditionId of conditionIds) {
        const marketId = conditionToMarketId.get(conditionId);
        if (!marketId)
            continue;
        const myOrders = ordersByMarket.get(marketId) || [];
        const stats = await requoteMarket(marketId, conditionId, myOrders);
        if (stats) {
            log("requote", "done", `${marketId}: cancelled=${stats.cancelled} placed=${stats.placed} kept=${stats.kept}`);
        }
    }
    isRequoteRunning = false;
}
/** Re-quote a single market. Shared logic used by both full loop and reactive re-quote. */
async function requoteMarket(marketId, conditionId, myMarketOrders) {
    const mc = CONFIG.MAKER;
    const cached = getPrice(conditionId);
    if (!cached)
        return null;
    if (isStale(conditionId, mc.MAX_PRICE_AGE_MS))
        return null;
    const yesPriceBps = cached.yesPrice;
    const noPriceBps = cached.noPrice;
    if (yesPriceBps === 0 && noPriceBps === 0)
        return null;
    const desired = calculateDesiredOrders(yesPriceBps, noPriceBps);
    if (desired.length === 0)
        return null;
    // Diff: find orders to cancel (stale) and orders to place (missing)
    const toCancel = [];
    const matched = new Set();
    let kept = 0;
    for (const existing of myMarketOrders) {
        let found = false;
        for (let d = 0; d < desired.length; d++) {
            if (matched.has(d))
                continue;
            if (orderMatches(existing, desired[d], mc.REFRESH_THRESHOLD_BPS)) {
                matched.add(d);
                found = true;
                kept++;
                break;
            }
        }
        if (!found) {
            toCancel.push(existing);
        }
    }
    const toPlace = desired.filter((_, i) => !matched.has(i));
    if (toCancel.length === 0 && toPlace.length === 0) {
        return { cancelled: 0, placed: 0, kept: myMarketOrders.length, errors: 0 };
    }
    let cancelled = 0;
    let placed = 0;
    let errors = 0;
    // Cancel stale orders
    for (const order of toCancel) {
        try {
            const res = await cancelOrder(order.orderId);
            if (res.ok) {
                cancelled++;
            }
            else {
                log("cancel", "error", `${order.orderId}: ${res.message}`);
                errors++;
            }
        }
        catch (e) {
            log("cancel", "error", `${order.orderId}: ${String(e).slice(0, 100)}`);
            errors++;
        }
        await sleep(mc.ORDER_DELAY_MS);
    }
    // Place new orders
    for (const order of toPlace) {
        try {
            const res = await placeOrder(marketId, order.outcome, order.price, order.size);
            if (res.ok) {
                placed++;
                log("place", "success", `${marketId} Buy ${order.outcome.toUpperCase()} @ $${order.price.toFixed(4)} x${order.size}`);
            }
            else {
                if (res.message.includes("Rate limited")) {
                    log("place", "rate-limited", `${marketId}: waiting...`);
                    await sleep(mc.ORDER_DELAY_MS);
                }
                else {
                    log("place", "error", `${marketId} ${order.outcome}@${order.price.toFixed(4)}: ${res.message.slice(0, 100)}`);
                    errors++;
                }
            }
        }
        catch (e) {
            log("place", "error", `${marketId}: ${String(e).slice(0, 100)}`);
            errors++;
        }
        await sleep(mc.ORDER_DELAY_MS);
    }
    return { cancelled, placed, kept, errors };
}
// ─── Main maker loop ────────────────────────────────────────
export async function runMaker() {
    const mc = CONFIG.MAKER;
    const result = {
        marketsChecked: 0,
        marketsQuoted: 0,
        marketsSkipped: 0,
        ordersPlaced: 0,
        ordersCancelled: 0,
        ordersKept: 0,
        errors: 0,
        cursor: makerCursor,
    };
    if (cacheSize() === 0) {
        log("start", "skip", "Price cache empty — waiting for first sync to populate");
        return result;
    }
    log("start", "info", `Price cache has ${cacheSize()} entries`);
    // 1. Fetch all open markets from canister (with conditionId for price cache lookup)
    let allMarkets = [];
    const conditionIdMap = new Map(); // marketId → conditionId
    try {
        // Get open markets
        let offset = 0;
        const pageSize = 100;
        while (true) {
            const page = await listMarkets(undefined, offset, pageSize);
            const openMarkets = page.markets.filter((m) => m.status === "Open");
            allMarkets.push(...openMarkets);
            if (Number(page.returned) < pageSize)
                break;
            offset += pageSize;
        }
        // Get conditionIds from unresolved markets query
        const unresolved = await getUnresolvedMarkets();
        for (const m of unresolved) {
            conditionIdMap.set(m.marketId, m.polymarketConditionId);
        }
    }
    catch (e) {
        log("fetch", "error", `Failed to fetch markets: ${String(e).slice(0, 150)}`);
        result.errors++;
        return result;
    }
    log("fetch", "info", `Found ${allMarkets.length} open markets`);
    if (allMarkets.length === 0)
        return result;
    // 2. Fetch maker's open orders (all at once)
    let existingOrders = [];
    try {
        existingOrders = await getMyOrders("Open");
    }
    catch (e) {
        log("orders", "error", `Failed to fetch my_orders: ${String(e).slice(0, 150)}`);
        result.errors++;
        return result;
    }
    // Group existing orders by marketId
    const ordersByMarket = new Map();
    for (const order of existingOrders) {
        const list = ordersByMarket.get(order.marketId) || [];
        list.push(order);
        ordersByMarket.set(order.marketId, list);
    }
    log("orders", "info", `Maker has ${existingOrders.length} open orders across ${ordersByMarket.size} markets`);
    // 3. Sort markets for round-robin from cursor
    allMarkets.sort((a, b) => a.marketId.localeCompare(b.marketId));
    let startIdx = 0;
    if (makerCursor) {
        const cursorIdx = allMarkets.findIndex((m) => m.marketId > makerCursor);
        if (cursorIdx >= 0)
            startIdx = cursorIdx;
        else
            startIdx = 0; // wrapped around
    }
    // 4. Process markets up to MAX_MARKETS_PER_TICK
    let processed = 0;
    for (let i = 0; i < allMarkets.length && processed < mc.MAX_MARKETS_PER_TICK; i++) {
        const idx = (startIdx + i) % allMarkets.length;
        const market = allMarkets[idx];
        result.marketsChecked++;
        const conditionId = conditionIdMap.get(market.marketId);
        if (!conditionId) {
            result.marketsSkipped++;
            continue;
        }
        const cached = getPrice(conditionId);
        if (!cached || isStale(conditionId, mc.MAX_PRICE_AGE_MS)) {
            result.marketsSkipped++;
            continue;
        }
        if (cached.yesPrice === 0 && cached.noPrice === 0) {
            result.marketsSkipped++;
            continue;
        }
        const desired = calculateDesiredOrders(cached.yesPrice, cached.noPrice);
        if (desired.length === 0) {
            result.marketsSkipped++;
            continue;
        }
        const myMarketOrders = ordersByMarket.get(market.marketId) || [];
        // Quick check: if all orders match, skip without calling requoteMarket
        let allMatch = true;
        const tempMatched = new Set();
        for (const existing of myMarketOrders) {
            let found = false;
            for (let d = 0; d < desired.length; d++) {
                if (tempMatched.has(d))
                    continue;
                if (orderMatches(existing, desired[d], mc.REFRESH_THRESHOLD_BPS)) {
                    tempMatched.add(d);
                    found = true;
                    break;
                }
            }
            if (!found) {
                allMatch = false;
                break;
            }
        }
        if (allMatch && tempMatched.size === desired.length) {
            result.ordersKept += myMarketOrders.length;
            result.marketsSkipped++;
            continue;
        }
        processed++;
        result.marketsQuoted++;
        const stats = await requoteMarket(market.marketId, conditionId, myMarketOrders);
        if (stats) {
            result.ordersCancelled += stats.cancelled;
            result.ordersPlaced += stats.placed;
            result.ordersKept += stats.kept;
            result.errors += stats.errors;
        }
        // Update cursor
        makerCursor = market.marketId;
    }
    result.cursor = makerCursor;
    log("done", "info", `checked=${result.marketsChecked} quoted=${result.marketsQuoted} ` +
        `skipped=${result.marketsSkipped} placed=${result.ordersPlaced} ` +
        `cancelled=${result.ordersCancelled} kept=${result.ordersKept} ` +
        `errors=${result.errors}`);
    return result;
}
