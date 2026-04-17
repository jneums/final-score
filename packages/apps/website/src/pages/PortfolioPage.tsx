import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useAuth } from '../hooks/useAuth';
import { useUsdcBalance } from '../hooks/useLedger';
import { useAllowance } from '../hooks/useAllowance';
import {
  Wallet,
  Lock,
  CircleDollarSign,
  Clock,
  FileText,
  BarChart3,
  Loader2,
} from 'lucide-react';

export default function PortfolioPage() {
  const { isAuthenticated, user } = useAuth();
  const { data: balance, isLoading: balanceLoading } = useUsdcBalance(user?.principal);
  const { data: allowance, isLoading: allowanceLoading } = useAllowance(user?.principal);

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <BarChart3 className="w-4 h-4" />
                Available
              </CardTitle>
            </CardHeader>
            <CardContent>
              {balanceLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <p className="text-3xl font-bold text-green-400">${balance ?? '0'}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">Free to trade</p>
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
        </div>
      </section>

      {/* Tabs */}
      <section className="container mx-auto px-4 pb-12">
        <Tabs defaultValue="positions">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="orders">Open Orders</TabsTrigger>
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
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted-foreground">
                          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No positions yet
                        </td>
                      </tr>
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
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-muted-foreground">
                          <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No open orders
                        </td>
                      </tr>
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
                        <th className="text-left p-4 text-muted-foreground font-medium">Date</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Market</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Type</th>
                        <th className="text-left p-4 text-muted-foreground font-medium">Side</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Price</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Size</th>
                        <th className="text-right p-4 text-muted-foreground font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-muted-foreground">
                          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                          No trade history
                        </td>
                      </tr>
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
