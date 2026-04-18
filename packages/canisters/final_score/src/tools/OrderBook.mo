import Array "mo:base/Array";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";

import ToolContext "ToolContext";

module OrderBook {

  // ═══════════════════════════════════════════════════════════
  // Types
  // ═══════════════════════════════════════════════════════════

  /// A price level — all orders resting at the same price (FIFO queue)
  public type PriceLevel = {
    price : Nat; // basis points
    orders : [ToolContext.Order]; // oldest first
  };

  /// One side of the book (sorted price levels)
  public type BookSide = {
    levels : [PriceLevel]; // bids: descending price; asks: ascending
  };

  /// Full order book for a market.
  /// We store Buy Yes bids and Buy No bids separately.
  /// Matching: Buy Yes @ P matches Buy No @ (10000 - P) or better.
  public type Book = {
    yesBids : BookSide; // Buy Yes orders, sorted price DESC (best bid first)
    noBids : BookSide; // Buy No orders, sorted price DESC (best bid first)
  };

  /// Result of a fill between two orders
  public type Fill = {
    makerOrderId : Text;
    takerOrderId : Text;
    maker : Principal;
    taker : Principal;
    outcome : ToolContext.Outcome; // taker's outcome
    price : Nat; // execution price (maker's price for the maker's side)
    size : Nat; // shares matched
  };

  /// Result of attempting to match a new order
  public type MatchResult = {
    fills : [Fill];
    remainingOrder : ?ToolContext.Order; // null if fully filled
    updatedBook : Book; // book after removing matched resting orders
  };

  // ═══════════════════════════════════════════════════════════
  // Constructor
  // ═══════════════════════════════════════════════════════════

