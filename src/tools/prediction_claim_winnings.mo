import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Map "mo:map/Map";
import Float "mo:base/Float";
import Int "mo:base/Int";
import Time "mo:base/Time";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "prediction_claim_winnings";
    title = ?"Claim Winnings from a Market";
    description = ?(
      "Settle all your positions in a completed market. Winners receive their share of the total pool, " #
      "losers receive nothing. All positions (both winning and losing) are removed from your account. " #
      "This operation is idempotent - you can call it multiple times safely."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("marketId", Json.obj([("type", Json.str("string")), ("description", Json.str("The ID of the market to claim winnings from."))]))])),
      ("required", Json.arr([Json.str("marketId")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("amount_claimed", Json.obj([("type", Json.str("string")), ("description", Json.str("Total amount credited to the virtual account."))])), ("new_balance", Json.obj([("type", Json.str("string")), ("description", Json.str("The user's new total virtual account balance."))]))])),
      ("required", Json.arr([Json.str("amount_claimed"), Json.str("new_balance")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Check authentication
      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Parse marketId argument
      let marketId = switch (Result.toOption(Json.getAsText(_args, "marketId"))) {
        case (?id) { id };
        case (null) {
          return ToolContext.makeError("Missing 'marketId' argument", cb);
        };
      };

      // Get the market
      let ?market = Map.get(context.markets, Map.thash, marketId) else {
        return ToolContext.makeError("Market not found", cb);
      };

      // Check if market is resolved
      let winningOutcome = switch (market.status) {
        case (#Resolved(outcome)) { outcome };
        case (#Open) {
          return ToolContext.makeError("Market is still open - match has not finished yet", cb);
        };
        case (#Closed) {
          return ToolContext.makeError("Market is closed but not yet resolved - waiting for final outcome", cb);
        };
      };

      // Get user's positions for this market
      let userPositions = ToolContext.getUserPositions(context, userPrincipal);
      let marketPositions = Array.filter<ToolContext.Position>(
        userPositions,
        func(pos : ToolContext.Position) : Bool {
          pos.marketId == marketId and not pos.claimed;
        },
      );

      if (marketPositions.size() == 0) {
        return ToolContext.makeError("No unclaimed positions found for this market", cb);
      };

      // Calculate winnings using parimutuel formula
      var totalClaimed : Nat = 0;

      // Also track individual payouts for history
      var positionPayouts : [(ToolContext.Position, Nat)] = [];

      let winningPool = switch (winningOutcome) {
        case (#HomeWin) { market.homeWinPool };
        case (#AwayWin) { market.awayWinPool };
        case (#Draw) { market.drawPool };
      };

      // If nobody bet on the winning outcome, return stakes
      if (winningPool == 0) {
        for (position in marketPositions.vals()) {
          totalClaimed += position.amount;
          positionPayouts := Array.append(positionPayouts, [(position, position.amount)]);
        };
      } else {
        // Calculate payouts proportionally
        for (position in marketPositions.vals()) {
          if (position.outcome == winningOutcome) {
            // Winner: gets share of total pool proportional to their stake
            // Payout = (position.amount / winningPool) * totalPool
            let payoutFloat = (Float.fromInt(position.amount) / Float.fromInt(winningPool)) * Float.fromInt(market.totalPool);
            let payout = Int.abs(Float.toInt(payoutFloat));
            totalClaimed += payout;
            positionPayouts := Array.append(positionPayouts, [(position, payout)]);
          } else {
            // Losers get nothing
            positionPayouts := Array.append(positionPayouts, [(position, 0)]);
          };
        };
      };

      // Save positions to history
      let currentTime = Int.abs(Time.now() / 1_000_000_000); // Convert to seconds
      for ((position, payout) in positionPayouts.vals()) {
        let historyEntry : ToolContext.HistoricalPosition = {
          marketId = marketId;
          homeTeam = market.homeTeam;
          awayTeam = market.awayTeam;
          betOutcome = position.outcome;
          betAmount = position.amount;
          actualOutcome = winningOutcome;
          payout = payout;
          resolvedAt = Int.abs(currentTime);
        };
        ToolContext.addHistoricalPosition(context, userPrincipal, historyEntry);
      };

      // Credit the user's account
      if (totalClaimed > 0) {
        ToolContext.creditBalance(context, userPrincipal, totalClaimed);
      };

      // Remove all positions for this market (both winners and losers)
      // Winners have already been paid out, losers get nothing
      let updatedPositions = Array.filter<ToolContext.Position>(
        userPositions,
        func(pos : ToolContext.Position) : Bool {
          pos.marketId != marketId or pos.claimed;
        },
      );
      ToolContext.updateUserPositions(context, userPrincipal, updatedPositions);

      // Get new balance
      let newBalance = ToolContext.getUserBalance(context, userPrincipal);

      // Return result
      let output = Json.obj([
        ("amount_claimed", Json.str(Nat.toText(totalClaimed))),
        ("new_balance", Json.str(Nat.toText(newBalance))),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
