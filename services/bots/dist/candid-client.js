import { Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { createAgent } from "./identity.js";
import { CONFIG } from "./config.js";
// ─── Candid IDL (main canister) ──────────────────────────────
const idlFactory = ({ IDL }) => {
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
        admin_create_market: IDL.Func([IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Text, IDL.Int, IDL.Nat, IDL.Nat], [Result], []),
        admin_create_api_key: IDL.Func([IDL.Principal, IDL.Text, IDL.Vec(IDL.Text)], [IDL.Variant({ ok: IDL.Text, err: IDL.Text })], []),
        try_resolve_market: IDL.Func([IDL.Text], [Result], []),
        get_unresolved_markets: IDL.Func([], [IDL.Vec(UnresolvedMarket)], ["query"]),
        // Trading
        place_order: IDL.Func([IDL.Text, IDL.Text, IDL.Float64, IDL.Nat], [PlaceOrderResult], []),
        cancel_order: IDL.Func([IDL.Text], [Result], []),
        create_my_api_key: IDL.Func([IDL.Text, IDL.Vec(IDL.Text)], [IDL.Text], []),
        requote_market: IDL.Func([IDL.Text, IDL.Vec(IDL.Record({ outcome: IDL.Text, price: IDL.Float64, size: IDL.Nat }))], [IDL.Variant({
                ok: IDL.Record({ cancelled: IDL.Nat, placed: IDL.Nat, escrowed: IDL.Int }),
                err: IDL.Text,
            })], []),
        my_orders: IDL.Func([IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)], [IDL.Vec(OrderRecord)], ["query"]),
        my_positions: IDL.Func([IDL.Opt(IDL.Text)], [IDL.Vec(PositionRecord)], ["query"]),
        // Market data
        debug_list_markets: IDL.Func([IDL.Opt(IDL.Text), IDL.Nat, IDL.Nat, IDL.Opt(IDL.Text)], [ListMarketsResult], ["query"]),
        debug_get_order_book: IDL.Func([IDL.Text, IDL.Nat], [OrderBookResult], ["query"]),
    });
};
// ─── Faucet IDL ──────────────────────────────────────────────
const faucetIdlFactory = ({ IDL }) => {
    return IDL.Service({
        transfer_icrc1: IDL.Func([IDL.Principal], [], []),
    });
};
// ─── Token Ledger IDL ────────────────────────────────────────
const tokenLedgerIdlFactory = ({ IDL }) => {
    return IDL.Service({
        icrc2_approve: IDL.Func([IDL.Record({
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
            })], [IDL.Variant({
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
            })], []),
        icrc1_balance_of: IDL.Func([IDL.Record({
                owner: IDL.Principal,
                subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
            })], [IDL.Nat], ["query"]),
    });
};
// ─── CandidClient (per-bot trading) ─────────────────────────
export class CandidClient {
    actor;
    tokenActor;
    identity;
    agent;
    constructor(actor, tokenActor, identity, agent) {
        this.actor = actor;
        this.tokenActor = tokenActor;
        this.identity = identity;
        this.agent = agent;
    }
    static async create(identity, host) {
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
    getPrincipal() {
        return this.identity.getPrincipal().toText();
    }
    async placeOrder(marketId, outcome, price, size) {
        try {
            const result = await this.actor.place_order(marketId, outcome, price, BigInt(size));
            if ("ok" in result)
                return { ok: true, message: result.ok.status, data: result.ok };
            return { ok: false, message: result.err };
        }
        catch (e) {
            return { ok: false, message: String(e).slice(0, 200) };
        }
    }
    async cancelOrder(orderId) {
        try {
            const result = await this.actor.cancel_order(orderId);
            if ("ok" in result)
                return { ok: true, message: result.ok };
            return { ok: false, message: result.err };
        }
        catch (e) {
            return { ok: false, message: String(e).slice(0, 200) };
        }
    }
    async getMyOrders(statusFilter, marketFilter) {
        return this.actor.my_orders(statusFilter ? [statusFilter] : [], marketFilter ? [marketFilter] : []);
    }
    async getMyPositions(marketFilter) {
        return this.actor.my_positions(marketFilter ? [marketFilter] : []);
    }
    async listMarkets(sport, offset = 0, limit = 100, status) {
        return this.actor.debug_list_markets(sport ? [sport] : [], BigInt(offset), BigInt(limit), status ? [status] : []);
    }
    async getOrderBook(marketId, depth = 10) {
        return this.actor.debug_get_order_book(marketId, BigInt(depth));
    }
    async approve(spenderCanisterId, amount) {
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
            throw new Error(`icrc2_approve failed: ${JSON.stringify(result.Err)}`);
        }
    }
    async getBalance() {
        return this.tokenActor.icrc1_balance_of({
            owner: this.identity.getPrincipal(),
            subaccount: [],
        });
    }
    async createMyApiKey(name, scopes = ["all"]) {
        return this.actor.create_my_api_key(name, scopes);
    }
    async callFaucet() {
        const faucetActor = Actor.createActor(faucetIdlFactory, {
            agent: this.agent,
            canisterId: CONFIG.FAUCET_CANISTER,
        });
        await faucetActor.transfer_icrc1(this.identity.getPrincipal());
    }
}
// ─── AdminClient (admin operations) ─────────────────────────
export class AdminClient {
    actor;
    faucetActor;
    constructor(actor, faucetActor) {
        this.actor = actor;
        this.faucetActor = faucetActor;
    }
    static async create(identity, host) {
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
    async createApiKey(userPrincipal, name, scopes) {
        const result = await this.actor.admin_create_api_key(Principal.fromText(userPrincipal), name, scopes);
        if ("ok" in result)
            return result.ok;
        throw new Error(`admin_create_api_key failed: ${result.err}`);
    }
    async fundFromFaucet(principal) {
        await this.faucetActor.transfer_icrc1(Principal.fromText(principal));
    }
}
// ─── TokenClient (standalone token operations) ──────────────
export class TokenClient {
    tokenActor;
    identity;
    constructor(tokenActor, identity) {
        this.tokenActor = tokenActor;
        this.identity = identity;
    }
    static async create(identity, host) {
        const agent = await createAgent(identity, host);
        const tokenActor = Actor.createActor(tokenLedgerIdlFactory, {
            agent,
            canisterId: CONFIG.TOKEN_LEDGER,
        });
        return new TokenClient(tokenActor, identity);
    }
    async approve(spenderCanisterId, amount) {
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
            throw new Error(`icrc2_approve failed: ${JSON.stringify(result.Err)}`);
        }
    }
    async getBalance() {
        return this.tokenActor.icrc1_balance_of({
            owner: this.identity.getPrincipal(),
            subaccount: [],
        });
    }
}
