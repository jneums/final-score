import { Principal } from '@icp-sdk/core/principal';
import { getCanisterId } from './config.js';

// --- TYPE DEFINITIONS ---

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

// --- CORE CONVERSION LOGIC ---

const toAtomicAmount = (amount: string | number, decimals: number): bigint => {
  const amountStr = String(amount);
  const [integerPart, fractionalPart = ''] = amountStr.split('.');

  if (fractionalPart.length > decimals) {
    throw new Error(
      `Amount "${amountStr}" has more than ${decimals} decimal places.`,
    );
  }
  const combined = (integerPart || '0') + fractionalPart.padEnd(decimals, '0');
  return BigInt(combined);
};

const fromAtomicAmount = (atomicAmount: bigint, decimals: number): string => {
  const atomicStr = atomicAmount.toString().padStart(decimals + 1, '0');
  const integerPart = atomicStr.slice(0, -decimals);
  const fractionalPart = atomicStr.slice(-decimals).replace(/0+$/, '');

  return fractionalPart.length > 0
    ? `${integerPart}.${fractionalPart}`
    : integerPart;
};

// --- TOKEN FACTORY ---

const createToken = (info: TokenInfo): Token => {
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
const getUSDCToken = (): Token => {
  return createToken({
    canisterId: Principal.fromText(getCanisterId('USDC_LEDGER')),
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    fee: 10_000,
  });
};

/**
 * Centralized token registry. Tokens are created lazily so the config
 * system is initialized first.
 */
export const Tokens = {
  get USDC(): Token {
    return getUSDCToken();
  },
};
