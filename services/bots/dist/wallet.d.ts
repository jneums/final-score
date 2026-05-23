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
    private _lockedBalance;
    private _totalBalance;
    private _lastBalanceRefresh;
    /** Remaining faucet calls for in-progress refill (0 = no refill in progress) */
    private _faucetCallsRemaining;
    /** Guard against overlapping refill calls */
    private _refillRunning;
    constructor(candid: CandidClient, profile: BudgetProfile);
    get balance(): bigint;
    get balanceUsd(): number;
    get lockedBalance(): bigint;
    get lockedBalanceUsd(): number;
    get totalBalance(): bigint;
    get totalBalanceUsd(): number;
    get maxOrderCost(): number;
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd: number): boolean;
    /** Refresh custodial account balance from the Final Score canister (respects cache) */
    refreshBalance(force?: boolean): Promise<bigint>;
    /**
     * Lazy refill: if custodial balance is low, top up the wallet from faucet,
     * approve one batch deposit, and deposit into the Final Score account.
     * Does at most FAUCET_CALLS_PER_CYCLE faucet calls per invocation.
     * Returns true if refill is in progress.
     */
    refillIfNeeded(faucetFn: () => Promise<void>, depositFn: (amount: bigint) => Promise<bigint>, log: (msg: string) => void): Promise<boolean>;
    /** Get a summary for stats endpoint */
    toJSON(): Record<string, unknown>;
}
