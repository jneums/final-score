/**
 * React hook for authentication
 */

import { create } from 'zustand';
import { getAuthService, type WalletProvider, type UserObject } from '../lib/auth';
import { useQueryClient } from '@tanstack/react-query';

interface AuthStore {
  user: UserObject | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (provider: WalletProvider) => Promise<void>;
  logout: () => Promise<void>;
  getAgent: () => any;
  getPrincipal: () => string | null;
  invalidateQueries?: () => void;
  handleSessionExpired?: () => void;
}

const network = process.env.DFX_NETWORK || 'local';
const host = network === 'ic' ? 'https://icp0.io' : 'http://127.0.0.1:4943';

const authService = getAuthService(host);

export const useAuthStore = create<AuthStore>((set: any, get: any) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (provider: WalletProvider) => {
    set({ isLoading: true, error: null });
    
    try {
      const user = await authService.login(provider);
      
      if (user.provider === 'plug' && user.plugActors) {
        (user.agent as any)._plugFinalScoreActor = user.plugActors.finalScore;
        (user.agent as any)._plugUsdcLedgerActor = user.plugActors.usdcLedger;
      }
      
      set({ 
        user, 
        isAuthenticated: true, 
        isLoading: false,
        error: null
      });
      
      const invalidate = get().invalidateQueries;
      if (invalidate) {
        invalidate();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      set({ 
        user: null, 
        isAuthenticated: false, 
        isLoading: false,
        error: message
      });
      throw error;
    }
  },

  logout: async () => {
    set({ 
      user: null, 
      isAuthenticated: false, 
      error: null 
    });
    
    await authService.logout();
    
    const invalidate = get().invalidateQueries;
    if (invalidate) {
      invalidate();
    }
  },

  getAgent: () => {
    return authService.getAgent();
  },

  getPrincipal: () => {
    return authService.getPrincipal();
  },
  
  handleSessionExpired: () => {
    const currentUser = get().user;
    if (currentUser?.provider === 'plug') {
      set({ 
        user: null, 
        isAuthenticated: false, 
        error: 'Session expired. Please reconnect.' 
      });
      authService.logout().catch(() => {});
    }
  },
}));

// Initialize authentication state on app load
(async () => {
  try {
    await authService.init();
    const isAuth = authService.isAuthenticated();
    const agent = authService.getAgent();
    const principal = authService.getPrincipal();
    
    if (isAuth && agent && principal) {
      const user = {
        principal,
        agent,
        provider: authService.getProvider() || 'identity',
        plugActors: (authService as any).currentUser?.plugActors,
      };
      
      if (user.provider === 'plug' && user.plugActors) {
        (user.agent as any)._plugFinalScoreActor = user.plugActors.finalScore;
        (user.agent as any)._plugUsdcLedgerActor = user.plugActors.usdcLedger;
      }
      
      useAuthStore.setState({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } else {
      useAuthStore.setState({
        isLoading: false,
      });
    }
  } catch (error) {
    console.error('[Auth] Failed to restore session:', error);
    useAuthStore.setState({
      isLoading: false,
    });
  }
})();

export const useAuth = () => {
  const store = useAuthStore();
  const queryClient = useQueryClient();
  
  if (!store.invalidateQueries) {
    useAuthStore.setState({
      invalidateQueries: () => {
        queryClient.invalidateQueries();
      }
    });
  }
  
  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    isLoading: store.isLoading,
    error: store.error,
    login: store.login,
    logout: store.logout,
    getAgent: store.getAgent,
    getPrincipal: store.getPrincipal,
    provider: authService.getProvider(),
    lastProvider: authService.getLastProvider(),
  };
};
