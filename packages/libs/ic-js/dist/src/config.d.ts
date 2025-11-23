interface CanisterConfig {
    [canisterName: string]: string;
}
/**
 * Initializes the ic-js package with the necessary canister IDs.
 * This MUST be called once at the startup of any consuming application (CLI or frontend).
 * @param config An object mapping canister names (e.g., 'AUTH_SERVER') to their IDs.
 */
export declare function configure(config: {
    canisterIds: CanisterConfig;
    host?: string;
    verbose?: boolean;
}): void;
/**
 * A type-safe helper to get a canister ID.
 * Reads from the internal, configured state.
 * @param name The short name of the canister (e.g., 'AUTH_SERVER')
 * @returns The canister ID principal string.
 */
export declare const getCanisterId: (name: string) => string;
/**
 * Get the host URL for the current network.
 */
export declare const getHost: () => string;
export {};
