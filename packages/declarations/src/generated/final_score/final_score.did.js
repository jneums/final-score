export const idlFactory = ({ IDL }) => {
  const Result_3 = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const UserStats = IDL.Record({
    'totalWagered' : IDL.Nat,
    'totalPredictions' : IDL.Nat,
    'averageOdds' : IDL.Float64,
    'totalWon' : IDL.Nat,
    'userPrincipal' : IDL.Principal,
    'longestWinStreak' : IDL.Nat,
    'correctPredictions' : IDL.Nat,
    'incorrectPredictions' : IDL.Nat,
    'currentStreak' : IDL.Int,
    'netProfit' : IDL.Int,
  });
  const LeaderboardEntry = IDL.Record({
    'rank' : IDL.Nat,
    'stats' : UserStats,
  });
  const Outcome = IDL.Variant({
    'HomeWin' : IDL.Null,
    'Draw' : IDL.Null,
    'AwayWin' : IDL.Null,
  });
  const MarketStatus = IDL.Variant({
    'Open' : IDL.Null,
    'Closed' : IDL.Null,
    'Resolved' : Outcome,
  });
  const Market = IDL.Record({
    'status' : MarketStatus,
    'homeTeam' : IDL.Text,
    'matchDetails' : IDL.Text,
    'drawPool' : IDL.Nat,
    'totalPool' : IDL.Nat,
    'marketId' : IDL.Text,
    'oracleMatchId' : IDL.Text,
    'awayTeam' : IDL.Text,
    'homeWinPool' : IDL.Nat,
    'bettingDeadline' : IDL.Int,
    'awayWinPool' : IDL.Nat,
    'kickoffTime' : IDL.Int,
  });
  const Header = IDL.Tuple(IDL.Text, IDL.Text);
  const HttpRequest = IDL.Record({
    'url' : IDL.Text,
    'method' : IDL.Text,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(Header),
    'certificate_version' : IDL.Opt(IDL.Nat16),
  });
  const StreamingToken = IDL.Vec(IDL.Nat8);
  const StreamingCallbackResponse = IDL.Record({
    'token' : IDL.Opt(StreamingToken),
    'body' : IDL.Vec(IDL.Nat8),
  });
  const StreamingCallback = IDL.Func(
      [StreamingToken],
      [IDL.Opt(StreamingCallbackResponse)],
      ['query'],
    );
  const StreamingStrategy = IDL.Variant({
    'Callback' : IDL.Record({
      'token' : StreamingToken,
      'callback' : StreamingCallback,
    }),
  });
  const HttpResponse = IDL.Record({
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(Header),
    'upgrade' : IDL.Opt(IDL.Bool),
    'streaming_strategy' : IDL.Opt(StreamingStrategy),
    'status_code' : IDL.Nat16,
  });
  const UpgradeFinishedResult = IDL.Variant({
    'Failed' : IDL.Tuple(IDL.Nat, IDL.Text),
    'Success' : IDL.Nat,
    'InProgress' : IDL.Nat,
  });
  const Time = IDL.Int;
  const ApiKeyInfo = IDL.Record({
    'created' : Time,
    'principal' : IDL.Principal,
    'scopes' : IDL.Vec(IDL.Text),
    'name' : IDL.Text,
  });
  const HashedApiKey = IDL.Text;
  const ApiKeyMetadata = IDL.Record({
    'info' : ApiKeyInfo,
    'hashed_key' : HashedApiKey,
  });
  const Result_2 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const Timestamp = IDL.Nat64;
  const TransferError = IDL.Variant({
    'GenericError' : IDL.Record({
      'message' : IDL.Text,
      'error_code' : IDL.Nat,
    }),
    'TemporarilyUnavailable' : IDL.Null,
    'BadBurn' : IDL.Record({ 'min_burn_amount' : IDL.Nat }),
    'Duplicate' : IDL.Record({ 'duplicate_of' : IDL.Nat }),
    'BadFee' : IDL.Record({ 'expected_fee' : IDL.Nat }),
    'CreatedInFuture' : IDL.Record({ 'ledger_time' : Timestamp }),
    'TooOld' : IDL.Null,
    'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat }),
  });
  const TreasuryError = IDL.Variant({
    'LedgerTrap' : IDL.Text,
    'NotOwner' : IDL.Null,
    'TransferFailed' : TransferError,
  });
  const Result_1 = IDL.Variant({ 'ok' : IDL.Null, 'err' : TreasuryError });
  const HttpHeader = IDL.Record({ 'value' : IDL.Text, 'name' : IDL.Text });
  const HttpRequestResult = IDL.Record({
    'status' : IDL.Nat,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(HttpHeader),
  });
  const Subaccount = IDL.Vec(IDL.Nat8);
  const Destination = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(Subaccount),
  });
  const Result = IDL.Variant({ 'ok' : IDL.Nat, 'err' : TreasuryError });
  const McpServer = IDL.Service({
    'admin_cancel_and_refund_market' : IDL.Func([IDL.Text], [Result_3], []),
    'admin_clear_processed_event' : IDL.Func([IDL.Nat], [Result_3], []),
    'admin_delete_market' : IDL.Func([IDL.Text], [Result_3], []),
    'admin_rebuild_stats_from_history' : IDL.Func([], [Result_3], []),
    'admin_revert_market_to_open' : IDL.Func([IDL.Text], [Result_3], []),
    'admin_seed_test_data' : IDL.Func([], [Result_3], []),
    'create_my_api_key' : IDL.Func(
        [IDL.Text, IDL.Vec(IDL.Text)],
        [IDL.Text],
        [],
      ),
    'debug_check_oracle_events' : IDL.Func([IDL.Text], [Result_3], []),
    'debug_get_market' : IDL.Func(
        [IDL.Text],
        [
          IDL.Opt(
            IDL.Record({
              'status' : IDL.Text,
              'homeTeam' : IDL.Text,
              'matchDetails' : IDL.Text,
              'drawPool' : IDL.Text,
              'totalPool' : IDL.Text,
              'marketId' : IDL.Text,
              'oracleMatchId' : IDL.Text,
              'awayTeam' : IDL.Text,
              'homeWinPool' : IDL.Text,
              'bettingDeadline' : IDL.Int,
              'awayWinPool' : IDL.Text,
              'kickoffTime' : IDL.Int,
            })
          ),
        ],
        ['query'],
      ),
    'debug_get_processed_events' : IDL.Func([], [IDL.Nat], ['query']),
    'debug_resolve_market' : IDL.Func([IDL.Text], [Result_3], []),
    'get_leaderboard_by_accuracy' : IDL.Func(
        [IDL.Opt(IDL.Nat), IDL.Opt(IDL.Nat)],
        [IDL.Vec(LeaderboardEntry)],
        ['query'],
      ),
    'get_leaderboard_by_profit' : IDL.Func(
        [IDL.Opt(IDL.Nat)],
        [IDL.Vec(LeaderboardEntry)],
        ['query'],
      ),
    'get_leaderboard_by_streak' : IDL.Func(
        [IDL.Opt(IDL.Nat)],
        [IDL.Vec(LeaderboardEntry)],
        ['query'],
      ),
    'get_leaderboard_by_volume' : IDL.Func(
        [IDL.Opt(IDL.Nat)],
        [IDL.Vec(LeaderboardEntry)],
        ['query'],
      ),
    'get_market_count' : IDL.Func(
        [],
        [
          IDL.Record({
            'resolved' : IDL.Nat,
            'closed' : IDL.Nat,
            'total' : IDL.Nat,
            'open' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_owner' : IDL.Func([], [IDL.Principal], ['query']),
    'get_platform_stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'activeMarkets' : IDL.Nat,
            'totalVolume' : IDL.Nat,
            'totalPredictions' : IDL.Nat,
            'totalUsers' : IDL.Nat,
            'resolvedMarkets' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_treasury_balance' : IDL.Func([IDL.Principal], [IDL.Nat], []),
    'get_upcoming_matches' : IDL.Func(
        [IDL.Opt(IDL.Nat)],
        [IDL.Vec(Market)],
        ['query'],
      ),
    'get_user_stats' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(UserStats)],
        ['query'],
      ),
    'http_request' : IDL.Func([HttpRequest], [HttpResponse], ['query']),
    'http_request_streaming_callback' : IDL.Func(
        [StreamingToken],
        [IDL.Opt(StreamingCallbackResponse)],
        ['query'],
      ),
    'http_request_update' : IDL.Func([HttpRequest], [HttpResponse], []),
    'icrc120_upgrade_finished' : IDL.Func([], [UpgradeFinishedResult], []),
    'list_my_api_keys' : IDL.Func([], [IDL.Vec(ApiKeyMetadata)], ['query']),
    'refresh_markets' : IDL.Func([], [Result_2], []),
    'revoke_my_api_key' : IDL.Func([IDL.Text], [], []),
    'set_owner' : IDL.Func([IDL.Principal], [Result_1], []),
    'transformJwksResponse' : IDL.Func(
        [
          IDL.Record({
            'context' : IDL.Vec(IDL.Nat8),
            'response' : HttpRequestResult,
          }),
        ],
        [HttpRequestResult],
        ['query'],
      ),
    'withdraw' : IDL.Func([IDL.Principal, IDL.Nat, Destination], [Result], []),
  });
  return McpServer;
};
export const init = ({ IDL }) => {
  return [
    IDL.Opt(
      IDL.Record({
        'tokenLedger' : IDL.Opt(IDL.Principal),
        'owner' : IDL.Opt(IDL.Principal),
        'footballOracleId' : IDL.Opt(IDL.Principal),
      })
    ),
  ];
};
