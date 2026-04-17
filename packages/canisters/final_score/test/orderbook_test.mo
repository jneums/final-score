import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Nat "mo:base/Nat";
import Int "mo:base/Int";

import ToolContext "../src/tools/ToolContext";
import OrderBook "../src/tools/OrderBook";

// ═══════════════════════════════════════════════════════════
// OrderBook Unit Tests
// Run with: moc --check (or compile as actor to execute)
// ═══════════════════════════════════════════════════════════

// Unique test principals
let user1 = Principal.fromBlob("\01\01");
let user2 = Principal.fromBlob("\02\02");
let user3 = Principal.fromBlob("\03\03");

// Helper: pick user by number
func userForNum(n : Nat) : Principal {
  if (n == 1) user1 else if (n == 2) user2 else user3;
};

// Helper: create a test order
func makeOrder(
  id : Text,
  userNum : Nat,
  outcome : ToolContext.Outcome,
  price : Nat,
  size : Nat,
  ts : Int,
) : ToolContext.Order {
  {
    orderId = id;
    marketId = "0";
    user = userForNum(userNum);
    side = #Buy;
    outcome;
    price;
    size;
    filledSize = 0;
    status = #Open;
    timestamp = ts;
  };
};

// ─── Test 1: Basic match ─────────────────────────────────
// Buy Yes @ 6000 + Buy No @ 4000 = 10000 → should match
do {
  var book = OrderBook.emptyBook();

  // User1 rests a Buy No @ 4000
  let noOrder = makeOrder("no1", 1, #No, 4000, 10, 1);
  book := OrderBook.insertOrder(book, noOrder);

  // User2 submits Buy Yes @ 6000 (crosses: 6000 + 4000 = 10000)
  let yesOrder = makeOrder("yes1", 2, #Yes, 6000, 10, 2);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 1;
  assert result.fills[0].size == 10;
  assert result.fills[0].price == 4000; // executes at maker's price
  assert result.fills[0].makerOrderId == "no1";
  assert result.fills[0].takerOrderId == "yes1";
  assert result.remainingOrder == null; // fully filled

  Debug.print("✓ Test 1: Basic match passed");
};

// ─── Test 2: No match (prices don't complement) ─────────
// Buy Yes @ 5500 + Buy No @ 4000 = 9500 < 10000 → no match
do {
  var book = OrderBook.emptyBook();

  let noOrder = makeOrder("no1", 1, #No, 4000, 10, 1);
  book := OrderBook.insertOrder(book, noOrder);

  let yesOrder = makeOrder("yes1", 2, #Yes, 5500, 10, 2);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 0;
  assert result.remainingOrder != null;
  switch (result.remainingOrder) {
    case (?rem) { assert rem.size == 10; assert rem.filledSize == 0 };
    case null { assert false };
  };

  Debug.print("✓ Test 2: No match (insufficient complement) passed");
};

// ─── Test 3: Partial fill ────────────────────────────────
// Buy No @ 4000 (5 shares) + Buy Yes @ 6000 (10 shares) → 5 fill, 5 rest
do {
  var book = OrderBook.emptyBook();

  let noOrder = makeOrder("no1", 1, #No, 4000, 5, 1);
  book := OrderBook.insertOrder(book, noOrder);

  let yesOrder = makeOrder("yes1", 2, #Yes, 6000, 10, 2);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 1;
  assert result.fills[0].size == 5;
  assert result.remainingOrder != null;
  switch (result.remainingOrder) {
    case (?rem) {
      assert rem.filledSize == 5;
      assert rem.size == 10;
      assert rem.status == #PartiallyFilled;
    };
    case null { assert false };
  };

  Debug.print("✓ Test 3: Partial fill passed");
};

// ─── Test 4: Price-time priority (FIFO) ──────────────────
// Two resting No bids at 4000, new Yes bid at 6000 → older fills first
do {
  var book = OrderBook.emptyBook();

  let noOrder1 = makeOrder("no1", 1, #No, 4000, 5, 1); // older
  let noOrder2 = makeOrder("no2", 3, #No, 4000, 5, 2); // newer
  book := OrderBook.insertOrder(book, noOrder1);
  book := OrderBook.insertOrder(book, noOrder2);

  let yesOrder = makeOrder("yes1", 2, #Yes, 6000, 8, 3);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 2;
  // First fill should be against older order
  assert result.fills[0].makerOrderId == "no1";
  assert result.fills[0].size == 5;
  // Second fill against newer order
  assert result.fills[1].makerOrderId == "no2";
  assert result.fills[1].size == 3;

  assert result.remainingOrder == null; // 5+3 = 8 = fully filled

  Debug.print("✓ Test 4: Price-time priority (FIFO) passed");
};

// ─── Test 5: Multi-level sweep ───────────────────────────
// No bids at 4500 (5 shares) and 4000 (5 shares)
// Yes bid at 6500 (10 shares) → sweeps both levels
do {
  var book = OrderBook.emptyBook();

  let noOrder1 = makeOrder("no1", 1, #No, 4500, 5, 1); // better price
  let noOrder2 = makeOrder("no2", 3, #No, 4000, 5, 2); // worse price
  book := OrderBook.insertOrder(book, noOrder1);
  book := OrderBook.insertOrder(book, noOrder2);

  let yesOrder = makeOrder("yes1", 2, #Yes, 6500, 10, 3);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 2;
  // Best price level first (4500 complement = 5500, taker bids 6500 ≥ 5500 ✓)
  assert result.fills[0].makerOrderId == "no1";
  assert result.fills[0].price == 4500;
  assert result.fills[0].size == 5;
  // Second level (4000 complement = 6000, taker bids 6500 ≥ 6000 ✓)
  assert result.fills[1].makerOrderId == "no2";
  assert result.fills[1].price == 4000;
  assert result.fills[1].size == 5;

  assert result.remainingOrder == null;

  Debug.print("✓ Test 5: Multi-level sweep passed");
};

// ─── Test 6: Cancel removes from book ────────────────────
do {
  var book = OrderBook.emptyBook();

  let order1 = makeOrder("o1", 1, #Yes, 6000, 10, 1);
  let order2 = makeOrder("o2", 2, #Yes, 5500, 10, 2);
  book := OrderBook.insertOrder(book, order1);
  book := OrderBook.insertOrder(book, order2);

  assert OrderBook.countOrders(book, null) == 2;

  book := OrderBook.removeOrder(book, "o1", #Yes);

  assert OrderBook.countOrders(book, null) == 1;

  // Verify the right one was removed
  let prices = OrderBook.bestPrices(book);
  assert prices.bestYesBid == 5500; // o2 remains

  Debug.print("✓ Test 6: Cancel removes from book passed");
};

// ─── Test 7: Self-trade prevention ───────────────────────
// Same user places Buy Yes and Buy No → should NOT match
do {
  var book = OrderBook.emptyBook();

  let noOrder = makeOrder("no1", 1, #No, 4000, 10, 1);
  book := OrderBook.insertOrder(book, noOrder);

  // Same user (userNum=1) submits Buy Yes
  let yesOrder = makeOrder("yes1", 1, #Yes, 6000, 10, 2);
  let result = OrderBook.matchOrder(book, yesOrder);

  assert result.fills.size() == 0;
  assert result.remainingOrder != null;

  Debug.print("✓ Test 7: Self-trade prevention passed");
};

// ─── Test 8: Tick size validation (ToolContext) ──────────
do {
  assert ToolContext.isValidPrice(100);   // $0.01 ✓
  assert ToolContext.isValidPrice(5000);  // $0.50 ✓
  assert ToolContext.isValidPrice(9900);  // $0.99 ✓
  assert not ToolContext.isValidPrice(0);     // $0.00 ✗
  assert not ToolContext.isValidPrice(10000); // $1.00 ✗
  assert not ToolContext.isValidPrice(50);    // not on tick ✗
  assert not ToolContext.isValidPrice(5555);  // not on tick ✗
  assert not ToolContext.isValidPrice(10100); // > max ✗

  Debug.print("✓ Test 8: Tick size validation passed");
};

// ─── Test 9: Order cost calculation ──────────────────────
do {
  // 10 shares @ $0.60 (6000 bp) = $6.00 = 6_000_000 base units
  let cost = ToolContext.orderCost(6000, 10);
  assert cost == 6_000_000;

  // 1 share @ $0.01 (100 bp) = $0.01 = 10_000 base units
  let minCost = ToolContext.orderCost(100, 1);
  assert minCost == 10_000;

  // 100 shares @ $0.50 (5000 bp) = $50.00 = 50_000_000 base units
  let largeCost = ToolContext.orderCost(5000, 100);
  assert largeCost == 50_000_000;

  Debug.print("✓ Test 9: Order cost calculation passed");
};

// ─── Test 10: Payout calculation ─────────────────────────
do {
  let winPos : ToolContext.Position = {
    positionId = "p1";
    marketId = "0";
    user = user1;
    outcome = #Yes;
    shares = 10;
    costBasis = 6_000_000;
    averagePrice = 6000;
  };

  // Winner: 10 shares × $1.00 = $10.00, minus 2% rake = $9.80
  let payout = ToolContext.calculatePayout(winPos, #Yes);
  assert payout == 9_800_000; // $9.80

  // Loser: $0
  let losePayout = ToolContext.calculatePayout(winPos, #No);
  assert losePayout == 0;

  Debug.print("✓ Test 10: Payout calculation passed");
};

// ─── Test 11: Best prices / spread ───────────────────────
do {
  var book = OrderBook.emptyBook();

  let yesOrder = makeOrder("y1", 1, #Yes, 5500, 10, 1);
  let noOrder = makeOrder("n1", 2, #No, 4000, 10, 2);
  book := OrderBook.insertOrder(book, yesOrder);
  book := OrderBook.insertOrder(book, noOrder);

  let bp = OrderBook.bestPrices(book);
  assert bp.bestYesBid == 5500;
  assert bp.bestNoBid == 4000;
  assert bp.impliedYesAsk == 6000;  // 10000 - 4000
  assert bp.impliedNoAsk == 4500;   // 10000 - 5500
  assert bp.spread == 500;          // 6000 - 5500

  Debug.print("✓ Test 11: Best prices / spread passed");
};

// ─── Test 12: cancelAllOrders ────────────────────────────
do {
  var book = OrderBook.emptyBook();

  book := OrderBook.insertOrder(book, makeOrder("y1", 1, #Yes, 5500, 10, 1));
  book := OrderBook.insertOrder(book, makeOrder("y2", 2, #Yes, 5000, 5, 2));
  book := OrderBook.insertOrder(book, makeOrder("n1", 3, #No, 4000, 8, 3));

  assert OrderBook.countOrders(book, null) == 3;

  let cancelled = OrderBook.cancelAllOrders(book);
  assert cancelled.size() == 3;

  // All should be marked cancelled
  for (o in cancelled.vals()) {
    assert o.status == #Cancelled;
  };

  Debug.print("✓ Test 12: cancelAllOrders passed");
};

// ─── Test 13: Depth query ────────────────────────────────
do {
  var book = OrderBook.emptyBook();

  book := OrderBook.insertOrder(book, makeOrder("y1", 1, #Yes, 6000, 10, 1));
  book := OrderBook.insertOrder(book, makeOrder("y2", 2, #Yes, 6000, 5, 2));
  book := OrderBook.insertOrder(book, makeOrder("y3", 3, #Yes, 5500, 8, 3));

  let d = OrderBook.depth(book, 10);
  assert d.yesBids.size() == 2; // two price levels
  assert d.yesBids[0].price == 6000;
  assert d.yesBids[0].totalSize == 15; // 10 + 5
  assert d.yesBids[0].orderCount == 2;
  assert d.yesBids[1].price == 5500;
  assert d.yesBids[1].totalSize == 8;

  Debug.print("✓ Test 13: Depth query passed");
};

Debug.print("\n══════════════════════════════════════════");
Debug.print("All 13 OrderBook tests passed! ✓");
Debug.print("══════════════════════════════════════════");
