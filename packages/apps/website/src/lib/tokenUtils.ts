import { getToken } from '@final-score/ic-js';

/**
 * Get the atomic unit divisor for the current token (10^decimals).
 * Use this instead of hardcoded 1_000_000 (6 decimals).
 */
export function atomicDivisor(): number {
  try {
    return 10 ** getToken().decimals;
  } catch {
    // Fallback if token not yet initialized
    return 100_000_000; // 8 decimals (test faucet default)
  }
}

/**
 * Convert atomic token amount to human-readable dollar amount.
 */
export function atomicToDollars(atomic: number): number {
  return atomic / atomicDivisor();
}

/**
 * Compute the current value of a position in atomic units.
 * shares * priceBps * SHARE_VALUE / BPS_DENOM
 */
export function positionCurrentValue(shares: number, priceBps: number): number {
  return (shares * priceBps * atomicDivisor()) / 10_000;
}

/**
 * Format a PnL value (in atomic units) as a dollar string.
 */
export function formatPnl(pnl: number): string {
  const abs = Math.abs(atomicToDollars(pnl));
  return pnl >= 0 ? `+$${abs.toFixed(2)}` : `-$${abs.toFixed(2)}`;
}

/**
 * Format an atomic amount as a dollar string (no sign).
 */
export function formatDollars(atomic: number, maximumFractionDigits = 2): string {
  return `$${atomicToDollars(atomic).toLocaleString(undefined, { maximumFractionDigits })}`;
}
