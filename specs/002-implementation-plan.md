# Final Score v2 — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace v1 parimutuel canister with a prediction-market order book powered by Polymarket data.

**Architecture:** ICP Motoko canister with CLOB matching engine, Polymarket Gamma API for market discovery and resolution via HTTP outcalls, USDC (ICRC-1/2) for settlement.

**Tech Stack:** Motoko, MCP SDK, ICRC-1/2, Polymarket Gamma API, Next.js, TanStack Query

**Spec:** `specs/001-v2-architecture.md`

---

## Phase 1: Core Types & Order Book Engine

The foundation — pure logic with no I/O. Testable in isolation.

### Task 1.1: Rewrite ToolContext.mo — Core Types

**Objective:** Define all v2 types (Market, Order, Position, Outcome, etc.)

**Files:**
- Rewrite: `packages/canisters/final_score/src/tools/ToolContext.mo`

**Steps:**

1. Replace all v1 types with v2 types from spec §4 and §5:

```motoko
module ToolContext {
  // Constants
  public let TRANSFER_FEE : Nat = 10_000;          // 0.01 USDC
  public let MINIMUM_COST : Nat = 100_000;          // 0.10 USDC min order cost
  public let SHARE_VALUE : Nat = 1_000_000;         // 1 share = $1.00 USDC
  public let TICK_SIZE : Nat = 100;                 // 0.01 = 100 basis points
  public let MAKER_FEE_BPS : Nat = 0;              // 0% maker fee
  public let TAKER_FEE_BPS : Nat = 100;            // 1% taker fee
  public let PROTOCOL_RAKE_BPS : Nat = 200;        // 2% on winning redemptions

  public type MarketType = {
    #Moneyline;
    #Spread : Float;
    #Total : Float;
  };

  public type Outcome = { #Yes; #No };

  public type MarketStatus = {
    #Open;
    #Suspended;
    #Closed;
    #Resolved : Outcome;
    #Cancelled;
  };

  public type Market = {
    marketId : Text;
    question : Text;
    eventTitle : Text;
    sport : Text;
    marketType : MarketType;
    outcomes : (Text, Text);            // e.g. ("Yes", "No")

    // Polymarket refs
    polymarketSlug : Text;
    polymarketConditionId : Text;
    polymarketTokenIds : (Text, Text);

    // Timing
    endDate : Int;
    bettingDeadline : Int;

    // Book state
    status : MarketStatus;
    lastYesPrice : Nat;                 // basis points (0-10000)
    lastNoPrice : Nat;
    totalVolume : Nat;                  // total USDC matched

    // Reference prices
    polymarketYesPrice : Nat;           // basis points
    polymarketNoPrice : Nat;
  };

  public type Side = { #Buy; #Sell };

  public type OrderStatus = {
    #Open;
    #PartiallyFilled;
    #Filled;
    #Cancelled;
  };

  public type Order = {
    orderId : Text;
    marketId : Text;
    user : Principal;
    side : Side;
    outcome : Outcome;
    price : Nat;                        // basis points 1-9999
    size : Nat;                         // shares
    filledSize : Nat;
    status : OrderStatus;
    timestamp : Int;
  };

  public type Position = {
    positionId : Text;
    marketId : Text;
    user : Principal;
    outcome : Outcome;
    shares : Nat;
    costBasis : Nat;                    // total USDC paid
    averagePrice : Nat;                 // weighted avg entry (basis points)
  };

  public type HistoricalPosition = {
    marketId : Text;
    eventTitle : Text;
    question : Text;
    outcome : Outcome;
    shares : Nat;
    costBasis : Nat;
    payout : Nat;
    resolvedAt : Nat;
  };

  public type UserStats = {
    userPrincipal : Principal;
    totalTrades : Nat;
    marketsWon : Nat;
    marketsLost : Nat;
    totalVolume : Nat;
    totalPayout : Nat;
    netProfit : Int;
  };

  public type Trade = {
    tradeId : Text;
    marketId : Text;
    makerOrderId : Text;
    takerOrderId : Text;
    maker : Principal;
    taker : Principal;
    outcome : Outcome;
    price : Nat;
    size : Nat;
    timestamp : Int;
  };
};
```

2. Keep helper functions: `marketSubaccount`, `getMarketAccount` (same logic as v1).

