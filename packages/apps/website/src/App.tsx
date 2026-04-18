import { Routes, Route, useLocation, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import Navigation from './components/Navigation';
import HomePage from './pages/HomePage';
import SportPage from './pages/SportPage';
import EventPage from './pages/EventPage';
import PortfolioPage from './pages/PortfolioPage';
import LeaderboardPage from './pages/LeaderboardPage';
import { WalletDrawerProvider } from './contexts/WalletDrawerContext';
import { WalletDrawer } from './components/WalletDrawer';
import { useAuth } from './hooks/useAuth';

import { configure as configureIcJs } from '@final-score/ic-js';

// --- CONFIGURE THE SHARED PACKAGE ---
const canisterIds = {
  FINAL_SCORE: process.env.CANISTER_ID_FINAL_SCORE!,
  WEBSITE: process.env.CANISTER_ID_WEBSITE!,
  USDC_LEDGER: process.env.CANISTER_ID_USDC_LEDGER || '3jkp5-oyaaa-aaaaj-azwqa-cai',
};

const network = process.env.DFX_NETWORK || 'local';
const host = network === 'ic' ? 'https://icp-api.io' : 'http://127.0.0.1:4943';

configureIcJs({ canisterIds, host, verbose: true });
// ------------------------------------

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function SessionExpirationHandler() {
  const { isAuthenticated, logout, user } = useAuth();

  useEffect(() => {
    let hasHandledDisconnect = false;

    const handleDisconnect = () => {
      if (hasHandledDisconnect) return;
      hasHandledDisconnect = true;
      setTimeout(() => {
        logout();
      }, 100);
    };

    const handleError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const error = 'reason' in event ? event.reason : event.error;
      const errorMessage = error?.message || error?.toString() || '';

      if (
        isAuthenticated &&
        user?.provider === 'plug' &&
        (errorMessage.includes('No keychain found') ||
         errorMessage.includes('keychain') ||
         errorMessage.includes('session'))
      ) {
        handleDisconnect();
      }
    };

    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      const errorMessage = args.join(' ');
      
      if (
        isAuthenticated &&
        user?.provider === 'plug' &&
        (errorMessage.includes('No keychain found') ||
         errorMessage.includes('tabMessenger') ||
         errorMessage.includes('keychain'))
      ) {
        handleDisconnect();
      }
      
      originalConsoleError.apply(console, args);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
      console.error = originalConsoleError;
    };
  }, [isAuthenticated, user, logout]);

  return null;
}

export default function App() {
  return (
    <WalletDrawerProvider>
      <div className="min-h-screen bg-background flex flex-col">
        <Toaster 
          position="top-right" 
          richColors 
          theme="dark"
          closeButton
          toastOptions={{
            className: '',
            style: {
              background: 'oklch(0.16 0.025 240)',
              border: '1px solid oklch(0.28 0.04 240)',
              color: 'oklch(0.95 0.01 200)',
            },
          }}
        />
        <SessionExpirationHandler />
        <ScrollToTop />
        <Navigation />
        <WalletDrawer />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/sport/:slug" element={<SportPage />} />
            <Route path="/event/:slug" element={<EventPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
          </Routes>
        </main>
        <footer className="border-t-2 border-primary/20 py-12 bg-card/30">
          <div className="container mx-auto px-4">
            <div className="flex flex-col items-center gap-6">
              <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm">
                <a 
                  href="https://github.com/jneums/final-score" 
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors font-medium inline-flex items-center gap-1"
                >
                  GitHub
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-sm sm:text-base text-muted-foreground font-medium">
                <div className="flex items-center gap-1">
                  <span>Powered by</span>
                  <a 
                    href="https://internetcomputer.org" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1"
                  >
                    Internet Computer
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
              
              <div className="inline-flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                <span className="text-xs sm:text-sm text-muted-foreground font-medium whitespace-nowrap">MCP URL</span>
                <code className="text-xs sm:text-sm font-mono text-foreground">
                  https://ilyol-uqaaa-aaaai-q34kq-cai.icp0.io/mcp
                </code>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </WalletDrawerProvider>
  );
}
