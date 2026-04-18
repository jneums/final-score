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

function formatPnl(pnl: number): string {
  const abs = Math.abs(pnl / 1_000_000);
  return pnl >= 0 ? `+$${abs.toFixed(2)}` : `-$${abs.toFixed(2)}`;
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
            style={{ width: `${(level.totalSize / maxSize) * 100}%`, right: 0, left: 'auto' }}
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
            style={{ width: `${(level.totalSize / maxSize) * 100}%`, right: 0, left: 'auto' }}
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
}: {
  selection: { market: MarketInfo; side: 'yes' | 'no' } | null;
  identity: any;
}) {
  const [tradeTab, setTradeTab] = useState<'yes' | 'no'>(selection?.side ?? 'yes');
  const [price, setPrice] = useState('0.50');
  const [size, setSize] = useState('10');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Pre-flight balance + allowance
  const { data: balance } = useUsdcBalance(user?.principal);
  const { data: allowance } = useAllowance(user?.principal);

  // Update when selection changes
  const activeMarket = selection?.market;
  const activeSide = selection ? tradeTab : 'yes';

  // Sync tab when selection changes
  if (selection && selection.side !== tradeTab) {
    // We'll handle this via key prop on the parent instead
  }

  const priceNum = parseFloat(price) || 0;
  const sizeNum = parseInt(size) || 0;
  const baseCost = priceNum * sizeNum;
  const takerFee = baseCost * 0.01; // 1% taker fee
  const totalCost = baseCost + takerFee;
  const grossPayout = sizeNum * 1.0;
  const protocolRake = grossPayout * 0.02; // 2% rake on winnings
  const potentialPayout = grossPayout - protocolRake;
  const potentialProfit = potentialPayout - totalCost;
  const isValid = activeMarket && priceNum >= 0.01 && priceNum <= 0.99 && sizeNum >= 1 && totalCost > 0;

  const currentPriceStr = parseFloat(price).toFixed(2);

  const handleSubmit = () => {
    if (!isValid || isSubmitting || !activeMarket) return;
    setError(null);

    // Pre-flight balance check
    if (balance !== undefined && Number(balance) < totalCost) {
      setError(`Insufficient balance. You have $${Number(balance).toFixed(2)} USDC.`);
      return;
    }

    // Pre-flight allowance check
    if (allowance !== undefined && Number(allowance) < totalCost) {
      setError(`Insufficient allowance ($${Number(allowance).toFixed(2)}). Set allowance in Wallet drawer.`);
      return;
    }

    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    if (!activeMarket) return;
    setShowConfirm(false);
    setIsSubmitting(true);

    try {
      const result = await placeOrderCandid(identity, activeMarket.marketId, activeSide, priceNum, sizeNum);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTabChange = (tab: 'yes' | 'no') => {
    setTradeTab(tab);
  };

  const color = activeSide === 'yes' ? 'green' : 'red';

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

  const outcomeName = extractOutcomeName(activeMarket.question);

  return (
    <Card className="border-primary/20 py-0 gap-0">
      <CardContent className="p-4 space-y-4">
        {/* Market name */}
        <p className="text-sm font-medium truncate">{outcomeName}</p>

        {/* Yes / No tabs */}
        <Tabs value={activeSide} onValueChange={(v) => handleTabChange(v as 'yes' | 'no')}>
          <TabsList className="grid w-full grid-cols-2 h-9">
            <TabsTrigger value="yes" className="text-sm data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
              Buy Yes
            </TabsTrigger>
            <TabsTrigger value="no" className="text-sm data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
              Buy No
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Price + Shares */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Price</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="0.99"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pl-5 h-8 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Shares</label>
            <Input
              type="number"
              step="1"
              min="1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Quick price buttons */}
        <div className="flex gap-1">
          {[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => {
            const isActive = currentPriceStr === p.toFixed(2);
            return (
              <Button
                key={p}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                className={`flex-1 text-xs h-6 px-1 ${isActive
                  ? (color === 'green'
                    ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                    : 'bg-red-600 hover:bg-red-700 text-white border-red-600')
                  : ''
                }`}
                onClick={() => setPrice(p.toFixed(2))}
              >
                {p.toFixed(2)}
              </Button>
            );
          })}
        </div>

        {/* Cost summary */}
        <div className="space-y-1 p-2.5 bg-muted rounded-lg text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-medium">${baseCost.toFixed(2)} <span className="text-muted-foreground">+ ${takerFee.toFixed(2)} fee</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium">${totalCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payout if {activeSide === 'yes' ? 'Yes' : 'No'}</span>
            <span className="font-medium">${potentialPayout.toFixed(2)} <span className="text-muted-foreground">(after 2% rake)</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Profit</span>
            <span className={`font-medium ${potentialProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {potentialProfit >= 0 ? '+' : ''}${potentialProfit.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Inline error */}
        {error && (
          <div className="p-2.5 bg-red-950/30 border border-red-800/50 rounded-lg text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Confirmation dialog */}
        {showConfirm && (
          <div className="p-3 bg-muted rounded-lg space-y-2">
            <p className="text-sm font-medium">Confirm order?</p>
            <p className="text-sm text-muted-foreground">
              Buy {sizeNum} {activeSide === 'yes' ? 'Yes' : 'No'} @ ${priceNum.toFixed(2)} = ${totalCost.toFixed(2)}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConfirm}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Submit */}
        <Button
          className={`w-full h-9 text-sm font-medium ${activeSide === 'yes' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Placing...
            </>
          ) : (
            `Buy ${activeSide === 'yes' ? 'Yes' : 'No'} — $${totalCost.toFixed(2)}`
          )}
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
}: {
  market: MarketInfo;
  identity: any;
  isBookOpen: boolean;
  isSelected: boolean;
  selectedSide: 'yes' | 'no';
  onClickYes: () => void;
  onClickNo: () => void;
  onToggleBook: () => void;
}) {
  const [bookTab, setBookTab] = useState<'yes' | 'no'>('yes');
  const yesPrice = Number(market.lastYesPrice);
  const noPrice = Number(market.lastNoPrice);
  const percent = yesPrice > 0 ? bpsToPercent(yesPrice) : 50;
  const outcomeName = extractOutcomeName(market.question);

  // Position indicator
  const { data: positions } = useMyPositions(identity, market.marketId);
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
          onClick={onToggleBook}
          className="flex-1 min-w-0 text-left"
        >
          <p className="font-medium text-sm leading-snug">{outcomeName}</p>
          {hasPosition && (
            <div className="flex items-center gap-1.5 mt-1">
              <TrendingUp className="w-3 h-3 text-primary" />
              {positions!.map((pos) => {
                const currentValue = (pos.shares * pos.currentPrice * 1_000_000) / 10_000;
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
          <p className="text-xl font-bold">{percent}%</p>
        </div>

        {/* Right: Yes / No buttons */}
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className={`h-9 px-3 font-mono font-medium transition-colors ${
              isSelected && selectedSide === 'yes'
                ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                : 'text-green-400 border-green-500/30 hover:bg-green-500/10 hover:border-green-500/50'
            }`}
            onClick={(e) => { e.stopPropagation(); onClickYes(); }}
          >
            Yes {yesPrice > 0 ? bpsToCents(yesPrice) : '—'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={`h-9 px-3 font-mono font-medium transition-colors ${
              isSelected && selectedSide === 'no'
                ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                : 'text-red-400 border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50'
            }`}
            onClick={(e) => { e.stopPropagation(); onClickNo(); }}
          >
            No {noPrice > 0 ? bpsToCents(noPrice) : '—'}
          </Button>
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
    : market?.status === 'Resolved'
      ? 'text-blue-400 border-blue-500/30'
      : 'text-muted-foreground border-border';

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
                  {market.status}
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
                    <span>${(totalVolume / 1_000_000).toLocaleString()} vol</span>
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
                  key={effectiveSelection ? `${effectiveSelection.market.marketId}-${effectiveSelection.side}` : 'empty'}
                  selection={effectiveSelection}
                  identity={user?.agent}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
