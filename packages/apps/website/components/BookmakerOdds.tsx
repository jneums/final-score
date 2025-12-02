'use client';

import { useMatchOdds } from '@/hooks/useApiFootball';
import { Card, CardContent } from '@/components/ui/card';

interface BookmakerOddsProps {
  /** API Football fixture ID */
  fixtureId: number | null;
  /** Whether to enable fetching odds */
  enabled?: boolean;
}

/**
 * Display bookmaker odds underneath pool distributions
 */
export function BookmakerOdds({ fixtureId, enabled = true }: BookmakerOddsProps) {
  const { data: odds, isLoading } = useMatchOdds(fixtureId, enabled);

  if (!enabled || !fixtureId || isLoading) {
    return null;
  }

  if (!odds || odds.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium">Bookmaker Odds</p>
      <div className="space-y-2">
        {odds.map((odd, index) => (
          <Card key={index} className="border border-primary/10 bg-card/50">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-foreground">{odd.bookmaker}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(odd.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Home</p>
                  <p className="text-sm font-semibold text-primary">
                    {typeof odd.home === 'number' ? odd.home.toFixed(2) : '-'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Draw</p>
                  <p className="text-sm font-semibold text-primary">
                    {typeof odd.draw === 'number' ? odd.draw.toFixed(2) : '-'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Away</p>
                  <p className="text-sm font-semibold text-primary">
                    {typeof odd.away === 'number' ? odd.away.toFixed(2) : '-'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
