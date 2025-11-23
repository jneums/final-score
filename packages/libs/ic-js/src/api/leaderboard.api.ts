// packages/ic-js/src/api/leaderboard.api.ts

import { Identity } from '@icp-sdk/core/agent';
import { getLeaderboardActor } from '../actors.js';
import { FinalScore } from '@final-score/declarations';

export type LeaderboardEntry = FinalScore.LeaderboardEntry;
export type UserStats = FinalScore.UserStats;
export type Market = FinalScore.Market;

/**
 * Fetches the ranked list of top users by net profit.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export const getLeaderboardByProfit = async (
  limit?: number
): Promise<LeaderboardEntry[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_leaderboard_by_profit(
    limit !== undefined ? [BigInt(limit)] : []
  );
  return result;
};

/**
 * Fetches the ranked list of top users by accuracy rate.
 * @param limit Optional maximum number of results (default 100)
 * @param minPredictions Minimum predictions required (default 10)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export const getLeaderboardByAccuracy = async (
  limit?: number,
  minPredictions?: number
): Promise<LeaderboardEntry[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_leaderboard_by_accuracy(
    limit !== undefined ? [BigInt(limit)] : [],
    minPredictions !== undefined ? [BigInt(minPredictions)] : []
  );
  return result;
};

/**
 * Fetches the ranked list of top users by total volume wagered.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export const getLeaderboardByVolume = async (
  limit?: number
): Promise<LeaderboardEntry[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_leaderboard_by_volume(
    limit !== undefined ? [BigInt(limit)] : []
  );
  return result;
};

/**
 * Fetches the ranked list of top users by longest win streak.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export const getLeaderboardByStreak = async (
  limit?: number
): Promise<LeaderboardEntry[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_leaderboard_by_streak(
    limit !== undefined ? [BigInt(limit)] : []
  );
  return result;
};

/**
 * Fetches stats for a specific user.
 * @param principalText The Principal ID of the user as a string
 * @returns UserStats if found, null otherwise
 */
export const getUserStats = async (
  principalText: string
): Promise<UserStats | null> => {
  const leaderboardActor = getLeaderboardActor();
  const principal = { _isPrincipal: true, toText: () => principalText } as any;
  const result = await leaderboardActor.get_user_stats(principal);
  return result.length > 0 ? (result[0] ?? null) : null;
};

/**
 * Fetches overall platform statistics.
 * @returns Platform-wide statistics
 */
export const getPlatformStats = async (): Promise<{
  totalUsers: bigint;
  totalPredictions: bigint;
  totalVolume: bigint;
  activeMarkets: bigint;
  resolvedMarkets: bigint;
}> => {
  const leaderboardActor = getLeaderboardActor();
  return await leaderboardActor.get_platform_stats();
};

/**
 * Fetches upcoming matches (open markets sorted by kickoff time).
 * @param limit Optional maximum number of results (default 50)
 * @returns An array of Market objects, sorted by kickoff time.
 */
export const getUpcomingMatches = async (
  limit?: number
): Promise<Market[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_upcoming_matches(
    limit !== undefined ? [BigInt(limit)] : []
  );
  return result;
};
