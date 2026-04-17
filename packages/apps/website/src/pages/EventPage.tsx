import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useMarket } from '../hooks/useMarkets';
import { useAuth } from '../hooks/useAuth';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Clock,
  BarChart3,
  Lock,
  Loader2,
} from 'lucide-react';

export default function EventPage() {
  const { slug } = useParams();
  const { data: market, isLoading } = useMarket(slug);
  const { isAuthenticated } = useAuth();
  const [tradeTab, setTradeTab] = useState<'yes' | 'no'>('yes');
  const [price, setPrice] = useState('0.50');
  const [size, setSize] = useState('10');

  const priceNum = parseFloat(price) || 0;
  const sizeNum = parseFloat(size) || 0;
  const totalCost = (priceNum * sizeNum).toFixed(2);
  const potentialPayout = sizeNum.toFixed(2);

  const statusColor = market?.status === 'open'
    ? 'text-green-400 border-green-500/30'
    : market?.status === 'resolved'
      ? 'text-blue-400 border-blue-500/30'
      : 'text-muted-foreground border-border';

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
              <span className="text-muted-foreground">Loading market...</span>
            </div>
          ) : market ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{market.eventTitle}</p>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
                    {market.question}
                  </h1>
                </div>
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
                <span>{market.sport}</span>
                <span>•</span>
                <span>Vol: ${(Number(market.totalVolume) / 1_000_000).toLocaleString()}</span>
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

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Order Book */}
          <div className="lg:col-span-2 space-y-6">
            {/* Price Display */}
            {market && (
              <div className="grid grid-cols-2 gap-4">
                <Card className="border-green-500/20">
                  <CardContent className="p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Yes Price</p>
                    <p className="text-4xl font-bold text-green-400">
                      {Number(market.lastYesPrice) > 0
                        ? `${(Number(market.lastYesPrice) / 100).toFixed(0)}¢`
                        : '—'}
                    </p>
                    <div className="flex items-center justify-center gap-1 mt-2 text-xs text-green-400/60">
                      <TrendingUp className="w-3 h-3" />
                      Probability
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-red-500/20">
                  <CardContent className="p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-1">No Price</p>
                    <p className="text-4xl font-bold text-red-400">
                      {Number(market.lastNoPrice) > 0
                        ? `${(Number(market.lastNoPrice) / 100).toFixed(0)}¢`
                        : '—'}
                    </p>
                    <div className="flex items-center justify-center gap-1 mt-2 text-xs text-red-400/60">
                      <TrendingDown className="w-3 h-3" />
                      Probability
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Order Book Placeholder */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Order Book
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="border-2 border-dashed border-border/60 rounded-lg py-16 text-center space-y-3">
                  <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground/30" />
                  <p className="text-muted-foreground font-medium">Order book visualization</p>
                  <p className="text-sm text-muted-foreground/60">Coming in next update — bid/ask depth chart</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Trade Panel */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Trade</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isAuthenticated ? (
                  <div className="border-2 border-dashed border-border/60 rounded-lg py-12 text-center space-y-3">
                    <Lock className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="font-medium text-foreground">Connect wallet to trade</p>
                    <p className="text-sm text-muted-foreground">Sign in with Internet Identity or Plug Wallet</p>
                  </div>
                ) : (
                  <>
                    <Tabs value={tradeTab} onValueChange={(v) => setTradeTab(v as 'yes' | 'no')}>
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="yes" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">
                          Buy Yes
                        </TabsTrigger>
                        <TabsTrigger value="no" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                          Buy No
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="yes" className="mt-4 space-y-4">
                        <TradeForm
                          side="yes"
                          price={price}
                          size={size}
                          totalCost={totalCost}
                          potentialPayout={potentialPayout}
                          onPriceChange={setPrice}
                          onSizeChange={setSize}
                        />
                      </TabsContent>
                      <TabsContent value="no" className="mt-4 space-y-4">
                        <TradeForm
                          side="no"
                          price={price}
                          size={size}
                          totalCost={totalCost}
                          potentialPayout={potentialPayout}
                          onPriceChange={setPrice}
                          onSizeChange={setSize}
                        />
                      </TabsContent>
                    </Tabs>
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-center">
                      <p className="text-sm text-primary font-medium">Coming Soon</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Order placement will be available once MCP client integration is complete
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeForm({
  side,
  price,
  size,
  totalCost,
  potentialPayout,
  onPriceChange,
  onSizeChange,
}: {
  side: 'yes' | 'no';
  price: string;
  size: string;
  totalCost: string;
  potentialPayout: string;
  onPriceChange: (v: string) => void;
  onSizeChange: (v: string) => void;
}) {
  const color = side === 'yes' ? 'green' : 'red';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">Price (per share)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max="0.99"
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            className="pl-7"
          />
        </div>
        <div className="flex gap-1">
          {[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => (
            <Button
              key={p}
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => onPriceChange(p.toFixed(2))}
            >
              {p.toFixed(2)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-muted-foreground">Shares</label>
        <Input
          type="number"
          step="1"
          min="1"
          value={size}
          onChange={(e) => onSizeChange(e.target.value)}
        />
        <div className="flex gap-1">
          {[10, 25, 50, 100].map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-7"
              onClick={() => onSizeChange(s.toString())}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2 p-3 bg-muted rounded-lg text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Cost</span>
          <span className="font-medium">${totalCost} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Potential Payout</span>
          <span className={`font-medium text-${color}-400`}>${potentialPayout} USDC</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Potential Profit</span>
          <span className={`font-medium text-${color}-400`}>
            ${(parseFloat(potentialPayout) - parseFloat(totalCost)).toFixed(2)} USDC
          </span>
        </div>
      </div>

      <Button
        className={`w-full ${side === 'yes' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
        disabled
      >
        Buy {side === 'yes' ? 'Yes' : 'No'}
      </Button>
    </div>
  );
}
