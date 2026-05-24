import { Actor, HttpAgent } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { CONFIG } from "./config.js";

const TOKEN_TRANSFER_FEE_UNITS = 10_000n;

// ─── Candid IDL ──────────────────────────────────────────────
const idlFactory = ({ IDL }: { IDL: any }) => {
  const Result = IDL.Variant({ ok: IDL.Text, err: IDL.Text });

  const UnresolvedMarket = IDL.Record({
    marketId: IDL.Text,
    polymarketSlug: IDL.Text,
    polymarketConditionId: IDL.Text,
    status: IDL.Text,
    endDate: IDL.Int,
  });

  const Fill = IDL.Record({
    tradeId: IDL.Text,
    price: IDL.Nat,
    size: IDL.Nat,
  });

  const PlaceOrderOk = IDL.Record({
    orderId: IDL.Text,
    status: IDL.Text,
    filled: IDL.Nat,
    remaining: IDL.Nat,
    fills: IDL.Vec(Fill),
  });

  const PlaceOrderResult = IDL.Variant({ ok: PlaceOrderOk, err: IDL.Text });

  const OrderRecord = IDL.Record({
    orderId: IDL.Text,
    marketId: IDL.Text,
    outcome: IDL.Text,
    price: IDL.Nat,
    size: IDL.Nat,
    filledSize: IDL.Nat,
    status: IDL.Text,
    timestamp: IDL.Int,
  });

  const MarketRecord = IDL.Record({
    marketId: IDL.Text,
    question: IDL.Text,
    eventTitle: IDL.Text,
    sport: IDL.Text,
    status: IDL.Text,
    yesPrice: IDL.Nat,
    noPrice: IDL.Nat,
    polymarketSlug: IDL.Text,
  });

  const ListMarketsResult = IDL.Record({
    total: IDL.Nat,
    returned: IDL.Nat,
    markets: IDL.Vec(MarketRecord),
  });

  const DepthLevel = IDL.Record({
    price: IDL.Nat,
    totalSize: IDL.Nat,
    orderCount: IDL.Nat,
  });

  const OrderBookResult = IDL.Record({
    yesBids: IDL.Vec(DepthLevel),
    noBids: IDL.Vec(DepthLevel),
    bestYesBid: IDL.Nat,
    bestNoBid: IDL.Nat,
    impliedYesAsk: IDL.Nat,
    impliedNoAsk: IDL.Nat,
    spread: IDL.Nat,
  });

  const AccountBalance = IDL.Record({
    available: IDL.Nat,
    lockedInOrders: IDL.Nat,
    total: IDL.Nat,
  });

  return IDL.Service({
    admin_create_market: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Int, IDL.Nat, IDL.Nat],
      [Result],
      []
    ),
    try_resolve_market: IDL.Func([IDL.Text], [Result], []),
    get_unresolved_markets: IDL.Func([], [IDL.Vec(UnresolvedMarket)], ["query"]),

    // Trading
    place_order: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Float64, IDL.Nat],
      [PlaceOrderResult],
      []
    ),
    cancel_order: IDL.Func([IDL.Text], [Result], []),
    get_my_account_balance: IDL.Func([], [AccountBalance], ["query"]),
    deposit: IDL.Func([IDL.Nat], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
    requote_market: IDL.Func(
      [IDL.Text, IDL.Vec(IDL.Record({ outcome: IDL.Text, price: IDL.Float64, size: IDL.Nat }))],
      [IDL.Variant({
        ok: IDL.Record({ cancelled: IDL.Nat, placed: IDL.Nat, escrowed: IDL.Int }),
        err: IDL.Text,
      })],
      []
    ),
    my_orders: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],
      [IDL.Vec(OrderRecord)],
      ["query"]
    ),

    // Market data
    debug_list_markets: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Nat, IDL.Nat, IDL.Opt(IDL.Text)],
      [ListMarketsResult],
      ["query"]
    ),
    debug_get_order_book: IDL.Func(
      [IDL.Text, IDL.Nat],
      [OrderBookResult],
      ["query"]
    ),
  });
};

