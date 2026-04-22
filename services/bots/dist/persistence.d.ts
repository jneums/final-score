/**
 * Encrypted persistence for bot identities.
 *
 * Stores bot identity pool as AES-256-GCM encrypted JSON on disk.
 * Decrypted at startup, encrypted on every write.
 * Master key comes from BOT_POOL_KEY env var.
 *
 * File format: base64(iv:authTag:ciphertext)
 */
export interface PersistedIdentity {
    name: string;
    keyBase64: string;
    principal: string;
    apiKey: string;
}
export interface PersistedPool {
    /** All known identities (active + idle) */
    identities: PersistedIdentity[];
    /** Names of identities currently in idle pool (not assigned to a bot) */
    idleNames: string[];
    /** Next bot index for strategy/persona assignment */
    nextBotIndex: number;
    /** Last updated timestamp */
    updatedAt: string;
}
/**
 * Load the persisted pool from encrypted file.
 * Returns null if file doesn't exist or key is not set.
 */
export declare function loadPool(filePath: string): PersistedPool | null;
/**
 * Save the pool to encrypted file.
 */
export declare function savePool(filePath: string, pool: PersistedPool): boolean;
/**
 * Check if persistence is available (BOT_POOL_KEY is set).
 */
export declare function isPersistenceEnabled(): boolean;
