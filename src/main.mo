import Result "mo:base/Result";
import Text "mo:base/Text";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Option "mo:base/Option";
import Int "mo:base/Int";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Nat "mo:base/Nat";
import Error "mo:base/Error";

import HttpTypes "mo:http-types";
import Map "mo:map/Map";
import { thash } "mo:map/Map";

import AuthCleanup "mo:mcp-motoko-sdk/auth/Cleanup";
import AuthState "mo:mcp-motoko-sdk/auth/State";
import AuthTypes "mo:mcp-motoko-sdk/auth/Types";

import Mcp "mo:mcp-motoko-sdk/mcp/Mcp";
import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import HttpHandler "mo:mcp-motoko-sdk/mcp/HttpHandler";
import Cleanup "mo:mcp-motoko-sdk/mcp/Cleanup";
import State "mo:mcp-motoko-sdk/mcp/State";
import Payments "mo:mcp-motoko-sdk/mcp/Payments";
import HttpAssets "mo:mcp-motoko-sdk/mcp/HttpAssets";
import Beacon "mo:mcp-motoko-sdk/mcp/Beacon";
import ApiKey "mo:mcp-motoko-sdk/auth/ApiKey";

import SrvTypes "mo:mcp-motoko-sdk/server/Types";

import IC "mo:ic";

import ToolContext "tools/ToolContext";
import FootballOracle "tools/FootballOracle";
import account_deposit "tools/account_deposit";
import markets_list "tools/markets_list";
import prediction_place "tools/prediction_place";
import prediction_claim_winnings "tools/prediction_claim_winnings";
import account_get_info "tools/account_get_info";
import account_withdraw "tools/account_withdraw";
import odds_fetch "tools/odds_fetch";

