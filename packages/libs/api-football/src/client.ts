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
 * API Football response wrapper
 */
interface ApiResponse<T> {
  get: string;
  parameters: Record<string, unknown>;
  errors: unknown[];
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: T[];
}

/**
 * Client for interacting with API Football via proxy server
 */
export class ApiFootballClient {
  private proxyUrl: string;

  constructor(proxyUrl: string) {
    this.proxyUrl = proxyUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Get odds for a specific fixture
   * @param fixtureId - API Football fixture ID
   * @param maxBookmakers - Maximum number of bookmakers to return (default: 3)
   */
  async getOdds(fixtureId: number, maxBookmakers: number = 3): Promise<Odds[]> {
    try {
      const response = await fetch(
        `${this.proxyUrl}/api/odds/${fixtureId}?bookmakers=${maxBookmakers}`
      );

      if (!response.ok) {
        throw new Error(`Proxy server returned ${response.status}`);
      }

      const data = await response.json();
      return data.odds || [];
    } catch (error) {
      console.error('Error fetching odds:', error);
      return []; // Return empty array instead of throwing
    }
  }

  /**
   * Get live match data for a specific fixture
   * @param fixtureId - API Football fixture ID
   */
  async getLiveMatch(fixtureId: number): Promise<LiveMatch | null> {
    try {
      const response = await fetch(`${this.proxyUrl}/api/live/${fixtureId}`);

      if (!response.ok) {
        if (response.status === 404) {
          console.warn(`Fixture ${fixtureId} not found (404)`);
          return null;
        }
        console.error(`Proxy server returned ${response.status} for fixture ${fixtureId}`);
        return null;
      }

      const data = await response.json();
      
      // Validate that we have the required data
      if (!data || !data.fixtureId || !data.status) {
        console.warn(`Invalid data structure for fixture ${fixtureId}:`, data);
        return null;
      }
      
      // Transform proxy response to match our interface
      return {
        fixtureId: data.fixtureId,
        status: data.status,
        elapsed: data.elapsed,
        homeScore: data.scores?.home ?? 0,
        awayScore: data.scores?.away ?? 0,
        homeTeam: data.teams?.home ?? '',
        awayTeam: data.teams?.away ?? '',
      };
    } catch (error) {
      console.error(`Error fetching live match ${fixtureId}:`, error);
      return null; // Return null instead of throwing
    }
  }

  /**
   * Get multiple live matches
   * @param fixtureIds - Array of API Football fixture IDs
   */
  async getLiveMatches(fixtureIds: number[]): Promise<LiveMatch[]> {
    if (fixtureIds.length === 0) return [];

    try {
      const response = await fetch(`${this.proxyUrl}/api/live/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fixtureIds }),
      });

      if (!response.ok) {
        throw new Error(`Proxy server returned ${response.status}`);
      }

      const data = await response.json();
      
      // Transform proxy response to match our interface
      return (data.matches || []).map((match: any) => ({
        fixtureId: match.fixtureId,
        status: match.status,
        elapsed: match.elapsed,
        homeScore: match.scores?.home ?? 0,
        awayScore: match.scores?.away ?? 0,
        homeTeam: match.teams?.home ?? '',
        awayTeam: match.teams?.away ?? '',
      }));
    } catch (error) {
      console.error('Error fetching live matches:', error);
      return []; // Return empty array instead of throwing
    }
  }
}
