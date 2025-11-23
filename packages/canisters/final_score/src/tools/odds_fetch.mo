import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";
import Result "mo:base/Result";
import Principal "mo:base/Principal";
import Json "mo:json";
import Nat "mo:base/Nat";
import Error "mo:base/Error";
import Debug "mo:base/Debug";
import Map "mo:map/Map";

import ToolContext "ToolContext";
import FootballOracle "FootballOracle";

module {

  // Tool schema
  public func config() : McpTypes.Tool = {
    name = "odds_fetch";
    title = ?"Fetch Odds for a Match";
    description = ?(
      "Retrieve current betting odds for a specific match from various bookmakers. " #
      "Returns odds data in JSON format including match outcome odds (HomeWin, AwayWin, Draw) " #
      "from multiple sources."
    );
    payment = null;
    inputSchema = Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("marketId", Json.obj([("type", Json.str("string")), ("description", Json.str("The ID of the market to fetch odds for."))]))])),
      ("required", Json.arr([Json.str("marketId")])),
    ]);
    outputSchema = ?Json.obj([
      ("type", Json.str("object")),
      ("properties", Json.obj([("odds_data", Json.obj([("type", Json.str("string")), ("description", Json.str("JSON string containing odds data from bookmakers"))]))])),
      ("required", Json.arr([Json.str("odds_data")])),
    ]);
  };

  public func handle(context : ToolContext.ToolContext) : (_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) -> async () {

    func(_args : McpTypes.JsonValue, _auth : ?AuthTypes.AuthInfo, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) : async () {

      // Authentication optional for public odds data
      // let ?auth = _auth else return ToolContext.makeError("Authentication required", cb);

      // Parse marketId argument
      let marketId = switch (Result.toOption(Json.getAsText(_args, "marketId"))) {
        case (?id) { id };
        case (null) {
          return ToolContext.makeError("Missing 'marketId' argument", cb);
        };
      };

      // Get the market to retrieve oracleMatchId
      let ?market = Map.get(context.markets, Map.thash, marketId) else {
        return ToolContext.makeError("Market not found", cb);
      };

      // Parse oracle match ID
      let oracleMatchId = switch (Nat.fromText(market.oracleMatchId)) {
        case (?id) { id };
        case (null) {
          return ToolContext.makeError("Invalid oracle match ID in market", cb);
        };
      };

      // Call the oracle to fetch odds
      // betId = 1 for match outcome (HomeWin, AwayWin, Draw)
      let oracle = actor (Principal.toText(context.footballOracleId)) : FootballOracle.Self;

      try {
        Debug.print("Fetching odds for oracle match ID: " # Nat.toText(oracleMatchId));
        let oddsJson = await oracle.fetch_odds(oracleMatchId, null, ?1);

        Debug.print("Received odds data: " # oddsJson);

        // Return the JSON string directly
        let output = Json.obj([
          ("odds_data", Json.str(oddsJson)),
        ]);

        ToolContext.makeSuccess(output, cb);
      } catch (e) {
        let errorMsg = "Failed to fetch odds from oracle: " # Error.message(e);
        Debug.print(errorMsg);
        return ToolContext.makeError(errorMsg, cb);
      };
    };
  };
};
