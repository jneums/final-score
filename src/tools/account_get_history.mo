import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Map "mo:map/Map";
import Iter "mo:base/Iter";
import Order "mo:base/Order";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "account_get_history";
    title = ?"Get Betting History";
    description = ?(
      "Retrieve your complete betting history including all settled positions from resolved markets. " #
      "Shows which teams you bet on, the outcome, and whether you won or lost. " #
      "Positions are sorted by resolution time (most recent first). Returns 5 entries per page."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("page", Json.obj([("type", Json.str("number")), ("description", Json.str("Page number to retrieve (default: 1). Each page contains 5 entries."))]))])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("history", Json.obj([("type", Json.str("array")), ("description", Json.str("List of settled betting positions")), ("items", Json.obj([("type", Json.str("object")), ("properties", Json.obj([("market_id", Json.obj([("type", Json.str("string")), ("description", Json.str("The market ID"))])), ("home_team", Json.obj([("type", Json.str("string")), ("description", Json.str("Home team name"))])), ("away_team", Json.obj([("type", Json.str("string")), ("description", Json.str("Away team name"))])), ("bet_outcome", Json.obj([("type", Json.str("string")), ("description", Json.str("What you bet on: HomeWin, AwayWin, or Draw"))])), ("bet_amount", Json.obj([("type", Json.str("string")), ("description", Json.str("Amount you bet in USDC base units (6 decimals)"))])), ("actual_outcome", Json.obj([("type", Json.str("string")), ("description", Json.str("Actual match result: HomeWin, AwayWin, or Draw"))])), ("payout", Json.obj([("type", Json.str("string")), ("description", Json.str("Amount you won (0 if you lost) in USDC base units"))])), ("result", Json.obj([("type", Json.str("string")), ("description", Json.str("'won' or 'lost'"))])), ("resolved_at", Json.obj([("type", Json.str("string")), ("description", Json.str("When the market was resolved (Unix timestamp)"))]))]))]))])), ("total_entries", Json.obj([("type", Json.str("number")), ("description", Json.str("Total number of history entries available"))]))])),
      ("required", Json.arr([Json.str("history"), Json.str("total_entries")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Check authentication
      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Parse page argument (default: 1)
      let page = switch (Result.toOption(Json.getAsNat(_args, "page"))) {
        case (?p) { if (p < 1) { 1 } else { p } };
        case (null) { 1 };
      };

      // Fixed page size
      let pageSize : Nat = 5;
      let offset = (page - 1) * pageSize;

      // Get user's position history
      let positionHistory = switch (Map.get(context.positionHistory, Map.phash, userPrincipal)) {
        case (?history) { history };
        case (null) { [] };
      };

      // Sort by resolved timestamp (most recent first)
      let sortedHistory = Array.sort<ToolContext.HistoricalPosition>(
        positionHistory,
        func(a : ToolContext.HistoricalPosition, b : ToolContext.HistoricalPosition) : Order.Order {
          if (a.resolvedAt > b.resolvedAt) { #less } else if (a.resolvedAt < b.resolvedAt) {
            #greater;
          } else { #equal };
        },
      );

      // Apply pagination
      let totalEntries = sortedHistory.size();
      let startIdx = if (offset > totalEntries) { totalEntries } else { offset };
      let endIdx = if (startIdx + pageSize > totalEntries) { totalEntries } else {
        startIdx + pageSize;
      };

      let limitedHistory = if (startIdx < endIdx) {
        Iter.toArray(Array.slice<ToolContext.HistoricalPosition>(sortedHistory, startIdx, endIdx));
      } else {
        [];
      };

      // Calculate total pages
      let totalPages = if (totalEntries == 0) { 0 } else { (totalEntries + pageSize - 1) / pageSize };

      // Convert to JSON
      let historyJson = Array.map<ToolContext.HistoricalPosition, Json.Json>(
        limitedHistory,
        func(entry : ToolContext.HistoricalPosition) : Json.Json {
          let outcomeToText = func(outcome : ToolContext.Outcome) : Text {
            switch (outcome) {
              case (#HomeWin) { "HomeWin" };
              case (#AwayWin) { "AwayWin" };
              case (#Draw) { "Draw" };
            };
          };

          Json.obj([
            ("market_id", Json.str(entry.marketId)),
            ("home_team", Json.str(entry.homeTeam)),
            ("away_team", Json.str(entry.awayTeam)),
            ("bet_outcome", Json.str(outcomeToText(entry.betOutcome))),
            ("bet_amount", Json.str(Nat.toText(entry.betAmount))),
            ("actual_outcome", Json.str(outcomeToText(entry.actualOutcome))),
            ("payout", Json.str(Nat.toText(entry.payout))),
            ("result", Json.str(if (entry.payout > 0) { "won" } else { "lost" })),
            ("resolved_at", Json.str(Nat.toText(entry.resolvedAt))),
          ]);
        },
      );

      let output = Json.obj([
        ("history", Json.arr(historyJson)),
        ("page", Json.str(Nat.toText(page))),
        ("page_size", Json.str(Nat.toText(pageSize))),
        ("total_entries", Json.str(Nat.toText(totalEntries))),
        ("total_pages", Json.str(Nat.toText(totalPages))),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
