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
import { requoteMarketBatch, getMyOrders, listMarkets, getUnresolvedMarkets, } from "./agent.js";
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
/** Re-quote a single market. Cancel-all-then-replace: no diffing, no accumulation. */
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
    let cancelled = 0;
    let placed = 0;
    let errors = 0;
    // Single batch call: cancel all + place all with delta escrow
    const batchOrders = desired.map(o => ({
        outcome: o.outcome,
        price: o.price,
        size: o.size,
    }));
    const res = await requoteMarketBatch(marketId, batchOrders);
    if (res.ok) {
        cancelled = res.data?.cancelled ?? 0;
        placed = res.data?.placed ?? 0;
    }
    else {
        log("requote", "error", `${marketId}: ${res.message}`);
        errors++;
    }
    await sleep(mc.ORDER_DELAY_MS);
    return { cancelled, placed, kept: 0, errors };
}
let isSeedRunning = false;
export function isSeedActive() {
    return isSeedRunning;
}
/**
 * Seed mode: find all open markets that have NO maker orders and quote them.
 * No per-tick cap — runs through every unquoted market in one pass.
 * Uses the batch requote_market endpoint (cancel-all + place-all per market).
 *
 * Called:
 * 1. After sync creates new markets (automatic)
 * 2. Via POST /maker/seed (manual recovery after state wipe)
 * 3. On startup if many markets are unquoted
 */
export async function seedUnquotedMarkets() {
    if (isSeedRunning) {
        log("seed", "skip", "Seed already running");
        return { marketsFound: 0, marketsUnquoted: 0, marketsSeeded: 0, marketsSkipped: 0, ordersPlaced: 0, errors: 0 };
    }
    isSeedRunning = true;
    const result = {
        marketsFound: 0,
        marketsUnquoted: 0,
        marketsSeeded: 0,
        marketsSkipped: 0,
        ordersPlaced: 0,
        errors: 0,
    };
    try {
        if (cacheSize() === 0) {
            log("seed", "skip", "Price cache empty — nothing to seed");
            return result;
        }
        // 1. Fetch all open markets
        let allMarkets = [];
        const conditionIdMap = new Map();
        try {
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
            const unresolved = await getUnresolvedMarkets();
            for (const m of unresolved) {
                conditionIdMap.set(m.marketId, m.polymarketConditionId);
            }
        }
        catch (e) {
            log("seed", "error", `Failed to fetch markets: ${String(e).slice(0, 150)}`);
            result.errors++;
            return result;
        }
        result.marketsFound = allMarkets.length;
        if (allMarkets.length === 0) {
            log("seed", "skip", "No open markets found");
            return result;
        }
        // 2. Fetch maker's existing open orders
        let existingOrders = [];
        try {
            existingOrders = await getMyOrders("Open");
        }
        catch (e) {
            log("seed", "error", `Failed to fetch orders: ${String(e).slice(0, 150)}`);
            result.errors++;
            return result;
        }
        const quotedMarkets = new Set();
        for (const order of existingOrders) {
            quotedMarkets.add(order.marketId);
        }
        // 3. Find unquoted markets (have price data but no maker orders)
        const unquoted = [];
        for (const market of allMarkets) {
            if (quotedMarkets.has(market.marketId))
                continue;
            const conditionId = conditionIdMap.get(market.marketId);
            if (!conditionId)
                continue;
            const cached = getPrice(conditionId);
            if (!cached || isStale(conditionId, CONFIG.MAKER.MAX_PRICE_AGE_MS))
                continue;
            if (cached.yesPrice === 0 && cached.noPrice === 0)
                continue;
            const desired = calculateDesiredOrders(cached.yesPrice, cached.noPrice);
            if (desired.length === 0)
                continue;
            unquoted.push({ market, conditionId });
        }
        result.marketsUnquoted = unquoted.length;
        if (unquoted.length === 0) {
            log("seed", "info", `All ${result.marketsFound} markets already quoted`);
            return result;
        }
        log("seed", "info", `Seeding ${unquoted.length} unquoted markets (${quotedMarkets.size} already quoted)...`);
        // 4. Quote each unquoted market — no cap, just rate-limit spacing
        for (const { market, conditionId } of unquoted) {
            const cached = getPrice(conditionId);
            if (!cached) {
                result.marketsSkipped++;
                continue;
            }
            const desired = calculateDesiredOrders(cached.yesPrice, cached.noPrice);
            if (desired.length === 0) {
                result.marketsSkipped++;
                continue;
            }
            const batchOrders = desired.map(o => ({
                outcome: o.outcome,
                price: o.price,
                size: o.size,
            }));
            const res = await requoteMarketBatch(market.marketId, batchOrders);
            if (res.ok) {
                result.marketsSeeded++;
                result.ordersPlaced += res.data?.placed ?? 0;
            }
            else {
                log("seed", "error", `${market.marketId}: ${res.message}`);
                result.errors++;
            }
            await sleep(CONFIG.MAKER.ORDER_DELAY_MS);
        }
        log("seed", "done", `Seeded ${result.marketsSeeded}/${result.marketsUnquoted} markets, ` +
            `${result.ordersPlaced} orders placed, ${result.errors} errors`);
    }
    finally {
        isSeedRunning = false;
    }
    return result;
}
let isReplenishRunning = false;
export function isReplenishActive() {
    return isReplenishRunning;
}
/**
 * Replenishment job: find markets where orders have been filled (fewer than
 * desired count on the book) and restock them at current cached prices.
 *
 * Unlike seedUnquotedMarkets (which only finds markets with ZERO orders),
 * this finds markets with FEWER than expected orders — partial depletion
 * from user/bot fills while Polymarket prices haven't moved.
 *
 * Unlike the WS reactive path (which only fires on price drift), this
 * runs on a timer regardless of price movement.
 */