3. Remove all v1-specific types: `Outcome.#HomeWin/#AwayWin/#Draw`, parimutuel pool fields, `BookmakerOdds`, `FootballOracle` references.

4. Add position/balance helpers adapted for shares model:

```motoko
  // Calculate available balance (total - locked in open orders)
  public func availableBalance(
    userBalances : Map.Map<Principal, Nat>,
    openOrders : [Order],
    user : Principal
  ) : Nat {
    let total = switch (Map.get(userBalances, Map.phash, user)) {
      case (?b) b; case null 0;
    };
    var locked : Nat = 0;
    for (order in openOrders.vals()) {
      if (order.user == user and (order.status == #Open or order.status == #PartiallyFilled)) {
        let remaining = order.size - order.filledSize;
        locked += (remaining * order.price * SHARE_VALUE) / 10000;
      };
    };
    if (total > locked) { total - locked } else { 0 };
  };

  // Calculate payout for a position after resolution
  public func calculatePayout(position : Position, winningOutcome : Outcome) : Nat {
    if (position.outcome == winningOutcome) {
      let gross = position.shares * SHARE_VALUE;
      let rake = (gross * PROTOCOL_RAKE_BPS) / 10_000;
      gross - rake;
    } else {
      0;
    };
  };
```

**Verification:** File compiles with `mops build` (or `dfx build`).

---

### Task 1.2: Create OrderBook.mo — Matching Engine

**Objective:** Pure matching logic, no I/O or async. Takes orders, returns fills.

**Files:**
- Create: `packages/canisters/final_score/src/tools/OrderBook.mo`

**Steps:**

1. Define the order book data structures:

```motoko
import Map "mo:map/Map";
import Array "mo:base/Array";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Order "mo:base/Order";
import ToolContext "ToolContext";

module OrderBook {

  // A price level in the book
  public type PriceLevel = {
    price : Nat;                     // basis points
    orders : [ToolContext.Order];     // FIFO queue at this price
  };

  // One side of the book for one outcome
  public type BookSide = {
    levels : [PriceLevel];           // sorted: bids descending, asks ascending
  };

  // Full book for a market
  public type Book = {
    yesBids : BookSide;              // buy Yes orders, sorted price DESC
    noBids : BookSide;               // buy No orders, sorted price DESC
  };

  // Result of attempting to match
  public type MatchResult = {
    fills : [Fill];
    remainingOrder : ?ToolContext.Order;  // null if fully filled
  };

  public type Fill = {
    makerOrderId : Text;
    takerOrderId : Text;
    maker : Principal;
    taker : Principal;
    outcome : ToolContext.Outcome;
    price : Nat;                     // execution price (maker's price)
    size : Nat;                      // shares matched
  };
};
```

2. Implement the core matching function:

The key insight: Buy Yes @ P matches with Buy No @ (10000 - P) or better.
We normalize everything to Yes bids and No bids. When `bestYesBid.price + bestNoBid.price >= 10000`, they match.

```motoko
  // Try to match a new order against the book
  // Returns fills and any unmatched remainder
  public func matchOrder(book : Book, order : ToolContext.Order) : MatchResult {
    // Determine which side of the book to match against
    // Buy Yes matches against No bids (complement)
    // Buy No matches against Yes bids (complement)
    let (oppositeBook, isYes) = switch (order.outcome) {
      case (#Yes) { (book.noBids, true) };
      case (#No) { (book.yesBids, false) };
    };

    var fills : [Fill] = [];
    var remainingSize = order.size - order.filledSize;
    var updatedLevels = oppositeBook.levels;

    // Match while: order price + best opposite price >= 10000
    label matching for (level in oppositeBook.levels.vals()) {
      if (remainingSize == 0) break matching;

      // Check if prices complement to >= $1.00
      if (order.price + level.price < 10000) break matching;

      // Match against orders at this level (FIFO)
      for (resting in level.orders.vals()) {
        if (remainingSize == 0) break matching;

        let restingRemaining = resting.size - resting.filledSize;
        let fillSize = Nat.min(remainingSize, restingRemaining);

        let fill : Fill = {
          makerOrderId = resting.orderId;
          takerOrderId = order.orderId;
          maker = resting.user;
          taker = order.user;
          outcome = order.outcome;
          price = resting.price;         // execute at maker's price
          size = fillSize;
        };

        fills := Array.append(fills, [fill]);
        remainingSize -= fillSize;
      };
    };

    let updatedOrder = if (remainingSize == 0) { null }
    else {
      ?{ order with
        filledSize = order.size - remainingSize;
        status = if (order.filledSize > 0) #PartiallyFilled else #Open;
      };
    };

    { fills; remainingOrder = updatedOrder };
  };
```

