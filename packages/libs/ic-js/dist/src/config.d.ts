interface CanisterConfig {
    [canisterName: string]: string;
}
/**
 * Initializes the ic-js package with the necessary canister IDs.
 * This MUST be called once at the startup of any consuming application.
 *
 * Expected canister names: 'FINAL_SCORE', 'USDC_LEDGER'
 */
export declare function configure(config: {
    canisterIds: CanisterConfig;
    host?: string;
    verbose?: boolean;
}): void;
/**
 * A type-safe helper to get a canister ID.
 * @param name The short name of the canister (e.g., 'FINAL_SCORE', 'USDC_LEDGER')
 * @returns The canister ID principal string.
 */
export declare const getCanisterId: (name: string) => string;
/**
 * Get the host URL for the current network.
 */
export declare const getHost: () => string;
export {};
