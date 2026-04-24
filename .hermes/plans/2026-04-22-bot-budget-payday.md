# Bot Budget & Payday System — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give bots realistic financial behavior — biweekly paydays, daily budgets, spending discipline, and self-funding from faucet.

**Architecture:** Add a `BotWallet` class that tracks balance, pay periods, and spending. Each strategy declares a budget profile (tier + discipline). The engine runs a payday loop alongside the existing bot loop. Bots that overspend go idle until next payday.

**Tech Stack:** TypeScript, existing CandidClient (getBalance, faucet calls)

---

## Context

### Current State
- 15 bots with 10 Candid strategies + 3 MCP strategies
- Bots trade every 30s until broke, then spam InsufficientFunds errors
- Manual faucet top-ups required every ~30 min
- Only Candid bots have a $1 balance floor check
- No concept of spending limits, budgets, or time

### File Layout
```
services/bots/src/
  config.ts          — env vars + constants
  engine.ts          — bot lifecycle, runBot(), init, start/stop
  strategy.ts        — BotContext + Strategy interfaces
  candid-client.ts   — CandidClient (placeOrder, getBalance, etc.)
  mcp-client.ts      — McpClient (MCP JSON-RPC calls)
  mcp-pricing.ts     — smart pricing helpers
  market-utils.ts    — getRandomOpenMarket, getMarketWithLiquidity, etc.
  identity.ts        — key loading
  index.ts           — Express server, logs, stats
  strategies/        — 12 strategy files
```

### Key Interfaces
```typescript
// strategy.ts
interface BotContext {
  name: string;
  candid: CandidClient;
  mcp?: McpClient;
  log: (action, result, message) => void;
}

interface Strategy {
  name: string;
  description: string;
  tier: "candid" | "mcp";
  act: (ctx: BotContext) => Promise<void>;
}
```

### Faucet
Each faucet call (`transfer_icrc1`) gives ~$10 of TICRC1 test tokens (8 decimals).
Faucet canister: `nqoci-rqaaa-aaaap-qp53q-cai`
Already wired up in CandidClient setup but not used at runtime.

---

## Design

### Budget Tiers

| Tier   | Daily Budget | Biweekly Pay | Max Order | Strategies |
|--------|-------------|--------------|-----------|------------|
| low    | $5/day      | $70          | $2        | penny-bidder, mcp-portfolio-viewer, scalper |
| medium | $15/day     | $210         | $5        | favorite-buyer, underdog-hunter, hedger, panic-seller, portfolio-builder, mcp-casual-bettor, mcp-full-flow |
| high   | $50/day     | $700         | $25       | whale |

### Spending Discipline

Each strategy also has a `discipline` trait that controls how it paces spending:

- **disciplined**: Spends evenly. Daily spend capped at `dailyBudget`. Never front-loads.
  → scalper, hedger, mcp-portfolio-viewer, mcp-full-flow
  
- **moderate**: Slight front-loading. Can spend up to 1.5× dailyBudget on active days, 
  compensates by going lighter later. Most "normal user" behavior.
  → favorite-buyer, underdog-hunter, portfolio-builder, mcp-casual-bettor
  
- **impulsive**: Goes hard. Can spend up to 3× dailyBudget early in the period. 
  Often broke by day 8-10. Sits idle until payday.
  → whale, panic-seller, penny-bidder

### Payday Logic

```
Every 14 days (tracked per-bot via lastPayday timestamp):
  1. Calculate paycheck = dailyBudget × 14
  2. Check current balance
  3. Top up from faucet: ceil(paycheck / 10) calls (each gives ~$10)
  4. Reset spentThisPeriod = 0
  5. Log the payday event

On first boot (no lastPayday):
  → Treat as payday immediately
```

### Budget Gate (pre-trade check)

```
Before every act():
  1. Refresh balance (cached, refresh every 5 min)
  2. Check: is today past payday + 14 days? → trigger payday
  3. Calculate dailySpendLimit based on discipline:
     - disciplined: dailyBudget
     - moderate: min(1.5 × dailyBudget, remainingBudget / remainingDays)
     - impulsive: min(3 × dailyBudget, remainingBudget)
  4. If spentToday >= dailySpendLimit → skip ("daily budget exhausted")
  5. If balance < $1 → skip ("waiting for payday")
  6. Set ctx.wallet.maxOrderCost so strategies can self-limit
```

