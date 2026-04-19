import { CONFIG } from "./config.js";
import { getUnresolvedMarkets, tryResolveMarket } from "./agent.js";

interface ResolveResult {
  resolved: number;
  cancelled: number;
  waiting: number;
  errors: number;
  slugsChecked: number;
  total: number;
}

const resolveLogs: string[] = [];
const MAX_LOGS = 200;

function log(action: string, status: string, msg: string) {
  const entry = `[${new Date().toISOString()}] [resolve] [${action}] [${status}] ${msg}`;
  console.log(entry);
  resolveLogs.push(entry);
  if (resolveLogs.length > MAX_LOGS) resolveLogs.shift();
}

export function getResolveLogs(): string[] {
  return resolveLogs;
}

interface UnresolvedMarket {
  marketId: string;
  polymarketSlug: string;
  polymarketConditionId: string;
  status: string;
}

/**
 * Check Polymarket API (free HTTP) to see if any market in this event is closed.
 * Returns a set of conditionIds that are closed.
 */
async function getClosedConditionIds(slug: string): Promise<Set<string>> {
  const closed = new Set<string>();
  try {
    const resp = await fetch(`${CONFIG.GAMMA_API}/events/slug/${slug}`);
    if (!resp.ok) return closed;
    const event = await resp.json() as any;
    for (const m of event.markets || []) {
      if (m.closed && m.conditionId) {
        closed.add(m.conditionId);
      }
    }
  } catch {
    // Network error — skip this slug
  }
  return closed;
}

/**
 * Strip -a/-b suffix from conditionId to get the base for matching.
 */
function baseCid(cid: string): string {
  if (cid.endsWith("-a") || cid.endsWith("-b")) return cid.slice(0, -2);
  return cid;
}

export async function runResolve(): Promise<ResolveResult> {
  log("start", "info", "Fetching unresolved markets from canister...");

  const markets = await getUnresolvedMarkets();
  log("fetch", "info", `Found ${markets.length} unresolved markets`);

  // Group by slug — one Polymarket API call per event
  const bySlug = new Map<string, UnresolvedMarket[]>();
  for (const m of markets) {
    const existing = bySlug.get(m.polymarketSlug) || [];
    existing.push(m);
    bySlug.set(m.polymarketSlug, existing);
  }

  log("group", "info", `${bySlug.size} unique slugs to check via Polymarket API`);

  let resolved = 0;
  let cancelled = 0;
  let waiting = 0;
  let errors = 0;
  let slugsChecked = 0;

  for (const [slug, slugMarkets] of bySlug) {
    // Step 1: Check Polymarket directly (free HTTP, no cycles)
    const closedCids = await getClosedConditionIds(slug);
    slugsChecked++;

    if (closedCids.size === 0) {
      // No markets closed on Polymarket for this event — skip all
      waiting += slugMarkets.length;
      continue;
    }

    // Step 2: Only call canister for markets whose conditionId is closed on Polymarket
    for (const market of slugMarkets) {
      const base = baseCid(market.polymarketConditionId);
      if (!closedCids.has(base)) {
        waiting++;
        continue;
      }

      // This market's Polymarket counterpart is closed — trigger trustless resolution
      try {
        const result = await tryResolveMarket(market.marketId);

        if (result.ok) {
          const msg = result.message.toLowerCase();
          if (msg.includes("cancel") || msg.includes("refund")) {
            cancelled++;
            log("cancel", "success", `${market.marketId}: ${result.message}`);
          } else {
            resolved++;
            log("resolve", "success", `${market.marketId}: ${result.message}`);
          }
        } else {
          const msg = result.message.toLowerCase();
          if (msg.includes("already resolved") || msg.includes("already cancelled")) {
            // Skip silently
          } else {
            errors++;
            log("resolve", "error", `${market.marketId}: ${result.message}`);
          }
        }
      } catch (e) {
        errors++;
        log("resolve", "error", `${market.marketId}: ${String(e).slice(0, 200)}`);
      }
    }
  }

  log("done", "info", `resolved=${resolved} cancelled=${cancelled} waiting=${waiting} errors=${errors} slugsChecked=${slugsChecked} total=${markets.length}`);
  return { resolved, cancelled, waiting, errors, slugsChecked, total: markets.length };
}
