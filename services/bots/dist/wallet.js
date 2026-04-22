const TIER_CONFIG = {
    low: { dailyBudget: 5, maxOrderCost: 2, paycheck: 70 },
    medium: { dailyBudget: 15, maxOrderCost: 5, paycheck: 210 },
    high: { dailyBudget: 50, maxOrderCost: 25, paycheck: 700 },
};
const PAY_PERIOD_DAYS = 14;
const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10
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
    constructor(candid, profile) {
        this.candid = candid;
        this.profile = profile;
        this.config = TIER_CONFIG[profile.tier];
        // First boot = payday is now (will trigger funding on first check)
        this._lastPayday = new Date();
        this._lastPayday.setDate(this._lastPayday.getDate() - PAY_PERIOD_DAYS); // Force immediate payday
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
        return this.dayOfPeriod > PAY_PERIOD_DAYS;
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
    /** Run payday: top up from faucet if due */
    async runPaydayIfDue(faucetFn, log) {
        if (!this.isPaydayDue)
            return false;
        // Calculate how many faucet calls needed
        const numCalls = Math.ceil(this.config.paycheck / FAUCET_AMOUNT_USD);
        log(`Payday! Depositing ~$${this.config.paycheck} (${numCalls} faucet calls)...`);
        let successCount = 0;
        for (let i = 0; i < numCalls; i++) {
            try {
                await faucetFn();
                successCount++;
            }
            catch (e) {
                log(`Faucet call ${i + 1}/${numCalls} failed: ${String(e).slice(0, 100)}`);
            }
        }
        // Reset period tracking
        this._lastPayday = new Date();
        this._spentThisPeriod = 0;
        this._spentToday = 0;
        this._lastSpendDate = this._todayStr();
        // Refresh balance after funding
        await this.refreshBalance(true);
        log(`Payday complete: ${successCount}/${numCalls} deposits. Balance: $${this.balanceUsd.toFixed(2)}`);
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
