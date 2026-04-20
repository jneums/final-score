import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Principal "mo:base/Principal";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "positions_list";
    title = ?"My Positions";
    description = ?(
      "List your current positions across all markets. " #
      "Shows shares held, cost basis, current value, and unrealized P&L."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("market_id", Json.obj([("type", Json.str("string")), ("description", Json.str("Optional: filter by market ID"))])),
      ])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      let marketFilter = Result.toOption(Json.getAsText(_args, "market_id"));

      // Get user's position IDs
      let posIds = switch (Map.get(context.userPositionIds, Map.phash, userPrincipal)) {
        case (?ids) ids;
        case null [];
      };

      var positionsJson : [Json.Json] = [];
      var totalCostBasis : Nat = 0;
      var totalCurrentValue : Nat = 0;

      for (posId in posIds.vals()) {
        switch (Map.get(context.positions, Map.thash, posId)) {
          case (?pos) {
            // Apply market filter
            let shouldInclude = switch (marketFilter) {
              case (?mid) pos.marketId == mid;
              case null true;
            };

            if (shouldInclude and pos.shares > 0) {
              // Look up market for current prices
              let (question, currentPrice, status) = switch (Map.get(context.markets, Map.thash, pos.marketId)) {
                case (?m) {
                  let price = switch (pos.outcome) {
                    case (#Yes) m.lastYesPrice;
                    case (#No) m.lastNoPrice;
                  };
                  (m.question, price, ToolContext.marketStatusToText(m.status));
                };
                case null ("Unknown", 5000, "Unknown");
              };

              // Current value = shares × current price
              let currentValue = (pos.shares * currentPrice * ToolContext.SHARE_VALUE(context)) / ToolContext.BPS_DENOM;
              let costBasis = pos.costBasis;
              let pnlInt : Int = currentValue - costBasis;

              totalCostBasis += costBasis;
              totalCurrentValue += currentValue;

              positionsJson := Array.append(positionsJson, [Json.obj([
                ("position_id", Json.str(pos.positionId)),
                ("market_id", Json.str(pos.marketId)),
                ("question", Json.str(question)),
                ("market_status", Json.str(status)),
                ("outcome", Json.str(ToolContext.outcomeToText(pos.outcome))),
                ("shares", #number(#int(pos.shares))),
                ("avg_price_bps", #number(#int(pos.averagePrice))),
                ("cost_basis", Json.str(Nat.toText(costBasis))),
                ("current_value", Json.str(Nat.toText(currentValue))),
                ("unrealized_pnl", #number(#int(pnlInt))),
              ])]);
            };
          };
          case null {};
        };
      };

      let totalPnl : Int = totalCurrentValue - totalCostBasis;

      ToolContext.makeSuccess(Json.obj([
        ("positions", Json.arr(positionsJson)),
        ("count", #number(#int(positionsJson.size()))),
        ("total_cost_basis", Json.str(Nat.toText(totalCostBasis))),
        ("total_current_value", Json.str(Nat.toText(totalCurrentValue))),
        ("total_unrealized_pnl", #number(#int(totalPnl))),
      ]), cb);
    };
  };
};
