/**
 * Market Maker — Polymarket-following, two-sided quoting.
 *
 * Strategy: Read Polymarket reference prices, place symmetric Buy Yes + Buy No
 * orders around that reference. Cancel and re-quote when prices drift.
 *
 * Uses a separate DFX identity (MAKER_IDENTITY_PEM) so orders are distinguishable
 * from admin actions.
 */
export interface MakerResult {
    marketsChecked: number;
    marketsQuoted: number;
    marketsSkipped: number;
    ordersPlaced: number;
    ordersCancelled: number;
    ordersKept: number;
    errors: number;
    cursor: string;
}
export declare function getMakerLogs(): string[];
/** Queue a conditionId for reactive re-quote (called from ws.ts). */
export declare function queueRequote(conditionId: string): void;
export interface SeedResult {
    marketsFound: number;
    marketsUnquoted: number;
    marketsSeeded: number;
    marketsSkipped: number;
    ordersPlaced: number;
    errors: number;
}
export declare function isSeedActive(): boolean;
/**
 * Seed mode: find all open markets that have NO maker orders and quote them.
 * No per-tick cap — runs through every unquoted market in one pass.
 * Uses the batch requote_market endpoint (cancel-all + place-all per market).
 *
 * Called:
 * 1. After sync creates new markets (automatic)
 * 2. Via POST /maker/seed (manual recovery after state wipe)
 * 3. On startup if many markets are unquoted
 */
export declare function seedUnquotedMarkets(): Promise<SeedResult>;
export interface ReplenishResult {
    marketsChecked: number;
    marketsDepleted: number;
    marketsReplenished: number;
    ordersPlaced: number;
    ordersCancelled: number;
    errors: number;
}
export declare function isReplenishActive(): boolean;
/**
 * Replenishment job: find markets where orders have been filled (fewer than
 * desired count on the book) and restock them at current cached prices.
 *
 * Unlike seedUnquotedMarkets (which only finds markets with ZERO orders),
 * this finds markets with FEWER than expected orders — partial depletion
 * from user/bot fills while Polymarket prices haven't moved.
 *
 * Unlike the WS reactive path (which only fires on price drift), this
 * runs on a timer regardless of price movement.
 */
export declare function replenishDepleted(): Promise<ReplenishResult>;
export declare function runMaker(): Promise<MakerResult>;
