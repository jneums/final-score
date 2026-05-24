import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mainMo = readFileSync(resolve(__dirname, '../src/main.mo'), 'utf8');
const toolContextMo = readFileSync(resolve(__dirname, '../src/tools/ToolContext.mo'), 'utf8');
const mcpOrderPlaceMo = readFileSync(resolve(__dirname, '../src/tools/order_place.mo'), 'utf8');
const mcpAccountGetInfoMo = readFileSync(resolve(__dirname, '../src/tools/account_get_info.mo'), 'utf8');

function bodyBetween(start: string, end: string): string {
  const startIndex = mainMo.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = mainMo.indexOf(end, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return mainMo.slice(startIndex, endIndex);
}

describe('custodial accounting model', () => {
  it('has explicit deposit, withdraw, and account balance endpoints backed by userBalances', () => {
    expect(mainMo).toContain('public shared (msg) func deposit');
    expect(mainMo).toContain('public shared (msg) func withdraw_balance');
    expect(mainMo).toContain('public query (msg) func get_my_account_balance');
    expect(toolContextMo).toContain('userBalances : Map.Map<Principal, Nat>');
    expect(toolContextMo).toContain('public func creditBalance');
    expect(toolContextMo).toContain('public func debitBalance');
  });

  it('places orders by debiting internal balance, not by transfer_from per order', () => {
    const placeOrderBody = bodyBetween(
      'public shared (msg) func place_order',
      '/// Cancel an order',
    );

    expect(placeOrderBody).toContain('ToolContext.debitBalance(toolContext, caller, cost)');
    expect(placeOrderBody).not.toContain('icrc2_transfer_from');
    expect(placeOrderBody).not.toContain('PRE-FUND: Escrow full order cost into market subaccount');
  });

  it('cancels orders by crediting internal balance, not by transferring a refund', () => {
    const cancelOrderBody = bodyBetween(
      'public shared (msg) func cancel_order',
      '/// Batch requote',
    );

    expect(cancelOrderBody).toContain('ToolContext.creditBalance(toolContext, caller, refundAmount)');
    expect(cancelOrderBody).not.toContain('icrc1_transfer');
    expect(cancelOrderBody).not.toContain('marketSubaccount(order.marketId)');
  });

  it('settlement and netting credit canister balances instead of transferring to wallets', () => {
    const resolveBody = bodyBetween(
      'func admin_resolve_market_internal',
      '// ═══════════════════════════════════════════════════════════\n  // MCP Tool Configuration',
    );
    const placeOrderBody = bodyBetween(
      'public shared (msg) func place_order',
      '/// Cancel an order',
    );

    expect(resolveBody).toContain('ToolContext.creditBalance(toolContext, position.user, payout)');
    expect(placeOrderBody).toContain('ToolContext.creditBalance(toolContext, user, payout)');
    expect(resolveBody).not.toContain('from_subaccount = ?ToolContext.marketSubaccount(marketId)');
  });

  it('allows stale Polymarket events to resolve from post-match prices', () => {
    const resolveBody = bodyBetween(
      'public func try_resolve_market',
      '/// Release the unfilled balance reserved behind orders',
    );
    const unresolvedBody = bodyBetween(
      'public query func get_unresolved_markets',
      '/// Get open market counts grouped by sport code',
    );

    expect(mainMo).toContain('STALE_RESOLUTION_GRACE_NS');
    expect(resolveBody).toContain('let staleEnough = Time.now() >= market.endDate + STALE_RESOLUTION_GRACE_NS');
    expect(resolveBody).toContain('if (not isClosed and not staleEnough)');
    expect(unresolvedBody).toContain('endDate : Int');
    expect(unresolvedBody).toContain('endDate = m.endDate');
  });

  it('MCP tools use custodial account balances without ledger calls during normal trading/account reads', () => {
    expect(mcpOrderPlaceMo).toContain('ToolContext.debitBalance(context, userPrincipal, cost)');
    expect(mcpOrderPlaceMo).toContain('ToolContext.creditBalance(context, user, payout)');
    expect(mcpOrderPlaceMo).not.toContain('icrc2_transfer_from');
    expect(mcpOrderPlaceMo).not.toContain('icrc1_transfer');
    expect(mcpOrderPlaceMo).not.toContain('actor (Principal.toText(context.tokenLedger))');

    expect(mcpAccountGetInfoMo).toContain('ToolContext.getAvailableBalance(context, userPrincipal)');
    expect(mcpAccountGetInfoMo).toContain('ToolContext.getLockedBalance(context, userPrincipal)');
    expect(mcpAccountGetInfoMo).not.toContain('icrc1_balance_of');
    expect(mcpAccountGetInfoMo).not.toContain('icrc2_allowance');
    expect(mcpAccountGetInfoMo).not.toContain('actor (Principal.toText(context.tokenLedger))');
  });
});