const tokenLedgerIdlFactory = ({ IDL }: { IDL: any }) => {
  return IDL.Service({
    icrc2_approve: IDL.Func(
      [IDL.Record({
        spender: IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
        amount: IDL.Nat,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        expected_allowance: IDL.Opt(IDL.Nat),
        expires_at: IDL.Opt(IDL.Nat64),
      })],
      [IDL.Variant({
        Ok: IDL.Nat,
        Err: IDL.Variant({
          GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
          TemporarilyUnavailable: IDL.Null,
          Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
          BadFee: IDL.Record({ expected_fee: IDL.Nat }),
          AllowanceChanged: IDL.Record({ current_allowance: IDL.Nat }),
          CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
          TooOld: IDL.Null,
          Expired: IDL.Record({ ledger_time: IDL.Nat64 }),
          InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
        }),
      })],
      [],
    ),
    icrc1_balance_of: IDL.Func(
      [IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })],
      [IDL.Nat],
      ["query"],
    ),
  });
};

// ─── Types ───────────────────────────────────────────────────

interface UnresolvedMarket {
  marketId: string;
  polymarketSlug: string;
  polymarketConditionId: string;
  status: string;
  endDate: bigint;
}

interface PlaceOrderFill {
  tradeId: string;
  price: bigint;
  size: bigint;
}

interface PlaceOrderOk {
  orderId: string;
  status: string;
  filled: bigint;
  remaining: bigint;
  fills: PlaceOrderFill[];
}

interface OrderRecord {
  orderId: string;
  marketId: string;
  outcome: string;
  price: bigint;
  size: bigint;
  filledSize: bigint;
  status: string;
  timestamp: bigint;
}

interface MarketRecord {
  marketId: string;
  question: string;
  eventTitle: string;
  sport: string;
  status: string;
  yesPrice: bigint;
  noPrice: bigint;
  polymarketSlug: string;
}

interface DepthLevel {
  price: bigint;
  totalSize: bigint;
  orderCount: bigint;
}

interface OrderBookResult {
  yesBids: DepthLevel[];
  noBids: DepthLevel[];
  bestYesBid: bigint;
  bestNoBid: bigint;
  impliedYesAsk: bigint;
  impliedNoAsk: bigint;
  spread: bigint;
}

interface AccountBalance {
  available: bigint;
  lockedInOrders: bigint;
  total: bigint;
}

interface CanisterActor {
  admin_create_market(
    question: string, eventTitle: string, sport: string,
    polymarketSlug: string, polymarketConditionId: string,
    endDateSeconds: bigint, yesPrice: bigint, noPrice: bigint,
  ): Promise<{ ok: string } | { err: string }>;
  try_resolve_market(marketId: string): Promise<{ ok: string } | { err: string }>;
  get_unresolved_markets(): Promise<UnresolvedMarket[]>;

  place_order(
    marketId: string, outcome: string, price: number, size: bigint,
  ): Promise<{ ok: PlaceOrderOk } | { err: string }>;
  cancel_order(orderId: string): Promise<{ ok: string } | { err: string }>;
  get_my_account_balance(): Promise<AccountBalance>;
  deposit(amount: bigint): Promise<{ ok: bigint } | { err: string }>;
  requote_market(
    marketId: string,
    newOrders: Array<{ outcome: string; price: number; size: bigint }>,
  ): Promise<{ ok: { cancelled: bigint; placed: bigint; escrowed: bigint } } | { err: string }>;
  my_orders(statusFilter: [string] | [], marketFilter: [string] | []): Promise<OrderRecord[]>;

  debug_list_markets(
    sportFilter: [string] | [], offset: bigint, limit: bigint, statusFilter: [string] | [],
  ): Promise<{ total: bigint; returned: bigint; markets: MarketRecord[] }>;
  debug_get_order_book(marketId: string, maxLevels: bigint): Promise<OrderBookResult>;
}

interface TokenLedgerActor {
  icrc2_approve(args: {
    spender: { owner: Principal; subaccount: [] };
    amount: bigint;
    fee: [];
    memo: [];
    from_subaccount: [];
    created_at_time: [];
    expected_allowance: [];
    expires_at: [];
  }): Promise<{ Ok: bigint } | { Err: unknown }>;
  icrc1_balance_of(account: { owner: Principal; subaccount: [] }): Promise<bigint>;
}

// ─── Actor factory ───────────────────────────────────────────

function decodePem(pemOrBase64: string): string {
  if (pemOrBase64.includes("BEGIN")) return pemOrBase64;
  return Buffer.from(pemOrBase64, "base64").toString("utf-8");
}

// Admin actor (owner identity — for create_market, etc.)
let cachedAdminActor: CanisterActor | null = null;

