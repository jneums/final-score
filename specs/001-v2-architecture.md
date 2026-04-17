# Final Score v2 — Architecture Spec

**Status:** Draft v0.1
**Milestone:** v2.0
**Date:** 2026-04-17

---

## 1. Goal

Replace the parimutuel betting model with a prediction-market order book, powered by Polymarket's free sports data and decentralized resolution. Eliminate the Football API and Football Oracle dependencies entirely. Launch with all Polymarket sports from day one.

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ICP Canister (Motoko)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Market   │  │  Order Book  │  │    Settlement     │  │
│  │ Registry │  │   Engine     │  │    & Payouts      │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│       │               │                   │              │
│  ┌────┴───────────────┴───────────────────┴──────────┐  │
│  │              Stable State (Maps)                   │  │
│  │  markets · orders · positions · balances · stats   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ USDC Ledger │  │ MCP SDK  │  │ Prometheus/Beacon  │  │
│  │ (ICRC-1/2)  │  │ (Tools)  │  │ (Analytics)        │  │
│  └─────────────┘  └──────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────┘
           ▲                              ▲
           │ ICRC-2 transfers             │ HTTP outcalls
           ▼                              ▼
    ┌─────────────┐              ┌─────────────────────┐
    │  ICP USDC   │              │  Polymarket Gamma   │
    │  Ledger     │              │  API (free, public)  │
    └─────────────┘              └─────────────────────┘
```

## 3. Data Source: Polymarket Gamma API

All market data comes from Polymarket's public Gamma API. No API key required.

**Base URL:** `https://gamma-api.polymarket.com`

### 3.1 Sport Discovery

```
GET /sports → list of all sports with tag IDs
```

Each sport has: `id`, `sport` (slug), `tags` (comma-separated tag IDs), `series`.

### 3.2 Event/Market Discovery

```
GET /events?tag_id={sport_tag}&active=true&closed=false&limit=100&offset=0
```

Events contain nested markets. For a typical match (e.g., EPL "Man City vs Crystal Palace"):
- **Moneyline:** 3 binary markets (Home Win Y/N, Away Win Y/N, Draw Y/N)
- **Spread:** Multiple spread lines per team (-1.5, -2.5, etc.)
- **Totals:** Over/under lines (O/U 1.5, 2.5, 3.5)

### 3.3 Resolution Detection

```
GET /events/{slug} → check market.closed == true
```

When resolved:
- Winning outcome's `outcomePrices` → `"1"` (or `"0.999..."`)
- Losing outcome's `outcomePrices` → `"0"` (or `"0.001..."`)
- `closed` field → `true`

### 3.4 Real-Time Prices (for reference/seeding)

```
GET https://clob.polymarket.com/price?token_id={clob_token_id}
GET https://clob.polymarket.com/prices-history?market={clob_token_id}
```

## 4. Market Model

### 4.1 Market Types

v2 launches with **moneyline only**, but the data model supports all types:

```motoko
type MarketType = {
  #Moneyline;        // v2.0 — "Will Team A win?"
  #Spread : Float;   // future — "Team A -1.5"
  #Total : Float;    // future — "Over/Under 2.5 goals"
};
```

### 4.2 Market Structure

Each market is a single binary question (Yes/No):

```motoko
type Market = {
  marketId : Text;                    // local sequential ID
  question : Text;                    // "Will Arsenal win vs Chelsea?"
  eventTitle : Text;                  // "Arsenal vs Chelsea"
  sport : Text;                       // "epl"
  marketType : MarketType;
  outcomes : (Text, Text);            // ("Yes", "No")

  // Polymarket reference data
  polymarketSlug : Text;              // "epl-ars-che-2026-04-20"
  polymarketConditionId : Text;       // on-chain condition ID
  polymarketTokenIds : (Text, Text);  // CLOB token IDs for Yes/No

  // Timing
  endDate : Int;                      // nanoseconds, from Polymarket endDate
  bettingDeadline : Int;              // endDate - 5 minutes

  // Order book state
  status : MarketStatus;
  lastYesPrice : Float;               // last trade price for Yes
  lastNoPrice : Float;                // last trade price for No
  totalVolume : Nat;                  // total USDC matched

  // Reference price from Polymarket (informational)
  polymarketYesPrice : Float;
  polymarketNoPrice : Float;
};

type MarketStatus = {
  #Open;                              // accepting orders
  #Suspended;                         // temporarily halted (e.g., in-play)
  #Closed;                            // no more orders, awaiting resolution
  #Resolved : Outcome;                // settled — Yes or No won
  #Cancelled;                         // refund all
};

type Outcome = {
  #Yes;
  #No;
};
```

