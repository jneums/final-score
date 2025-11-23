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
      "Returns a comprehensive overview of your account including your available USDC balance " #
      "and a list of all unclaimed positions (including resolved markets awaiting claim). " #
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
      ("properties", Json.obj([("available_balance", Json.obj([("type", Json.str("string")), ("description", Json.str("Available USDC balance in base units (6 decimals). Example: '10000000' = $10 USDC."))])), ("unclaimed_positions", Json.obj([("type", Json.str("array")), ("description", Json.str("List of your unclaimed positions (in open, closed, or resolved markets). Amounts in USDC base units."))])), ("items", Json.obj([("type", Json.str("object")), ("properties", Json.obj([("positionId", Json.obj([("type", Json.str("string"))])), ("marketId", Json.obj([("type", Json.str("string"))])), ("matchDetails", Json.obj([("type", Json.str("string"))])), ("staked_amount", Json.obj([("type", Json.str("string")), ("description", Json.str("Amount in USDC base units"))])), ("predicted_outcome", Json.obj([("type", Json.str("string"))])), ("market_status", Json.obj([("type", Json.str("string"))]))]))]))])),
      ("required", Json.arr([Json.str("available_balance"), Json.str("unclaimed_positions")])),
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
                };
                (market.matchDetails, status);
              };
              case (null) { ("Unknown match", "Unknown") };
            };

            Json.obj([
              ("positionId", Json.str(pos.positionId)),
              ("marketId", Json.str(pos.marketId)),
              ("matchDetails", Json.str(matchDetails)),
              ("staked_amount", Json.str(Nat.toText(pos.amount))),
              ("predicted_outcome", Json.str(ToolContext.outcomeToText(pos.outcome))),
              ("market_status", Json.str(marketStatus)),
            ]);
          },
        )
      );

      let output = Json.obj([
        ("available_balance", Json.str(Nat.toText(balance))),
        ("unclaimed_positions", predictionsJson),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
