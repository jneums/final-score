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
import Nat8 "mo:base/Nat8";
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

  // Token metadata — initialized on first upgrade/deploy via one-shot timer
  var tokenDecimals : Nat8 = 8; // Default for test faucet
  var tokenFee : Nat = 10_000; // Default for test faucet
  var tokenSymbol : Text = "TICRC1";
  var shareValue : Nat = 100_000_000; // 10^8 for 8 decimals

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
            prices # "\"}";
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

  /// Take a slice of text (start inclusive, up to len chars)
  func textSlice(text : Text, start : Nat, len : Nat) : Text {
    var result = "";
    var i = 0;
    for (c in text.chars()) {
      if (i >= start and i < start + len) {
        result #= Text.fromChar(c);
      };
      i += 1;
    };
    result;
  };

  // Deadline enforcement timer REMOVED — markets stay Open until
  // Polymarket resolves them via try_resolve_market. Natural market
  // dynamics handle post-game pricing (loser goes to ~0, winner ~100).

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
    Debug.print("try_resolve " # marketId # " body_preview=" # textSlice(responseText, 0, 300));
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
            let payout = ToolContext.calculatePayout(toolContext, position, winner);

            if (payout > ToolContext.TRANSFER_FEE(toolContext)) {
              try {
                let result = await ledger.icrc1_transfer({
                  from_subaccount = ?ToolContext.marketSubaccount(marketId);
                  to = { owner = position.user; subaccount = null };
                  amount = payout - ToolContext.TRANSFER_FEE(toolContext);
                  fee = ?ToolContext.TRANSFER_FEE(toolContext);
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
    var tokenDecimals = tokenDecimals;
    var tokenFee = tokenFee;
    var tokenSymbol = tokenSymbol;
    var shareValue = shareValue;
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
    // Refresh token metadata from ledger on every upgrade
    ignore Timer.setTimer<system>(#seconds 0, refreshTokenMetadata);
  };

  /// Query token metadata from the configured ledger and update vars
  func refreshTokenMetadata() : async () {
    try {
      let ledger = actor (Principal.toText(tokenLedger)) : actor {
        icrc1_decimals : () -> async Nat8;
        icrc1_fee : () -> async Nat;
        icrc1_symbol : () -> async Text;
      };
      tokenDecimals := await ledger.icrc1_decimals();
      tokenFee := await ledger.icrc1_fee();
      tokenSymbol := await ledger.icrc1_symbol();
      // Compute shareValue = 10^decimals
      var sv : Nat = 1;
      var i : Nat8 = 0;
      while (i < tokenDecimals) {
        sv *= 10;
        i += 1;
      };
      shareValue := sv;
      // Also update the toolContext (which has its own var copies)
      toolContext.tokenDecimals := tokenDecimals;
      toolContext.tokenFee := tokenFee;
      toolContext.tokenSymbol := tokenSymbol;
      toolContext.shareValue := shareValue;
      debugLog("Token metadata refreshed: symbol=" # tokenSymbol # " decimals=" # Nat.toText(Nat8.toNat(tokenDecimals)) # " fee=" # Nat.toText(tokenFee) # " shareValue=" # Nat.toText(shareValue));
    } catch (e) {
      Debug.print("Failed to refresh token metadata: " # Error.message(e));
    };
  };

  /// Public query: get token configuration (for frontend)
  public query func get_token_info() : async {
    ledger : Text;
    symbol : Text;
    decimals : Nat8;
    fee : Nat;
  } {
    {
      ledger = Principal.toText(tokenLedger);
      symbol = tokenSymbol;
      decimals = tokenDecimals;
      fee = tokenFee;
    };
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

    let cost = ToolContext.orderCost(toolContext, priceBps, size);
    if (cost < ToolContext.MINIMUM_COST(toolContext)) {
      return #err("Order too small. Minimum cost is 0.10 USDC.");
    };

    // Check market exists and is open
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

    let marketAccount = ToolContext.getMarketAccount(Principal.fromActor(self), marketId);

    // ═══════════════════════════════════════════════════════════
    // PRE-FUND: Escrow full order cost into market subaccount
    // This guarantees all resting orders are backed by real funds.
    // ═══════════════════════════════════════════════════════════
    let _escrowOk = try {
      let escrowResult = await ledger.icrc2_transfer_from({
        spender_subaccount = null;
        from = { owner = caller; subaccount = null };
        to = marketAccount;
        amount = cost;
        fee = ?ToolContext.TRANSFER_FEE(toolContext);
        memo = null;
        created_at_time = null;
      });
      switch (escrowResult) {
        case (#Err(err)) {
          return #err("Escrow transfer failed: " # debug_show(err));
        };
        case (#Ok(_)) true;
      };
    } catch (e) {
      return #err("Escrow transfer exception: " # Error.message(e));
    };

    // Funds are now in the market subaccount — order is guaranteed backed
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

    // ═══════════════════════════════════════════════════════════
    // Process fills — funds are ALREADY ESCROWED for both sides
    // No inter-canister calls needed! Pure accounting.
    // ═══════════════════════════════════════════════════════════
    var fillsResult : [{ tradeId : Text; price : Nat; size : Nat }] = [];
    var currentBook = result.updatedBook;
    var actualFilledSize : Nat = 0;

    for (fill in result.fills.vals()) {
      let tradeId = ToolContext.getNextTradeId(toolContext);

      let takerCostPerShare = (order.price * ToolContext.SHARE_VALUE(toolContext)) / ToolContext.BPS_DENOM;
      let takerCost = takerCostPerShare * fill.size;
      let makerCostPerShare = (fill.price * ToolContext.SHARE_VALUE(toolContext)) / ToolContext.BPS_DENOM;
      let makerCost = makerCostPerShare * fill.size;

      // Both sides already have funds in the market subaccount — just commit the fill
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
      ignore ToolContext.upsertPosition(toolContext, fill.taker, marketId, outcome, fill.size, takerCost, order.price);
      let makerOutcome : ToolContext.Outcome = switch (outcome) {
        case (#Yes) #No;
        case (#No) #Yes;
      };
      ignore ToolContext.upsertPosition(toolContext, fill.maker, marketId, makerOutcome, fill.size, makerCost, fill.price);

      ToolContext.recordTrade(toolContext, fill.taker, takerCost);
      ToolContext.recordTrade(toolContext, fill.maker, makerCost);

      // Update maker order status
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

      Map.set(orderBooks, thash, marketId, currentBook);

      fillsResult := Array.append(fillsResult, [{
        tradeId;
        price = fill.price;
        size = fill.size;
      }]);

      actualFilledSize += fill.size;
    };

    // ═══════════════════════════════════════════════════════════
    // Determine final order status and handle unfilled remainder
    // ═══════════════════════════════════════════════════════════
    var finalBook = currentBook;

    let finalOrder = if (actualFilledSize >= order.size) {
      // Fully filled
      let filled = { order with filledSize = order.size; status = #Filled };
      Map.set(toolContext.orders, Map.thash, orderId, filled);
      filled;
    } else if (actualFilledSize > 0) {
      // Partially filled — rest stays on the book (already escrowed)
      let partial = { order with filledSize = actualFilledSize; status = #PartiallyFilled };
      finalBook := OrderBook.insertOrder(finalBook, partial);
      Map.set(toolContext.orders, Map.thash, orderId, partial);
      partial;
    } else {
      // No fills — entire order rests on the book (already escrowed)
      switch (result.remainingOrder) {
        case (?remaining) {
          finalBook := OrderBook.insertOrder(finalBook, remaining);
          Map.set(toolContext.orders, Map.thash, orderId, remaining);
          remaining;
        };
        case null {
          // Matcher said fully consumed but zero fills committed — shouldn't happen with pre-funded
          let rebooked = { order with filledSize = 0; status = #Open };
          finalBook := OrderBook.insertOrder(finalBook, rebooked);
          Map.set(toolContext.orders, Map.thash, orderId, rebooked);
          rebooked;
        };
      };
    };

    Map.set(orderBooks, thash, marketId, finalBook);

    // Update market last price (only if actual fills succeeded)
    if (fillsResult.size() > 0) {
      let lastFill = fillsResult[fillsResult.size() - 1];
      let filledCost = ToolContext.orderCost(toolContext, order.price, actualFilledSize);
      switch (outcome) {
        case (#Yes) {
          let yesPrice = ToolContext.BPS_DENOM - lastFill.price;
          Map.set(markets, thash, marketId, {
            market with lastYesPrice = yesPrice; lastNoPrice = lastFill.price; totalVolume = market.totalVolume + filledCost;
          });
        };
        case (#No) {
          let noPrice = ToolContext.BPS_DENOM - lastFill.price;
          Map.set(markets, thash, marketId, {
            market with lastYesPrice = lastFill.price; lastNoPrice = noPrice; totalVolume = market.totalVolume + filledCost;
          });
        };
      };
    };

    // Net opposing positions (Yes + No overlap → redeem $1.00)
    var nettedUsers = Map.new<Principal, Bool>();
    for (fill in result.fills.vals()) {
      Map.set(nettedUsers, Map.phash, fill.taker, true);
      Map.set(nettedUsers, Map.phash, fill.maker, true);
    };
    for ((user, _) in Map.entries(nettedUsers)) {
      let overlap = ToolContext.getNetOverlap(toolContext, user, marketId);
      if (overlap > 0) {
        let payout = overlap * ToolContext.SHARE_VALUE(toolContext);
        if (payout > ToolContext.TRANSFER_FEE(toolContext)) {
          let refundOk = try {
            let refundResult = await ledger.icrc1_transfer({
              from_subaccount = ?ToolContext.marketSubaccount(marketId);
              to = { owner = user; subaccount = null };
              amount = payout - ToolContext.TRANSFER_FEE(toolContext);
              fee = ?ToolContext.TRANSFER_FEE(toolContext);
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

    // Refund taker's excess escrow if partially filled or unfilled but taker fee was included
    // With pre-funded: taker escrowed full cost at order price. On fills, actual cost may differ.
    // Since there's no taker fee on escrow (just the raw cost), and fills use the taker's price,
    // there's no surplus to refund — the unfilled portion stays escrowed for the resting order.

    #ok({
      orderId;
      status = ToolContext.orderStatusToText(finalOrder.status);
      filled = finalOrder.filledSize;
      remaining = finalOrder.size - finalOrder.filledSize;
      fills = fillsResult;
    });
  };

  /// Cancel an order (authenticated by wallet) — refunds escrowed funds
  public shared (msg) func cancel_order(orderId : Text) : async Result.Result<Text, Text> {
    let caller = msg.caller;
    if (Principal.isAnonymous(caller)) return #err("Authentication required");

    switch (Map.get(toolContext.orders, Map.thash, orderId)) {
      case (?order) {
        if (not Principal.equal(order.user, caller)) return #err("Not your order");
        if (order.status != #Open and order.status != #PartiallyFilled) return #err("Order is not open");

        // Calculate refund: unfilled portion's escrowed cost
        let remaining = order.size - order.filledSize;
        let refundAmount = ToolContext.orderCost(toolContext, order.price, remaining);

        // Refund escrowed funds from market subaccount → user wallet
        if (refundAmount > ToolContext.TRANSFER_FEE(toolContext)) {
          let ledger = actor (Principal.toText(tokenLedger)) : actor {
            icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
            icrc1_balance_of : ({ owner : Principal; subaccount : ?Blob }) -> async Nat;
          };

          // Check subaccount balance first — pre-escrow orders have empty subaccounts
          let subBal = try {
            await ledger.icrc1_balance_of({
              owner = Principal.fromActor(self);
              subaccount = ?ToolContext.marketSubaccount(order.marketId);
            });
          } catch (_e) { 0 };

          // Only attempt refund if subaccount actually has funds
          if (subBal > ToolContext.TRANSFER_FEE(toolContext)) {
            let actualRefund = Nat.min(refundAmount - ToolContext.TRANSFER_FEE(toolContext), subBal - ToolContext.TRANSFER_FEE(toolContext));
            let refundOk = try {
              let result = await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(order.marketId);
                to = { owner = caller; subaccount = null };
                amount = actualRefund;
                fee = ?ToolContext.TRANSFER_FEE(toolContext);
                memo = null;
                created_at_time = null;
              });
              switch (result) {
                case (#Ok(_)) true;
                case (#Err(err)) {
                  Debug.print("Cancel refund failed: " # debug_show(err));
                  false;
                };
              };
            } catch (e) {
              Debug.print("Cancel refund exception: " # Error.message(e));
              false;
            };

            if (not refundOk) {
              return #err("Refund failed — order kept open. Try again later.");
            };
          };
          // else: subaccount empty (pre-escrow order) — skip refund, proceed with cancel
        };

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

  /// Batch requote: cancel all caller's orders in a market and place new ones with delta escrow
  public shared (msg) func requote_market(
    marketId : Text,
    newOrders : [{ outcome : Text; price : Float; size : Nat }],
  ) : async Result.Result<{ cancelled : Nat; placed : Nat; escrowed : Int }, Text> {
    let caller = msg.caller;
    if (Principal.isAnonymous(caller)) return #err("Authentication required");

    // Rate limit: one cooldown check for the batch
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

    // Validate market
    let market = switch (Map.get(markets, thash, marketId)) {
      case (?m) m;
      case null return #err("Market not found: " # marketId);
    };
    switch (market.status) {
      case (#Open) {};
      case _ return #err("Market is not open for trading");
    };

    // Find all caller's Open/PartiallyFilled orders in this market
    let oldOrders = Buffer.Buffer<ToolContext.Order>(8);
    for ((oid, order) in Map.entries(toolContext.orders)) {
      if (order.marketId == marketId and Principal.equal(order.user, caller) and (order.status == #Open or order.status == #PartiallyFilled)) {
        oldOrders.add(order);
      };
    };

    // Calculate old escrow (unfilled portions)
    var oldEscrow : Nat = 0;
    for (order in oldOrders.vals()) {
      let remaining = order.size - order.filledSize;
      oldEscrow += ToolContext.orderCost(toolContext, order.price, remaining);
    };

    // Validate and calculate new escrow
    var newEscrow : Nat = 0;
    for (newOrd in newOrders.vals()) {
      let priceBps : Nat = Int.abs(Float.toInt(newOrd.price * 10000.0));
      if (not ToolContext.isValidPrice(priceBps)) {
        return #err("Invalid price. Must be 0.01 to 0.99 in $0.01 increments.");
      };
      if (newOrd.size == 0) return #err("Size must be at least 1 share");
      let cost = ToolContext.orderCost(toolContext, priceBps, newOrd.size);
      if (cost < ToolContext.MINIMUM_COST(toolContext)) {
        return #err("Order too small. Minimum cost is 0.10 USDC.");
      };
      newEscrow += cost;
    };

    // Calculate delta (as Int to handle negative)
    let newEscrowInt : Int = newEscrow;
    let oldEscrowInt : Int = oldEscrow;
    let delta : Int = newEscrowInt - oldEscrowInt;
    let fee = ToolContext.TRANSFER_FEE(toolContext);

    let ledger = actor (Principal.toText(tokenLedger)) : actor {
      icrc2_transfer_from : (ICRC2.TransferFromArgs) -> async ICRC2.TransferFromResult;
      icrc1_transfer : (ICRC2.TransferArgs) -> async ICRC2.TransferResult;
      icrc1_balance_of : ({ owner : Principal; subaccount : ?Blob }) -> async Nat;
    };

    let marketAccount = ToolContext.getMarketAccount(Principal.fromActor(self), marketId);

    // Handle escrow delta
    if (delta > 0) {
      // Need more funds from caller
      let amount = Int.abs(delta);
      let escrowResult = try {
        await ledger.icrc2_transfer_from({
          spender_subaccount = null;
          from = { owner = caller; subaccount = null };
          to = marketAccount;
          amount;
          fee = ?fee;
          memo = null;
          created_at_time = null;
        });
      } catch (e) {
        return #err("Escrow transfer exception: " # Error.message(e));
      };
      switch (escrowResult) {
        case (#Err(err)) return #err("Escrow transfer failed: " # debug_show(err));
        case (#Ok(_)) {};
      };
    } else if (delta < 0) {
      let refundAmount = Int.abs(delta);
      if (refundAmount > fee) {
        // Check subaccount balance first (pre-escrow safety)
        let subBal = try {
          await ledger.icrc1_balance_of({
            owner = Principal.fromActor(self);
            subaccount = ?ToolContext.marketSubaccount(marketId);
          });
        } catch (_e) { 0 };

        if (subBal > fee) {
          let actualRefund = Nat.min(refundAmount - fee, subBal - fee);
          if (actualRefund > 0) {
            let refundOk = try {
              let result = await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = caller; subaccount = null };
                amount = actualRefund;
                fee = ?fee;
                memo = null;
                created_at_time = null;
              });
              switch (result) {
                case (#Ok(_)) true;
                case (#Err(err)) {
                  Debug.print("Requote refund failed: " # debug_show(err));
                  false;
                };
              };
            } catch (e) {
              Debug.print("Requote refund exception: " # Error.message(e));
              false;
            };
            if (not refundOk) {
              return #err("Refund failed — orders kept. Try again later.");
            };
          };
        };
      };
    };
    // delta == 0 or |delta| <= fee: no transfer needed

    // Cancel all old orders
    var book = switch (Map.get(orderBooks, thash, marketId)) {
      case (?b) b;
      case null OrderBook.emptyBook();
    };
    let cancelledCount = oldOrders.size();
    for (order in oldOrders.vals()) {
      Map.set(toolContext.orders, Map.thash, order.orderId, { order with status = #Cancelled });
      book := OrderBook.removeOrder(book, order.orderId, order.outcome);
    };

    // Place new orders (resting only, no matching)
    var placedCount : Nat = 0;
    for (newOrd in newOrders.vals()) {
      switch (ToolContext.parseOutcome(newOrd.outcome)) {
        case (?outcome) {
          let priceBps : Nat = Int.abs(Float.toInt(newOrd.price * 10000.0));
          let orderId = ToolContext.getNextOrderId(toolContext);
          let order : ToolContext.Order = {
            orderId;
            marketId;
            user = caller;
            side = #Buy;
            outcome;
            price = priceBps;
            size = newOrd.size;
            filledSize = 0;
            status = #Open;
            timestamp = now;
          };
          Map.set(toolContext.orders, Map.thash, orderId, order);
          ToolContext.trackUserOrder(toolContext, caller, orderId);
          book := OrderBook.insertOrder(book, order);
          placedCount += 1;
        };
        case null {
          Debug.print("requote_market: invalid outcome " # newOrd.outcome);
        };
      };
    };

    Map.set(orderBooks, thash, marketId, book);

    #ok({ cancelled = cancelledCount; placed = placedCount; escrowed = delta });
  };

  /// List the caller's orders
  public query (msg) func my_orders(statusFilter : ?Text, marketFilter : ?Text) : async [{
    orderId : Text;
    marketId : Text;
    question : Text;
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
      question : Text;
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
          let question = switch (Map.get(toolContext.markets, Map.thash, order.marketId)) {
            case (?m) m.question;
            case null "Unknown";
          };
          result := Array.append(result, [{
            orderId = order.orderId;
            marketId = order.marketId;
            question = question;
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

  /// Admin: cancel ALL open/partially-filled orders across all markets, empty all books.
  /// Used for migration (e.g., pre-escrow → escrowed orders). No refunds attempted
  /// since pre-escrow orders have empty subaccounts.
  public shared ({ caller }) func admin_cancel_all_orders() : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");

    var cancelledCount = 0;

    // Cancel all open/partially-filled orders
    for ((orderId, order) in Map.entries(toolContext.orders)) {
      switch (order.status) {
        case (#Open or #PartiallyFilled) {
          Map.set(toolContext.orders, Map.thash, orderId, { order with status = #Cancelled });
          cancelledCount += 1;
        };
        case _ {};
      };
    };

    // Empty all order books
    var booksCleared = 0;
    for ((marketId, _book) in Map.entries(orderBooks)) {
      Map.set(orderBooks, thash, marketId, OrderBook.emptyBook());
      booksCleared += 1;
    };

    let msg = "Cancelled " # Nat.toText(cancelledCount) # " orders, cleared " # Nat.toText(booksCleared) # " books";
    Debug.print(msg);
    #ok(msg);
  };

  /// Admin: reopen a Closed market (e.g., premature deadline closure)
  public shared ({ caller }) func admin_reopen_market(marketId : Text) : async Result.Result<Text, Text> {
    if (caller != owner) return #err("Unauthorized: owner only");
    switch (Map.get(markets, thash, marketId)) {
      case (?market) {
        switch (market.status) {
          case (#Closed) {
            Map.set(markets, thash, marketId, { market with status = #Open });
            Debug.print("Reopened market " # marketId);
            #ok("Reopened market " # marketId);
          };
          case _ #err("Market " # marketId # " is not Closed — cannot reopen");
        };
      };
      case null #err("Market not found: " # marketId);
    };
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
          if (position.marketId == marketId and position.costBasis > ToolContext.TRANSFER_FEE(toolContext)) {
            try {
              ignore await ledger.icrc1_transfer({
                from_subaccount = ?ToolContext.marketSubaccount(marketId);
                to = { owner = position.user; subaccount = null };
                amount = position.costBasis - ToolContext.TRANSFER_FEE(toolContext);
                fee = ?ToolContext.TRANSFER_FEE(toolContext);
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

    if (balance <= ToolContext.TRANSFER_FEE(toolContext)) {
      return #ok("Subaccount empty or dust (" # Nat.toText(balance) # ")");
    };

    try {
      let result = await ledger.icrc1_transfer({
        from_subaccount = ?ToolContext.marketSubaccount(marketId);
        to = { owner = Principal.fromActor(self); subaccount = null };
        amount = balance - ToolContext.TRANSFER_FEE(toolContext);
        fee = ?ToolContext.TRANSFER_FEE(toolContext);
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
      if (m.polymarketSlug == polymarketSlug and m.status != #Cancelled) {
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

  /// Debug: list markets with optional sport and status filters, paginated
  public query func debug_list_markets(
    sportFilter : ?Text,
    offset : Nat,
    limit : Nat,
    statusFilter : ?Text,
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
      impliedYesAsk : Nat;
      impliedNoAsk : Nat;
      polymarketSlug : Text;
      endDate : Int;
      totalVolume : Nat;
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
      impliedYesAsk : Nat;
      impliedNoAsk : Nat;
      polymarketSlug : Text;
      endDate : Int;
      totalVolume : Nat;
    }] = [];

    for ((_, m) in Map.entries(markets)) {
      let sportMatch = switch (sportFilter) {
        case (?s) { m.sport == s };
        case null true;
      };
      let statusText = ToolContext.marketStatusToText(m.status);
      let statusMatch = switch (statusFilter) {
        case (?s) { statusText == s or Text.startsWith(statusText, #text s) };
        case null true;
      };
      if (sportMatch and statusMatch) {
        let bp : OrderBook.BestPrices = switch (Map.get(orderBooks, thash, m.marketId)) {
          case (?book) OrderBook.bestPrices(book);
          case null ({
            bestYesBid = 0;
            bestNoBid = 0;
            impliedYesAsk = 10000;
            impliedNoAsk = 10000;
            spread = 0;
          });
        };
        all := Array.append(all, [{
          marketId = m.marketId;
          question = m.question;
          eventTitle = m.eventTitle;
          sport = m.sport;
          status = statusText;
          yesPrice = m.lastYesPrice;
          noPrice = m.lastNoPrice;
          impliedYesAsk = bp.impliedYesAsk;
          impliedNoAsk = bp.impliedNoAsk;
          polymarketSlug = m.polymarketSlug;
          endDate = m.endDate;
          totalVolume = m.totalVolume;
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
        impliedYesAsk : Nat;
        impliedNoAsk : Nat;
        polymarketSlug : Text;
        endDate : Int;
        totalVolume : Nat;
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
        impliedYesAsk : Nat;
        impliedNoAsk : Nat;
        polymarketSlug : Text;
        endDate : Int;
        totalVolume : Nat;
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
  // Debug: All orders for a user (admin only)
  // ═══════════════════════════════════════════════════════════

  public query ({ caller }) func debug_user_orders(userPrincipal : Text) : async [{
    orderId : Text;
    marketId : Text;
    outcome : Text;
    price : Nat;
    size : Nat;
    filledSize : Nat;
    status : Text;
    timestamp : Int;
  }] {
    assert(caller == owner);
    let target = Principal.fromText(userPrincipal);
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
    for ((_, order) in Map.entries(orders)) {
      if (Principal.equal(order.user, target)) {
        result := Array.append(result, [{
          orderId = order.orderId;
          marketId = order.marketId;
          outcome = ToolContext.outcomeToText(order.outcome);
          price = order.price;
          size = order.size;
          filledSize = order.filledSize;
          status = ToolContext.orderStatusToText(order.status);
          timestamp = order.timestamp;
        }]);
      };
    };
    result;
  };

  // ═══════════════════════════════════════════════════════════
  // Debug: All positions (admin only)
  // ═══════════════════════════════════════════════════════════

  public query ({ caller }) func debug_all_positions() : async [{
    positionId : Text;
    user : Text;
    marketId : Text;
    outcome : Text;
    shares : Nat;
    costBasis : Nat;
  }] {
    assert(caller == owner);
    var result : [{
      positionId : Text;
      user : Text;
      marketId : Text;
      outcome : Text;
      shares : Nat;
      costBasis : Nat;
    }] = [];
    for ((_, pos) in Map.entries(positions)) {
      if (pos.shares > 0) {
        result := Array.append(result, [{
          positionId = pos.positionId;
          user = Principal.toText(pos.user);
          marketId = pos.marketId;
          outcome = ToolContext.outcomeToText(pos.outcome);
          shares = pos.shares;
          costBasis = pos.costBasis;
        }]);
      };
    };
    result;
  };

  // ═══════════════════════════════════════════════════════════
  // Timers (must be after all function definitions)
  // ═══════════════════════════════════════════════════════════

  // Market sync and resolution are handled entirely off-chain via the Render service.
  // See services/sync/ — sync loop (30min), resolve loop (15min), maker loop (5min).
};