### 4.3 Multi-Market Events

A single match produces multiple markets. The `polymarketSlug` groups them:

```
Event: "Arsenal vs Chelsea" (slug: epl-ars-che-2026-04-20)
  ├── Market 0: "Will Arsenal win?" (Moneyline)
  ├── Market 1: "Will it be a draw?" (Moneyline)
  └── Market 2: "Will Chelsea win?" (Moneyline)
```

Future (spread/totals):
```
  ├── Market 3: "Arsenal -1.5" (Spread)
  ├── Market 4: "Over 2.5 goals" (Total)
  └── ...
```

## 5. Order Book Engine

### 5.1 Order Structure

```motoko
type Side = { #Buy; #Sell };

type Order = {
  orderId : Text;
  marketId : Text;
  user : Principal;
  side : Side;                  // Buy or Sell
  outcome : Outcome;            // Yes or No
  price : Nat;                  // in basis points 1-9999 (0.01¢ to 99.99¢)
  size : Nat;                   // number of shares (1 share = 1 USDC @ $1)
  filledSize : Nat;             // shares already matched
  status : OrderStatus;
  timestamp : Int;
};

type OrderStatus = {
  #Open;
  #PartiallyFilled;
  #Filled;
  #Cancelled;
};
```

### 5.2 Pricing — Shares Model

Each share pays out **$1.00 (1_000_000 base units)** if the outcome is correct, **$0.00** if wrong.

