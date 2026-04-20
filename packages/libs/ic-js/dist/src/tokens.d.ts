import { Principal } from '@icp-sdk/core/principal';
export interface TokenInfo {
    canisterId: Principal;
    name: string;
    symbol: string;
    decimals: number;
    fee: number;
}
export interface Token extends TokenInfo {
    /** Converts a human-readable amount to its atomic unit (bigint). */
    toAtomic: (amount: string | number) => bigint;
    /** Converts an atomic amount (bigint) to a human-readable string. */
    fromAtomic: (atomicAmount: bigint) => string;
}
export declare const createToken: (info: TokenInfo) => Token;
/**
 * Initialize the token from canister metadata.
 * Call this once at app startup after configure().
 */
export declare function initToken(info: {
    ledger: string;
    symbol: string;
    decimals: number;
    fee: number;
}): Token;
/**
 * Get the current token. Throws if not initialized.
 */
export declare function getToken(): Token;
