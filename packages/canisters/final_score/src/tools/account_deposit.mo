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
    title = ?"Deposit USDC to Virtual Account";
    description = ?(
      "Deposit USDC tokens into your virtual account within the prediction market canister. " #
      "Currency: USDC with 6 decimals (1 USDC = 1,000,000 base units). " #
      "Example: To deposit $10 USDC, use amount '10000000'. To deposit $100 USDC, use '100000000'. " #
      "Note: The ICRC-2 transfer fee will be automatically deducted from the amount. " #
      "This is a two-step process: first approve the canister to spend your tokens, " #
      "then call this tool to pull the funds into your virtual account."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("Amount in USDC base units (6 decimals). Example: '10000000' = $10 USDC, '1000000' = $1 USDC. Transfer fee will be deducted automatically."))
        ]))
      ])),
      ("required", Json.arr([Json.str("amount")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("transferred_amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The total amount transferred from the user (including fee)."))
        ])),
        ("fee", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The transfer fee deducted."))
        ])),
        ("credited_amount", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The net amount credited to virtual account (transferred_amount - fee)."))
        ])),
        ("new_balance", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("The user's new total virtual account balance."))
        ]))
      ])),
      ("required", Json.arr([Json.str("transferred_amount"), Json.str("fee"), Json.str("credited_amount"), Json.str("new_balance")])),
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

      // USDC transfer fee is 10,000 base units (0.01 USDC)
      let transferFee : Nat = 10_000;

      // Validate amount is greater than fee
      if (amount <= transferFee) {
        return ToolContext.makeError(
          "Amount must be greater than transfer fee (10,000 base units = $0.01 USDC)", 
          cb
        );
      };

      // Calculate the amount to transfer (amount minus fee)
      let transferAmount = amount - transferFee;

      try {
        // Create token ledger actor
        let tokenLedger = actor (Principal.toText(context.tokenLedger)) : actor {
          icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
        };

        // Prepare transfer_from arguments (transfer the net amount after fee)
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
          amount = transferAmount;
          fee = null;
          memo = null;
          created_at_time = null;
        };

        // Execute the transfer
        let transferResult = await tokenLedger.icrc2_transfer_from(transferFromArgs);

        switch (transferResult) {
          case (#Ok(_blockIndex)) {
            // Transfer successful, credit the user's virtual account with the transfer amount
            ToolContext.creditBalance(context, userPrincipal, transferAmount);
            let newBalance = ToolContext.getUserBalance(context, userPrincipal);

            let output = Json.obj([
              ("transferred_amount", Json.str(Nat.toText(transferAmount))),
              ("fee", Json.str(Nat.toText(transferFee))),
              ("credited_amount", Json.str(Nat.toText(transferAmount))),
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