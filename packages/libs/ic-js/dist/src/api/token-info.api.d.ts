export interface TokenInfoResponse {
    ledger: string;
    symbol: string;
    decimals: number;
    fee: number;
}
/**
 * Fetch token metadata from the Final Score canister.
 * Returns the configured token's ledger principal, symbol, decimals, and fee.
 */
export declare function getTokenInfo(): Promise<TokenInfoResponse>;
