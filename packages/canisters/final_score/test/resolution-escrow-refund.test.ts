import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mainMo = readFileSync(
  resolve(__dirname, '../src/main.mo'),
  'utf8',
);

function bodyBetween(start: string, end: string): string {
  const startIndex = mainMo.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = mainMo.indexOf(end, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return mainMo.slice(startIndex, endIndex);
}

describe('market resolution/cancellation balance credits', () => {
  it('releases cancelled resting order reservations before resolved-market payouts', () => {
    const resolveBody = bodyBetween(
      'func admin_resolve_market_internal',
      'public shared (msg) func place_order',
    );

    const cancelAllIndex = resolveBody.indexOf('OrderBook.cancelAllOrders(book)');
    const refundIndex = resolveBody.indexOf('await refundCancelledOrderEscrow(cancelledOrders, "resolve " # marketId)');
    const payoutIndex = resolveBody.indexOf('// Process payouts');

    expect(cancelAllIndex).toBeGreaterThanOrEqual(0);
    expect(refundIndex).toBeGreaterThan(cancelAllIndex);
    expect(payoutIndex).toBeGreaterThan(refundIndex);
  });

  it('releases cancelled resting order reservations before cancelled-market position refunds', () => {
    const cancelBody = bodyBetween(
      'func admin_cancel_market_internal',
      'public shared ({ caller }) func admin_drain_market_subaccount',
    );

    const cancelAllIndex = cancelBody.indexOf('OrderBook.cancelAllOrders(book)');
    const refundIndex = cancelBody.indexOf('await refundCancelledOrderEscrow(cancelledOrders, "cancel " # marketId)');
    const positionRefundIndex = cancelBody.indexOf('// Refund positions');

    expect(cancelAllIndex).toBeGreaterThanOrEqual(0);
    expect(refundIndex).toBeGreaterThan(cancelAllIndex);
    expect(positionRefundIndex).toBeGreaterThan(refundIndex);
  });

  it('refund helper credits unfilled order reservation to the order owner account balance', () => {
    const helperBody = bodyBetween(
      'func refundCancelledOrderEscrow',
      '/// Internal resolution',
    );

    expect(helperBody).toContain('order.size - order.filledSize');
    expect(helperBody).toContain('ToolContext.orderCost(toolContext, order.price, remaining)');
    expect(helperBody).toContain('ToolContext.creditBalance(toolContext, order.user, refundAmount)');
    expect(helperBody).not.toContain('from_subaccount = ?ToolContext.marketSubaccount(order.marketId)');
    expect(helperBody).not.toContain('to = { owner = order.user; subaccount = null }');
  });
});
