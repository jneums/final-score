// packages/ic-js/src/api/leaderboard.api.ts

import { Identity } from '@icp-sdk/core/agent';
import { getLeaderboardActor } from '../actors.js';
import { FinalScore } from '@final-score/declarations';

export type LeaderboardEntry = FinalScore.LeaderboardEntry;
export type UserStats = FinalScore.UserStats;
export type MarketWithBettors = FinalScore.MarketWithBettors;
// Market is now an alias for MarketWithBettors (for backward compatibility)
export type Market = MarketWithBettors;

export interface MarketBettor {
  principal: string;
  amount: bigint;
  outcome: string;
  timestamp: bigint;
}

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
 * Fetches upcoming matches (open markets sorted by kickoff time) with recent bettors.
 * @param limit Optional maximum number of results (default 50)
 * @param offset Optional number of results to skip (default 0)
 * @returns An array of MarketWithBettors objects, sorted by kickoff time.
 */
export const getUpcomingMatches = async (
  limit?: number,
  offset?: number
): Promise<MarketWithBettors[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_upcoming_matches(
    limit !== undefined ? [BigInt(limit)] : [],
    offset !== undefined ? [BigInt(offset)] : []
  );
  return result;
};

/**
 * Fetches recent bettors for a specific market (for social proof).
 * @param marketId The market ID to fetch bettors for
 * @param limit Optional maximum number of results (default 10)
 * @returns An array of MarketBettor objects, sorted by most recent.
 */
export const getMarketBettors = async (
  marketId: string,
  limit?: number
): Promise<MarketBettor[]> => {
  const leaderboardActor = getLeaderboardActor();
  const result = await leaderboardActor.get_market_bettors(
    marketId,
    limit !== undefined ? [BigInt(limit)] : []
  );
  return result.map(bettor => ({
    principal: bettor.principal,
    amount: bettor.amount,
    outcome: bettor.outcome,
    timestamp: bettor.timestamp,
  }));
};
