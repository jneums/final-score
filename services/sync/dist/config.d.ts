export declare const CONFIG: {
    CANISTER_ID: string;
    IC_HOST: string;
    DFX_IDENTITY_PEM: string;
    MAKER_IDENTITY_PEM: string;
    GAMMA_API: string;
    SYNC_INTERVAL: number;
    RESOLVE_INTERVAL: number;
    PORT: string | number;
    WHITELIST: string[];
    SPORT_TAGS: Record<string, string>;
    MAKER: {
        SPREAD_BPS: number;
        LEVELS: number;
        SIZE_PER_LEVEL: number;
        REFRESH_THRESHOLD_BPS: number;
        SKIP_NEAR_EXPIRY_MS: number;
        MAX_PRICE_AGE_MS: number;
        MAX_MARKETS_PER_TICK: number;
        ORDER_DELAY_MS: number;
        MIN_PRICE_EDGE_BPS: number;
        REPLENISH_INTERVAL: number;
    };
};
