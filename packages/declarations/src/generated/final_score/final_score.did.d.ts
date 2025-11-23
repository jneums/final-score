import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface ApiKeyInfo {
  'created' : Time,
  'principal' : Principal,
  'scopes' : Array<string>,
  'name' : string,
}
export interface ApiKeyMetadata {
  'info' : ApiKeyInfo,
  'hashed_key' : HashedApiKey,
}
export interface Destination {
  'owner' : Principal,
  'subaccount' : [] | [Subaccount],
}
export type HashedApiKey = string;
export type Header = [string, string];
export interface HttpHeader { 'value' : string, 'name' : string }
export interface HttpRequest {
  'url' : string,
  'method' : string,
  'body' : Uint8Array | number[],
  'headers' : Array<Header>,
  'certificate_version' : [] | [number],
}
export interface HttpRequestResult {
  'status' : bigint,
  'body' : Uint8Array | number[],
  'headers' : Array<HttpHeader>,
}
export interface HttpResponse {
  'body' : Uint8Array | number[],
  'headers' : Array<Header>,
  'upgrade' : [] | [boolean],
  'streaming_strategy' : [] | [StreamingStrategy],
  'status_code' : number,
}
export interface LeaderboardEntry { 'rank' : bigint, 'stats' : UserStats }
export interface Market {
  'status' : MarketStatus,
  'homeTeam' : string,
  'matchDetails' : string,
  'drawPool' : bigint,
  'totalPool' : bigint,
  'marketId' : string,
  'oracleMatchId' : string,
  'awayTeam' : string,
  'homeWinPool' : bigint,
  'bettingDeadline' : bigint,
  'awayWinPool' : bigint,
  'kickoffTime' : bigint,
}
export type MarketStatus = { 'Open' : null } |
  { 'Closed' : null } |
  { 'Resolved' : Outcome };
export interface McpServer {
  'admin_cancel_and_refund_market' : ActorMethod<[string], Result_3>,
  'admin_clear_processed_event' : ActorMethod<[bigint], Result_3>,
  'admin_delete_market' : ActorMethod<[string], Result_3>,
  'admin_rebuild_stats_from_history' : ActorMethod<[], Result_3>,
  'admin_revert_market_to_open' : ActorMethod<[string], Result_3>,
  'admin_seed_test_data' : ActorMethod<[], Result_3>,
  'create_my_api_key' : ActorMethod<[string, Array<string>], string>,
  'debug_check_oracle_events' : ActorMethod<[string], Result_3>,
  'debug_get_market' : ActorMethod<
    [string],
    [] | [
      {
        'status' : string,
        'homeTeam' : string,
        'matchDetails' : string,
        'drawPool' : string,
        'totalPool' : string,
        'marketId' : string,
        'oracleMatchId' : string,
        'awayTeam' : string,
        'homeWinPool' : string,
        'bettingDeadline' : bigint,
        'awayWinPool' : string,
        'kickoffTime' : bigint,
      }
    ]
  >,
  'debug_get_processed_events' : ActorMethod<[], bigint>,
  'debug_resolve_market' : ActorMethod<[string], Result_3>,
  'get_leaderboard_by_accuracy' : ActorMethod<
    [[] | [bigint], [] | [bigint]],
    Array<LeaderboardEntry>
  >,
  'get_leaderboard_by_profit' : ActorMethod<
    [[] | [bigint]],
    Array<LeaderboardEntry>
  >,
  'get_leaderboard_by_streak' : ActorMethod<
    [[] | [bigint]],
    Array<LeaderboardEntry>
  >,
  'get_leaderboard_by_volume' : ActorMethod<
    [[] | [bigint]],
    Array<LeaderboardEntry>
  >,
  'get_market_count' : ActorMethod<
    [],
    {
      'resolved' : bigint,
      'closed' : bigint,
      'total' : bigint,
      'open' : bigint,
    }
  >,
  'get_owner' : ActorMethod<[], Principal>,
  'get_platform_stats' : ActorMethod<
    [],
    {
      'activeMarkets' : bigint,
      'totalVolume' : bigint,
      'totalPredictions' : bigint,
      'totalUsers' : bigint,
      'resolvedMarkets' : bigint,
    }
  >,
  'get_treasury_balance' : ActorMethod<[Principal], bigint>,
  'get_upcoming_matches' : ActorMethod<[[] | [bigint]], Array<Market>>,
  'get_user_stats' : ActorMethod<[Principal], [] | [UserStats]>,
  'http_request' : ActorMethod<[HttpRequest], HttpResponse>,
  'http_request_streaming_callback' : ActorMethod<
    [StreamingToken],
    [] | [StreamingCallbackResponse]
  >,
  'http_request_update' : ActorMethod<[HttpRequest], HttpResponse>,
  'icrc120_upgrade_finished' : ActorMethod<[], UpgradeFinishedResult>,
  'list_my_api_keys' : ActorMethod<[], Array<ApiKeyMetadata>>,
  'refresh_markets' : ActorMethod<[], Result_2>,
  'revoke_my_api_key' : ActorMethod<[string], undefined>,
  'set_owner' : ActorMethod<[Principal], Result_1>,
  'transformJwksResponse' : ActorMethod<
    [{ 'context' : Uint8Array | number[], 'response' : HttpRequestResult }],
    HttpRequestResult
  >,
  'withdraw' : ActorMethod<[Principal, bigint, Destination], Result>,
}
export type Outcome = { 'HomeWin' : null } |
  { 'Draw' : null } |
  { 'AwayWin' : null };
export type Result = { 'ok' : bigint } |
  { 'err' : TreasuryError };
export type Result_1 = { 'ok' : null } |
  { 'err' : TreasuryError };
export type Result_2 = { 'ok' : bigint } |
  { 'err' : string };
export type Result_3 = { 'ok' : string } |
  { 'err' : string };
export type StreamingCallback = ActorMethod<
  [StreamingToken],
  [] | [StreamingCallbackResponse]
>;
export interface StreamingCallbackResponse {
  'token' : [] | [StreamingToken],
  'body' : Uint8Array | number[],
}
export type StreamingStrategy = {
    'Callback' : { 'token' : StreamingToken, 'callback' : StreamingCallback }
  };
export type StreamingToken = Uint8Array | number[];
export type Subaccount = Uint8Array | number[];
export type Time = bigint;
export type Timestamp = bigint;
export type TransferError = {
    'GenericError' : { 'message' : string, 'error_code' : bigint }
  } |
  { 'TemporarilyUnavailable' : null } |
  { 'BadBurn' : { 'min_burn_amount' : bigint } } |
  { 'Duplicate' : { 'duplicate_of' : bigint } } |
  { 'BadFee' : { 'expected_fee' : bigint } } |
  { 'CreatedInFuture' : { 'ledger_time' : Timestamp } } |
  { 'TooOld' : null } |
  { 'InsufficientFunds' : { 'balance' : bigint } };
export type TreasuryError = { 'LedgerTrap' : string } |
  { 'NotOwner' : null } |
  { 'TransferFailed' : TransferError };
export type UpgradeFinishedResult = { 'Failed' : [bigint, string] } |
  { 'Success' : bigint } |
  { 'InProgress' : bigint };
export interface UserStats {
  'totalWagered' : bigint,
  'totalPredictions' : bigint,
  'averageOdds' : number,
  'totalWon' : bigint,
  'userPrincipal' : Principal,
  'longestWinStreak' : bigint,
  'correctPredictions' : bigint,
  'incorrectPredictions' : bigint,
  'currentStreak' : bigint,
  'netProfit' : bigint,
}
export interface _SERVICE extends McpServer {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
