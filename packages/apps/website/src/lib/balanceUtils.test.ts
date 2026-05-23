import { describe, expect, it } from 'vitest';
import { formatTokenAmount, parseTokenAmount } from './balanceUtils';

describe('balanceUtils', () => {
  it('formats atomic token balances with fixed cents', () => {
    expect(formatTokenAmount(BigInt('1234567890'), 8)).toBe('$12.35');
    expect(formatTokenAmount(BigInt('100000000000'), 8)).toBe('$1,000.00');
  });

  it('formats atomic token balances for exact input values', async () => {
    const { formatTokenInputValue } = await import('./balanceUtils');
    expect(formatTokenInputValue(BigInt('123456789'), 8)).toBe('1.23456789');
    expect(formatTokenInputValue(BigInt('100000000'), 8)).toBe('1');
    expect(formatTokenInputValue(BigInt('100000010'), 8)).toBe('1.0000001');
  });

  it('parses decimal user amounts into atomic units without floating point drift', () => {
    expect(parseTokenAmount('12.34', 8)).toBe(BigInt('1234000000'));
    expect(parseTokenAmount('0.00000001', 8)).toBe(BigInt('1'));
    expect(parseTokenAmount('1.234567899', 8)).toBe(BigInt('123456789'));
  });

  it('rejects empty, zero, negative, and malformed amounts', () => {
    expect(parseTokenAmount('', 8)).toBeNull();
    expect(parseTokenAmount('0', 8)).toBeNull();
    expect(parseTokenAmount('-1', 8)).toBeNull();
    expect(parseTokenAmount('1.2.3', 8)).toBeNull();
  });
});
