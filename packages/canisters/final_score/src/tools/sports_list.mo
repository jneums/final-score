import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Text "mo:base/Text";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "sports_list";
    title = ?"Available Sports";
    description = ?(
      "List all available sports with their active market counts. " #
      "Use sport slugs to filter markets in other tools."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Count markets per sport
      var sportCounts = Map.new<Text, Nat>();
      var sportOpenCounts = Map.new<Text, Nat>();

      for ((_, market) in Map.entries(context.markets)) {
        let sport = market.sport;

        // Total count
        let current = switch (Map.get(sportCounts, Map.thash, sport)) {
          case (?n) n; case null 0;
        };
        Map.set(sportCounts, Map.thash, sport, current + 1);

        // Open count
        switch (market.status) {
          case (#Open) {
            let openCurrent = switch (Map.get(sportOpenCounts, Map.thash, sport)) {
              case (?n) n; case null 0;
            };
            Map.set(sportOpenCounts, Map.thash, sport, openCurrent + 1);
          };
          case _ {};
        };
      };

      // Build result array
      var sportsJson : [Json.Json] = [];

      for ((sport, total) in Map.entries(sportCounts)) {
        let openCount = switch (Map.get(sportOpenCounts, Map.thash, sport)) {
          case (?n) n; case null 0;
        };

        sportsJson := Array.append(sportsJson, [Json.obj([
          ("sport", Json.str(sport)),
          ("total_markets", #number(#int(total))),
          ("open_markets", #number(#int(openCount))),
        ])]);
      };

      // Sort by open_markets descending
      let sorted = Array.sort<Json.Json>(sportsJson, func(a, b) {
        let aCount = switch (Json.getAsNat(a, "open_markets")) { case (#ok(n)) n; case _ 0 };
        let bCount = switch (Json.getAsNat(b, "open_markets")) { case (#ok(n)) n; case _ 0 };
        if (aCount > bCount) #less else if (aCount < bCount) #greater else #equal;
      });

      ToolContext.makeSuccess(Json.obj([
        ("sports", Json.arr(sorted)),
        ("count", #number(#int(sorted.size()))),
        ("total_markets", #number(#int(Map.size(context.markets)))),
      ]), cb);
    };
  };
};
