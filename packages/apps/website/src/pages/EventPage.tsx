import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useMarket, useOrderBook, useMyPositions, useEventMarkets } from '../hooks/useMarkets';
import { useAuth } from '../hooks/useAuth';
import { useUsdcBalance } from '../hooks/useLedger';
import { positionCurrentValue, formatPnl, atomicToDollars } from '../lib/tokenUtils';
import { useAllowance } from '../hooks/useAllowance';
import { placeOrderCandid, type MarketInfo } from '@final-score/ic-js';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Clock,
  BarChart3,
  Lock,
  Loader2,
  TrendingUp,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bpsToPrice(bps: number): string {
  if (bps <= 0) return '—';
  return (bps / 10000).toFixed(2);
}

function bpsToDollar(bps: number): string {
  if (bps <= 0) return '—';
  return `$${(bps / 10000).toFixed(2)}`;
}

function bpsToCents(bps: number): string {
  if (bps <= 0) return '—';
  return `${Math.round(bps / 100)}¢`;
}

function bpsToPercent(bps: number): number {
  return Math.round(bps / 100);
}

/** Parse "Resolved:Yes" / "Resolved:No" → winner side, or null if not resolved */
function parseResolution(status: string): 'yes' | 'no' | null {
  if (status.startsWith('Resolved:Yes')) return 'yes';
  if (status.startsWith('Resolved:No')) return 'no';
  return null;
}

function isResolved(status: string): boolean {
  return status.startsWith('Resolved');
}

function extractOutcomeName(question: string): string {
  const willMatch = question.match(/^Will (.+?)(?:\s+win(?:\s+on\s+\d{4}-\d{2}-\d{2})?\??|$)/i);
  if (willMatch) return willMatch[1];
  if (/end in a draw/i.test(question)) return 'Draw';
  return question;
}

// ─── Compact Order Book ──────────────────────────────────────────────────────

