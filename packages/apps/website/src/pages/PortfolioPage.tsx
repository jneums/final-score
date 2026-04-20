import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAuth } from '../hooks/useAuth';
import { useUsdcBalance } from '../hooks/useLedger';
import { useAllowance } from '../hooks/useAllowance';
import { useMyOrders, useMyPositions } from '../hooks/useMarkets';
import { cancelOrderCandid } from '@final-score/ic-js';
import { toast } from 'sonner';
import { positionCurrentValue, formatPnl, atomicToDollars } from '../lib/tokenUtils';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Wallet,
  Lock,
  CircleDollarSign,
  Clock,
  FileText,
  BarChart3,
  Loader2,
  X,
} from 'lucide-react';

function bpsToDollar(bps: number): string {
  if (bps <= 0) return '—';
  return `$${(bps / 10000).toFixed(2)}`;
}

export default function PortfolioPage() {
  const { isAuthenticated, user } = useAuth();
  const { data: balance, isLoading: balanceLoading } = useUsdcBalance(user?.principal);
  const { data: allowance, isLoading: allowanceLoading } = useAllowance(user?.principal);
  const { data: positions, isLoading: positionsLoading } = useMyPositions(user?.agent);
  const { data: orders, isLoading: ordersLoading } = useMyOrders(user?.agent);
  const { data: allOrders, isLoading: historyLoading } = useMyOrders(user?.agent, 'all');
  const queryClient = useQueryClient();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen">
        <div className="container mx-auto px-4 py-20">
          <Card className="max-w-lg mx-auto border-dashed border-2 border-border/60">
            <CardContent className="py-16 text-center space-y-4">
              <Lock className="w-12 h-12 mx-auto text-muted-foreground/40" />
              <h2 className="text-xl font-bold">Connect Wallet to View Portfolio</h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Sign in with Internet Identity or Plug Wallet to view your positions, open orders, and trade history.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const handleCancelOrder = async (orderId: string) => {
    try {
      await cancelOrderCandid(user?.agent, orderId);
      toast.success('Order cancelled');
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order-book'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel order';
      toast.error(message);
    }
  };

  // Compute portfolio value
  const totalCostBasis = positions?.reduce((sum, p) => sum + p.costBasis, 0) ?? 0;
  const totalCurrentValue = positions?.reduce((sum, p) => {
    return sum + positionCurrentValue(p.shares, p.currentPrice);
  }, 0) ?? 0;
  const totalPnl = totalCurrentValue - totalCostBasis;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="border-b border-border/50 bg-card/30">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Wallet className="w-7 h-7 text-primary" />
            Portfolio
          </h1>
          <p className="text-muted-foreground mt-1">
            {user?.principal ? `${user.principal.slice(0, 8)}...${user.principal.slice(-5)}` : ''}
          </p>
        </div>
      </section>

      {/* Balance Summary */}
      <section className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <CircleDollarSign className="w-4 h-4" />
                USDC Balance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {balanceLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-3xl font-bold">${balance ?? '0'}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Allowance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allowanceLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-3xl font-bold text-primary">${allowance ?? '0'}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Approved for trading</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Portfolio Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              {positionsLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-3xl font-bold">${atomicToDollars(totalCurrentValue).toFixed(2)}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Current value of positions</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Unrealized P&L
              </CardTitle>
            </CardHeader>
            <CardContent>
              {positionsLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <p className={`text-3xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatPnl(totalPnl)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Tabs */}
      <section className="container mx-auto px-4 pb-12">
        <Tabs defaultValue="positions">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="positions">
              Positions {positions && positions.length > 0 && `(${positions.length})`}
            </TabsTrigger>
            <TabsTrigger value="orders">
              Open Orders {orders && orders.length > 0 && `(${orders.length})`}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-6">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-4 text-muted-foreground font-medium">Market</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Side</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Shares</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Avg Price</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Current</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positionsLoading ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
                          </td>
                        </tr>
                      ) : !positions || positions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-muted-foreground">
                            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No positions yet
                          </td>
                        </tr>
                      ) : (
                        positions.map((pos) => {
                          const currentValue = positionCurrentValue(pos.shares, pos.currentPrice);
                          const pnl = currentValue - pos.costBasis;
                          return (
                            <tr key={pos.positionId} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="p-4">
                                <Link to={`/event/${pos.marketId}`} className="hover:text-primary transition-colors">
                                  {pos.question.length > 50 ? pos.question.slice(0, 50) + '…' : pos.question}
                                </Link>
                              </td>
                              <td className="p-4">
                                <Badge
                                  variant="outline"
                                  className={pos.outcome === 'Yes'
                                    ? 'text-green-400 border-green-500/30'
                                    : 'text-red-400 border-red-500/30'}
                                >
                                  {pos.outcome}
                                </Badge>
                              </td>
                              <td className="text-right p-4 font-mono">{pos.shares}</td>
                              <td className="text-right p-4 font-mono">{bpsToDollar(pos.averagePrice)}</td>
                              <td className="text-right p-4 font-mono">{bpsToDollar(pos.currentPrice)}</td>
                              <td className={`text-right p-4 font-mono ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPnl(pnl)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="mt-6">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-4 text-muted-foreground font-medium">Market</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Side</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Price</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Size</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Filled</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersLoading ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
                          </td>
                        </tr>
                      ) : !orders || orders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-muted-foreground">
                            <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No open orders
                          </td>
                        </tr>
                      ) : (
                        orders.map((order) => (
                          <tr key={order.orderId} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="p-4">
                              <Link to={`/event/${order.marketId}`} className="hover:text-primary transition-colors font-mono text-xs">
                                {order.marketId.slice(0, 12)}…
                              </Link>
                            </td>
                            <td className="p-4">
                              <Badge
                                variant="outline"
                                className={order.outcome === 'Yes'
                                  ? 'text-green-400 border-green-500/30'
                                  : 'text-red-400 border-red-500/30'}
                              >
                                {order.outcome}
                              </Badge>
                            </td>
                            <td className="text-right p-4 font-mono">{bpsToDollar(order.price)}</td>
                            <td className="text-right p-4 font-mono">{order.size}</td>
                            <td className="text-right p-4 font-mono">{order.filledSize}/{order.size}</td>
                            <td className="text-right p-4">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleCancelOrder(order.orderId)}
                              >
                                <X className="w-3.5 h-3.5 mr-1" />
                                Cancel
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-4 text-muted-foreground font-medium">Market</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Side</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Price</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Size</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Filled</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyLoading ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
                          </td>
                        </tr>
                      ) : !allOrders || allOrders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-12 text-muted-foreground">
                            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No trade history
                          </td>
                        </tr>
                      ) : (
                        allOrders.map((order) => (
                          <tr key={order.orderId} className="border-b border-border/50 hover:bg-muted/30">
                            <td className="p-4">
                              <Link to={`/event/${order.marketId}`} className="hover:text-primary transition-colors font-mono text-xs">
                                {order.marketId.slice(0, 12)}…
                              </Link>
                            </td>
                            <td className="p-4">
                              <Badge
                                variant="outline"
                                className={order.outcome === 'Yes'
                                  ? 'text-green-400 border-green-500/30'
                                  : 'text-red-400 border-red-500/30'}
                              >
                                {order.outcome}
                              </Badge>
                            </td>
                            <td className="text-right p-4 font-mono">{bpsToDollar(order.price)}</td>
                            <td className="text-right p-4 font-mono">{order.size}</td>
                            <td className="text-right p-4 font-mono">{order.filledSize}/{order.size}</td>
                            <td className="text-right p-4">
                              <Badge
                                variant="outline"
                                className={
                                  order.status === 'Filled' ? 'text-green-400 border-green-500/30'
                                  : order.status === 'Cancelled' ? 'text-muted-foreground border-border'
                                  : order.status === 'PartiallyFilled' ? 'text-yellow-400 border-yellow-500/30'
                                  : 'text-blue-400 border-blue-500/30'
                                }
                              >
                                {order.status}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
