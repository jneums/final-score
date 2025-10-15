// This is a generated Motoko binding.
// Please use `import service "ic:canister_id"` instead to call canisters on the IC if possible.

module {
  public type Action = {
    aSync : ?Nat;
    actionType : Text;
    params : Blob;
    retries : Nat;
  };
  public type ActionDetail = (ActionId, Action);
  public type ActionId = { id : Nat; time : Time };
  public type ApiSource = { url : Text; provider : Text; timestamp : Nat };
  public type ArchivedTransactionResponse = {
    args : [TransactionRange];
    callback : GetTransactionsFn;
  };
  public type BlockType = { url : Text; block_type : Text };
  public type DataCertificate = { certificate : Blob; hash_tree : Blob };
  public type EventData = {
    #MatchScheduled : { homeTeam : Text; scheduledTime : Nat; awayTeam : Text };
    #MatchCancelled : { homeTeam : Text; awayTeam : Text; reason : Text };
    #MatchInProgress : {
      homeTeam : Text;
      minute : ?Nat;
      homeScore : Nat;
      awayTeam : Text;
      awayScore : Nat;
    };
    #MatchFinal : {
      homeTeam : Text;
      homeScore : Nat;
      awayTeam : Text;
      awayScore : Nat;
      outcome : MatchOutcome;
    };
  };
  public type EventType = {
    #MatchScheduled;
    #MatchCancelled;
    #MatchInProgress;
    #MatchFinal;
  };
  public type EventsResult = {
    #Ok : [OracleEvent];
    #Error : { #MatchNotFound };
  };
  public type FetchMatchDataRequest = { oracleId : Nat };
  public type FetchResult = {
    #Ok : Nat;
    #Error : {
      #ConsensusFailure : Text;
      #Generic : Text;
      #Unauthorized;
      #ApiError : Text;
      #MatchNotFound;
    };
  };
  public type GetArchivesArgs = { from : ?Principal };
  public type GetArchivesResult = [GetArchivesResultItem];
  public type GetArchivesResultItem = {
    end : Nat;
    canister_id : Principal;
    start : Nat;
  };
  public type GetBlocksArgs = [TransactionRange];
  public type GetBlocksResult = {
    log_length : Nat;
    blocks : [{ id : Nat; block : Value }];
    archived_blocks : [ArchivedTransactionResponse];
  };
  public type GetScheduledMatchesRequest = {
    startTime : ?Nat;
    status : ?Text;
    endTime : ?Nat;
    offset : ?Nat;
    limit : ?Nat;
    league : ?Text;
  };
  public type GetTransactionsFn = shared query [
    TransactionRange
  ] -> async GetTransactionsResult;
  public type GetTransactionsResult = {
    log_length : Nat;
    blocks : [{ id : Nat; block : Value }];
    archived_blocks : [ArchivedTransactionResponse];
  };
  public type HttpHeader = { value : Text; name : Text };
  public type HttpResponse = {
    status : Nat;
    body : Blob;
    headers : [HttpHeader];
  };
  public type InitArgList = {
    nextCycleActionId : ?Nat;
    maxExecutions : ?Nat;
    nextActionId : Nat;
    lastActionIdReported : ?Nat;
    lastCycleReport : ?Nat;
    initialTimers : [(ActionId, Action)];
    expectedExecutionTime : Time;
    lastExecutionTime : Time;
  };
  public type InitArgs = {
    admin : ?Principal;
    football_data_key : Text;
    thesportsdb_key : Text;
    api_football_key : Text;
  };
  public type MatchOutcome = { #HomeWin; #Draw; #AwayWin };
  public type MatchRecord = {
    status : MatchStatus;
    apiFootballId : Text;
    lastUpdated : Nat;
    oracleId : Nat;
    events : [OracleEvent];
  };
  public type MatchStatus = { #Final; #Scheduled; #Cancelled; #InProgress };
  public type OracleEvent = {
    oracleId : Nat;
    sourceConsensus : [ApiSource];
    timestamp : Nat;
    eventData : EventData;
    eventType : EventType;
  };
  public type ScheduleMatchRequest = {
    apiFootballId : Text;
    homeTeam : Text;
    scheduledTime : Nat;
    league : Text;
    awayTeam : Text;
  };
  public type ScheduleResult = {
    #Ok : Nat;
    #Error : { #Generic : Text; #Unauthorized; #InvalidTime };
  };
  public type ScheduledMatchInfo = {
    status : Text;
    apiFootballId : Text;
    homeTeam : Text;
    scheduledTime : Nat;
    oracleId : Nat;
    latestEvent : ?OracleEvent;
    league : Text;
    awayTeam : Text;
  };
  public type SetApiKeyResult = { #Ok; #Error : { #Unauthorized } };
  public type SetLeaguesResult = { #Ok; #Error : { #Unauthorized } };
  public type SetMonitoredLeaguesRequest = { leagueIds : [Nat] };
  public type StartDiscoveryResult = {
    #Ok;
    #Error : { #Unauthorized; #AlreadyRunning };
  };
  public type Stats = {
    tt : Stats__1;
    log : [Text];
    totalMatches : Nat;
    icrc85 : {
      activeActions : Nat;
      nextCycleActionId : ?Nat;
      lastActionReported : ?Nat;
    };
    totalEvents : Nat;
  };
  public type Stats__1 = {
    timers : Nat;
    maxExecutions : Nat;
    minAction : ?ActionDetail;
    cycles : Nat;
    nextActionId : Nat;
    nextTimer : ?TimerId;
    expectedExecutionTime : ?Time;
    lastExecutionTime : Time;
  };
  public type Time = Nat;
  public type TimerId = Nat;
  public type Tip = {
    last_block_index : Blob;
    hash_tree : Blob;
    last_block_hash : Blob;
  };
  public type TransactionRange = { start : Nat; length : Nat };
  public type Value = {
    #Int : Int;
    #Map : [(Text, Value)];
    #Nat : Nat;
    #Blob : Blob;
    #Text : Text;
    #Array : [Value];
  };
  public type Self = actor {
    add_league : shared Nat -> async SetLeaguesResult;
    fetch_match_data : shared FetchMatchDataRequest -> async FetchResult;
    get_latest_event : shared query Nat -> async ?OracleEvent;
    get_match_events : shared query Nat -> async EventsResult;
    get_match_record : shared query Nat -> async ?MatchRecord;
    get_monitored_leagues : shared query () -> async [Nat];
    get_scheduled_matches : shared query () -> async [ScheduledMatchInfo];
    get_stats : shared query () -> async Stats;
    get_tip : shared query () -> async Tip;
    icrc3_get_archives : shared query GetArchivesArgs -> async GetArchivesResult;
    icrc3_get_blocks : shared query GetBlocksArgs -> async GetBlocksResult;
    icrc3_get_tip_certificate : shared query () -> async ?DataCertificate;
    icrc3_supported_block_types : shared query () -> async [BlockType];
    query_scheduled_matches : shared query GetScheduledMatchesRequest -> async [
      ScheduledMatchInfo
    ];
    remove_league : shared Nat -> async SetLeaguesResult;
    schedule_match : shared ScheduleMatchRequest -> async ScheduleResult;
    set_api_key : shared (Text, Text) -> async SetApiKeyResult;
    set_monitored_leagues : shared SetMonitoredLeaguesRequest -> async SetLeaguesResult;
    start_discovery_timer : shared () -> async StartDiscoveryResult;
    transform : shared query {
      context : Blob;
      response : HttpResponse;
    } -> async HttpResponse;
    trigger_discovery : shared () -> async ();
    trigger_discovery_for_league : shared Nat -> async ();
  };
};
