import { Principal } from '@icp-sdk/core/principal';
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
export const createToken = (info) => {
    return {
        ...info,
        toAtomic: (amount) => toAtomicAmount(amount, info.decimals),
        fromAtomic: (atomicAmount) => fromAtomicAmount(atomicAmount, info.decimals),
    };
};
// --- SINGLETON TOKEN (initialized dynamically) ---
let _token = null;
/**
 * Initialize the token from canister metadata.
 * Call this once at app startup after configure().
 */
export function initToken(info) {
    _token = createToken({
        canisterId: Principal.fromText(info.ledger),
        name: info.symbol,
        symbol: info.symbol,
        decimals: info.decimals,
        fee: info.fee,
    });
    return _token;
}
/**
 * Get the current token. Throws if not initialized.
 */
export function getToken() {
    if (!_token) {
        throw new Error('Token not initialized. Call initToken() at app startup after fetching token info from the canister.');
    }
    return _token;
}
