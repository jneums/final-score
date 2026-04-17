import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';

const PRESET_AMOUNTS = [10, 25, 100, 500];

export function AllowanceManager() {
  const [customAmount, setCustomAmount] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleSetAllowance = async (amount: number) => {
    setIsPending(true);
    try {
      // TODO: Call icrc2_approve on USDC ledger (53nhb-haaaa-aaaar-qbn5q-cai) 
      // with final_score canister (ilyol-uqaaa-aaaai-q34kq-cai) as spender
      console.log(`Setting USDC allowance: $${amount}`);
      setCustomAmount('');
      setShowCustom(false);
    } catch (error) {
      console.error('Failed to set allowance:', error);
    } finally {
      setIsPending(false);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      return;
    }
    handleSetAllowance(amount);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending Allowance</CardTitle>
        <CardDescription>
          Pre-approve USDC for prediction market operations (placing bets, claiming winnings)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Allowance */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">Current Allowance</span>
          <span className="text-lg font-bold">
            — USDC
          </span>
        </div>

        {/* Preset Amounts */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Quick Set</label>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                variant="outline"
                onClick={() => handleSetAllowance(amount)}
                disabled={isPending}
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
              <Button
                type="submit"
                disabled={isPending || !customAmount}
              >
                Set
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowCustom(false);
                  setCustomAmount('');
                }}
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
