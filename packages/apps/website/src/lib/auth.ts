/**
 * Authentication service using @dfinity/auth-client v2
 * Supports: Internet Identity v2, NFID, Plug Wallet
 */

import { AuthClient } from '@dfinity/auth-client';
import type { Identity } from '@dfinity/agent';

// Plug wallet global interface
declare global {
  interface Window {
    ic?: {
      plug?: {
        requestConnect: (options?: { whitelist?: string[]; host?: string }) => Promise<boolean>;
        isConnected: (options?: { host?: string }) => Promise<boolean>;
        createAgent: (options?: { whitelist?: string[]; host?: string }) => Promise<any>;
        createActor: (options: { canisterId: string; interfaceFactory: any }) => Promise<any>;
        agent: any;
        getPrincipal: () => Promise<any>;
        disconnect: () => Promise<void>;
      };
    };
  }
}

export type WalletProvider = 'identity' | 'nfid' | 'plug';

const STORAGE_KEY = 'final_score_auth';
const PLUG_CONNECT_TIMEOUT = 60000;

interface StoredAuth {
  provider: WalletProvider;
  principal: string;
  timestamp: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

export interface UserObject {
  principal: string;
  agent: Identity;
  provider: string;
  plugActors?: {
    finalScore?: any;
    usdcLedger?: any;
  };
}

export class AuthService {
  private currentUser: UserObject | null = null;
  private authClient: AuthClient | null = null;
  private host: string;
  private initPromise: Promise<void> | null = null;
  private hasInitialized: boolean = false;

  constructor(host?: string) {
    this.host = host || 
      (window.location.hostname === 'localhost' ? 'http://localhost:4943' : 'https://icp0.io');
  }

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initAuthClient();
    return this.initPromise;
  }

  private async initAuthClient() {
    this.authClient = await AuthClient.create({
      idleOptions: {
        disableIdle: true,
      },
    });
    
    if (!this.hasInitialized) {
      await this.loadFromAuthClient();
      this.hasInitialized = true;
    }
  }

  private async loadFromAuthClient() {
    const stored = localStorage.getItem(STORAGE_KEY);
    let storedProvider: WalletProvider | null = null;
    
    if (stored) {
      try {
        const authData: StoredAuth = JSON.parse(stored);
        storedProvider = authData.provider;
      } catch {}
    }

    // If last provider was Plug, try to restore Plug session
    if (storedProvider === 'plug' && window.ic?.plug) {
      try {
        const whitelist = [
          'ilyol-uqaaa-aaaai-q34kq-cai', // Final Score canister
          '3jkp5-oyaaa-aaaaj-azwqa-cai'   // Test faucet ICRC-1 ledger
        ];
        
        let isConnected = false;
        try {
          isConnected = await window.ic.plug.isConnected();
        } catch (error) {
          this.clearStorage();
          return;
        }
        
        if (isConnected) {
          const agent = window.ic.plug.agent;
          if (!agent) {
            this.clearStorage();
            return;
          }
          
          try {
            const principal = await agent.getPrincipal();
            
            // Re-create actors for restored session
            const FinalScore = await import('@final-score/declarations').then(m => m.FinalScore);

            const plugActors = {
              finalScore: await window.ic.plug.createActor({
                canisterId: whitelist[0],
                interfaceFactory: FinalScore.idlFactory,
              }),
              usdcLedger: null,
            };
            
            this.currentUser = {
              principal: principal.toText(),
              agent: agent,
              provider: 'plug',
              plugActors,
            };
            return;
          } catch (error) {
            this.clearStorage();
            return;
          }
        } else {
          this.clearStorage();
        }
      } catch (error) {
        this.clearStorage();
      }
    }

    // Otherwise check AuthClient (for II/NFID)
    if (!this.authClient) return;

    const isAuthenticated = await this.authClient.isAuthenticated();
    if (isAuthenticated) {
      const identity = this.authClient.getIdentity();
      const principal = identity.getPrincipal().toString();
      
      const provider = storedProvider || 'identity';

      this.currentUser = {
        principal,
        agent: identity,
        provider,
      };
    }
  }

  isAuthenticated(): boolean {
    return this.currentUser !== null && this.currentUser.principal !== '2vxsx-fae';
  }

  getPrincipal(): string | null {
    return this.isAuthenticated() ? this.currentUser!.principal : null;
  }

