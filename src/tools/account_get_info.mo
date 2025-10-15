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
      "Returns a comprehensive overview of your account including your available balance " #
      "and a list of all active (unresolved) predictions."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([])),
      ("required", Json.arr([])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("available_balance", Json.obj([
          ("type", Json.str("string")),
          ("description", Json.str("Your available balance in the virtual account"))
        ])),
        ("active_predictions", Json.obj([
          ("type", Json.str("array")),
          ("description", Json.str("List of your active predictions")),
          ("items", Json.obj([
            ("type", Json.str("object")),
            ("properties", Json.obj([
              ("positionId", Json.obj([("type", Json.str("string"))])),
              ("marketId", Json.obj([("type", Json.str("string"))])),
              ("matchDetails", Json.obj([("type", Json.str("string"))])),
              ("staked_amount", Json.obj([("type", Json.str("string"))])),
              ("predicted_outcome", Json.obj([("type", Json.str("string"))])),
            ]))
          ]))
        ])),
      ])),
      ("required", Json.arr([Json.str("available_balance"), Json.str("active_predictions")])),
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

      // Filter for active (unclaimed) positions in unresolved markets
      let activePositions = Array.filter<ToolContext.Position>(
        userPositions,
        func(pos : ToolContext.Position) : Bool {
          if (pos.claimed) {
            return false;
          };
          // Check if market is still active (not resolved)
          switch (Map.get(context.markets, Map.thash, pos.marketId)) {
            case (?market) {
              switch (market.status) {
                case (#Open) { true };
                case (#Closed) { true };
                case (#Resolved(_)) { not pos.claimed };
              };
            };
            case (null) { false };
          };
        }
      );

      // Convert positions to JSON
      let predictionsJson = Json.arr(
        Array.map<ToolContext.Position, Json.Json>(
          activePositions,
          func(pos : ToolContext.Position) : Json.Json {
            let matchDetails = switch (Map.get(context.markets, Map.thash, pos.marketId)) {
              case (?market) { market.matchDetails };
              case (null) { "Unknown match" };
            };

            Json.obj([
              ("positionId", Json.str(pos.positionId)),
              ("marketId", Json.str(pos.marketId)),
              ("matchDetails", Json.str(matchDetails)),
              ("staked_amount", Json.str(Nat.toText(pos.amount))),
              ("predicted_outcome", Json.str(ToolContext.outcomeToText(pos.outcome))),
            ]);
          }
        )
      );

      let output = Json.obj([
        ("available_balance", Json.str(Nat.toText(balance))),
        ("active_predictions", predictionsJson),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
}