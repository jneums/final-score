import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { useAllowance, useSetAllowance } from '../hooks/useAllowance';
import { useAuth } from '../hooks/useAuth';
import { getCanisterId, Tokens } from '@final-score/ic-js';

const PRESET_AMOUNTS = [10, 25, 100, 500];

export function AllowanceManager() {
  const { user } = useAuth();
  const spender = (() => { try { return getCanisterId('FINAL_SCORE'); } catch { return ''; } })();
  const { data: currentAllowance, isLoading: allowanceLoading } = useAllowance(user?.principal, spender);
  const { mutateAsync: setAllowance, isPending } = useSetAllowance();
  const [customAmount, setCustomAmount] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetAllowance = async (amount: number) => {
    setError(null);
    try {
      await setAllowance({ amount, spender });
      setCustomAmount('');
      setShowCustom(false);
    } catch (err: any) {
      console.error('Failed to set allowance:', err);
      setError(err?.message || 'Failed to set allowance');
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) return;
    handleSetAllowance(amount);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending Allowance</CardTitle>
        <CardDescription>
          Pre-approve USDC for trading (order placement)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Allowance */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">Current Allowance</span>
          <span className="text-lg font-bold">
            {allowanceLoading ? '—' : `$${Number(currentAllowance ?? 0).toFixed(2)}`} USDC
          </span>
        </div>

        {error && (
          <div className="p-2 text-sm text-red-400 bg-red-950/30 rounded">
            {error}
          </div>
        )}

        {/* Preset Amounts */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Quick Set</label>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                variant="outline"
                onClick={() => handleSetAllowance(amount)}
                disabled={isPending || !user}
              >
                ${amount}
              </Button>
            ))}
          </div>
        </div>

        {/* Custom Amount */}
        {!showCustom ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCustom(true)}
            className="w-full"
          >
            Set Custom Amount
          </Button>
        ) : (
          <form onSubmit={handleCustomSubmit} className="space-y-2">
            <label className="text-sm font-medium" htmlFor="custom-amount">Custom Amount (USDC)</label>
            <div className="flex gap-2">
              <Input
                id="custom-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter amount"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                disabled={isPending}
              />
              <Button type="submit" disabled={isPending || !customAmount}>
                Set
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowCustom(false); setCustomAmount(''); }}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