### BotWallet Interface

```typescript
interface BotWallet {
  balance: bigint;              // cached, refreshed every 5 min
  dailyBudget: number;          // in USD (e.g. 15)
  spentToday: number;           // in USD, reset at midnight UTC
  spentThisPeriod: number;      // in USD, reset on payday
  remainingBudget: number;      // paycheck - spentThisPeriod
  maxOrderCost: number;         // per-order cap in USD
  dayOfPeriod: number;          // 1-14
  daysUntilPayday: number;      // countdown
  canAfford: (usd: number) => boolean;  // checks daily + period budget
}
```

Strategies use `ctx.wallet.canAfford(estimatedCost)` before placing orders,
and `ctx.wallet.maxOrderCost` to cap their size.

---

## Tasks

### Task 1: Create BotWallet class

**Objective:** Core wallet with balance tracking, pay period management, and budget calculations.

**Files:**
- Create: `services/bots/src/wallet.ts`

**Code:**

```typescript
import { CandidClient } from "./candid-client.js";

// Budget tiers in USD
export type BudgetTier = "low" | "medium" | "high";
export type Discipline = "disciplined" | "moderate" | "impulsive";

export interface BudgetProfile {
  tier: BudgetTier;
  discipline: Discipline;
}

const TIER_CONFIG = {
  low:    { dailyBudget: 5,  maxOrderCost: 2,  paycheck: 70 },
  medium: { dailyBudget: 15, maxOrderCost: 5,  paycheck: 210 },
  high:   { dailyBudget: 50, maxOrderCost: 25, paycheck: 700 },
};

const PAY_PERIOD_DAYS = 14;
const BALANCE_CACHE_MS = 5 * 60 * 1000; // refresh every 5 min
const TOKEN_DECIMALS = 1e8; // 8 decimals
const FAUCET_AMOUNT_USD = 10; // each faucet call gives ~$10

export class BotWallet {
  private candid: CandidClient;
  private profile: BudgetProfile;
  private config: typeof TIER_CONFIG["low"];

  // State
  private _balance: bigint = BigInt(0);
  private _lastBalanceRefresh: number = 0;
  private _lastPayday: Date;
  private _spentToday: number = 0;
  private _spentThisPeriod: number = 0;
  private _lastSpendDate: string = ""; // YYYY-MM-DD for daily reset

  constructor(candid: CandidClient, profile: BudgetProfile) {
    this.candid = candid;
    this.profile = profile;
    this.config = TIER_CONFIG[profile.tier];
    // First boot = payday is now (will trigger funding on first check)
    this._lastPayday = new Date();
    this._lastPayday.setDate(this._lastPayday.getDate() - PAY_PERIOD_DAYS); // Force immediate payday
  }

  // ─── Getters ──────────────────────────────────────────────

  get balance(): bigint { return this._balance; }
  get balanceUsd(): number { return Number(this._balance) / TOKEN_DECIMALS; }
  get dailyBudget(): number { return this.config.dailyBudget; }
  get maxOrderCost(): number { return this.config.maxOrderCost; }
  get spentToday(): number { return this._spentToday; }
  get spentThisPeriod(): number { return this._spentThisPeriod; }
  get paycheck(): number { return this.config.paycheck; }

  get remainingBudget(): number {
    return Math.max(0, this.config.paycheck - this._spentThisPeriod);
  }

  get dayOfPeriod(): number {
    const elapsed = Date.now() - this._lastPayday.getTime();
    return Math.min(PAY_PERIOD_DAYS, Math.floor(elapsed / (24 * 60 * 60 * 1000)) + 1);
  }

  get daysUntilPayday(): number {
    return Math.max(0, PAY_PERIOD_DAYS - this.dayOfPeriod);
  }

  get isPaydayDue(): boolean {
    return this.dayOfPeriod > PAY_PERIOD_DAYS;
  }

  // ─── Daily spend limit based on discipline ────────────────

  get dailySpendLimit(): number {
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
  canAfford(estimatedCostUsd: number): boolean {
    // Check daily budget
    if (this._spentToday + estimatedCostUsd > this.dailySpendLimit) return false;
    // Check period budget
    if (this._spentThisPeriod + estimatedCostUsd > this.config.paycheck) return false;
    // Check actual balance
    if (this.balanceUsd < estimatedCostUsd + 0.10) return false; // $0.10 buffer for fees
    return true;
  }

  /** Record a spend (call after successful order placement) */
  recordSpend(usd: number): void {
    this._resetDailyIfNeeded();
    this._spentToday += usd;
    this._spentThisPeriod += usd;
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

  /** Run payday: top up from faucet if due */
  async runPaydayIfDue(
    faucetFn: () => Promise<void>,
    log: (msg: string) => void,
  ): Promise<boolean> {
    if (!this.isPaydayDue) return false;

    // Calculate how many faucet calls needed
    const numCalls = Math.ceil(this.config.paycheck / FAUCET_AMOUNT_USD);

    log(`Payday! Depositing ~$${this.config.paycheck} (${numCalls} faucet calls)...`);

    let successCount = 0;
    for (let i = 0; i < numCalls; i++) {
      try {
        await faucetFn();
        successCount++;
      } catch (e) {
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
  toJSON(): Record<string, unknown> {
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

  private _todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private _resetDailyIfNeeded(): void {
    const today = this._todayStr();
    if (this._lastSpendDate !== today) {
      this._spentToday = 0;
      this._lastSpendDate = today;
    }
  }
}
```

