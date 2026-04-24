import { useAuth } from '../hooks/useAuth';
import { useWalletDrawer } from '../contexts/WalletDrawerContext';
import { useUsdcBalance } from '../hooks/useLedger';
import { getToken } from '@final-score/ic-js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { AllowanceManager } from './AllowanceManager';
import { ApiKeysManager } from './ApiKeysManager';
import { Copy, RefreshCw, Check, LogOut, X } from 'lucide-react';
import { useState } from 'react';

export function WalletDrawer() {
  const { user, logout } = useAuth();
  const { data: balance, isLoading: balanceLoading, refetch: refetchBalance } = useUsdcBalance(user?.principal);
  const [copiedPrincipal, setCopiedPrincipal] = useState(false);
  const { isOpen, closeDrawer } = useWalletDrawer();

  const copyPrincipal = () => {
    if (user?.principal) {
      navigator.clipboard.writeText(user.principal);
      setCopiedPrincipal(true);
      setTimeout(() => setCopiedPrincipal(false), 2000);
    }
  };

  const drawerContent = (
    <div className="space-y-6">
      {/* USDC Balance Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>USDC Balance</CardTitle>
              <CardDescription>Your wallet balance</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => refetchBalance()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-3xl font-bold">
              {balanceLoading ? '—' : `$${Number(balance ?? 0).toFixed(2)}`}{' '}
              <span className="text-lg text-muted-foreground">USDC</span>
            </div>
            {!balanceLoading && (() => {
              try {
                const token = getToken();
                const isTestToken = token.canisterId.toText() === '3jkp5-oyaaa-aaaaj-azwqa-cai';
                if (!isTestToken) return null;
                return (
                  <div className="p-3 bg-blue-950/30 border border-blue-800/50 rounded-lg text-sm">
                    <p className="font-medium text-blue-400">Test Token Faucet</p>
                    <p className="text-muted-foreground mt-1">
                      This platform uses test tokens. Visit the{' '}
                      <a
                        href="https://faucet.internetcomputer.org/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                      >
                        DFINITY faucet
                      </a>
                      {' '}and request <span className="font-medium text-blue-400">TICRC1</span> tokens to top up your balance.
                    </p>
                  </div>
                );
              } catch { return null; }
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Account Details Section */}
      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <CardDescription>Your identity information</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Principal ID */}
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-2">Principal ID</div>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-3 py-2 rounded-md font-mono flex-1 truncate">
                  {user?.principal}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={copyPrincipal}
                >
                  {copiedPrincipal ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allowance Manager */}
      <AllowanceManager />

      {/* API Keys Manager */}
      <ApiKeysManager />

      {/* Sign Out Button */}
      <div className="pt-4 border-t">
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => {
            logout();
            closeDrawer();
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: Fixed positioned drawer */}
      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden"
            onClick={closeDrawer}
          />
          
          <div className="fixed top-24 right-4 w-80 max-w-[calc(100vw-2rem)] z-50 md:hidden">
            <div className="bg-background border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-7rem)]">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Wallet & Account</h2>
                  <p className="text-xs text-muted-foreground">Manage your USDC balance</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeDrawer}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[calc(100vh-12rem)]">
                {drawerContent}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Desktop: Side panel */}
      {isOpen && (
        <div className="hidden md:block">
          <div 
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={closeDrawer}
          />
          <div className="fixed top-0 right-0 h-full w-full sm:max-w-xl bg-background border-l border-border z-50 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Wallet & Account</h2>
                  <p className="text-sm text-muted-foreground">
                    Manage your USDC balance, allowances, and API keys
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeDrawer}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {drawerContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
