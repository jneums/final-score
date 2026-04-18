import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useSportMarkets } from '../hooks/useMarkets';
import { ArrowLeft, Calendar, Loader2 } from 'lucide-react';

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

// Colors for outcome rows (cycle through for multi-outcome events)
const OUTCOME_COLORS = [
  { bar: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30' },
  { bar: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/30' },
  { bar: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' },
  { bar: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/30' },
];

// Extract a short team/outcome name from the question
function extractOutcomeName(question: string): string {
  // "Will Texas Rangers win?" → "Texas Rangers"
  // "Will Texas Rangers win on 2026-04-20?" → "Texas Rangers"
  const willMatch = question.match(/^Will (.+?)(?:\s+win(?:\s+on\s+\d{4}-\d{2}-\d{2})?\??|$)/i);
  if (willMatch) return willMatch[1];

  // "Will X vs Y end in a draw?" → "Draw"
  if (/end in a draw/i.test(question)) return 'Draw';

  return question;
}

export default function SportPage() {
  const { slug } = useParams();
  const config = SPORT_CONFIG[slug || ''] || {
    name: slug || 'Unknown',
    emoji: '🏆',
    description: '',
    polymarketSports: [],
  };

  // Fetch markets using server-side sport filter (one query per sport code)
  const { markets, isLoading } = useSportMarkets(config.polymarketSports);

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
              {events.length} Event{events.length !== 1 ? 's' : ''}
            </Badge>
            <Badge variant="outline" className="border-green-500/30 text-green-400">
              {markets.length} Market{markets.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </div>
      </section>

      {/* Events */}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map(([eventSlug, eventMarkets]) => {
              const first = eventMarkets[0];
              const league = LEAGUE_NAMES[first.sport] || first.sport.toUpperCase();

              // Filter to just outcome markets (exclude draws for the bar display)
              const outcomes = eventMarkets.filter(m => !/end in a draw/i.test(m.question));
              const hasDraw = eventMarkets.length > outcomes.length;

              // Compute total yes price for normalization
              const totalYes = outcomes.reduce((sum, m) => sum + m.yesPrice, 0);

              return (
                <Link key={eventSlug} to={`/event/${first.marketId}`}>
                  <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full py-0 gap-0">
                    <CardContent className="p-5 flex flex-col h-full">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {league}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={first.status === 'Open'
                              ? 'border-green-500/30 text-green-400'
                              : 'border-muted text-muted-foreground'}
                          >
                            {first.status}
                          </Badge>
                        </div>
                      </div>

                      {/* Event Title */}
                      <h3 className="font-semibold text-sm leading-snug mb-4">{first.eventTitle}</h3>

                      {/* Outcome Rows */}
                      <div className="space-y-2.5 flex-1">
                        {outcomes.map((m, i) => {
                          const name = extractOutcomeName(m.question);
                          const percent = totalYes > 0 ? Math.round((m.yesPrice / totalYes) * 100) : 50;
                          const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length];

                          return (
                            <div key={m.marketId} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium truncate mr-2">{name}</span>
                                <Badge variant="outline" className={`text-xs font-mono shrink-0 ${color.border} ${color.text}`}>
                                  {percent}%
                                </Badge>
                              </div>
                              {/* Probability bar */}
                              <div className="h-1 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${color.bar} transition-all`}
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                        <span>
                          {eventMarkets.length} market{eventMarkets.length !== 1 ? 's' : ''}
                          {hasDraw ? ' · Draw' : ''}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
