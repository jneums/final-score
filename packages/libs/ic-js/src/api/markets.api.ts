// packages/libs/ic-js/src/api/markets.api.ts

import { getFinalScoreActor } from '../actors.js';

export interface MarketCount {
  total: number;
  open: number;
  closed: number;
  resolved: number;
  cancelled: number;
}

export interface PlatformStats {
  totalTrades: number;
  activeMarkets: number;
  totalVolume: number;
  totalUsers: number;
  resolvedMarkets: number;
}

export interface MarketInfo {
  marketId: string;
  question: string;
  eventTitle: string;
  sport: string;
  status: string;
  polymarketSlug: string;
  endDate: bigint;
  totalVolume: bigint;
  lastYesPrice: bigint;
  lastNoPrice: bigint;
}

/**
 * Gets the count of markets by status.
 */
export const getMarketCount = async (): Promise<MarketCount> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_market_count();
  return {
    total: Number(result.total),
    open: Number(result.open),
    closed: Number(result.closed),
    resolved: Number(result.resolved),
    cancelled: Number(result.cancelled),
  };
};

/**
 * Gets platform-wide statistics.
 */
export const getPlatformStats = async (): Promise<PlatformStats> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_platform_stats();
  return {
    totalTrades: Number(result.totalTrades),
    activeMarkets: Number(result.activeMarkets),
    totalVolume: Number(result.totalVolume),
    totalUsers: Number(result.totalUsers),
    resolvedMarkets: Number(result.resolvedMarkets),
  };
};

/**
 * Gets a specific market by ID (debug endpoint).
 * @param marketId The market ID string
 * @returns The market info or null if not found
 */
export const getMarket = async (
  marketId: string,
): Promise<MarketInfo | null> => {
  const actor = await getFinalScoreActor();
  const result = await actor.debug_get_market(marketId);
  if (result.length === 0) return null;
  return result[0] ?? null;
};
