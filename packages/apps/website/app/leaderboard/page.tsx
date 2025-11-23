'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGetLeaderboardByProfit,
  useGetLeaderboardByAccuracy,
  useGetLeaderboardByVolume,
  useGetLeaderboardByStreak,
  useGetPlatformStats,
  type LeaderboardEntry,
} from "@/hooks/useLeaderboard";

function formatUsdc(amount: bigint): string {
  // USDC has 6 decimals
  const dollars = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

function formatPrincipal(principal: string): string {
  if (principal.length <= 12) return principal;
  return `${principal.slice(0, 6)}...${principal.slice(-4)}`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function LeaderboardTable({ entries, type }: { entries: LeaderboardEntry[], type: 'profit' | 'accuracy' | 'volume' | 'streak' }) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No data available yet.</p>
        <p className="text-sm mt-2">Be the first to place a prediction!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const accuracyRate = entry.stats.totalPredictions > 0n
          ? Number(entry.stats.correctPredictions) / Number(entry.stats.totalPredictions)
          : 0;

        return (
          <Card key={entry.rank.toString()} className="border-2 border-primary/20 hover:border-primary/50 transition-colors bg-card/80">
            <CardContent className="p-5 sm:p-6">
              <div className="flex items-center gap-4 sm:gap-6">
                {/* Rank - Desktop only */}
                <div className="hidden sm:flex flex-shrink-0">
                  {entry.rank <= 3n ? (
                    <span className="text-4xl">
                      {entry.rank === 1n ? '🥇' : entry.rank === 2n ? '🥈' : '🥉'}
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-muted-foreground">
                      #{entry.rank.toString()}
                    </span>
                  )}
                </div>

                {/* User with Avatar */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative flex-shrink-0">
                    <img
                      src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${entry.stats.userPrincipal.toString()}`}
                      alt="User avatar"
                      className="w-12 h-12 sm:w-14 sm:h-14 rounded-full"
                    />
                    {/* Rank Badge - Mobile only */}
                    <div className="absolute -top-1 -right-1 flex items-center justify-center sm:hidden">
                      {entry.rank <= 3n ? (
                        <span className="text-2xl drop-shadow-lg">
                          {entry.rank === 1n ? '🥇' : entry.rank === 2n ? '🥈' : '🥉'}
                        </span>
                      ) : (
                        <div className="bg-primary/90 text-primary-foreground text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-background shadow-lg">
                          {entry.rank.toString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm sm:text-base truncate">
                      {formatPrincipal(entry.stats.userPrincipal.toString())}
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                      {entry.stats.totalPredictions.toString()} prediction{entry.stats.totalPredictions !== 1n ? 's' : ''}
                    </div>
                  </div>
                </div>

                {/* Stats Section */}
                <div className="flex items-center gap-6 sm:gap-10 ml-auto mr-2 sm:mr-4">
                  {/* Main Stat */}
                  <div className="text-right">
                    <div className="text-xl sm:text-2xl font-bold text-primary">
                      {type === 'profit' && formatUsdc(entry.stats.netProfit)}
                      {type === 'accuracy' && formatPercentage(accuracyRate)}
                      {type === 'volume' && formatUsdc(entry.stats.totalWagered)}
                      {type === 'streak' && entry.stats.longestWinStreak.toString()}
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mt-1">
                      {type === 'profit' && 'Net Profit'}
                      {type === 'accuracy' && 'Accuracy'}
                      {type === 'volume' && 'Volume'}
                      {type === 'streak' && 'Win Streak'}
                    </div>
                  </div>

                  {/* Additional Stats */}
                  <div className="text-right space-y-1 hidden sm:block min-w-[120px]">
                    <div className="text-sm sm:text-base">
                      <span className="text-green-500">{entry.stats.correctPredictions.toString()}W</span>
                      {' / '}
                      <span className="text-red-500">{entry.stats.incorrectPredictions.toString()}L</span>
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground">
                      Wagered: {formatUsdc(entry.stats.totalWagered)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function LeaderboardPage() {
  const { data: profitLeaderboard, isLoading: profitLoading } = useGetLeaderboardByProfit(50);
  const { data: accuracyLeaderboard, isLoading: accuracyLoading } = useGetLeaderboardByAccuracy(50, 10);
  const { data: volumeLeaderboard, isLoading: volumeLoading } = useGetLeaderboardByVolume(50);
  const { data: streakLeaderboard, isLoading: streakLoading } = useGetLeaderboardByStreak(50);
  const { data: platformStats } = useGetPlatformStats();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold mb-4">Leaderboard</h1>
            <p className="text-xl text-muted-foreground">
              Top predictors on Final Score
            </p>
          </div>

          {/* Platform Stats */}
          {platformStats && (
            <div className="grid md:grid-cols-4 gap-4 mb-12">
              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-3xl font-bold text-primary">
                    {platformStats.totalUsers.toString()}
                  </CardTitle>
                  <CardDescription>Total Users</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-3xl font-bold text-primary">
                    {platformStats.totalPredictions.toString()}
                  </CardTitle>
                  <CardDescription>Total Predictions</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-3xl font-bold text-primary">
                    {formatUsdc(platformStats.totalVolume)}
                  </CardTitle>
                  <CardDescription>Total Volume</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader className="pb-3">
                  <CardTitle className="text-3xl font-bold text-primary">
                    {platformStats.activeMarkets.toString()}
                  </CardTitle>
                  <CardDescription>Active Markets</CardDescription>
                </CardHeader>
              </Card>
            </div>
          )}

          {/* Leaderboard Tabs */}
          <Tabs defaultValue="profit" className="w-full">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-8 h-auto sm:h-14 bg-muted p-1.5 rounded-xl gap-1.5 sm:gap-0">
              <TabsTrigger 
                value="profit" 
                className="text-sm sm:text-base font-semibold py-3 sm:py-0 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-lg"
              >
                💰 Profit
              </TabsTrigger>
              <TabsTrigger 
                value="accuracy"
                className="text-sm sm:text-base font-semibold py-3 sm:py-0 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-lg"
              >
                🎯 Accuracy
              </TabsTrigger>
              <TabsTrigger 
                value="volume"
                className="text-sm sm:text-base font-semibold py-3 sm:py-0 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-lg"
              >
                📊 Volume
              </TabsTrigger>
              <TabsTrigger 
                value="streak"
                className="text-sm sm:text-base font-semibold py-3 sm:py-0 data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-lg"
              >
                🔥 Streak
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profit">
              <Card className="border-2 border-primary/20 bg-card/80">
                <CardHeader>
                  <CardTitle>Top Earners</CardTitle>
                  <CardDescription>
                    Users ranked by net profit (winnings minus losses)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {profitLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading...</p>
                    </div>
                  ) : (
                    <LeaderboardTable entries={profitLeaderboard || []} type="profit" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="accuracy">
              <Card className="border-2 border-primary/20 bg-card/80">
                <CardHeader>
                  <CardTitle>Most Accurate</CardTitle>
                  <CardDescription>
                    Users ranked by prediction accuracy (minimum 10 predictions)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {accuracyLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading...</p>
                    </div>
                  ) : (
                    <LeaderboardTable entries={accuracyLeaderboard || []} type="accuracy" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="volume">
              <Card className="border-2 border-primary/20 bg-card/80">
                <CardHeader>
                  <CardTitle>Highest Volume</CardTitle>
                  <CardDescription>
                    Users ranked by total amount wagered
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {volumeLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading...</p>
                    </div>
                  ) : (
                    <LeaderboardTable entries={volumeLeaderboard || []} type="volume" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="streak">
              <Card className="border-2 border-primary/20 bg-card/80">
                <CardHeader>
                  <CardTitle>Longest Win Streaks</CardTitle>
                  <CardDescription>
                    Users ranked by their longest consecutive winning streak
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {streakLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading...</p>
                    </div>
                  ) : (
                    <LeaderboardTable entries={streakLeaderboard || []} type="streak" />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