shared ({ caller = deployer }) persistent actor class McpServer(
  args : ?{
    owner : ?Principal;
    footballOracleId : ?Principal;
    tokenLedger : ?Principal;
  }
) = self {

  // The canister owner, who can manage treasury funds.
  // Defaults to the deployer if not specified.
  var owner : Principal = Option.get(do ? { args!.owner! }, deployer);

  // Football Oracle canister ID (mainnet default)
  let footballOracleId : Principal = Option.get(
    do ? { args!.footballOracleId! },
    Principal.fromText("iq5so-oiaaa-aaaai-q34ia-cai"),
  );

  // Token ledger for deposits/withdrawals (USDC mainnet default)
  let tokenLedger : Principal = Option.get(
    do ? { args!.tokenLedger! },
    Principal.fromText("53nhb-haaaa-aaaar-qbn5q-cai"),
  );

  // Stable state for markets (using stable Map)
  var markets = Map.new<Text, ToolContext.Market>();
  var userBalances = Map.new<Principal, Nat>();
  var userPositions = Map.new<Principal, [ToolContext.Position]>();
  var nextMarketId : Nat = 0;
  var nextPositionId : Nat = 0;
  var processedOracleIds = Map.new<Nat, Bool>();

  // State for certified HTTP assets (like /.well-known/...)
  var stable_http_assets : HttpAssets.StableEntries = [];
  transient let http_assets = HttpAssets.init(stable_http_assets);

  // Resource contents
  var resourceContents : [(Text, Text)] = [];

  // The application context that holds our state.
  var appContext : McpTypes.AppContext = State.init(resourceContents);

  // =================================================================================
  // --- OPT-IN: MONETIZATION & AUTHENTICATION ---
  // Authentication enabled for user identification
  // =================================================================================

  let issuerUrl = "https://bfggx-7yaaa-aaaai-q32gq-cai.icp0.io";
  let allowanceUrl = "https://prometheusprotocol.org/app/io.github.jneums.final-score";
  let requiredScopes = ["openid"];

  //function to transform the response for jwks client
  public query func transformJwksResponse({
    context = _ : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    {
      response with headers = []; // not interested in the headers
    };
  };

  // Initialize the auth context with the issuer URL and required scopes.
  var authContext : ?AuthTypes.AuthContext = ?AuthState.init(
    Principal.fromActor(self),
    owner,
    issuerUrl,
    requiredScopes,
    transformJwksResponse,
  );

  // =================================================================================
  // --- OPT-IN: USAGE ANALYTICS (BEACON) ---
  // Beacon enabled for analytics
  // =================================================================================

  let beaconCanisterId = Principal.fromText("m63pw-fqaaa-aaaai-q33pa-cai");
  transient let beaconContext : ?Beacon.BeaconContext = ?Beacon.init(
    beaconCanisterId,
    ?(15 * 60),
  );

  // --- Timers ---
  Cleanup.startCleanupTimer<system>(appContext);

  // The AuthCleanup timer only needs to run if authentication is enabled.
  switch (authContext) {
    case (?ctx) { AuthCleanup.startCleanupTimer<system>(ctx) };
    case (null) { Debug.print("Authentication is disabled.") };
  };

  // The Beacon timer only needs to run if the beacon is enabled.
  switch (beaconContext) {
    case (?ctx) { Beacon.startTimer<system>(ctx) };
    case (null) { Debug.print("Beacon is disabled.") };
  };

  // --- Market Creation Logic ---
  func syncMarketsFromOracle() : async () {
    try {
      Debug.print("Fetching scheduled matches from Football Oracle...");
      let oracle = actor (Principal.toText(footballOracleId)) : FootballOracle.Self;

      // Calculate time range: now to 60 days from now
      let currentTime = Time.now();
      let sixtyDaysNanos : Nat = 60 * 24 * 60 * 60 * 1_000_000_000; // 60 days in nanoseconds
      let maxFutureTime : Nat = Int.abs(currentTime) + sixtyDaysNanos;

      // Query matches with filters - only get Scheduled matches within next 60 days
      // Paginate with batches of 100 matches
      let batchSize : Nat = 100;
      var offset : Nat = 0;
      var totalFetched : Nat = 0;
      var newMarketsCreated = 0;
      var keepFetching = true;

      while (keepFetching) {
        let request : FootballOracle.GetScheduledMatchesRequest = {
          startTime = ?Int.abs(currentTime);
          endTime = ?maxFutureTime;
          status = ?"Scheduled"; // Only fetch scheduled matches
          league = null; // All leagues
          limit = ?batchSize;
          offset = ?offset;
          sortBy = null;
          sortOrder = null;
        };

        let scheduledMatches = await oracle.query_scheduled_matches(request);
        let batchCount = scheduledMatches.size();
        totalFetched += batchCount;

        Debug.print("Fetched batch: " # debug_show (batchCount) # " matches (offset: " # debug_show (offset) # ")");

        // Process this batch
        for (matchInfo in scheduledMatches.vals()) {
          // Check if we've already processed this oracle ID
          if (not Map.has(processedOracleIds, Map.nhash, matchInfo.oracleId)) {
            // Create market for this match
            let marketId = Nat.toText(nextMarketId);
            nextMarketId += 1;

            // Betting deadline is 5 minutes before kickoff
            let kickoffNanos : Int = matchInfo.scheduledTime;
            let fiveMinutesNanos : Int = 300_000_000_000; // 5 minutes in nanoseconds
            let bettingDeadline : Int = kickoffNanos - fiveMinutesNanos;

            let market : ToolContext.Market = {
              marketId = marketId;
              matchDetails = matchInfo.homeTeam # " vs " # matchInfo.awayTeam;
              homeTeam = matchInfo.homeTeam;
              awayTeam = matchInfo.awayTeam;
              kickoffTime = matchInfo.scheduledTime;
              bettingDeadline = bettingDeadline;
              status = #Open;
              homeWinPool = 0;
              awayWinPool = 0;
              drawPool = 0;
              totalPool = 0;
              oracleMatchId = Nat.toText(matchInfo.oracleId);
            };

            Map.set(markets, thash, marketId, market);
            Map.set(processedOracleIds, Map.nhash, matchInfo.oracleId, true);

            Debug.print("Created market " # marketId # " for " # market.matchDetails # " (Oracle ID: " # Nat.toText(matchInfo.oracleId) # ")");
            newMarketsCreated += 1;
          };
        };

        // If we got less than a full batch, we've reached the end
        if (batchCount < batchSize) {
          Debug.print("Reached end of results (batch size: " # debug_show (batchCount) # ")");
          keepFetching := false;
        } else {
          offset += batchSize;
        };
      };

      Debug.print("Market sync completed. Total fetched: " # debug_show (totalFetched) # ", New markets created: " # debug_show (newMarketsCreated) # ", Total markets: " # debug_show (Map.size(markets)));
    } catch (e) {
      Debug.print("Failed to sync markets from oracle: " # Error.message(e));
    };
  };

  // --- Market Resolution Logic ---
  func resolveCompletedMarkets() : async () {
    let oracle = actor (Principal.toText(footballOracleId)) : FootballOracle.Self;
    let now = Time.now();

    // Find markets that are open or closed but not yet resolved
    for ((marketId, market) in Map.entries(markets)) {
      switch (market.status) {
        case (#Open) {
          // Check if betting deadline has passed
          if (now >= market.bettingDeadline) {
            let closedMarket = { market with status = #Closed };
            Map.set(markets, thash, marketId, closedMarket);
            Debug.print("Closed market " # marketId # " for betting");
          };
        };
        case (#Closed) {
          // Try to get the latest event from the oracle
          try {
            let oracleId = switch (Nat.fromText(market.oracleMatchId)) {
              case (?id) { id };
              case (null) {
                Debug.print("Invalid oracle ID for market " # marketId);
                return;
              };
            };

            let maybeEvent = await oracle.get_latest_event(oracleId);

            switch (maybeEvent) {
              case (?event) {
                // Check if this is a MatchFinal event
                switch (event.eventData) {
                  case (#MatchFinal { outcome; homeScore = _; awayScore = _; homeTeam = _; awayTeam = _ }) {
                    // Convert oracle outcome to our outcome type
                    let finalOutcome : ToolContext.Outcome = switch (outcome) {
                      case (#HomeWin) { #HomeWin };
                      case (#AwayWin) { #AwayWin };
                      case (#Draw) { #Draw };
                    };

                    let resolvedMarket = {
                      market with status = #Resolved(finalOutcome)
                    };
                    Map.set(markets, thash, marketId, resolvedMarket);

                    Debug.print("Resolved market " # marketId # " with outcome: " # debug_show (finalOutcome));
                  };
                  case (_) {
                    // Not a final event yet
                  };
                };
              };
              case (null) {
                // No events yet for this match
              };
            };
          } catch (e) {
            Debug.print("Failed to check oracle for market " # marketId # ": " # Error.message(e));
          };
        };
        case (#Resolved(_)) {
          // Already resolved, nothing to do
        };
      };
    };
  };

  // --- Market Timers Setup ---
  // Start timers after function definitions

  // Initial market sync on startup
  ignore Timer.setTimer<system>(
    #seconds(5), // Run 5 seconds after startup
    func() : async () {
      Debug.print("Initial market sync starting...");
      await syncMarketsFromOracle();
      Debug.print("Initial market sync completed. Total markets: " # debug_show (Map.size(markets)));
    },
  );

  // Market Creation Timer - Periodically sync with Football Oracle to create new markets
  // Oracle fetches new matches once per day, so we check every 6 hours
  ignore Timer.recurringTimer<system>(
    #seconds(6 * 60 * 60), // Every 6 hours (21600 seconds)
    func() : async () {
      Debug.print("Scheduled market sync starting...");
      await syncMarketsFromOracle();
      Debug.print("Scheduled market sync completed. Total markets: " # debug_show (Map.size(markets)));
    },
  );

  // Market Resolution Timer - Periodically check for match results and resolve markets
  // Check every 15 minutes for completed matches
  ignore Timer.recurringTimer<system>(
    #seconds(15 * 60), // Every 15 minutes (900 seconds)
    func() : async () {
      Debug.print("Market resolution check starting...");
      await resolveCompletedMarkets();
    },
  );

  // --- 1. DEFINE YOUR RESOURCES & TOOLS ---
  transient let resources : [McpTypes.Resource] = [];

  transient let tools : [McpTypes.Tool] = [
    account_deposit.config(),
    account_withdraw.config(),
    account_get_info.config(),
    markets_list.config(),
    prediction_place.config(),
    prediction_claim_winnings.config(),
    odds_fetch.config(),
  ];

  transient let toolContext : ToolContext.ToolContext = {
    canisterPrincipal = Principal.fromActor(self);
    owner = owner;
    footballOracleId = footballOracleId;
    tokenLedger = tokenLedger;
    markets = markets;
    userBalances = userBalances;
    userPositions = userPositions;
    var nextMarketId = nextMarketId;
    var nextPositionId = nextPositionId;
  };

  // --- 3. CONFIGURE THE SDK ---
  transient let mcpConfig : McpTypes.McpConfig = {
    self = Principal.fromActor(self);
    allowanceUrl = ?allowanceUrl;
    serverInfo = {
      name = "io.github.jneums.final-score";
      title = "Final Score - Football Prediction Markets";
      version = "0.2.0";
    };
    resources = resources;
    resourceReader = func(uri) {
      Map.get(appContext.resourceContents, thash, uri);
    };
    tools = tools;
    toolImplementations = [
      ("account_deposit", account_deposit.handle(toolContext)),
      ("account_withdraw", account_withdraw.handle(toolContext)),
      ("account_get_info", account_get_info.handle(toolContext)),
      ("markets_list", markets_list.handle(toolContext)),
      ("prediction_place", prediction_place.handle(toolContext)),
      ("prediction_claim_winnings", prediction_claim_winnings.handle(toolContext)),
      ("odds_fetch", odds_fetch.handle(toolContext)),
    ];
    beacon = beaconContext;
  };

  // --- 4. CREATE THE SERVER LOGIC ---
  transient let mcpServer = Mcp.createServer(mcpConfig);

  // --- PUBLIC ENTRY POINTS ---

  // Do not remove these public methods below. They are required for the MCP Registry and MCP Orchestrator
  // to manage the canister upgrades and installs, handle payments, and allow owner only methods.

  /// Get the current owner of the canister.
  public query func get_owner() : async Principal { return owner };

  /// Set a new owner for the canister. Only the current owner can call this.
  public shared ({ caller }) func set_owner(new_owner : Principal) : async Result.Result<(), Payments.TreasuryError> {
    if (caller != owner) { return #err(#NotOwner) };
    owner := new_owner;
    return #ok(());
  };

  /// Get the canister's balance of a specific ICRC-1 token.
  /// OWNER ONLY - Sensitive treasury information
  public shared ({ caller }) func get_treasury_balance(ledger_id : Principal) : async Result.Result<Nat, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };
    let balance = await Payments.get_treasury_balance(Principal.fromActor(self), ledger_id);
    return #ok(balance);
  };

  /// Withdraw tokens from the canister's treasury to a specified destination.
  public shared ({ caller }) func withdraw(
    ledger_id : Principal,
    amount : Nat,
    destination : Payments.Destination,
  ) : async Result.Result<Nat, Payments.TreasuryError> {
    return await Payments.withdraw(
      caller,
      owner,
      ledger_id,
      amount,
      destination,
    );
  };

  // Helper to create the HTTP context for each request.
  private func _create_http_context() : HttpHandler.Context {
    return {
      self = Principal.fromActor(self);
      active_streams = appContext.activeStreams;
      mcp_server = mcpServer;
      streaming_callback = http_request_streaming_callback;
      // This passes the optional auth context to the handler.
      // If it's `null`, the handler will skip all auth checks.
      auth = authContext;
      http_asset_cache = ?http_assets.cache;
      mcp_path = ?"/mcp";
    };
  };

  /// Handle incoming HTTP requests.
  public query func http_request(req : SrvTypes.HttpRequest) : async SrvTypes.HttpResponse {
    let ctx : HttpHandler.Context = _create_http_context();
    // Ask the SDK to handle the request
    switch (HttpHandler.http_request(ctx, req)) {
      case (?mcpResponse) {
        // The SDK handled it, so we return its response.
        return mcpResponse;
      };
      case (null) {
        // The SDK ignored it. Now we can handle our own custom routes.
        if (req.url == "/") {
          // e.g., Serve a frontend asset
          return {
            status_code = 200;
            headers = [("Content-Type", "text/html")];
            body = Text.encodeUtf8("<h1>My Canister Frontend</h1>");
            upgrade = null;
            streaming_strategy = null;
          };
        } else {
          // Return a 404 for any other unhandled routes.
          return {
            status_code = 404;
            headers = [];
            body = Blob.fromArray([]);
            upgrade = null;
            streaming_strategy = null;
          };
        };
      };
    };
  };

  /// Handle incoming HTTP requests that modify state (e.g., POST).
  public shared func http_request_update(req : SrvTypes.HttpRequest) : async SrvTypes.HttpResponse {
    let ctx : HttpHandler.Context = _create_http_context();

    // Ask the SDK to handle the request
    let mcpResponse = await HttpHandler.http_request_update(ctx, req);

    switch (mcpResponse) {
      case (?res) {
        // The SDK handled it.
        return res;
      };
      case (null) {
        // The SDK ignored it. Handle custom update calls here.
        return {
          status_code = 404;
          headers = [];
          body = Blob.fromArray([]);
          upgrade = null;
          streaming_strategy = null;
        };
      };
    };
  };

  /// Handle streaming callbacks for large HTTP responses.
  public query func http_request_streaming_callback(token : HttpTypes.StreamingToken) : async ?HttpTypes.StreamingCallbackResponse {
    let ctx : HttpHandler.Context = _create_http_context();
    return HttpHandler.http_request_streaming_callback(ctx, token);
  };

  // --- CANISTER LIFECYCLE MANAGEMENT ---

  system func preupgrade() {
    stable_http_assets := HttpAssets.preupgrade(http_assets);
  };

  system func postupgrade() {
    HttpAssets.postupgrade(http_assets);
  };

  /**
   * Creates a new API key. This API key is linked to the caller's principal.
   * @param name A human-readable name for the key.
   * @returns The raw, unhashed API key. THIS IS THE ONLY TIME IT WILL BE VISIBLE.
   */
  public shared (msg) func create_my_api_key(name : Text, scopes : [Text]) : async Text {
    switch (authContext) {
      case (null) {
        Debug.trap("Authentication is not enabled on this canister.");
      };
      case (?ctx) {
        return await ApiKey.create_my_api_key(
          ctx,
          msg.caller,
          name,
          scopes,
        );
      };
    };
  };

  /** Revoke (delete) an API key owned by the caller.
   * @param key_id The ID of the key to revoke.
   * @returns True if the key was found and revoked, false otherwise.
   */
  public shared (msg) func revoke_my_api_key(key_id : Text) : async () {
    switch (authContext) {
      case (null) {
        Debug.trap("Authentication is not enabled on this canister.");
      };
      case (?ctx) {
        return ApiKey.revoke_my_api_key(ctx, msg.caller, key_id);
      };
    };
  };

  /** List all API keys owned by the caller.
   * @returns A list of API key metadata (but not the raw keys).
   */
  public query (msg) func list_my_api_keys() : async [AuthTypes.ApiKeyMetadata] {
    switch (authContext) {
      case (null) {
        Debug.trap("Authentication is not enabled on this canister.");
      };
      case (?ctx) {
        return ApiKey.list_my_api_keys(ctx, msg.caller);
      };
    };
  };

  public type UpgradeFinishedResult = {
    #InProgress : Nat;
    #Failed : (Nat, Text);
    #Success : Nat;
  };
  private func natNow() : Nat {
    return Int.abs(Time.now());
  };
  /* Return success after post-install/upgrade operations complete.
   * The Nat value is a timestamp (in nanoseconds) of when the upgrade finished.
   * If the upgrade is still in progress, return #InProgress with a timestamp of when it started.
   * If the upgrade failed, return #Failed with a timestamp and an error message.
   */
  public func icrc120_upgrade_finished() : async UpgradeFinishedResult {
    #Success(natNow());
  };

  /// Manually trigger a market sync with the Football Oracle
  /// Returns the number of new markets created
  /// OWNER ONLY - Expensive oracle query operation
  public shared ({ caller }) func refresh_markets() : async Result.Result<Nat, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    Debug.print("Manual market refresh triggered by " # Principal.toText(caller));
    let beforeCount = Map.size(markets);
    await syncMarketsFromOracle();
    let afterCount = Map.size(markets);
    let newMarkets = Nat.sub(afterCount, beforeCount);
    Debug.print("Manual refresh completed. New markets created: " # debug_show (newMarkets) # ", Total markets: " # debug_show (afterCount));
    return #ok(newMarkets);
  };

  /// Get the current number of markets
  public query func get_market_count() : async {
    total : Nat;
    open : Nat;
    closed : Nat;
    resolved : Nat;
  } {
    var openCount = 0;
    var closedCount = 0;
    var resolvedCount = 0;

    for ((_, market) in Map.entries(markets)) {
      switch (market.status) {
        case (#Open) { openCount += 1 };
        case (#Closed) { closedCount += 1 };
        case (#Resolved(_)) { resolvedCount += 1 };
      };
    };

    return {
      total = Map.size(markets);
      open = openCount;
      closed = closedCount;
      resolved = resolvedCount;
    };
  };

  /// Debug: Get detailed information about a specific market
  public query func debug_get_market(marketId : Text) : async ?{
    marketId : Text;
    matchDetails : Text;
    homeTeam : Text;
    awayTeam : Text;
    oracleMatchId : Text;
    kickoffTime : Int;
    bettingDeadline : Int;
    status : Text;
    totalPool : Text;
    homeWinPool : Text;
    awayWinPool : Text;
    drawPool : Text;
  } {
    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        let statusText = switch (market.status) {
          case (#Open) "Open";
          case (#Closed) "Closed";
          case (#Resolved(outcome)) {
            "Resolved:" # (
              switch (outcome) {
                case (#HomeWin) "HomeWin";
                case (#AwayWin) "AwayWin";
                case (#Draw) "Draw";
              }
            );
          };
        };
        ?{
          marketId = market.marketId;
          matchDetails = market.matchDetails;
          homeTeam = market.homeTeam;
          awayTeam = market.awayTeam;
          oracleMatchId = market.oracleMatchId;
          kickoffTime = market.kickoffTime;
          bettingDeadline = market.bettingDeadline;
          status = statusText;
          totalPool = Nat.toText(market.totalPool);
          homeWinPool = Nat.toText(market.homeWinPool);
          awayWinPool = Nat.toText(market.awayWinPool);
          drawPool = Nat.toText(market.drawPool);
        };
      };
      case null null;
    };
  };

  /// Debug: Check oracle events for a specific match
  /// OWNER ONLY - Debug function should be restricted
  public shared ({ caller }) func debug_check_oracle_events(oracleMatchIdText : Text) : async Result.Result<Text, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    let oracleMatchId = switch (Nat.fromText(oracleMatchIdText)) {
      case (?id) id;
      case null { return #err("Invalid oracle match ID: must be a number") };
    };

    let oracle = actor (Principal.toText(footballOracleId)) : FootballOracle.Self;

    try {
      let eventsResult = await oracle.get_match_events(oracleMatchId);
      switch (eventsResult) {
        case (#Ok(events)) {
          if (events.size() == 0) {
            return #ok("No events found for match #" # debug_show (oracleMatchId));
          };

          var result = "Found " # debug_show (events.size()) # " events for match #" # debug_show (oracleMatchId) # ":\n";
          for (event in events.vals()) {
            let eventType = switch (event.eventData) {
              case (#MatchScheduled(data)) {
                "MatchScheduled(" # data.homeTeam # " vs " # data.awayTeam # ")";
              };
              case (#MatchInProgress(data)) {
                let minuteText = switch (data.minute) {
                  case (?m) debug_show (m) # "'";
                  case null "?";
                };
                "MatchInProgress(" # minuteText # " - " # data.homeTeam # " " # debug_show (data.homeScore) # "-" # debug_show (data.awayScore) # " " # data.awayTeam # ")";
              };
              case (#MatchCancelled(data)) {
                "MatchCancelled(" # data.homeTeam # " vs " # data.awayTeam # ", reason: " # data.reason # ")";
              };
              case (#MatchFinal(score)) {
                "MatchFinal(home:" # debug_show (score.homeScore) # ", away:" # debug_show (score.awayScore) # ", outcome:" # debug_show (score.outcome) # ")";
              };
            };
            result := result # "  Event at " # debug_show (event.timestamp) # ": " # eventType # "\n";
          };
          return #ok(result);
        };
        case (#Error(err)) {
          return #err("Error from oracle: " # debug_show (err));
        };
      };
    } catch (e) {
      return #err("Error fetching events: " # Error.message(e));
    };
  };

  /// Debug: Manually trigger resolution check for a specific market
  /// OWNER ONLY - Critical function that can resolve markets
  public shared ({ caller }) func debug_resolve_market(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    Debug.print("Manual resolution triggered for market " # marketId # " by " # Principal.toText(caller));

    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        if (
          market.status == #Resolved(#HomeWin) or
          market.status == #Resolved(#AwayWin) or
          market.status == #Resolved(#Draw)
        ) {
          return #ok("Market already resolved");
        };

        let oracle = actor (Principal.toText(footballOracleId)) : FootballOracle.Self;

        try {
          // Parse the oracle match ID from Text to Nat
          let oracleMatchId = switch (Nat.fromText(market.oracleMatchId)) {
            case (?id) id;
            case null {
              return #err("Invalid oracle match ID in market: " # market.oracleMatchId);
            };
          };

          let eventsResult = await oracle.get_match_events(oracleMatchId);

          switch (eventsResult) {
            case (#Ok(events)) {
              // Look for MatchFinal event
              for (event in events.vals()) {
                switch (event.eventData) {
                  case (#MatchFinal(score)) {
                    let outcome : ToolContext.Outcome = switch (score.outcome) {
                      case (#HomeWin) #HomeWin;
                      case (#AwayWin) #AwayWin;
                      case (#Draw) #Draw;
                    };

                    // Update market status
                    let updatedMarket = {
                      market with
                      status = #Resolved(outcome);
                    };
                    ignore Map.put(markets, thash, marketId, updatedMarket);
                    // Track this event as processed using its unique oracleId
                    ignore Map.put(processedOracleIds, Map.nhash, event.oracleId, true);

                    Debug.print("Market " # marketId # " resolved to " # debug_show (outcome) # " based on oracle event #" # debug_show (event.oracleId));
                    return #ok("Market resolved successfully to " # debug_show (outcome) # " (home:" # debug_show (score.homeScore) # ", away:" # debug_show (score.awayScore) # ")");
                  };
                  case _ {};
                };
              };
              return #ok("No MatchFinal event found yet. Found " # debug_show (events.size()) # " events.");
            };
            case (#Error(err)) {
              return #err("Oracle error: " # debug_show (err));
            };
          };
        } catch (e) {
          let msg = "Error checking oracle: " # Error.message(e);
          Debug.print(msg);
          return #err(msg);
        };
      };
      case null {
        return #err("Market not found");
      };
    };
  };

  /// Debug: Get last processed oracle event ID
  public query func debug_get_processed_events() : async Nat {
    Map.size(processedOracleIds);
  };

  /// Admin: Revert a market back to Open or Closed status (for incorrect resolutions)
  /// This allows re-betting and re-resolution with correct data
  /// OWNER ONLY - Critical admin function
  public shared ({ caller }) func admin_revert_market_to_open(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    Debug.print("Admin reverting market " # marketId # " by " # Principal.toText(caller));

    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        let now = Time.now();

        // Determine correct status based on betting deadline
        let correctStatus = if (now >= market.bettingDeadline) {
          #Closed;
        } else {
          #Open;
        };

        let revertedMarket = {
          market with
          status = correctStatus;
        };
        ignore Map.put(markets, thash, marketId, revertedMarket);

        let statusText = switch (correctStatus) {
          case (#Open) "Open";
          case (#Closed) "Closed";
        };

        Debug.print("Market " # marketId # " reverted to " # statusText);
        return #ok("Market successfully reverted to " # statusText # ". Note: Any claimed winnings from incorrect resolution are NOT reversed.");
      };
      case null {
        return #err("Market not found");
      };
    };
  };

  /// Admin: Clear processed oracle event to allow re-processing
  /// OWNER ONLY - Critical admin function
  public shared ({ caller }) func admin_clear_processed_event(eventTimestamp : Nat) : async Result.Result<Text, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    let existed = Map.remove(processedOracleIds, Map.nhash, eventTimestamp);
    switch (existed) {
      case (?_) {
        Debug.print("Cleared processed event timestamp: " # debug_show (eventTimestamp));
        return #ok("Event cleared. Market can now be re-resolved.");
      };
      case null {
        return #err("Event timestamp not found in processed events");
      };
    };
  };

  /// Admin: Delete a market (only allowed if total pool is zero)
  /// OWNER ONLY - Use to clean up orphaned or test markets
  public shared ({ caller }) func admin_delete_market(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) { return #err("Unauthorized: owner only") };

    Debug.print("Admin deleting market " # marketId # " by " # Principal.toText(caller));

    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        // Safety check: only delete markets with zero pools (no user funds)
        if (market.totalPool > 0) {
          return #err("Cannot delete market with active pools. Total pool: " # Nat.toText(market.totalPool));
        };

        // Remove the market
        ignore Map.remove(markets, thash, marketId);

        Debug.print("Market " # marketId # " (" # market.matchDetails # ") deleted successfully");
        return #ok("Market " # marketId # " (" # market.matchDetails # ") deleted successfully");
      };
      case null {
        return #err("Market not found");
      };
    };
  };
};
