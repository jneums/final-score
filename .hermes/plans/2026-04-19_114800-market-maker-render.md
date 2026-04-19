# Market Maker — Render Service Integration

## Goal

Add a third loop to the existing Render sync service (`services/sync/`) that provides automated two-sided liquidity on all open Final Score markets. The market maker reads Polymarket reference prices and places Buy Yes + Buy No orders around them, earning the spread.

## Current State

- **Render service** (`services/sync/src/`): Express server with two loops:
  - Sync loop (30min) — discovers markets from Polymarket, calls `admin_create_market`
  - Resolve loop (15min) — calls `get_unresolved_markets` + `try_resolve_market`
- **Python script** (`scripts/market-maker.py`): One-shot MCP-based seeder. Places orders via HTTP JSON-RPC to the canister's MCP endpoint using an API key. Hardcoded 50/50 midpoint, no Polymarket price tracking, no order management.
- **Canister API**: `place_order(marketId, outcome, price, size)` requires authentication (msg.caller). 2-second rate limit per user. Also: `cancel_order`, `my_orders`, `debug_get_order_book`, `debug_list_markets`.

## Architecture Decision: Candid vs MCP

**Use Candid calls (signed with the PEM identity)**, same as sync/resolve. Reasons:
- The PEM identity is already set up in `agent.ts`
- MCP API requires a separate API key and goes through HTTP → JSON-RPC → MCP handler overhead
- `place_order` uses `msg.caller` for auth — a Candid call from the owner identity works directly
- Consistent with how sync (`admin_create_market`) and resolve (`try_resolve_market`) already work

**Caveat**: The market maker should probably use a **separate identity** (not the owner) so it's distinguishable from admin actions and has its own position/order namespace. But for MVP, the owner identity is fine — the canister doesn't restrict who can place orders (just requires non-anonymous caller).

## Strategy

### Polymarket-Following Market Maker

1. **Read reference prices** from Polymarket Gamma API (`outcomePrices` field on each market) or CLOB API (`/midpoint`)
2. **Quote around the reference**: Place Buy Yes and Buy No orders symmetrically around the Polymarket midpoint
3. **Spread**: Configurable, default 4% (2 cents each side). E.g., if Polymarket says Yes=0.60, place:
   - Buy Yes @ $0.58 (reference - 2¢)
   - Buy No @ $0.38 (complement $0.42 - 2¢ = $0.38, which means implied Yes ask = $0.62)
   - This creates a 4¢ spread: $0.58 bid / $0.62 ask
4. **Multiple levels**: e.g., 3 levels at 2¢ spacing → orders at -2¢, -4¢, -6¢ from reference
5. **Fixed size per level**: Configurable, default 10 shares ($1-6 per order depending on price)

### Order Lifecycle

```
For each open market:
  1. Fetch current Polymarket price
  2. Fetch our existing orders (via my_orders)
  3. Fetch current order book depth
  4. Calculate desired quotes
  5. Cancel stale orders (price moved > threshold from our resting order)
  6. Place new orders where gaps exist
  7. Skip if our quotes are already live and within tolerance
```

### Safety Controls

- **Max exposure per market**: Cap total open order value (e.g., $50)
- **Max total exposure**: Cap across all markets (e.g., $500)
- **Price staleness**: Skip if Polymarket data is unavailable or API errors
- **Dead market skip**: Skip markets with no Polymarket price data or where both prices are 50/50 (no signal)
- **Near-expiry skip**: Don't quote markets within 1 hour of endDate
- **Rate limit awareness**: 2-second cooldown per order on canister. With 800+ markets, batch smartly
- **Market status**: Only quote #Open markets (not #Closed, #Resolved)

## Implementation Plan

### Step 1: Extend Candid IDL in `agent.ts`

Add missing methods to the IDL factory:

