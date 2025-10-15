import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Json "mo:json";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Float "mo:base/Float";
import Array "mo:base/Array";
import Iter "mo:base/Iter";
import Map "mo:map/Map";
import Text "mo:base/Text";
import Order "mo:base/Order";
import DateTime "mo:datetime/DateTime";
import Principal "mo:base/Principal";

import ToolContext "ToolContext";
import FootballOracle "FootballOracle";

module {

  // Helper function to format nanosecond timestamp to readable UTC string
  private func formatTimestamp(nanos : Int) : Text {
    let dateTime = DateTime.DateTime(nanos);
    DateTime.toTextAdvanced(dateTime, #custom({ format = "YYYY-MM-DD HH:mm:ss [UTC]"; locale = null }));
  };

  // Helper function to format match status from oracle event
  private func formatMatchStatus(event : ?FootballOracle.OracleEvent) : Text {
    switch (event) {
      case (?e) {
        switch (e.eventData) {
          case (#MatchInProgress { homeScore; awayScore; minute }) {
            let minuteText = switch (minute) {
              case (?m) { Nat.toText(m) # "'" };
              case (null) { "?" };
            };
            Nat.toText(homeScore) # "-" # Nat.toText(awayScore) # " (" # minuteText # ")";
          };
          case (#MatchFinal { homeScore; awayScore; outcome = _ }) {
            Nat.toText(homeScore) # "-" # Nat.toText(awayScore) # " (FT)";
          };
          case (#MatchCancelled { reason = _ }) {
            "Cancelled";
          };
          case (_) {
            "Waiting for match to start";
          };
        };
      };
      case (null) {
        "No data";
      };
    };
  };

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "markets_list_closed";
    title = ?"List Closed/In-Progress Markets";
    description = ?(
      "Returns a paginated, filtered, and sorted list of closed prediction markets (betting deadline has passed, match may be in progress or finished but not yet resolved). " #
      "Supports filtering by team name, sorting by kickoff time or pool size, and pagination."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("limit", Json.obj([("type", Json.str("number")), ("description", Json.str("Maximum number of markets to return (default: 20, max: 100)")), ("default", Json.float(20))])), ("offset", Json.obj([("type", Json.str("number")), ("description", Json.str("Number of markets to skip for pagination (default: 0)")), ("default", Json.float(0))])), ("sort_by", Json.obj([("type", Json.str("string")), ("enum", Json.arr([Json.str("kickoff_time"), Json.str("total_pool"), Json.str("market_id")])), ("description", Json.str("Sort markets by kickoff time, total pool size, or market ID (default: kickoff_time)"))])), ("team_filter", Json.obj([("type", Json.str("string")), ("description", Json.str("Filter markets by team name (case-insensitive, matches home or away team)"))]))])),
      ("required", Json.arr([])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("markets", Json.obj([("type", Json.str("array")), ("description", Json.str("Array of closed prediction markets. Each market includes both Unix nanosecond timestamps and human-readable ISO 8601 formatted times in UTC."))])), ("total_count", Json.obj([("type", Json.str("number")), ("description", Json.str("Total number of markets matching the filter"))])), ("returned_count", Json.obj([("type", Json.str("number")), ("description", Json.str("Number of markets returned in this response"))])), ("offset", Json.obj([("type", Json.str("number")), ("description", Json.str("Current offset for pagination"))]))])),
      ("required", Json.arr([Json.str("markets"), Json.str("total_count"), Json.str("returned_count"), Json.str("offset")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Get oracle actor
      let oracle = actor (Principal.toText(context.footballOracleId)) : FootballOracle.Self;

      // Parse input parameters with defaults
      let limit : Nat = switch (Result.toOption(Json.getAsNat(_args, "limit"))) {
        case (?n) {
          if (n > 100) 100 else if (n < 1) 20 else n;
        };
        case null 20;
      };

      let offset : Nat = switch (Result.toOption(Json.getAsNat(_args, "offset"))) {
        case (?n) n;
        case null 0;
      };

      let sortBy : Text = switch (Result.toOption(Json.getAsText(_args, "sort_by"))) {
        case (?s) s;
        case null "kickoff_time";
      };

      let teamFilter : ?Text = switch (Result.toOption(Json.getAsText(_args, "team_filter"))) {
        case (?s) if (Text.size(s) > 0) ?Text.toLowercase(s) else null;
        case null null;
      };

      // Filter markets
      let allMarkets = Iter.toArray(Map.vals(context.markets));
      let filteredMarkets = Array.filter<ToolContext.Market>(
        allMarkets,
        func(market : ToolContext.Market) : Bool {
          // Must be closed (betting deadline passed, match in progress or finished)
          if (market.status != #Closed) return false;

          // Apply team filter
          switch (teamFilter) {
            case (?filter) {
              let homeTeamLower = Text.toLowercase(market.homeTeam);
              let awayTeamLower = Text.toLowercase(market.awayTeam);
              Text.contains(homeTeamLower, #text filter) or Text.contains(awayTeamLower, #text filter);
            };
            case null true;
          };
        },
      );

      let totalCount = filteredMarkets.size();

      // Sort markets
      let sortedMarkets = Array.sort<ToolContext.Market>(
        filteredMarkets,
        func(a, b) : Order.Order {
          switch (sortBy) {
            case "kickoff_time" Int.compare(a.kickoffTime, b.kickoffTime);
            case "total_pool" Nat.compare(b.totalPool, a.totalPool); // Descending
            case "market_id" Text.compare(a.marketId, b.marketId);
            case _ Int.compare(a.kickoffTime, b.kickoffTime); // Default to kickoff time
          };
        },
      );

      // Apply pagination
      let paginatedMarkets = if (offset >= sortedMarkets.size()) {
        [];
      } else {
        let endIndex = Nat.min(offset + limit, sortedMarkets.size());
        let count = if (endIndex >= offset) {
          endIndex - offset;
        } else {
          0;
        };
        Array.subArray(sortedMarkets, offset, count);
      };

      // Fetch latest events for all paginated markets sequentially
      var marketStatuses : [Text] = [];
      for (market in paginatedMarkets.vals()) {
        let status = switch (Nat.fromText(market.oracleMatchId)) {
          case (?oracleId) {
            try {
              let maybeEvent = await oracle.get_latest_event(oracleId);
              formatMatchStatus(maybeEvent);
            } catch (e) {
              "Error fetching data";
            };
          };
          case (null) {
            "Invalid oracle ID";
          };
        };
        marketStatuses := Array.append(marketStatuses, [status]);
      };

      // Convert markets to JSON with live score information
      let marketsJson = Json.arr(
        Array.tabulate<Json.Json>(
          paginatedMarkets.size(),
          func(index : Nat) : Json.Json {
            let market = paginatedMarkets[index];
            let matchStatus = if (index < marketStatuses.size()) {
              marketStatuses[index];
            } else {
              "No data";
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
              ("totalPool", Json.str(Nat.toText(market.totalPool))),
              ("homeWinPool", Json.str(Nat.toText(market.homeWinPool))),
              ("awayWinPool", Json.str(Nat.toText(market.awayWinPool))),
              ("drawPool", Json.str(Nat.toText(market.drawPool))),
              ("matchStatus", Json.str(matchStatus)),
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
