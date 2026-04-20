import Principal "mo:base/Principal";
import Result "mo:base/Result";
import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Json "mo:json";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";
import ICRC2 "mo:icrc2-types";

module ToolContext {

  // ═══════════════════════════════════════════════════════════
  // Constants (fixed)
  // ═══════════════════════════════════════════════════════════

  /// Tick size in basis points (0.01 = 100 bp)
  public let TICK_SIZE : Nat = 100;

  /// Max price in basis points ($0.99)
  public let MAX_PRICE : Nat = 9900;

  /// Min price in basis points ($0.01)
  public let MIN_PRICE : Nat = 100;

  /// Maker fee: 0%
  public let MAKER_FEE_BPS : Nat = 0;

  /// Taker fee: 1%
  public let TAKER_FEE_BPS : Nat = 100;

  /// Protocol rake on winning redemptions: 2%
  public let PROTOCOL_RAKE_BPS : Nat = 200;

  /// Basis points denominator
  public let BPS_DENOM : Nat = 10_000;

  /// Maximum fills per order placement (prevents instruction limit traps)
  public let MAX_FILLS_PER_ORDER : Nat = 10;

  // ═══════════════════════════════════════════════════════════
  // Token-Derived Constants (computed from ledger metadata)
  // ═══════════════════════════════════════════════════════════

  /// Token transfer fee (queried from icrc1_fee)
  public func TRANSFER_FEE(ctx : ToolContext) : Nat { ctx.tokenFee };

  /// Value of one share at resolution (10^decimals = 1 full token unit)
  public func SHARE_VALUE(ctx : ToolContext) : Nat { ctx.shareValue };

  /// Minimum order cost in base units (0.10 of the token = shareValue / 10)
  public func MINIMUM_COST(ctx : ToolContext) : Nat { ctx.shareValue / 10 };

  // ═══════════════════════════════════════════════════════════
  // Core Enums
  // ═══════════════════════════════════════════════════════════

  public type Outcome = {
    #Yes;
    #No;
  };

  public type MarketType = {
    #Moneyline;
    #Spread : Float;
    #Total : Float;
  };

  public type MarketStatus = {
    #Open;
    #Suspended;
    #Closed;
    #Resolved : Outcome;
    #Cancelled;
  };

  public type Side = {
    #Buy;
    #Sell;
  };

  public type OrderStatus = {
    #Open;
    #PartiallyFilled;
    #Filled;
    #Cancelled;
  };

  // ═══════════════════════════════════════════════════════════
  // Data Types
  // ═══════════════════════════════════════════════════════════

  /// A prediction market (binary question, Yes/No)
  public type Market = {
    marketId : Text;
    question : Text;
    eventTitle : Text;
    sport : Text;
    marketType : MarketType;
    outcomes : (Text, Text); // ("Yes", "No") or team names

    // Polymarket reference
    polymarketSlug : Text;
    polymarketConditionId : Text;
    polymarketTokenIds : (Text, Text); // CLOB token IDs for Yes/No

    // Timing
    endDate : Int; // nanoseconds
    bettingDeadline : Int; // endDate - 5 minutes

    // Book state
    status : MarketStatus;
    lastYesPrice : Nat; // basis points 0-10000
    lastNoPrice : Nat;
    totalVolume : Nat; // total USDC matched

    // Reference prices from Polymarket
    polymarketYesPrice : Nat; // basis points
    polymarketNoPrice : Nat;
  };

  /// A limit order in the order book
  public type Order = {
    orderId : Text;
    marketId : Text;
    user : Principal;
    side : Side;
    outcome : Outcome; // Yes or No
    price : Nat; // basis points 100-9900
    size : Nat; // number of shares
    filledSize : Nat; // shares already matched
    status : OrderStatus;
    timestamp : Int;
  };

