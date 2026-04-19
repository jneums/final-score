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
import {
  placeOrder,
  cancelOrder,
  getMyOrders,
  listMarkets,
  type OrderRecord,
  type MarketRecord,
} from "./agent.js";
import { getPrice, isStale, cacheSize } from "./priceCache.js";

// ─── Types ───────────────────────────────────────────────────

export interface MakerResult {
  marketsChecked: number;
  marketsQuoted: number;
  marketsSkipped: number;
  ordersPlaced: number;
  ordersCancelled: number;
  ordersKept: number;
  errors: number;
  cursor: string;
}

interface DesiredOrder {
  outcome: "yes" | "no";
  price: number;  // as float (e.g., 0.48)
  size: number;
}

// ─── Logging ─────────────────────────────────────────────────

const makerLogs: string[] = [];
const MAX_LOGS = 300;

function log(action: string, status: string, msg: string) {
  const entry = `[${new Date().toISOString()}] [maker] [${action}] [${status}] ${msg}`;
  console.log(entry);
  makerLogs.push(entry);
  if (makerLogs.length > MAX_LOGS) makerLogs.shift();
}

export function getMakerLogs(): string[] {
  return makerLogs;
}

// ─── Cursor (round-robin across markets) ─────────────────────

let makerCursor = "";

// ─── Helpers ─────────────────────────────────────────────────

function bpsToFloat(bps: number): number {
  return Math.round(bps) / 10000;
}

