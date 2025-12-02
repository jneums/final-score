/**
 * Odds for a specific match outcome
 */
export interface Odds {
    /** Bookmaker name (e.g., "Bet365", "William Hill") */
    bookmaker: string;
    /** Home win odds */
    home: number | null;
    /** Draw odds */
    draw: number | null;
    /** Away win odds */
    away: number | null;
    /** Last updated timestamp */
    updatedAt: string;
}
/**
 * Live match status
 */
export interface LiveMatch {
    /** API Football fixture ID */
    fixtureId: number;
    /** Match status (e.g., "1H", "HT", "2H", "FT") */
    status: string;
    /** Elapsed time in minutes */
    elapsed: number | null;
    /** Home team score */
    homeScore: number;
    /** Away team score */
    awayScore: number;
    /** Home team name */
    homeTeam: string;
    /** Away team name */
    awayTeam: string;
}
/**
 * API Football client configuration
 */
export interface ApiFootballConfig {
    /** API key for api-football.com */
    apiKey: string;
    /** Base URL (default: https://v3.football.api-sports.io) */
    baseUrl?: string;
}
/**
 * Client for interacting with API Football via proxy server
 */
export declare class ApiFootballClient {
    private proxyUrl;
    constructor(proxyUrl: string);
    /**
     * Get odds for a specific fixture
     * @param fixtureId - API Football fixture ID
     * @param maxBookmakers - Maximum number of bookmakers to return (default: 3)
     */
    getOdds(fixtureId: number, maxBookmakers?: number): Promise<Odds[]>;
    /**
     * Get live match data for a specific fixture
     * @param fixtureId - API Football fixture ID
     */
    getLiveMatch(fixtureId: number): Promise<LiveMatch | null>;
    /**
     * Get multiple live matches
     * @param fixtureIds - Array of API Football fixture IDs
     */
    getLiveMatches(fixtureIds: number[]): Promise<LiveMatch[]>;
}
//# sourceMappingURL=client.d.ts.map