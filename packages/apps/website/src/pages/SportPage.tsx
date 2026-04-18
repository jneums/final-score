import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useMarketsList } from '../hooks/useMarkets';
import { ArrowLeft, Calendar, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';

// Map URL slugs to display names + which Polymarket sport codes to query
const SPORT_CONFIG: Record<string, {
  name: string;
  emoji: string;
  description: string;
  polymarketSports: string[];
}> = {
  basketball: {
    name: 'Basketball',
    emoji: '🏀',
    description: 'NBA Playoffs, WNBA, and international leagues',
    polymarketSports: ['nba', 'wnba'],
  },
  football: {
    name: 'Football',
    emoji: '⚽',
    description: 'Premier League, La Liga, Bundesliga, Serie A, Ligue 1, UCL',
    polymarketSports: ['epl', 'lal', 'bun', 'fl1', 'sea', 'ucl'],
  },
  cricket: {
    name: 'Cricket',
    emoji: '🏏',
    description: 'IPL and international matches',
    polymarketSports: ['cricipl', 'ipl'],
  },
  baseball: {
    name: 'Baseball',
    emoji: '⚾',
    description: 'MLB and KBO leagues',
    polymarketSports: ['mlb', 'kbo'],
  },
  hockey: {
    name: 'Hockey',
    emoji: '🏒',
    description: 'NHL and international leagues',
    polymarketSports: ['nhl'],
  },
  'american-football': {
    name: 'American Football',
    emoji: '🏈',
    description: 'NFL and college football',
    polymarketSports: ['nfl'],
  },
};

// League display names for Polymarket sport codes
const LEAGUE_NAMES: Record<string, string> = {
  nba: 'NBA', wnba: 'WNBA', epl: 'Premier League', lal: 'La Liga',
  bun: 'Bundesliga', fl1: 'Ligue 1', sea: 'Serie A', ucl: 'Champions League',
  cricipl: 'IPL', ipl: 'IPL', mlb: 'MLB', kbo: 'KBO',
  nhl: 'NHL', nfl: 'NFL',
};

function formatPrice(bps: number): string {
  if (bps <= 0) return '—';
  return `${(bps / 100).toFixed(0)}¢`;
}

export default function SportPage() {
  const { slug } = useParams();
  const config = SPORT_CONFIG[slug || ''] || {
    name: slug || 'Unknown',
    emoji: '🏆',
    description: '',
    polymarketSports: [],
  };

  // Fetch markets for all leagues in this sport category
  // We fetch without filter and filter client-side since we need multiple sport codes
  const { data: allMarkets, isLoading } = useMarketsList(undefined, 0, 100);

  // Filter to only markets belonging to this sport category
  const sportSlugs = new Set(config.polymarketSports);
  const markets = allMarkets?.markets.filter(m => sportSlugs.has(m.sport)) ?? [];

  // Group markets by event (polymarketSlug)
  const eventGroups = new Map<string, typeof markets>();
  for (const m of markets) {
    const key = m.polymarketSlug;
    if (!eventGroups.has(key)) eventGroups.set(key, []);
    eventGroups.get(key)!.push(m);
  }

  // Sort events by first market's eventTitle
  const events = Array.from(eventGroups.entries()).sort((a, b) =>
    (a[1][0]?.eventTitle ?? '').localeCompare(b[1][0]?.eventTitle ?? '')
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="border-b border-border/50 bg-card/30">
        <div className="container mx-auto px-4 py-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-5xl">{config.emoji}</span>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{config.name}</h1>
              <p className="text-muted-foreground mt-1">{config.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-6">
            <Badge variant="outline" className="border-primary/30 text-primary">
              <Calendar className="w-3 h-3 mr-1" />
              {markets.length} Markets
            </Badge>
            <Badge variant="outline" className="border-green-500/30 text-green-400">
              {events.length} Events
            </Badge>
          </div>
        </div>
      </section>

      {/* Markets */}
      <section className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading markets...</span>
          </div>
        ) : events.length === 0 ? (
          <Card className="border-dashed border-2 border-border/60">
            <CardContent className="py-20 text-center space-y-4">
              <span className="text-6xl block">{config.emoji}</span>
              <h3 className="text-xl font-semibold">No Active Markets</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                {config.name} markets will appear here when matches are scheduled.
                Check back soon.
              </p>
              <Button variant="outline" asChild>
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to All Sports
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {events.map(([eventSlug, eventMarkets]) => {
              const first = eventMarkets[0];
              const league = LEAGUE_NAMES[first.sport] || first.sport.toUpperCase();

              return (
                <Card key={eventSlug} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {league}
                        </Badge>
                        <h3 className="font-semibold text-lg">{first.eventTitle}</h3>
                      </div>
                      <Badge
                        variant="outline"
                        className={first.status === 'open'
                          ? 'border-green-500/30 text-green-400'
                          : 'border-muted text-muted-foreground'}
                      >
                        {first.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {eventMarkets.map((m) => (
                        <Link key={m.marketId} to={`/event/${m.marketId}`}>
                          <div className="p-3 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-card/50 transition-all cursor-pointer group">
                            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                              {m.question}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs">
                              <span className="flex items-center gap-1 text-green-400">
                                <TrendingUp className="w-3 h-3" />
                                Yes {formatPrice(m.yesPrice)}
                              </span>
                              <span className="flex items-center gap-1 text-red-400">
                                <TrendingDown className="w-3 h-3" />
                                No {formatPrice(m.noPrice)}
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
