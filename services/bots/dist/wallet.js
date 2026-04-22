const TIER_CONFIG = {
    low: { dailyBudget: 5, maxOrderCost: 2, paycheck: 70 },
    medium: { dailyBudget: 15, maxOrderCost: 5, paycheck: 210 },
    high: { dailyBudget: 50, maxOrderCost: 25, paycheck: 700 },
};
const PAY_PERIOD_DAYS = 14;
const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10
const FAUCET_DELAY_MS = 2500; // delay between faucet calls to avoid rate limits
const FAUCET_CALLS_PER_CYCLE = 3; // max faucet calls per bot per 30s cycle
// ─── Global faucet semaphore ────────────────────────────────
// Only one bot can call the faucet at a time. Others queue up.
// Prevents concurrent faucet calls from overwhelming the canister.
let faucetQueue = Promise.resolve();
export function enqueueFaucetCall(fn) {
    const next = faucetQueue.then(async () => {
        await fn();
        await new Promise((r) => setTimeout(r, FAUCET_DELAY_MS));
    }).catch(() => {
        // Don't let one failure break the chain
    });
    faucetQueue = next;
    return next;
}
export class BotWallet {
    candid;
    profile;
    config;
    // State
    _balance = BigInt(0);
    _lastBalanceRefresh = 0;
    _lastPayday;
    _spentToday = 0;
    _spentThisPeriod = 0;
    _lastSpendDate = ""; // YYYY-MM-DD for daily reset
    _paydayJitterMs = 0;
    _booted = false;
    /** Remaining faucet calls for current payday (0 = no payday in progress) */
    _faucetCallsRemaining = 0;
    constructor(candid, profile) {
        this.candid = candid;
        this.profile = profile;
        this.config = TIER_CONFIG[profile.tier];
        // First boot = payday is due, but add random jitter (0-60s) so bots
        // don't all slam the faucet at the exact same moment
        this._lastPayday = new Date();
        this._lastPayday.setDate(this._lastPayday.getDate() - PAY_PERIOD_DAYS);
        this._paydayJitterMs = Math.floor(Math.random() * 60_000);
        this._booted = false;
    }
    // ─── Getters ──────────────────────────────────────────────
    get balance() { return this._balance; }
    get balanceUsd() { return Number(this._balance) / TOKEN_DECIMALS; }
    get dailyBudget() { return this.config.dailyBudget; }
    get maxOrderCost() { return this.config.maxOrderCost; }
    get spentToday() { return this._spentToday; }
    get spentThisPeriod() { return this._spentThisPeriod; }
    get paycheck() { return this.config.paycheck; }
    get remainingBudget() {
        return Math.max(0, this.config.paycheck - this._spentThisPeriod);
    }
    get dayOfPeriod() {
        const elapsed = Date.now() - this._lastPayday.getTime();
        return Math.min(PAY_PERIOD_DAYS, Math.floor(elapsed / (24 * 60 * 60 * 1000)) + 1);
    }
    get daysUntilPayday() {
        return Math.max(0, PAY_PERIOD_DAYS - this.dayOfPeriod);
    }
    get isPaydayDue() {
        return this.dayOfPeriod >= PAY_PERIOD_DAYS;
    }
    // ─── Daily spend limit based on discipline ────────────────
    get dailySpendLimit() {
        const remaining = this.remainingBudget;
        const daysLeft = Math.max(1, this.daysUntilPayday + 1); // +1 for today
        switch (this.profile.discipline) {
            case "disciplined":
                // Even spread: never exceed dailyBudget
                return Math.min(this.config.dailyBudget, remaining);
            case "moderate":
                // Slight front-load: up to 1.5x daily, but pace to remaining days
                const pacedRate = remaining / daysLeft;
                return Math.min(this.config.dailyBudget * 1.5, pacedRate * 1.5, remaining);
            case "impulsive":
                // YOLO: up to 3x daily, no pacing
                return Math.min(this.config.dailyBudget * 3, remaining);
        }
    }
    // ─── Core Methods ─────────────────────────────────────────
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd) {
        // Check daily budget
        if (this._spentToday + estimatedCostUsd > this.dailySpendLimit)
            return false;
        // Check period budget
        if (this._spentThisPeriod + estimatedCostUsd > this.config.paycheck)
            return false;
        // Check actual balance
        if (this.balanceUsd < estimatedCostUsd + 0.10)
            return false; // $0.10 buffer for fees
        return true;
    }
    /** Record a spend (call after successful order placement) */
    recordSpend(usd) {
        this._resetDailyIfNeeded();
        this._spentToday += usd;
        this._spentThisPeriod += usd;
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
    /** Run payday: top up from faucet if due.
     *  Does at most FAUCET_CALLS_PER_CYCLE calls per invocation.
     *  Returns true if payday is in progress or just completed.
     *  Call every cycle — it picks up where it left off.
     */
    async runPaydayIfDue(faucetFn, log) {
        // Start a new payday if due and not already in progress
        if (this._faucetCallsRemaining === 0) {
            if (!this.isPaydayDue)
                return false;
            // First-boot jitter: wait 0-60s so bots don't all hit faucet simultaneously
            if (!this._booted) {
                this._booted = true;
                if (this._paydayJitterMs > 0) {
                    log(`Payday jitter: waiting ${Math.round(this._paydayJitterMs / 1000)}s...`);
                    await new Promise((r) => setTimeout(r, this._paydayJitterMs));
                }
            }
            this._faucetCallsRemaining = Math.ceil(this.config.paycheck / FAUCET_AMOUNT_USD);
            log(`Payday! Need ~$${this.config.paycheck} (${this._faucetCallsRemaining} faucet calls, ${FAUCET_CALLS_PER_CYCLE}/cycle)...`);
        }
        // Do up to FAUCET_CALLS_PER_CYCLE this cycle
        const batch = Math.min(this._faucetCallsRemaining, FAUCET_CALLS_PER_CYCLE);
        let successCount = 0;
        for (let i = 0; i < batch; i++) {
            try {
                await enqueueFaucetCall(faucetFn);
                successCount++;
            }
            catch (e) {
                log(`Faucet call failed: ${String(e).slice(0, 100)}`);
            }
            this._faucetCallsRemaining--;
        }
        // If all calls done, finalize payday
        if (this._faucetCallsRemaining <= 0) {
            this._faucetCallsRemaining = 0;
            this._lastPayday = new Date();
            this._spentThisPeriod = 0;
            this._spentToday = 0;
            this._lastSpendDate = this._todayStr();
            await this.refreshBalance(true);
            log(`Payday complete. Balance: $${this.balanceUsd.toFixed(2)}`);
        }
        else {
            log(`Payday progress: ${this._faucetCallsRemaining} calls remaining`);
        }
        return true;
    }
    /** Get a summary for stats endpoint */
    toJSON() {
        return {
            balanceUsd: Math.round(this.balanceUsd * 100) / 100,
            tier: this.profile.tier,
            discipline: this.profile.discipline,
            dailyBudget: this.config.dailyBudget,
            spentToday: Math.round(this._spentToday * 100) / 100,
            spentThisPeriod: Math.round(this._spentThisPeriod * 100) / 100,
            remainingBudget: Math.round(this.remainingBudget * 100) / 100,
            dayOfPeriod: this.dayOfPeriod,
            daysUntilPayday: this.daysUntilPayday,
            dailySpendLimit: Math.round(this.dailySpendLimit * 100) / 100,
            maxOrderCost: this.config.maxOrderCost,
        };
    }
    // ─── Private ──────────────────────────────────────────────
    _todayStr() {
        return new Date().toISOString().slice(0, 10);
    }
    _resetDailyIfNeeded() {
        const today = this._todayStr();
        if (this._lastSpendDate !== today) {
            this._spentToday = 0;
            this._lastSpendDate = today;
        }
    }
}