function OrderBookCompact({ marketId, activeTab }: { marketId: string; activeTab: 'yes' | 'no' }) {
  const { data: book, isLoading } = useOrderBook(marketId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 gap-2">
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!book) return null;

  const bids = activeTab === 'yes' ? book.yesBids : book.noBids;
  const oppositeForAsks = activeTab === 'yes' ? book.noBids : book.yesBids;

  const asks = oppositeForAsks
    .map((level) => ({
      price: 10000 - level.price,
      totalSize: level.totalSize,
      orderCount: level.orderCount,
    }))
    .sort((a, b) => b.price - a.price);

  const sortedBids = [...bids].sort((a, b) => b.price - a.price);

  const bestBid = sortedBids.length > 0 ? sortedBids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[asks.length - 1]?.price ?? 0 : 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;

  const hasOrders = asks.length > 0 || sortedBids.length > 0;

  if (!hasOrders) {
    return (
      <div className="text-center py-4 text-xs text-muted-foreground">
        No orders on the book yet
      </div>
    );
  }

  const allSizes = [...asks, ...sortedBids].map((l) => l.totalSize);
  const maxSize = Math.max(...allSizes, 1);

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden text-xs">
      <div className="grid grid-cols-3 text-muted-foreground px-2 py-1.5 bg-muted/20 border-b border-border/50">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Orders</span>
      </div>

      {asks.map((level, i) => (
        <div key={`ask-${i}`} className="relative grid grid-cols-3 px-2 py-1">
          <div
            className="absolute inset-0 bg-red-500/8"
            style={{ width: `${(level.totalSize / maxSize) * 100}%` }}
          />
          <span className="relative text-red-400 font-mono">{bpsToPrice(level.price)}</span>
          <span className="relative text-right font-mono">{level.totalSize}</span>
          <span className="relative text-right text-muted-foreground">{level.orderCount}</span>
        </div>
      ))}

      <div className="flex items-center justify-center gap-2 py-1 px-2 border-y border-border/50 bg-muted/30">
        <span className="text-muted-foreground">Spread</span>
        <span className="font-mono font-medium">{spread > 0 ? bpsToDollar(spread) : '—'}</span>
      </div>

      {sortedBids.map((level, i) => (
        <div key={`bid-${i}`} className="relative grid grid-cols-3 px-2 py-1">
          <div
            className="absolute inset-0 bg-green-500/8"
            style={{ width: `${(level.totalSize / maxSize) * 100}%` }}
          />
          <span className="relative text-green-400 font-mono">{bpsToPrice(level.price)}</span>
          <span className="relative text-right font-mono">{level.totalSize}</span>
          <span className="relative text-right text-muted-foreground">{level.orderCount}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Order Form (always visible on right) ────────────────────────────────────

function OrderForm({
  selection,
  identity,
  onSideChange,
}: {
  selection: { market: MarketInfo; side: 'yes' | 'no' } | null;
  identity: any;
  onSideChange?: (side: 'yes' | 'no') => void;
}) {
  const [side, setSide] = useState<'yes' | 'no'>(selection?.side ?? 'yes');
  const [dollars, setDollars] = useState('10');
  const [limitPrice, setLimitPrice] = useState('0.50');
  const [priceFromBook, setPriceFromBook] = useState(false);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Order book for live prices
  const { data: formBook } = useOrderBook(selection?.market.marketId);

  // Pre-flight balance + allowance
  const { data: balance } = useUsdcBalance(user?.principal);
  const { data: allowance } = useAllowance(user?.principal);

  const activeMarket = selection?.market;

  // Sync side when selection changes
  if (selection && selection.side !== side) {
    setSide(selection.side);
    setStep('form');
  }

  // Compute book prices (10000 bps = empty book)
  const yesBookPrice = formBook && formBook.impliedYesAsk < 10000 ? formBook.impliedYesAsk / 10000 : 0;
  const noBookPrice = formBook && formBook.impliedNoAsk < 10000 ? formBook.impliedNoAsk / 10000 : 0;
  const bookPrice = side === 'yes' ? yesBookPrice : noBookPrice;
  const hasBookPrice = bookPrice > 0;

  // Auto-fill price from book when available (only if user hasn't manually edited)
  if (hasBookPrice && !priceFromBook) {
    setLimitPrice(bookPrice.toFixed(2));
    setPriceFromBook(true);
  }

  // The effective price for calculations
  const price = orderType === 'market' && hasBookPrice
    ? bookPrice
    : (parseFloat(limitPrice) || 0);

  // Compute from dollar amount
  const dollarsNum = parseFloat(dollars) || 0;
  const shares = price > 0 ? Math.floor(dollarsNum / price) : 0;
  const cost = shares * price;
  const takerFee = cost * 0.01; // 1% taker fee
  const totalCost = cost + takerFee;
  const grossPayout = shares * 1.0;
  const protocolRake = grossPayout * 0.02; // 2% rake
  const payout = grossPayout - protocolRake;
  const odds = price > 0 ? Math.round(price * 100) : 0;

  const isValid = activeMarket && price >= 0.01 && price <= 0.99 && shares >= 1 && dollarsNum > 0;

  const handleReview = () => {
    if (!isValid) return;
    setError(null);

    // Pre-flight balance check
    if (balance !== undefined && Number(balance) < totalCost) {
      setError(`Insufficient balance ($${Number(balance).toFixed(2)}).`);
      return;
    }

    // Pre-flight allowance check
    if (allowance !== undefined && Number(allowance) < totalCost) {
      setError(`Insufficient allowance ($${Number(allowance).toFixed(2)}). Set in Wallet.`);
      return;
    }

    setStep('review');
  };

  const handleSubmit = async () => {
    if (!activeMarket || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const result = await placeOrderCandid(identity, activeMarket.marketId, side, price, shares);

      if (result.status === 'Filled') {
        toast.success(`Order filled! ${result.fills.length} trade(s) executed.`);
      } else if (result.fills.length > 0) {
        toast.success(`Partially filled (${result.fills.length} trade(s)). Rest is on the book.`);
      } else {
        toast.success('Order placed on the book.');
      }

      queryClient.invalidateQueries({ queryKey: ['order-book', activeMarket.marketId] });
      queryClient.invalidateQueries({ queryKey: ['market', activeMarket.marketId] });
      queryClient.invalidateQueries({ queryKey: ['event-markets'] });
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['my-positions'] });
      queryClient.invalidateQueries({ queryKey: ['usdc-balance'] });
      queryClient.invalidateQueries({ queryKey: ['allowance'] });
      setStep('form');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order';
      toast.error(message);
      setStep('form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const color = side === 'yes' ? 'green' : 'red';

  if (!activeMarket) {
    return (
      <Card className="py-0 gap-0">
        <CardContent className="py-12 text-center space-y-3">
          <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Click <span className="text-green-400">Yes</span> or <span className="text-red-400">No</span> on an outcome to trade
          </p>
        </CardContent>
      </Card>
    );
  }

  // Resolved market — show outcome, no trading
  const marketWinner = parseResolution(activeMarket.status);
  if (marketWinner) {
    const outcomeName = extractOutcomeName(activeMarket.question);
    return (
      <Card className="py-0 gap-0">
        <CardContent className="p-4 space-y-4">
          <p className="text-sm font-medium truncate">{outcomeName}</p>
          <div className="flex items-center justify-center gap-2 py-6">
            <Badge
              variant="outline"
              className={`text-lg px-4 py-2 font-medium ${
                marketWinner === 'yes'
                  ? 'bg-green-600/20 text-green-400 border-green-500/50'
                  : 'bg-red-600/20 text-red-400 border-red-500/50'
              }`}
            >
              {marketWinner === 'yes' ? 'Yes' : 'No'} won
            </Badge>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            This market has been resolved. Trading is closed.
          </p>
        </CardContent>
      </Card>
    );
  }

  const outcomeName = extractOutcomeName(activeMarket.question);

  // ─── Review Step ──────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <Card className="border-primary/20 py-0 gap-0">
        <CardContent className="p-4 space-y-4">
          <p className="text-sm font-medium truncate">{outcomeName}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Review order</span>
            <span className={`text-xs font-medium ${color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
              Buy {side === 'yes' ? 'Yes' : 'No'}
            </span>
          </div>

          <div className="border-t border-border/50" />

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Estimated cost</span>
              <span className="font-medium">${totalCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Odds</span>
              <span className="font-medium">{odds}% chance</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payout if {side === 'yes' ? 'Yes' : 'No'}</span>
              <span className={`text-lg font-semibold ${color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
                ${payout.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-10 p-0"
              onClick={() => setStep('form')}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Button
              className={`flex-1 h-10 text-sm font-medium ${side === 'yes' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Form Step ────────────────────────────────────────────────────────────
  return (
    <Card className="border-primary/20 py-0 gap-0">
      <CardContent className="p-4 space-y-4">
        {/* Outcome + order type dropdown */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium truncate flex-1">{outcomeName}</p>
          <div className="relative">
            <button
              onClick={() => setOrderType(orderType === 'market' ? 'limit' : 'market')}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/50 rounded-md px-2 py-1 bg-muted/50 transition-colors"
            >
              {orderType === 'market' ? 'Dollars' : 'Limit'}
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* No liquidity warning in dollars mode */}
        {orderType === 'market' && !hasBookPrice && (
          <div className="p-2.5 bg-yellow-950/30 border border-yellow-800/50 rounded-lg text-xs text-yellow-400">
            No liquidity available. Switch to{' '}
            <button className="underline font-medium" onClick={() => setOrderType('limit')}>
              Limit
            </button>
            {' '}to place a resting order.
          </div>
        )}

        {/* Yes / No price buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className={`h-10 text-sm font-medium ${
              side === 'yes'
                ? 'border-green-500 bg-green-500/10 text-green-400'
                : 'border-border/50 text-muted-foreground hover:border-green-500/50 hover:text-green-400'
            }`}
            onClick={() => {
              setSide('yes');
              if (yesBookPrice > 0) setLimitPrice(yesBookPrice.toFixed(2));
              onSideChange?.('yes');
            }}
          >
            Yes {yesBookPrice > 0 ? `${Math.round(yesBookPrice * 100)}¢` : ''}
          </Button>
          <Button
            variant="outline"
            className={`h-10 text-sm font-medium ${
              side === 'no'
                ? 'border-red-500 bg-red-500/10 text-red-400'
                : 'border-border/50 text-muted-foreground hover:border-red-500/50 hover:text-red-400'
            }`}
            onClick={() => {
              setSide('no');
              if (noBookPrice > 0) setLimitPrice(noBookPrice.toFixed(2));
              onSideChange?.('no');
            }}
          >
            No {noBookPrice > 0 ? `${Math.round(noBookPrice * 100)}¢` : ''}
          </Button>
        </div>

        {/* Limit price — only in limit mode */}
        {orderType === 'limit' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Limit price</label>
            {hasBookPrice && parseFloat(limitPrice) !== bookPrice && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setLimitPrice(bookPrice.toFixed(2))}
              >
                Use market ({Math.round(bookPrice * 100)}¢)
              </button>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              max="0.99"
              value={limitPrice}
              onChange={(e) => { setLimitPrice(e.target.value); setPriceFromBook(true); }}
              className="pl-7 h-9 text-sm font-mono"
            />
          </div>
        </div>
        )}

        {/* Dollar amount input */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              step="1"
              min="1"
              value={dollars}
              onChange={(e) => setDollars(e.target.value)}
              className="pl-7 h-10 text-lg font-medium"
            />
          </div>
          {/* Quick amounts */}
          <div className="flex gap-1.5">
            {[5, 10, 25, 50, 100].map((amt) => (
              <Button
                key={amt}
                variant={dollars === String(amt) ? 'default' : 'outline'}
                size="sm"
                className="flex-1 text-xs h-7"
                onClick={() => setDollars(String(amt))}
              >
                ${amt}
              </Button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Odds</span>
            <span className="font-medium">{odds > 0 ? `${odds}% chance` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payout if {side === 'yes' ? 'Yes' : 'No'}</span>
            <span className={`font-semibold ${color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
              {payout > 0 ? `$${payout.toFixed(2)}` : '—'}
            </span>
          </div>
          {orderType === 'limit' && !hasBookPrice && price > 0 && (
            <p className="text-xs text-muted-foreground">
              No liquidity — your order will rest on the book at {Math.round(price * 100)}¢.
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-2.5 bg-red-950/30 border border-red-800/50 rounded-lg text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Review button */}
        <Button
          className={`w-full h-10 text-sm font-medium ${side === 'yes' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
          onClick={handleReview}
          disabled={!isValid || isSubmitting}
        >
          Review
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Outcome Row ─────────────────────────────────────────────────────────────

function OutcomeRow({
  market,
  identity,
  isBookOpen,
  isSelected,
  selectedSide,
  onClickYes,
  onClickNo,
  onToggleBook,
  onSelectMarket,
}: {
  market: MarketInfo;
  identity: any;
  isBookOpen: boolean;
  isSelected: boolean;
  selectedSide: 'yes' | 'no';
  onClickYes: () => void;
  onClickNo: () => void;
  onToggleBook: () => void;
  onSelectMarket: () => void;
}) {
  const [bookTab, setBookTab] = useState<'yes' | 'no'>('yes');

  // Resolved markets: derive prices from the resolution outcome
  const winner = parseResolution(market.status);
  const resolved = winner !== null;

  // Use order book best ask (what you can buy at now) instead of last traded price
  // 10000 bps = $1.00 means empty book — treat as no price
  const { data: book } = useOrderBook(market.marketId);

  // For resolved markets: winner = 100¢, loser = 0¢ (like Kalshi)
  // For active markets: use live order book
  const yesPrice = resolved
    ? (winner === 'yes' ? 10000 : 0)
    : (book && book.impliedYesAsk > 0 && book.impliedYesAsk < 10000 ? book.impliedYesAsk : 0);
  const noPrice = resolved
    ? (winner === 'no' ? 10000 : 0)
    : (book && book.impliedNoAsk > 0 && book.impliedNoAsk < 10000 ? book.impliedNoAsk : 0);
  const percent = resolved
    ? (winner === 'yes' ? 100 : 0)
    : (yesPrice > 0 ? bpsToPercent(yesPrice) : '—');
  const outcomeName = extractOutcomeName(market.question);

  // Position indicator — aggregate same-outcome positions
  const { data: rawPositions } = useMyPositions(identity, market.marketId);
  const positions = (() => {
    if (!rawPositions || rawPositions.length === 0) return null;
    const grouped = new Map<string, typeof rawPositions[0]>();
    for (const pos of rawPositions) {
      const existing = grouped.get(pos.outcome);
      if (existing) {
        grouped.set(pos.outcome, {
          ...existing,
          shares: existing.shares + pos.shares,
          costBasis: existing.costBasis + pos.costBasis,
          currentPrice: pos.currentPrice,
        });
      } else {
        grouped.set(pos.outcome, { ...pos });
      }
    }
    return [...grouped.values()].filter(p => p.shares > 0);
  })();
  const hasPosition = positions && positions.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
          isSelected ? 'border-primary/40 bg-primary/5' : 'border-border/50 hover:border-border bg-card/20'
        }`}
      >
        {/* Left: click to toggle order book */}
        <button
          onClick={() => { onToggleBook(); onSelectMarket(); }}
          className="flex-1 min-w-0 text-left"
        >
          <p className="font-medium text-sm leading-snug">{outcomeName}</p>
          {hasPosition && (
            <div className="flex items-center gap-1.5 mt-1">
              <TrendingUp className="w-3 h-3 text-primary" />
              {positions!.map((pos) => {
                const currentValue = positionCurrentValue(pos.shares, pos.currentPrice);
                const pnl = currentValue - pos.costBasis;
                return (
                  <span key={pos.positionId} className="text-xs text-muted-foreground">
                    <span className={pos.outcome === 'Yes' ? 'text-green-400' : 'text-red-400'}>{pos.outcome}</span>
                    {' '}{pos.shares} shares
                    {' '}
                    <span className={`font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatPnl(pnl)}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </button>

        {/* Center: probability */}
        <div className="text-center shrink-0 w-14">
          <p className="text-xl font-bold">{percent === '—' ? '—' : `${percent}%`}</p>
        </div>

        {/* Right: Yes / No buttons (or resolved badge) */}
        <div className="flex gap-2 shrink-0">
          {resolved ? (
            <>
              <Badge
                variant="outline"
                className={`h-9 px-3 font-mono font-medium ${
                  winner === 'yes'
                    ? 'bg-green-600/20 text-green-400 border-green-500/50'
                    : 'text-muted-foreground/50 border-border/30'
                }`}
              >
                Yes {winner === 'yes' ? '100¢' : '0¢'}
              </Badge>
              <Badge
                variant="outline"
                className={`h-9 px-3 font-mono font-medium ${
                  winner === 'no'
                    ? 'bg-red-600/20 text-red-400 border-red-500/50'
                    : 'text-muted-foreground/50 border-border/30'
                }`}
              >
                No {winner === 'no' ? '100¢' : '0¢'}
              </Badge>
            </>
          ) : (
          <>
          <Button
            variant={isSelected && selectedSide === 'yes' ? 'default' : 'outline'}
            size="sm"
            className={`h-9 px-3 font-mono font-medium transition-colors ${
              isSelected && selectedSide === 'yes'
                ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                : 'text-green-400 border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50'
            }`}
            onClick={(e) => { e.stopPropagation(); onClickYes(); }}
          >
            Yes {yesPrice > 0 ? bpsToCents(yesPrice) : ''}
          </Button>
          <Button
            variant={isSelected && selectedSide === 'no' ? 'default' : 'outline'}
            size="sm"
            className={`h-9 px-3 font-mono font-medium transition-colors ${
              isSelected && selectedSide === 'no'
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50'
            }`}
            onClick={(e) => { e.stopPropagation(); onClickNo(); }}
          >
            No {noPrice > 0 ? bpsToCents(noPrice) : ''}
          </Button>
          </>
          )}
        </div>
      </div>

      {/* Expandable order book */}
      {isBookOpen && (
        <div className="mt-2 ml-4 mr-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <BarChart3 className="w-3 h-3" />
              Order Book — {outcomeName}
            </p>
            <Tabs value={bookTab} onValueChange={(v) => setBookTab(v as 'yes' | 'no')}>
              <TabsList className="h-6">
                <TabsTrigger value="yes" className="text-xs px-3 h-5 data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
                  Yes
                </TabsTrigger>
                <TabsTrigger value="no" className="text-xs px-3 h-5 data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                  No
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <OrderBookCompact marketId={market.marketId} activeTab={bookTab} />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EventPage() {
  const { slug } = useParams();
  const { data: market, isLoading } = useMarket(slug);
  const { isAuthenticated, user } = useAuth();

  const polymarketSlug = market?.polymarketSlug;
  const { data: eventMarkets, isLoading: eventLoading } = useEventMarkets(polymarketSlug);

  // Which market's order book is expanded
  const [expandedBook, setExpandedBook] = useState<string | null>(null);

  // Which market + side is selected for the order form
  const [selection, setSelection] = useState<{ market: MarketInfo; side: 'yes' | 'no' } | null>(null);

  // Default to the most likely outcome (highest yesPrice) once markets load
  const effectiveSelection = (() => {
    if (selection) return selection;
    if (!eventMarkets || eventMarkets.length === 0) return null;
    const best = [...eventMarkets].sort((a, b) => Number(b.lastYesPrice) - Number(a.lastYesPrice))[0];
    return { market: best, side: 'yes' as const };
  })();

  const statusColor = market?.status === 'Open'
    ? 'text-green-400 border-green-500/30'
    : market?.status?.startsWith('Resolved')
      ? 'text-blue-400 border-blue-500/30'
      : market?.status === 'Closed'
        ? 'text-yellow-400 border-yellow-500/30'
        : 'text-muted-foreground border-border';

  // Human-friendly status label
  const statusLabel = market?.status?.startsWith('Resolved')
    ? 'Settled'
    : market?.status ?? '';

  const totalVolume = eventMarkets?.reduce((sum, m) => sum + Number(m.totalVolume), 0) ?? 0;

  const handleSelectSide = (m: MarketInfo, side: 'yes' | 'no') => {
    setSelection({ market: m, side });
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="border-b border-border/50 bg-card/30">
        <div className="container mx-auto px-4 py-6">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          {isLoading ? (
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading event...</span>
            </div>
          ) : market ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  {market.eventTitle}
                </h1>
                <Badge variant="outline" className={statusColor}>
                  {statusLabel}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Ends {new Date(Number(market.endDate) / 1_000_000).toLocaleDateString()}
                </span>
                <span>•</span>
                <span>{market.sport.toUpperCase()}</span>
                {totalVolume > 0 && (
                  <>
                    <span>•</span>
                    <span>${atomicToDollars(totalVolume).toLocaleString()} vol</span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <h1 className="text-2xl font-bold">Market: {slug}</h1>
              <p className="text-muted-foreground">Market not found or ID not recognized</p>
            </div>
          )}
        </div>
      </section>

      {/* Main: outcomes left, order form right */}
      <div className="container mx-auto px-4 py-4">
        {eventLoading || isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading markets...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Left: Outcomes */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex items-center justify-between px-1 mb-1">
                <h2 className="text-sm font-medium text-muted-foreground">Outcomes</h2>
                {eventMarkets && (
                  <span className="text-xs text-muted-foreground">
                    {eventMarkets.length} market{eventMarkets.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {eventMarkets && eventMarkets.length > 0 ? (
                eventMarkets.map((m) => (
                  <OutcomeRow
                    key={m.marketId}
                    market={m}
                    identity={user?.agent}
                    isBookOpen={expandedBook === m.marketId}
                    isSelected={effectiveSelection?.market.marketId === m.marketId}
                    selectedSide={effectiveSelection?.market.marketId === m.marketId ? effectiveSelection.side : 'yes'}
                    onClickYes={() => setSelection({ market: m, side: 'yes' })}
                    onClickNo={() => setSelection({ market: m, side: 'no' })}
                    onToggleBook={() => setExpandedBook(expandedBook === m.marketId ? null : m.marketId)}
                    onSelectMarket={() => setSelection({ market: m, side: 'yes' })}
                  />
                ))
              ) : market ? (
                <OutcomeRow
                  market={market as any}
                  identity={user?.agent}
                  isBookOpen={expandedBook === market.marketId}
                  isSelected={effectiveSelection?.market.marketId === market.marketId}
                  selectedSide={effectiveSelection?.market.marketId === market.marketId ? effectiveSelection.side : 'yes'}
                  onClickYes={() => setSelection({ market: market as any, side: 'yes' })}
                  onClickNo={() => setSelection({ market: market as any, side: 'no' })}
                  onToggleBook={() => setExpandedBook(expandedBook === market.marketId ? null : market.marketId)}
                  onSelectMarket={() => setSelection({ market: market as any, side: 'yes' })}
                />
              ) : null}
            </div>

            {/* Right: Order Form (always visible) */}
            <div className="lg:sticky lg:top-8 lg:self-start">
              {!isAuthenticated ? (
                <Card className="py-0 gap-0">
                  <CardContent className="py-10 text-center space-y-3">
                    <Lock className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="font-medium">Connect wallet to trade</p>
                    <p className="text-sm text-muted-foreground">
                      Sign in with Internet Identity, NFID, or Plug Wallet
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <OrderForm
                  key={effectiveSelection ? effectiveSelection.market.marketId : 'empty'}
                  selection={effectiveSelection}
                  identity={user?.agent}
                  onSideChange={(newSide) => {
                    if (effectiveSelection) {
                      setSelection({ market: effectiveSelection.market, side: newSide });
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