3. Implement book mutation helpers:

```motoko
  // Insert an order into the appropriate book side
  public func insertOrder(book : Book, order : ToolContext.Order) : Book;

  // Remove an order from the book (for cancellation)
  public func removeOrder(book : Book, orderId : Text, outcome : ToolContext.Outcome) : Book;

  // Get best bid/ask prices for display
  public func bestPrices(book : Book) : { bestYesBid : Nat; bestNoBid : Nat; spread : Nat };

  // Get depth at each price level (for order book UI)
  public func depth(book : Book, maxLevels : Nat) : {
    yesBids : [(Nat, Nat)];  // (price, totalSize) descending
    noBids : [(Nat, Nat)];   // (price, totalSize) descending
  };
```

**Verification:** `dfx build` compiles. Unit tests in Task 1.3.

---

### Task 1.3: Order Book Unit Tests

**Objective:** Test matching engine in isolation.

**Files:**
- Create: `packages/canisters/final_score/test/orderbook.test.ts`

**Test cases:**

1. **Basic match:** Buy Yes @ 60 + Buy No @ 40 → fill at complement
2. **No match:** Buy Yes @ 55 + Buy No @ 40 → both rest (55+40 < 100)
3. **Partial fill:** Buy Yes @ 60 (10 shares) + Buy No @ 40 (5 shares) → 5 fill, 5 rest
4. **Price-time priority:** Two resting No bids at 40, new Yes bid at 60 → older fills first
5. **Multi-level sweep:** Large taker sweeps across multiple price levels
6. **Cancel removes from book:** Insert, cancel, verify removed
7. **Self-trade prevention:** Same user on both sides should not match (if we want this)
8. **Tick size validation:** Prices must be multiples of TICK_SIZE (100 bp = $0.01)

**Verification:** `npm test` passes all cases.

---

## Phase 2: Main Actor — Timers, Sync, Settlement

### Task 2.1: Rewrite main.mo — Actor Shell & State

**Objective:** Clean actor with v2 state, no Football Oracle references.

**Files:**
- Rewrite: `packages/canisters/final_score/src/main.mo`

**Steps:**

1. Remove all v1 imports: `FootballOracle`, old tool modules.

2. Declare v2 stable state:

```motoko
var markets = Map.new<Text, ToolContext.Market>();
var orders = Map.new<Text, ToolContext.Order>();
var orderBooks = Map.new<Text, OrderBook.Book>();       // marketId → Book
var trades = Map.new<Text, ToolContext.Trade>();
var positions = Map.new<Text, ToolContext.Position>();   // positionId → Position
var userPositionIds = Map.new<Principal, [Text]>();      // user → [positionId]
var userBalances = Map.new<Principal, Nat>();
var userStats = Map.new<Principal, ToolContext.UserStats>();
var positionHistory = Map.new<Principal, [ToolContext.HistoricalPosition]>();

// Sync tracking
var knownPolySlugs = Map.new<Text, [Text]>();           // polySlug → [marketId]
var nextMarketId : Nat = 0;
var nextOrderId : Nat = 0;
var nextPositionId : Nat = 0;
var nextTradeId : Nat = 0;
```

3. Keep existing scaffolding: MCP SDK setup, auth context, beacon, HTTP asset state, owner, tokenLedger. Remove `footballOracleId`.

4. Update constructor args:

```motoko
shared ({ caller = deployer }) persistent actor class McpServer(
  args : ?{
    owner : ?Principal;
    tokenLedger : ?Principal;
  }
) = self {
```

**Verification:** `dfx build` compiles (tools will be stubs initially).

---

### Task 2.2: Polymarket Sync — HTTP Outcalls

