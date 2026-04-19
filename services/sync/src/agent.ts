import { Actor, HttpAgent } from "@dfinity/agent";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { CONFIG } from "./config.js";

// ─── Candid IDL ──────────────────────────────────────────────
const idlFactory = ({ IDL }: { IDL: any }) => {
  const Result = IDL.Variant({ ok: IDL.Text, err: IDL.Text });

  const UnresolvedMarket = IDL.Record({
    marketId: IDL.Text,
    polymarketSlug: IDL.Text,
    polymarketConditionId: IDL.Text,
    status: IDL.Text,
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
    my_orders: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],
      [IDL.Vec(OrderRecord)],
      ["query"]
    ),

    // Market data
    debug_list_markets: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Nat, IDL.Nat],
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

// ─── Types ───────────────────────────────────────────────────

interface UnresolvedMarket {
  marketId: string;
  polymarketSlug: string;
  polymarketConditionId: string;
  status: string;
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
  my_orders(statusFilter: [string] | [], marketFilter: [string] | []): Promise<OrderRecord[]>;

  debug_list_markets(
    sportFilter: [string] | [], offset: bigint, limit: bigint,
  ): Promise<{ total: bigint; returned: bigint; markets: MarketRecord[] }>;
  debug_get_order_book(marketId: string, maxLevels: bigint): Promise<OrderBookResult>;
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

export async function getMakerActor(): Promise<CanisterActor> {
  if (cachedMakerActor) return cachedMakerActor;

  if (!CONFIG.MAKER_IDENTITY_PEM) {
    throw new Error("MAKER_IDENTITY_PEM not set");
  }

  const pem = decodePem(CONFIG.MAKER_IDENTITY_PEM);
  const identity = Secp256k1KeyIdentity.fromPem(pem);
  console.log(`   Maker identity: ${identity.getPrincipal().toText()}`);

  const agent = await HttpAgent.create({ host: CONFIG.IC_HOST, identity });
  cachedMakerActor = Actor.createActor<CanisterActor>(idlFactory, {
    agent, canisterId: CONFIG.CANISTER_ID,
  });
  return cachedMakerActor;
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
  sportFilter?: string, offset = 0, limit = 100,
): Promise<{ total: bigint; returned: bigint; markets: MarketRecord[] }> {
  // Use admin actor (query, no auth needed — either works)
  const actor = await getActor();
  return actor.debug_list_markets(
    sportFilter ? [sportFilter] : [],
    BigInt(offset), BigInt(limit),
  );
}

export async function getOrderBook(
  marketId: string, maxLevels = 10,
): Promise<OrderBookResult> {
  const actor = await getActor();
  return actor.debug_get_order_book(marketId, BigInt(maxLevels));
}

// Re-export types
export type { UnresolvedMarket, OrderRecord, MarketRecord, PlaceOrderOk, OrderBookResult, DepthLevel };