  /// A user's position in a market (aggregated from fills)
  public type Position = {
    positionId : Text;
    marketId : Text;
    user : Principal;
    outcome : Outcome;
    shares : Nat; // shares held
    costBasis : Nat; // total USDC paid
    averagePrice : Nat; // weighted avg entry in basis points
  };

  /// A settled position in history
  public type HistoricalPosition = {
    marketId : Text;
    eventTitle : Text;
    question : Text;
    outcome : Outcome;
    shares : Nat;
    costBasis : Nat;
    payout : Nat;
    resolvedAt : Nat; // seconds
  };

  /// User statistics for leaderboard
  public type UserStats = {
    userPrincipal : Principal;
    totalTrades : Nat;
    marketsWon : Nat;
    marketsLost : Nat;
    totalVolume : Nat;
    totalPayout : Nat;
    netProfit : Int;
  };

  /// Leaderboard entry
  public type LeaderboardEntry = {
    rank : Nat;
    stats : UserStats;
  };

  /// A matched trade between two orders
  public type Trade = {
    tradeId : Text;
    marketId : Text;
    makerOrderId : Text;
    takerOrderId : Text;
    maker : Principal;
    taker : Principal;
    outcome : Outcome;
    price : Nat; // execution price in basis points
    size : Nat; // shares matched
    timestamp : Int;
  };

  // ═══════════════════════════════════════════════════════════
  // Tool Context — shared state reference for MCP tools
  // ═══════════════════════════════════════════════════════════

  public type ToolContext = {
    canisterPrincipal : Principal;
    owner : Principal;
    tokenLedger : Principal;

    // Token metadata (queried from ledger)
    var tokenDecimals : Nat8;
    var tokenFee : Nat;
    var tokenSymbol : Text;
    var shareValue : Nat; // 10^tokenDecimals

    // Core state maps
    markets : Map.Map<Text, Market>;
    orders : Map.Map<Text, Order>;
    trades : Map.Map<Text, Trade>;
    positions : Map.Map<Text, Position>;
    userPositionIds : Map.Map<Principal, [Text]>;
    userOrderIds : Map.Map<Principal, [Text]>;
    userStats : Map.Map<Principal, UserStats>;
    positionHistory : Map.Map<Principal, [HistoricalPosition]>;

    // Sync tracking
    knownPolySlugs : Map.Map<Text, [Text]>;

    // Counters
    var nextMarketId : Nat;
    var nextOrderId : Nat;
    var nextPositionId : Nat;
    var nextTradeId : Nat;
  };

  /// Authorization result
  public type AuthResult = Result.Result<(), Text>;

  // ═══════════════════════════════════════════════════════════
  // Subaccount Helpers (kept from v1)
  // ═══════════════════════════════════════════════════════════

  /// Generate a 32-byte subaccount for a market
  public func marketSubaccount(marketId : Text) : Blob {
    let subaccount = Array.init<Nat8>(32, 0);
    let marketIdBytes = Blob.toArray(Text.encodeUtf8(marketId));
    let len = if (marketIdBytes.size() < 32) { marketIdBytes.size() } else { 32 };
    var i = 0;
    while (i < len) {
      subaccount[i] := marketIdBytes[i];
      i += 1;
    };
    Blob.fromArray(Array.freeze(subaccount));
  };

