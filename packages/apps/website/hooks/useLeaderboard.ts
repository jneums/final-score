// packages/apps/website/hooks/useLeaderboard.ts

import { useQuery } from '@tanstack/react-query';
import {
  getLeaderboardByProfit,
  getLeaderboardByAccuracy,
  getLeaderboardByVolume,
  getLeaderboardByStreak,
  getUserStats,
  getPlatformStats,
  getUpcomingMatches,
  type LeaderboardEntry,
  type UserStats,
  type Market,
} from '@final-score/ic-js';

export type { LeaderboardEntry, UserStats, Market };

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
 * React Query hook to fetch upcoming matches (open markets).
 */
export const useGetUpcomingMatches = (limit?: number) => {
  return useQuery<Market[]>({
    queryKey: ['upcomingMatches', limit],
    queryFn: () => getUpcomingMatches(limit),
  });
};