**Objective:** Timer that discovers new markets from Polymarket Gamma API.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo`

**Steps:**

1. Add HTTP outcall transform function (required for ICP HTTP outcalls):

```motoko
public query func transformPolymarket({
  context = _ : Blob;
  response : IC.HttpRequestResult;
}) : async IC.HttpRequestResult {
  { response with headers = [] };
};
```

2. Implement `syncMarketsFromPolymarket()`:

```motoko
func syncMarketsFromPolymarket() : async () {
  try {
    // 1. Fetch sports list
    let sportsResponse = await makeHttpRequest(
      "https://gamma-api.polymarket.com/sports",
      transformPolymarket
    );
    let sports = parseJsonArray(sportsResponse.body);

    // 2. For each sport, fetch active events
    for (sport in sports.vals()) {
      let tagId = extractFirstTag(sport.tags);  // first tag after "1,"
      let eventsUrl = "https://gamma-api.polymarket.com/events"
        # "?tag_id=" # tagId
        # "&active=true&closed=false&limit=100";

      let eventsResponse = await makeHttpRequest(eventsUrl, transformPolymarket);
      let events = parseJsonArray(eventsResponse.body);

      // 3. For each event, create local markets for moneyline
      for (event in events.vals()) {
        let slug = event.slug;
        if (not Map.has(knownPolySlugs, thash, slug)) {
          createMarketsFromEvent(event, sport.sport);
        } else {
          // Update reference prices for existing markets
          updateReferencePrices(event);
        };
      };
    };
  } catch (e) {
    Debug.print("Polymarket sync failed: " # Error.message(e));
  };
};
```

3. Implement `createMarketsFromEvent()` — filter for moneyline markets:

```motoko
func createMarketsFromEvent(event : JsonValue, sport : Text) {
  let slug = event.slug;
  var marketIds : [Text] = [];

  for (market in event.markets.vals()) {
    // Only create moneyline markets for v2.0
    // Moneyline markets have groupItemTitle matching team names or "Draw"
    // Skip spread (contains "Spread:") and totals (contains "O/U")
    let question = market.question;
    if (not Text.contains(question, "Spread") and
        not Text.contains(question, "O/U")) {

      let marketId = Nat.toText(nextMarketId);
      nextMarketId += 1;

      let newMarket : ToolContext.Market = {
        marketId;
        question;
        eventTitle = event.title;
        sport;
        marketType = #Moneyline;
        outcomes = ("Yes", "No");
        polymarketSlug = slug;
        polymarketConditionId = market.conditionId;
        polymarketTokenIds = (market.clobTokenIds[0], market.clobTokenIds[1]);
        endDate = parseIsoToNanos(event.endDate);
        bettingDeadline = parseIsoToNanos(event.endDate) - 300_000_000_000;
        status = #Open;
        lastYesPrice = parsePrice(market.outcomePrices[0]);
        lastNoPrice = parsePrice(market.outcomePrices[1]);
        totalVolume = 0;
        polymarketYesPrice = parsePrice(market.outcomePrices[0]);
        polymarketNoPrice = parsePrice(market.outcomePrices[1]);
      };

      Map.set(markets, thash, marketId, newMarket);
      Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
      marketIds := Array.append(marketIds, [marketId]);
    };
  };

  Map.set(knownPolySlugs, thash, slug, marketIds);
};
```

4. Set up the sync timer:

```motoko
// Sync every 30 minutes
ignore Timer.recurringTimer<system>(#seconds(30 * 60), func () : async () {
  await syncMarketsFromPolymarket();
});

// Also run once on deploy
ignore Timer.setTimer<system>(#seconds(5), func () : async () {
  await syncMarketsFromPolymarket();
});
```

**Verification:** Deploy locally, check canister logs for successful sync. Call `markets_list` to see Polymarket events.

---

### Task 2.3: Resolution Timer

**Objective:** Check Polymarket for resolved markets and settle positions.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo`

**Steps:**

1. Implement `checkResolutions()`:

```motoko
func checkResolutions() : async () {
  let now = Time.now();

  for ((marketId, market) in Map.entries(markets)) {
    // Only check markets past their end date that are Closed
    if (market.status == #Closed and now > market.endDate) {
      try {
        let url = "https://gamma-api.polymarket.com/events/slug/"
          # market.polymarketSlug;
        let response = await makeHttpRequest(url, transformPolymarket);
        let event = parseJson(response.body);

        // Find our market's condition in the event
        for (pm in event.markets.vals()) {
          if (pm.conditionId == market.polymarketConditionId) {
            if (pm.closed == true) {
              let yesPrice = parsePrice(pm.outcomePrices[0]);
              let noPrice = parsePrice(pm.outcomePrices[1]);

              // Winner has price ~10000 (≈$1.00)
              let winner : ToolContext.Outcome = if (yesPrice > 5000) #Yes
                else if (noPrice > 5000) #No
                else {
                  // Both ~5000 = cancelled/void
                  await cancelMarket(marketId);
                  return;
                };

              await resolveMarket(marketId, winner);
            };
          };
        };
      } catch (e) {
        Debug.print("Resolution check failed for " # marketId # ": " # Error.message(e));
      };
    };
  };
};
```

2. Implement `resolveMarket()` — iterate positions, credit winners:

```motoko
func resolveMarket(marketId : Text, winner : ToolContext.Outcome) : async () {
  // Update market status
  switch (Map.get(markets, thash, marketId)) {
    case (?market) {
      Map.set(markets, thash, marketId, { market with status = #Resolved(winner) });
    };
    case null return;
  };

  // Cancel all open orders, refund escrowed funds
  await cancelAllOrdersForMarket(marketId);

  // Process positions — credit winners
  let ledger = actor (Principal.toText(tokenLedger)) : actor {
    icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
  };

  // Collect all positions for this market
  for ((posId, position) in Map.entries(positions)) {
    if (position.marketId == marketId) {
      let payout = ToolContext.calculatePayout(position, winner);

      if (payout > ToolContext.TRANSFER_FEE) {
        // Transfer from market subaccount to user
        try {
          let result = await ledger.icrc1_transfer({
            from_subaccount = ?ToolContext.marketSubaccount(marketId);
            to = { owner = position.user; subaccount = null };
            amount = payout - ToolContext.TRANSFER_FEE;
            fee = ?ToolContext.TRANSFER_FEE;
            memo = null;
            created_at_time = null;
          });
          // ... log success/failure
        } catch (e) {
          Debug.print("Payout failed: " # Error.message(e));
        };
      };

      // Move to history
      // Update user stats
      // Remove position
    };
  };
};
```

3. Implement deadline enforcement timer:

```motoko
func enforceDeadlines() : async () {
  let now = Time.now();
  for ((marketId, market) in Map.entries(markets)) {
    if (market.status == #Open and now >= market.bettingDeadline) {
      Map.set(markets, thash, marketId, { market with status = #Closed });
      // Cancel all open orders, refund escrowed funds
      await cancelAllOrdersForMarket(marketId);
    };
  };
};
```

4. Set up timers:

```motoko
// Check deadlines every minute
ignore Timer.recurringTimer<system>(#seconds(60), func () : async () {
  await enforceDeadlines();
});

// Check resolutions every 5 minutes
ignore Timer.recurringTimer<system>(#seconds(5 * 60), func () : async () {
  await checkResolutions();
});
```

**Verification:** Deploy locally with a test market. Set endDate to past. Verify resolution triggers.

---

## Phase 3: MCP Tools (Order Placement, Querying)

### Task 3.1: order_place.mo

**Objective:** Place a limit order (buy/sell, outcome, price, size).

**Files:**
- Create: `packages/canisters/final_score/src/tools/order_place.mo`

**Key logic:**

1. Validate: market exists, status == #Open, price is valid tick, size ≥ 1, cost ≥ MINIMUM_COST
2. Check available balance ≥ price × size (for buys)
3. Lock funds (debit from available balance into escrow)
4. Call `OrderBook.matchOrder()` with the new order
5. Process fills: create/update positions for both maker and taker, record trades
6. If remainder exists, insert into order book
7. Return: order ID, fills, remaining size

**Tool schema:**
```json
{
  "name": "order_place",
  "description": "Place a limit order to buy or sell outcome shares",
  "inputSchema": {
    "type": "object",
    "properties": {
      "market_id": { "type": "string" },
      "side": { "type": "string", "enum": ["buy", "sell"] },
      "outcome": { "type": "string", "enum": ["yes", "no"] },
      "price": { "type": "number", "description": "Price per share 0.01-0.99" },
      "size": { "type": "integer", "description": "Number of shares" }
    },
    "required": ["market_id", "outcome", "price", "size"]
  }
}
```