export async function replenishDepleted() {
    if (isReplenishRunning) {
        log("replenish", "skip", "Already running");
        return { marketsChecked: 0, marketsDepleted: 0, marketsReplenished: 0, ordersPlaced: 0, ordersCancelled: 0, errors: 0 };
    }
    isReplenishRunning = true;
    const result = {
        marketsChecked: 0,
        marketsDepleted: 0,
        marketsReplenished: 0,
        ordersPlaced: 0,
        ordersCancelled: 0,
        errors: 0,
    };
    try {
        const mc = CONFIG.MAKER;
        if (cacheSize() === 0) {
            log("replenish", "skip", "Price cache empty");
            return result;
        }
        // 1. Fetch maker's current open orders
        let existingOrders = [];
        try {
            existingOrders = await getMyOrders("Open");
        }
        catch (e) {
            log("replenish", "error", `Failed to fetch orders: ${String(e).slice(0, 150)}`);
            result.errors++;
            return result;
        }
        // 2. Group by marketId
        const ordersByMarket = new Map();
        for (const order of existingOrders) {
            const list = ordersByMarket.get(order.marketId) || [];
            list.push(order);
            ordersByMarket.set(order.marketId, list);
        }
        // 3. Get conditionId mapping
        let conditionIdMap;
        try {
            const unresolved = await getUnresolvedMarkets();
            conditionIdMap = new Map(unresolved.map((m) => [m.marketId, m.polymarketConditionId]));
        }
        catch (e) {
            log("replenish", "error", `Failed to fetch unresolved markets: ${String(e).slice(0, 150)}`);
            result.errors++;
            return result;
        }
        // 4. Check each quoted market for depletion
        //    We only look at markets that HAVE some orders (seed handles zero-order markets)
        const depleted = [];
        for (const [marketId, orders] of ordersByMarket) {
            result.marketsChecked++;
            const conditionId = conditionIdMap.get(marketId);
            if (!conditionId)
                continue;
            const cached = getPrice(conditionId);
            if (!cached || isStale(conditionId, mc.MAX_PRICE_AGE_MS))
                continue;
            if (cached.yesPrice === 0 && cached.noPrice === 0)
                continue;
            const desired = calculateDesiredOrders(cached.yesPrice, cached.noPrice);
            if (desired.length === 0)
                continue;
            // Only act if we have fewer orders than desired
            // (partially filled orders still count — requoteMarket handles cancel+replace)
            if (orders.length < desired.length) {
                depleted.push({ marketId, conditionId, currentCount: orders.length, desiredCount: desired.length });
            }
        }
        result.marketsDepleted = depleted.length;
        if (depleted.length === 0) {
            log("replenish", "info", `All ${result.marketsChecked} quoted markets fully stocked`);
            return result;
        }
        log("replenish", "info", `Found ${depleted.length} depleted markets out of ${result.marketsChecked} — restocking...`);
        // 5. Requote each depleted market
        for (const { marketId, conditionId, currentCount, desiredCount } of depleted) {
            const cached = getPrice(conditionId);
            if (!cached)
                continue;
            const desired = calculateDesiredOrders(cached.yesPrice, cached.noPrice);
            if (desired.length === 0)
                continue;
            const batchOrders = desired.map(o => ({
                outcome: o.outcome,
                price: o.price,
                size: o.size,
            }));
            const res = await requoteMarketBatch(marketId, batchOrders);
            if (res.ok) {
                result.marketsReplenished++;
                result.ordersPlaced += res.data?.placed ?? 0;
                result.ordersCancelled += res.data?.cancelled ?? 0;
                log("replenish", "done", `${marketId}: ${currentCount}→${desiredCount} orders (cancelled=${res.data?.cancelled ?? 0}, placed=${res.data?.placed ?? 0})`);
            }
            else {
                log("replenish", "error", `${marketId}: ${res.message}`);
                result.errors++;
            }
            await sleep(mc.ORDER_DELAY_MS);
        }
        log("replenish", "done", `Restocked ${result.marketsReplenished}/${result.marketsDepleted} depleted markets, ` +
            `${result.ordersPlaced} placed, ${result.ordersCancelled} cancelled, ${result.errors} errors`);
    }
    finally {
        isReplenishRunning = false;
    }
    return result;
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
        // Quick check: if order count matches desired and all prices align, skip
        if (myMarketOrders.length === desired.length) {
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
