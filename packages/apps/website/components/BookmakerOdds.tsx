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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground font-medium">Bookmaker Odds</p>
      <div className="grid grid-cols-3 gap-3">
        {odds.map((odd, index) => (
          <Card key={index} className="border border-primary/10 bg-card/50 py-2">
            <CardContent className="p-3 md:p-6">
              <div className="text-center mb-3">
                <p className="text-xs font-medium text-foreground mb-1">{odd.bookmaker}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(odd.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Home</span>
                  <span className="text-sm font-semibold text-primary">
                    {typeof odd.home === 'number' ? odd.home.toFixed(2) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Draw</span>
                  <span className="text-sm font-semibold text-primary">
                    {typeof odd.draw === 'number' ? odd.draw.toFixed(2) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">Away</span>
                  <span className="text-sm font-semibold text-primary">
                    {typeof odd.away === 'number' ? odd.away.toFixed(2) : '-'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
