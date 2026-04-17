import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Map "mo:map/Map";
import Iter "mo:base/Iter";
import Order "mo:base/Order";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "account_get_history";
    title = ?"Get Trade History";
    description = ?(
      "Retrieve your settled position history from resolved markets. " #
      "Shows which outcome you held, shares, cost basis, and payout. " #
      "Sorted by resolution time (most recent first). Returns 10 entries per page."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("page", Json.obj([("type", Json.str("number")), ("description", Json.str("Page number (default: 1). 10 entries per page."))]))
      ])),
    ]);
    outputSchema = null;
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);
      let userPrincipal = auth.principal;

      let page = switch (Result.toOption(Json.getAsNat(_args, "page"))) {
        case (?p) { if (p < 1) { 1 } else { p } };
        case null { 1 };
      };

      let pageSize : Nat = 10;
      let offset = (page - 1) * pageSize;

      let history = switch (Map.get(context.positionHistory, Map.phash, userPrincipal)) {
        case (?h) h;
        case null [];
      };

      let sorted = Array.sort<ToolContext.HistoricalPosition>(
        history,
        func(a : ToolContext.HistoricalPosition, b : ToolContext.HistoricalPosition) : Order.Order {
          if (a.resolvedAt > b.resolvedAt) #less
          else if (a.resolvedAt < b.resolvedAt) #greater
          else #equal;
        },
      );

      let total = sorted.size();
      let startIdx = if (offset > total) total else offset;
      let endIdx = if (startIdx + pageSize > total) total else startIdx + pageSize;

      let paged = if (startIdx < endIdx) {
        Iter.toArray(Array.slice<ToolContext.HistoricalPosition>(sorted, startIdx, endIdx));
      } else { [] };

      let totalPages = if (total == 0) 0 else (total + pageSize - 1) / pageSize;

      let historyJson = Array.map<ToolContext.HistoricalPosition, Json.Json>(
        paged,
        func(e : ToolContext.HistoricalPosition) : Json.Json {
          Json.obj([
            ("market_id", Json.str(e.marketId)),
            ("event", Json.str(e.eventTitle)),
            ("question", Json.str(e.question)),
            ("outcome", Json.str(ToolContext.outcomeToText(e.outcome))),
            ("shares", Json.str(Nat.toText(e.shares))),
            ("cost_basis", Json.str(Nat.toText(e.costBasis))),
            ("payout", Json.str(Nat.toText(e.payout))),
            ("result", Json.str(if (e.payout > e.costBasis) "profit" else if (e.payout > 0) "loss" else "total_loss")),
            ("resolved_at", Json.str(Nat.toText(e.resolvedAt))),
          ]);
        },
      );

      ToolContext.makeSuccess(Json.obj([
        ("history", Json.arr(historyJson)),
        ("page", Json.str(Nat.toText(page))),
        ("page_size", Json.str(Nat.toText(pageSize))),
        ("total_entries", Json.str(Nat.toText(total))),
        ("total_pages", Json.str(Nat.toText(totalPages))),
      ]), cb);
    };
  };
};
