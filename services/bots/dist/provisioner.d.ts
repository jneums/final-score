/**
 * Bot provisioner — creates new bot identities at runtime.
 *
 * Handles: identity generation, token approval, API key creation,
 * identity pool for reuse, and encrypted persistence to disk.
 */
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { type PersistedIdentity } from "./persistence.js";
export interface ProvisionedBot {
    name: string;
    keyBase64: string;
    principal: string;
    apiKey: string;
    candid: CandidClient;
    mcp?: McpClient;
}
export declare function setNextBotIndex(index: number): void;
export declare function getNextBotIndex(): number;
/**
 * Restore identities from encrypted disk on startup.
 * Returns the persisted identities that should be used instead of
 * (or merged with) BOT_IDENTITIES env var.
 */
export declare function restoreFromDisk(): Promise<{
    identities: PersistedIdentity[];
    idleNames: Set<string>;
    nextBotIndex: number;
} | null>;
/**
 * Persist the current state to encrypted disk.
 * Called after every scale operation and periodically.
 */
export declare function persistToDisk(): void;
/**
 * Provision a single bot. Steps:
 * 1. Check idle pool first (reuse funded identity)
 * 2. Otherwise generate new identity
 * 3. Approve tokens for the canister
 * 4. Create API key (for MCP tier bots)
 * 5. Create CandidClient + McpClient
 *
 * NOTE: Funding happens via the payday system — first cycle = payday.
 */
export declare function provisionBot(botName: string, needsMcp: boolean): Promise<ProvisionedBot>;
/**
 * Reconstruct a ProvisionedBot from a persisted identity.
 * Used when restoring from disk.
 */
export declare function reconstructBot(identity: PersistedIdentity, needsMcp: boolean): Promise<ProvisionedBot>;
/**
 * Return a bot identity to the idle pool for reuse.
 */
export declare function returnToPool(bot: ProvisionedBot): void;
/**
 * Register an identity in the provisioner's tracking (for persistence).
 * Used for bots loaded from BOT_IDENTITIES that bypass provisionBot().
 */
export declare function registerIdentity(id: PersistedIdentity): void;
/**
 * Load pre-existing identities from BOT_IDENTITIES config.
 * Called once on startup to bootstrap the initial set.
 */
export declare function loadExistingIdentities(): Array<{
    name: string;
    keyBase64: string;
    principal: string;
    apiKey: string;
}>;
export declare function getProvisionerStats(): Record<string, unknown>;
