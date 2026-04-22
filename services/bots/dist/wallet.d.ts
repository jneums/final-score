import { CandidClient } from "./candid-client.js";
export type BudgetTier = "low" | "medium" | "high";
export type Discipline = "disciplined" | "moderate" | "impulsive";
export interface BudgetProfile {
    tier: BudgetTier;
    discipline: Discipline;
}
export declare function enqueueFaucetCall(fn: () => Promise<void>): Promise<void>;
export declare class BotWallet {
    private candid;
    private profile;
    private config;
    private _balance;
    private _lastBalanceRefresh;
    private _lastPayday;
    private _spentToday;
    private _spentThisPeriod;
    private _lastSpendDate;
    private _paydayJitterMs;
    private _booted;
    /** Remaining faucet calls for current payday (0 = no payday in progress) */
    private _faucetCallsRemaining;
    constructor(candid: CandidClient, profile: BudgetProfile);
    get balance(): bigint;
    get balanceUsd(): number;
    get dailyBudget(): number;
    get maxOrderCost(): number;
    get spentToday(): number;
    get spentThisPeriod(): number;
    get paycheck(): number;
    get remainingBudget(): number;
    get dayOfPeriod(): number;
    get daysUntilPayday(): number;
    get isPaydayDue(): boolean;
    get dailySpendLimit(): number;
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd: number): boolean;
    /** Record a spend (call after successful order placement) */
    recordSpend(usd: number): void;
    /** Refresh balance from chain (respects cache) */
    refreshBalance(force?: boolean): Promise<bigint>;
    /** Run payday: top up from faucet if due.
     *  Does at most FAUCET_CALLS_PER_CYCLE calls per invocation.
     *  Returns true if payday is in progress or just completed.
     *  Call every cycle — it picks up where it left off.
     */
    runPaydayIfDue(faucetFn: () => Promise<void>, log: (msg: string) => void): Promise<boolean>;
    /** Get a summary for stats endpoint */
    toJSON(): Record<string, unknown>;
    private _todayStr;
    private _resetDailyIfNeeded;
}
