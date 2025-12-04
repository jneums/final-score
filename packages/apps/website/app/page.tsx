'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useGetPlatformStats, useGetUpcomingMatches, useGetLeaderboardByProfit, type MarketWithBettors, type LeaderboardEntry } from "@/hooks/useLeaderboard";
import { useState } from "react";
import { MarketBettors } from "@/components/MarketBettors";

function formatUsdc(amount: bigint): string {
  const dollars = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

function formatDate(timestamp: bigint): string {
  const date = new Date(Number(timestamp) / 1_000_000);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function calculateOdds(outcomePool: bigint, totalPool: bigint): number {
  if (outcomePool === 0n || totalPool === 0n) return 0;
  return Number(totalPool) / Number(outcomePool);
}

function FeaturedMatch({ market }: { market: MarketWithBettors }) {
  const homeOdds = calculateOdds(market.homeWinPool, market.totalPool);
  const awayOdds = calculateOdds(market.awayWinPool, market.totalPool);
  const drawOdds = calculateOdds(market.drawPool, market.totalPool);

  return (
    <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/10 bg-card/80">
      <CardHeader>
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            <CardTitle className="text-xl mb-2 min-h-[3.5rem]">{market.homeTeam} vs {market.awayTeam}</CardTitle>
            <CardDescription className="text-sm">
              🕒 {formatDate(market.kickoffTime)}
            </CardDescription>
          </div>
          <Badge className="bg-green-500/90 hover:bg-green-500 border-green-400/50 shrink-0">Open</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground">Total Pool</p>
            <p className="text-xl font-bold text-primary">{formatUsdc(market.totalPool)}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded">
            <p className="text-xs text-muted-foreground">Home</p>
            <p className="text-lg font-bold text-primary">{homeOdds > 0 ? homeOdds.toFixed(2) : '-'}x</p>
          </div>
          <div className="text-center p-2 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded">
            <p className="text-xs text-muted-foreground">Draw</p>
            <p className="text-lg font-bold text-primary">{drawOdds > 0 ? drawOdds.toFixed(2) : '-'}x</p>
          </div>
          <div className="text-center p-2 bg-card border-2 border-primary/20 hover:border-primary/40 transition-colors rounded">
            <p className="text-xs text-muted-foreground">Away</p>
            <p className="text-lg font-bold text-primary">{awayOdds > 0 ? awayOdds.toFixed(2) : '-'}x</p>
          </div>
        </div>

        {/* Social Proof */}
        <div className="pt-2 border-t border-primary/10">
          <MarketBettors bettors={market.recentBettors} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { data: stats } = useGetPlatformStats();
  const { data: allMatches } = useGetUpcomingMatches(50);
  const { data: topPredictors } = useGetLeaderboardByProfit(3);
  
  // Get top 3 matches by pool size
  const topMatches = allMatches
    ?.sort((a, b) => Number(b.totalPool - a.totalPool))
    .slice(0, 3) ?? [];

  const formatPrincipal = (principal: string): string => {
    if (principal.length <= 12) return principal;
    return `${principal.slice(0, 6)}...${principal.slice(-4)}`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b h-[85vh] sm:h-[70vh] min-h-[600px] sm:min-h-[500px] max-h-[900px] sm:max-h-[800px] flex items-center justify-center">
        {/* Background Banner Image */}
        <div className="absolute inset-0 z-0 w-full h-full">
          <img 
            src="/banner-final-score.webp" 
            alt="Final Score Banner" 
            className="w-full h-full object-cover block"
          />
          {/* Dark gradient overlay for text visibility */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-background/80 via-background/70 to-background/90"></div>
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-background/50 via-transparent to-background/50"></div>
        </div>

        {/* Hero Content */}
        <div className="container mx-auto px-4 py-12 sm:py-24 relative z-10">
          <div className="max-w-4xl mx-auto text-center space-y-10">
            <div className="space-y-6">
              <h1 className="text-5xl sm:text-7xl font-bold text-foreground drop-shadow-2xl">
                Final Score
              </h1>
              <p className="text-xl sm:text-2xl text-foreground/90 leading-relaxed drop-shadow-lg font-semibold">
                AI-Powered Sports Prediction Market
              </p>
              <p className="text-lg sm:text-xl text-foreground/80 max-w-3xl mx-auto leading-relaxed drop-shadow-md">
                Predict football match outcomes, compete on the leaderboard, and win with AI-powered insights.
              </p>
            </div>

            <div className="flex gap-5 justify-center flex-wrap pt-6">
              <Link href="/schedule">
                <Button size="lg" className="text-lg px-10 py-7 h-auto font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                  View Available Markets
                </Button>
              </Link>
              <Link href="/leaderboard">
                <Button size="lg" variant="outline" className="text-lg px-10 py-7 h-auto font-semibold border-2 hover:bg-accent/50">
                  View Leaderboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-muted/20">
        <div className="container mx-auto px-4 py-24 sm:py-32">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-bold mb-5">How It Works</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Built on the Internet Computer with AI-first design
              </p>
            </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">⚽</span>
                  Predict Outcomes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Place predictions on football match outcomes using our parimutuel betting system. Winners share the prize pool.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">🤖</span>
                  AI Integration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Interact with the prediction market through AI agents via the Model Context Protocol.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">🏆</span>
                  Compete & Win
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Climb the leaderboard by making accurate predictions. Track your performance and compete with others.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">💰</span>
                  Virtual Accounts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Deposit funds once into your virtual account for fast, gasless predictions on any market.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">🔮</span>
                  Football Oracle
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Markets are settled automatically using the trusted Football Oracle as the source of truth.
                </CardDescription>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">⚡</span>
                  On-Chain Speed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
                  Fully on-chain architecture on ICP provides fast execution with low costs and high security.
                </CardDescription>
              </CardContent>
            </Card>
          </div>
        </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-t">
        <div className="container mx-auto px-4 py-24 sm:py-32">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-bold mb-5">Live Statistics</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Real-time insights into the prediction market
              </p>
            </div>
            <div className="grid md:grid-cols-4 gap-8">
              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.totalUsers ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Total Users</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.activeMarkets ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Active Markets</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.totalPredictions ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Total Predictions</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.totalVolume ? formatUsdc(stats.totalVolume) : '$0'}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Total Volume</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Matches Section */}
      <section className="bg-muted/20 border-t">
        <div className="container mx-auto px-4 py-24 sm:py-32">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-bold mb-5">🔥 Hottest Markets</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Top prediction markets by total pool size
              </p>
            </div>
            
            {topMatches.length > 0 ? (
              <div className="grid md:grid-cols-3 gap-6">
                {topMatches.map((match) => (
                  <FeaturedMatch key={match.marketId} market={match} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No active markets available</p>
              </div>
            )}
            
            <div className="text-center mt-12">
              <Link href="/schedule">
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 h-auto font-semibold border-2">
                  View All Markets →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Top Predictors Section */}
      <section className="border-t">
        <div className="container mx-auto px-4 py-24 sm:py-32">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-5xl font-bold mb-5">🏆 Top Predictors</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Leading competitors on the leaderboard
              </p>
            </div>
            
            {topPredictors && topPredictors.length > 0 ? (
              <div className="grid md:grid-cols-3 gap-6">
                {topPredictors.map((entry, index) => (
                  <Card key={entry.rank.toString()} className="border-2 border-primary/20 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/10 bg-card/80">
                    <CardContent className="p-6 text-center">
                      <div className="mb-4">
                        <span className="text-6xl">
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                        </span>
                      </div>
                      <div className="mb-4">
                        <img
                          src={`https://api.dicebear.com/9.x/adventurer/svg?seed=${entry.stats.userPrincipal.toString()}`}
                          alt="User avatar"
                          className="w-20 h-20 rounded-full mx-auto border-4 border-primary/20"
                        />
                      </div>
                      <div className="mb-4">
                        <div className="font-mono text-sm text-foreground/90 mb-1">
                          {formatPrincipal(entry.stats.userPrincipal.toString())}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.stats.totalPredictions.toString()} predictions
                        </div>
                      </div>
                      <div className="mb-3">
                        <div className="text-3xl font-bold text-primary mb-1">
                          {formatUsdc(entry.stats.netProfit)}
                        </div>
                        <div className="text-sm text-muted-foreground">Net Profit</div>
                      </div>
                      <div className="flex justify-center gap-4 text-sm">
                        <div>
                          <span className="text-green-500 font-semibold">{entry.stats.correctPredictions.toString()}W</span>
                        </div>
                        <div className="text-muted-foreground">/</div>
                        <div>
                          <span className="text-red-500 font-semibold">{entry.stats.incorrectPredictions.toString()}L</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No leaderboard data available yet</p>
              </div>
            )}
            
            <div className="text-center mt-12">
              <Link href="/leaderboard">
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 h-auto font-semibold border-2">
                  View Full Leaderboard →
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t bg-gradient-to-br from-primary/5 via-background to-accent/10">
        <div className="container mx-auto px-4 py-32 sm:py-40">
          <div className="max-w-5xl mx-auto space-y-16">
            <div className="text-center space-y-6">
              <h2 className="text-5xl sm:text-6xl font-bold">Ready to Get Started?</h2>
              <p className="text-2xl text-muted-foreground/90 font-light leading-relaxed max-w-3xl mx-auto">
                Connect your AI agent to Final Score and start predicting match outcomes.
              </p>
            </div>

            {/* Getting Started Steps */}
            <div className="space-y-6">
              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                      1
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-2xl mb-2">Connect to MCP Server</CardTitle>
                      <CardDescription className="text-base">
                        Connect using your preferred MCP client (VSCode, Claude Desktop, Cursor, n8n) or join our{' '}
                        <a href="https://discord.gg/gRehbTFZZ2" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          Discord
                        </a>{' '}
                        for an easy-to-use bot.
                      </CardDescription>
                      <div className="mt-4 flex items-center gap-2">
                        <div className="flex-1 p-3 bg-muted rounded-lg text-sm break-all" style={{ fontFamily: 'var(--font-inter)' }}>
                          https://ilyol-uqaaa-aaaai-q34kq-cai.icp0.io/mcp
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText('https://ilyol-uqaaa-aaaai-q34kq-cai.icp0.io/mcp');
                          }}
                          className="shrink-0"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                      2
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-2xl mb-2">Add Funds to Your Wallet</CardTitle>
                      <CardDescription className="text-base space-y-3">
                        <p>
                          Visit Prometheus Protocol to set up your wallet. Find your wallet address by clicking your avatar in the app bar.
                        </p>
                        <p>
                          Get USDC on any IC DEX, or bridge from other chains using{' '}
                          <Link href="https://onesec.to" target="_blank" className="text-primary hover:underline inline-flex items-center gap-1">
                            onesec.to
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </Link>{' '}
                          and send to your Prometheus wallet.
                        </p>
                      </CardDescription>
                      <div className="mt-4">
                        <Link href="https://prometheusprotocol.org/app/io.github.jneums.final-score" target="_blank">
                          <Button className="gap-2">
                            Open Prometheus Protocol
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                      3
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-2xl mb-2">Fund Your Account</CardTitle>
                      <CardDescription className="text-base space-y-3">
                        <p>
                          In Prometheus Protocol, approve Final Score to spend your USDC (we recommend starting with $10).
                        </p>
                        <p>
                          Then ask your AI agent to fund your account. It will handle the deposit and confirm your balance.
                        </p>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
                      4
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-2xl mb-2">Start Placing Predictions! 🎯</CardTitle>
                      <CardDescription className="text-base">
                        Ask your AI agent to place predictions on match outcomes. It can analyze odds, check pool distributions, and place intelligent bets for you.
                      </CardDescription>
                      <div className="mt-4 flex flex-row flex-wrap gap-3 sm:gap-4">
                        <Link href="/schedule">
                          <Button size="lg" className="gap-2">
                            View Available Markets
                          </Button>
                        </Link>
                        <Link href="/leaderboard">
                          <Button size="lg" variant="outline" className="gap-2">
                            See Leaderboard
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
