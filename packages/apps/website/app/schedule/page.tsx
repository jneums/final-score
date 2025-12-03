'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useGetUpcomingMatches, type Market } from "@/hooks/useLeaderboard";
import { BookmakerOdds } from "@/components/BookmakerOdds";
import { LiveScore } from "@/components/LiveScore";

function formatUsdc(amount: bigint): string {
  const dollars = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

function formatDate(timestamp: bigint): string {
  const date = new Date(Number(timestamp) / 1_000_000); // Convert nanoseconds to milliseconds
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(timestamp: bigint): string {
  const date = new Date(Number(timestamp) / 1_000_000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // If within 24 hours, show relative time
  if (diffHours > 0 && diffHours < 24) {
    const hours = Math.floor(diffHours);
    const minutes = Math.floor((diffHours - hours) * 60);
    
    if (hours === 0) {
      return `in ${minutes} min${minutes !== 1 ? 's' : ''}`;
    }
    return `in ${hours}h ${minutes}m`;
  }
  
  // Otherwise show absolute time
  return formatDate(timestamp);
}

function calculateOdds(outcomePool: bigint, totalPool: bigint): number {
  if (outcomePool === 0n || totalPool === 0n) return 0;
  return Number(totalPool) / Number(outcomePool);
}

/**
 * Extract API Football fixture ID from market data
 */
function getFixtureId(market: Market): number | null {
  // Use the apiFootballId from the market if available
  if (market.apiFootballId && market.apiFootballId.length > 0) {
    const apiId = market.apiFootballId[0];
    if (apiId) {
      const id = parseInt(apiId);
      if (!isNaN(id)) return id;
    }
  }
  return null;
}

function MatchCard({ market }: { market: Market }) {
  const homeOdds = calculateOdds(market.homeWinPool, market.totalPool);
  const awayOdds = calculateOdds(market.awayWinPool, market.totalPool);
  const drawOdds = calculateOdds(market.drawPool, market.totalPool);
  const fixtureId = getFixtureId(market);

  // Check market status - use the canister's status, not client-side time check
  const isOpen = 'Open' in market.status;
  const isClosed = 'Closed' in market.status;
  const isResolved = 'Resolved' in market.status;

  // Enable live score only for open or closed markets (not resolved)
  const enableLiveScore = (isOpen || isClosed) && fixtureId !== null;
  // Enable odds for open markets
  const enableOdds = isOpen && fixtureId !== null;

  return (
    <Card className="border-2 border-primary/20 hover:border-primary/50 transition-colors bg-card/80">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-3">
              <CardTitle className="text-2xl">{market.homeTeam} vs {market.awayTeam}</CardTitle>
              {isOpen ? (
                <Badge className="bg-green-500/90 hover:bg-green-500 border-green-400/50 text-white">Open</Badge>
              ) : isClosed ? (
                <Badge className="bg-muted border-primary/30 text-foreground">Closed</Badge>
              ) : (
                <Badge className="bg-accent/50 border-accent text-accent-foreground">Resolved</Badge>
              )}
            </div>
            <CardDescription className="text-base">
              🕒 {formatDate(market.kickoffTime)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live Score (if match is in progress) */}
        <LiveScore 
          fixtureId={fixtureId} 
          enabled={enableLiveScore}
          homeTeam={market.homeTeam}
          awayTeam={market.awayTeam}
        />

        {/* Pool Information */}
        <div className="flex items-center justify-between p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div>
            <p className="text-sm text-muted-foreground">Total Pool</p>
            <p className="text-2xl font-bold text-primary">{formatUsdc(market.totalPool)}</p>
          </div>
          {isOpen && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Betting closes</p>
              <p className="text-sm font-medium text-foreground">{formatRelativeTime(market.bettingDeadline)}</p>
            </div>
          )}
        </div>

        {/* Odds Distribution */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Home Win</p>
            <p className="text-xl font-bold text-primary">{homeOdds > 0 ? homeOdds.toFixed(2) : '-'}x</p>
            <p className="text-xs text-muted-foreground mt-2">{formatUsdc(market.homeWinPool)}</p>
          </div>

          <div className="text-center p-3 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Draw</p>
            <p className="text-xl font-bold text-primary">{drawOdds > 0 ? drawOdds.toFixed(2) : '-'}x</p>
            <p className="text-xs text-muted-foreground mt-2">{formatUsdc(market.drawPool)}</p>
          </div>

          <div className="text-center p-3 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded-lg">
            <p className="text-xs text-muted-foreground mb-1">Away Win</p>
            <p className="text-xl font-bold text-primary">{awayOdds > 0 ? awayOdds.toFixed(2) : '-'}x</p>
            <p className="text-xs text-muted-foreground mt-2">{formatUsdc(market.awayWinPool)}</p>
          </div>
        </div>

        {/* Visual Pool Distribution */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Pool Distribution</p>
          <div className="flex h-4 rounded-full overflow-hidden bg-card border border-primary/20">
            {market.totalPool > 0n && (
              <>
                <div 
                  className="bg-primary/80" 
                  style={{ width: `${(Number(market.homeWinPool) / Number(market.totalPool)) * 100}%` }}
                  title={`Home: ${formatUsdc(market.homeWinPool)}`}
                />
                <div 
                  className="bg-muted-foreground/60" 
                  style={{ width: `${(Number(market.drawPool) / Number(market.totalPool)) * 100}%` }}
                  title={`Draw: ${formatUsdc(market.drawPool)}`}
                />
                <div 
                  className="bg-accent/80" 
                  style={{ width: `${(Number(market.awayWinPool) / Number(market.totalPool)) * 100}%` }}
                  title={`Away: ${formatUsdc(market.awayWinPool)}`}
                />
              </>
            )}
          </div>
        </div>

        {/* Bookmaker Odds (underneath pool distributions) */}
        <BookmakerOdds fixtureId={fixtureId} enabled={enableOdds} />
      </CardContent>
    </Card>
  );
}

export default function SchedulePage() {
  const { data: matches, isLoading } = useGetUpcomingMatches(20);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold mb-4">Match Schedule</h1>
            <p className="text-xl text-muted-foreground">
              Upcoming matches and current pool distributions
            </p>
          </div>

          {/* Matches List */}
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Loading matches...</p>
            </div>
          ) : !matches || matches.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-lg text-muted-foreground">No upcoming matches available.</p>
              <p className="text-sm text-muted-foreground mt-2">Check back later for new prediction markets!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {matches.map((market) => (
                <MatchCard key={market.marketId} market={market} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
