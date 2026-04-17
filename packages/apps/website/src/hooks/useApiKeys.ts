import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, createApiKey, revokeApiKey } from '@final-score/ic-js';
import { useAuth } from './useAuth';

/**
 * Hook to list the authenticated user's API keys.
 */
export function useApiKeys() {
  const { user, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ['api-keys', user?.principal],
    queryFn: async () => {
      const identity = user?.agent?.config?.identity;
      if (!identity) throw new Error('Not authenticated');
      return listApiKeys(identity);
    },
    enabled: isAuthenticated && !!user?.agent,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to create a new API key.
 */
export function useCreateApiKey() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, scopes }: { name: string; scopes?: string[] }) => {
      const identity = user?.agent?.config?.identity;
      if (!identity) throw new Error('Not authenticated');
      return createApiKey(identity, name, scopes || ['all']);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

/**
 * Hook to revoke an API key by its hashed key ID.
 */
export function useRevokeApiKey() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hashedKey: string) => {
      const identity = user?.agent?.config?.identity;
      if (!identity) throw new Error('Not authenticated');
      await revokeApiKey(identity, hashedKey);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
