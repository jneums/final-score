import { type Identity } from '@icp-sdk/core/agent';
import { FinalScore } from '@final-score/declarations';
export type ApiKeyMetadata = FinalScore.ApiKeyMetadata;
/**
 * Create a new API key for the authenticated user.
 * @param identity User's identity
 * @param name Human-readable name for the key
 * @param scopes Array of scope strings (e.g. ['trade', 'read'])
 * @returns The newly created API key string (show once, then it's hashed)
 */
export declare function createApiKey(identity: Identity, name: string, scopes: string[]): Promise<string>;
/**
 * Revoke an existing API key.
 * @param identity User's identity
 * @param keyId The hashed key ID to revoke
 */
export declare function revokeApiKey(identity: Identity, keyId: string): Promise<void>;
/**
 * List all API keys for the authenticated user.
 * @param identity User's identity
 * @returns Array of API key metadata
 */
export declare function listApiKeys(identity: Identity): Promise<ApiKeyMetadata[]>;
