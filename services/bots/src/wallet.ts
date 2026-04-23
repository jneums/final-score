import { CandidClient } from "./candid-client.js";

// Budget tiers in USD
export type BudgetTier = "low" | "medium" | "high";
export type Discipline = "disciplined" | "moderate" | "impulsive";

export interface BudgetProfile {
  tier: BudgetTier;
  discipline: Discipline;
}

const TIER_CONFIG = {
  low:    { maxOrderCost: 2,  refillTarget: 20 },
  medium: { maxOrderCost: 5,  refillTarget: 50 },
  high:   { maxOrderCost: 25, refillTarget: 100 },
};

const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10
const LOW_BALANCE_USD = 5; // trigger refill below this
const FAUCET_CALLS_PER_CYCLE = 3; // max faucet calls per bot per 30s cycle

// ─── Global faucet concurrency limiter ──────────────────────
const MAX_CONCURRENT_FAUCET = 3;
let activeFaucetCalls = 0;
const faucetWaiters: Array<() => void> = [];

export async function enqueueFaucetCall(fn: () => Promise<void>): Promise<void> {
  if (activeFaucetCalls >= MAX_CONCURRENT_FAUCET) {
    await new Promise<void>((resolve) => faucetWaiters.push(resolve));
  }

  activeFaucetCalls++;
  try {
    await fn();
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    activeFaucetCalls--;
    const next = faucetWaiters.shift();
    if (next) next();
  }
}

export class BotWallet {
  private candid: CandidClient;
  private profile: BudgetProfile;
  private config: typeof TIER_CONFIG["low"];

  // State
  private _balance: bigint = BigInt(0);
  private _lastBalanceRefresh: number = 0;
  /** Remaining faucet calls for in-progress refill (0 = no refill in progress) */
  private _faucetCallsRemaining: number = 0;
  /** Guard against overlapping refill calls */
  private _refillRunning: boolean = false;

  constructor(candid: CandidClient, profile: BudgetProfile) {
    this.candid = candid;
    this.profile = profile;
    this.config = TIER_CONFIG[profile.tier];
  }

  // ─── Getters ──────────────────────────────────────────────

  get balance(): bigint { return this._balance; }
  get balanceUsd(): number { return Number(this._balance) / TOKEN_DECIMALS; }
  get maxOrderCost(): number { return this.config.maxOrderCost; }

  // ─── Core Methods ─────────────────────────────────────────

  /** Check if bot can afford a trade of this USD cost */
  canAfford(estimatedCostUsd: number): boolean {
    return this.balanceUsd >= estimatedCostUsd + 0.10; // $0.10 buffer for fees
  }

  /** Refresh balance from chain (respects cache) */
  async refreshBalance(force = false): Promise<bigint> {
    const now = Date.now();
    if (!force && now - this._lastBalanceRefresh < BALANCE_CACHE_MS) {
      return this._balance;
    }
    try {
      this._balance = await this.candid.getBalance();
      this._lastBalanceRefresh = now;
    } catch {
      // Keep stale balance on failure
    }
    return this._balance;
  }

  /**
   * Lazy refill: if balance is low, top up from faucet.
   * Does at most FAUCET_CALLS_PER_CYCLE calls per invocation.
   * Returns true if refill is in progress.
   */
  async refillIfNeeded(
    faucetFn: () => Promise<void>,
    log: (msg: string) => void,
  ): Promise<boolean> {
    if (this._refillRunning) return true;

    // Start a new refill if balance is low and none in progress
    if (this._faucetCallsRemaining === 0) {
      if (this.balanceUsd >= LOW_BALANCE_USD) return false;
      this._faucetCallsRemaining = Math.ceil(this.config.refillTarget / FAUCET_AMOUNT_USD);
      log(`Low balance ($${this.balanceUsd.toFixed(2)}). Refilling ~$${this.config.refillTarget} (${this._faucetCallsRemaining} faucet calls)...`);
    }

    this._refillRunning = true;
    try {
      const batch = Math.min(this._faucetCallsRemaining, FAUCET_CALLS_PER_CYCLE);
      for (let i = 0; i < batch; i++) {
        try {
          await enqueueFaucetCall(faucetFn);
        } catch (e) {
          log(`Faucet call failed: ${String(e).slice(0, 100)}`);
        }
        this._faucetCallsRemaining--;
      }

      if (this._faucetCallsRemaining <= 0) {
        this._faucetCallsRemaining = 0;
        await this.refreshBalance(true);
        log(`Refill complete. Balance: $${this.balanceUsd.toFixed(2)}`);
      } else {
        log(`Refill progress: ${this._faucetCallsRemaining} calls remaining`);
      }

      return true;
    } finally {
      this._refillRunning = false;
    }
  }

  /** Get a summary for stats endpoint */
  toJSON(): Record<string, unknown> {
    return {
      balanceUsd: Math.round(this.balanceUsd * 100) / 100,
      tier: this.profile.tier,
      discipline: this.profile.discipline,
      maxOrderCost: this.config.maxOrderCost,
      refillTarget: this.config.refillTarget,
    };
  }
}
