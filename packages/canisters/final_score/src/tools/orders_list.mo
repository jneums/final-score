import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Principal "mo:base/Principal";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "orders_list";
    title = ?"List My Orders";
    description = ?(
      "List your open and recently filled orders. " #
      "Shows order details including price, size, filled amount, and status."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("status", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("open"), Json.str("filled"), Json.str("all")])), ("description", Json.str("Filter by status (default: open)"))])),
        ("market_id", Json.obj([("type", Json.str("string")), ("description", Json.str("Optional: filter by market ID"))])),
      ])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      let statusFilter = switch (Result.toOption(Json.getAsText(_args, "status"))) {
        case (?s) s;
        case null "open";
      };

      let marketFilter = Result.toOption(Json.getAsText(_args, "market_id"));

      var userOrders : [Json.Json] = [];

      for ((_, order) in Map.entries(context.orders)) {
        if (Principal.equal(order.user, userPrincipal)) {
          // Apply status filter
          let shouldInclude = switch (statusFilter) {
            case ("open") order.status == #Open or order.status == #PartiallyFilled;
            case ("filled") order.status == #Filled;
            case ("all") true;
            case _ order.status == #Open or order.status == #PartiallyFilled;
          };

          // Apply market filter
          let marketMatch = switch (marketFilter) {
            case (?mid) order.marketId == mid;
            case null true;
          };

          if (shouldInclude and marketMatch) {
            let remaining = order.size - order.filledSize;
            let lockedUsdc = ToolContext.orderCost(order.price, remaining);

            // Look up market question for context
            let question = switch (Map.get(context.markets, Map.thash, order.marketId)) {
              case (?m) m.question;
              case null "Unknown market";
            };

            userOrders := Array.append(userOrders, [Json.obj([
              ("order_id", Json.str(order.orderId)),
              ("market_id", Json.str(order.marketId)),
              ("question", Json.str(question)),
              ("outcome", Json.str(ToolContext.outcomeToText(order.outcome))),
              ("price", Json.str(Nat.toText(order.price))),
              ("price_dollars", Json.str(priceToStr(order.price))),
              ("size", #number(#int(order.size))),
              ("filled_size", #number(#int(order.filledSize))),
              ("remaining", #number(#int(remaining))),
              ("locked_usdc", Json.str(Nat.toText(lockedUsdc))),
              ("status", Json.str(ToolContext.orderStatusToText(order.status))),
              ("timestamp", #number(#int(order.timestamp))),
            ])]);
          };
        };
      };

      ToolContext.makeSuccess(Json.obj([
        ("orders", Json.arr(userOrders)),
        ("count", #number(#int(userOrders.size()))),
      ]), cb);
    };
  };

  func priceToStr(bps : Nat) : Text {
    let dollars = bps / 100;
    let cents = bps % 100;
    "$0." # (if (dollars < 10) "0" else "") # Nat.toText(dollars) # (if (cents > 0) Nat.toText(cents) else "");
  };
};
