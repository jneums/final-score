import Principal "mo:base/Principal";
import Result "mo:base/Result";
import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
import Int "mo:base/Int";
import Float "mo:base/Float";
import Array "mo:base/Array";
import Json "mo:json";

module ToolContext {
  /// Prediction outcome enum
  public type Outcome = {
    #HomeWin;
    #AwayWin;
    #Draw;
  };

  /// Market status
  public type MarketStatus = {
    #Open;
    #Closed;
    #Resolved : Outcome;
  };

  /// A user's position in a market
  public type Position = {
    positionId : Text;
    marketId : Text;
    userPrincipal : Principal;
    outcome : Outcome;
    amount : Nat;
    timestamp : Int;
    claimed : Bool;
  };

  /// A historical (settled) position
  public type HistoricalPosition = {
    marketId : Text;
    homeTeam : Text;
    awayTeam : Text;
    betOutcome : Outcome;
    betAmount : Nat;
    actualOutcome : Outcome;
    payout : Nat;
    resolvedAt : Nat;
  };

  /// User statistics for leaderboard
  public type UserStats = {
    userPrincipal : Principal;
    totalPredictions : Nat;
    correctPredictions : Nat;
    incorrectPredictions : Nat;
    totalWagered : Nat;
    totalWon : Nat;
    netProfit : Int;
    currentStreak : Int; // Positive for wins, negative for losses
    longestWinStreak : Nat;
    averageOdds : Float;
  };

  /// Leaderboard entry combining stats with rank
  public type LeaderboardEntry = {
    rank : Nat;
    stats : UserStats;
  };

  /// A prediction market
  public type Market = {
    marketId : Text;
    matchDetails : Text;
    homeTeam : Text;
    awayTeam : Text;
    kickoffTime : Int;
    bettingDeadline : Int;
    status : MarketStatus;
    homeWinPool : Nat;
    awayWinPool : Nat;
    drawPool : Nat;
    totalPool : Nat;
    oracleMatchId : Text;
    apiFootballId : ?Text; // API Football fixture ID for fetching odds and live data (nullable for backward compatibility)
  };

  /// Virtual account balance for a user
  public type VirtualBalance = Nat;

  /// Context shared between tools and the main canister
  public type ToolContext = {
    /// The principal of the canister
    canisterPrincipal : Principal;
    /// The owner of the canister
    owner : Principal;
    /// Football Oracle canister ID
    footballOracleId : Principal;
    /// ICRC token ledger for payments (e.g., USDC)
    tokenLedger : Principal;
    /// State references
    markets : Map.Map<Text, Market>;
    userBalances : Map.Map<Principal, VirtualBalance>;
    userPositions : Map.Map<Principal, [Position]>;
    positionHistory : Map.Map<Principal, [HistoricalPosition]>;
    userStats : Map.Map<Principal, UserStats>;
    var nextMarketId : Nat;
    var nextPositionId : Nat;
  };

  /// Authorization result
  public type AuthResult = Result.Result<(), Text>;

  /// Check if user has sufficient balance
  public func checkBalance(context : ToolContext, user : Principal, amount : Nat) : Bool {
    switch (Map.get(context.userBalances, Map.phash, user)) {
      case (?balance) { balance >= amount };
      case (null) { false };
    };
  };

  /// Get user balance
  public func getUserBalance(context : ToolContext, user : Principal) : Nat {
    switch (Map.get(context.userBalances, Map.phash, user)) {
      case (?balance) { balance };
      case (null) { 0 };
    };
  };

  /// Debit user balance
  public func debitBalance(context : ToolContext, user : Principal, amount : Nat) : Bool {
    let currentBalance = getUserBalance(context, user);
    if (currentBalance >= amount) {
      let newBalance = Nat.sub(currentBalance, amount);
      Map.set(context.userBalances, Map.phash, user, newBalance);
      true;
    } else {
      false;
    };
  };

  /// Credit user balance
  public func creditBalance(context : ToolContext, user : Principal, amount : Nat) {
    let currentBalance = getUserBalance(context, user);
    let newBalance = currentBalance + amount;
    Map.set(context.userBalances, Map.phash, user, newBalance);
  };

  /// Add a position for a user
  public func addUserPosition(context : ToolContext, user : Principal, position : Position) {
    let currentPositions = switch (Map.get(context.userPositions, Map.phash, user)) {
      case (?positions) { positions };
      case (null) { [] };
    };
    let newPositions = Array.append(currentPositions, [position]);
    Map.set(context.userPositions, Map.phash, user, newPositions);
  };

  /// Get user positions
  public func getUserPositions(context : ToolContext, user : Principal) : [Position] {
    switch (Map.get(context.userPositions, Map.phash, user)) {
      case (?positions) { positions };
      case (null) { [] };
    };
  };

  /// Update user positions (e.g., mark as claimed)
  public func updateUserPositions(context : ToolContext, user : Principal, updatedPositions : [Position]) {
    Map.set(context.userPositions, Map.phash, user, updatedPositions);
  };