```typescript
// Add to idlFactory:
place_order: IDL.Func(
  [IDL.Text, IDL.Text, IDL.Float64, IDL.Nat],  // marketId, outcome, price, size
  [IDL.Variant({ ok: IDL.Record({...}), err: IDL.Text })],
  []
),
cancel_order: IDL.Func(
  [IDL.Text],  // orderId
  [IDL.Variant({ ok: IDL.Text, err: IDL.Text })],
  []
),
my_orders: IDL.Func(
  [IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],  // statusFilter, marketFilter
  [IDL.Vec(IDL.Record({...}))],
  ["query"]
),
debug_list_markets: IDL.Func(
  [IDL.Opt(IDL.Text), IDL.Nat, IDL.Nat],  // sportFilter, offset, limit
  [IDL.Record({...})],
  ["query"]
),
debug_get_order_book: IDL.Func(
  [IDL.Text, IDL.Nat],  // marketId, maxLevels
  [IDL.Record({...})],
  ["query"]
),
```

### Step 2: Create `maker.ts`

New file: `services/sync/src/maker.ts`

Core logic:

```typescript
interface MakerConfig {
  spreadBps: number;       // 200 = 2 cents each side (4% total spread)
  levels: number;          // 3 price levels per side
  sizePerLevel: number;    // 10 shares per order
  maxPerMarket: number;    // Max $ exposure per market (e.g., 5000 = $50 in basis points × shares)
  maxTotal: number;        // Max total $ exposure
  refreshThresholdBps: number;  // Re-quote if price moved more than this (100 = 1 cent)
  skipNearExpiryMs: number;     // Skip markets within this many ms of endDate
}

const DEFAULT_CONFIG: MakerConfig = {
  spreadBps: 200,
  levels: 3,
  sizePerLevel: 10,
  maxPerMarket: 5000,  // $50
  maxTotal: 50000,     // $500
  refreshThresholdBps: 100,
  skipNearExpiryMs: 60 * 60 * 1000,  // 1 hour
};

export async function runMaker(): Promise<MakerResult> {
  // 1. Fetch all open markets from canister (debug_list_markets with status open)
  // 2. Fetch our open orders (my_orders with status "open")
  // 3. Group orders by market
  // 4. For each market:
  //    a. Get Polymarket reference price (from Gamma API, cached in sync)
  //    b. Calculate desired quote levels
  //    c. Diff against existing orders
  //    d. Cancel stale orders
  //    e. Place missing orders
  //    f. Respect rate limit (2s between orders + batch across markets)
  // 5. Return stats
}
```

### Step 3: Polymarket Price Feed

Reuse the Gamma API already in `sync.ts`. Two approaches:

**Option A (Simple — MVP):** During each maker tick, fetch current prices from Gamma API for each whitelisted sport. The sync already fetches events — we can cache the `outcomePrices` from the most recent sync run and reuse them.

**Option B (Better):** Use Polymarket CLOB API `/midpoint?token_id=TOKEN_ID` for real-time mid prices. Requires mapping our conditionId back to a CLOB token ID. More accurate but more API calls.

**Recommend Option A for MVP** — the Gamma API `outcomePrices` field is sufficient and we already fetch it during sync. Add a price cache that sync populates.

### Step 4: Price Cache (shared between sync and maker)

New file or export from sync: `priceCache.ts`

```typescript
// Map: conditionId → { yesPrice, noPrice, updatedAt }
const priceCache = new Map<string, {
  yesPrice: number;  // 0-10000 bps
  noPrice: number;
  slug: string;
  updatedAt: Date;
}>();
```

Sync populates this on every run (it already parses `outcomePrices`). Maker reads it.

### Step 5: Order Diffing Logic

For each market, the maker needs to:

1. **Desired state**: N levels × 2 sides = 2N orders at specific prices
2. **Current state**: Existing open orders from `my_orders`
3. **Diff**:
   - Orders at wrong prices (moved > threshold) → cancel
   - Missing price levels → place new orders
   - Orders at correct prices → keep (no-op)

This avoids churning orders when prices haven't moved.

### Step 6: Integrate into `index.ts`

Add the maker loop alongside sync and resolve:

