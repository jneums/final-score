import { Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import type { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { createAgent } from "./identity.js";
import { CONFIG } from "./config.js";

// ─── Candid IDL (main canister) ──────────────────────────────

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

  const PositionRecord = IDL.Record({
    positionId: IDL.Text,
    marketId: IDL.Text,
    question: IDL.Text,
    outcome: IDL.Text,
    shares: IDL.Nat,
    costBasis: IDL.Nat,
    averagePrice: IDL.Nat,
    currentPrice: IDL.Nat,
    marketStatus: IDL.Text,
  });

  return IDL.Service({
    // Admin
    admin_create_market: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Int, IDL.Nat, IDL.Nat],
      [Result],
      [],
    ),
    admin_create_api_key: IDL.Func(
      [IDL.Principal, IDL.Text, IDL.Vec(IDL.Text)],
      [IDL.Variant({ ok: IDL.Text, err: IDL.Text })],
      [],
    ),
    try_resolve_market: IDL.Func([IDL.Text], [Result], []),
    get_unresolved_markets: IDL.Func([], [IDL.Vec(UnresolvedMarket)], ["query"]),

    // Trading
    place_order: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Float64, IDL.Nat],
      [PlaceOrderResult],
      [],
    ),
    cancel_order: IDL.Func([IDL.Text], [Result], []),
    requote_market: IDL.Func(
      [IDL.Text, IDL.Vec(IDL.Record({ outcome: IDL.Text, price: IDL.Float64, size: IDL.Nat }))],
      [IDL.Variant({
        ok: IDL.Record({ cancelled: IDL.Nat, placed: IDL.Nat, escrowed: IDL.Int }),
        err: IDL.Text,
      })],
      [],
    ),
    my_orders: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)],
      [IDL.Vec(OrderRecord)],
      ["query"],
    ),
    my_positions: IDL.Func(
      [IDL.Opt(IDL.Text)],
      [IDL.Vec(PositionRecord)],
      ["query"],
    ),

    // Market data
    debug_list_markets: IDL.Func(
      [IDL.Opt(IDL.Text), IDL.Nat, IDL.Nat, IDL.Opt(IDL.Text)],
      [ListMarketsResult],
      ["query"],
    ),
    debug_get_order_book: IDL.Func(
      [IDL.Text, IDL.Nat],
      [OrderBookResult],
      ["query"],
    ),
  });
};

// ─── Faucet IDL ──────────────────────────────────────────────

const faucetIdlFactory = ({ IDL }: { IDL: any }) => {
  return IDL.Service({
    transfer_icrc1: IDL.Func([IDL.Principal], [], []),
  });
};

// ─── Token Ledger IDL ────────────────────────────────────────

const tokenLedgerIdlFactory = ({ IDL }: { IDL: any }) => {
  return IDL.Service({
    icrc2_approve: IDL.Func(
      [IDL.Record({
        spender: IDL.Record({
          owner: IDL.Principal,
          subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        }),
        amount: IDL.Nat,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
        expected_allowance: IDL.Opt(IDL.Nat),
        expires_at: IDL.Opt(IDL.Nat64),
      })],
      [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })],
      [],
    ),
    icrc1_balance_of: IDL.Func(
      [IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
      })],
      [IDL.Nat],
      ["query"],
    ),
  });
};

// ─── TypeScript interfaces ───────────────────────────────────

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

interface PositionRecord {
  positionId: string;
  marketId: string;
  question: string;
  outcome: string;
  shares: bigint;
  costBasis: bigint;
  averagePrice: bigint;
  currentPrice: bigint;
  marketStatus: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CanisterActor = any;

// ─── CandidClient (per-bot trading) ─────────────────────────

export class CandidClient {
  private actor: CanisterActor;
  private tokenActor: CanisterActor;
  private identity: Secp256k1KeyIdentity;
  private agent: CanisterActor;

  constructor(actor: CanisterActor, tokenActor: CanisterActor, identity: Secp256k1KeyIdentity, agent: CanisterActor) {
    this.actor = actor;
    this.tokenActor = tokenActor;
    this.identity = identity;
    this.agent = agent;
  }

  static async create(identity: Secp256k1KeyIdentity, host?: string): Promise<CandidClient> {
    const agent = await createAgent(identity, host);
    const actor = Actor.createActor(idlFactory, {
      agent,
      canisterId: CONFIG.CANISTER_ID,
    });
    const tokenActor = Actor.createActor(tokenLedgerIdlFactory, {
      agent,
      canisterId: CONFIG.TOKEN_LEDGER,
    });
    return new CandidClient(actor, tokenActor, identity, agent);
  }

  getPrincipal(): string {
    return this.identity.getPrincipal().toText();
  }

  async placeOrder(
    marketId: string, outcome: string, price: number, size: number,
  ): Promise<{ ok: boolean; message: string; data?: PlaceOrderOk }> {
    try {
      const result = await this.actor.place_order(marketId, outcome, price, BigInt(size));
      if ("ok" in result) return { ok: true, message: result.ok.status, data: result.ok };
      return { ok: false, message: result.err };
    } catch (e) {
      return { ok: false, message: String(e).slice(0, 200) };
    }
  }

