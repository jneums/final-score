import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Float "mo:base/Float";
import Array "mo:base/Array";
import Time "mo:base/Time";
import Map "mo:map/Map";
import Text "mo:base/Text";
import Principal "mo:base/Principal";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Nat64 "mo:base/Nat64";
import ICRC2 "mo:icrc2-types";

import ToolContext "ToolContext";
import OrderBook "OrderBook";

module {

  public func config() : McpTypes.Tool = {
    name = "order_place";
    title = ?"Place a Limit Order";
    description = ?(
      "Place a limit order to buy outcome shares. " #
      "Specify the market, outcome (yes/no), price (0.01-0.99), and number of shares. " #
      "Price is in dollars (e.g., 0.60 means $0.60 per share). " #
      "If your order matches resting orders, it fills immediately. Otherwise it rests on the book. " #
      "Funds are escrowed from your balance when placing an order. " #
      "Winning shares pay out $1.00 each when the market resolves."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("market_id", Json.obj([("type", Json.str("string")), ("description", Json.str("The market ID"))])),
        ("outcome", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("yes"), Json.str("no")])), ("description", Json.str("Which outcome to buy: 'yes' or 'no'"))])),
        ("price", Json.obj([("type", Json.str("number")), ("description", Json.str("Price per share in dollars (0.01 to 0.99, in $0.01 increments)"))])),
        ("size", Json.obj([("type", Json.str("integer")), ("description", Json.str("Number of shares to buy (minimum 1)"))])),
      ])),
      ("required", Json.arr([Json.str("market_id"), Json.str("outcome"), Json.str("price"), Json.str("size")])),
    ]);
    outputSchema = null;
  };

  /// The order_place handler needs access to the order book state.
  /// It takes a PlaceContext that includes everything needed.
  public type PlaceContext = {
    toolContext : ToolContext.ToolContext;
    orderBooks : Map.Map<Text, OrderBook.Book>;
    lastOrderTime : Map.Map<Principal, Int>;
    orderCooldownNs : Int;
  };

  public func handle(ctx : PlaceContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;
      let context = ctx.toolContext;

      // Rate limit: 2-second cooldown per user
      let now = Time.now();
      switch (Map.get(ctx.lastOrderTime, Map.phash, userPrincipal)) {
        case (?last) {
          if (now - last < ctx.orderCooldownNs) {
            return ToolContext.makeError("Rate limited. Wait 2 seconds between orders.", cb);
          };
        };
        case null {};
      };
      Map.set(ctx.lastOrderTime, Map.phash, userPrincipal, now);

      // Parse arguments
      let marketId = switch (Result.toOption(Json.getAsText(_args, "market_id"))) {
        case (?id) id;
        case null return ToolContext.makeError("market_id is required", cb);
      };

      let outcomeText = switch (Result.toOption(Json.getAsText(_args, "outcome"))) {
        case (?t) t;
        case null return ToolContext.makeError("outcome is required (yes/no)", cb);
      };

      let outcome = switch (ToolContext.parseOutcome(outcomeText)) {
        case (?o) o;
        case null return ToolContext.makeError("Invalid outcome. Use 'yes' or 'no'.", cb);
      };

      // Parse price as float, convert to basis points
      let priceFloat = switch (Result.toOption(Json.getAsFloat(_args, "price"))) {
        case (?p) p;
        case null return ToolContext.makeError("price is required (0.01 to 0.99)", cb);
      };

      let priceBps : Nat = Int.abs(Float.toInt(priceFloat * 10000.0 + 0.5));
      if (not ToolContext.isValidPrice(priceBps)) {
        return ToolContext.makeError("Invalid price. Must be 0.01 to 0.99 in $0.01 increments.", cb);
      };

      let size = switch (Result.toOption(Json.getAsNat(_args, "size"))) {
        case (?s) s;
        case null return ToolContext.makeError("size is required (number of shares)", cb);
      };

      if (size == 0) return ToolContext.makeError("Size must be at least 1 share", cb);

      // Check minimum cost
      let cost = ToolContext.orderCost(ctx.toolContext, priceBps, size);
      if (cost < ToolContext.MINIMUM_COST(ctx.toolContext)) {
        return ToolContext.makeError("Order too small. Minimum cost is 0.10 USDC.", cb);
      };

      // Check market exists and is open
      let market = switch (Map.get(context.markets, Map.thash, marketId)) {
        case (?m) m;
        case null return ToolContext.makeError("Market not found: " # marketId, cb);
      };

      switch (market.status) {
        case (#Open) {};
        case _ return ToolContext.makeError("Market is not open for trading", cb);
      };

      // ═══════════════════════════════════════════════════════════
      // PRE-FUND: Escrow full order cost BEFORE matching.
      // Same pattern as Candid place_order — guarantees all resting
      // orders are backed by real funds.
      // ═══════════════════════════════════════════════════════════
      let ledger = actor (Principal.toText(context.tokenLedger)) : actor {
        icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
        icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
      };

      let marketAccount = ToolContext.getMarketAccount(context.canisterPrincipal, marketId);

      let _escrowOk = try {
        let escrowResult = await ledger.icrc2_transfer_from({
          spender_subaccount = null;
          from = { owner = userPrincipal; subaccount = null };
          to = marketAccount;
          amount = cost;
          fee = ?ToolContext.TRANSFER_FEE(ctx.toolContext);
          memo = null;
          created_at_time = null;
        });
        switch (escrowResult) {
          case (#Err(err)) {
            return ToolContext.makeError("Escrow transfer failed: " # debug_show(err), cb);
          };
          case (#Ok(_)) true;
        };
      } catch (e) {
        return ToolContext.makeError("Escrow transfer exception: " # Error.message(e), cb);
      };

      // Funds are now in the market subaccount — order is guaranteed backed
      let orderId = ToolContext.getNextOrderId(context);

      let order : ToolContext.Order = {
        orderId;
        marketId;
        user = userPrincipal;
        side = #Buy;
        outcome;
        price = priceBps;
        size;
        filledSize = 0;
        status = #Open;
        timestamp = now;
      };

      // Track order under user for O(1) locked balance lookup
      ToolContext.trackUserOrder(context, userPrincipal, orderId);

      // Get order book
      let book = switch (Map.get(ctx.orderBooks, Map.thash, marketId)) {
        case (?b) b;
        case null OrderBook.emptyBook();
      };

      // Try to match
      let result = OrderBook.matchOrder(book, order);

      // ═══════════════════════════════════════════════════════════
      // Process fills — funds are ALREADY ESCROWED for both sides.
      // No inter-canister calls needed! Pure accounting.
      // (Same pattern as Candid place_order in main.mo)
      // ═══════════════════════════════════════════════════════════
      var fillsJson : [Json.Json] = [];
      var currentBook = result.updatedBook;
      var actualFilledSize : Nat = 0;

      for (fill in result.fills.vals()) {
        let tradeId = ToolContext.getNextTradeId(context);

        let takerCostPerShare = (order.price * ToolContext.SHARE_VALUE(ctx.toolContext)) / ToolContext.BPS_DENOM;
        let takerCost = takerCostPerShare * fill.size;
        let makerCostPerShare = (fill.price * ToolContext.SHARE_VALUE(ctx.toolContext)) / ToolContext.BPS_DENOM;
        let makerCost = makerCostPerShare * fill.size;

        // Both sides already have funds in the market subaccount — just commit
        let trade : ToolContext.Trade = {
          tradeId; marketId;
          makerOrderId = fill.makerOrderId;
          takerOrderId = fill.takerOrderId;
          maker = fill.maker; taker = fill.taker;
          outcome = fill.outcome;
          price = fill.price; size = fill.size;
          timestamp = now;
        };
        Map.set(context.trades, Map.thash, tradeId, trade);

        // Create/update positions
        let fee = ToolContext.takerFee(ctx.toolContext, order.price, fill.size);
        ignore ToolContext.upsertPosition(context, fill.taker, marketId, outcome, fill.size, takerCost + fee, order.price);
        let makerOutcome : ToolContext.Outcome = switch (outcome) { case (#Yes) #No; case (#No) #Yes };
        ignore ToolContext.upsertPosition(context, fill.maker, marketId, makerOutcome, fill.size, makerCost, fill.price);

        ToolContext.recordTrade(context, fill.taker, takerCost);
        ToolContext.recordTrade(context, fill.maker, makerCost);

        // Update maker order status
        switch (Map.get(context.orders, Map.thash, fill.makerOrderId)) {
          case (?makerOrder) {
            let newFilled = makerOrder.filledSize + fill.size;
            let newStatus = if (newFilled >= makerOrder.size) #Filled else #PartiallyFilled;
            Map.set(context.orders, Map.thash, fill.makerOrderId, {
              makerOrder with filledSize = newFilled; status = newStatus;
            });
          };
          case null {};
        };

        Map.set(ctx.orderBooks, Map.thash, marketId, currentBook);

        fillsJson := Array.append(fillsJson, [Json.obj([
          ("trade_id", Json.str(tradeId)),
          ("price", Json.str(Nat.toText(fill.price))),
          ("size", Json.str(Nat.toText(fill.size))),
          ("counterparty", Json.str(Principal.toText(fill.maker))),
        ])]);

        actualFilledSize += fill.size;
      };

      // ═══════════════════════════════════════════════════════════
      // Net opposing positions for all involved users
      // ═══════════════════════════════════════════════════════════
      var nettedUsers = Map.new<Principal, Bool>();
      for (fill in result.fills.vals()) {
        Map.set(nettedUsers, Map.phash, fill.taker, true);
        Map.set(nettedUsers, Map.phash, fill.maker, true);
      };
      for ((user, _) in Map.entries(nettedUsers)) {
        let overlap = ToolContext.getNetOverlap(context, user, marketId);
        if (overlap > 0) {
          let payout = overlap * ToolContext.SHARE_VALUE(ctx.toolContext);
          if (payout > ToolContext.TRANSFER_FEE(ctx.toolContext)) {
            let refundOk = try {
              let refundResult = await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = user; subaccount = null };
                amount = payout - ToolContext.TRANSFER_FEE(ctx.toolContext);
                fee = ?ToolContext.TRANSFER_FEE(ctx.toolContext);
                memo = null;
                created_at_time = null;
              });
              switch (refundResult) {
                case (#Ok(_)) true;
                case (#Err(_)) false;
              };
            } catch (_e) { false };

            if (refundOk) {
              ignore ToolContext.netPositions(context, user, marketId);
            } else {
              Debug.print("MCP netting refund failed — positions preserved for retry");
            };
          };
        };
      };

      // ═══════════════════════════════════════════════════════════
      // Determine final order status and handle unfilled remainder
      // ═══════════════════════════════════════════════════════════
      var finalBook = currentBook;

      let finalOrder = if (actualFilledSize >= order.size) {
        // Fully filled
        let filled = { order with filledSize = order.size; status = #Filled };
        Map.set(context.orders, Map.thash, orderId, filled);
        filled;
      } else if (actualFilledSize > 0) {
        // Partially filled — rest stays on the book (already escrowed)
        let partial = { order with filledSize = actualFilledSize; status = #PartiallyFilled };
        finalBook := OrderBook.insertOrder(finalBook, partial);
        Map.set(context.orders, Map.thash, orderId, partial);
        partial;
      } else {
        // No fills — entire order rests on the book (already escrowed)
        switch (result.remainingOrder) {
          case (?remaining) {
            finalBook := OrderBook.insertOrder(finalBook, remaining);
            Map.set(context.orders, Map.thash, orderId, remaining);
            remaining;
          };
          case null {
            let open = { order with status = #Open };
            finalBook := OrderBook.insertOrder(finalBook, open);
            Map.set(context.orders, Map.thash, orderId, open);
            open;
          };
        };
      };

      Map.set(ctx.orderBooks, Map.thash, marketId, finalBook);

      // Update market last price
      let _lastPrice = if (result.fills.size() > 0) {
        let lastFill = result.fills[result.fills.size() - 1];
        switch (outcome) {
          case (#Yes) {
            let yesPrice = ToolContext.BPS_DENOM - lastFill.price;
            Map.set(context.markets, Map.thash, marketId, {
              market with
              lastYesPrice = yesPrice;
              lastNoPrice = lastFill.price;
              totalVolume = market.totalVolume + cost;
            });
          };
          case (#No) {
            let noPrice = ToolContext.BPS_DENOM - lastFill.price;
            Map.set(context.markets, Map.thash, marketId, {
              market with
              lastYesPrice = lastFill.price;
              lastNoPrice = noPrice;
              totalVolume = market.totalVolume + cost;
            });
          };
        };
      };

      ToolContext.makeSuccess(Json.obj([
        ("order_id", Json.str(orderId)),
        ("status", Json.str(ToolContext.orderStatusToText(finalOrder.status))),
        ("filled", Json.str(Nat.toText(actualFilledSize))),
        ("remaining", Json.str(Nat.toText(order.size - actualFilledSize))),
        ("fills", Json.arr(fillsJson)),
      ]), cb);
    };
  };
};
