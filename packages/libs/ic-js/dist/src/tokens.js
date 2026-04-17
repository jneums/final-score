import { Principal } from '@icp-sdk/core/principal';
import { getCanisterId } from './config.js';
// --- CORE CONVERSION LOGIC ---
const toAtomicAmount = (amount, decimals) => {
    const amountStr = String(amount);
    const [integerPart, fractionalPart = ''] = amountStr.split('.');
    if (fractionalPart.length > decimals) {
        throw new Error(`Amount "${amountStr}" has more than ${decimals} decimal places.`);
    }
    const combined = (integerPart || '0') + fractionalPart.padEnd(decimals, '0');
    return BigInt(combined);
};
const fromAtomicAmount = (atomicAmount, decimals) => {
    const atomicStr = atomicAmount.toString().padStart(decimals + 1, '0');
    const integerPart = atomicStr.slice(0, -decimals);
    const fractionalPart = atomicStr.slice(-decimals).replace(/0+$/, '');
    return fractionalPart.length > 0
        ? `${integerPart}.${fractionalPart}`
        : integerPart;
};
// --- TOKEN FACTORY ---
const createToken = (info) => {
    return {
        ...info,
        toAtomic: (amount) => toAtomicAmount(amount, info.decimals),
        fromAtomic: (atomicAmount) => fromAtomicAmount(atomicAmount, info.decimals),
    };
};
// --- TOKEN DEFINITIONS ---
/**
 * Gets the USDC token configuration.
 * USDC on ICP (ckUSDC) uses 6 decimals and a 10_000 fee (0.01 USDC).
 */
const getUSDCToken = () => {
    return createToken({
        canisterId: Principal.fromText(getCanisterId('USDC_LEDGER')),
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        fee: 10000,
    });
};
/**
 * Centralized token registry. Tokens are created lazily so the config
 * system is initialized first.
 */
export const Tokens = {
    get USDC() {
        return getUSDCToken();
    },
};