```typescript
// In config.ts:
MAKER_INTERVAL: 5 * 60 * 1000,  // 5 minutes

// In index.ts:
import { runMaker, getMakerLogs } from "./maker.js";

// New state
let isMakerRunning = false;
let lastMaker: Date | null = null;
let lastMakerResult = null;

// New endpoints
app.get("/logs/maker", ...);
app.post("/maker", ...);  // manual trigger

// Maker loop (5 min interval)
const makerLoop = async () => { ... };
setInterval(makerLoop, CONFIG.MAKER_INTERVAL);
```

### Step 7: Health & Observability

Extend the `/` health endpoint:

```json
{
  "maker": {
    "lastRun": "...",
    "lastResult": {
      "marketsQuoted": 15,
      "ordersPlaced": 12,
      "ordersCancelled": 3,
      "ordersKept": 27,
      "errors": 0,
      "totalExposure": 15000
    },
    "nextRun": "...",
    "isRunning": false
  }
}
```

## Rate Limit Strategy

The canister has a **2-second per-user cooldown**. With 800+ markets:

- **Per tick budget**: At 2s/order, a 5-minute tick allows ~150 orders max
- **Prioritize**: Sort markets by volume, recency, or price movement. Quote high-activity markets first.
- **Batch over ticks**: Don't try to quote all markets in one tick. Track a cursor like the resolve loop does.
- **Skip stable markets**: If our orders are still within tolerance, skip (most markets won't need re-quoting every tick)

Practical estimate: With 3 levels × 2 sides = 6 orders per market, quoting 25 markets per tick = 150 orders = 5 minutes at 2s/order. Full cycle through 200 active markets = 8 ticks × 5 min = 40 minutes.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `services/sync/src/maker.ts` | Create | Core market maker logic |
| `services/sync/src/priceCache.ts` | Create | Shared price cache between sync and maker |
| `services/sync/src/agent.ts` | Modify | Add `place_order`, `cancel_order`, `my_orders`, `debug_list_markets`, `debug_get_order_book` to IDL |
| `services/sync/src/config.ts` | Modify | Add `MAKER_INTERVAL`, maker config params |
| `services/sync/src/index.ts` | Modify | Add maker loop, endpoints, health data |
| `services/sync/src/sync.ts` | Modify | Populate price cache during sync |

## Open Questions

1. **Separate identity?** Should the market maker use its own DFX identity (separate principal) so orders are distinguishable from admin/user orders? This would need a second PEM env var. Not critical for MVP but cleaner long-term.

2. **Funding**: The market maker identity needs USDC balance + `icrc2_approve` on the token ledger. How do we fund it initially? Manual transfer + approve, or automate?

3. **Cancellation on resolution**: When a market resolves, do our open orders get auto-cancelled by the canister, or does the maker need to clean them up?

4. **Quote asymmetry**: Should we bias quotes toward the Polymarket reference (tighter spread on the consensus side) or always quote symmetrically? Symmetric is simpler and lower risk.

5. **Self-trade**: The maker's own Yes and No orders can match each other (complement pricing). This is fine — documented in the skill as a legitimate hedge — but it means the maker is essentially just seeding the book at cost, not capturing spread from itself. Spread capture only happens when external users trade against the maker's resting orders.

6. **Order size scaling**: Should bigger markets (higher volume/liquidity) get larger order sizes? MVP: fixed size. Future: scale with market activity.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Polymarket price is wrong/stale | Maker posts bad quotes, gets adversely selected | Skip if price age > 2 hours; don't quote during resolution window |
| Rate limit exhaustion | Can't quote all markets | Cursor-based round-robin, prioritize by activity |
| USDC balance runs out | Orders fail silently | Track exposure, alert when balance low via health endpoint |
| Self-trading burns fees | 2 × $0.01 per self-fill | Accept as cost of seeding; self-fills produce net zero P&L |
| Market resolves with open orders | Positions stuck, need manual drain | Verify canister auto-cancels on resolution |

## Validation

1. Run locally with `npm run dev` — verify maker loop fires
2. Check `/logs/maker` — verify order placement logs
3. Check canister `my_orders` — verify orders are visible on-chain
4. Check `debug_get_order_book` — verify book has two-sided depth
5. Move Polymarket price (or use a test market) — verify maker cancels + re-quotes
6. Deploy to Render — verify all three loops run concurrently
