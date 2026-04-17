import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllowance, approveUsdc, Tokens, getCanisterId } from '@final-score/ic-js';
import { useAuth } from './useAuth';

/**
 * Hook to get current USDC allowance for the Final Score canister.
 * Returns the allowance as a human-readable string (e.g. "100.00").
 */
export function useAllowance(owner?: string, spender?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['allowance', owner, spender],
    queryFn: async () => {
      const identity = user?.agent?.config?.identity;
      if (!identity) throw new Error('No identity');
      const targetSpender = spender || getCanisterId('FINAL_SCORE');
      const allowanceAtomic = await getAllowance(identity, targetSpender);
      return Tokens.USDC.fromAtomic(allowanceAtomic);
    },
    enabled: !!owner && !!user?.agent,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Hook to approve USDC spending for the Final Score canister (icrc2_approve).
 */
export function useSetAllowance() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount, spender }: { amount: number; spender?: string }) => {
      if (!user?.agent) throw new Error('Not authenticated');
      const identity = user.agent.config?.identity;
      if (!identity) throw new Error('No identity available');
      const targetSpender = spender || getCanisterId('FINAL_SCORE');
      const atomicAmount = Tokens.USDC.toAtomic(amount);
      return approveUsdc(identity, targetSpender, atomicAmount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowance'] });
    },
  });
}
