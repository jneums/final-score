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
    name = "leaderboard";
    title = ?"Leaderboard";
    description = ?(
      "Top traders ranked by net profit. " #
      "Shows trading stats including total volume, markets won/lost, and P&L."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("limit", Json.obj([("type", Json.str("integer")), ("description", Json.str("Max results (default: 20)"))])),
        ("sort_by", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("profit"), Json.str("volume"), Json.str("trades")])), ("description", Json.str("Sort criteria (default: profit)"))])),
      ])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let maxResults = switch (Result.toOption(Json.getAsNat(_args, "limit"))) {
        case (?n) n;
        case null 20;
      };

      let sortBy = switch (Result.toOption(Json.getAsText(_args, "sort_by"))) {
        case (?s) s;
        case null "profit";
      };

      // Collect all stats
      var allStats : [ToolContext.UserStats] = [];
      for ((_, stats) in Map.entries(context.userStats)) {
        if (stats.totalTrades > 0) {
          allStats := Array.append(allStats, [stats]);
        };
      };

      // Sort
      let sorted = Array.sort<ToolContext.UserStats>(allStats, func(a, b) {
        switch (sortBy) {
          case ("volume") {
            if (a.totalVolume > b.totalVolume) #less
            else if (a.totalVolume < b.totalVolume) #greater
            else #equal;
          };
          case ("trades") {
            if (a.totalTrades > b.totalTrades) #less
            else if (a.totalTrades < b.totalTrades) #greater
            else #equal;
          };
          case _ {
            // profit (default)
            if (a.netProfit > b.netProfit) #less
            else if (a.netProfit < b.netProfit) #greater
            else #equal;
          };
        };
      });

      // Take top N
      let topN = if (sorted.size() > maxResults) {
        Array.tabulate<ToolContext.UserStats>(maxResults, func(i) { sorted[i] });
      } else { sorted };

      // Format
      var leaderboardJson : [Json.Json] = [];
      var rank = 1;
      for (stats in topN.vals()) {
        leaderboardJson := Array.append(leaderboardJson, [Json.obj([
          ("rank", #number(#int(rank))),
          ("user", Json.str(Principal.toText(stats.userPrincipal))),
          ("net_profit", #number(#int(stats.netProfit))),
          ("total_volume", Json.str(Nat.toText(stats.totalVolume))),
          ("total_trades", #number(#int(stats.totalTrades))),
          ("markets_won", #number(#int(stats.marketsWon))),
          ("markets_lost", #number(#int(stats.marketsLost))),
          ("total_payout", Json.str(Nat.toText(stats.totalPayout))),
        ])]);
        rank += 1;
      };

      ToolContext.makeSuccess(Json.obj([
        ("leaderboard", Json.arr(leaderboardJson)),
        ("total_traders", #number(#int(allStats.size()))),
        ("sort_by", Json.str(sortBy)),
      ]), cb);
    };
  };
};