### Task 2: Add BudgetProfile to Strategy interface

**Objective:** Each strategy declares its budget tier and discipline.

**Files:**
- Modify: `services/bots/src/strategy.ts`

Replace the entire file:

```typescript
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet, BudgetProfile } from "./wallet.js";

export interface BotContext {
  name: string;
  candid: CandidClient;
  mcp?: McpClient;
  wallet: BotWallet;
  log: (action: string, result: "success" | "error" | "skip", message: string) => void;
}

export interface Strategy {
  name: string;
  description: string;
  tier: "candid" | "mcp";
  budget: BudgetProfile;
  act: (ctx: BotContext) => Promise<void>;
}
```

### Task 3: Add BudgetProfile to every strategy

**Objective:** Declare budget + discipline for each of the 12 strategies.

**Files:** All files in `services/bots/src/strategies/`

Add `budget` field to each strategy's export. The mapping:

| Strategy | Budget | Discipline |
|----------|--------|------------|
| favorite-buyer | medium | moderate |
| underdog-hunter | medium | moderate |
| scalper | low | disciplined |
| whale | high | impulsive |
| hedger | medium | disciplined |
| penny-bidder | low | impulsive |
| portfolio-builder | medium | moderate |
| panic-seller | medium | impulsive |
| mcp-casual-bettor | medium | moderate |
| mcp-portfolio-viewer | low | disciplined |
| mcp-full-flow | medium | disciplined |

Example for favorite-buyer.ts — add after `tier`:
```typescript
  budget: { tier: "medium", discipline: "moderate" },
```

Repeat for all 12 strategy files (including both export files in strategies/).

### Task 4: Add faucet method to CandidClient

**Objective:** CandidClient needs a `callFaucet()` method for self-funding.

**Files:**
- Modify: `services/bots/src/candid-client.ts`

Add to the CandidClient class after `getBalance()`:

```typescript
  async callFaucet(): Promise<void> {
    const faucetActor = Actor.createActor(faucetIdlFactory, {
      agent: await createAgent(this.identity),
      canisterId: CONFIG.FAUCET_CANISTER,
    });
    await faucetActor.transfer_icrc1(this.identity.getPrincipal());
  }
```

Note: `faucetIdlFactory` and `createAgent` are already defined in the file.
The faucet IDL is at line ~145. Need to check if createAgent is accessible 
or if we need to store the agent reference.

Actually, looking at the code, the agent is created in `CandidClient.create()` 
static method and not stored separately. Better to store the agent:

```typescript
// In constructor, add:
private agent: HttpAgent;

// In create(), pass agent:
const client = new CandidClient(actor, tokenActor, identity);
client.agent = agent;
return client;

// Then callFaucet uses this.agent:
async callFaucet(): Promise<void> {
  const faucetActor = Actor.createActor(faucetIdlFactory, {
    agent: this.agent,
    canisterId: CONFIG.FAUCET_CANISTER,
  });
  await (faucetActor as any).transfer_icrc1(this.identity.getPrincipal());
}
```

### Task 5: Integrate BotWallet into engine.ts

**Objective:** Wire up wallet creation, payday checks, and budget gate in the bot run loop.

**Files:**
- Modify: `services/bots/src/engine.ts`

Key changes:

