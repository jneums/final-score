// packages/apps/website/hooks/useLeaderboard.ts

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import {
  getLeaderboardByProfit,
  getLeaderboardByAccuracy,
  getLeaderboardByVolume,
  getLeaderboardByStreak,
  getUserStats,
  getPlatformStats,
  getUpcomingMatches,
  getMarketBettors,
  type LeaderboardEntry,
  type UserStats,
  type Market,
  type MarketWithBettors,
  type MarketBettor,
} from '@final-score/ic-js';

export type { LeaderboardEntry, UserStats, Market, MarketWithBettors, MarketBettor };

/**
 * React Query hook to fetch the ranked list of top users by net profit.
 */
export const useGetLeaderboardByProfit = (limit?: number) => {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', 'profit', limit],
    queryFn: async () => {
      return getLeaderboardByProfit(limit);
    },
  });
};

/**
 * React Query hook to fetch the ranked list of top users by accuracy.
 */
export const useGetLeaderboardByAccuracy = (limit?: number, minPredictions?: number) => {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', 'accuracy', limit, minPredictions],
    queryFn: async () => {
      return getLeaderboardByAccuracy(limit, minPredictions);
    },
  });
};

/**
 * React Query hook to fetch the ranked list of top users by total volume.
 */
export const useGetLeaderboardByVolume = (limit?: number) => {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', 'volume', limit],
    queryFn: async () => {
      return getLeaderboardByVolume(limit);
    },
  });
};

/**
 * React Query hook to fetch the ranked list of top users by longest win streak.
 */
export const useGetLeaderboardByStreak = (limit?: number) => {
  return useQuery<LeaderboardEntry[]>({
    queryKey: ['leaderboard', 'streak', limit],
    queryFn: async () => {
      return getLeaderboardByStreak(limit);
    },
  });
};

/**
 * React Query hook to fetch stats for a specific user.
 */
export const useGetUserStats = (principalText: string | null) => {
  return useQuery<UserStats | null>({
    queryKey: ['userStats', principalText],
    queryFn: () => {
      if (!principalText) {
        return null;
      }
      return getUserStats(principalText);
    },
    enabled: !!principalText,
  });
};

/**
 * React Query hook to fetch overall platform statistics.
 */
export const useGetPlatformStats = () => {
  return useQuery({
    queryKey: ['platformStats'],
    queryFn: () => getPlatformStats(),
  });
};

/**
 * React Query hook to fetch upcoming matches (open markets) with recent bettors.
 */
export const useGetUpcomingMatches = (limit?: number) => {
  return useQuery<MarketWithBettors[]>({
    queryKey: ['upcomingMatches', limit],
    queryFn: () => getUpcomingMatches(limit),
  });
};

/**
 * React Query infinite hook to fetch upcoming matches with pagination.
 */
export const useGetUpcomingMatchesInfinite = (pageSize: number = 5) => {
  return useInfiniteQuery<MarketWithBettors[], Error>({
    queryKey: ['upcomingMatches', 'infinite', pageSize],
    queryFn: async ({ pageParam = 0 }) => {
      const offset = pageParam as number;
      return getUpcomingMatches(pageSize, offset);
    },
    getNextPageParam: (lastPage, allPages) => {
      // If the last page has fewer items than pageSize, we've reached the end
      if (lastPage.length < pageSize) {
        return undefined;
      }
      // Calculate the offset for the next page
      const currentTotal = allPages.reduce((sum, page) => sum + page.length, 0);
      return currentTotal;
    },
    initialPageParam: 0,
  });
};

/**
 * React Query hook to fetch recent bettors for a specific market.
 */
export const useGetMarketBettors = (marketId: string | null, limit?: number) => {
  return useQuery<MarketBettor[]>({
    queryKey: ['marketBettors', marketId, limit],
    queryFn: () => {
      if (!marketId) return [];
      return getMarketBettors(marketId, limit);
    },
    enabled: !!marketId,
  });
};