  getAgent(): Identity | null {
    return this.currentUser?.agent || null;
  }

  getProvider(): string | null {
    return this.currentUser?.provider || null;
  }

  async login(provider: WalletProvider): Promise<UserObject> {
    console.log(`[AuthService] Logging in with ${provider}, host: ${this.host}`);
    await this.init();

    if (provider === 'plug') {
      return this.loginWithPlug();
    }

    if (!this.authClient) {
      throw new Error('AuthClient not initialized');
    }

    const identityProvider = provider === 'nfid' 
      ? 'https://nfid.one/authenticate'
      : 'https://id.ai';

    const maxTimeToLive = BigInt(7 * 24 * 60 * 60 * 1_000_000_000);

    return new Promise((resolve, reject) => {
      this.authClient!.login({
        identityProvider,
        maxTimeToLive,
        onSuccess: () => {
          const identity = this.authClient!.getIdentity();
          const principal = identity.getPrincipal().toString();

          this.currentUser = {
            principal,
            agent: identity,
            provider,
          };

          this.saveToStorage(provider, principal);
          resolve(this.currentUser);
        },
        onError: (error) => {
          console.error('Authentication error:', error);
          reject(new Error(`Authentication failed: ${error}`));
        },
      });
    });
  }

  private async loginWithPlug(): Promise<UserObject> {
    if (!window.ic?.plug) {
      throw new Error('Plug wallet is not installed. Please install it from https://plugwallet.ooo/');
    }

    const whitelist = [
      'ilyol-uqaaa-aaaai-q34kq-cai', // Final Score canister
      '3jkp5-oyaaa-aaaaj-azwqa-cai'   // Test faucet ICRC-1 ledger
    ];

    if (!window.ic?.plug?.requestConnect) {
      throw new Error('Plug wallet not available');
    }

    const isConnected = await withTimeout(
      window.ic.plug.isConnected(),
      PLUG_CONNECT_TIMEOUT,
      'Plug connection check timed out'
    );

    if (isConnected) {
      await withTimeout(
        window.ic.plug.createAgent({ whitelist, host: this.host }),
        PLUG_CONNECT_TIMEOUT,
        'Plug agent creation timed out. Please try again.'
      );
    } else {
      const connected = await withTimeout(
        window.ic.plug.requestConnect({ whitelist, host: this.host }),
        PLUG_CONNECT_TIMEOUT,
        'Plug connection request timed out. Please try again.'
      );
      if (!connected) {
        throw new Error('User denied Plug wallet connection');
      }
    }

    const agent = window.ic.plug.agent;
    if (!agent) {
      throw new Error('Plug agent not available after connection');
    }

    const principal = await agent.getPrincipal();

    const [FinalScore, UsdcLedger] = await Promise.all([
      import('@final-score/declarations').then(m => m.FinalScore),
      import('@final-score/declarations').then(m => m.UsdcLedger),
    ]);

    const plugActors = {
      finalScore: await window.ic.plug.createActor({
        canisterId: whitelist[0],
        interfaceFactory: FinalScore.idlFactory,
      }),
      usdcLedger: await window.ic.plug.createActor({
        canisterId: whitelist[1],
        interfaceFactory: UsdcLedger.idlFactory,
      }),
    };

    this.currentUser = {
      principal: principal.toText(),
      agent: agent,
      provider: 'plug',
      plugActors,
    };

    console.log('Plug connected!', this.currentUser.principal);
    this.saveToStorage('plug', principal.toText());
    return this.currentUser;
  }

  async logout(): Promise<void> {
    if (this.currentUser?.provider === 'plug') {
      this.currentUser = null;
      this.clearStorage();
    } else if (this.authClient) {
      await this.authClient.logout();
      this.currentUser = null;
      this.clearStorage();
    } else {
      this.currentUser = null;
      this.clearStorage();
    }
  }

  private saveToStorage(provider: WalletProvider, principal: string): void {
    const authData: StoredAuth = {
      provider,
      principal,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authData));
  }

  private clearStorage(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  getLastProvider(): WalletProvider | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    try {
      const authData: StoredAuth = JSON.parse(stored);
      return authData.provider;
    } catch {
      return null;
    }
  }
}

let authService: AuthService | null = null;

export const getAuthService = (host?: string): AuthService => {
  if (!authService) {
    authService = new AuthService(host);
  }
  return authService;
};
