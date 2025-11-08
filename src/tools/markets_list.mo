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
import DateTime "mo:datetime/DateTime";
import Float "mo:base/Float";

import ToolContext "ToolContext";
import FootballOracle "FootballOracle";
import Principal "mo:base/Principal";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "markets_list";
    title = ?"List Prediction Markets";
    description = ?(
      "Returns a paginated, filtered, and sorted list of prediction markets. " #
      "Filter by status (Open, Closed, Resolved), team name, and more. " #
      "Open markets accept bets. Closed and Resolved markets are informational only."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("status", Json.obj([("type", Json.str("array")), ("items", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("Open"), Json.str("Closed"), Json.str("Resolved")]))])), ("description", Json.str("Filter by market status (default: [\"Open\"]). Can specify multiple statuses."))])), ("limit", Json.obj([("type", Json.str("number")), ("description", Json.str("Maximum number of markets to return (default: 20, max: 100)"))])), ("offset", Json.obj([("type", Json.str("number")), ("description", Json.str("Number of markets to skip for pagination (default: 0)"))])), ("team_filter", Json.obj([("type", Json.str("string")), ("description", Json.str("Filter markets by team name (case-insensitive, matches home or away team)"))])), ("upcoming_only", Json.obj([("type", Json.str("boolean")), ("description", Json.str("If true, only show markets with kickoff time in the future (default: false)"))])), ("sort_by", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("kickoff_time"), Json.str("total_pool"), Json.str("market_id")])), ("description", Json.str("Sort markets by kickoff time (ascending for Open, descending for Closed/Resolved), total pool size, or market ID (default: kickoff_time)"))]))])),
      ("required", Json.arr([])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("markets", Json.obj([("type", Json.str("array")), ("items", Json.obj([("type", Json.str("object")), ("properties", Json.obj([("marketId", Json.obj([("type", Json.str("string"))])), ("matchDetails", Json.obj([("type", Json.str("string"))])), ("homeTeam", Json.obj([("type", Json.str("string"))])), ("awayTeam", Json.obj([("type", Json.str("string"))])), ("kickoffTime", Json.obj([("type", Json.str("string"))])), ("kickoffTimeFormatted", Json.obj([("type", Json.str("string"))])), ("bettingDeadline", Json.obj([("type", Json.str("string"))])), ("bettingDeadlineFormatted", Json.obj([("type", Json.str("string"))])), ("status", Json.obj([("type", Json.str("string"))])), ("totalPool", Json.obj([("type", Json.str("string"))])), ("homeWinPool", Json.obj([("type", Json.str("string"))])), ("awayWinPool", Json.obj([("type", Json.str("string"))])), ("drawPool", Json.obj([("type", Json.str("string"))])), ("matchStatus", Json.obj([("type", Json.str("string"))]))]))]))])), ("total_count", Json.obj([("type", Json.str("number"))])), ("returned_count", Json.obj([("type", Json.str("number"))])), ("offset", Json.obj([("type", Json.str("number"))]))])),
      ("required", Json.arr([Json.str("markets"), Json.str("total_count"), Json.str("returned_count"), Json.str("offset")])),
    ]);
  };

  // Helper to format timestamp
  func formatTimestamp(nanos : Int) : Text {
    let dt = DateTime.DateTime(nanos);
    dt.toText();
  };

  // Helper to format match status from oracle event
  func formatMatchStatus(eventData : FootballOracle.EventData) : Text {
    switch (eventData) {
      case (#MatchScheduled(_)) { "Scheduled" };
      case (#MatchInProgress({ minute; homeScore; awayScore; homeTeam = _; awayTeam = _ })) {
        let minuteText = switch (minute) {
          case (?m) { Nat.toText(m) # "'" };
          case (null) { "?" };
        };
        Nat.toText(homeScore) # "-" # Nat.toText(awayScore) # " (" # minuteText # ")";
      };
      case (#MatchCancelled({ reason; homeTeam = _; awayTeam = _ })) {
        "Cancelled: " # reason;
      };
      case (#MatchFinal({ homeScore; awayScore; outcome = _; homeTeam = _; awayTeam = _ })) {
        Nat.toText(homeScore) # "-" # Nat.toText(awayScore) # " (FT)";
      };
    };
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Parse arguments
      let statusFilter : [Text] = switch (Json.get(_args, "status")) {
        case (?#array(arr)) {
          Array.mapFilter<Json.Json, Text>(
            arr,
            func(v) {
              switch (v) {
                case (#string(s)) { ?s };
                case (_) { null };
              };
            },
          );
        };
        case (_) { ["Open"] };
      };

      let limit : Nat = switch (Result.toOption(Json.getAsNat(_args, "limit"))) {
        case (?n) { if (n > 100) { 100 } else if (n < 1) { 20 } else { n } };
        case (null) { 20 };
      };

      let offset : Nat = switch (Result.toOption(Json.getAsNat(_args, "offset"))) {
        case (?n) { n };
        case (null) { 0 };
      };

      let sortBy : Text = switch (Result.toOption(Json.getAsText(_args, "sort_by"))) {
        case (?s) { s };
        case (null) { "kickoff_time" };
      };

      let teamFilter : ?Text = switch (Result.toOption(Json.getAsText(_args, "team_filter"))) {
        case (?s) if (Text.size(s) > 0) ?Text.toLowercase(s) else null;
        case (null) null;
      };

      let upcomingOnly : Bool = switch (Json.get(_args, "upcoming_only")) {
        case (?#bool(b)) b;
        case _ false;
      };

      // Get all markets matching status filter
      var filteredMarkets : [(Text, ToolContext.Market)] = [];
      for ((id, market) in Map.entries(context.markets)) {
        let marketStatus = switch (market.status) {
          case (#Open) { "Open" };
          case (#Closed) { "Closed" };
          case (#Resolved(_)) { "Resolved" };
        };

        // Check if this market's status is in the filter
        let statusMatch = Array.find<Text>(statusFilter, func(s) { s == marketStatus }) != null;

        if (statusMatch) {
          filteredMarkets := Array.append(filteredMarkets, [(id, market)]);
        };
      };

      // Apply team filter
      if (teamFilter != null) {
        let ?filter = teamFilter else return ToolContext.makeError("Filter error", cb);
        let filterLower = Text.toLowercase(filter);
        filteredMarkets := Array.filter(
          filteredMarkets,
          func((_, market) : (Text, ToolContext.Market)) : Bool {
            let homeMatch = Text.contains(Text.toLowercase(market.homeTeam), #text filterLower);
            let awayMatch = Text.contains(Text.toLowercase(market.awayTeam), #text filterLower);
            homeMatch or awayMatch;
          },
        );
      };

      // Apply upcoming_only filter
      if (upcomingOnly) {
        let now = Time.now();
        filteredMarkets := Array.filter(
          filteredMarkets,
          func((_, market) : (Text, ToolContext.Market)) : Bool {
            market.kickoffTime > now;
          },
        );
      };

      let totalCount = filteredMarkets.size();

      // Sort markets
      let hasOpenStatus = Array.find<Text>(statusFilter, func(s) { s == "Open" }) != null;
      filteredMarkets := Array.sort(
        filteredMarkets,
        func(a : (Text, ToolContext.Market), b : (Text, ToolContext.Market)) : Order.Order {
          switch (sortBy) {
            case ("total_pool") {
              Nat.compare(b.1.totalPool, a.1.totalPool) // Descending
            };
            case ("market_id") {
              Text.compare(a.0, b.0) // Ascending
            };
            case (_) {
              // "kickoff_time" or default
              if (hasOpenStatus) {
                Int.compare(a.1.kickoffTime, b.1.kickoffTime) // Ascending (soonest first for open)
              } else {
                Int.compare(b.1.kickoffTime, a.1.kickoffTime) // Descending (most recent first for closed/resolved)
              };
            };
          };
        },
      );

      // Apply pagination
      let endIndex = Nat.min(offset + limit, totalCount);
      let paginatedMarkets = if (offset >= totalCount) {
        [];
      } else {
        Iter.toArray(Array.slice(filteredMarkets, offset, endIndex));
      };

      // Convert to JSON
      let marketsJson = Json.arr(
        Array.map<(Text, ToolContext.Market), Json.Json>(
          paginatedMarkets,
          func((_, market) : (Text, ToolContext.Market)) : Json.Json {
            let marketStatusText = switch (market.status) {
              case (#Open) { "Open" };
              case (#Closed) { "Closed" };
              case (#Resolved(outcome)) {
                "Resolved:" # ToolContext.outcomeToText(outcome);
              };
            };

            Json.obj([
              ("marketId", Json.str(market.marketId)),
              ("matchDetails", Json.str(market.matchDetails)),
              ("homeTeam", Json.str(market.homeTeam)),
              ("awayTeam", Json.str(market.awayTeam)),
              ("kickoffTime", Json.str(Int.toText(market.kickoffTime))),
              ("kickoffTimeFormatted", Json.str(formatTimestamp(market.kickoffTime))),
              ("bettingDeadline", Json.str(Int.toText(market.bettingDeadline))),
              ("bettingDeadlineFormatted", Json.str(formatTimestamp(market.bettingDeadline))),
              ("status", Json.str(marketStatusText)),
              ("totalPool", Json.str(Nat.toText(market.totalPool))),
              ("homeWinPool", Json.str(Nat.toText(market.homeWinPool))),
              ("awayWinPool", Json.str(Nat.toText(market.awayWinPool))),
              ("drawPool", Json.str(Nat.toText(market.drawPool))),
            ]);
          },
        )
      );

      let output = Json.obj([
        ("markets", marketsJson),
        ("total_count", Json.float(Float.fromInt(totalCount))),
        ("returned_count", Json.float(Float.fromInt(paginatedMarkets.size()))),
        ("offset", Json.float(Float.fromInt(offset))),
      ]);

      ToolContext.makeSuccess(output, cb);
    };
  };
};
