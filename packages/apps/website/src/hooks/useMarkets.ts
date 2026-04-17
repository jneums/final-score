import { useQuery } from '@tanstack/react-query';
import {
  getMarketCount,
  getPlatformStats,
  getMarket,
  type MarketCount,
  type PlatformStats,
  type MarketInfo,
} from '@final-score/ic-js';

/**
 * Hook to fetch market counts by status
 */
export function useMarketCount() {
  return useQuery<MarketCount>({
    queryKey: ['market-count'],
    queryFn: getMarketCount,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
  });
}

/**
 * Hook to fetch platform-wide statistics
 */
export function usePlatformStats() {
  return useQuery<PlatformStats>({
    queryKey: ['platform-stats'],
    queryFn: getPlatformStats,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
  });
}

/**
 * Hook to fetch a specific market by ID
 */
export function useMarket(marketId: string | undefined) {
  return useQuery<MarketInfo | null>({
    queryKey: ['market', marketId],
    queryFn: () => getMarket(marketId!),
    enabled: !!marketId,
    staleTime: 30 * 1000,
  });
}
