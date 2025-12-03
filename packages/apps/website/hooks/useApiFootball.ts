'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiFootballClient, type Odds, type LiveMatch } from '@final-score/api-football';

// Initialize client with proxy server URL
const getClient = () => {
  const proxyUrl = process.env.NEXT_PUBLIC_API_PROXY_URL;
  if (!proxyUrl) {
    console.warn('API proxy URL not configured');
    return null;
  }
  return new ApiFootballClient(proxyUrl);
};

/**
 * Hook to fetch bookmaker odds for a specific match
 */
export function useMatchOdds(fixtureId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['match-odds', fixtureId],
    queryFn: async () => {
      const client = getClient();
      if (!client || !fixtureId) return [];
      return await client.getOdds(fixtureId, 3); // Get top 3 bookmakers
    },
    enabled: enabled && fixtureId !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    retry: false, // Don't retry on 404s
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
  });
}

/**
 * Hook to fetch live match data
 */
export function useLiveMatch(fixtureId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['live-match', fixtureId],
    queryFn: async () => {
      const client = getClient();
      if (!client || !fixtureId) return null;
      return await client.getLiveMatch(fixtureId);
    },
    enabled: enabled && fixtureId !== null,
    staleTime: 0, // Always consider data stale so it refetches
    // Only refetch if match is in progress (1H, 2H, HT, ET, P, BT, LIVE)
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 60 * 1000; // If no data yet, try again in 1 minute
      const liveStatuses = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'];
      return liveStatuses.includes(data.status) ? 60 * 1000 : false; // 1 minute if live, otherwise don't refetch
    },
    retry: false, // Don't retry on 404s
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
  });
}

/**
 * Hook to fetch multiple live matches
 */
export function useLiveMatches(fixtureIds: number[], enabled: boolean = true) {
  return useQuery({
    queryKey: ['live-matches', fixtureIds],
    queryFn: async () => {
      const client = getClient();
      if (!client || fixtureIds.length === 0) return [];
      return await client.getLiveMatches(fixtureIds);
    },
    enabled: enabled && fixtureIds.length > 0,
    staleTime: 0, // Always consider data stale so it refetches
    // Only refetch if at least one match is in progress
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.length === 0) return 60 * 1000; // If no data yet, try again in 1 minute
      const liveStatuses = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'];
      const hasLiveMatch = data.some(match => liveStatuses.includes(match.status));
      return hasLiveMatch ? 60 * 1000 : false; // 1 minute if any match is live, otherwise don't refetch
    },
    retry: false, // Don't retry on 404s
    refetchOnWindowFocus: false, // Don't refetch when window gains focus
  });
}
