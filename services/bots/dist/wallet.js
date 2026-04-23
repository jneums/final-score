const TIER_CONFIG = {
    low: { maxOrderCost: 2, refillTarget: 20 },
    medium: { maxOrderCost: 5, refillTarget: 50 },
    high: { maxOrderCost: 25, refillTarget: 100 },
};
const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10
const LOW_BALANCE_USD = 5; // trigger refill below this
const FAUCET_CALLS_PER_CYCLE = 3; // max faucet calls per bot per 30s cycle
// ─── Global faucet concurrency limiter ──────────────────────
const MAX_CONCURRENT_FAUCET = 3;
let activeFaucetCalls = 0;
const faucetWaiters = [];
export async function enqueueFaucetCall(fn) {
    if (activeFaucetCalls >= MAX_CONCURRENT_FAUCET) {
        await new Promise((resolve) => faucetWaiters.push(resolve));
    }
    activeFaucetCalls++;
    try {
        await fn();
        await new Promise((r) => setTimeout(r, 500));
    }
    finally {
        activeFaucetCalls--;
        const next = faucetWaiters.shift();
        if (next)
            next();
    }
}
export class BotWallet {
    candid;
    profile;
    config;
    // State
    _balance = BigInt(0);
    _lastBalanceRefresh = 0;
    /** Remaining faucet calls for in-progress refill (0 = no refill in progress) */
    _faucetCallsRemaining = 0;
    /** Guard against overlapping refill calls */
    _refillRunning = false;
    constructor(candid, profile) {
        this.candid = candid;
        this.profile = profile;
        this.config = TIER_CONFIG[profile.tier];
    }
    // ─── Getters ──────────────────────────────────────────────
    get balance() { return this._balance; }
    get balanceUsd() { return Number(this._balance) / TOKEN_DECIMALS; }
    get maxOrderCost() { return this.config.maxOrderCost; }
    // ─── Core Methods ─────────────────────────────────────────
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd) {
        return this.balanceUsd >= estimatedCostUsd + 0.10; // $0.10 buffer for fees
    }
    /** Refresh balance from chain (respects cache) */
    async refreshBalance(force = false) {
        const now = Date.now();
        if (!force && now - this._lastBalanceRefresh < BALANCE_CACHE_MS) {
            return this._balance;
        }
        try {
            this._balance = await this.candid.getBalance();
            this._lastBalanceRefresh = now;
        }
        catch {
            // Keep stale balance on failure
        }
        return this._balance;
    }
    /**
     * Lazy refill: if balance is low, top up from faucet.
     * Does at most FAUCET_CALLS_PER_CYCLE calls per invocation.
     * Returns true if refill is in progress.
     */
    async refillIfNeeded(faucetFn, log) {
        if (this._refillRunning)
            return true;
        // Start a new refill if balance is low and none in progress
        if (this._faucetCallsRemaining === 0) {
            if (this.balanceUsd >= LOW_BALANCE_USD)
                return false;
            this._faucetCallsRemaining = Math.ceil(this.config.refillTarget / FAUCET_AMOUNT_USD);
            log(`Low balance ($${this.balanceUsd.toFixed(2)}). Refilling ~$${this.config.refillTarget} (${this._faucetCallsRemaining} faucet calls)...`);
        }
        this._refillRunning = true;
        try {
            const batch = Math.min(this._faucetCallsRemaining, FAUCET_CALLS_PER_CYCLE);
            for (let i = 0; i < batch; i++) {
                try {
                    await enqueueFaucetCall(faucetFn);
                }
                catch (e) {
                    log(`Faucet call failed: ${String(e).slice(0, 100)}`);
                }
                this._faucetCallsRemaining--;
            }
            if (this._faucetCallsRemaining <= 0) {
                this._faucetCallsRemaining = 0;
                await this.refreshBalance(true);
                log(`Refill complete. Balance: $${this.balanceUsd.toFixed(2)}`);
            }
            else {
                log(`Refill progress: ${this._faucetCallsRemaining} calls remaining`);
            }
            return true;
        }
        finally {
            this._refillRunning = false;
        }
    }
    /** Get a summary for stats endpoint */
    toJSON() {
        return {
            balanceUsd: Math.round(this.balanceUsd * 100) / 100,
            tier: this.profile.tier,
            discipline: this.profile.discipline,
            maxOrderCost: this.config.maxOrderCost,
            refillTarget: this.config.refillTarget,
        };
    }
}