  async cancelOrder(orderId: string): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.actor.cancel_order(orderId);
      if ("ok" in result) return { ok: true, message: result.ok };
      return { ok: false, message: result.err };
    } catch (e) {
      return { ok: false, message: String(e).slice(0, 200) };
    }
  }

  async getMyOrders(
    statusFilter?: string, marketFilter?: string,
  ): Promise<OrderRecord[]> {
    return this.actor.my_orders(
      statusFilter ? [statusFilter] : [],
      marketFilter ? [marketFilter] : [],
    );
  }

  async getMyPositions(marketFilter?: string): Promise<PositionRecord[]> {
    return this.actor.my_positions(
      marketFilter ? [marketFilter] : [],
    );
  }

  async listMarkets(
    sport?: string, offset = 0, limit = 100, status?: string,
  ): Promise<{ total: bigint; returned: bigint; markets: MarketRecord[] }> {
    return this.actor.debug_list_markets(
      sport ? [sport] : [],
      BigInt(offset),
      BigInt(limit),
      status ? [status] : [],
    );
  }

  async getOrderBook(marketId: string, depth = 10): Promise<OrderBookResult> {
    return this.actor.debug_get_order_book(marketId, BigInt(depth));
  }

  async approve(spenderCanisterId: string, amount: bigint): Promise<void> {
    const result = await this.tokenActor.icrc2_approve({
      spender: {
        owner: Principal.fromText(spenderCanisterId),
        subaccount: [],
      },
      amount,
      fee: [],
      memo: [],
      from_subaccount: [],
      created_at_time: [],
      expected_allowance: [],
      expires_at: [],
    });
    if ("Err" in result) {
      throw new Error(`icrc2_approve failed: ${result.Err}`);
    }
  }

  async getBalance(): Promise<bigint> {
    return this.tokenActor.icrc1_balance_of({
      owner: this.identity.getPrincipal(),
      subaccount: [],
    });
  }

  async callFaucet(): Promise<void> {
    const faucetActor = Actor.createActor(faucetIdlFactory, {
      agent: this.agent,
      canisterId: CONFIG.FAUCET_CANISTER,
    });
    await (faucetActor as any).transfer_icrc1(this.identity.getPrincipal());
  }
} 

// ─── AdminClient (admin operations) ─────────────────────────

export class AdminClient {
  private actor: CanisterActor;
  private faucetActor: CanisterActor;

  constructor(actor: CanisterActor, faucetActor: CanisterActor) {
    this.actor = actor;
    this.faucetActor = faucetActor;
  }

  static async create(identity: Secp256k1KeyIdentity, host?: string): Promise<AdminClient> {
    const agent = await createAgent(identity, host);
    const actor = Actor.createActor(idlFactory, {
      agent,
      canisterId: CONFIG.CANISTER_ID,
    });
    const faucetActor = Actor.createActor(faucetIdlFactory, {
      agent,
      canisterId: CONFIG.FAUCET_CANISTER,
    });
    return new AdminClient(actor, faucetActor);
  }

  async createApiKey(
    userPrincipal: string, name: string, scopes: string[],
  ): Promise<string> {
    const result = await this.actor.admin_create_api_key(
      Principal.fromText(userPrincipal),
      name,
      scopes,
    );
    if ("ok" in result) return result.ok;
    throw new Error(`admin_create_api_key failed: ${result.err}`);
  }

  async fundFromFaucet(principal: string): Promise<void> {
    await this.faucetActor.transfer_icrc1(Principal.fromText(principal));
  }
}

// ─── TokenClient (standalone token operations) ──────────────

export class TokenClient {
  private tokenActor: CanisterActor;
  private identity: Secp256k1KeyIdentity;

  constructor(tokenActor: CanisterActor, identity: Secp256k1KeyIdentity) {
    this.tokenActor = tokenActor;
    this.identity = identity;
  }

  static async create(identity: Secp256k1KeyIdentity, host?: string): Promise<TokenClient> {
    const agent = await createAgent(identity, host);
    const tokenActor = Actor.createActor(tokenLedgerIdlFactory, {
      agent,
      canisterId: CONFIG.TOKEN_LEDGER,
    });
    return new TokenClient(tokenActor, identity);
  }

  async approve(spenderCanisterId: string, amount: bigint): Promise<void> {
    const result = await this.tokenActor.icrc2_approve({
      spender: {
        owner: Principal.fromText(spenderCanisterId),
        subaccount: [],
      },
      amount,
      fee: [],
      memo: [],
      from_subaccount: [],
      created_at_time: [],
      expected_allowance: [],
      expires_at: [],
    });
    if ("Err" in result) {
      throw new Error(`icrc2_approve failed: ${result.Err}`);
    }
  }

  async getBalance(): Promise<bigint> {
    return this.tokenActor.icrc1_balance_of({
      owner: this.identity.getPrincipal(),
      subaccount: [],
    });
  }
}

// Re-export types
export type {
  OrderRecord, MarketRecord, PlaceOrderOk, OrderBookResult,
  DepthLevel, PositionRecord, PlaceOrderFill,
};
