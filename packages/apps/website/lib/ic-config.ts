import { configure } from '@final-score/ic-js';

// Determine environment
const isDevelopment = process.env.NODE_ENV === 'development';

// Host configuration
const host = process.env.NEXT_PUBLIC_IC_HOST || (isDevelopment ? 'http://localhost:4943' : 'https://icp-api.io');

// Load canister IDs based on environment
function getCanisterIds() {
  // Allow environment variable override
  if (process.env.NEXT_PUBLIC_FINAL_SCORE_CANISTER_ID) {
    return {
      FINAL_SCORE: process.env.NEXT_PUBLIC_FINAL_SCORE_CANISTER_ID,
    };
  }

  // In development, load from .dfx/local/canister_ids.json
  if (isDevelopment) {
    try {
      // This path is relative to the workspace root
      const localCanisterIds = require('../../../../.dfx/local/canister_ids.json');
      return {
        FINAL_SCORE: localCanisterIds.final_score.local,
      };
    } catch (error) {
      console.error('Failed to load local canister IDs. Make sure dfx is running.', error);
      throw new Error('Local canister IDs not found. Run `dfx start` and `dfx deploy`');
    }
  }

  // In production, load from canister_ids.json
  try {
    const canisterIds = require('../../../../canister_ids.json');
    return {
      FINAL_SCORE: canisterIds.final_score.ic,
    };
  } catch (error) {
    console.error('Failed to load canister IDs', error);
    throw new Error('Canister IDs not found');
  }
}

let isConfigured = false;

/**
 * Initialize the ic-js package with canister IDs and host configuration.
 * This must be called before making any IC calls.
 */
export function initializeIC() {
  if (isConfigured) {
    return;
  }

  const canisterIds = getCanisterIds();

  configure({
    canisterIds,
    host,
    verbose: isDevelopment,
  });

  isConfigured = true;
}

/**
 * Get the canister ID for Final Score
 */
export function getFinalScoreCanisterId(): string {
  const ids = getCanisterIds();
  return ids.FINAL_SCORE;
}
