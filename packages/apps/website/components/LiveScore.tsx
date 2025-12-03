'use client';

import { useLiveMatch } from '@/hooks/useApiFootball';
import { Badge } from '@/components/ui/badge';

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

  // Don't show if disabled, no fixture ID, loading, or no data
  if (!enabled || !fixtureId || isLoading || !liveMatch) {
    return null;
  }

  // Check if match is actually in progress (not NS = Not Started, not FT = Full Time, not already finished)
  const liveStatuses = ['1H', 'HT', '2H', 'ET', 'P', 'BT', 'LIVE'];
  const finishedStatuses = ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'PST', 'SUSP', 'INT', 'AWD', 'WO'];
  const notStartedStatuses = ['TBD', 'NS'];
  
  // Don't show if match hasn't started or is already finished
  if (notStartedStatuses.includes(liveMatch.status) || finishedStatuses.includes(liveMatch.status)) {
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
    <div className="p-3 md:p-4 bg-gradient-to-r from-red-500/10 to-orange-500/10 border-2 border-red-500/30 rounded-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-4">
          <Badge className={`${getStatusColor(liveMatch.status)} text-white text-xs`}>
            🔴 {getStatusText(liveMatch.status)}
          </Badge>
          {liveMatch.elapsed !== null && (
            <span className="text-xs md:text-sm font-semibold text-foreground">
              {liveMatch.elapsed}'
            </span>
          )}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2 md:gap-3">
          <div className="text-right flex-1 sm:flex-initial">
            <p className="text-[10px] md:text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-none">
              {homeTeam || liveMatch.homeTeam}
            </p>
          </div>
          <div className="text-2xl md:text-3xl font-bold text-foreground tabular-nums min-w-[60px] md:min-w-[80px] text-center">
            {liveMatch.homeScore} - {liveMatch.awayScore}
          </div>
          <div className="text-left flex-1 sm:flex-initial">
            <p className="text-[10px] md:text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-none">
              {awayTeam || liveMatch.awayTeam}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
