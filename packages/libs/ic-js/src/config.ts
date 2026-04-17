interface CanisterConfig {
  [canisterName: string]: string;
}

const MAINNET_URL = 'https://icp-api.io';

let _canisterIds: CanisterConfig = {};
let _host = MAINNET_URL;
let _isConfigured = false;

/**
 * Initializes the ic-js package with the necessary canister IDs.
 * This MUST be called once at the startup of any consuming application.
 *
 * Expected canister names: 'FINAL_SCORE', 'USDC_LEDGER'
 */
export function configure(config: {
  canisterIds: CanisterConfig;
  host?: string;
  verbose?: boolean;
}): void {
  if (_isConfigured) {
    console.warn('ic-js package has already been configured.');
    return;
  }
  _canisterIds = config.canisterIds;
  _host = config.host || MAINNET_URL;
  _isConfigured = true;
}

/**
 * A type-safe helper to get a canister ID.
 * @param name The short name of the canister (e.g., 'FINAL_SCORE', 'USDC_LEDGER')
 * @returns The canister ID principal string.
 */
export const getCanisterId = (name: string): string => {
  if (!_isConfigured) {
    throw new Error(
      'The @final-score/ic-js package has not been configured. Please call the configure() function at application startup.',
    );
  }

  const canisterId = _canisterIds[name.toUpperCase()];

  if (!canisterId) {
    console.error(
      'Available canister names in config:',
      Object.keys(_canisterIds),
    );
    console.error(`Requested canister name: '${name}'`);
    throw new Error(
      `Configuration does not contain a canister ID for '${name}'.`,
    );
  }

  return canisterId;
};

/**
 * Get the host URL for the current network.
 */
export const getHost = (): string => {
  return _host;
};
