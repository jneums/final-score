import { atomicToDollars } from './tokenUtils';

export function formatHistoryPnl(payout: number, costBasis: number): string {
  const pnl = payout - costBasis;
  if (pnl === 0) return '$0.00';
  const sign = pnl > 0 ? '+' : '-';
  return `${sign}$${Math.abs(atomicToDollars(pnl)).toFixed(2)}`;
}

export function historyOutcomeBadgeClass(heldOutcome: string, resolvedOutcome: string): string {
  const won = heldOutcome === resolvedOutcome;
  return won ? 'text-green-400 border-green-500/30' : 'text-red-400 border-red-500/30';
}
