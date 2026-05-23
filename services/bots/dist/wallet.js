const TIER_CONFIG = {
    low: { maxOrderCost: 2, refillTarget: 20 },
    medium: { maxOrderCost: 5, refillTarget: 50 },
    high: { maxOrderCost: 25, refillTarget: 100 },
};
const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10
const FAUCET_AMOUNT_UNITS = BigInt(FAUCET_AMOUNT_USD * TOKEN_DECIMALS);
const TOKEN_TRANSFER_FEE_UNITS = 10000n;
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
    // State — custodial account balance held inside Final Score
    _balance = BigInt(0);
    _lockedBalance = BigInt(0);
    _totalBalance = BigInt(0);
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
    get lockedBalance() { return this._lockedBalance; }
    get lockedBalanceUsd() { return Number(this._lockedBalance) / TOKEN_DECIMALS; }
    get totalBalance() { return this._totalBalance; }
    get totalBalanceUsd() { return Number(this._totalBalance) / TOKEN_DECIMALS; }
    get maxOrderCost() { return this.config.maxOrderCost; }
    // ─── Core Methods ─────────────────────────────────────────
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd) {
        return this.balanceUsd >= estimatedCostUsd + 0.10; // $0.10 buffer for fees
    }
    /** Refresh custodial account balance from the Final Score canister (respects cache) */
    async refreshBalance(force = false) {
        const now = Date.now();
        if (!force && now - this._lastBalanceRefresh < BALANCE_CACHE_MS) {
            return this._balance;
        }
        try {
            const account = await this.candid.getAccountBalance();
            this._balance = account.available;
            this._lockedBalance = account.lockedInOrders;
            this._totalBalance = account.total;
            this._lastBalanceRefresh = now;
        }
        catch {
            // Keep stale balance on failure
        }
        return this._balance;
    }
    /**
     * Lazy refill: if custodial balance is low, top up the wallet from faucet,
     * approve one batch deposit, and deposit into the Final Score account.
     * Does at most FAUCET_CALLS_PER_CYCLE faucet calls per invocation.
     * Returns true if refill is in progress.
     */
    async refillIfNeeded(faucetFn, depositFn, log) {
        if (this._refillRunning)
            return true;
        // Start a new refill if account balance is low and none in progress
        if (this._faucetCallsRemaining === 0) {
            if (this.balanceUsd >= LOW_BALANCE_USD)
                return false;
            this._faucetCallsRemaining = Math.ceil(this.config.refillTarget / FAUCET_AMOUNT_USD);
            log(`Low account balance ($${this.balanceUsd.toFixed(2)}). Refilling/depositing ~$${this.config.refillTarget} (${this._faucetCallsRemaining} faucet calls)...`);
        }
        this._refillRunning = true;
        try {
            const batch = Math.min(this._faucetCallsRemaining, FAUCET_CALLS_PER_CYCLE);
            let successfulFaucets = 0;
            for (let i = 0; i < batch; i++) {
                try {
                    await enqueueFaucetCall(faucetFn);
                    successfulFaucets++;
                }
                catch (e) {
                    log(`Faucet call failed: ${String(e).slice(0, 100)}`);
                }
                this._faucetCallsRemaining--;
            }
            if (successfulFaucets > 0) {
                const grossDepositAmount = FAUCET_AMOUNT_UNITS * BigInt(successfulFaucets);
                const depositAmount = grossDepositAmount > TOKEN_TRANSFER_FEE_UNITS * 2n
                    ? grossDepositAmount - TOKEN_TRANSFER_FEE_UNITS * 2n
                    : 0n;
                try {
                    const newBalance = await depositFn(depositAmount);
                    this._balance = newBalance;
                    this._lastBalanceRefresh = 0;
                    await this.refreshBalance(true);
                    log(`Deposited $${(Number(depositAmount) / TOKEN_DECIMALS).toFixed(2)}. Account balance: $${this.balanceUsd.toFixed(2)}`);
                }
                catch (e) {
                    log(`Deposit failed: ${String(e).slice(0, 150)}`);
                }
            }
            if (this._faucetCallsRemaining <= 0) {
                this._faucetCallsRemaining = 0;
                await this.refreshBalance(true);
                log(`Refill complete. Account balance: $${this.balanceUsd.toFixed(2)}`);
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
            availableUsd: Math.round(this.balanceUsd * 100) / 100,
            lockedUsd: Math.round(this.lockedBalanceUsd * 100) / 100,
            totalUsd: Math.round(this.totalBalanceUsd * 100) / 100,
            balanceUsd: Math.round(this.balanceUsd * 100) / 100,
            tier: this.profile.tier,
            discipline: this.profile.discipline,
            maxOrderCost: this.config.maxOrderCost,
            refillTarget: this.config.refillTarget,
        };
    }
}
