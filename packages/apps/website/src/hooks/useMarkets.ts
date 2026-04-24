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
  getSportCounts,
  getTopMarketsByVolume,
  type MarketCount,
  type PlatformStats,
  type MarketInfo,
  type MarketListResult,
  type MarketListItem,
  type OrderBookData,
  type UserOrder,
  type UserPosition,
  type SportCount,
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

/**
 * A grouped event with aggregated volume across its markets.
 */
export interface PopularEvent {
  slug: string;
  eventTitle: string;
  sport: string;
  league: string;
  status: string;
  totalVolume: number;
  endDate: bigint;
  markets: MarketListItem[];
  firstMarketId: string;
}

/**
 * Hook to fetch the highest-volume open events.
 * Single canister query via get_top_markets_by_volume.
 */
export function usePopularMarkets(topN = 6) {
  return useQuery<PopularEvent[]>({
    queryKey: ['popular-markets', topN],
    queryFn: async () => {
      const topMarkets = await getTopMarketsByVolume(topN * 5);

      // Get unique event slugs from top markets
      const slugs = [...new Set(topMarkets.map((m) => m.polymarketSlug))];

      // Backfill full event markets for each slug
      const eventResults = await Promise.all(
        slugs.map((slug) => getEventMarkets(slug)),
      );

      // Build events with complete market data
      const events: PopularEvent[] = [];
      for (let i = 0; i < slugs.length; i++) {
        const slug = slugs[i];
        const fullMarkets = eventResults[i];
        if (!fullMarkets.length) continue;

        // Only include open markets in the card
        const openMarkets: MarketListItem[] = fullMarkets
          .filter((m) => m.status === 'Open')
          .map((m) => ({
            marketId: m.marketId,
            question: m.question,
            eventTitle: m.eventTitle,
            sport: m.sport,
            status: m.status,
            yesPrice: Number(m.lastYesPrice),
            noPrice: Number(m.lastNoPrice),
            impliedYesAsk: 0,
            impliedNoAsk: 0,
            polymarketSlug: m.polymarketSlug,
            endDate: m.endDate,
            totalVolume: m.totalVolume,
          }));
        if (!openMarkets.length) continue;

        // Overlay implied prices from topMarkets where available
        for (const om of openMarkets) {
          const top = topMarkets.find((t) => t.marketId === om.marketId);
          if (top) {
            om.impliedYesAsk = top.impliedYesAsk;
            om.impliedNoAsk = top.impliedNoAsk;
          }
        }

        const first = openMarkets[0];
        const totalVolume = openMarkets.reduce(
          (sum, m) => sum + Number(m.totalVolume),
          0,
        );
        const endDate = openMarkets.reduce(
          (min, m) =>
            m.endDate > 0n && (min === 0n || m.endDate < min) ? m.endDate : min,
          0n,
        );
        events.push({
          slug,
          eventTitle: first.eventTitle,
          sport: first.sport,
          league: first.sport.toUpperCase(),
          status: first.status,
          totalVolume,
          endDate,
          markets: openMarkets,
          firstMarketId: first.marketId,
        });
      }

      events.sort((a, b) => b.totalVolume - a.totalVolume);
      return events.slice(0, topN);
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });
}
