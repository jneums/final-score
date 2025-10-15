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
    name = "account_withdraw";
    title = ?"Withdraw from Virtual Account";
    description = ?(
      "Withdraw your available balance from the virtual account back to your main wallet. " #
      "Only non-escrowed funds can be withdrawn."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The amount to withdraw in base units. Use 'all' to withdraw entire balance."))
        ])),
      ])),
      ("required", Json.arr([Json.str("amount")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("block_index", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The block index of the withdrawal transaction."))
        ])),
        ("amount_withdrawn", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The amount withdrawn."))
        ])),
        ("new_balance", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("Your new virtual account balance."))
        ])),
      ])),
      ("required", Json.arr([Json.str("block_index"), Json.str("amount_withdrawn"), Json.str("new_balance")])),
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
        case (null) { return ToolContext.makeError("Missing 'amount' argument", cb); };
      };

      let currentBalance = ToolContext.getUserBalance(context, userPrincipal);

      let amount = if (amountText == "all") {
        currentBalance;
      } else {
        switch (Nat.fromText(amountText)) {
          case (?amt) { amt };
          case (null) { return ToolContext.makeError("Invalid amount format", cb); };
        };
      };

      if (amount == 0) {
        return ToolContext.makeError("Amount must be greater than 0", cb);
      };

      if (amount > currentBalance) {
        return ToolContext.makeError(
          "Insufficient balance. Available: " # Nat.toText(currentBalance), 
          cb
        );
      };

      try {
        // Create token ledger actor
        let tokenLedger = actor (Principal.toText(context.tokenLedger)) : actor {
          icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
        };

        // Prepare transfer arguments
        let transferArgs : ICRC2.TransferArgs = {
          from_subaccount = null;
          to = {
            owner = userPrincipal;
            subaccount = null;
          };
          amount = amount;
          fee = null;
          memo = null;
          created_at_time = null;
        };

        // Execute the transfer
        let transferResult = await tokenLedger.icrc1_transfer(transferArgs);

        switch (transferResult) {
          case (#Ok(blockIndex)) {
            // Transfer successful, debit the user's virtual account
            ignore ToolContext.debitBalance(context, userPrincipal, amount);
            let newBalance = ToolContext.getUserBalance(context, userPrincipal);

            let output = Json.obj([
              ("block_index", Json.str(Nat.toText(blockIndex))),
              ("amount_withdrawn", Json.str(Nat.toText(amount))),
              ("new_balance", Json.str(Nat.toText(newBalance))),
            ]);
            ToolContext.makeSuccess(output, cb);
          };
          case (#Err(error)) {
            ToolContext.makeError("Withdrawal failed: " # debug_show(error), cb);
          };
        };

      } catch (e) {
        ToolContext.makeError("Failed to withdraw tokens: " # Error.message(e), cb);
      };
    };
  };
}