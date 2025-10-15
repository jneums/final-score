import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Error "mo:base/Error";
import ICRC2 "mo:icrc2-types";

import ToolContext "ToolContext";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "account_deposit";
    title = ?"Deposit Tokens to Virtual Account";
    description = ?(
      "Deposit tokens into your virtual account within the prediction market canister. " #
      "This is a two-step process: first approve the canister to spend your tokens, " #
      "then call this tool to pull the funds into your virtual account."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The amount of tokens to deposit, in base units (string nat)."))
        ]))
      ])),
      ("required", Json.arr([Json.str("amount")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("new_balance", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The user's new total virtual account balance."))
        ]))
      ])),
      ("required", Json.arr([Json.str("new_balance")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {
      
      // Check authentication
      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Parse amount argument
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

      if (amount == 0) {
        return ToolContext.makeError("Amount must be greater than 0", cb);
      };

      try {
        // Create token ledger actor
        let tokenLedger = actor (Principal.toText(context.tokenLedger)) : actor {
          icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
        };

        // Prepare transfer_from arguments
        let transferFromArgs : ICRC2.TransferFromArgs = {
          spender_subaccount = null;
          from = {
            owner = userPrincipal;
            subaccount = null;
          };
          to = {
            owner = context.canisterPrincipal;
            subaccount = null;
          };
          amount = amount;
          fee = null;
          memo = null;
          created_at_time = null;
        };

        // Execute the transfer
        let transferResult = await tokenLedger.icrc2_transfer_from(transferFromArgs);

        switch (transferResult) {
          case (#Ok(_blockIndex)) {
            // Transfer successful, credit the user's virtual account
            ToolContext.creditBalance(context, userPrincipal, amount);
            let newBalance = ToolContext.getUserBalance(context, userPrincipal);

            let output = Json.obj([
              ("new_balance", Json.str(Nat.toText(newBalance))),
            ]);
            ToolContext.makeSuccess(output, cb);
          };
          case (#Err(error)) {
            ToolContext.makeError("Transfer failed: " # debug_show(error), cb);
          };
        };

      } catch (e) {
        ToolContext.makeError("Failed to deposit tokens: " # Error.message(e), cb);
      };
    };
  };
};