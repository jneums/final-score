import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Time "mo:base/Time";
import Map "mo:map/Map";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "prediction_place";
    title = ?"Place a Prediction";
    description = ?(
      "Submit a prediction for a specific match outcome. " #
      "This commits funds from your virtual account to the corresponding outcome pool. " #
      "You can predict HomeWin, AwayWin, or Draw."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("marketId", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The ID of the market to bet on."))
        ])),
        ("outcome", Json.obj([
          ("type", Json.str("string")),
          ("enum", Json.arr([Json.str("HomeWin"), Json.str("AwayWin"), Json.str("Draw")])),
          ("description", Json.str("The predicted outcome."))
        ])),
        ("amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The amount to bet from the virtual account, in base units."))
        ])),
      ])),
      ("required", Json.arr([Json.str("marketId"), Json.str("outcome"), Json.str("amount")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("positionId", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("A unique ID for this specific prediction."))
        ])),
        ("status", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("Confirmation that the prediction was placed."))
        ])),
      ])),
      ("required", Json.arr([Json.str("positionId"), Json.str("status")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {
      
      // Check authentication
      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Parse arguments
      let marketId = switch (Result.toOption(Json.getAsText(_args, "marketId"))) {
        case (?id) { id };
        case (null) { return ToolContext.makeError("Missing 'marketId' argument", cb); };
      };

      let outcomeText = switch (Result.toOption(Json.getAsText(_args, "outcome"))) {
        case (?out) { out };
        case (null) { return ToolContext.makeError("Missing 'outcome' argument", cb); };
      };

      let outcome = switch (ToolContext.parseOutcome(outcomeText)) {
        case (?out) { out };
        case (null) { 
          return ToolContext.makeError("Invalid outcome. Must be 'HomeWin', 'AwayWin', or 'Draw'", cb); 
        };
      };

      let amountText = switch (Result.toOption(Json.getAsText(_args, "amount"))) {
        case (?amt) { amt };
        case (null) { return ToolContext.makeError("Missing 'amount' argument", cb); };
      };

      let amount = switch (Nat.fromText(amountText)) {
        case (?amt) { amt };
        case (null) { return ToolContext.makeError("Invalid amount format", cb); };
      };

      if (amount == 0) {
        return ToolContext.makeError("Amount must be greater than 0", cb);
      };

      // Get the market
      let ?market = Map.get(context.markets, Map.thash, marketId) else {
        return ToolContext.makeError("Market not found", cb);
      };

      // Check if market is open
      switch (market.status) {
        case (#Open) {};
        case (#Closed) {
          return ToolContext.makeError("Market is closed for betting", cb);
        };
        case (#Resolved(_)) {
          return ToolContext.makeError("Market has already been resolved", cb);
        };
      };

      // Check if betting deadline has passed
      let now = Time.now();
      if (now >= market.bettingDeadline) {
        return ToolContext.makeError("Betting deadline has passed", cb);
      };

      // Check user balance
      if (not ToolContext.checkBalance(context, userPrincipal, amount)) {
        return ToolContext.makeError("Insufficient balance in virtual account", cb);
      };

      // Debit user balance
      if (not ToolContext.debitBalance(context, userPrincipal, amount)) {
        return ToolContext.makeError("Failed to debit balance", cb);
      };

      // Update the market pools
      let updatedMarket : ToolContext.Market = switch (outcome) {
        case (#HomeWin) {
          {
            market with
            homeWinPool = market.homeWinPool + amount;
            totalPool = market.totalPool + amount;
          };
        };
        case (#AwayWin) {
          {
            market with
            awayWinPool = market.awayWinPool + amount;
            totalPool = market.totalPool + amount;
          };
        };
        case (#Draw) {
          {
            market with
            drawPool = market.drawPool + amount;
            totalPool = market.totalPool + amount;
          };
        };
      };

      Map.set(context.markets, Map.thash, marketId, updatedMarket);

      // Create position record
      let positionId = ToolContext.getNextPositionId(context);
      let position : ToolContext.Position = {
        positionId = positionId;
        marketId = marketId;
        userPrincipal = userPrincipal;
        outcome = outcome;
        amount = amount;
        timestamp = now;
        claimed = false;
      };

      // Add position to user's positions
      ToolContext.addUserPosition(context, userPrincipal, position);

      // Return success
      let output = Json.obj([
        ("positionId", Json.str(positionId)),
        ("status", Json.str("Prediction placed successfully")),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
}