  /// Get the ICRC-1 Account for a market's subaccount
  public func getMarketAccount(canisterPrincipal : Principal, marketId : Text) : ICRC2.Account {
    {
      owner = canisterPrincipal;
      subaccount = ?marketSubaccount(marketId);
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Balance Helpers
  // ═══════════════════════════════════════════════════════════

  /// Track an order ID under the user for O(1) lookup
  public func trackUserOrder(context : ToolContext, user : Principal, orderId : Text) {
    let existing = switch (Map.get(context.userOrderIds, Map.phash, user)) {
      case (?ids) ids;
      case null [];
    };
    Map.set(context.userOrderIds, Map.phash, user, Array.append(existing, [orderId]));
  };

  /// Calculate user's locked balance (sum of open order escrow) — O(user's orders) via index
  public func getLockedBalance(context : ToolContext, user : Principal) : Nat {
    let orderIds = switch (Map.get(context.userOrderIds, Map.phash, user)) {
      case (?ids) ids;
      case null return 0;
    };
    var locked : Nat = 0;
    for (orderId in orderIds.vals()) {
      switch (Map.get(context.orders, Map.thash, orderId)) {
        case (?order) {
          if (order.status == #Open or order.status == #PartiallyFilled) {
            let remaining = order.size - order.filledSize;
            locked += (remaining * order.price * SHARE_VALUE(context)) / BPS_DENOM;
          };
        };
        case null {};
      };
    };
    locked;
  };



  // ═══════════════════════════════════════════════════════════
  // Position Helpers
  // ═══════════════════════════════════════════════════════════

  /// Find existing position for user+market+outcome, or return null
  public func findPosition(
    context : ToolContext,
    user : Principal,
    marketId : Text,
    outcome : Outcome,
  ) : ?Position {
    let posIds = switch (Map.get(context.userPositionIds, Map.phash, user)) {
      case (?ids) ids;
      case null return null;
    };
    for (posId in posIds.vals()) {
      switch (Map.get(context.positions, Map.thash, posId)) {
        case (?pos) {
          if (pos.marketId == marketId and pos.outcome == outcome) {
            return ?pos;
          };
        };
        case null {};
      };
    };
    null;
  };

  /// Create or update a position after a fill
  public func upsertPosition(
    context : ToolContext,
    user : Principal,
    marketId : Text,
    outcome : Outcome,
    newShares : Nat,
    cost : Nat,
    _price : Nat,
  ) : Text {
    switch (findPosition(context, user, marketId, outcome)) {
      case (?existing) {
        // Update existing: add shares, add cost, recalculate avg price
        let totalShares = existing.shares + newShares;
        let totalCost = existing.costBasis + cost;
        let avgPrice = if (totalShares > 0) {
          (totalCost * BPS_DENOM) / (totalShares * SHARE_VALUE(context));
        } else { 0 };

        let updated : Position = {
          existing with
          shares = totalShares;
          costBasis = totalCost;
          averagePrice = avgPrice;
        };
        Map.set(context.positions, Map.thash, existing.positionId, updated);
        existing.positionId;
      };
      case null {
        // Create new position
        let posId = Nat.toText(context.nextPositionId);
        context.nextPositionId += 1;

        let avgPrice = if (newShares > 0) {
          (cost * BPS_DENOM) / (newShares * SHARE_VALUE(context));
        } else { 0 };

        let pos : Position = {
          positionId = posId;
          marketId;
          user;
          outcome;
          shares = newShares;
          costBasis = cost;
          averagePrice = avgPrice;
        };
        Map.set(context.positions, Map.thash, posId, pos);

        // Track position ID under user
        let existing = switch (Map.get(context.userPositionIds, Map.phash, user)) {
          case (?ids) ids;
          case null [];
        };
        Map.set(context.userPositionIds, Map.phash, user, Array.append(existing, [posId]));

        posId;
      };
    };
  };

  /// Add a historical position record
  public func addHistoricalPosition(context : ToolContext, user : Principal, entry : HistoricalPosition) {
    let current = switch (Map.get(context.positionHistory, Map.phash, user)) {
      case (?h) h;
      case null [];
    };
    Map.set(context.positionHistory, Map.phash, user, Array.append(current, [entry]));
  };

  /// Check how many Yes+No pairs overlap WITHOUT modifying state
  public func getNetOverlap(context : ToolContext, user : Principal, marketId : Text) : Nat {
    let yesPos = findPosition(context, user, marketId, #Yes);
    let noPos = findPosition(context, user, marketId, #No);
    switch (yesPos, noPos) {
      case (?yes, ?no) Nat.min(yes.shares, no.shares);
      case _ 0;
    };
  };

  /// Net opposing positions: if user holds both Yes and No in the same market,
  /// redeem the overlap (1 Yes + 1 No = $1.00). Returns the number of complete
  /// sets redeemed (0 if no overlap).
  public func netPositions(context : ToolContext, user : Principal, marketId : Text) : Nat {
    let yesPos = findPosition(context, user, marketId, #Yes);
    let noPos = findPosition(context, user, marketId, #No);

    switch (yesPos, noPos) {
      case (?yes, ?no) {
        let overlap = Nat.min(yes.shares, no.shares);
        if (overlap == 0) return 0;

        // Reduce Yes position
        let newYesShares = yes.shares - overlap;
        if (newYesShares == 0) {
          // Remove position entirely
          Map.delete(context.positions, Map.thash, yes.positionId);
          let ids = switch (Map.get(context.userPositionIds, Map.phash, user)) {
            case (?ids) Array.filter<Text>(ids, func(id : Text) : Bool { id != yes.positionId });
            case null [];
          };
          Map.set(context.userPositionIds, Map.phash, user, ids);
        } else {
          let costReduction = (overlap * yes.costBasis) / yes.shares;
          Map.set(context.positions, Map.thash, yes.positionId, {
            yes with
            shares = newYesShares;
            costBasis = yes.costBasis - costReduction;
          });
        };

        // Reduce No position
        let newNoShares = no.shares - overlap;
        if (newNoShares == 0) {
          Map.delete(context.positions, Map.thash, no.positionId);
          let ids = switch (Map.get(context.userPositionIds, Map.phash, user)) {
            case (?ids) Array.filter<Text>(ids, func(id : Text) : Bool { id != no.positionId });
            case null [];
          };
          Map.set(context.userPositionIds, Map.phash, user, ids);
        } else {
          let costReduction = (overlap * no.costBasis) / no.shares;
          Map.set(context.positions, Map.thash, no.positionId, {
            no with
            shares = newNoShares;
            costBasis = no.costBasis - costReduction;
          });
        };

        overlap;
      };
      case _ 0;
    };
  };

  // ═══════════════════════════════════════════════════════════
  // ID Generators
  // ═══════════════════════════════════════════════════════════

  public func getNextMarketId(context : ToolContext) : Text {
    let id = Nat.toText(context.nextMarketId);
    context.nextMarketId += 1;
    id;
  };

  public func getNextOrderId(context : ToolContext) : Text {
    let id = Nat.toText(context.nextOrderId);
    context.nextOrderId += 1;
    id;
  };

  public func getNextTradeId(context : ToolContext) : Text {
    let id = Nat.toText(context.nextTradeId);
    context.nextTradeId += 1;
    id;
  };

  // ═══════════════════════════════════════════════════════════
  // Order Validation
  // ═══════════════════════════════════════════════════════════

  /// Validate a price is a valid tick
  public func isValidPrice(price : Nat) : Bool {
    price >= MIN_PRICE and price <= MAX_PRICE and (price % TICK_SIZE == 0);
  };

  /// Calculate the cost of an order in USDC base units
  public func orderCost(ctx : ToolContext, price : Nat, size : Nat) : Nat {
    (size * price * SHARE_VALUE(ctx)) / BPS_DENOM;
  };

  /// Calculate taker fee for a fill
  public func takerFee(ctx : ToolContext, price : Nat, size : Nat) : Nat {
    let cost = orderCost(ctx, price, size);
    (cost * TAKER_FEE_BPS) / BPS_DENOM;
  };

  // ═══════════════════════════════════════════════════════════
  // Settlement
  // ═══════════════════════════════════════════════════════════

  /// Calculate payout for a position after resolution
  public func calculatePayout(ctx : ToolContext, position : Position, winningOutcome : Outcome) : Nat {
    if (position.outcome == winningOutcome) {
      let gross = position.shares * SHARE_VALUE(ctx);
      let rake = (gross * PROTOCOL_RAKE_BPS) / BPS_DENOM;
      gross - rake;
    } else {
      0;
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Stats
  // ═══════════════════════════════════════════════════════════

  /// Initialize user stats if they don't exist
  public func initUserStats(context : ToolContext, user : Principal) {
    switch (Map.get(context.userStats, Map.phash, user)) {
      case (?_) {};
      case null {
        Map.set(context.userStats, Map.phash, user, {
          userPrincipal = user;
          totalTrades = 0;
          marketsWon = 0;
          marketsLost = 0;
          totalVolume = 0;
          totalPayout = 0;
          netProfit = 0;
        });
      };
    };
  };

  /// Update stats after a trade fill
  public func recordTrade(context : ToolContext, user : Principal, volume : Nat) {
    initUserStats(context, user);
    switch (Map.get(context.userStats, Map.phash, user)) {
      case (?stats) {
        Map.set(context.userStats, Map.phash, user, {
          stats with
          totalTrades = stats.totalTrades + 1;
          totalVolume = stats.totalVolume + volume;
        });
      };
      case null {};
    };
  };

  /// Update stats after market resolution
  public func recordSettlement(
    context : ToolContext,
    user : Principal,
    costBasis : Nat,
    payout : Nat,
    won : Bool,
  ) {
    initUserStats(context, user);
    switch (Map.get(context.userStats, Map.phash, user)) {
      case (?stats) {
        let payoutInt : Int = payout;
        let costInt : Int = costBasis;
        Map.set(context.userStats, Map.phash, user, {
          stats with
          marketsWon = if (won) stats.marketsWon + 1 else stats.marketsWon;
          marketsLost = if (won) stats.marketsLost else stats.marketsLost + 1;
          totalPayout = stats.totalPayout + payout;
          netProfit = stats.netProfit + (payoutInt - costInt);
        });
      };
      case null {};
    };
  };

  // ═══════════════════════════════════════════════════════════
  // Outcome Helpers
  // ═══════════════════════════════════════════════════════════

  public func outcomeToText(outcome : Outcome) : Text {
    switch (outcome) {
      case (#Yes) "Yes";
      case (#No) "No";
    };
  };

  public func parseOutcome(text : Text) : ?Outcome {
    switch (text) {
      case ("yes" or "Yes" or "YES") ?#Yes;
      case ("no" or "No" or "NO") ?#No;
      case _ null;
    };
  };

  public func sideToText(side : Side) : Text {
    switch (side) {
      case (#Buy) "Buy";
      case (#Sell) "Sell";
    };
  };

  public func parseSide(text : Text) : ?Side {
    switch (text) {
      case ("buy" or "Buy" or "BUY") ?#Buy;
      case ("sell" or "Sell" or "SELL") ?#Sell;
      case _ null;
    };
  };

  public func marketStatusToText(status : MarketStatus) : Text {
    switch (status) {
      case (#Open) "Open";
      case (#Suspended) "Suspended";
      case (#Closed) "Closed";
      case (#Resolved(outcome)) "Resolved:" # outcomeToText(outcome);
      case (#Cancelled) "Cancelled";
    };
  };

  public func orderStatusToText(status : OrderStatus) : Text {
    switch (status) {
      case (#Open) "Open";
      case (#PartiallyFilled) "PartiallyFilled";
      case (#Filled) "Filled";
      case (#Cancelled) "Cancelled";
    };
  };

  // ═══════════════════════════════════════════════════════════
  // MCP Response Helpers (kept from v1)
  // ═══════════════════════════════════════════════════════════

  public func makeError(message : Text, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) {
    cb(#ok({ content = [#text({ text = "Error: " # message })]; isError = true; structuredContent = null }));
  };

  public func makeSuccess(structured : Json.Json, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) {
    cb(#ok({ content = [#text({ text = Json.stringify(structured, null) })]; isError = false; structuredContent = ?structured }));
  };
};
