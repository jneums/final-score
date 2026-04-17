import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsdcBalance, transferUsdc, Tokens } from '@final-score/ic-js';
import { useAuth } from './useAuth';

/**
 * Hook to fetch USDC balance for a principal.
 * Balance is returned as a human-readable string (e.g. "125.50").
 */
export function useUsdcBalance(principal?: string) {
  return useQuery({
    queryKey: ['usdc-balance', principal],
    queryFn: async () => {
      if (!principal) throw new Error('No principal');
      const balanceAtomic = await getUsdcBalance(principal);
      return Tokens.USDC.fromAtomic(balanceAtomic);
    },
    enabled: !!principal,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/**
 * Hook to transfer USDC to another principal.
 */
export function useTransferUsdc() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ to, amount }: { to: string; amount: number }) => {
      if (!user?.agent) throw new Error('Not authenticated');
      const identity = user.agent;
      if (!identity) throw new Error('No identity available');
      const atomicAmount = Tokens.USDC.toAtomic(amount);
      return transferUsdc(identity, to, atomicAmount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
    },
  });
}
