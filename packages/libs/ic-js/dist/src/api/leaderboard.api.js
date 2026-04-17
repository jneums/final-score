// packages/libs/ic-js/src/api/leaderboard.api.ts
import { getFinalScoreActor } from '../actors.js';
/**
 * Gets the leaderboard sorted by net profit.
 * @param limit Optional maximum number of entries to return
 * @returns Array of LeaderboardEntry objects
 */
export const getLeaderboardByProfit = async (limit) => {
    const actor = await getFinalScoreActor();
    const result = await actor.get_leaderboard_by_profit(limit !== undefined ? [BigInt(limit)] : []);
    return result;
};
