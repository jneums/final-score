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
    /** Remaining faucet calls for in-progress refill (0 = no refill in progress) */
    private _faucetCallsRemaining;
    /** Guard against overlapping refill calls */
    private _refillRunning;
    constructor(candid: CandidClient, profile: BudgetProfile);
    get balance(): bigint;
    get balanceUsd(): number;
    get maxOrderCost(): number;
    /** Check if bot can afford a trade of this USD cost */
    canAfford(estimatedCostUsd: number): boolean;
    /** Refresh balance from chain (respects cache) */
    refreshBalance(force?: boolean): Promise<bigint>;
    /**
     * Lazy refill: if balance is low, top up from faucet.
     * Does at most FAUCET_CALLS_PER_CYCLE calls per invocation.
     * Returns true if refill is in progress.
     */
    refillIfNeeded(faucetFn: () => Promise<void>, log: (msg: string) => void): Promise<boolean>;
    /** Get a summary for stats endpoint */
    toJSON(): Record<string, unknown>;
}
