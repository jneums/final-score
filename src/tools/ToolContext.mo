import Principal "mo:base/Principal";
import Result "mo:base/Result";
import McpTypes "mo:mcp-motoko-sdk/mcp/Types";
import Map "mo:map/Map";
import Nat "mo:base/Nat";
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
    cb(#ok({ 
      content = [#text({ text = Json.stringify(structured, null) })]; 
      isError = false; 
      structuredContent = ?structured 
    }));
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
}