---

### Task 3.2: order_cancel.mo

**Objective:** Cancel an open order, return escrowed funds.

**Files:**
- Create: `packages/canisters/final_score/src/tools/order_cancel.mo`

**Key logic:**

1. Validate: order exists, belongs to caller, status is #Open or #PartiallyFilled
2. Remove from order book
3. Refund: (remainingSize × price × SHARE_VALUE / 10000) back to available balance
4. Update order status to #Cancelled

---

### Task 3.3: markets_list.mo — Rewrite

**Objective:** List markets with filters (sport, status, date range, search).

**Files:**
- Rewrite: `packages/canisters/final_score/src/tools/markets_list.mo`

**Tool schema:**
```json
{
  "name": "markets_list",
  "description": "List prediction markets with optional filters",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sport": { "type": "string", "description": "Filter by sport slug (epl, nba, nfl...)" },
      "status": { "type": "string", "enum": ["open", "closed", "resolved"] },
      "limit": { "type": "integer", "default": 20 },
      "offset": { "type": "integer", "default": 0 }
    }
  }
}
```

**Response includes:** marketId, question, eventTitle, sport, status, lastYesPrice, lastNoPrice, totalVolume, endDate, polymarketYesPrice.

---

### Task 3.4: market_detail.mo — NEW

**Objective:** Get single market with order book depth and recent trades.

**Files:**
- Create: `packages/canisters/final_score/src/tools/market_detail.mo`

**Response includes:** full Market object + order book depth (top 10 levels each side) + last 20 trades.

---

### Task 3.5: orders_list.mo — NEW

**Objective:** List caller's open orders.

**Files:**
- Create: `packages/canisters/final_score/src/tools/orders_list.mo`

---

### Task 3.6: positions_list.mo — Rewrite

**Objective:** List caller's current positions with P&L.

**Files:**
- Rewrite: `packages/canisters/final_score/src/tools/positions_list.mo`

**Response per position:** market question, outcome, shares, costBasis, averagePrice, currentValue (shares × lastPrice), unrealizedPnL.

---

### Task 3.7: account_get_info.mo — Update

**Objective:** Show balance, deposit address, available balance, basic stats.

**Files:**
- Update: `packages/canisters/final_score/src/tools/account_get_info.mo`

Changes from v1: show available balance (total - locked in orders), remove parimutuel-specific fields.

---

### Task 3.8: account_get_history.mo — Update

**Objective:** Show settled position history.

**Files:**
- Update: `packages/canisters/final_score/src/tools/account_get_history.mo`

Changes: use new HistoricalPosition fields (shares/costBasis/payout instead of betAmount/betOutcome).

---

### Task 3.9: sports_list.mo — NEW

**Objective:** List available sports with active market counts.

**Files:**
- Create: `packages/canisters/final_score/src/tools/sports_list.mo`

**Response:** Array of { sport, marketCount, nextEvent } derived from local markets state.

---

### Task 3.10: leaderboard.mo — Extract from main

**Objective:** Top traders by profit, volume, accuracy.

**Files:**
- Create: `packages/canisters/final_score/src/tools/leaderboard.mo`

Same concept as v1 but extracted into its own tool module. Ranking by netProfit.

---

### Task 3.11: Register All Tools in main.mo

