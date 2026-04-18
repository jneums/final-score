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

      let priceBps : Nat = Int.abs(Float.toInt(priceFloat * 10000.0));
      if (not ToolContext.isValidPrice(priceBps)) {
        return ToolContext.makeError("Invalid price. Must be 0.01 to 0.99 in $0.01 increments.", cb);
      };

      let size = switch (Result.toOption(Json.getAsNat(_args, "size"))) {
        case (?s) s;
        case null return ToolContext.makeError("size is required (number of shares)", cb);
      };

      if (size == 0) return ToolContext.makeError("Size must be at least 1 share", cb);

      // Check minimum cost
      let cost = ToolContext.orderCost(priceBps, size);
      if (cost < ToolContext.MINIMUM_COST) {
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

      // No pre-flight balance/allowance check — icrc2_transfer_from will fail naturally
      let ledger = actor (Principal.toText(context.tokenLedger)) : actor {
        icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
        icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
      };

      // Create the order
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

      // Process fills
      // ATOMIC PER-FILL: update book incrementally so trap after fill N is safe
      var fillsJson : [Json.Json] = [];
      var currentBook = book;
      for (fill in result.fills.vals()) {
        let tradeId = ToolContext.getNextTradeId(context);

        let takerCostPerShare = (order.price * ToolContext.SHARE_VALUE) / ToolContext.BPS_DENOM;
        let takerCost = takerCostPerShare * fill.size;
        let makerCostPerShare = (fill.price * ToolContext.SHARE_VALUE) / ToolContext.BPS_DENOM;
        let makerCost = makerCostPerShare * fill.size;
        let fee = ToolContext.takerFee(order.price, fill.size);

        let marketAccount = ToolContext.getMarketAccount(context.canisterPrincipal, marketId);
        let takerTotal = takerCost + fee;

        // Pull taker funds
        let takerOk = try {
          let takerResult = await ledger.icrc2_transfer_from({
            spender_subaccount = null;
            from = { owner = fill.taker; subaccount = null };
            to = marketAccount;
            amount = takerTotal;
            fee = ?ToolContext.TRANSFER_FEE;
            memo = null;
            created_at_time = null;
          });
          switch (takerResult) {
            case (#Err(err)) { Debug.print("MCP taker transfer failed: " # debug_show(err)); false };
            case (#Ok(_)) true;
          };
        } catch (e) { Debug.print("MCP taker exception: " # Error.message(e)); false };

        if (not takerOk) {
          Debug.print("Skipping fill — taker transfer failed");
        } else {
          // Pull maker funds
          let makerOk = try {
            let makerResult = await ledger.icrc2_transfer_from({
              spender_subaccount = null;
              from = { owner = fill.maker; subaccount = null };
              to = marketAccount;
              amount = makerCost;
              fee = ?ToolContext.TRANSFER_FEE;
              memo = null;
              created_at_time = null;
            });
            switch (makerResult) {
              case (#Err(err)) { Debug.print("MCP maker transfer failed: " # debug_show(err)); false };
              case (#Ok(_)) true;
            };
          } catch (e) { Debug.print("MCP maker exception: " # Error.message(e)); false };

          if (not makerOk) {
            // Refund taker
            try {
              ignore await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = fill.taker; subaccount = null };
                amount = takerTotal - ToolContext.TRANSFER_FEE;
                fee = ?ToolContext.TRANSFER_FEE;
                memo = null;
                created_at_time = null;
              });
            } catch (e) { Debug.print("MCP taker refund failed: " # Error.message(e)) };
            // Restore maker's order to the book (it was consumed by matchOrder)
            switch (Map.get(context.orders, Map.thash, fill.makerOrderId)) {
              case (?makerOrder) {
                currentBook := OrderBook.insertOrder(currentBook, makerOrder);
                Map.set(ctx.orderBooks, Map.thash, marketId, currentBook);
                Debug.print("Restored maker order " # fill.makerOrderId # " to book");
              };
              case null {};
            };
            Debug.print("Skipping fill — maker failed, taker refunded");
          } else {
            // Both succeeded — commit fill
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

            ignore ToolContext.upsertPosition(context, fill.taker, marketId, outcome, fill.size, takerCost + fee, order.price);
            let makerOutcome : ToolContext.Outcome = switch (outcome) { case (#Yes) #No; case (#No) #Yes };
            ignore ToolContext.upsertPosition(context, fill.maker, marketId, makerOutcome, fill.size, makerCost, fill.price);

            ToolContext.recordTrade(context, fill.taker, takerCost);
            ToolContext.recordTrade(context, fill.maker, makerCost);

            // ATOMIC: update maker order status immediately
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

            // ATOMIC: remove consumed maker order from book per-fill
            currentBook := OrderBook.removeOrder(currentBook, fill.makerOrderId, makerOutcome);
            Map.set(ctx.orderBooks, Map.thash, marketId, currentBook);

            fillsJson := Array.append(fillsJson, [Json.obj([
              ("trade_id", Json.str(tradeId)),
              ("price", Json.str(Nat.toText(fill.price))),
              ("size", Json.str(Nat.toText(fill.size))),
              ("counterparty", Json.str(Principal.toText(fill.maker))),
            ])]);
          };
        };
      };

      // Net opposing positions — SAFETY: check overlap first, transfer, THEN delete
      var nettedUsers = Map.new<Principal, Bool>();
      for (fill in result.fills.vals()) {
        Map.set(nettedUsers, Map.phash, fill.taker, true);
        Map.set(nettedUsers, Map.phash, fill.maker, true);
      };
      for ((user, _) in Map.entries(nettedUsers)) {
        let overlap = ToolContext.getNetOverlap(context, user, marketId);
        if (overlap > 0) {
          let payout = overlap * ToolContext.SHARE_VALUE;
          if (payout > ToolContext.TRANSFER_FEE) {
            let refundOk = try {
              let refundResult = await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = user; subaccount = null };
                amount = payout - ToolContext.TRANSFER_FEE;
                fee = ?ToolContext.TRANSFER_FEE;
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

      // Update the order book — use already-updated currentBook (not result.updatedBook)
      var finalBook = currentBook;

      // Handle the remaining unfilled portion
      let finalOrder = switch (result.remainingOrder) {
        case (?remaining) {
          // Insert remainder into the book
          finalBook := OrderBook.insertOrder(finalBook, remaining);
          Map.set(context.orders, Map.thash, orderId, remaining);
          remaining;
        };
        case null {
          // Fully filled
          let filled = { order with filledSize = order.size; status = #Filled };
          Map.set(context.orders, Map.thash, orderId, filled);
          filled;
        };
      };

      Map.set(ctx.orderBooks, Map.thash, marketId, finalBook);

      // Update market last price
      let _lastPrice = if (result.fills.size() > 0) {
        let lastFill = result.fills[result.fills.size() - 1];
        // The fill price is the maker's side price. Convert to Yes/No price.
        switch (outcome) {
          case (#Yes) {
            // Taker bought Yes, fill.price is what the No-side maker rested at
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
        ("filled", Json.str(Nat.toText(finalOrder.filledSize))),
        ("remaining", Json.str(Nat.toText(finalOrder.size - finalOrder.filledSize))),
        ("fills", Json.arr(fillsJson)),
      ]), cb);
    };
  };
};
