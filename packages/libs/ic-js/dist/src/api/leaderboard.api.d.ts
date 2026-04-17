import { FinalScore } from '@final-score/declarations';
export type LeaderboardEntry = FinalScore.LeaderboardEntry;
export type UserStats = FinalScore.UserStats;
/**
 * Gets the leaderboard sorted by net profit.
 * @param limit Optional maximum number of entries to return
 * @returns Array of LeaderboardEntry objects
 */
export declare const getLeaderboardByProfit: (limit?: number) => Promise<LeaderboardEntry[]>;
