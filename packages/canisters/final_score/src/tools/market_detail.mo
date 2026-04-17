import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Text "mo:base/Text";

import ToolContext "ToolContext";
import OrderBook "OrderBook";

module {

  public func config() : McpTypes.Tool = {
    name = "market_detail";
    title = ?"Market Detail";
    description = ?(
      "Get detailed information about a specific market including the order book depth and recent trades."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("market_id", Json.obj([("type", Json.str("string")), ("description", Json.str("The market ID"))])),
      ])),
      ("required", Json.arr([Json.str("market_id")])),
    ]);
    outputSchema = null;
  };

  public type DetailContext = {
    toolContext : ToolContext.ToolContext;
    orderBooks : Map.Map<Text, OrderBook.Book>;
  };

  public func handle(ctx : DetailContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let marketId = switch (Result.toOption(Json.getAsText(_args, "market_id"))) {
        case (?id) id;
        case null return ToolContext.makeError("market_id is required", cb);
      };

      let context = ctx.toolContext;

      let market = switch (Map.get(context.markets, Map.thash, marketId)) {
        case (?m) m;
        case null return ToolContext.makeError("Market not found: " # marketId, cb);
      };

      // Order book depth
      let bookDepth = switch (Map.get(ctx.orderBooks, Map.thash, marketId)) {
        case (?book) {
          let d = OrderBook.depth(book, 10);
          let bp = OrderBook.bestPrices(book);
          {
            yesBids = d.yesBids;
            noBids = d.noBids;
            bestYesBid = bp.bestYesBid;
            bestNoBid = bp.bestNoBid;
            spread = bp.spread;
          };
        };
        case null {
          {
            yesBids = [] : [OrderBook.DepthLevel];
            noBids = [] : [OrderBook.DepthLevel];
            bestYesBid = 0;
            bestNoBid = 0;
            spread = 0;
          };
        };
      };

      // Format depth levels
      func formatLevels(levels : [OrderBook.DepthLevel]) : [Json.Json] {
        Array.map<OrderBook.DepthLevel, Json.Json>(levels, func(l) {
          Json.obj([
            ("price_bps", #number(#int(l.price))),
            ("total_shares", #number(#int(l.totalSize))),
            ("orders", #number(#int(l.orderCount))),
          ]);
        });
      };

      // Recent trades (last 20)
      var recentTrades : [Json.Json] = [];
      for ((_, trade) in Map.entries(context.trades)) {
        if (trade.marketId == marketId) {
          recentTrades := Array.append(recentTrades, [Json.obj([
            ("trade_id", Json.str(trade.tradeId)),
            ("outcome", Json.str(ToolContext.outcomeToText(trade.outcome))),
            ("price_bps", #number(#int(trade.price))),
            ("size", #number(#int(trade.size))),
            ("timestamp", #number(#int(trade.timestamp))),
          ])]);
        };
      };

      // Sort by timestamp desc and take last 20
      let sortedTrades = Array.sort<Json.Json>(recentTrades, func(a, b) {
        let tsA = switch (Json.getAsNat(a, "timestamp")) { case (#ok(n)) n; case _ 0 };
        let tsB = switch (Json.getAsNat(b, "timestamp")) { case (#ok(n)) n; case _ 0 };
        if (tsA > tsB) #less else if (tsA < tsB) #greater else #equal;
      });
      let last20 = if (sortedTrades.size() > 20) {
        Array.tabulate<Json.Json>(20, func(i) { sortedTrades[i] });
      } else { sortedTrades };

      ToolContext.makeSuccess(Json.obj([
        ("market_id", Json.str(market.marketId)),
        ("question", Json.str(market.question)),
        ("event_title", Json.str(market.eventTitle)),
        ("sport", Json.str(market.sport)),
        ("status", Json.str(ToolContext.marketStatusToText(market.status))),
        ("end_date", #number(#int(market.endDate))),
        ("yes_price_bps", #number(#int(market.lastYesPrice))),
        ("no_price_bps", #number(#int(market.lastNoPrice))),
        ("total_volume", Json.str(Nat.toText(market.totalVolume))),
        ("polymarket_slug", Json.str(market.polymarketSlug)),
        ("polymarket_yes_price", #number(#int(market.polymarketYesPrice))),
        ("polymarket_no_price", #number(#int(market.polymarketNoPrice))),
        ("order_book", Json.obj([
          ("best_yes_bid", #number(#int(bookDepth.bestYesBid))),
          ("best_no_bid", #number(#int(bookDepth.bestNoBid))),
          ("spread_bps", #number(#int(bookDepth.spread))),
          ("yes_bids", Json.arr(formatLevels(bookDepth.yesBids))),
          ("no_bids", Json.arr(formatLevels(bookDepth.noBids))),
        ])),
        ("recent_trades", Json.arr(last20)),
      ]), cb);
    };
  };
};
