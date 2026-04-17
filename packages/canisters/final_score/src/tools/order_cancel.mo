import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Text "mo:base/Text";

import ToolContext "ToolContext";
import OrderBook "OrderBook";

module {

  public func config() : McpTypes.Tool = {
    name = "order_cancel";
    title = ?"Cancel an Order";
    description = ?(
      "Cancel an open or partially-filled limit order. " #
      "The unfilled portion is released back to your available balance. " #
      "Provide the order_id to cancel."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("order_id", Json.obj([("type", Json.str("string")), ("description", Json.str("The order ID to cancel"))])),
      ])),
      ("required", Json.arr([Json.str("order_id")])),
    ]);
    outputSchema = null;
  };

  public type CancelContext = {
    toolContext : ToolContext.ToolContext;
    orderBooks : Map.Map<Text, OrderBook.Book>;
  };

  public func handle(ctx : CancelContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;
      let context = ctx.toolContext;

      let orderId = switch (Result.toOption(Json.getAsText(_args, "order_id"))) {
        case (?id) id;
        case null return ToolContext.makeError("order_id is required", cb);
      };

      // Find the order
      let order = switch (Map.get(context.orders, Map.thash, orderId)) {
        case (?o) o;
        case null return ToolContext.makeError("Order not found: " # orderId, cb);
      };

      // Verify ownership
      if (order.user != userPrincipal) {
        return ToolContext.makeError("You can only cancel your own orders", cb);
      };

      // Check cancelable status
      switch (order.status) {
        case (#Open or #PartiallyFilled) {};
        case _ return ToolContext.makeError("Order is not cancelable (status: " # ToolContext.orderStatusToText(order.status) # ")", cb);
      };

      // Remove from order book
      switch (Map.get(ctx.orderBooks, Map.thash, order.marketId)) {
        case (?book) {
          let updated = OrderBook.removeOrder(book, orderId, order.outcome);
          Map.set(ctx.orderBooks, Map.thash, order.marketId, updated);
        };
        case null {};
      };

      // Update order status
      let cancelled = { order with status = #Cancelled };
      Map.set(context.orders, Map.thash, orderId, cancelled);

      let remaining = order.size - order.filledSize;
      let refunded = ToolContext.orderCost(order.price, remaining);

      ToolContext.makeSuccess(Json.obj([
        ("order_id", Json.str(orderId)),
        ("status", Json.str("cancelled")),
        ("filled_size", #number(#int(order.filledSize))),
        ("cancelled_size", #number(#int(remaining))),
        ("refunded_usdc", Json.str(Nat.toText(refunded))),
      ]), cb);
    };
  };
};
