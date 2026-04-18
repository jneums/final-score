import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { usePlatformStats, useMarketCount, useMarketsList } from '../hooks/useMarkets';
import {
  TrendingUp,
  Users,
  BarChart3,
  Activity,
  Trophy,
  Zap,
  ArrowRight,
  Globe,
} from 'lucide-react';

// Sport categories that map to Polymarket sport slugs
const SPORTS = [
  {
    slug: 'basketball',
    name: 'Basketball',
    emoji: '🏀',
    polymarketSports: ['nba', 'wnba'],
  },
  {
    slug: 'football',
    name: 'Football',
    emoji: '⚽',
    polymarketSports: ['epl', 'lal', 'bun', 'fl1', 'sea', 'ucl'],
  },
  {
    slug: 'cricket',
    name: 'Cricket',
    emoji: '🏏',
    polymarketSports: ['cricipl', 'ipl'],
  },
  {
    slug: 'baseball',
    name: 'Baseball',
    emoji: '⚾',
    polymarketSports: ['mlb', 'kbo'],
  },
  {
    slug: 'hockey',
    name: 'Hockey',
    emoji: '🏒',
    polymarketSports: ['nhl'],
  },
  {
    slug: 'american-football',
    name: 'American Football',
    emoji: '🏈',
    polymarketSports: ['nfl'],
  },
];

export default function HomePage() {
  const { data: stats, isLoading: statsLoading } = usePlatformStats();
  const { data: marketCount, isLoading: countLoading } = useMarketCount();
  // Fetch all markets to compute per-sport counts
  const { data: allMarkets } = useMarketsList(undefined, 0, 100);

  // Compute per-sport-category counts from actual market data
  const sportCounts: Record<string, number> = {};
  if (allMarkets?.markets) {
    for (const m of allMarkets.markets) {
      for (const sport of SPORTS) {
        if (sport.polymarketSports.includes(m.sport)) {
          sportCounts[sport.slug] = (sportCounts[sport.slug] || 0) + 1;
        }
      }
    }
  }

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <div className="container mx-auto px-4 py-16 sm:py-24 relative">
          <div className="text-center space-y-6 max-w-4xl mx-auto">
            <Badge variant="outline" className="text-sm px-4 py-1.5 border-primary/30 text-primary">
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              Powered by Internet Computer
            </Badge>
            <h1 className="text-5xl sm:text-7xl font-bold tracking-tight bg-gradient-to-r from-primary via-foreground to-accent bg-clip-text text-transparent">
              Final Score
            </h1>
            <p className="text-xl sm:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              On-chain sports prediction markets. Trade outcomes on real events with USDC — fully decentralized, transparent, and instant.
            </p>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <Button size="lg" asChild>
                <Link to="/leaderboard">
                  <Trophy className="w-4 h-4 mr-2" />
                  View Leaderboard
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/portfolio">
                  <BarChart3 className="w-4 h-4 mr-2" />
                  My Portfolio
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Platform Stats Bar */}
      <section className="border-b border-border/50 bg-card/30">
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Activity className="w-4 h-4" />
                Active Markets
              </div>
              <p className="text-2xl font-bold text-foreground">
                {statsLoading ? '—' : stats?.activeMarkets ?? 0}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <TrendingUp className="w-4 h-4" />
                Total Trades
              </div>
              <p className="text-2xl font-bold text-foreground">
                {statsLoading ? '—' : stats?.totalTrades ?? 0}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <BarChart3 className="w-4 h-4" />
                Total Volume
              </div>
              <p className="text-2xl font-bold text-foreground">
                {statsLoading ? '—' : `$${((stats?.totalVolume ?? 0) / 1_000_000).toLocaleString()}`}
              </p>
            </div>
            <div className="text-center space-y-1">
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Users className="w-4 h-4" />
                Total Users
              </div>
              <p className="text-2xl font-bold text-foreground">
                {statsLoading ? '—' : stats?.totalUsers ?? 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* All Sports Section */}
      <section className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Globe className="w-6 h-6 text-primary" />
              All Sports
            </h2>
            <p className="text-muted-foreground mt-1">Browse prediction markets by sport</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
          {SPORTS.map((sport) => {
            const count = sportCounts[sport.slug] || 0;
            return (
              <Link key={sport.slug} to={`/sport/${sport.slug}`}>
                <Card className="hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 cursor-pointer group">
                  <CardContent className="p-6 text-center">
                    <span className="text-4xl block mb-3">{sport.emoji}</span>
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {sport.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {count > 0 ? `${count} markets` : 'No active markets'}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Markets Overview */}
      <section className="container mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-primary" />
              Markets Overview
            </h2>
            <p className="text-muted-foreground mt-1">
              {countLoading
                ? 'Loading markets...'
                : `${marketCount?.total ?? 0} total markets synced from Polymarket`}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Open</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-400">
                {countLoading ? '—' : marketCount?.open ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-400">
                {countLoading ? '—' : marketCount?.resolved ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Closed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-muted-foreground">
                {countLoading ? '—' : marketCount?.closed ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Getting Started CTA */}
      <section className="container mx-auto px-4 py-12 pb-20">
        <Card className="bg-gradient-to-br from-primary/10 via-card to-accent/10 border-primary/20">
          <CardContent className="p-8 sm:p-12 text-center space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Get Started</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              Connect your wallet, fund with USDC, and start trading on sports outcomes.
              All trades settle on-chain — transparent and trustless.
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center text-sm">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">1</span>
                <span className="text-foreground font-medium">Connect Wallet</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">2</span>
                <span className="text-foreground font-medium">Set USDC Allowance</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center text-sm">3</span>
                <span className="text-foreground font-medium">Trade Outcomes</span>
              </div>
            </div>
            <div className="pt-2">
              <Button size="lg" className="text-base px-8">
                Launch App
                <Zap className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
