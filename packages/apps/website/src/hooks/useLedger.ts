import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  approveUsdc,
  deposit,
  getCanisterId,
  getMyAccountBalance,
  getToken,
  getUsdcBalance,
  transferUsdc,
  withdrawBalance,
} from '@final-score/ic-js';
import { useAuth } from './useAuth';

/**
 * Hook to fetch token balance for a principal.
 * Balance is returned as a human-readable string (e.g. "125.50").
 */
export function useUsdcBalance(principal?: string) {
  return useQuery({
    queryKey: ['usdc-balance', principal],
    queryFn: async () => {
      if (!principal) throw new Error('No principal');
      const balanceAtomic = await getUsdcBalance(principal);
      return getToken().fromAtomic(balanceAtomic);
    },
    enabled: !!principal,
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/**
 * Hook to transfer tokens to another principal.
 */
export function useTransferUsdc() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ to, amount }: { to: string; amount: number }) => {
      if (!user?.agent) throw new Error('Not authenticated');
      const identity = user.agent;
      if (!identity) throw new Error('No identity available');
      const atomicAmount = getToken().toAtomic(amount);
      return transferUsdc(identity, to, atomicAmount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
    },
  });
}

export function useAccountBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-account-balance'],
    queryFn: () => {
      if (!user?.agent) throw new Error('Not authenticated');
      return getMyAccountBalance(user.agent);
    },
    enabled: !!user?.agent,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

export function useDepositToAccount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: { amount: bigint }) => {
      if (!user?.agent) throw new Error('Not authenticated');
      const spender = getCanisterId('FINAL_SCORE');
      await approveUsdc(user.agent, spender, amount);
      return deposit(user.agent, amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['my-account-balance'] });
    },
  });
}

export function useWithdrawFromAccount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ amount }: { amount: bigint }) => {
      if (!user?.agent) throw new Error('Not authenticated');
      return withdrawBalance(user.agent, amount);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['my-account-balance'] });
    },
  });
}

