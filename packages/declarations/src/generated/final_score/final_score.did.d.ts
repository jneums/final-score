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
  'admin_cancel_market' : ActorMethod<[string], Result_3>,
  'admin_clear_markets' : ActorMethod<[], Result_3>,
  /**
   * / Admin: create an API key for any principal (for testing / market maker)
   */
  'admin_create_api_key' : ActorMethod<
    [Principal, string, Array<string>],
    Result_3
  >,
  /**
   * / Admin: create a market (called by off-chain sync script)
   */
  'admin_create_market' : ActorMethod<
    [string, string, string, string, string, bigint, bigint, bigint],
    Result_3
  >,
  /**
   * / Admin: clear all markets and reset sync state (nuclear option for re-sync)
   * / Admin: delete a specific market (only if it has zero volume and no open orders)
   */
  'admin_delete_market' : ActorMethod<[string], Result_3>,
  /**
   * / Admin: drain stuck funds from a market subaccount
   */
  'admin_drain_market_subaccount' : ActorMethod<[string], Result_3>,
  /**
   * / Admin: manually resolve a market
   */
  'admin_resolve_market' : ActorMethod<[string, string], Result_3>,
  /**
   * / Admin: manually trigger resolution check (bypasses timer)
   */
  'admin_trigger_resolution_check' : ActorMethod<[], Result_3>,
  /**
   * / Admin: manually trigger Polymarket sync (bypasses timer)
   */
  'admin_trigger_sync' : ActorMethod<[], Result_3>,
  /**
   * / Cancel an order (authenticated by wallet)
   */
  'cancel_order' : ActorMethod<[string], Result_3>,
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
   * / Debug: get order book depth for a market
   */
  'debug_get_order_book' : ActorMethod<
    [string, bigint],
    {
      'impliedNoAsk' : bigint,
      'noBids' : Array<
        { 'totalSize' : bigint, 'orderCount' : bigint, 'price' : bigint }
      >,
      'bestYesBid' : bigint,
      'yesBids' : Array<
        { 'totalSize' : bigint, 'orderCount' : bigint, 'price' : bigint }
      >,
      'impliedYesAsk' : bigint,
      'bestNoBid' : bigint,
      'spread' : bigint,
    }
  >,
  /**
   * / Debug: list markets with optional sport filter, paginated
   */
  'debug_list_markets' : ActorMethod<
    [[] | [string], bigint, bigint],
    {
      'total' : bigint,
      'markets' : Array<
        {
          'status' : string,
          'polymarketSlug' : string,
          'question' : string,
          'sport' : string,
          'eventTitle' : string,
          'marketId' : string,
          'noPrice' : bigint,
          'yesPrice' : bigint,
        }
      >,
      'returned' : bigint,
    }
  >,
  /**
   * / Debug: breakdown of synced markets by sport + queue status
   */
  'debug_sync_stats' : ActorMethod<
    [],
    {
      'totalMarkets' : bigint,
      'nextMarketId' : bigint,
      'totalSlugs' : bigint,
      'sportTagCount' : bigint,
      'syncQueueRemaining' : bigint,
      'sportBreakdown' : Array<{ 'count' : bigint, 'sport' : string }>,
    }
  >,
  /**
   * / Get all markets that belong to the same event (share polymarketSlug)
   */
  'get_event_markets' : ActorMethod<
    [string],
    Array<
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
    >
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
  /**
   * / List the caller's orders
   */
  'my_orders' : ActorMethod<
    [[] | [string], [] | [string]],
    Array<
      {
        'status' : string,
        'size' : bigint,
        'orderId' : string,
        'marketId' : string,
        'timestamp' : bigint,
        'price' : bigint,
        'outcome' : string,
        'filledSize' : bigint,
      }
    >
  >,
  'my_positions' : ActorMethod<
    [[] | [string]],
    Array<
      {
        'currentPrice' : bigint,
        'shares' : bigint,
        'question' : string,
        'averagePrice' : bigint,
        'marketStatus' : string,
        'positionId' : string,
        'marketId' : string,
        'costBasis' : bigint,
        'outcome' : string,
      }
    >
  >,
  /**
   * / Place a limit order (authenticated by wallet — msg.caller is the user)
   */
  'place_order' : ActorMethod<[string, string, number, bigint], Result_2>,
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
export type Result_2 = {
    'ok' : {
      'fills' : Array<
        { 'size' : bigint, 'tradeId' : string, 'price' : bigint }
      >,
      'status' : string,
      'orderId' : string,
      'filled' : bigint,
      'remaining' : bigint,
    }
  } |
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
