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
export declare function runMaker(): Promise<MakerResult>;
