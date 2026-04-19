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
import Buffer "mo:base/Buffer";

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

  // Debug mode — set to false in production to save cycles
  var debugMode : Bool = false;

  func debugLog(msg : Text) {
    if (debugMode) Debug.print(msg);
  };

  var tokenLedger : Principal = Option.get(
    do ? { args!.tokenLedger! },
    Principal.fromText("3jkp5-oyaaa-aaaaj-azwqa-cai"), // Test faucet ICRC-1 ledger
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
  var userOrderIds = Map.new<Principal, [Text]>();
  var userBalances = Map.new<Principal, Nat>(); // Legacy — kept for stable memory compat
  var userStats = Map.new<Principal, ToolContext.UserStats>();
  var positionHistory = Map.new<Principal, [ToolContext.HistoricalPosition]>();

  // Legacy — kept for stable memory compat (on-chain resolution timer removed)
  var resolutionFailures = Map.new<Text, Nat>();
  var resolutionCursor : Text = "";

  // Rate limiting: 2-second cooldown between orders per user
  var lastOrderTime = Map.new<Principal, Int>();
  let ORDER_COOLDOWN_NS : Int = 2_000_000_000; // 2 seconds in nanoseconds

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
    // Strip Polymarket event JSON to only the fields try_resolve_market needs:
    //   markets[].conditionId, markets[].closed, markets[].outcomePrices
    //
    // IMPORTANT: Uses text scanning instead of Json.parse to stay within the
    // 5B instruction limit. MLB events have 20+ markets × 80+ fields = 100KB+
    // JSON which blows the query instruction budget when parsed via mo:json.
    //
    // Strategy: scan for "conditionId":"...", "closed":true/false, and
    // "outcomePrices":"..." patterns and reconstruct a minimal JSON.
    { response with headers = []; body = stripPolymarketJson(response.body) };
  };

  /// Text-scan extraction of conditionId, closed, outcomePrices from raw JSON.
  /// Avoids full JSON parse to stay within query instruction limits.
  func stripPolymarketJson(body : Blob) : Blob {
    let text = switch (Text.decodeUtf8(body)) {
      case (?t) t;
      case null return body;
    };

    // Find each "conditionId" occurrence and extract nearby closed + outcomePrices
    var result = "{\"markets\":[";
    var first = true;

    // Split on "conditionId":" to find each market's conditionId field
    let segments = Text.split(text, #text "\"conditionId\":\"");
    var segIdx = 0;
    for (seg in segments) {
      if (segIdx > 0) {
        // seg starts right after "conditionId":" — extract until next "
        let cid = extractUntilQuote(seg);

        // Find "closed":true or "closed":false in the surrounding context
        // We need to look in a window around this conditionId
        // The conditionId field might be before or after closed in the JSON object
        // Search backward in the original text or forward in current segment
        let closed = if (textContains(seg, "\"closed\":true")) { true }
                     else { false };

        // Extract outcomePrices — find "outcomePrices":"..." in segment
        let prices = extractField(seg, "outcomePrices");

        if (cid != "") {
          if (not first) { result #= "," };
          first := false;
          result #= "{\"conditionId\":\"" # cid # "\",\"closed\":" #
            (if closed "true" else "false") # ",\"outcomePrices\":\"" #
            escapeQuotes(prices) # "\"}";
        };
      };
      segIdx += 1;
    };
    result #= "]}";
    Text.encodeUtf8(result);
  };

  /// Extract text from start until the next unescaped double-quote
  func extractUntilQuote(text : Text) : Text {
    var result = "";
    var escaped = false;
    for (c in text.chars()) {
      if (escaped) {
        result #= Text.fromChar(c);
        escaped := false;
      } else if (c == '\\') {
        result #= Text.fromChar(c);
        escaped := true;
      } else if (c == '\"') {
        return result;
      } else {
        result #= Text.fromChar(c);
      };
    };
    result;
  };

  /// Extract the string value of a JSON field like "fieldName":"value"
  func extractField(text : Text, fieldName : Text) : Text {
    let needle = "\"" # fieldName # "\":\"";
    let parts = Text.split(text, #text needle);
    var idx = 0;
    for (part in parts) {
      if (idx > 0) {
        return extractUntilQuote(part);
      };
      idx += 1;
    };
    "";
  };

  /// Check if text contains a substring
  func textContains(text : Text, sub : Text) : Bool {
    let parts = Text.split(text, #text sub);
    var count = 0;
    for (_ in parts) { count += 1 };
    count > 1;
  };

  /// Escape double-quotes for JSON string embedding
  func escapeQuotes(text : Text) : Text {
    Text.replace(text, #char '\"', "\\\"");
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
      max_response_bytes = ?500_000; // 500KB max — transform strips to ~3KB
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
        // Football/Soccer — top 5 leagues + UCL
        "epl", "lal", "bun", "fl1", "sea", "ucl",
        // Cricket
        "cricipl", "ipl",
        // US Sports
        "nba", "wnba", "mlb", "nfl", "nhl",
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

  /// Trustless resolution: anyone can call this with a marketId.
  /// The canister makes an HTTP outcall to Polymarket, verifies
  /// closed=true, reads final prices, and resolves/cancels accordingly.
  /// No caller trust required — the canister is the source of truth.
  public func try_resolve_market(marketId : Text) : async Result.Result<Text, Text> {
    let market = switch (Map.get(markets, thash, marketId)) {
      case (?m) m;
      case null return #err("Market not found: " # marketId);
    };

    // Only resolve Open or Closed markets
    switch (market.status) {
      case (#Open or #Closed) {};
      case (#Resolved(_)) return #err("Already resolved");
      case (#Cancelled) return #err("Already cancelled");
      case _ return #err("Market in invalid state");
    };

    if (market.polymarketSlug == "" or market.polymarketConditionId == "") {
      return #err("No Polymarket data for this market");
    };

    // Fetch from Polymarket
    let url = "https://gamma-api.polymarket.com/events/slug/"
      # market.polymarketSlug;
    let responseText = try {
      await httpGet(url);
    } catch (e) {
      return #err("HTTP outcall failed for slug " # market.polymarketSlug # ": " # Error.message(e));
    };
    Debug.print("try_resolve " # marketId # " slug=" # market.polymarketSlug # " response=" # Nat.toText(responseText.size()) # " bytes");
    let parsed = Json.parse(responseText);

    switch (parsed) {
      case (#ok(eventJson)) {
        let pmMarkets = jsonGetArray(eventJson, "markets");
        let cid = market.polymarketConditionId;
        let cidLen = cid.size();
        let isSplitA = Text.endsWith(cid, #text "-a");
        let isSplitB = Text.endsWith(cid, #text "-b");
        let baseCid = if (isSplitA or isSplitB) {
          let chars = Text.toIter(cid);
          var result = "";
          var i = 0;
          for (c in chars) {
            if (i + 2 < cidLen) { result #= Text.fromChar(c) };
            i += 1;
          };
          result;
        } else { cid };

        for (pm in pmMarkets.vals()) {
          let condId = jsonGetText(pm, "conditionId");
          if (condId == baseCid) {
            let isClosed = jsonGetBool(pm, "closed");

            if (not isClosed) {
              return #err("Polymarket not closed yet");
            };

            // Parse final prices
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

                // For split markets: invert for -b
                let effectiveYes = if (isSplitB) { noPrice } else { yesPrice };
                let effectiveNo = if (isSplitB) { yesPrice } else { noPrice };

                let splitTag = if isSplitA "a" else if isSplitB "b" else "none";

                if (effectiveYes > effectiveNo) {
                  Debug.print("Resolving market " # marketId # " as YES (yes=" # Nat.toText(yesPrice) # " no=" # Nat.toText(noPrice) # " split=" # splitTag # ")");
                  return await admin_resolve_market_internal(marketId, #Yes);
                } else if (effectiveNo > effectiveYes) {
                  Debug.print("Resolving market " # marketId # " as NO (yes=" # Nat.toText(yesPrice) # " no=" # Nat.toText(noPrice) # " split=" # splitTag # ")");
                  return await admin_resolve_market_internal(marketId, #No);
                } else {
                  Debug.print("Cancelling market " # marketId # " (equal prices: " # Nat.toText(yesPrice) # ")");
                  return await admin_cancel_market_internal(marketId);
                };
              };
              case _ {
                return #err("Failed to parse outcomePrices");
              };
            };
          };
        };
        return #err("ConditionId not found in Polymarket event (baseCid=" # baseCid # ")");
      };
      case (#err(_)) {
        return #err("Failed to parse Polymarket JSON response");
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

            // Zero out resolved position to prevent unbounded growth in queries
            Map.set(positions, thash, posId, { position with shares = 0; costBasis = 0 });
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
    userOrderIds;
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
    lastOrderTime;
    orderCooldownNs = ORDER_COOLDOWN_NS;
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
  // Direct Candid Trading Endpoints (for frontend wallet auth)
  // ═══════════════════════════════════════════════════════════

  /// Place a limit order (authenticated by wallet — msg.caller is the user)
  public shared (msg) func place_order(
    marketId : Text,
    outcomeText : Text,
    price : Float,
    size : Nat,
  ) : async Result.Result<{
    orderId : Text;
    status : Text;
    filled : Nat;
    remaining : Nat;
    fills : [{ tradeId : Text; price : Nat; size : Nat }];
  }, Text> {
    let caller = msg.caller;
    if (Principal.isAnonymous(caller)) return #err("Authentication required");

    // Rate limit: 2-second cooldown per user
    let now = Time.now();
    switch (Map.get(lastOrderTime, Map.phash, caller)) {
      case (?last) {
        if (now - last < ORDER_COOLDOWN_NS) {
          return #err("Rate limited. Wait 2 seconds between orders.");
        };
      };
      case null {};
    };
    Map.set(lastOrderTime, Map.phash, caller, now);

    let outcome = switch (ToolContext.parseOutcome(outcomeText)) {
      case (?o) o;
      case null return #err("Invalid outcome. Use 'yes' or 'no'.");
    };

    let priceBps : Nat = Int.abs(Float.toInt(price * 10000.0));
    if (not ToolContext.isValidPrice(priceBps)) {
      return #err("Invalid price. Must be 0.01 to 0.99 in $0.01 increments.");
    };

    if (size == 0) return #err("Size must be at least 1 share");

    let cost = ToolContext.orderCost(priceBps, size);
    if (cost < ToolContext.MINIMUM_COST) {
      return #err("Order too small. Minimum cost is 0.10 USDC.");
    };

    // Check market exists and is open (no pre-flight balance/allowance check —
    // icrc2_transfer_from will fail with a descriptive error if insufficient)
    let ledger = actor (Principal.toText(tokenLedger)) : actor {
      icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
      icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
    };

    let market = switch (Map.get(markets, thash, marketId)) {
      case (?m) m;
      case null return #err("Market not found: " # marketId);
    };

    switch (market.status) {
      case (#Open) {};
      case _ return #err("Market is not open for trading");
    };

    let orderId = ToolContext.getNextOrderId(toolContext);

    let order : ToolContext.Order = {
      orderId;
      marketId;
      user = caller;
      side = #Buy;
      outcome;
      price = priceBps;
      size;
      filledSize = 0;
      status = #Open;
      timestamp = now;
    };

    // Track order under user for O(1) locked balance lookup
    ToolContext.trackUserOrder(toolContext, caller, orderId);

    let book = switch (Map.get(orderBooks, thash, marketId)) {
      case (?b) b;
      case null OrderBook.emptyBook();
    };

    let result = OrderBook.matchOrder(book, order);

    // Process fills — pull real tokens from wallets into market subaccount
    // ATOMIC PER-FILL: update book incrementally so trap after fill N is safe
    var fillsResult : [{ tradeId : Text; price : Nat; size : Nat }] = [];
    let marketAccount = ToolContext.getMarketAccount(Principal.fromActor(self), marketId);
    var currentBook = book;

    for (fill in result.fills.vals()) {
      let tradeId = ToolContext.getNextTradeId(toolContext);

      let takerCostPerShare = (order.price * ToolContext.SHARE_VALUE) / ToolContext.BPS_DENOM;
      let takerCost = takerCostPerShare * fill.size;
      let makerCostPerShare = (fill.price * ToolContext.SHARE_VALUE) / ToolContext.BPS_DENOM;
      let makerCost = makerCostPerShare * fill.size;
      let fee = ToolContext.takerFee(order.price, fill.size);

      // Pull taker funds: user wallet → market subaccount
      let takerTotal = takerCost + fee;
      let takerOk = try {
        let takerResult = await ledger.icrc2_transfer_from({
          spender_subaccount = null;
          from = { owner = fill.taker; subaccount = null };
          to = marketAccount;
          amount = takerTotal;
          fee = ?ToolContext.TRANSFER_FEE;
          memo = null;
          created_at_time = null;
        });
        switch (takerResult) {
          case (#Err(err)) {
            Debug.print("Taker transfer failed: " # debug_show(err));
            false;
          };
          case (#Ok(_)) true;
        };
      } catch (e) {
        Debug.print("Taker transfer exception: " # Error.message(e));
        false;
      };

      // Skip this fill entirely if taker transfer failed
      if (not takerOk) {
        // Don't create positions, don't record trade — just skip
        debugLog("Skipping fill — taker transfer failed for order " # order.orderId);
      } else {
        // Pull maker funds: maker wallet → market subaccount
        let makerOk = try {
          let makerResult = await ledger.icrc2_transfer_from({
            spender_subaccount = null;
            from = { owner = fill.maker; subaccount = null };
            to = marketAccount;
            amount = makerCost;
            fee = ?ToolContext.TRANSFER_FEE;
            memo = null;
            created_at_time = null;
          });
          switch (makerResult) {
            case (#Err(err)) {
              Debug.print("Maker transfer failed: " # debug_show(err));
              false;
            };
            case (#Ok(_)) true;
          };
        } catch (e) {
          Debug.print("Maker transfer exception: " # Error.message(e));
          false;
        };

        if (not makerOk) {
          // Refund the taker — maker couldn't pay
          try {
            ignore await ledger.icrc1_transfer({
              from_subaccount = ?ToolContext.marketSubaccount(marketId);
              to = { owner = fill.taker; subaccount = null };
              amount = takerTotal - ToolContext.TRANSFER_FEE;
              fee = ?ToolContext.TRANSFER_FEE;
              memo = null;
              created_at_time = null;
            });
          } catch (e) {
            Debug.print("Taker refund failed: " # Error.message(e));
          };
          // Restore maker's order to the book (it was consumed by matchOrder)
          switch (Map.get(toolContext.orders, Map.thash, fill.makerOrderId)) {
            case (?makerOrder) {
              currentBook := OrderBook.insertOrder(currentBook, makerOrder);
              Map.set(orderBooks, thash, marketId, currentBook);
              debugLog("Restored maker order " # fill.makerOrderId # " to book");
            };
            case null {};
          };
          debugLog("Skipping fill — maker transfer failed, taker refunded");
        } else {
          // Both transfers succeeded — commit the fill
          let trade : ToolContext.Trade = {
            tradeId;
            marketId;
            makerOrderId = fill.makerOrderId;
            takerOrderId = fill.takerOrderId;
            maker = fill.maker;
            taker = fill.taker;
            outcome = fill.outcome;
            price = fill.price;
            size = fill.size;
            timestamp = now;
          };
          Map.set(toolContext.trades, Map.thash, tradeId, trade);

          // Create/update positions
          ignore ToolContext.upsertPosition(toolContext, fill.taker, marketId, outcome, fill.size, takerCost + fee, order.price);
          let makerOutcome : ToolContext.Outcome = switch (outcome) {
            case (#Yes) #No;
            case (#No) #Yes;
          };
          ignore ToolContext.upsertPosition(toolContext, fill.maker, marketId, makerOutcome, fill.size, makerCost, fill.price);

          ToolContext.recordTrade(toolContext, fill.taker, takerCost);
          ToolContext.recordTrade(toolContext, fill.maker, makerCost);

          // ATOMIC: update maker order status immediately
          switch (Map.get(toolContext.orders, Map.thash, fill.makerOrderId)) {
            case (?makerOrder) {
              let newFilled = makerOrder.filledSize + fill.size;
              let newStatus = if (newFilled >= makerOrder.size) #Filled else #PartiallyFilled;
              Map.set(toolContext.orders, Map.thash, fill.makerOrderId, {
                makerOrder with filledSize = newFilled; status = newStatus;
              });
            };
            case null {};
          };

          // ATOMIC: remove consumed maker order from book per-fill
          currentBook := OrderBook.removeOrder(currentBook, fill.makerOrderId, makerOutcome);
          Map.set(orderBooks, thash, marketId, currentBook);

          fillsResult := Array.append(fillsResult, [{
            tradeId;
            price = fill.price;
            size = fill.size;
          }]);
        };
      };
    };

    // Net opposing positions for all users involved in fills
    // 1 Yes + 1 No = 1 complete set → redeem $1.00 from market subaccount
    // SAFETY: check overlap first, transfer, THEN delete positions
    var nettedUsers = Map.new<Principal, Bool>();
    for (fill in result.fills.vals()) {
      Map.set(nettedUsers, Map.phash, fill.taker, true);
      Map.set(nettedUsers, Map.phash, fill.maker, true);
    };
    for ((user, _) in Map.entries(nettedUsers)) {
      let overlap = ToolContext.getNetOverlap(toolContext, user, marketId);
      if (overlap > 0) {
        let payout = overlap * ToolContext.SHARE_VALUE;
        if (payout > ToolContext.TRANSFER_FEE) {
          let refundOk = try {
            let refundResult = await ledger.icrc1_transfer({
              from_subaccount = ?ToolContext.marketSubaccount(marketId);
              to = { owner = user; subaccount = null };
              amount = payout - ToolContext.TRANSFER_FEE;
              fee = ?ToolContext.TRANSFER_FEE;
              memo = null;
              created_at_time = null;
            });
            switch (refundResult) {
              case (#Ok(_)) true;
              case (#Err(_)) false;
            };
          } catch (_e) { false };

          if (refundOk) {
            // Only NOW delete the positions
            ignore ToolContext.netPositions(toolContext, user, marketId);
          } else {
            debugLog("Netting refund failed for " # Principal.toText(user) # " — positions preserved for retry");
          };
        };
      };
    };

    // Insert remainder (if any) into the already-updated book
    var finalBook = currentBook;

    let finalOrder = switch (result.remainingOrder) {
      case (?remaining) {
        finalBook := OrderBook.insertOrder(finalBook, remaining);
        Map.set(toolContext.orders, Map.thash, orderId, remaining);
        remaining;
      };
      case null {
        let filled = { order with filledSize = order.size; status = #Filled };
        Map.set(toolContext.orders, Map.thash, orderId, filled);
        filled;
      };
    };

    Map.set(orderBooks, thash, marketId, finalBook);

    // Update market last price
    if (result.fills.size() > 0) {
      let lastFill = result.fills[result.fills.size() - 1];
      switch (outcome) {
        case (#Yes) {
          let yesPrice = ToolContext.BPS_DENOM - lastFill.price;
          Map.set(markets, thash, marketId, {
            market with lastYesPrice = yesPrice; lastNoPrice = lastFill.price; totalVolume = market.totalVolume + cost;
          });
        };
        case (#No) {
          let noPrice = ToolContext.BPS_DENOM - lastFill.price;
          Map.set(markets, thash, marketId, {
            market with lastYesPrice = lastFill.price; lastNoPrice = noPrice; totalVolume = market.totalVolume + cost;
          });
        };
      };
    };

    #ok({
      orderId;
      status = ToolContext.orderStatusToText(finalOrder.status);
      filled = finalOrder.filledSize;
      remaining = finalOrder.size - finalOrder.filledSize;
      fills = fillsResult;
    });
  };

  /// Cancel an order (authenticated by wallet)
  public shared (msg) func cancel_order(orderId : Text) : async Result.Result<Text, Text> {
    let caller = msg.caller;
    if (Principal.isAnonymous(caller)) return #err("Authentication required");

    switch (Map.get(toolContext.orders, Map.thash, orderId)) {
      case (?order) {
        if (not Principal.equal(order.user, caller)) return #err("Not your order");
        if (order.status != #Open and order.status != #PartiallyFilled) return #err("Order is not open");

        Map.set(toolContext.orders, Map.thash, orderId, { order with status = #Cancelled });

        let book = switch (Map.get(orderBooks, thash, order.marketId)) {
          case (?b) b;
          case null OrderBook.emptyBook();
        };
        Map.set(orderBooks, thash, order.marketId, OrderBook.removeOrder(book, orderId, order.outcome));

        #ok("Order " # orderId # " cancelled");
      };
      case null #err("Order not found: " # orderId);
    };
  };

  /// List the caller's orders
  public query (msg) func my_orders(statusFilter : ?Text, marketFilter : ?Text) : async [{
    orderId : Text;
    marketId : Text;
    outcome : Text;
    price : Nat;
    size : Nat;
    filledSize : Nat;
    status : Text;
    timestamp : Int;
  }] {
    let caller = msg.caller;
    var result : [{
      orderId : Text;
      marketId : Text;
      outcome : Text;
      price : Nat;
      size : Nat;
      filledSize : Nat;
      status : Text;
      timestamp : Int;
    }] = [];

    for ((_, order) in Map.entries(toolContext.orders)) {
      if (Principal.equal(order.user, caller)) {
        let statusText = ToolContext.orderStatusToText(order.status);
        let shouldInclude = switch (statusFilter) {
          case (?f) f == statusText or f == "all";
          case null statusText == "Open" or statusText == "PartiallyFilled";
        };
        let marketMatch = switch (marketFilter) {
          case (?m) order.marketId == m;
          case null true;
        };
        if (shouldInclude and marketMatch) {
          result := Array.append(result, [{
            orderId = order.orderId;
            marketId = order.marketId;
            outcome = ToolContext.outcomeToText(order.outcome);
            price = order.price;
            size = order.size;
            filledSize = order.filledSize;
            status = statusText;
            timestamp = order.timestamp;
          }]);
        };
      };
    };
    result;
  };

  // ═══════════════════════════════════════════════════════════
  // My Positions (Candid query for frontend)
  // ═══════════════════════════════════════════════════════════

  public query (msg) func my_positions(marketFilter : ?Text) : async [{
    positionId : Text;
    marketId : Text;
    question : Text;
    outcome : Text;
    shares : Nat;
    costBasis : Nat;
    averagePrice : Nat;
    currentPrice : Nat;
    marketStatus : Text;
  }] {
    let caller = msg.caller;
    let posIds = switch (Map.get(toolContext.userPositionIds, Map.phash, caller)) {
      case (?ids) ids;
      case null [];
    };

    var result : [{
      positionId : Text;
      marketId : Text;
      question : Text;
      outcome : Text;
      shares : Nat;
      costBasis : Nat;
      averagePrice : Nat;
      currentPrice : Nat;
      marketStatus : Text;
    }] = [];

    for (posId in posIds.vals()) {
      switch (Map.get(toolContext.positions, Map.thash, posId)) {
        case (?pos) {
          let shouldInclude = switch (marketFilter) {
            case (?m) pos.marketId == m;
            case null true;
          };
          if (shouldInclude and pos.shares > 0) {
            let (question, currentPrice, status) = switch (Map.get(toolContext.markets, Map.thash, pos.marketId)) {
              case (?m) {
                let price = switch (pos.outcome) {
                  case (#Yes) m.lastYesPrice;
                  case (#No) m.lastNoPrice;
                };
                (m.question, price, ToolContext.marketStatusToText(m.status));
              };
              case null ("Unknown", 5000, "Unknown");
            };
            result := Array.append(result, [{
              positionId = pos.positionId;
              marketId = pos.marketId;
              question = question;
              outcome = ToolContext.outcomeToText(pos.outcome);
              shares = pos.shares;
              costBasis = pos.costBasis;
              averagePrice = pos.averagePrice;
              currentPrice = currentPrice;
              marketStatus = status;
            }]);
          };
        };
        case null {};
      };
    };
    result;
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
    await admin_cancel_market_internal(marketId);
  };

  /// Internal cancel — no auth check, called by try_resolve_market and admin_cancel_market
  func admin_cancel_market_internal(marketId : Text) : async Result.Result<Text, Text> {

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

    // Only allow draining resolved or cancelled markets
    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        switch (market.status) {
          case (#Resolved(_)) {}; // OK
          case (#Cancelled) {};   // OK
          case _ return #err("Cannot drain active market. Status: " # ToolContext.marketStatusToText(market.status));
        };
      };
      case null {}; // Market not found — allow drain (could be leftover from cleared markets)
    };

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

  /// Get all markets that belong to the same event (share polymarketSlug)
  public query func get_event_markets(polymarketSlug : Text) : async [{
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
  }] {
    var result : [{
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
    }] = [];

    for ((_, m) in Map.entries(markets)) {
      if (m.polymarketSlug == polymarketSlug) {
        result := Array.append(result, [{
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
        }]);
      };
    };
    result;
  };

  /// Admin: manually trigger Polymarket sync (bypasses timer)
  public shared ({ caller }) func admin_trigger_sync() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");
    await syncMarketsFromPolymarket();
    let count = Map.size(markets);
    let remaining = syncQueue.size();
    #ok("Sync step complete. Total markets: " # Nat.toText(count) # ". Queue remaining: " # Nat.toText(remaining) # ". Call again to process more.");
  };


  /// Admin: clear all markets and reset sync state (nuclear option for re-sync)
  /// Admin: delete a specific market (only if it has zero volume and no open orders)
  public shared ({ caller }) func admin_delete_market(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    switch (Map.get(markets, thash, marketId)) {
      case null return #err("Market not found: " # marketId);
      case (?market) {
        if (market.totalVolume > 0) {
          return #err("Cannot delete: market " # marketId # " has volume");
        };
        // Remove market and its order book
        ignore Map.remove(markets, thash, marketId);
        ignore Map.remove(orderBooks, thash, marketId);
        #ok("Deleted market " # marketId);
      };
    };
  };

  public shared ({ caller }) func admin_clear_markets() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    let oldCount = Map.size(markets);
    markets := Map.new<Text, ToolContext.Market>();
    orderBooks := Map.new<Text, OrderBook.Book>();
    knownPolySlugs := Map.new<Text, [Text]>();
    sportTagMap := Map.new<Text, Text>();
    syncQueue := [];
    nextMarketId := 0;

    // Also clear orders, positions, trades since they reference old markets
    orders := Map.new<Text, ToolContext.Order>();
    trades := Map.new<Text, ToolContext.Trade>();
    positions := Map.new<Text, ToolContext.Position>();
    userPositionIds := Map.new<Principal, [Text]>();
    nextOrderId := 0;
    nextTradeId := 0;
    nextPositionId := 0;

    #ok("Cleared " # Nat.toText(oldCount) # " markets + all orders/positions/trades. Ready for re-sync.");
  };

  /// Get all unresolved markets (Open + Closed) with Polymarket data.
  /// Used by the off-chain Render sync service for resolution.
  public query func get_unresolved_markets() : async [{
    marketId : Text;
    polymarketSlug : Text;
    polymarketConditionId : Text;
    status : Text;
  }] {
    var result : [{
      marketId : Text;
      polymarketSlug : Text;
      polymarketConditionId : Text;
      status : Text;
    }] = [];
    for ((_, m) in Map.entries(markets)) {
      switch (m.status) {
        case (#Open or #Closed) {
          if (m.polymarketSlug != "" and m.polymarketConditionId != "") {
            result := Array.append(result, [{
              marketId = m.marketId;
              polymarketSlug = m.polymarketSlug;
              polymarketConditionId = m.polymarketConditionId;
              status = ToolContext.marketStatusToText(m.status);
            }]);
          };
        };
        case _ {};
      };
    };
    result;
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

  /// Admin: create an API key for any principal (for testing / market maker)
  public shared ({ caller }) func admin_create_api_key(
    user : Principal,
    name : Text,
    scopes : [Text],
  ) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");
    switch (authContext) {
      case null #err("Authentication is not enabled on this canister.");
      case (?ctx) {
        let rawKey = await ApiKey.create_my_api_key(ctx, user, name, scopes);
        #ok(rawKey);
      };
    };
  };

  /// Debug: get order book depth for a market
  public query func debug_get_order_book(marketId : Text, maxLevels : Nat) : async {
    yesBids : [{ price : Nat; totalSize : Nat; orderCount : Nat }];
    noBids : [{ price : Nat; totalSize : Nat; orderCount : Nat }];
    bestYesBid : Nat;
    bestNoBid : Nat;
    impliedYesAsk : Nat;
    impliedNoAsk : Nat;
    spread : Nat;
  } {
    let limit = if (maxLevels == 0) 20 else if (maxLevels > 50) 50 else maxLevels;
    switch (Map.get(orderBooks, thash, marketId)) {
      case (?book) {
        let d = OrderBook.depth(book, limit);
        let bp = OrderBook.bestPrices(book);
        {
          yesBids = Array.map<OrderBook.DepthLevel, { price : Nat; totalSize : Nat; orderCount : Nat }>(
            d.yesBids, func(l : OrderBook.DepthLevel) : { price : Nat; totalSize : Nat; orderCount : Nat } {
              { price = l.price; totalSize = l.totalSize; orderCount = l.orderCount }
            }
          );
          noBids = Array.map<OrderBook.DepthLevel, { price : Nat; totalSize : Nat; orderCount : Nat }>(
            d.noBids, func(l : OrderBook.DepthLevel) : { price : Nat; totalSize : Nat; orderCount : Nat } {
              { price = l.price; totalSize = l.totalSize; orderCount = l.orderCount }
            }
          );
          bestYesBid = bp.bestYesBid;
          bestNoBid = bp.bestNoBid;
          impliedYesAsk = bp.impliedYesAsk;
          impliedNoAsk = bp.impliedNoAsk;
          spread = bp.spread;
        };
      };
      case null {
        {
          yesBids = [];
          noBids = [];
          bestYesBid = 0;
          bestNoBid = 0;
          impliedYesAsk = 10000;
          impliedNoAsk = 10000;
          spread = 10000;
        };
      };
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Timers (must be after all function definitions)
  // ═══════════════════════════════════════════════════════════

  // Market sync and resolution are handled entirely off-chain via the Render service.
  // See services/sync/ — sync loop (30min), resolve loop (15min), maker loop (5min).
};
