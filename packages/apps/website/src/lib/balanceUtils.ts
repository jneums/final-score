function pow10(decimals: number): bigint {
  let value = BigInt(1);
  for (let i = 0; i < decimals; i += 1) {
    value *= BigInt(10);
  }
  return value;
}

export function parseTokenAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;

  const [wholePart, fractionalPart = ''] = trimmed.split('.');
  const divisor = pow10(decimals);
  const whole = BigInt(wholePart || '0');
  const fractional = (fractionalPart + '0'.repeat(decimals)).slice(0, decimals);
  const atomic = whole * divisor + BigInt(fractional || '0');
  return atomic > BigInt(0) ? atomic : null;
}

export function formatTokenAmount(atomic: bigint, decimals: number): string {
  const divisor = pow10(decimals);
  const whole = atomic / divisor;
  const remainder = atomic % divisor;
  const cents = (remainder * BigInt(100) + divisor / BigInt(2)) / divisor;
  const displayWhole = whole + cents / BigInt(100);
  const displayCents = cents % BigInt(100);
  return `$${displayWhole.toLocaleString()}.${displayCents.toString().padStart(2, '0')}`;
}

export function calculateDepositAllowance(amount: bigint, transferFee: number | bigint): bigint {
  return amount + BigInt(transferFee);
}

export function formatTokenInputValue(atomic: bigint, decimals: number): string {
  const divisor = pow10(decimals);
  const whole = atomic / divisor;
  const remainder = atomic % divisor;
  if (remainder === BigInt(0)) return whole.toString();
  const fractional = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractional}`;
}
