/**
 * Wallet connection button and modal component
 */

import { useState } from 'react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { useAuth } from '../hooks/useAuth';
import { Wallet, User } from 'lucide-react';
import type { WalletProvider } from '../lib/auth';
import { useWalletDrawer } from '../contexts/WalletDrawerContext';

const WALLET_OPTIONS: { id: WalletProvider; name: string; description: string }[] = [
  {
    id: 'identity',
    name: 'Internet Identity',
    description: 'IC native authentication (v2)',
  },
  {
    id: 'nfid',
    name: 'NFID',
    description: 'Modern wallet with email support',
  },
  {
    id: 'plug',
    name: 'Plug Wallet',
    description: 'Browser extension wallet',
  },
];

export function WalletConnect() {
  const { isAuthenticated, isLoading, error, login, getPrincipal } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<WalletProvider | null>(null);
  const { openDrawer } = useWalletDrawer();

  const handleLogin = async (provider: WalletProvider) => {
    setConnectingProvider(provider);
    try {
      await login(provider);
      setIsOpen(false);
    } catch (err) {
      console.error('Login failed:', err);
      setIsOpen(false);
    } finally {
      setConnectingProvider(null);
    }
  };

  const formatPrincipal = (principal: string | null) => {
    if (!principal) return '';
    if (principal.length <= 12) return principal;
    return `${principal.slice(0, 6)}...${principal.slice(-4)}`;
  };

  if (isAuthenticated) {
    return (
      <button
        onClick={openDrawer}
        className="flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
      >
        <User className="h-4 w-4" />
        <span className="text-sm font-mono">
          {formatPrincipal(getPrincipal())}
        </span>
      </button>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Wallet className="h-4 w-4" />
          Connect Wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Your Wallet</DialogTitle>
          <DialogDescription>
            Choose a wallet provider to connect to Final Score
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 mt-4">
          {WALLET_OPTIONS.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() => handleLogin(wallet.id)}
              disabled={isLoading || connectingProvider !== null}
              className="w-full flex items-start gap-3 p-4 rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              <Wallet className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{wallet.name}</div>
                <div className="text-sm text-muted-foreground">
                  {wallet.description}
                </div>
                {connectingProvider === wallet.id && (
                  <div className="text-sm text-primary mt-1">
                    Connecting...
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">
              {error}
            </p>
          </div>
        )}

        <div className="mt-4 text-xs text-muted-foreground text-center">
          By connecting, you agree to interact with on-chain prediction markets. This is a non-custodial platform.
        </div>
      </DialogContent>
    </Dialog>
  );
}
