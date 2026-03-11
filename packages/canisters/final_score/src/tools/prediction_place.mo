import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Time "mo:base/Time";
import Map "mo:map/Map";
import Error "mo:base/Error";
import ICRC2 "mo:icrc2-types";
import Debug "mo:base/Debug";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "prediction_place";
    title = ?"Place a Prediction (Bet)";
    description = ?(
      "Submit a prediction for a specific match outcome. " #
      "Funds are transferred directly from your wallet via ICRC-2 transfer_from into the market's pool. " #
      "Currency: USDC with 6 decimals (1 USDC = 1,000,000 base units). " #
      "Minimum bet: 0.10 USDC (100,000 base units). " #
      "Note: A 0.01 USDC (10,000) transfer fee will be deducted automatically. " #
      "Example: To bet $1, use amount '1000000'. To bet $10, use '10000000'. " #
      "You can predict HomeWin, AwayWin, or Draw. " #
      "IMPORTANT: Payouts are AUTOMATIC when the match ends - winnings go directly to your wallet. No claiming needed! " #
      "Make sure you have approved the canister to spend your USDC tokens first (ICRC-2 approve)."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("marketId", Json.obj([("type", Json.str("string")), ("description", Json.str("The ID of the market to bet on."))])), ("outcome", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("HomeWin"), Json.str("AwayWin"), Json.str("Draw")])), ("description", Json.str("The predicted outcome."))])), ("amount", Json.obj([("type", Json.str("string")), ("description", Json.str("Amount in USDC base units (6 decimals). Example: '10000000' = $10 USDC, '1000000' = $1 USDC."))]))])),
      ("required", Json.arr([Json.str("marketId"), Json.str("outcome"), Json.str("amount")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("positionId", Json.obj([("type", Json.str("string")), ("description", Json.str("A unique ID for this specific prediction."))])), ("status", Json.obj([("type", Json.str("string")), ("description", Json.str("Confirmation that the prediction was placed."))]))])),
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
        case (null) {
          return ToolContext.makeError("Missing 'marketId' argument", cb);
        };
      };

      let outcomeText = switch (Result.toOption(Json.getAsText(_args, "outcome"))) {
        case (?out) { out };
        case (null) {
          return ToolContext.makeError("Missing 'outcome' argument", cb);
        };
      };

      let outcome = switch (ToolContext.parseOutcome(outcomeText)) {
        case (?out) { out };
        case (null) {
          return ToolContext.makeError("Invalid outcome. Must be 'HomeWin', 'AwayWin', or 'Draw'", cb);
        };
      };

      let amountText = switch (Result.toOption(Json.getAsText(_args, "amount"))) {
        case (?amt) { amt };
        case (null) {
          return ToolContext.makeError("Missing 'amount' argument", cb);
        };
      };

      let amount = switch (Nat.fromText(amountText)) {
        case (?amt) { amt };
        case (null) {
          return ToolContext.makeError("Invalid amount format", cb);
        };
      };

      // Validate minimum bet amount
      if (amount < ToolContext.MINIMUM_BET) {
        return ToolContext.makeError(
          "Amount must be at least " # Nat.toText(ToolContext.MINIMUM_BET) # " (0.10 USDC) to cover transaction fees",
          cb
        );
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
        case (#Cancelled) {
          return ToolContext.makeError("Market has been cancelled", cb);
        };
      };

      // Check if betting deadline has passed
      let now = Time.now();
      if (now >= market.bettingDeadline) {
        return ToolContext.makeError("Betting deadline has passed", cb);
      };

      // Transfer funds from user to market subaccount using ICRC-2 transfer_from
      let tokenLedger = actor (Principal.toText(context.tokenLedger)) : actor {
        icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
      };

      // Calculate the net amount after fee
      let netAmount = Nat.sub(amount, ToolContext.TRANSFER_FEE);

      // Prepare transfer_from arguments
      let marketAccount = ToolContext.getMarketAccount(context.canisterPrincipal, marketId);
      let transferFromArgs : ICRC2.TransferFromArgs = {
        from = { owner = userPrincipal; subaccount = null };
        to = marketAccount;
        amount = netAmount;
        fee = ?ToolContext.TRANSFER_FEE;
        memo = null;
        created_at_time = null;
        spender_subaccount = null; // Canister doesn't use a subaccount for this operation
      };

      // Execute the transfer
      let transferResult = try {
        await tokenLedger.icrc2_transfer_from(transferFromArgs);
      } catch (e) {
        Debug.print("Transfer error: " # Error.message(e));
        return ToolContext.makeError("Failed to transfer funds: " # Error.message(e), cb);
      };

      // Check transfer result
      switch (transferResult) {
        case (#Err(err)) {
          let errorMsg = switch (err) {
            case (#InsufficientFunds { balance }) {
              "Insufficient funds. Your balance: " # debug_show (balance);
            };
            case (#InsufficientAllowance { allowance }) {
              "Insufficient allowance. Current allowance: " # debug_show (allowance) # ". Please approve the canister to spend your tokens first.";
            };
            case (#BadFee { expected_fee }) {
              "Bad fee. Expected: " # debug_show (expected_fee);
            };
            case (#Duplicate { duplicate_of }) {
              "Duplicate transaction: " # debug_show (duplicate_of);
            };
            case (#BadBurn { min_burn_amount }) {
              "Bad burn amount: " # debug_show (min_burn_amount);
            };
            case (#CreatedInFuture { ledger_time }) {
              "Created in future: " # debug_show (ledger_time);
            };
            case (#TooOld) {
              "Transaction too old";
            };
            case (#TemporarilyUnavailable) {
              "Ledger temporarily unavailable";
            };
            case (#GenericError { error_code; message }) {
              "Error " # debug_show (error_code) # ": " # message;
            };
          };
          return ToolContext.makeError("Transfer failed: " # errorMsg, cb);
        };
        case (#Ok(blockIndex)) {
          Debug.print("Transfer successful. Block index: " # debug_show (blockIndex));
        };
      };

      // Update the market pools (net amount only, since fee was deducted)
      let updatedMarket : ToolContext.Market = switch (outcome) {
        case (#HomeWin) {
          {
            market with
            homeWinPool = market.homeWinPool + netAmount;
            totalPool = market.totalPool + netAmount;
          };
        };
        case (#AwayWin) {
          {
            market with
            awayWinPool = market.awayWinPool + netAmount;
            totalPool = market.totalPool + netAmount;
          };
        };
        case (#Draw) {
          {
            market with
            drawPool = market.drawPool + netAmount;
            totalPool = market.totalPool + netAmount;
          };
        };
      };

      Map.set(context.markets, Map.thash, marketId, updatedMarket);

      // Create position record (record net amount)
      let positionId = ToolContext.getNextPositionId(context);
      let position : ToolContext.Position = {
        positionId = positionId;
        marketId = marketId;
        userPrincipal = userPrincipal;
        outcome = outcome;
        amount = netAmount; // Store net amount (after fee)
        timestamp = now;
        claimed = false;
      };

      // Add position to user's positions
      ToolContext.addUserPosition(context, userPrincipal, position);

      // Return success
      let output = Json.obj([
        ("positionId", Json.str(positionId)),
        ("status", Json.str("Prediction placed successfully")),
        ("transferred_amount", Json.str(Nat.toText(netAmount))),
        ("fee_paid", Json.str(Nat.toText(ToolContext.TRANSFER_FEE))),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
