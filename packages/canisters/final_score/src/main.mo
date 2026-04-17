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
import Array "mo:base/Array";
import Float "mo:base/Float";
import Iter "mo:base/Iter";
import Nat64 "mo:base/Nat64";
import Nat32 "mo:base/Nat32";
import Char "mo:base/Char";

import Json "mo:json";
import ICCall "mo:ic/Call";
import DateTime "mo:datetime/DateTime";
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
import ICRC2 "mo:icrc2-types";

import ToolContext "tools/ToolContext";
import OrderBook "tools/OrderBook";
import markets_list "tools/markets_list";
import market_detail "tools/market_detail";
import order_place "tools/order_place";
import order_cancel "tools/order_cancel";
import orders_list "tools/orders_list";
import positions_list "tools/positions_list";
import sports_list "tools/sports_list";
import leaderboard "tools/leaderboard";
import account_get_info "tools/account_get_info";
import account_get_history "tools/account_get_history";

shared ({ caller = deployer }) persistent actor class McpServer(
  args : ?{
    owner : ?Principal;
    tokenLedger : ?Principal;
  }
) = self {

  // ═══════════════════════════════════════════════════════════
  // Configuration
  // ════���══════════════════════════════════════════════════════

  var owner : Principal = Option.get(do ? { args!.owner! }, deployer);

  let tokenLedger : Principal = Option.get(
    do ? { args!.tokenLedger! },
    Principal.fromText("53nhb-haaaa-aaaar-qbn5q-cai"), // USDC mainnet
  );

  // ═══════════════════════════════════════════════════════════
  // Stable State — v2 Order Book Model
  // ═══════════════════════════════════════════════════════════

  var markets = Map.new<Text, ToolContext.Market>();
  var orders = Map.new<Text, ToolContext.Order>();
  var orderBooks = Map.new<Text, OrderBook.Book>();
  var trades = Map.new<Text, ToolContext.Trade>();
  var positions = Map.new<Text, ToolContext.Position>();
  var userPositionIds = Map.new<Principal, [Text]>();
  var userBalances = Map.new<Principal, Nat>();
  var userStats = Map.new<Principal, ToolContext.UserStats>();
  var positionHistory = Map.new<Principal, [ToolContext.HistoricalPosition]>();

  // Polymarket sync tracking
  var knownPolySlugs = Map.new<Text, [Text]>();
  var sportTagMap = Map.new<Text, Text>(); // sport slug → best tag ID
  var syncQueue : [Text] = []; // sport slugs pending sync
  var nextMarketId : Nat = 0;
  var nextOrderId : Nat = 0;
  var nextPositionId : Nat = 0;
  var nextTradeId : Nat = 0;

  // HTTP assets (for /.well-known etc.)
  var stable_http_assets : HttpAssets.StableEntries = [];
  transient let http_assets = HttpAssets.init(stable_http_assets);

  // MCP resource contents
  var resourceContents : [(Text, Text)] = [];
  var appContext : McpTypes.AppContext = State.init(resourceContents);

  // ═══════════════════════════════════════════════════════════
  // Authentication & Beacon
  // ═══════════════════════════════════════════════════════════

  let issuerUrl = "https://bfggx-7yaaa-aaaai-q32gq-cai.icp0.io";
  let allowanceUrl = "https://prometheusprotocol.org/app/io.github.jneums.final-score";
  let requiredScopes = ["openid"];

  public query func transformJwksResponse({
    context = _ : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    { response with headers = [] };
  };

  var authContext : ?AuthTypes.AuthContext = ?AuthState.init(
    Principal.fromActor(self),
    owner,
    issuerUrl,
    requiredScopes,
    transformJwksResponse,
  );

  let beaconCanisterId = Principal.fromText("m63pw-fqaaa-aaaai-q33pa-cai");
  transient let beaconContext : ?Beacon.BeaconContext = ?Beacon.init(
    beaconCanisterId,
    ?(15 * 60),
  );

  // Cleanup timers
  Cleanup.startCleanupTimer<system>(appContext);
  switch (authContext) {
    case (?ctx) { AuthCleanup.startCleanupTimer<system>(ctx) };
    case null { Debug.print("Authentication is disabled.") };
  };
  switch (beaconContext) {
    case (?ctx) { Beacon.startTimer<system>(ctx) };
    case null { Debug.print("Beacon is disabled.") };
  };

  // ═══════════════════════════════════════════════════════════
  // HTTP Outcall Transform (for Polymarket API)
  // ═══════════════════════════════════════════════════════════

  public query func transformPolymarket({
    context = _ : Blob;
    response : IC.HttpRequestResult;
  }) : async IC.HttpRequestResult {
    { response with headers = [] };
  };

  // ═══════════════════════════════════════════════════════════
  // Deadline Enforcement Timer
  // ═══════════════════════════════════════════════════════════

  func enforceDeadlines() : async () {
    let now = Time.now();
    for ((marketId, market) in Map.entries(markets)) {
      if (market.status == #Open and now >= market.bettingDeadline) {
        // Close market — cancel all open orders
        Map.set(markets, thash, marketId, { market with status = #Closed });

        switch (Map.get(orderBooks, thash, marketId)) {
          case (?book) {
            let cancelled = OrderBook.cancelAllOrders(book);
            for (order in cancelled.vals()) {
              Map.set(orders, thash, order.orderId, order);
              // Refund is implicit — locked balance calculation uses order status
            };
            Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
          };
          case null {};
        };

        Debug.print("Closed market " # marketId # " at deadline");
      };
    };
  };

  // Check deadlines every minute
  ignore Timer.recurringTimer<system>(
    #seconds(60),
    func() : async () { await enforceDeadlines() },
  );

  // ═══════════════════════════════════════════════════════════
  // Resolution Timer (checks Polymarket for resolved markets)
  // ═══════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  // JSON Helpers (for parsing Polymarket API responses)
  // ═══════════════════════════════════════════════════════════

  /// Get a string field from a JSON object
  func jsonGetText(json : Json.Json, key : Text) : Text {
    switch (json) {
      case (#object_(fields)) {
        for ((k, v) in fields.vals()) {
          if (k == key) {
            switch (v) {
              case (#string(s)) return s;
              case _ return "";
            };
          };
        };
        "";
      };
      case _ "";
    };
  };

  /// Get a bool field from a JSON object
  func jsonGetBool(json : Json.Json, key : Text) : Bool {
    switch (json) {
      case (#object_(fields)) {
        for ((k, v) in fields.vals()) {
          if (k == key) {
            switch (v) {
              case (#bool(b)) return b;
              case _ return false;
            };
          };
        };
        false;
      };
      case _ false;
    };
  };

  /// Get an array field from a JSON object
  func jsonGetArray(json : Json.Json, key : Text) : [Json.Json] {
    switch (json) {
      case (#object_(fields)) {
        for ((k, v) in fields.vals()) {
          if (k == key) {
            switch (v) {
              case (#array(arr)) return arr;
              case _ return [];
            };
          };
        };
        [];
      };
      case _ [];
    };
  };

  /// Get an object field from a JSON object
  func jsonGetObject(json : Json.Json, key : Text) : ?Json.Json {
    switch (json) {
      case (#object_(fields)) {
        for ((k, v) in fields.vals()) {
          if (k == key) return ?v;
        };
        null;
      };
      case _ null;
    };
  };

  /// Parse a price string like "0.60" into basis points (6000)
  /// Handles: "0.60", "0.4295", "1", "0", "0.999"
  func parsePriceToBps(text : Text) : Nat {
    // Split on decimal point
    var intPart : Nat = 0;
    var fracPart : Nat = 0;
    var fracDigits : Nat = 0;
    var seenDot = false;

    for (c in text.chars()) {
      if (c == '.') {
        seenDot := true;
      } else if (c >= '0' and c <= '9') {
        let digit = Nat32.toNat(Char.toNat32(c) - 48);
        if (seenDot) {
          fracPart := fracPart * 10 + digit;
          fracDigits += 1;
        } else {
          intPart := intPart * 10 + digit;
        };
      };
    };

    // Convert to basis points (10000 = $1.00)
    // intPart * 10000 + fracPart scaled to 4 decimal places
    var bps = intPart * 10000;
    if (fracDigits > 0) {
      // Scale fracPart to 4 digits
      var scaled = fracPart;
      var digits = fracDigits;
      while (digits < 4) { scaled *= 10; digits += 1 };
      while (digits > 4) { scaled /= 10; digits -= 1 };
      bps += scaled;
    };
    bps;
  };

  /// Parse ISO 8601 date string to nanoseconds
  /// Handles formats like "2026-03-21T15:00:00Z" and "2026-03-21T15:00:00.000Z"
  func parseIsoDateToNanos(isoDate : Text) : Int {
    // Try with Z suffix (most Polymarket dates)
    switch (DateTime.fromText(isoDate, "YYYY-MM-DDTHH:mm:ssZ")) {
      case (?dt) { return dt.toTime() };
      case null {};
    };
    // Try with milliseconds
    switch (DateTime.fromText(isoDate, "YYYY-MM-DDTHH:mm:ss.SSSZ")) {
      case (?dt) { return dt.toTime() };
      case null {};
    };
    // Try without timezone
    switch (DateTime.fromText(isoDate, "YYYY-MM-DDTHH:mm:ss")) {
      case (?dt) { return dt.toTime() };
      case null {};
    };
    Debug.print("Failed to parse date: " # isoDate);
    0;
  };

  // ═══════════════════════════════════════════════════════════
  // HTTP Outcall Helper
  // ═══════════════════════════════════════════════════════════

  func httpGet(url : Text) : async Text {
    let response = await ICCall.httpRequest({
      url;
      method = #get;
      max_response_bytes = ?2_000_000; // 2MB max
      body = null;
      transform = ?{
        function = transformPolymarket;
        context = "";
      };
      headers = [{
        name = "User-Agent";
        value = "FinalScore/2.0";
      }];
      is_replicated = null;
    });

    switch (Text.decodeUtf8(response.body)) {
      case (?text) text;
      case null "";
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Polymarket Sync — Market Discovery (batched)
  // ═══════════════════════════════════════════════════════════

  /// Phase 1: Fetch sport list, build tag map, populate sync queue.
  /// Only whitelisted sports are synced to avoid wasting cycles on 100+ dormant leagues.
  func syncRefreshSportTags() : async () {
    try {
      Debug.print("Refreshing sport tag map...");

      // Whitelist: only sync sports with known active markets
      // Update this list periodically as seasons change
      let whitelist : [Text] = [
        // Football/Soccer — top leagues + cups
        "epl", "lal", "bun", "fl1", "sea", "ere", "mls", "spl", "elc",
        "ucl", "uel", "afc", "lib", "cdr",
        // Cricket
        "cricipl", "ipl", "cricpsl", "crictbcl",
        // US Sports
        "nba", "wnba", "mlb", "nfl", "nhl",
        // Tennis
        "atp", "wta",
        // Esports
        "lol", "cs2", "val", "dota2",
        // Other
        "kbo",
      ];

      let whitelistSet = Map.new<Text, Bool>();
      for (w in whitelist.vals()) {
        Map.set(whitelistSet, thash, w, true);
      };

      let sportsJson = await httpGet("https://gamma-api.polymarket.com/sports");
      let sportsResult = Json.parse(sportsJson);
      let sports = switch (sportsResult) {
        case (#ok(#array(arr))) arr;
        case _ { Debug.print("Failed to parse sports"); return };
      };

      Debug.print("Found " # Nat.toText(sports.size()) # " sports");

      // Build tag frequency map
      let tagFreq = Map.new<Text, Nat>();
      for (s in sports.vals()) {
        let sTags = jsonGetText(s, "tags");
        for (part in Text.split(sTags, #char ',')) {
          let t = Text.trimStart(part, #char ' ');
          if (t != "") {
            let prev = switch (Map.get(tagFreq, thash, t)) { case (?n) n; case null 0 };
            Map.set(tagFreq, thash, t, prev + 1);
          };
        };
      };

      // For each sport, pick the rarest (most specific) tag
      var queue : [Text] = [];
      for (sport in sports.vals()) {
        let sportSlug = jsonGetText(sport, "sport");
        let tags = jsonGetText(sport, "tags");

        var sportTag = "";
        var bestFreq : Nat = 999_999;
        for (part in Text.split(tags, #char ',')) {
          let trimmed = Text.trimStart(part, #char ' ');
          if (trimmed != "" and trimmed != "1") {
            let freq = switch (Map.get(tagFreq, thash, trimmed)) { case (?n) n; case null 0 };
            if (freq < bestFreq) {
              bestFreq := freq;
              sportTag := trimmed;
            };
          };
        };

        if (sportTag != "" and sportTag != "TBD" and sportTag != "test"
            and Map.has(whitelistSet, thash, sportSlug)) {
          Map.set(sportTagMap, thash, sportSlug, sportTag);
          queue := Array.append(queue, [sportSlug]);
        };
      };

      syncQueue := queue;
      Debug.print("Sport tag map built. Queue size: " # Nat.toText(queue.size()));
    } catch (e) {
      Debug.print("Failed to refresh sport tags: " # Error.message(e));
    };
  };

  /// Phase 2: Process up to `batchSize` sports from the queue.
  /// Each sport fetches events with pagination (up to 5 pages of 100).
  func syncBatch(batchSize : Nat) : async () {
    if (syncQueue.size() == 0) return;

    let count = if (batchSize > syncQueue.size()) syncQueue.size() else batchSize;
    let batch = Array.tabulate<Text>(count, func(i) { syncQueue[i] });
    // Remove processed items from front of queue
    syncQueue := Array.tabulate<Text>(
      syncQueue.size() - count,
      func(i) { syncQueue[count + i] },
    );

    var newMarkets = 0;

    for (sportSlug in batch.vals()) {
      let sportTag = switch (Map.get(sportTagMap, thash, sportSlug)) {
        case (?t) t;
        case null { Debug.print("No tag for " # sportSlug); "" };
      };

      if (sportTag != "") {
        try {
          // Fetch up to 20 events per sport (4 pages × 5)
          // Polymarket event JSON is very large (~100KB per event with nested markets)
          var offset = 0;
          let pageLimit = 5;
          let maxPages = 4;
          var page = 0;
          label pagination loop {
            if (page >= maxPages) break pagination;

            let eventsUrl = "https://gamma-api.polymarket.com/events"
              # "?tag_id=" # sportTag
              # "&active=true&closed=false&limit=" # Nat.toText(pageLimit)
              # "&offset=" # Nat.toText(offset);

            let eventsJson = await httpGet(eventsUrl);
            let eventsResult = Json.parse(eventsJson);
            let events = switch (eventsResult) {
              case (#ok(#array(arr))) arr;
              case _ { [] };
            };

            for (event in events.vals()) {
              let slug = jsonGetText(event, "slug");

              if (slug != "" and not Map.has(knownPolySlugs, thash, slug)) {
                let eventTitle = jsonGetText(event, "title");
                let endDateStr = jsonGetText(event, "endDate");
                let eventMarkets = jsonGetArray(event, "markets");

                // Cap markets per event to prevent instruction limit exhaustion
                // Sports matches typically have 3 moneyline markets (Home/Away/Draw)
                let maxMarketsPerEvent = 5;
                var marketIds : [Text] = [];
                var marketsProcessed = 0;

                for (pm in eventMarkets.vals()) {
                  if (marketsProcessed >= maxMarketsPerEvent) {
                    // Skip remaining markets in this event
                  } else {
                  let question = jsonGetText(pm, "question");
                  let conditionId = jsonGetText(pm, "conditionId");
                  let closed = jsonGetBool(pm, "closed");

                  if (not closed and
                      not Text.contains(question, #text "Spread") and
                      not Text.contains(question, #text "O/U") and
                      conditionId != "") {

                    let outcomesStr = jsonGetText(pm, "outcomes");
                    let pricesStr = jsonGetText(pm, "outcomePrices");

                    let pricesResult = Json.parse(pricesStr);
                    let prices = switch (pricesResult) {
                      case (#ok(#array(arr))) arr;
                      case _ { [] };
                    };

                    let yesPrice = if (prices.size() >= 1) {
                      switch (prices[0]) {
                        case (#string(s)) parsePriceToBps(s);
                        case _ 5000;
                      };
                    } else { 5000 };

                    let noPrice = if (prices.size() >= 2) {
                      switch (prices[1]) {
                        case (#string(s)) parsePriceToBps(s);
                        case _ 5000;
                      };
                    } else { 5000 };

                    let tokenIdsStr = jsonGetText(pm, "clobTokenIds");
                    let tokenIdsResult = Json.parse(tokenIdsStr);
                    let tokenIds = switch (tokenIdsResult) {
                      case (#ok(#array(arr))) arr;
                      case _ { [] };
                    };
                    let yesTokenId = if (tokenIds.size() >= 1) {
                      switch (tokenIds[0]) { case (#string(s)) s; case _ "" };
                    } else { "" };
                    let noTokenId = if (tokenIds.size() >= 2) {
                      switch (tokenIds[1]) { case (#string(s)) s; case _ "" };
                    } else { "" };

                    let endDateNanos = parseIsoDateToNanos(endDateStr);
                    let marketId = Nat.toText(nextMarketId);
                    nextMarketId += 1;

                    let deadlineNanos = if (endDateNanos > 300_000_000_000) {
                      endDateNanos - 300_000_000_000;
                    } else { endDateNanos };

                    let market : ToolContext.Market = {
                      marketId;
                      question;
                      eventTitle;
                      sport = sportSlug;
                      marketType = #Moneyline;
                      outcomes = ("Yes", "No");
                      polymarketSlug = slug;
                      polymarketConditionId = conditionId;
                      polymarketTokenIds = (yesTokenId, noTokenId);
                      endDate = endDateNanos;
                      bettingDeadline = deadlineNanos;
                      status = #Open;
                      lastYesPrice = yesPrice;
                      lastNoPrice = noPrice;
                      totalVolume = 0;
                      polymarketYesPrice = yesPrice;
                      polymarketNoPrice = noPrice;
                    };

                    Map.set(markets, thash, marketId, market);
                    Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
                    marketIds := Array.append(marketIds, [marketId]);
                    newMarkets += 1;
                    marketsProcessed += 1;
                  };
                  }; // else (marketsProcessed < max)
                };

                if (marketIds.size() > 0) {
                  Map.set(knownPolySlugs, thash, slug, marketIds);
                };
              };
            };

            if (events.size() < pageLimit) break pagination;
            offset += pageLimit;
            page += 1;
          }; // end pagination loop
        } catch (e) {
          Debug.print("Failed to fetch events for " # sportSlug # ": " # Error.message(e));
        };
      };
    };

    Debug.print("Batch sync: " # Nat.toText(count) # " sports, " # Nat.toText(newMarkets) # " new markets. Queue remaining: " # Nat.toText(syncQueue.size()) # ". Total markets: " # Nat.toText(Map.size(markets)));
  };

  /// Orchestrator: called by timer. Refreshes tags if queue empty, else processes a batch.
  func syncMarketsFromPolymarket() : async () {
    if (syncQueue.size() == 0) {
      // Phase 1 only: refresh sport tags and fill the queue.
      // Don't process any batch in the same call — if the batch traps,
      // it rolls back the queue population too (ICP atomicity).
      await syncRefreshSportTags();
    } else {
      // Phase 2: process one sport from the queue
      await syncBatch(1);
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Polymarket Resolution — Automated Market Settlement
  // ═══════════════════════════════════════════════════════════

  func checkResolutions() : async () {
    let now = Time.now();

    for ((marketId, market) in Map.entries(markets)) {
      // Only check #Closed markets (past deadline, awaiting resolution)
      switch (market.status) {
        case (#Closed) {
          if (market.polymarketSlug != "" and market.polymarketConditionId != "") {
            try {
              let url = "https://gamma-api.polymarket.com/events/slug/"
                # market.polymarketSlug;
              let responseText = await httpGet(url);
              let parsed = Json.parse(responseText);

              switch (parsed) {
                case (#ok(eventJson)) {
                  // Find our specific market by conditionId
                  let pmMarkets = jsonGetArray(eventJson, "markets");

                  for (pm in pmMarkets.vals()) {
                    let condId = jsonGetText(pm, "conditionId");
                    if (condId == market.polymarketConditionId) {
                      let isClosed = jsonGetBool(pm, "closed");

                      if (isClosed) {
                        // Parse final prices to determine winner
                        let pricesStr = jsonGetText(pm, "outcomePrices");
                        let pricesResult = Json.parse(pricesStr);

                        switch (pricesResult) {
                          case (#ok(#array(prices))) {
                            let yesPrice = if (prices.size() >= 1) {
                              switch (prices[0]) {
                                case (#string(s)) parsePriceToBps(s);
                                case _ 5000;
                              };
                            } else { 5000 };

                            let noPrice = if (prices.size() >= 2) {
                              switch (prices[1]) {
                                case (#string(s)) parsePriceToBps(s);
                                case _ 5000;
                              };
                            } else { 5000 };

                            // Winner: price near 10000 ($1.00)
                            // Cancelled/void: both near 5000
                            if (yesPrice > 7500) {
                              // Yes won
                              Debug.print("Auto-resolving market " # marketId # " as Yes (Polymarket resolved)");
                              ignore await admin_resolve_market_internal(marketId, #Yes);
                            } else if (noPrice > 7500) {
                              // No won
                              Debug.print("Auto-resolving market " # marketId # " as No (Polymarket resolved)");
                              ignore await admin_resolve_market_internal(marketId, #No);
                            } else if (yesPrice > 4000 and yesPrice < 6000 and noPrice > 4000 and noPrice < 6000) {
                              // Both near 50% — voided/cancelled
                              Debug.print("Auto-cancelling market " # marketId # " (Polymarket voided)");
                              ignore await admin_cancel_market(marketId);
                            };
                            // else: inconclusive, skip and retry next cycle
                          };
                          case _ {};
                        };
                      };
                    };
                  };
                };
                case (#err(_)) {
                  Debug.print("Failed to parse event JSON for " # market.polymarketSlug);
                };
              };
            } catch (e) {
              Debug.print("Resolution check failed for market " # marketId # ": " # Error.message(e));
            };
          };
        };
        case _ {}; // skip non-Closed markets
      };
    };
  };

  /// Internal resolution (shared by admin and auto-resolution)
  func admin_resolve_market_internal(marketId : Text, winner : ToolContext.Outcome) : async Result.Result<Text, Text> {
    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        // Update status
        Map.set(markets, thash, marketId, { market with status = #Resolved(winner) });

        // Cancel all remaining open orders
        switch (Map.get(orderBooks, thash, marketId)) {
          case (?book) {
            let cancelled = OrderBook.cancelAllOrders(book);
            for (order in cancelled.vals()) {
              Map.set(orders, thash, order.orderId, order);
            };
            Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
          };
          case null {};
        };

        // Process payouts
        let ledger = actor (Principal.toText(tokenLedger)) : actor {
          icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
        };

        var totalPaid : Nat = 0;
        var payoutCount : Nat = 0;

        for ((posId, position) in Map.entries(positions)) {
          if (position.marketId == marketId) {
            let payout = ToolContext.calculatePayout(position, winner);

            if (payout > ToolContext.TRANSFER_FEE) {
              try {
                let result = await ledger.icrc1_transfer({
                  from_subaccount = ?ToolContext.marketSubaccount(marketId);
                  to = { owner = position.user; subaccount = null };
                  amount = payout - ToolContext.TRANSFER_FEE;
                  fee = ?ToolContext.TRANSFER_FEE;
                  memo = null;
                  created_at_time = null;
                });
                switch (result) {
                  case (#Ok(_)) {
                    totalPaid += payout;
                    payoutCount += 1;
                  };
                  case (#Err(err)) {
                    Debug.print("Payout failed for " # posId # ": " # debug_show(err));
                  };
                };
              } catch (e) {
                Debug.print("Payout exception for " # posId # ": " # Error.message(e));
              };
            };

            // Record settlement
            let won = position.outcome == winner;
            ToolContext.recordSettlement(toolContext, position.user, position.costBasis, payout, won);
            ToolContext.addHistoricalPosition(toolContext, position.user, {
              marketId;
              eventTitle = market.eventTitle;
              question = market.question;
              outcome = position.outcome;
              shares = position.shares;
              costBasis = position.costBasis;
              payout;
              resolvedAt = Int.abs(Time.now() / 1_000_000_000);
            });
          };
        };

        #ok("Resolved market " # marketId # ". Paid " # Nat.toText(totalPaid) # " to " # Nat.toText(payoutCount) # " winners.");
      };
      case null #err("Market not found");
    };
  };

  // ═══════════════════════════════════════════════════════════
  // MCP Tool Configuration
  // ═══════════════════════════════════════════════════════════

  transient let resources : [McpTypes.Resource] = [];

  transient let tools : [McpTypes.Tool] = [
    account_get_info.config(),
    account_get_history.config(),
    markets_list.config(),
    market_detail.config(),
    order_place.config(),
    order_cancel.config(),
    orders_list.config(),
    positions_list.config(),
    sports_list.config(),
    leaderboard.config(),
  ];

  transient let toolContext : ToolContext.ToolContext = {
    canisterPrincipal = Principal.fromActor(self);
    owner;
    tokenLedger;
    markets;
    orders;
    trades;
    positions;
    userPositionIds;
    userBalances;
    userStats;
    positionHistory;
    knownPolySlugs;
    var nextMarketId = nextMarketId;
    var nextOrderId = nextOrderId;
    var nextPositionId = nextPositionId;
    var nextTradeId = nextTradeId;
  };

  transient let placeContext : order_place.PlaceContext = {
    toolContext;
    orderBooks;
  };

  transient let cancelContext : order_cancel.CancelContext = {
    toolContext;
    orderBooks;
  };

  transient let detailContext : market_detail.DetailContext = {
    toolContext;
    orderBooks;
  };

  transient let mcpConfig : McpTypes.McpConfig = {
    self = Principal.fromActor(self);
    allowanceUrl = ?allowanceUrl;
    serverInfo = {
      name = "io.github.jneums.final-score";
      title = "Final Score — Sports Prediction Markets";
      version = "2.0.0";
    };
    resources;
    resourceReader = func(uri) {
      Map.get(appContext.resourceContents, thash, uri);
    };
    tools;
    toolImplementations = [
      ("account_get_info", account_get_info.handle(toolContext)),
      ("account_get_history", account_get_history.handle(toolContext)),
      ("markets_list", markets_list.handle(toolContext)),
      ("market_detail", market_detail.handle(detailContext)),
      ("order_place", order_place.handle(placeContext)),
      ("order_cancel", order_cancel.handle(cancelContext)),
      ("orders_list", orders_list.handle(toolContext)),
      ("positions_list", positions_list.handle(toolContext)),
      ("sports_list", sports_list.handle(toolContext)),
      ("leaderboard", leaderboard.handle(toolContext)),
    ];
    beacon = beaconContext;
  };

  transient let mcpServer = Mcp.createServer(mcpConfig);

  // ═══════════════════════════════════════════════════════════
  // Public Entry Points
  // ═══════════════════════════════════════════════════════════

  public query func get_owner() : async Principal { owner };

  public shared ({ caller }) func set_owner(new_owner : Principal) : async Result.Result<(), Payments.TreasuryError> {
    if (caller != owner) { return #err(#NotOwner) };
    owner := new_owner;
    #ok(());
  };

  public shared func get_treasury_balance(ledger_id : Principal) : async Nat {
    await Payments.get_treasury_balance(Principal.fromActor(self), ledger_id);
  };

  public shared ({ caller }) func withdraw(
    ledger_id : Principal,
    amount : Nat,
    destination : Payments.Destination,
  ) : async Result.Result<Nat, Payments.TreasuryError> {
    await Payments.withdraw(caller, owner, ledger_id, amount, destination);
  };

  // ═══════════════════════════════════════════════════════════
  // HTTP Handlers
  // ═══════════════════════════════════════════════════════════

  private func _create_http_context() : HttpHandler.Context {
    {
      self = Principal.fromActor(self);
      active_streams = appContext.activeStreams;
      mcp_server = mcpServer;
      streaming_callback = http_request_streaming_callback;
      auth = authContext;
      http_asset_cache = ?http_assets.cache;
      mcp_path = ?"/mcp";
    };
  };

  public query func http_request(req : SrvTypes.HttpRequest) : async SrvTypes.HttpResponse {
    let ctx = _create_http_context();
    switch (HttpHandler.http_request(ctx, req)) {
      case (?res) res;
      case null {
        if (req.url == "/") {
          {
            status_code = 200;
            headers = [("Content-Type", "text/html")];
            body = Text.encodeUtf8("<h1>Final Score v2 — Sports Prediction Markets</h1>");
            upgrade = null;
            streaming_strategy = null;
          };
        } else {
          {
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

  public shared func http_request_update(req : SrvTypes.HttpRequest) : async SrvTypes.HttpResponse {
    let ctx = _create_http_context();
    switch (await HttpHandler.http_request_update(ctx, req)) {
      case (?res) res;
      case null {
        {
          status_code = 404;
          headers = [];
          body = Blob.fromArray([]);
          upgrade = null;
          streaming_strategy = null;
        };
      };
    };
  };

  public query func http_request_streaming_callback(token : HttpTypes.StreamingToken) : async ?HttpTypes.StreamingCallbackResponse {
    let ctx = _create_http_context();
    HttpHandler.http_request_streaming_callback(ctx, token);
  };

  // ═══════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════

  system func preupgrade() {
    stable_http_assets := HttpAssets.preupgrade(http_assets);
  };

  system func postupgrade() {
    HttpAssets.postupgrade(http_assets);
  };

  // ═══════════════════════════════════════════════════════════
  // API Key Management
  // ═══════════════════════════════════════════════════════════

  public shared (msg) func create_my_api_key(name : Text, scopes : [Text]) : async Text {
    switch (authContext) {
      case null Debug.trap("Authentication is not enabled on this canister.");
      case (?ctx) await ApiKey.create_my_api_key(ctx, msg.caller, name, scopes);
    };
  };

  public shared (msg) func revoke_my_api_key(key_id : Text) : async () {
    switch (authContext) {
      case null Debug.trap("Authentication is not enabled on this canister.");
      case (?ctx) ApiKey.revoke_my_api_key(ctx, msg.caller, key_id);
    };
  };

  public query (msg) func list_my_api_keys() : async [AuthTypes.ApiKeyMetadata] {
    switch (authContext) {
      case null Debug.trap("Authentication is not enabled on this canister.");
      case (?ctx) ApiKey.list_my_api_keys(ctx, msg.caller);
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Upgrade Finished (ICRC-120)
  // ═══════════════════════════════════════════════════════════

  public type UpgradeFinishedResult = {
    #InProgress : Nat;
    #Failed : (Nat, Text);
    #Success : Nat;
  };

  public func icrc120_upgrade_finished() : async UpgradeFinishedResult {
    #Success(Int.abs(Time.now()));
  };

  // ═══════════════════════════════════════════════════════════
  // Admin Functions
  // ═══════════════════════════════════════════════════════════

  /// Get market counts by status
  public query func get_market_count() : async {
    total : Nat;
    open : Nat;
    closed : Nat;
    resolved : Nat;
    cancelled : Nat;
  } {
    var openCount = 0;
    var closedCount = 0;
    var resolvedCount = 0;
    var cancelledCount = 0;

    for ((_, market) in Map.entries(markets)) {
      switch (market.status) {
        case (#Open) openCount += 1;
        case (#Suspended) {};
        case (#Closed) closedCount += 1;
        case (#Resolved(_)) resolvedCount += 1;
        case (#Cancelled) cancelledCount += 1;
      };
    };

    {
      total = Map.size(markets);
      open = openCount;
      closed = closedCount;
      resolved = resolvedCount;
      cancelled = cancelledCount;
    };
  };

  /// Admin: create a market (called by off-chain sync script)
  public shared ({ caller }) func admin_create_market(
    question : Text,
    eventTitle : Text,
    sport : Text,
    polymarketSlug : Text,
    polymarketConditionId : Text,
    endDateSeconds : Int,
    yesPrice : Nat,
    noPrice : Nat,
  ) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    // Dedup: skip if we already have a market with this conditionId
    for ((_, existing) in Map.entries(markets)) {
      if (existing.polymarketConditionId == polymarketConditionId) {
        return #err("Market already exists for conditionId " # polymarketConditionId);
      };
    };

    let marketId = Nat.toText(nextMarketId);
    nextMarketId += 1;

    let endDateNanos = endDateSeconds * 1_000_000_000;
    let deadlineNanos = endDateNanos - 300_000_000_000;

    let market : ToolContext.Market = {
      marketId;
      question;
      eventTitle;
      sport;
      marketType = #Moneyline;
      outcomes = ("Yes", "No");
      polymarketSlug;
      polymarketConditionId;
      polymarketTokenIds = ("", "");
      endDate = endDateNanos;
      bettingDeadline = deadlineNanos;
      status = #Open;
      lastYesPrice = yesPrice;
      lastNoPrice = noPrice;
      totalVolume = 0;
      polymarketYesPrice = yesPrice;
      polymarketNoPrice = noPrice;
    };

    Map.set(markets, thash, marketId, market);
    Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());

    Debug.print("Created market " # marketId # ": " # question);
    #ok(marketId);
  };

  /// Admin: manually resolve a market
  public shared ({ caller }) func admin_resolve_market(
    marketId : Text,
    winnerText : Text,
  ) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    let winner = switch (ToolContext.parseOutcome(winnerText)) {
      case (?o) o;
      case null return #err("Invalid outcome. Use 'yes' or 'no'.");
    };

    await admin_resolve_market_internal(marketId, winner);
  };

  /// Admin: cancel a market and refund all
  public shared ({ caller }) func admin_cancel_market(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        Map.set(markets, thash, marketId, { market with status = #Cancelled });

        // Cancel all orders
        switch (Map.get(orderBooks, thash, marketId)) {
          case (?book) {
            let cancelled = OrderBook.cancelAllOrders(book);
            for (order in cancelled.vals()) {
              Map.set(orders, thash, order.orderId, order);
            };
            Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
          };
          case null {};
        };

        // Refund positions — credit cost basis back
        let ledger = actor (Principal.toText(tokenLedger)) : actor {
          icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
        };

        var refunded : Nat = 0;
        for ((_, position) in Map.entries(positions)) {
          if (position.marketId == marketId and position.costBasis > ToolContext.TRANSFER_FEE) {
            try {
              ignore await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = position.user; subaccount = null };
                amount = position.costBasis - ToolContext.TRANSFER_FEE;
                fee = ?ToolContext.TRANSFER_FEE;
                memo = null;
                created_at_time = null;
              });
              refunded += 1;
            } catch (e) {
              Debug.print("Refund failed: " # Error.message(e));
            };
          };
        };

        #ok("Cancelled market " # marketId # ". Refunded " # Nat.toText(refunded) # " positions.");
      };
      case null #err("Market not found");
    };
  };

  /// Admin: drain stuck funds from a market subaccount
  public shared ({ caller }) func admin_drain_market_subaccount(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    let ledger = actor (Principal.toText(tokenLedger)) : actor {
      icrc1_balance_of : (ICRC2.Account) -> async Nat;
      icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
    };

    let balance = await ledger.icrc1_balance_of(
      ToolContext.getMarketAccount(Principal.fromActor(self), marketId)
    );

    if (balance <= ToolContext.TRANSFER_FEE) {
      return #ok("Subaccount empty or dust (" # Nat.toText(balance) # ")");
    };

    try {
      let result = await ledger.icrc1_transfer({
        from_subaccount = ?ToolContext.marketSubaccount(marketId);
        to = { owner = Principal.fromActor(self); subaccount = null };
        amount = balance - ToolContext.TRANSFER_FEE;
        fee = ?ToolContext.TRANSFER_FEE;
        memo = null;
        created_at_time = null;
      });
      switch (result) {
        case (#Ok(block)) #ok("Drained " # Nat.toText(balance) # " (block: " # debug_show(block) # ")");
        case (#Err(err)) #err("Transfer failed: " # debug_show(err));
      };
    } catch (e) {
      #err("Exception: " # Error.message(e));
    };
  };

  /// Leaderboard by net profit
  public query func get_leaderboard_by_profit(limit : ?Nat) : async [ToolContext.LeaderboardEntry] {
    let maxResults = Option.get(limit, 100);
    var entries : [ToolContext.UserStats] = [];

    for ((_, stats) in Map.entries(userStats)) {
      entries := Array.append(entries, [stats]);
    };

    let sorted = Array.sort(
      entries,
      func(a : ToolContext.UserStats, b : ToolContext.UserStats) : { #less; #equal; #greater } {
        if (a.netProfit > b.netProfit) #less
        else if (a.netProfit < b.netProfit) #greater
        else #equal;
      },
    );

    let topN = if (sorted.size() > maxResults) {
      Array.tabulate<ToolContext.UserStats>(maxResults, func(i) { sorted[i] });
    } else { sorted };

    Array.tabulate<ToolContext.LeaderboardEntry>(
      topN.size(),
      func(i) { { rank = i + 1; stats = topN[i] } },
    );
  };

  /// Get platform stats
  public query func get_platform_stats() : async {
    totalUsers : Nat;
    totalTrades : Nat;
    totalVolume : Nat;
    activeMarkets : Nat;
    resolvedMarkets : Nat;
  } {
    var totalTrades : Nat = 0;
    var totalVolume : Nat = 0;

    for ((_, stats) in Map.entries(userStats)) {
      totalTrades += stats.totalTrades;
      totalVolume += stats.totalVolume;
    };

    var activeCount : Nat = 0;
    var resolvedCount : Nat = 0;

    for ((_, market) in Map.entries(markets)) {
      switch (market.status) {
        case (#Open or #Suspended) activeCount += 1;
        case (#Resolved(_)) resolvedCount += 1;
        case _ {};
      };
    };

    {
      totalUsers = Map.size(userStats);
      totalTrades;
      totalVolume;
      activeMarkets = activeCount;
      resolvedMarkets = resolvedCount;
    };
  };

  /// Debug: get a specific market
  public query func debug_get_market(marketId : Text) : async ?{
    marketId : Text;
    question : Text;
    eventTitle : Text;
    sport : Text;
    status : Text;
    lastYesPrice : Nat;
    lastNoPrice : Nat;
    totalVolume : Nat;
    endDate : Int;
    polymarketSlug : Text;
  } {
    switch (Map.get(markets, thash, marketId)) {
      case (?m) {
        ?{
          marketId = m.marketId;
          question = m.question;
          eventTitle = m.eventTitle;
          sport = m.sport;
          status = ToolContext.marketStatusToText(m.status);
          lastYesPrice = m.lastYesPrice;
          lastNoPrice = m.lastNoPrice;
          totalVolume = m.totalVolume;
          endDate = m.endDate;
          polymarketSlug = m.polymarketSlug;
        };
      };
      case null null;
    };
  };

  /// Admin: manually trigger Polymarket sync (bypasses timer)
  public shared ({ caller }) func admin_trigger_sync() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");
    await syncMarketsFromPolymarket();
    let count = Map.size(markets);
    let remaining = syncQueue.size();
    #ok("Sync step complete. Total markets: " # Nat.toText(count) # ". Queue remaining: " # Nat.toText(remaining) # ". Call again to process more.");
  };

  /// Admin: manually trigger resolution check (bypasses timer)
  public shared ({ caller }) func admin_trigger_resolution_check() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");
    await checkResolutions();
    #ok("Resolution check complete");
  };

  /// Admin: clear all markets and reset sync state (nuclear option for re-sync)
  public shared ({ caller }) func admin_clear_markets() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    // Safety: refuse if any market has orders or positions
    for ((_, market) in Map.entries(markets)) {
      if (market.totalVolume > 0) {
        return #err("Cannot clear: market " # market.marketId # " has volume. Resolve/cancel first.");
      };
    };

    let oldCount = Map.size(markets);
    markets := Map.new<Text, ToolContext.Market>();
    orderBooks := Map.new<Text, OrderBook.Book>();
    knownPolySlugs := Map.new<Text, [Text]>();
    sportTagMap := Map.new<Text, Text>();
    syncQueue := [];
    nextMarketId := 0;

    #ok("Cleared " # Nat.toText(oldCount) # " markets. Ready for re-sync.");
  };

  /// Debug: list markets with optional sport filter, paginated
  public query func debug_list_markets(
    sportFilter : ?Text,
    offset : Nat,
    limit : Nat,
  ) : async {
    total : Nat;
    returned : Nat;
    markets : [{
      marketId : Text;
      question : Text;
      eventTitle : Text;
      sport : Text;
      status : Text;
      yesPrice : Nat;
      noPrice : Nat;
      polymarketSlug : Text;
    }];
  } {
    let maxLimit = if (limit > 100) 100 else if (limit == 0) 20 else limit;
    var all : [{
      marketId : Text;
      question : Text;
      eventTitle : Text;
      sport : Text;
      status : Text;
      yesPrice : Nat;
      noPrice : Nat;
      polymarketSlug : Text;
    }] = [];

    for ((_, m) in Map.entries(markets)) {
      let shouldInclude = switch (sportFilter) {
        case (?s) { m.sport == s };
        case null true;
      };
      if (shouldInclude) {
        all := Array.append(all, [{
          marketId = m.marketId;
          question = m.question;
          eventTitle = m.eventTitle;
          sport = m.sport;
          status = ToolContext.marketStatusToText(m.status);
          yesPrice = m.lastYesPrice;
          noPrice = m.lastNoPrice;
          polymarketSlug = m.polymarketSlug;
        }]);
      };
    };

    let total = all.size();
    let start = if (offset >= total) total else offset;
    let end = if (start + maxLimit > total) total else start + maxLimit;
    let page = if (start >= end) {
      [] : [{
        marketId : Text;
        question : Text;
        eventTitle : Text;
        sport : Text;
        status : Text;
        yesPrice : Nat;
        noPrice : Nat;
        polymarketSlug : Text;
      }];
    } else {
      Array.tabulate<{
        marketId : Text;
        question : Text;
        eventTitle : Text;
        sport : Text;
        status : Text;
        yesPrice : Nat;
        noPrice : Nat;
        polymarketSlug : Text;
      }>(end - start, func(i) { all[start + i] });
    };

    { total; returned = page.size(); markets = page };
  };

  /// Debug: breakdown of synced markets by sport + queue status
  public query func debug_sync_stats() : async {
    totalMarkets : Nat;
    totalSlugs : Nat;
    nextMarketId : Nat;
    syncQueueRemaining : Nat;
    sportTagCount : Nat;
    sportBreakdown : [{ sport : Text; count : Nat }];
  } {
    let sportCounts = Map.new<Text, Nat>();
    for ((_, m) in Map.entries(markets)) {
      let prev = switch (Map.get(sportCounts, thash, m.sport)) { case (?n) n; case null 0 };
      Map.set(sportCounts, thash, m.sport, prev + 1);
    };

    var breakdown : [{ sport : Text; count : Nat }] = [];
    for ((sport, count) in Map.entries(sportCounts)) {
      breakdown := Array.append(breakdown, [{ sport; count }]);
    };

    {
      totalMarkets = Map.size(markets);
      totalSlugs = Map.size(knownPolySlugs);
      nextMarketId;
      syncQueueRemaining = syncQueue.size();
      sportTagCount = Map.size(sportTagMap);
      sportBreakdown = breakdown;
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Timers (must be after all function definitions)
  // ═══════════════════════════════════════════════════════════

  // Market sync is handled off-chain via cron script calling admin_create_market.
  // This avoids ICP instruction limits on JSON parsing of Polymarket responses.

  // Check resolutions every 5 minutes (lightweight — only checks #Closed markets)
  ignore Timer.recurringTimer<system>(
    #seconds(5 * 60),
    func() : async () { await checkResolutions() },
  );
};
