import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { usePlatformStats } from '../hooks/useMarkets';
import { getLeaderboardByProfit } from '@final-score/ic-js';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy,
  TrendingUp,
  Users,
  BarChart3,
  Activity,
  Medal,
  Loader2,
  ChevronDown,
} from 'lucide-react';

function truncatePrincipal(p: string): string {
  if (!p || p.length < 16) return p;
  return `${p.slice(0, 5)}...${p.slice(-3)}`;
}

function formatUsdc(amount: bigint): string {
  const num = Number(amount) / 1_000_000;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  if (num < 0) return `-$${Math.abs(num).toFixed(2)}`;
  return `$${num.toFixed(2)}`;
}

export default function LeaderboardPage() {
  const [limit, setLimit] = useState(25);
  const { data: stats, isLoading: statsLoading } = usePlatformStats();

  const { data: entries, isLoading: lbLoading } = useQuery({
    queryKey: ['leaderboard-profit', limit],
    queryFn: () => getLeaderboardByProfit(limit),
    staleTime: 60 * 1000,
  });

  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="border-b border-border/50 bg-card/30">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Trophy className="w-7 h-7 text-primary" />
            Leaderboard
          </h1>
          <p className="text-muted-foreground mt-1">Top traders ranked by net profit</p>
        </div>
      </section>

      {/* Platform Stats */}
      <section className="border-b border-border/50 bg-card/20">
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Activity className="w-4 h-4" />
                Active Markets
              </div>
              <p className="text-xl font-bold">
                {statsLoading ? '—' : stats?.activeMarkets ?? 0}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <TrendingUp className="w-4 h-4" />
                Total Trades
              </div>
              <p className="text-xl font-bold">
                {statsLoading ? '—' : stats?.totalPredictions ?? 0}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <BarChart3 className="w-4 h-4" />
                Volume
              </div>
              <p className="text-xl font-bold">
                {statsLoading ? '—' : `$${((stats?.totalVolume ?? 0) / 1_000_000).toLocaleString()}`}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Users className="w-4 h-4" />
                Users
              </div>
              <p className="text-xl font-bold">
                {statsLoading ? '—' : stats?.totalUsers ?? 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Leaderboard Table */}
      <section className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Medal className="w-5 h-5 text-primary" />
                Rankings
              </span>
              <Badge variant="outline" className="text-xs">
                {entries?.length ?? 0} traders
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 mt-4">
            {lbLoading ? (
              <div className="py-16 text-center">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
                <p className="text-muted-foreground mt-3">Loading leaderboard...</p>
              </div>
            ) : !entries || entries.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Trophy className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No leaderboard data yet</p>
                <p className="text-sm mt-1">Start trading to appear on the leaderboard</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-4 font-medium text-muted-foreground w-16">Rank</th>
                      <th className="text-left p-4 font-medium text-muted-foreground">Trader</th>
                      <th className="text-right p-4 font-medium text-muted-foreground">Net Profit</th>
                      <th className="text-right p-4 font-medium text-muted-foreground">Volume</th>
                      <th className="text-right p-4 font-medium text-muted-foreground">Trades</th>
                      <th className="text-right p-4 font-medium text-muted-foreground">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, idx) => {
                      const s = entry.stats;
                      const totalMarkets = Number(s.marketsWon) + Number(s.marketsLost);
                      const winRate = totalMarkets > 0
                        ? ((Number(s.marketsWon) / totalMarkets) * 100).toFixed(1)
                        : '—';
                      const netProfit = Number(s.netProfit);
                      const isPositive = netProfit >= 0;

                      return (
                        <tr
                          key={s.userPrincipal.toString()}
                          className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${idx % 2 === 0 ? 'bg-transparent' : 'bg-muted/10'}`}
                        >
                          <td className="p-4">
                            <span className={`font-bold ${Number(entry.rank) <= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
                              {Number(entry.rank) === 1 && '🥇 '}
                              {Number(entry.rank) === 2 && '🥈 '}
                              {Number(entry.rank) === 3 && '🥉 '}
                              #{Number(entry.rank)}
                            </span>
                          </td>
                          <td className="p-4">
                            <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                              {truncatePrincipal(s.userPrincipal.toString())}
                            </code>
                          </td>
                          <td className={`p-4 text-right font-semibold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                            {formatUsdc(s.netProfit)}
                          </td>
                          <td className="p-4 text-right text-muted-foreground">
                            {formatUsdc(s.totalVolume)}
                          </td>
                          <td className="p-4 text-right text-muted-foreground">
                            {Number(s.totalTrades)}
                          </td>
                          <td className="p-4 text-right">
                            {winRate !== '—' ? (
                              <Badge
                                variant="outline"
                                className={`${parseFloat(winRate) >= 50 ? 'border-green-500/30 text-green-400' : 'border-red-500/30 text-red-400'}`}
                              >
                                {winRate}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Load More */}
            {entries && entries.length >= limit && (
              <div className="p-4 text-center border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((prev) => prev + 25)}
                >
                  <ChevronDown className="w-4 h-4 mr-2" />
                  Load More
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
