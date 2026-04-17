// packages/libs/ic-js/src/api/leaderboard.api.ts

import { getFinalScoreActor } from '../actors.js';
import { FinalScore } from '@final-score/declarations';

export type LeaderboardEntry = FinalScore.LeaderboardEntry;
export type UserStats = FinalScore.UserStats;

/**
 * Gets the leaderboard sorted by net profit.
 * @param limit Optional maximum number of entries to return
 * @returns Array of LeaderboardEntry objects
 */
export const getLeaderboardByProfit = async (
  limit?: number,
): Promise<LeaderboardEntry[]> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_leaderboard_by_profit(
    limit !== undefined ? [BigInt(limit)] : [],
  );
  return result;
};
