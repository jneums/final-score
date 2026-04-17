// packages/libs/ic-js/src/api/keys.api.ts
import { getFinalScoreActor } from '../actors.js';
/**
 * Create a new API key for the authenticated user.
 * @param identity User's identity
 * @param name Human-readable name for the key
 * @param scopes Array of scope strings (e.g. ['trade', 'read'])
 * @returns The newly created API key string (show once, then it's hashed)
 */
export async function createApiKey(identity, name, scopes) {
    const actor = await getFinalScoreActor(identity);
    return actor.create_my_api_key(name, scopes);
}
/**
 * Revoke an existing API key.
 * @param identity User's identity
 * @param keyId The hashed key ID to revoke
 */
export async function revokeApiKey(identity, keyId) {
    const actor = await getFinalScoreActor(identity);
    await actor.revoke_my_api_key(keyId);
}
/**
 * List all API keys for the authenticated user.
 * @param identity User's identity
 * @returns Array of API key metadata
 */
export async function listApiKeys(identity) {
    const actor = await getFinalScoreActor(identity);
    return actor.list_my_api_keys();
}