  /// Add a historical position
  public func addHistoricalPosition(context : ToolContext, user : Principal, entry : HistoricalPosition) {
    let currentHistory = switch (Map.get(context.positionHistory, Map.phash, user)) {
      case (?history) { history };
      case (null) { [] };
    };
    let newHistory = Array.append(currentHistory, [entry]);
    Map.set(context.positionHistory, Map.phash, user, newHistory);
  };

  /// Generate next market ID
  public func getNextMarketId(context : ToolContext) : Text {
    let id = Nat.toText(context.nextMarketId);
    context.nextMarketId := context.nextMarketId + 1;
    id;
  };

  /// Generate next position ID
  public func getNextPositionId(context : ToolContext) : Text {
    let id = Nat.toText(context.nextPositionId);
    context.nextPositionId := context.nextPositionId + 1;
    id;
  };

  /// Helper function to create an error response
  public func makeError(message : Text, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) {
    cb(#ok({ content = [#text({ text = "Error: " # message })]; isError = true; structuredContent = null }));
  };

  /// Helper function to create a success response
  public func makeSuccess(structured : Json.Json, cb : (Result.Result<McpTypes.CallToolResult, McpTypes.HandlerError>) -> ()) {
    cb(#ok({ content = [#text({ text = Json.stringify(structured, null) })]; isError = false; structuredContent = ?structured }));
  };

  /// Convert Outcome to text
  public func outcomeToText(outcome : Outcome) : Text {
    switch (outcome) {
      case (#HomeWin) { "HomeWin" };
      case (#AwayWin) { "AwayWin" };
      case (#Draw) { "Draw" };
    };
  };

  /// Parse text to Outcome
  public func parseOutcome(text : Text) : ?Outcome {
    switch (text) {
      case ("HomeWin") { ?#HomeWin };
      case ("AwayWin") { ?#AwayWin };
      case ("Draw") { ?#Draw };
      case (_) { null };
    };
  };

  /// Initialize user stats if they don't exist
  public func initializeUserStats(context : ToolContext, user : Principal) {
    switch (Map.get(context.userStats, Map.phash, user)) {
      case (?_) {}; // Already initialized
      case (null) {
        let newStats : UserStats = {
          userPrincipal = user;
          totalPredictions = 0;
          correctPredictions = 0;
          incorrectPredictions = 0;
          totalWagered = 0;
          totalWon = 0;
          netProfit = 0;
          currentStreak = 0;
          longestWinStreak = 0;
          averageOdds = 0.0;
        };
        Map.set(context.userStats, Map.phash, user, newStats);
      };
    };
  };

  /// Update stats after a prediction is settled
  public func updateUserStatsAfterSettlement(
    context : ToolContext,
    user : Principal,
    wagered : Nat,
    won : Nat,
    wasCorrect : Bool,
  ) {
    initializeUserStats(context, user);

    let currentStats = switch (Map.get(context.userStats, Map.phash, user)) {
      case (?stats) { stats };
      case (null) { return }; // Should never happen after init
    };

    // Convert Nat to Int before arithmetic to avoid underflow
    let wonInt : Int = won;
    let wageredInt : Int = wagered;
    let newNetProfit = currentStats.netProfit + (wonInt - wageredInt);

    let newCurrentStreak = if (wasCorrect) {
      if (currentStats.currentStreak >= 0) {
        currentStats.currentStreak + 1;
      } else {
        1; // Reset to positive streak
      };
    } else {
      if (currentStats.currentStreak <= 0) {
        currentStats.currentStreak - 1;
      } else {
        -1; // Reset to negative streak
      };
    };

    let newLongestWinStreak = if (wasCorrect and newCurrentStreak > Int.abs(currentStats.longestWinStreak)) {
      Int.abs(newCurrentStreak);
    } else {
      currentStats.longestWinStreak;
    };

    let updatedStats : UserStats = {
      userPrincipal = user;
      totalPredictions = currentStats.totalPredictions + 1;
      correctPredictions = if (wasCorrect) currentStats.correctPredictions + 1 else currentStats.correctPredictions;
      incorrectPredictions = if (wasCorrect) currentStats.incorrectPredictions else currentStats.incorrectPredictions + 1;
      totalWagered = currentStats.totalWagered + wagered;
      totalWon = currentStats.totalWon + won;
      netProfit = newNetProfit;
      currentStreak = newCurrentStreak;
      longestWinStreak = newLongestWinStreak;
      averageOdds = currentStats.averageOdds; // Will calculate later if needed
    };

    Map.set(context.userStats, Map.phash, user, updatedStats);
  };

  /// Get user stats (returns initialized empty stats if user doesn't exist)
  public func getUserStats(context : ToolContext, user : Principal) : UserStats {
    initializeUserStats(context, user);
    switch (Map.get(context.userStats, Map.phash, user)) {
      case (?stats) { stats };
      case (null) {
        // Should never happen after init
        {
          userPrincipal = user;
          totalPredictions = 0;
          correctPredictions = 0;
          incorrectPredictions = 0;
          totalWagered = 0;
          totalWon = 0;
          netProfit = 0;
          currentStreak = 0;
          longestWinStreak = 0;
          averageOdds = 0.0;
        };
      };
    };
  };
};