export async function getActor(): Promise<CanisterActor> {
  if (cachedAdminActor) return cachedAdminActor;

  if (!CONFIG.DFX_IDENTITY_PEM) {
    throw new Error("DFX_IDENTITY_PEM not set");
  }

  const pem = decodePem(CONFIG.DFX_IDENTITY_PEM);
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  console.log(`   Admin identity: ${identity.getPrincipal().toText()}`);

  const agent = await HttpAgent.create({ host: CONFIG.IC_HOST, identity });
  cachedAdminActor = Actor.createActor<CanisterActor>(idlFactory, {
    agent, canisterId: CONFIG.CANISTER_ID,
  });
  return cachedAdminActor;
}

// Maker actor (separate identity — for place_order, cancel_order, my_orders)
let cachedMakerActor: CanisterActor | null = null;
let cachedMakerTokenActor: TokenLedgerActor | null = null;
let cachedMakerIdentity: Secp256k1KeyIdentity | null = null;
let cachedMakerAgent: HttpAgent | null = null;

async function getMakerIdentityAndAgent(): Promise<{ identity: Secp256k1KeyIdentity; agent: HttpAgent }> {
  if (cachedMakerIdentity && cachedMakerAgent) {
    return { identity: cachedMakerIdentity, agent: cachedMakerAgent };
  }

  if (!CONFIG.MAKER_IDENTITY_PEM) {
    throw new Error("MAKER_IDENTITY_PEM not set");
  }

  const pem = decodePem(CONFIG.MAKER_IDENTITY_PEM);
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  console.log(`   Maker identity: ${identity.getPrincipal().toText()}`);

  const agent = await HttpAgent.create({ host: CONFIG.IC_HOST, identity });
  cachedMakerIdentity = identity;
  cachedMakerAgent = agent;
  return { identity, agent };
}

export async function getMakerActor(): Promise<CanisterActor> {
  if (cachedMakerActor) return cachedMakerActor;

  const { agent } = await getMakerIdentityAndAgent();
  cachedMakerActor = Actor.createActor<CanisterActor>(idlFactory, {
    agent, canisterId: CONFIG.CANISTER_ID,
  });
  return cachedMakerActor;
}

async function getMakerTokenActor(): Promise<TokenLedgerActor> {
  if (cachedMakerTokenActor) return cachedMakerTokenActor;

  const { agent } = await getMakerIdentityAndAgent();
  cachedMakerTokenActor = Actor.createActor<TokenLedgerActor>(tokenLedgerIdlFactory, {
    agent, canisterId: CONFIG.TOKEN_LEDGER,
  });
  return cachedMakerTokenActor;
}

// ─── Exported helpers (sync/resolve — use admin actor) ───────

