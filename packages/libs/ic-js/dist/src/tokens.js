import { Principal } from '@icp-sdk/core/principal';
import { getCanisterId } from './config.js';
// --- CORE CONVERSION LOGIC (Internal Helpers) ---
/**
 * Converts a human-readable token amount into its atomic representation.
 * This is the generic, internal implementation.
 */
const toAtomicAmount = (amount, decimals) => {
    const amountStr = String(amount);
    const [integerPart, fractionalPart = ''] = amountStr.split('.');
    if (fractionalPart.length > decimals) {
        throw new Error(`Amount "${amountStr}" has more than ${decimals} decimal places.`);
    }
    const combined = (integerPart || '0') + fractionalPart.padEnd(decimals, '0');
    return BigInt(combined);
};
/**
 * Converts an atomic token amount into its human-readable string representation.
 * This is the generic, internal implementation.
 */
const fromAtomicAmount = (atomicAmount, decimals) => {
    const atomicStr = atomicAmount.toString().padStart(decimals + 1, '0');
    const integerPart = atomicStr.slice(0, -decimals);
    const fractionalPart = atomicStr.slice(-decimals).replace(/0+$/, '');
    return fractionalPart.length > 0
        ? `${integerPart}.${fractionalPart}`
        : integerPart;
};
// --- TOKEN FACTORY ---
/**
 * A factory function that takes basic token info and returns an enhanced Token object
 * with attached conversion methods.
 * @param info The base TokenInfo object.
 * @returns An enhanced Token object.
 */
const createToken = (info) => {
    return {
        ...info,
        toAtomic: (amount) => toAtomicAmount(amount, info.decimals),
        fromAtomic: (atomicAmount) => fromAtomicAmount(atomicAmount, info.decimals),
    };
};
// --- TOKEN DEFINITIONS ---
/**
 * Gets the USDC token configuration with the correct canister ID from the config system.
 * This ensures we use the right ledger for the current environment (local/mainnet).
 */
const getUSDCToken = () => {
    return createToken({
        canisterId: Principal.fromText(getCanisterId('USDC_LEDGER')),
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        fee: 10000, // Standard fee for ckUSDC is 10 e6s (0.01 USDC)
    });
};
/**
 * The centralized, exported registry of all supported tokens.
 * Each token object is enhanced with its own `toAtomic` and `fromAtomic` methods.
 * Tokens are created lazily to ensure the config system is initialized first.
 */
export const Tokens = {
    get USDC() {
        return getUSDCToken();
    },
};