  public func emptyBook() : Book {
    {
      yesBids = { levels = [] };
      noBids = { levels = [] };
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Core Matching
  // ═══════════════════════════════════════════════════════════

  /// Try to match a new order against the book.
  ///
  /// Key insight: Buy Yes @ P matches with Buy No @ Q when P + Q >= 10000.
  /// The taker always pays their stated price. The maker pays their stated price.
  /// Together they cover the $1.00 share pair. Any surplus (P + Q > 10000) is
  /// split by executing at the maker's resting price.
  ///
  /// For sells: Sell Yes = Buy No at complement. Normalize before calling.
  public func matchOrder(book : Book, order : ToolContext.Order) : MatchResult {
    // Determine which side has the resting contra orders
    let (contraLevels, _isYesTaker) = switch (order.outcome) {
      case (#Yes) { (book.noBids.levels, true) };
      case (#No) { (book.yesBids.levels, false) };
    };

    var fills : [Fill] = [];
    var remainingSize : Nat = order.size - order.filledSize;
    var updatedContraLevels : [PriceLevel] = [];
    var doneMatching = false;
    var fillCount : Nat = 0;

    for (level in contraLevels.vals()) {
      if (doneMatching or remainingSize == 0 or fillCount >= ToolContext.MAX_FILLS_PER_ORDER) {
        // Keep remaining levels unchanged
        updatedContraLevels := Array.append(updatedContraLevels, [level]);
      } else {
        // Check complement: taker's price + maker's price >= 10000
        let complementPrice = ToolContext.BPS_DENOM - level.price;
        if (order.price < complementPrice) {
          // Taker's price too low to match — no more levels will match either
          // (contra levels are sorted best-first = highest price = lowest complement)
          updatedContraLevels := Array.append(updatedContraLevels, [level]);
          doneMatching := true;
        } else {
          // Match against orders at this level
          var updatedOrders : [ToolContext.Order] = [];

          for (resting in level.orders.vals()) {
            if (remainingSize == 0 or fillCount >= ToolContext.MAX_FILLS_PER_ORDER) {
              // Keep unmatched resting orders
              updatedOrders := Array.append(updatedOrders, [resting]);
            } else {
              // No self-trade prevention — opposite-outcome self-matching
              // is valid in prediction markets (hedging, closing positions).
              let restingRemaining = resting.size - resting.filledSize;
              let fillSize = Nat.min(remainingSize, restingRemaining);

              let fill : Fill = {
                makerOrderId = resting.orderId;
                takerOrderId = order.orderId;
                maker = resting.user;
                taker = order.user;
                outcome = order.outcome;
                price = level.price; // maker's resting price (for maker's side)
                size = fillSize;
              };

              fills := Array.append(fills, [fill]);
              remainingSize -= fillSize;
              fillCount += 1;

              // If resting order still has remaining, keep it
              if (restingRemaining > fillSize) {
                updatedOrders := Array.append(updatedOrders, [{
                  resting with
                  filledSize = resting.filledSize + fillSize;
                  status = #PartiallyFilled;
                }]);
              };
              // If fully filled, drop it from the book
            };
          };

          // If level still has orders, keep it
          if (updatedOrders.size() > 0) {
            updatedContraLevels := Array.append(updatedContraLevels, [{
              price = level.price;
              orders = updatedOrders;
            }]);
          };
          // Otherwise the level is consumed — don't add it back
        };
      };
    };

    // Build the remaining order (if any)
    let filledSoFar = order.size - remainingSize;
    let remainingOrder : ?ToolContext.Order = if (remainingSize == 0) {
      null; // fully filled
    } else {
      ?{
        order with
        filledSize = filledSoFar;
        status = if (filledSoFar > 0) #PartiallyFilled else #Open;
      };
    };

    // Rebuild the book with updated contra side
    let updatedBook = switch (order.outcome) {
      case (#Yes) {
        {
          yesBids = book.yesBids;
          noBids = { levels = updatedContraLevels };
        };
      };
      case (#No) {
        {
          yesBids = { levels = updatedContraLevels };
          noBids = book.noBids;
        };
      };
    };

    { fills; remainingOrder; updatedBook };
  };

  // ═══════════════════════════════════════════════════════════
  // Book Mutation
  // ═══════════════════════════════════════════════════════════

  /// Insert a resting order into the appropriate side of the book
  public func insertOrder(book : Book, order : ToolContext.Order) : Book {
    switch (order.outcome) {
      case (#Yes) {
        {
          yesBids = insertIntoSide(book.yesBids, order);
          noBids = book.noBids;
        };
      };
      case (#No) {
        {
          yesBids = book.yesBids;
          noBids = insertIntoSide(book.noBids, order);
        };
      };
    };
  };

  /// Insert an order into a book side (maintaining descending price sort)
  func insertIntoSide(side : BookSide, order : ToolContext.Order) : BookSide {
    var inserted = false;
    var result : [PriceLevel] = [];

    for (level in side.levels.vals()) {
      if (not inserted and order.price > level.price) {
        // Insert new level before this one
        result := Array.append(result, [{ price = order.price; orders = [order] }]);
        inserted := true;
      };

      if (order.price == level.price and not inserted) {
        // Same price level — append to FIFO queue
        result := Array.append(result, [{
          price = level.price;
          orders = Array.append(level.orders, [order]);
        }]);
        inserted := true;
      } else {
        result := Array.append(result, [level]);
      };
    };

    if (not inserted) {
      // Lowest price or empty book — append at end
      result := Array.append(result, [{ price = order.price; orders = [order] }]);
    };

    { levels = result };
  };

  /// Remove an order from the book by ID
  public func removeOrder(book : Book, orderId : Text, outcome : ToolContext.Outcome) : Book {
    switch (outcome) {
      case (#Yes) {
        {
          yesBids = removeFromSide(book.yesBids, orderId);
          noBids = book.noBids;
        };
      };
      case (#No) {
        {
          yesBids = book.yesBids;
          noBids = removeFromSide(book.noBids, orderId);
        };
      };
    };
  };

  func removeFromSide(side : BookSide, orderId : Text) : BookSide {
    var result : [PriceLevel] = [];

    for (level in side.levels.vals()) {
      let filtered = Array.filter<ToolContext.Order>(
        level.orders,
        func(o : ToolContext.Order) : Bool { o.orderId != orderId },
      );
      if (filtered.size() > 0) {
        result := Array.append(result, [{ price = level.price; orders = filtered }]);
      };
    };

    { levels = result };
  };

  /// Cancel all orders in a market (for deadline enforcement / resolution)
  /// Returns the list of cancelled orders (for refund processing)
  public func cancelAllOrders(book : Book) : [ToolContext.Order] {
    var cancelled : [ToolContext.Order] = [];

    for (level in book.yesBids.levels.vals()) {
      for (order in level.orders.vals()) {
        cancelled := Array.append(cancelled, [{
          order with status = #Cancelled;
        }]);
      };
    };

    for (level in book.noBids.levels.vals()) {
      for (order in level.orders.vals()) {
        cancelled := Array.append(cancelled, [{
          order with status = #Cancelled;
        }]);
      };
    };

    cancelled;
  };

  // ═══════════════════════════════════════════════════════════
  // Query Helpers
  // ═══════════════════════════════════════════════════════════

  /// Get best bid prices and spread
  public type BestPrices = {
    bestYesBid : Nat; // 0 if no bids
    bestNoBid : Nat; // 0 if no bids
    impliedYesAsk : Nat; // 10000 - bestNoBid (what you'd pay to buy Yes)
    impliedNoAsk : Nat; // 10000 - bestYesBid (what you'd pay to buy No)
    spread : Nat; // impliedYesAsk - bestYesBid (0 if crossed)
  };

  public func bestPrices(book : Book) : BestPrices {
    let bestYes = switch (book.yesBids.levels.size()) {
      case 0 0;
      case _ book.yesBids.levels[0].price;
    };
    let bestNo = switch (book.noBids.levels.size()) {
      case 0 0;
      case _ book.noBids.levels[0].price;
    };
    let impliedYesAsk = if (bestNo > 0) { ToolContext.BPS_DENOM - bestNo } else { ToolContext.BPS_DENOM };
    let impliedNoAsk = if (bestYes > 0) { ToolContext.BPS_DENOM - bestYes } else { ToolContext.BPS_DENOM };
    let spread = if (impliedYesAsk > bestYes) { impliedYesAsk - bestYes } else { 0 };

    { bestYesBid = bestYes; bestNoBid = bestNo; impliedYesAsk; impliedNoAsk; spread };
  };

  /// Aggregated depth for UI display
  public type DepthLevel = {
    price : Nat;
    totalSize : Nat; // total shares at this level
    orderCount : Nat;
  };

  public func depth(book : Book, maxLevels : Nat) : {
    yesBids : [DepthLevel];
    noBids : [DepthLevel];
  } {
    {
      yesBids = sideDepth(book.yesBids, maxLevels);
      noBids = sideDepth(book.noBids, maxLevels);
    };
  };

  func sideDepth(side : BookSide, maxLevels : Nat) : [DepthLevel] {
    var result : [DepthLevel] = [];
    var count = 0;
    for (level in side.levels.vals()) {
      if (count >= maxLevels) return result;
      var totalSize : Nat = 0;
      for (order in level.orders.vals()) {
        totalSize += (order.size - order.filledSize);
      };
      if (totalSize > 0) {
        result := Array.append(result, [{
          price = level.price;
          totalSize;
          orderCount = level.orders.size();
        }]);
        count += 1;
      };
    };
    result;
  };

  /// Count all open orders in a book (for a specific user, or all)
  public func countOrders(book : Book, user : ?Principal) : Nat {
    var count = 0;
    for (level in book.yesBids.levels.vals()) {
      for (order in level.orders.vals()) {
        switch (user) {
          case (?u) { if (Principal.equal(order.user, u)) count += 1 };
          case null { count += 1 };
        };
      };
    };
    for (level in book.noBids.levels.vals()) {
      for (order in level.orders.vals()) {
        switch (user) {
          case (?u) { if (Principal.equal(order.user, u)) count += 1 };
          case null { count += 1 };
        };
      };
    };
    count;
  };
};
