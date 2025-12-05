import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Map "mo:map/Map";
import Int "mo:base/Int";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "account_get_info";
    title = ?"Get Account Information";
    description = ?(
      "Returns a comprehensive overview of your account including your available USDC balance, " #
      "a list of all unclaimed positions (including resolved markets awaiting claim), and your " #
      "performance statistics (accuracy, profit, streaks, etc.). " #
      "Currency: USDC with 6 decimals. Balances shown in base units where 1,000,000 = $1 USDC."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([])),
      ("required", Json.arr([])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("owner", Json.obj([("type", Json.str("string")), ("description", Json.str("Your Internet Computer principal ID"))])), ("availableBalance", Json.obj([("type", Json.str("string")), ("description", Json.str("Available USDC balance in base units (6 decimals). Example: '10000000' = $10 USDC."))])), ("unclaimedPositions", Json.obj([("type", Json.str("array")), ("description", Json.str("List of your unclaimed positions (in open, closed, or resolved markets). Amounts in USDC base units."))])), ("items", Json.obj([("type", Json.str("object")), ("properties", Json.obj([("positionId", Json.obj([("type", Json.str("string"))])), ("marketId", Json.obj([("type", Json.str("string"))])), ("matchDetails", Json.obj([("type", Json.str("string"))])), ("stakedAmount", Json.obj([("type", Json.str("string")), ("description", Json.str("Amount in USDC base units"))])), ("predictedOutcome", Json.obj([("type", Json.str("string"))])), ("marketStatus", Json.obj([("type", Json.str("string"))]))]))])), ("stats", Json.obj([("type", Json.str("object")), ("description", Json.str("Your betting performance statistics")), ("properties", Json.obj([("totalPredictions", Json.obj([("type", Json.str("string")), ("description", Json.str("Total number of predictions made"))])), ("correctPredictions", Json.obj([("type", Json.str("string")), ("description", Json.str("Number of correct predictions"))])), ("incorrectPredictions", Json.obj([("type", Json.str("string")), ("description", Json.str("Number of incorrect predictions"))])), ("accuracyRate", Json.obj([("type", Json.str("string")), ("description", Json.str("Win rate as a percentage (e.g., '75%')"))])), ("totalWagered", Json.obj([("type", Json.str("string")), ("description", Json.str("Total amount wagered in USDC base units"))])), ("totalWon", Json.obj([("type", Json.str("string")), ("description", Json.str("Total amount won in USDC base units"))])), ("netProfit", Json.obj([("type", Json.str("string")), ("description", Json.str("Net profit/loss in USDC base units (can be negative)"))])), ("currentStreak", Json.obj([("type", Json.str("string")), ("description", Json.str("Current win/loss streak (positive for wins, negative for losses)"))])), ("longestWinStreak", Json.obj([("type", Json.str("string")), ("description", Json.str("Longest consecutive win streak"))]))]))]))])),
      ("required", Json.arr([Json.str("owner"), Json.str("availableBalance"), Json.str("unclaimedPositions"), Json.str("stats")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Check authentication
      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Get user balance
      let balance = ToolContext.getUserBalance(context, userPrincipal);

      // Get user positions
      let userPositions = ToolContext.getUserPositions(context, userPrincipal);

      // Get user stats
      let stats = ToolContext.getUserStats(context, userPrincipal);

      // Filter for unclaimed positions (in any market state)
      let unclaimedPositions = Array.filter<ToolContext.Position>(
        userPositions,
        func(pos : ToolContext.Position) : Bool {
          not pos.claimed;
        },
      );

      // Convert positions to JSON with market status
      let predictionsJson = Json.arr(
        Array.map<ToolContext.Position, Json.Json>(
          unclaimedPositions,
          func(pos : ToolContext.Position) : Json.Json {
            let (matchDetails, marketStatus) = switch (Map.get(context.markets, Map.thash, pos.marketId)) {
              case (?market) {
                let status = switch (market.status) {
                  case (#Open) { "Open" };
                  case (#Closed) { "Closed" };
                  case (#Resolved(outcome)) {
                    "Resolved:" # ToolContext.outcomeToText(outcome);
                  };
                  case (#Cancelled) { "Cancelled" };
                };
                (market.matchDetails, status);
              };
              case (null) { ("Unknown match", "Unknown") };
            };

            Json.obj([
              ("positionId", Json.str(pos.positionId)),
              ("marketId", Json.str(pos.marketId)),
              ("matchDetails", Json.str(matchDetails)),
              ("stakedAmount", Json.str(Nat.toText(pos.amount))),
              ("predictedOutcome", Json.str(ToolContext.outcomeToText(pos.outcome))),
              ("marketStatus", Json.str(marketStatus)),
            ]);
          },
        )
      );

      let output = Json.obj([
        ("owner", Json.str(Principal.toText(userPrincipal))),
        ("availableBalance", Json.str(Nat.toText(balance))),
        ("unclaimedPositions", predictionsJson),
        ("stats", Json.obj([("totalPredictions", Json.str(Nat.toText(stats.totalPredictions))), ("correctPredictions", Json.str(Nat.toText(stats.correctPredictions))), ("incorrectPredictions", Json.str(Nat.toText(stats.incorrectPredictions))), ("accuracyRate", Json.str(if (stats.totalPredictions > 0) { let accuracy = (stats.correctPredictions * 100) / stats.totalPredictions; Nat.toText(accuracy) # "%" } else { "0%" })), ("totalWagered", Json.str(Nat.toText(stats.totalWagered))), ("totalWon", Json.str(Nat.toText(stats.totalWon))), ("netProfit", Json.str(Int.toText(stats.netProfit))), ("currentStreak", Json.str(Int.toText(stats.currentStreak))), ("longestWinStreak", Json.str(Nat.toText(stats.longestWinStreak)))])),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
