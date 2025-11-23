import { Principal } from '@icp-sdk/core/principal';
/**
 * The base information required to define a token.
 */
export interface TokenInfo {
    canisterId: Principal;
    name: string;
    symbol: string;
    decimals: number;
    fee: number;
}
/**
 * The enhanced Token object, which includes conversion methods.
 * This is the object you will interact with throughout the app.
 */
export interface Token extends TokenInfo {
    /** Converts a human-readable amount to its atomic unit (bigint). */
    toAtomic: (amount: string | number) => bigint;
    /** Converts an atomic amount (bigint) to a human-readable string. */
    fromAtomic: (atomicAmount: bigint) => string;
}
/**
 * The centralized, exported registry of all supported tokens.
 * Each token object is enhanced with its own `toAtomic` and `fromAtomic` methods.
 * Tokens are created lazily to ensure the config system is initialized first.
 */
export declare const Tokens: {
    readonly USDC: Token;
};
