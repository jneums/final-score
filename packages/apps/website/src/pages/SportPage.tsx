import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useMarketCount } from '../hooks/useMarkets';
import { ArrowLeft, Calendar, Clock, Search } from 'lucide-react';

const SPORT_META: Record<string, { name: string; emoji: string; description: string }> = {
  cricket: { name: 'Cricket', emoji: '🏏', description: 'IPL, international matches, and more' },
  football: { name: 'Football', emoji: '⚽', description: 'Premier League, Champions League, World Cup' },
  basketball: { name: 'Basketball', emoji: '🏀', description: 'NBA, EuroLeague, and international' },
  tennis: { name: 'Tennis', emoji: '🎾', description: 'Grand Slams, ATP, WTA tours' },
  baseball: { name: 'Baseball', emoji: '⚾', description: 'MLB and international leagues' },
  mma: { name: 'MMA', emoji: '🥊', description: 'UFC, Bellator, and more' },
  esports: { name: 'Esports', emoji: '🎮', description: 'CS2, LoL, Dota 2, Valorant' },
  hockey: { name: 'Hockey', emoji: '🏒', description: 'NHL and international leagues' },
};

export default function SportPage() {
  const { slug } = useParams();
  const sport = SPORT_META[slug || ''] || { name: slug || 'Unknown', emoji: '🏆', description: '' };
  const { data: marketCount } = useMarketCount();

  const isCricket = slug === 'cricket';
  const activeCount = isCricket ? (marketCount?.open ?? 0) : 0;

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
            <span className="text-5xl">{sport.emoji}</span>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{sport.name}</h1>
              <p className="text-muted-foreground mt-1">{sport.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-6">
            <Badge variant="outline" className="border-primary/30 text-primary">
              <Calendar className="w-3 h-3 mr-1" />
              {activeCount} Active Markets
            </Badge>
            {isCricket && (
              <Badge variant="outline" className="border-green-500/30 text-green-400">
                IPL 2025
              </Badge>
            )}
          </div>
        </div>
      </section>

      {/* Markets Grid */}
      <section className="container mx-auto px-4 py-12">
        {isCricket ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Available Markets</h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Search className="w-4 h-4" />
                <span>{marketCount?.total ?? 0} total markets</span>
              </div>
            </div>
            <Card className="border-dashed border-2 border-border/60">
              <CardContent className="py-16 text-center space-y-4">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground/40" />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Market browsing coming soon
                  </h3>
                  <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                    {activeCount} markets are synced from Polymarket. A filterable market grid with live prices is coming in the next update.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground/60">
                  Use the MCP API or CLI to browse and trade on markets right now
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="border-dashed border-2 border-border/60">
            <CardContent className="py-20 text-center space-y-4">
              <span className="text-6xl block">{sport.emoji}</span>
              <div>
                <h3 className="text-xl font-semibold text-foreground">
                  Coming Soon
                </h3>
                <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                  {sport.name} markets will appear here once they're available.
                  Check back soon or follow our updates.
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link to="/">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to All Sports
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