**Objective:** Wire up all MCP tool handlers in the actor.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo`

Register each tool with the MCP SDK using the same pattern as v1.

**Verification:** `dfx build` compiles. Deploy locally. Call each tool via MCP.

---

## Phase 4: Remove Dead Code

### Task 4.1: Delete v1 Dependencies

**Objective:** Clean out dead files.

**Files to delete:**
- `packages/canisters/final_score/src/tools/FootballOracle.mo`
- `packages/canisters/final_score/src/tools/prediction_place.mo` (replaced by order_place)
- `packages/libs/api-football/` (entire directory)
- `packages/apps/proxy-server/` (entire directory)
- `packages/apps/website/hooks/useApiFootball.ts`
- `packages/apps/website/components/BookmakerOdds.tsx`
- `packages/apps/website/components/LiveScore.tsx`

**Verification:** `dfx build` still compiles. No dangling imports.

---

## Phase 5: Frontend

### Task 5.1: Update ic-js Client Library

**Objective:** Update canister client for new tools.

**Files:**
- Update: `packages/libs/ic-js/src/api/index.ts`
- Add: `packages/libs/ic-js/src/api/markets.api.ts`
- Add: `packages/libs/ic-js/src/api/orders.api.ts`
- Add: `packages/libs/ic-js/src/api/positions.api.ts`
- Update: `packages/libs/ic-js/src/api/leaderboard.api.ts`

Generate fresh declarations from `dfx generate`, then write typed wrappers.

---

### Task 5.2: New Hooks Layer

**Objective:** TanStack Query hooks for all data.

**Files:**
- Create: `packages/apps/website/hooks/useMarkets.ts`
- Create: `packages/apps/website/hooks/useMarketDetail.ts`
- Create: `packages/apps/website/hooks/useOrders.ts`
- Create: `packages/apps/website/hooks/usePositions.ts`
- Create: `packages/apps/website/hooks/useSports.ts`
- Update: `packages/apps/website/hooks/useLeaderboard.ts`

---

### Task 5.3: Sport Navigation & Home Page

**Objective:** Sport tabs + featured markets grid.

**Files:**
- Rewrite: `packages/apps/website/app/page.tsx`
- Create: `packages/apps/website/components/SportNav.tsx`
- Create: `packages/apps/website/components/MarketCard.tsx`

Home page shows: SportNav (horizontal pills), then MarketCard grid sorted by volume/endDate.

---

### Task 5.4: Sport Page — `/sport/[slug]`

**Objective:** All markets for a single sport.

**Files:**
- Create: `packages/apps/website/app/sport/[slug]/page.tsx`

Reuses MarketCard grid filtered by sport.

---

### Task 5.5: Event Page — `/event/[slug]`

**Objective:** Single event with order book and trade panel.

**Files:**
- Create: `packages/apps/website/app/event/[slug]/page.tsx`
- Create: `packages/apps/website/components/OrderBookDisplay.tsx`
- Create: `packages/apps/website/components/TradePanel.tsx`
- Create: `packages/apps/website/components/RecentTrades.tsx`

Key UI:
- Left: Order book ladder (bids/asks with depth)
- Center: Price chart (optional, can use Polymarket price history)
- Right: Trade panel (buy/sell toggle, outcome selector, price input, size input)
- Below: Recent trades list

---

### Task 5.6: Portfolio Page — `/portfolio`

**Objective:** User's positions, open orders, P&L, balance.

**Files:**
- Create: `packages/apps/website/app/portfolio/page.tsx`
- Create: `packages/apps/website/components/PositionRow.tsx`
- Create: `packages/apps/website/components/OrderRow.tsx`

Tabs: Positions | Open Orders | History

---

### Task 5.7: Leaderboard Page — Update

**Objective:** Update for v2 stats model.

**Files:**
- Update: `packages/apps/website/app/leaderboard/page.tsx`

---

### Task 5.8: Navigation Update

**Objective:** Update nav for new routes.

**Files:**
- Update: `packages/apps/website/app/navigation.tsx`

Links: Home | Portfolio | Leaderboard

---

## Phase 6: Deploy & List

### Task 6.1: Fresh Canister Deploy

```bash
dfx deploy final_score --network ic --argument '(opt record {
  owner = opt principal "YOUR_PRINCIPAL";
  tokenLedger = opt principal "53nhb-haaaa-aaaar-qbn5q-cai";
})'
```

### Task 6.2: Update Prometheus Protocol Listing

Update the listing with new canister ID and metadata.

### Task 6.3: Deploy Website Asset Canister

```bash
cd packages/apps/website && npm run build
dfx deploy website --network ic
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1.1-1.3 | Types + Order Book Engine + Tests |
| 2 | 2.1-2.3 | Actor Shell + Polymarket Sync + Resolution |
| 3 | 3.1-3.11 | All MCP Tools |
| 4 | 4.1 | Delete dead v1 code |
| 5 | 5.1-5.8 | Frontend rewrite |
| 6 | 6.1-6.3 | Deploy |

Phases 1-3 are the critical path (canister). Phase 4 is cleanup. Phase 5 can partially parallelize with Phase 3 (frontend can stub data). Phase 6 is the finish line.
