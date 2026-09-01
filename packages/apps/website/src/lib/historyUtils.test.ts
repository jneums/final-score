import { describe, expect, it } from 'vitest';
import { formatHistoryPnl, historyOutcomeBadgeClass } from './historyUtils';

describe('history display helpers', () => {
  it('formats realized gain/loss from payout minus cost basis', () => {
    expect(formatHistoryPnl(196_000_000, 120_000_000)).toBe('+$0.76');
    expect(formatHistoryPnl(0, 120_000_000)).toBe('-$1.20');
    expect(formatHistoryPnl(120_000_000, 120_000_000)).toBe('$0.00');
  });

  it('styles held side by whether it matched the resolved market outcome', () => {
    expect(historyOutcomeBadgeClass('Yes', 'Yes')).toContain('text-green-400');
    expect(historyOutcomeBadgeClass('No', 'Yes')).toContain('text-red-400');
  });
});
