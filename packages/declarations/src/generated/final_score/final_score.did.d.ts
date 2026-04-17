import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

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
export interface McpServer {
  /**
   * / Admin: cancel a market and refund all
   */
  'admin_cancel_market' : ActorMethod<[string], Result_2>,
  /**
   * / Admin: manually create a market (for testing before Polymarket sync is implemented)
   */
  'admin_create_market' : ActorMethod<
    [string, string, string, string, string, bigint, bigint, bigint],
    Result_2
  >,
  /**
   * / Admin: drain stuck funds from a market subaccount
   */
  'admin_drain_market_subaccount' : ActorMethod<[string], Result_2>,
  /**
   * / Admin: manually resolve a market
   */
  'admin_resolve_market' : ActorMethod<[string, string], Result_2>,
  'create_my_api_key' : ActorMethod<[string, Array<string>], string>,
  /**
   * / Debug: get a specific market
   */
  'debug_get_market' : ActorMethod<
    [string],
    [] | [
      {
        'status' : string,
        'polymarketSlug' : string,
        'endDate' : bigint,
        'totalVolume' : bigint,
        'question' : string,
        'lastYesPrice' : bigint,
        'lastNoPrice' : bigint,
        'sport' : string,
        'eventTitle' : string,
        'marketId' : string,
      }
    ]
  >,
  /**
   * / Leaderboard by net profit
   */
  'get_leaderboard_by_profit' : ActorMethod<
    [[] | [bigint]],
    Array<LeaderboardEntry>
  >,
  /**
   * / Get market counts by status
   */
  'get_market_count' : ActorMethod<
    [],
    {
      'resolved' : bigint,
      'closed' : bigint,
      'total' : bigint,
      'cancelled' : bigint,
      'open' : bigint,
    }
  >,
  'get_owner' : ActorMethod<[], Principal>,
  /**
   * / Get platform stats
   */
  'get_platform_stats' : ActorMethod<
    [],
    {
      'totalTrades' : bigint,
      'activeMarkets' : bigint,
      'totalVolume' : bigint,
      'totalUsers' : bigint,
      'resolvedMarkets' : bigint,
    }
  >,
  'get_treasury_balance' : ActorMethod<[Principal], bigint>,
  'http_request' : ActorMethod<[HttpRequest], HttpResponse>,
  'http_request_streaming_callback' : ActorMethod<
    [StreamingToken],
    [] | [StreamingCallbackResponse]
  >,
  'http_request_update' : ActorMethod<[HttpRequest], HttpResponse>,
  'icrc120_upgrade_finished' : ActorMethod<[], UpgradeFinishedResult>,
  'list_my_api_keys' : ActorMethod<[], Array<ApiKeyMetadata>>,
  'revoke_my_api_key' : ActorMethod<[string], undefined>,
  'set_owner' : ActorMethod<[Principal], Result_1>,
  'transformJwksResponse' : ActorMethod<
    [{ 'context' : Uint8Array | number[], 'response' : HttpRequestResult }],
    HttpRequestResult
  >,
  'transformPolymarket' : ActorMethod<
    [{ 'context' : Uint8Array | number[], 'response' : HttpRequestResult }],
    HttpRequestResult
  >,
  'withdraw' : ActorMethod<[Principal, bigint, Destination], Result>,
}
export type Result = { 'ok' : bigint } |
  { 'err' : TreasuryError };
export type Result_1 = { 'ok' : null } |
  { 'err' : TreasuryError };
export type Result_2 = { 'ok' : string } |
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
    'Callback' : { 'token' : StreamingToken, 'callback' : [Principal, string] }
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
  'totalTrades' : bigint,
  'marketsWon' : bigint,
  'totalVolume' : bigint,
  'userPrincipal' : Principal,
  'totalPayout' : bigint,
  'marketsLost' : bigint,
  'netProfit' : bigint,
}
export interface _SERVICE extends McpServer {}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
