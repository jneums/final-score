'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useGetPlatformStats } from "@/hooks/useLeaderboard";

function formatUsdc(amount: bigint): string {
  const dollars = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(dollars);
}

export default function Home() {
  const { data: stats } = useGetPlatformStats();

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b bg-gradient-to-br from-primary/5 via-background to-accent/10">
        <div className="container mx-auto px-4 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto text-center space-y-10">
            <div className="space-y-6">
              <h1 className="text-5xl sm:text-7xl font-bold text-foreground bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Final Score
              </h1>
              <p className="text-xl sm:text-2xl text-muted-foreground leading-relaxed">
                AI-Powered Sports Prediction Market
              </p>
              <p className="text-lg sm:text-xl text-muted-foreground/80 max-w-3xl mx-auto leading-relaxed">
                Predict football match outcomes, compete on the leaderboard, and win with AI-powered insights.
              </p>
            </div>

            <div className="flex gap-5 justify-center flex-wrap pt-6">
              <Link href="/leaderboard">
                <Button size="lg" className="text-lg px-10 py-7 h-auto font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                  View Leaderboard
                </Button>
              </Link>
              <Link href="https://github.com/jneums/final-score" target="_blank">
                <Button size="lg" variant="outline" className="text-lg px-10 py-7 h-auto font-semibold border-2 hover:bg-accent/50">
                  View on GitHub
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
            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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

            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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

            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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

            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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

            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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

            <Card className="border-2 hover:border-primary/50 transition-all hover:shadow-xl hover:shadow-primary/5 bg-card/50 backdrop-blur">
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
              <Card className="border-2 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.totalUsers ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Total Users</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.activeMarkets ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Active Markets</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 bg-card/50 backdrop-blur text-center">
                <CardHeader>
                  <CardTitle className="text-5xl font-bold text-primary">
                    {stats?.totalPredictions ?? 0}
                  </CardTitle>
                  <CardDescription className="text-lg mt-2">Total Predictions</CardDescription>
                </CardHeader>
              </Card>

              <Card className="border-2 bg-card/50 backdrop-blur text-center">
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

      {/* CTA Section */}
      <section className="border-t bg-gradient-to-br from-primary/5 via-background to-accent/10">
        <div className="container mx-auto px-4 py-32 sm:py-40">
          <div className="max-w-4xl mx-auto text-center space-y-10">
            <h2 className="text-5xl sm:text-6xl font-bold">Ready to Predict?</h2>
            <p className="text-2xl sm:text-3xl text-muted-foreground/90 font-light leading-relaxed max-w-3xl mx-auto">
              Join the future of sports prediction markets on the Internet Computer.
            </p>
            <Link href="/leaderboard">
              <Button size="lg" className="text-xl px-12 py-8 h-auto font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                View Leaderboard
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
