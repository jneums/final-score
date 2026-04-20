import { useQuery, useQueries } from '@tanstack/react-query';
import {
  getMarketCount,
  getPlatformStats,
  getMarket,
  queryMarkets,
  getOrderBook,
  getMyOrders,
  getMyPositions,
  getEventMarkets,
  type MarketCount,
  type PlatformStats,
  type MarketInfo,
  type MarketListResult,
  type MarketListItem,
  type OrderBookData,
  type UserOrder,
  type UserPosition,
} from '@final-score/ic-js';

/**
 * Hook to fetch market counts by status
 */
export function useMarketCount() {
  return useQuery<MarketCount>({
    queryKey: ['market-count'],
    queryFn: getMarketCount,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Hook to fetch platform-wide statistics
 */
export function usePlatformStats() {
  return useQuery<PlatformStats>({
    queryKey: ['platform-stats'],
    queryFn: getPlatformStats,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
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

/**
 * Hook to list markets with optional sport filter and pagination
 */
export function useMarketsList(sport?: string, offset = 0, limit = 50) {
  return useQuery<MarketListResult>({
    queryKey: ['markets-list', sport, offset, limit],
    queryFn: () => queryMarkets(sport, offset, limit),
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
  });
}

/**
 * Fetch the count of markets for a single sport code.
 * Uses limit=0 so no market data is transferred — just the total.
 */
async function fetchSportCount(sportCode: string): Promise<number> {
  const result = await queryMarkets(sportCode, 0, 1, 'Open');
  return result.total;
}

/**
 * Fetch counts for a set of sport codes grouped by category.
 * Returns a map of category slug → total market count.
 */
export interface SportCategory {
  slug: string;
  codes: string[];
}

async function fetchSportCounts(
  categories: SportCategory[],
): Promise<Record<string, number>> {
  // Collect all unique sport codes
  const allCodes = categories.flatMap((c) => c.codes);

  // Fetch counts sequentially to avoid IC boundary node rate limiting
  const codeCountMap: Record<string, number> = {};
  for (const code of allCodes) {
    try {
      codeCountMap[code] = await fetchSportCount(code);
    } catch {
      codeCountMap[code] = 0;
    }
  }

  // Aggregate by category
  const result: Record<string, number> = {};
  for (const cat of categories) {
    result[cat.slug] = cat.codes.reduce(
      (sum, code) => sum + (codeCountMap[code] || 0),
      0,
    );
  }
  return result;
}

/**
 * Hook to fetch per-sport-category market counts efficiently.
 * Instead of downloading all 460+ markets, it queries each sport code
 * with limit=1 and reads the `total` field.
 */
export function useSportCounts(categories: SportCategory[]) {
  return useQuery<Record<string, number>>({
    queryKey: ['sport-counts', categories.map((c) => c.slug).join(',')],
    queryFn: () => fetchSportCounts(categories),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: categories.length > 0,
  });
}

/**
 * Hook to fetch markets for multiple sport codes using server-side filtering.
 * Makes one query per sport code and merges results.
 */
export function useSportMarkets(sportCodes: string[]) {
  const queries = useQueries({
    queries: sportCodes.map((code) => ({
      queryKey: ['markets-list', code, 0, 100, 'Open'] as const,
      queryFn: () => queryMarkets(code, 0, 100, 'Open'),
      staleTime: 60 * 1000,
      refetchInterval: 120 * 1000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const markets: MarketListItem[] = [];
  for (const q of queries) {
    if (q.data?.markets) {
      markets.push(...q.data.markets);
    }
  }

  return { markets, isLoading };
}

/**
 * Hook to fetch order book depth for a specific market.
 */
export function useOrderBook(marketId: string | undefined) {
  return useQuery<OrderBookData>({
    queryKey: ['order-book', marketId],
    queryFn: () => getOrderBook(marketId!),
    enabled: !!marketId,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

/**
 * Hook to fetch the current user's orders.
 * Requires an authenticated identity (agent).
 */
export function useMyOrders(identity: any, statusFilter?: string, marketFilter?: string) {
  return useQuery<UserOrder[]>({
    queryKey: ['my-orders', statusFilter, marketFilter],
    queryFn: () => getMyOrders(identity, statusFilter, marketFilter),
    enabled: !!identity,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

/**
 * Hook to fetch the current user's positions.
 * Requires an authenticated identity (agent).
 */
export function useMyPositions(identity: any, marketFilter?: string) {
  return useQuery<UserPosition[]>({
    queryKey: ['my-positions', marketFilter],
    queryFn: () => getMyPositions(identity, marketFilter),
    enabled: !!identity,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
  });
}

/**
 * Hook to fetch all markets belonging to the same event (polymarketSlug).
 */
export function useEventMarkets(polymarketSlug: string | undefined) {
  return useQuery<MarketInfo[]>({
    queryKey: ['event-markets', polymarketSlug],
    queryFn: () => getEventMarkets(polymarketSlug!),
    enabled: !!polymarketSlug,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}
