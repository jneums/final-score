'use client';

import { type MarketBettor } from "@/hooks/useLeaderboard";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";

interface MarketBettorsProps {
  bettors: Array<{
    principal: string;
    amount: bigint;
    outcome: string;
    timestamp: bigint;
  }>;
}

function formatUsdc(amount: bigint): string {
  const dollars = Number(amount) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

function getAvatarUrl(principal: string): string {
  // Use DiceBear adventurer collection with the principal as seed
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${principal}`;
}

function formatPrincipal(principal: string): string {
  if (principal.length <= 12) return principal;
  return `${principal.slice(0, 6)}...${principal.slice(-4)}`;
}

function formatRelativeTime(timestamp: bigint): string {
  const date = new Date(Number(timestamp) / 1_000_000); // Convert nanoseconds to milliseconds
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMinutes < 1) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export function MarketBettors({ bettors }: MarketBettorsProps) {
  if (!bettors || bettors.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No predictions yet - be the first!
      </div>
    );
  }

  // Deduplicate bettors by principal (keep most recent per user)
  const seenPrincipals = new Set<string>();
  const uniqueBettors = bettors.filter((bettor) => {
    if (seenPrincipals.has(bettor.principal)) {
      return false;
    }
    seenPrincipals.add(bettor.principal);
    return true;
  });

  // Show first few avatars overlapping
  const displayBettors = uniqueBettors.slice(0, 5);
  const remainingCount = uniqueBettors.length > 5 ? uniqueBettors.length - 5 : 0;

  // Get recent predictions to show (up to 3)
  const recentPredictions = bettors.slice(0, 3);

  return (
    <div className="space-y-2">
      {/* Avatar Stack */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
        <div className="flex -space-x-3">
          {displayBettors.map((bettor, index) => (
            <div
              key={bettor.principal}
              className="relative group"
              style={{ zIndex: displayBettors.length - index }}
            >
              <Image
                src={getAvatarUrl(bettor.principal)}
                alt={formatPrincipal(bettor.principal)}
                width={32}
                height={32}
                className="w-8 h-8 rounded-full border-2 border-background hover:scale-110 transition-transform cursor-pointer bg-muted"
                unoptimized
              />
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                <div className="font-medium">{formatPrincipal(bettor.principal)}</div>
                <div className="text-muted-foreground">{formatUsdc(bettor.amount)} on {bettor.outcome}</div>
              </div>
            </div>
          ))}
          {remainingCount > 0 && (
            <div className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium text-muted-foreground">
              +{remainingCount}
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {uniqueBettors.length} {uniqueBettors.length === 1 ? 'participant' : 'participants'}
        </span>
      </div>

      {/* Recent Predictions (up to 3) */}
      <div className="space-y-2">
        {recentPredictions.map((bettor, index) => (
          <div key={`${bettor.principal}-${bettor.timestamp}`} className="flex gap-2">
            <Image
              src={getAvatarUrl(bettor.principal)}
              alt={formatPrincipal(bettor.principal)}
              width={16}
              height={16}
              className="w-4 h-4 rounded-full border border-border bg-muted flex-shrink-0 mt-0.5"
              unoptimized
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground">
                {formatPrincipal(bettor.principal)}
              </div>
              <div className="text-xs text-muted-foreground">
                predicted{' '}
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-auto">
                  {bettor.outcome}
                </Badge>
                {' '}with{' '}
                <span className="font-semibold text-primary">{formatUsdc(bettor.amount)}</span>
                {' '}·{' '}
                <span className="text-muted-foreground/80">{formatRelativeTime(bettor.timestamp)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
