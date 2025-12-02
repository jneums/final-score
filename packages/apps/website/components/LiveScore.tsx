'use client';

import { useLiveMatch } from '@/hooks/useApiFootball';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';

interface LiveScoreProps {
  /** API Football fixture ID */
  fixtureId: number | null;
  /** Whether to enable fetching live data */
  enabled?: boolean;
  /** Home team name for validation */
  homeTeam?: string;
  /** Away team name for validation */
  awayTeam?: string;
}

/**
 * Display live score and timer for in-progress matches
 */
export function LiveScore({ fixtureId, enabled = true, homeTeam, awayTeam }: LiveScoreProps) {
  const { data: liveMatch, isLoading } = useLiveMatch(fixtureId, enabled);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!liveMatch) {
      setIsLive(false);
      return;
    }

    // Match is live if status is: 1H (first half), HT (halftime), 2H (second half), ET (extra time), P (penalties), BT (break time)
    const liveStatuses = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'];
    setIsLive(liveStatuses.includes(liveMatch.status));
  }, [liveMatch]);

  if (!enabled || !fixtureId || isLoading || !liveMatch || !isLive) {
    return null;
  }

  const getStatusText = (status: string): string => {
    const statusMap: Record<string, string> = {
      '1H': '1st Half',
      'HT': 'Half Time',
      '2H': '2nd Half',
      'ET': 'Extra Time',
      'P': 'Penalties',
      'BT': 'Break',
      'LIVE': 'Live',
    };
    return statusMap[status] || status;
  };

  const getStatusColor = (status: string): string => {
    if (status === 'HT' || status === 'BT') {
      return 'bg-yellow-500/90 hover:bg-yellow-500 border-yellow-400/50';
    }
    return 'bg-red-500/90 hover:bg-red-500 border-red-400/50 animate-pulse';
  };

  return (
    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-red-500/10 to-orange-500/10 border-2 border-red-500/30 rounded-lg">
      <div className="flex items-center gap-4">
        <Badge className={getStatusColor(liveMatch.status)}>
          🔴 {getStatusText(liveMatch.status)}
        </Badge>
        {liveMatch.elapsed !== null && (
          <span className="text-sm font-semibold text-foreground">
            {liveMatch.elapsed}'
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{homeTeam || liveMatch.homeTeam}</p>
        </div>
        <div className="text-3xl font-bold text-foreground tabular-nums min-w-[80px] text-center">
          {liveMatch.homeScore} - {liveMatch.awayScore}
        </div>
        <div className="text-left">
          <p className="text-xs text-muted-foreground">{awayTeam || liveMatch.awayTeam}</p>
        </div>
      </div>
    </div>
  );
}