1. Import BotWallet
2. Add `wallet: BotWallet` to BotState
3. Create wallet in initEngine() using strategy's budget profile
4. Replace the Candid-only balance check with unified wallet budget gate
5. Add payday check before each run
6. Expose wallet stats in getStats()

```typescript
// In BotState, add:
wallet: BotWallet;

// In initEngine(), after creating candid:
const wallet = new BotWallet(candid, strategy.budget);

// In runBot(), replace the old balance check with:
// 1. Refresh balance
await state.wallet.refreshBalance();

// 2. Check payday
await state.wallet.runPaydayIfDue(
  () => state.candid.callFaucet(),
  (msg) => addLog(state.identity.name, "payday", "success", msg),
);

// 3. Budget gate (replaces old Candid-only $1 check)
const estimatedCost = state.wallet.maxOrderCost;
if (!state.wallet.canAfford(estimatedCost)) {
  const reason = state.wallet.balanceUsd < 1 
    ? `Broke ($${state.wallet.balanceUsd.toFixed(2)}). ${state.wallet.daysUntilPayday} days until payday.`
    : `Daily budget exhausted ($${state.wallet.spentToday.toFixed(2)}/$${state.wallet.dailySpendLimit.toFixed(2)})`;
  addLog(state.identity.name, "budget", "skip", reason);
  state.stats.runs++;
  state.lastRun = new Date();
  return;
}

// 4. Pass wallet to BotContext:
const ctx: BotContext = {
  name: state.identity.name,
  candid: state.candid,
  mcp: state.mcp,
  wallet: state.wallet,
  // ... log
};

// 5. After successful act(), estimate and record spend:
// (strategies will call wallet.recordSpend() themselves for accuracy)
```

### Task 6: Update strategies to use wallet

**Objective:** Strategies use `ctx.wallet.canAfford()` and `ctx.wallet.recordSpend()`.

**Files:** All strategy files

For each strategy, add budget-awareness:

1. Before placing an order, estimate cost: `price × size / TOKEN_DECIMALS`
2. Check `ctx.wallet.canAfford(estimatedCost)`
3. After successful placement, call `ctx.wallet.recordSpend(actualCost)`
4. Use `ctx.wallet.maxOrderCost` to cap size

Example pattern for a simple strategy (favorite-buyer):
```typescript
// Cap size to budget
const maxSize = Math.floor(ctx.wallet.maxOrderCost / price);
const size = Math.min(randomInt(1, 5), maxSize);
if (size < 1) { ctx.log("favorite-buyer", "skip", "Budget too low for any order"); return; }

// Check affordability
const estimatedCost = price * size;
if (!ctx.wallet.canAfford(estimatedCost)) {
  ctx.log("favorite-buyer", "skip", `Can't afford $${estimatedCost.toFixed(2)}`);
  return;
}

// ... place order ...

if (result.ok) {
  ctx.wallet.recordSpend(estimatedCost);
  // ... log
}
```

### Task 7: Expose wallet stats in API

**Objective:** Add wallet info to engine-stats endpoint for monitoring.

**Files:**
- Modify: `services/bots/src/engine.ts` (getStats function)

In the bot stats object, add wallet data:
```typescript
botStats[name] = {
  strategy: state.strategy.name,
  tier: state.strategy.tier,
  running: state.running,
  lastRun: state.lastRun?.toISOString() ?? null,
  ...state.stats,
  wallet: state.wallet.toJSON(),
};
```

### Task 8: Build, test, deploy

**Objective:** Compile, push, verify on Render.

```bash
cd ~/final-score/services/bots
npm run build
cd ~/final-score
git add services/bots/
git commit -m "feat(bots): budget + payday system

- BotWallet: balance tracking, biweekly paydays, daily budgets
- Strategy profiles: budget tier (low/med/high) + discipline (disciplined/moderate/impulsive)
- Self-funding: auto faucet top-up on payday (~every 14 days)
- Budget gate: unified balance + spend check for all bots (Candid + MCP)
- Wallet stats exposed on /engine-stats endpoint"
git push origin main
```

Then verify:
1. Wait for Render deploy (~2 min)
2. `curl /start` to start engine
3. Check `/engine-stats` — each bot should show `wallet` object
4. Watch for "payday" log entries (should trigger on first boot)
5. Monitor error rates — should see "budget" skips instead of InsufficientFunds errors