- **Buying Yes at $0.60** means risking $0.60 to win $1.00 (profit: $0.40)
- **Buying No at $0.40** means risking $0.40 to win $1.00 (profit: $0.60)
- Yes price + No price ≈ $1.00 (the spread is the market's edge)

Price is stored as basis points (1 = $0.0001, 9999 = $0.9999):
- `price: 6000` = $0.60 per share
- `size: 10` = 10 shares
- `cost: 6_000_000` base units ($6.00 USDC)

### 5.3 Matching Logic

Standard price-time priority (FIFO):

1. New **Buy Yes @ 60¢** checks the **Sell Yes** (or equivalently **Buy No**) book
2. If a resting order exists at ≤ 60¢, match at the resting price
3. Unmatched remainder rests on the book
4. Matching creates two positions: buyer gets Yes shares, counterparty gets No shares

**Key equivalence:** Buying Yes at price P = Selling No at price (1-P).
Internally we can normalize all orders to Buy Yes / Buy No and match when:
  `best_yes_bid + best_no_bid >= 10000` (prices complement to $1.00)

### 5.4 Escrow

When an order is placed:
- Lock `price × size` USDC from the user's canister balance
- On match: allocate shares to both sides
- On cancel: refund locked USDC
- On resolution: winning shares redeem at $1.00, losing shares at $0.00

### 5.5 Fees

```
MAKER_FEE_BPS = 0       // 0% for resting orders (incentivize liquidity)
TAKER_FEE_BPS = 100     // 1% for aggressive orders
PROTOCOL_RAKE_BPS = 200  // 2% on winning redemptions (same as v1)
```

Taker fee is deducted from the matched amount at fill time.
Protocol rake is deducted at redemption (payout = shares × $1.00 − rake).

## 6. Settlement & Resolution

### 6.1 Resolution Flow

```
Timer (every 5 min) → for each market where now > endDate:
  1. HTTP outcall to Gamma API: GET /events/slug/{polymarketSlug}
  2. Find the matching market by conditionId
  3. If market.closed == true:
     a. Read outcomePrices to determine winner
     b. Set local market status = #Resolved(winner)
     c. Process all positions → credit winners, zero losers
  4. If not closed yet, retry next cycle
  5. After 7 days past endDate with no resolution → flag for admin review
```

### 6.2 Payout Calculation

```
For each position where outcome == winning_outcome:
  gross_payout = shares × 1_000_000  (shares × $1.00)
  rake = gross_payout × PROTOCOL_RAKE_BPS / 10_000
  net_payout = gross_payout - rake
  → ICRC-1 transfer from market subaccount to user
```

Losing positions pay out $0 (shares are worthless).

### 6.3 Cancellation

If Polymarket cancels/voids a market (both outcomes resolve ~$0.50):
- Set local status = #Cancelled
- Refund all users their cost basis (original USDC locked)
- Cancel all open orders, return escrowed funds

## 7. Market Sync (replaces Football Oracle)

### 7.1 Sync Timer

```
Timer: every 30 minutes
  1. GET /sports → get all sport slugs + tag_ids
  2. For each sport, GET /events?tag_id={tag}&active=true&closed=false
  3. For each event, check if polymarketSlug already exists locally
  4. If new: create local markets for each moneyline market in the event
  5. Update reference prices (polymarketYesPrice/NoPrice) for existing markets
```

### 7.2 What Gets Synced

For v2.0 (moneyline only), we filter Polymarket event markets:
- Markets with `groupItemTitle` matching a team name → moneyline
- Markets with "draw" in the question → draw market
- Skip spread/totals markets (they exist on Polymarket but we don't create local markets for them yet)

### 7.3 Sport Filtering

No filtering — all sports from Polymarket's /sports endpoint are supported.
The frontend can filter by sport tag for display purposes.

## 8. Stable State

### 8.1 State Variables

```motoko
// Core state
var markets = Map<Text, Market>();                         // marketId → Market
var orders = Map<Text, Order>();                            // orderId → Order
var orderBook = Map<Text, OrderBookSide>();                 // marketId:outcome:side → price-sorted orders
var positions = Map<Text, Position>();                      // positionId → Position
var userPositions = Map<Principal, [Text]>();               // user → [positionId]
var userBalances = Map<Principal, Nat>();                   // user → USDC balance
var userStats = Map<Principal, UserStats>();                // user → stats
var positionHistory = Map<Principal, [HistoricalPosition]>(); // user → settled history

// Sync tracking
var knownPolySlugs = Map<Text, Text>();                    // polySlug → local marketId
var sportTags = Map<Text, [Text]>();                       // sport slug → [tag_ids]
var nextMarketId : Nat = 0;
var nextOrderId : Nat = 0;
var nextPositionId : Nat = 0;
```

### 8.2 Position Structure

```motoko
type Position = {
  positionId : Text;
  marketId : Text;
  user : Principal;
  outcome : Outcome;      // Yes or No
  shares : Nat;            // number of shares held
  costBasis : Nat;         // total USDC paid (for P&L tracking)
  averagePrice : Nat;      // weighted average entry price (basis points)
};
```

## 9. MCP Tools (API Surface)

The canister exposes tools via MCP SDK for both the website and AI agents:

| Tool | Description |
|------|-------------|
| `markets_list` | List markets with filters (sport, status, date range) |
| `market_detail` | Get market + order book depth + recent trades |
| `order_place` | Place a limit order (buy/sell, outcome, price, size) |
| `order_cancel` | Cancel an open order |
| `orders_list` | List user's open orders |
| `positions_list` | List user's current positions + P&L |
| `account_info` | Balance, deposit address, stats |
| `account_history` | Settled position history |
| `leaderboard` | Top traders by profit, accuracy, volume |
| `sports_list` | Available sports and active market counts |

## 10. Frontend (Next.js)

### 10.1 Pages

| Route | Content |
|-------|---------|
| `/` | Featured events, trending markets, sport tabs |
| `/sport/{slug}` | All markets for a sport (EPL, NBA, etc.) |
| `/event/{slug}` | Single event — moneyline markets + order book UI |
| `/portfolio` | User's positions, open orders, P&L, balance |
| `/leaderboard` | Top traders |

### 10.2 Key Components

- **OrderBook** — bid/ask ladder visualization
- **TradePanel** — buy/sell interface with price/size inputs
- **MarketCard** — event card with current prices and volume
- **PositionRow** — position with entry price, current value, P&L
- **SportNav** — horizontal sport tabs/pills

### 10.3 Data Flow

```
packages/libs/ic-js/src/api/  →  hooks/  →  components
  (canister calls)            (TanStack Query)  (UI)
```

Components NEVER import api/ directly (existing convention).

## 11. Packages (Monorepo)

```
packages/
├── canisters/
│   └── final_score/src/
│       ├── main.mo                    # actor, timers, sync, settlement
│       └── tools/
│           ├── ToolContext.mo          # types, state, helpers
│           ├── OrderBook.mo           # NEW — matching engine
│           ├── markets_list.mo        # rewrite — polymarket data
│           ├── market_detail.mo       # NEW — book depth, trades
│           ├── order_place.mo         # NEW — place limit order
│           ├── order_cancel.mo        # NEW — cancel order
│           ├── orders_list.mo         # NEW — user's open orders
│           ├── positions_list.mo      # rewrite — shares model
│           ├── account_get_info.mo    # update — same concept
│           ├── account_get_history.mo # update — same concept
│           ├── sports_list.mo         # NEW — sport discovery
│           └── leaderboard.mo         # NEW — extracted from main
├── apps/
│   ├── website/                       # Next.js frontend (rewrite)
│   └── proxy-server/                  # REMOVE — no longer needed
├── libs/
│   ├── ic-js/                         # canister client (update for new tools)
│   └── api-football/                  # REMOVE — dead dependency
└── declarations/                      # auto-generated from candid
```

## 12. What's Removed

| v1 Component | Reason |
|---|---|
| `FootballOracle.mo` | Replaced by Polymarket Gamma API HTTP outcalls |
| `packages/libs/api-football/` | No longer needed |
| `packages/apps/proxy-server/` | Was proxying Football API calls |
| `BookmakerOdds.tsx` | Replaced by native order book UI |
| `LiveScore.tsx` | Scores come implicitly from market resolution |
| `useApiFootball.ts` hook | Dead |
| Football Oracle canister dependency | Dead |
| 15-minute score polling | Replaced by 5-min resolution check (only post-endDate) |

## 13. Migration

Clean deploy — all user funds have been returned. No state migration needed.

Fresh canister with empty state. New canister ID. Update Prometheus Protocol listing.

## 14. Implementation Order

1. **ToolContext.mo** — new types (Market, Order, Position, OrderBook)
2. **OrderBook.mo** — matching engine (core logic, no I/O)
3. **main.mo** — actor shell, timers, HTTP outcalls for Polymarket sync
4. **MCP tools** — one by one (markets_list → order_place → order_cancel → etc.)
5. **ic-js client** — update for new canister interface
6. **Frontend** — market browser → event page + order book → portfolio
7. **Deploy & list** on Prometheus Protocol

## 15. Resolved Design Decisions

### 15.1 Order Limits

No artificial order count cap. Balance is the limit (Polymarket standard):
```
maxNewOrderSize = balance - Σ(openOrder.remainingSize × openOrder.price)
```

### 15.2 Minimum Order & Tick Size

- **Tick size:** 0.01 ($0.01 increments, 100 basis points) — matches Polymarket sports
- **Minimum shares:** 1
- **Minimum total cost:** $0.10 USDC (price × size ≥ 100_000 base units) — prevents dust spam

### 15.3 Market Maker

External bot, not baked into the canister. Market maker is just a regular user placing
two-sided orders through the same MCP tools. Reads Polymarket reference prices, places
Buy Yes + Buy No around that price to capture spread. Can be built as a separate project.
The canister has no special MM privileges or awareness.

Open-source reference: github.com/warproxxx/poly-maker

### 15.4 In-Play / Live Trading

v2.0: **No in-play trading.** Markets stay #Open until `bettingDeadline` (endDate − 5 min),
then auto-transition to #Closed. Resolution timer kicks in post-endDate.

v2.1 (future): Add 1-second matching delay for sports markets (Polymarket's approach)
to enable live in-play trading without front-running exploits.

### 15.5 Polymarket API Rate Limits

Fully documented, very generous for our use case:

| API | Endpoint | Limit |
|-----|----------|-------|
| Gamma | General | 4,000 req / 10s |
| Gamma | /events | 500 req / 10s |
| Gamma | /markets | 300 req / 10s |
| CLOB | /price | 1,500 req / 10s |
| CLOB | /prices-history | 1,000 req / 10s |

Our 30-min sync and 5-min resolution checks are well within limits.

### 15.6 Sports WebSocket (Bonus)

Polymarket provides a free, no-auth Sports WebSocket:
```
wss://sports-api.polymarket.com/ws
```
Pushes real-time scores, periods, game status for all active events.
Use on frontend for live score display (no polling needed).
