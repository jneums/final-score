import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Nat "mo:base/Nat";
import Array "mo:base/Array";
import Map "mo:map/Map";
import Text "mo:base/Text";
import Order "mo:base/Order";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Float "mo:base/Float";
import DateTime "mo:datetime/DateTime";

import ToolContext "ToolContext";

module {

  public func config() : McpTypes.Tool = {
    name = "markets_list";
    title = ?"List Prediction Markets";
    description = ?(
      "Returns a paginated list of prediction markets. " #
      "Filter by sport, status, or search query. " #
      "Each market is a binary Yes/No question (e.g., 'Will Arsenal win?'). " #
      "Prices shown in basis points (5000 = $0.50 = 50% implied probability)."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([
        ("sport", Json.obj([("type", Json.str("string")), ("description", Json.str("Filter by sport slug (e.g., 'epl', 'nba', 'nfl', 'mlb')"))])),
        ("status", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("Open"), Json.str("Closed"), Json.str("Resolved")])), ("description", Json.str("Filter by status (default: 'Open')"))])),
        ("search", Json.obj([("type", Json.str("string")), ("description", Json.str("Search in event title or question (case-insensitive)"))])),
        ("limit", Json.obj([("type", Json.str("number")), ("description", Json.str("Max results (default: 20, max: 100)"))])),
        ("offset", Json.obj([("type", Json.str("number")), ("description", Json.str("Skip N results for pagination (default: 0)"))])),
        ("sort_by", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("end_date"), Json.str("volume"), Json.str("price")])), ("description", Json.str("Sort by end_date (default), volume, or yes_price"))])),
      ])),
      ("required", Json.arr([])),
    ]);
    outputSchema = null;
  };

  func formatTimestamp(nanos : Int) : Text {
    let dt = DateTime.DateTime(nanos);
    dt.toText();
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Parse filters
      let sportFilter : ?Text = switch (Result.toOption(Json.getAsText(_args, "sport"))) {
        case (?s) if (Text.size(s) > 0) ?Text.toLowercase(s) else null;
        case null null;
      };

      let statusFilter : Text = switch (Result.toOption(Json.getAsText(_args, "status"))) {
        case (?s) s;
        case null "Open";
      };

      let searchFilter : ?Text = switch (Result.toOption(Json.getAsText(_args, "search"))) {
        case (?s) if (Text.size(s) > 0) ?Text.toLowercase(s) else null;
        case null null;
      };

      let limit : Nat = switch (Result.toOption(Json.getAsNat(_args, "limit"))) {
        case (?n) { if (n > 100) 100 else if (n < 1) 20 else n };
        case null 20;
      };

      let offset : Nat = switch (Result.toOption(Json.getAsNat(_args, "offset"))) {
        case (?n) n;
        case null 0;
      };

      let sortBy : Text = switch (Result.toOption(Json.getAsText(_args, "sort_by"))) {
        case (?s) s;
        case null "end_date";
      };

      // Filter markets
      var filtered : [(Text, ToolContext.Market)] = [];
      for ((id, market) in Map.entries(context.markets)) {
        // Status filter
        let statusText = switch (market.status) {
          case (#Open) "Open";
          case (#Suspended) "Suspended";
          case (#Closed) "Closed";
          case (#Resolved(_)) "Resolved";
          case (#Cancelled) "Cancelled";
        };
        if (statusText != statusFilter) {
          // skip
        } else {
          // Sport filter
          let sportMatch = switch (sportFilter) {
            case (?s) Text.toLowercase(market.sport) == s;
            case null true;
          };

          // Search filter
          let searchMatch = switch (searchFilter) {
            case (?q) {
              Text.contains(Text.toLowercase(market.question), #text q) or
              Text.contains(Text.toLowercase(market.eventTitle), #text q);
            };
            case null true;
          };

          if (sportMatch and searchMatch) {
            filtered := Array.append(filtered, [(id, market)]);
          };
        };
      };

      let totalCount = filtered.size();

      // Sort
      filtered := Array.sort(
        filtered,
        func(a : (Text, ToolContext.Market), b : (Text, ToolContext.Market)) : Order.Order {
          switch (sortBy) {
            case "volume" Nat.compare(b.1.totalVolume, a.1.totalVolume);
            case "price" Nat.compare(b.1.lastYesPrice, a.1.lastYesPrice);
            case _ {
              // end_date ascending for Open, descending for others
              if (statusFilter == "Open") Int.compare(a.1.endDate, b.1.endDate)
              else Int.compare(b.1.endDate, a.1.endDate);
            };
          };
        },
      );

      // Paginate
      let endIndex = Nat.min(offset + limit, totalCount);
      let paged = if (offset >= totalCount) []
        else Iter.toArray(Array.slice(filtered, offset, endIndex));

      // Convert to JSON
      let marketsJson = Array.map<(Text, ToolContext.Market), Json.Json>(
        paged,
        func((_, m) : (Text, ToolContext.Market)) : Json.Json {
          Json.obj([
            ("market_id", Json.str(m.marketId)),
            ("question", Json.str(m.question)),
            ("event_title", Json.str(m.eventTitle)),
            ("sport", Json.str(m.sport)),
            ("status", Json.str(ToolContext.marketStatusToText(m.status))),
            ("yes_price", Json.str(Nat.toText(m.lastYesPrice))),
            ("no_price", Json.str(Nat.toText(m.lastNoPrice))),
            ("poly_yes_price", Json.str(Nat.toText(m.polymarketYesPrice))),
            ("total_volume", Json.str(Nat.toText(m.totalVolume))),
            ("end_date", Json.str(Int.toText(m.endDate))),
            ("end_date_formatted", Json.str(formatTimestamp(m.endDate))),
            ("betting_deadline", Json.str(Int.toText(m.bettingDeadline))),
            ("polymarket_slug", Json.str(m.polymarketSlug)),
          ]);
        },
      );

      ToolContext.makeSuccess(Json.obj([
        ("markets", Json.arr(marketsJson)),
        ("total_count", Json.float(Float.fromInt(totalCount))),
        ("returned_count", Json.float(Float.fromInt(paged.size()))),
        ("offset", Json.float(Float.fromInt(offset))),
      ]), cb);
    };
  };
};