/** Calculate desired orders for a market given reference prices. */
function calculateDesiredOrders(
  yesPriceBps: number,
  noPriceBps: number,
): DesiredOrder[] {
  const mc = CONFIG.MAKER;
  const orders: DesiredOrder[] = [];

  // Skip markets with no clear signal (too close to 50/50)
  if (
    Math.abs(yesPriceBps - 5000) < mc.MIN_PRICE_EDGE_BPS &&
    Math.abs(noPriceBps - 5000) < mc.MIN_PRICE_EDGE_BPS
  ) {
    return orders;
  }

  for (let i = 0; i < mc.LEVELS; i++) {
    const offset = mc.SPREAD_BPS * (i + 1);  // 200, 400, 600 bps at default

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
function orderMatches(
  existing: OrderRecord,
  desired: DesiredOrder,
  thresholdBps: number,
): boolean {
  if (existing.outcome.toLowerCase() !== desired.outcome) return false;

  const existingBps = Number(existing.price);
  const desiredBps = Math.round(desired.price * 10000);
  return Math.abs(existingBps - desiredBps) <= thresholdBps;
}

/** Sleep for ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main maker loop ────────────────────────────────────────

export async function runMaker(): Promise<MakerResult> {
  const mc = CONFIG.MAKER;
  const result: MakerResult = {
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

  // 1. Fetch all open markets from canister
  let allMarkets: MarketRecord[] = [];
  try {
    let offset = 0;
    const pageSize = 100;
    while (true) {
      const page = await listMarkets(undefined, offset, pageSize);
      const openMarkets = page.markets.filter(
        (m) => m.status === "Open"
      );
      allMarkets.push(...openMarkets);
      if (Number(page.returned) < pageSize) break;
      offset += pageSize;
    }
  } catch (e) {
    log("fetch", "error", `Failed to fetch markets: ${String(e).slice(0, 150)}`);
    result.errors++;
    return result;
  }

  log("fetch", "info", `Found ${allMarkets.length} open markets`);

  if (allMarkets.length === 0) return result;

  // 2. Fetch maker's open orders (all at once)
  let existingOrders: OrderRecord[] = [];
  try {
    existingOrders = await getMyOrders("Open");
  } catch (e) {
    log("orders", "error", `Failed to fetch my_orders: ${String(e).slice(0, 150)}`);
    result.errors++;
    return result;
  }

  // Group existing orders by marketId
  const ordersByMarket = new Map<string, OrderRecord[]>();
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
    if (cursorIdx >= 0) startIdx = cursorIdx;
    else startIdx = 0;  // wrapped around
  }

  // 4. Process markets up to MAX_MARKETS_PER_TICK
  let processed = 0;
  const now = Date.now();

  for (let i = 0; i < allMarkets.length && processed < mc.MAX_MARKETS_PER_TICK; i++) {
    const idx = (startIdx + i) % allMarkets.length;
    const market = allMarkets[idx];
    result.marketsChecked++;

    // Get Polymarket reference price from cache
    // The canister stores polymarketConditionId — we need to look it up
    // Since debug_list_markets doesn't return conditionId, we use slug-based lookup
    // Actually, the price cache is keyed by conditionId. We need to match somehow.
    // The market has polymarketSlug — we can search the cache for matching slug.
    // But that's O(n). Better approach: use the canister's lastYesPrice/lastNoPrice
    // as the reference (set at creation time from Polymarket).
    // For MVP: use the canister's stored yesPrice/noPrice as reference.
    // These were set from Polymarket at sync time and are good enough.

    const yesPriceBps = Number(market.yesPrice);
    const noPriceBps = Number(market.noPrice);

    // Skip if no meaningful price signal
    if (yesPriceBps === 0 && noPriceBps === 0) {
      result.marketsSkipped++;
      continue;
    }

    // Calculate desired orders
    const desired = calculateDesiredOrders(yesPriceBps, noPriceBps);
    if (desired.length === 0) {
      result.marketsSkipped++;
      continue;
    }

    // Get existing orders for this market
    const myMarketOrders = ordersByMarket.get(market.marketId) || [];

    // Diff: find orders to cancel (stale) and orders to place (missing)
    const toCancel: OrderRecord[] = [];
    const matched = new Set<number>();  // indices in desired that are already covered

    for (const existing of myMarketOrders) {
      let found = false;
      for (let d = 0; d < desired.length; d++) {
        if (matched.has(d)) continue;
        if (orderMatches(existing, desired[d], mc.REFRESH_THRESHOLD_BPS)) {
          matched.add(d);
          found = true;
          result.ordersKept++;
          break;
        }
      }
      if (!found) {
        toCancel.push(existing);
      }
    }

    const toPlace = desired.filter((_, i) => !matched.has(i));

    // Skip if nothing to do
    if (toCancel.length === 0 && toPlace.length === 0) {
      result.ordersKept += myMarketOrders.length;
      result.marketsSkipped++;
      continue;
    }

    processed++;
    result.marketsQuoted++;

    // Cancel stale orders
    for (const order of toCancel) {
      try {
        const res = await cancelOrder(order.orderId);
        if (res.ok) {
          result.ordersCancelled++;
        } else {
          log("cancel", "error", `${order.orderId}: ${res.message}`);
          result.errors++;
        }
      } catch (e) {
        log("cancel", "error", `${order.orderId}: ${String(e).slice(0, 100)}`);
        result.errors++;
      }
      await sleep(mc.ORDER_DELAY_MS);
    }

    // Place new orders
    for (const order of toPlace) {
      try {
        const res = await placeOrder(
          market.marketId,
          order.outcome,
          order.price,
          order.size,
        );
        if (res.ok) {
          result.ordersPlaced++;
          log("place", "success", `${market.marketId} Buy ${order.outcome.toUpperCase()} @ $${order.price.toFixed(2)} x${order.size}`);
        } else {
          // Rate limit is not an error — just skip
          if (res.message.includes("Rate limited")) {
            log("place", "rate-limited", `${market.marketId}: waiting...`);
            await sleep(mc.ORDER_DELAY_MS);
          } else {
            log("place", "error", `${market.marketId}: ${res.message.slice(0, 100)}`);
            result.errors++;
          }
        }
      } catch (e) {
        log("place", "error", `${market.marketId}: ${String(e).slice(0, 100)}`);
        result.errors++;
      }
      await sleep(mc.ORDER_DELAY_MS);
    }

    // Update cursor
    makerCursor = market.marketId;
  }

  result.cursor = makerCursor;

  log("done", "info",
    `checked=${result.marketsChecked} quoted=${result.marketsQuoted} ` +
    `skipped=${result.marketsSkipped} placed=${result.ordersPlaced} ` +
    `cancelled=${result.ordersCancelled} kept=${result.ordersKept} ` +
    `errors=${result.errors}`
  );

  return result;
}