export async function createMarket(
  question: string, eventTitle: string, sport: string,
  slug: string, conditionId: string, endDateSeconds: number,
  yesPrice: number, noPrice: number,
): Promise<{ ok: boolean; message: string }> {
  const actor = await getActor();
  try {
    const result = await actor.admin_create_market(
      question, eventTitle, sport, slug, conditionId,
      BigInt(endDateSeconds), BigInt(yesPrice), BigInt(noPrice),
    );
    if ("ok" in result) return { ok: true, message: result.ok };
    return { ok: false, message: result.err };
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function tryResolveMarket(
  marketId: string,
): Promise<{ ok: boolean; message: string }> {
  const actor = await getActor();
  try {
    const result = await actor.try_resolve_market(marketId);
    if ("ok" in result) return { ok: true, message: result.ok };
    return { ok: false, message: result.err };
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function getUnresolvedMarkets(): Promise<UnresolvedMarket[]> {
  const actor = await getActor();
  return actor.get_unresolved_markets();
}

// ─── Exported helpers (maker — use maker actor) ──────────────

export async function placeOrder(
  marketId: string, outcome: string, price: number, size: number,
): Promise<{ ok: boolean; message: string; data?: PlaceOrderOk }> {
  const actor = await getMakerActor();
  try {
    const result = await actor.place_order(marketId, outcome, price, BigInt(size));
    if ("ok" in result) return { ok: true, message: result.ok.status, data: result.ok };
    return { ok: false, message: result.err };
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function cancelOrder(
  orderId: string,
): Promise<{ ok: boolean; message: string }> {
  const actor = await getMakerActor();
  try {
    const result = await actor.cancel_order(orderId);
    if ("ok" in result) return { ok: true, message: result.ok };
    return { ok: false, message: result.err };
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function getMakerAccountBalance(): Promise<AccountBalance> {
  const actor = await getMakerActor();
  return actor.get_my_account_balance();
}

async function approveMakerDeposit(amount: bigint): Promise<void> {
  const tokenActor = await getMakerTokenActor();
  const allowance = amount + TOKEN_TRANSFER_FEE_UNITS;
  const result = await tokenActor.icrc2_approve({
    spender: { owner: Principal.fromText(CONFIG.CANISTER_ID), subaccount: [] },
    amount: allowance,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
    expected_allowance: [],
    expires_at: [],
  });
  if ("Err" in result) {
    throw new Error(`maker icrc2_approve failed: ${JSON.stringify(result.Err)}`);
  }
}

export async function depositMakerWalletBalance(): Promise<{ ok: boolean; message: string; deposited?: bigint; balance?: AccountBalance }> {
  const { identity } = await getMakerIdentityAndAgent();
  const tokenActor = await getMakerTokenActor();
  const actor = await getMakerActor();
  const walletBalance = await tokenActor.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] });
  const feeReserve = 20_000n; // approve fee + deposit transfer_from fee
  if (walletBalance <= feeReserve) {
    const balance = await actor.get_my_account_balance();
    return { ok: false, message: `maker wallet has no depositable funds (${walletBalance})`, balance };
  }

  const amount = walletBalance - feeReserve;
  await approveMakerDeposit(amount);
  const result = await actor.deposit(amount);
  if ("err" in result) return { ok: false, message: result.err };
  const balance = await actor.get_my_account_balance();
  return { ok: true, message: "ok", deposited: amount, balance };
}

export async function ensureMakerAccountBalance(minAvailable: bigint): Promise<{ ok: boolean; message: string; balance?: AccountBalance }> {
  const actor = await getMakerActor();
  let balance = await actor.get_my_account_balance();
  if (balance.available >= minAvailable) return { ok: true, message: "ok", balance };

  const deposited = await depositMakerWalletBalance();
  if (!deposited.ok) return deposited;
  balance = deposited.balance ?? await actor.get_my_account_balance();
  if (balance.available >= minAvailable) return { ok: true, message: "ok", balance };
  return {
    ok: false,
    message: `maker account balance ${balance.available} below required ${minAvailable}`,
    balance,
  };
}

export async function requoteMarketBatch(
  marketId: string,
  orders: { outcome: string; price: number; size: number }[],
): Promise<{ ok: boolean; message: string; data?: { cancelled: number; placed: number; escrowed: number } }> {
  const actor = await getMakerActor();
  try {
    const candid = orders.map((o) => ({ outcome: o.outcome, price: o.price, size: BigInt(o.size) }));
    const result = await actor.requote_market(marketId, candid);
    if ("ok" in result) {
      return {
        ok: true,
        message: "ok",
        data: {
          cancelled: Number(result.ok.cancelled),
          placed: Number(result.ok.placed),
          escrowed: Number(result.ok.escrowed),
        },
      };
    }
    return { ok: false, message: result.err };
  } catch (e) {
    return { ok: false, message: String(e).slice(0, 200) };
  }
}

export async function getMyOrders(
  statusFilter?: string, marketFilter?: string,
): Promise<OrderRecord[]> {
  const actor = await getMakerActor();
  return actor.my_orders(
    statusFilter ? [statusFilter] : [],
    marketFilter ? [marketFilter] : [],
  );
}

export async function listMarkets(
  sportFilter?: string, offset = 0, limit = 100, status?: string,
): Promise<{ total: bigint; returned: bigint; markets: MarketRecord[] }> {
  // Use admin actor (query, no auth needed — either works)
  const actor = await getActor();
  return actor.debug_list_markets(
    sportFilter ? [sportFilter] : [],
    BigInt(offset),
    BigInt(limit),
    status ? [status] : [],
  );
}

export async function getOrderBook(
  marketId: string, maxLevels = 10,
): Promise<OrderBookResult> {
  const actor = await getActor();
  return actor.debug_get_order_book(marketId, BigInt(maxLevels));
}

// Re-export types
export type { UnresolvedMarket, OrderRecord, MarketRecord, PlaceOrderOk, OrderBookResult, DepthLevel, AccountBalance };
