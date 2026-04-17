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
/**
 * Centralized token registry. Tokens are created lazily so the config
 * system is initialized first.
 */
export declare const Tokens: {
    readonly USDC: Token;
};
