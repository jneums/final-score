import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react';
import { getToken } from '@final-score/ic-js';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { useAccountBalance, useDepositToAccount, useUsdcBalance, useWithdrawFromAccount } from '../hooks/useLedger';
import { useAuth } from '../hooks/useAuth';
import { formatTokenAmount, formatTokenInputValue, parseTokenAmount } from '../lib/balanceUtils';

const PRESET_AMOUNTS = ['10', '25', '100'];

type FundsAction = 'deposit' | 'withdraw';

function tokenDecimals(): number {
  try {
    return getToken().decimals;
  } catch {
    return 8;
  }
}

function formatWalletBalance(balance: string | undefined): string {
  if (!balance) return '$0.00';
  const parsed = Number(balance);
  if (!Number.isFinite(parsed)) return '$0.00';
  return `$${parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AccountFundsManager() {
  const { user } = useAuth();
  const decimals = tokenDecimals();
  const { data: walletBalance, isLoading: walletLoading, refetch: refetchWallet } = useUsdcBalance(user?.principal);
  const { data: accountBalance, isLoading: accountLoading, refetch: refetchAccount } = useAccountBalance();
  const depositMutation = useDepositToAccount();
  const withdrawMutation = useWithdrawFromAccount();
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState<FundsAction>('deposit');
  const [error, setError] = useState<string | null>(null);

  const parsedAmount = parseTokenAmount(amount, decimals);
  const available = accountBalance?.available ?? BigInt(0);
  const locked = accountBalance?.lockedInOrders ?? BigInt(0);
  const total = accountBalance?.total ?? BigInt(0);
  const isBusy = depositMutation.isPending || withdrawMutation.isPending;
  const amountExceedsAvailable = action === 'withdraw' && parsedAmount !== null && parsedAmount > available;
  const canSubmit = !!user && parsedAmount !== null && !amountExceedsAvailable && !isBusy;

  const submit = async () => {
    setError(null);
    if (!parsedAmount) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (action === 'withdraw' && parsedAmount > available) {
      setError('Withdraw amount exceeds available balance. Cancel open orders to unlock more funds.');
      return;
    }

    try {
      if (action === 'deposit') {
        await depositMutation.mutateAsync({ amount: parsedAmount });
      } else {
        await withdrawMutation.mutateAsync({ amount: parsedAmount });
      }
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Final Score Funds</CardTitle>
            <CardDescription>Deposit to trade. Withdraw unlocked funds back to your wallet.</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { refetchWallet(); refetchAccount(); }}
            disabled={walletLoading || accountLoading}
            aria-label="Refresh balances"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-muted-foreground">Available</div>
            <div className="text-xl font-bold">{accountLoading ? '—' : formatTokenAmount(available, decimals)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-muted-foreground">Locked in orders</div>
            <div className="text-xl font-bold">{accountLoading ? '—' : formatTokenAmount(locked, decimals)}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-xs text-muted-foreground">Total account</div>
            <div className="text-xl font-bold">{accountLoading ? '—' : formatTokenAmount(total, decimals)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">Wallet balance</span>
          <span className="font-semibold">{walletLoading ? '—' : formatWalletBalance(walletBalance)} USDC</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={action === 'deposit' ? 'default' : 'outline'}
            onClick={() => { setAction('deposit'); setError(null); }}
          >
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            Deposit
          </Button>
          <Button
            type="button"
            variant={action === 'withdraw' ? 'default' : 'outline'}
            onClick={() => { setAction('withdraw'); setError(null); }}
          >
            <ArrowUpFromLine className="mr-2 h-4 w-4" />
            Withdraw
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="funds-amount">
            Amount (USDC)
          </label>
          <div className="flex gap-2">
            <Input
              id="funds-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={isBusy}
            />
            <Button type="button" onClick={submit} disabled={!canSubmit} className="min-w-28">
              {isBusy ? 'Working…' : action === 'deposit' ? 'Deposit' : 'Withdraw'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_AMOUNTS.map((preset) => (
              <Button key={preset} type="button" variant="ghost" size="sm" onClick={() => setAmount(preset)} disabled={isBusy}>
                ${preset}
              </Button>
            ))}
            {action === 'withdraw' && available > BigInt(0) && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAmount(formatTokenInputValue(available, decimals))} disabled={isBusy}>
                Max
              </Button>
            )}
          </div>
        </div>

        {amountExceedsAvailable && (
          <div className="rounded bg-amber-950/30 p-2 text-sm text-amber-300">
            Withdraw amount exceeds available balance. Locked funds are backing open orders.
          </div>
        )}
        {error && (
          <div className="rounded bg-red-950/30 p-2 text-sm text-red-400">
            {error}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Deposits approve the Final Score canister once for this amount, then move funds into your custodial account. Orders use available account balance and lock funds until filled, cancelled, or resolved.
        </p>
      </CardContent>
    </Card>
  );
}
