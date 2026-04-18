import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Nat64 "mo:base/Nat64";
import Array "mo:base/Array";
import Map "mo:map/Map";
import ICRC2 "mo:icrc2-types";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "account_get_info";
    title = ?"Get Account Information";
    description = ?(
      "Returns your account overview: wallet balance, spending allowance, " #
      "available balance (after order escrow), open positions, and trading stats. " #
      "Currency: USDC with 6 decimals (1,000,000 = $1 USDC)."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([])),
      ("required", Json.arr([])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      // Query wallet balance and allowance from ledger
      let ledger = actor (Principal.toText(context.tokenLedger)) : actor {
        icrc1_balance_of : (ICRC2.Account) -> async Nat;
        icrc2_allowance : ({ account : ICRC2.Account; spender : ICRC2.Account }) -> async { allowance : Nat; expires_at : ?Nat64 };
      };

      let walletBalance = await ledger.icrc1_balance_of({
        owner = userPrincipal;
        subaccount = null;
      });

      let allowanceResult = await ledger.icrc2_allowance({
        account = { owner = userPrincipal; subaccount = null };
        spender = { owner = context.canisterPrincipal; subaccount = null };
      });

      let lockedBalance = ToolContext.getLockedBalance(context, userPrincipal);
      let usable = Nat.min(allowanceResult.allowance, walletBalance);
      let availableBalance = if (usable > lockedBalance) { usable - lockedBalance } else { 0 };

      // Get positions
      let posIds = switch (Map.get(context.userPositionIds, Map.phash, userPrincipal)) {
        case (?ids) ids;
        case null [];
      };

      var positionsJson : [Json.Json] = [];
      for (posId in posIds.vals()) {
        switch (Map.get(context.positions, Map.thash, posId)) {
          case (?pos) {
            let marketStatus = switch (Map.get(context.markets, Map.thash, pos.marketId)) {
              case (?m) ToolContext.marketStatusToText(m.status);
              case null "Unknown";
            };
            let question = switch (Map.get(context.markets, Map.thash, pos.marketId)) {
              case (?m) m.question;
              case null "Unknown";
            };
            positionsJson := Array.append(positionsJson, [Json.obj([
              ("position_id", Json.str(pos.positionId)),
              ("market_id", Json.str(pos.marketId)),
              ("question", Json.str(question)),
              ("outcome", Json.str(ToolContext.outcomeToText(pos.outcome))),
              ("shares", Json.str(Nat.toText(pos.shares))),
              ("cost_basis", Json.str(Nat.toText(pos.costBasis))),
              ("avg_price_bps", Json.str(Nat.toText(pos.averagePrice))),
              ("market_status", Json.str(marketStatus)),
            ])]);
          };
          case null {};
        };
      };

      // Stats
      ToolContext.initUserStats(context, userPrincipal);
      let stats = switch (Map.get(context.userStats, Map.phash, userPrincipal)) {
        case (?s) s;
        case null {
          { userPrincipal; totalTrades = 0; marketsWon = 0; marketsLost = 0;
            totalVolume = 0; totalPayout = 0; netProfit = 0 };
        };
      };

      ToolContext.makeSuccess(Json.obj([
        ("owner", Json.str(Principal.toText(userPrincipal))),
        ("wallet_balance", Json.str(Nat.toText(walletBalance))),
        ("allowance", Json.str(Nat.toText(allowanceResult.allowance))),
        ("available_balance", Json.str(Nat.toText(availableBalance))),
        ("locked_in_orders", Json.str(Nat.toText(lockedBalance))),
        ("positions", Json.arr(positionsJson)),
        ("stats", Json.obj([
          ("total_trades", Json.str(Nat.toText(stats.totalTrades))),
          ("markets_won", Json.str(Nat.toText(stats.marketsWon))),
          ("markets_lost", Json.str(Nat.toText(stats.marketsLost))),
          ("total_volume", Json.str(Nat.toText(stats.totalVolume))),
          ("total_payout", Json.str(Nat.toText(stats.totalPayout))),
          ("net_profit", Json.str(Int.toText(stats.netProfit))),
        ])),
      ]), cb);
    };
  };
};
