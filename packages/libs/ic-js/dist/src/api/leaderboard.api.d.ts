import { FinalScore } from '@final-score/declarations';
export type LeaderboardEntry = FinalScore.LeaderboardEntry;
export type UserStats = FinalScore.UserStats;
export type Market = FinalScore.Market;
/**
 * Fetches the ranked list of top users by net profit.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export declare const getLeaderboardByProfit: (limit?: number) => Promise<LeaderboardEntry[]>;
/**
 * Fetches the ranked list of top users by accuracy rate.
 * @param limit Optional maximum number of results (default 100)
 * @param minPredictions Minimum predictions required (default 10)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export declare const getLeaderboardByAccuracy: (limit?: number, minPredictions?: number) => Promise<LeaderboardEntry[]>;
/**
 * Fetches the ranked list of top users by total volume wagered.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export declare const getLeaderboardByVolume: (limit?: number) => Promise<LeaderboardEntry[]>;
/**
 * Fetches the ranked list of top users by longest win streak.
 * @param limit Optional maximum number of results (default 100)
 * @returns An array of LeaderboardEntry objects, sorted by rank.
 */
export declare const getLeaderboardByStreak: (limit?: number) => Promise<LeaderboardEntry[]>;
/**
 * Fetches stats for a specific user.
 * @param principalText The Principal ID of the user as a string
 * @returns UserStats if found, null otherwise
 */
export declare const getUserStats: (principalText: string) => Promise<UserStats | null>;
/**
 * Fetches overall platform statistics.
 * @returns Platform-wide statistics
 */
export declare const getPlatformStats: () => Promise<{
    totalUsers: bigint;
    totalPredictions: bigint;
    totalVolume: bigint;
    activeMarkets: bigint;
    resolvedMarkets: bigint;
}>;
/**
 * Fetches upcoming matches (open markets sorted by kickoff time).
 * @param limit Optional maximum number of results (default 50)
 * @returns An array of Market objects, sorted by kickoff time.
 */
export declare const getUpcomingMatches: (limit?: number) => Promise<Market[]>;
