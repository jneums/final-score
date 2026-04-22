/**
 * Bot provisioner — creates new bot identities at runtime.
 *
 * Handles: identity generation, token approval, API key creation,
 * and an identity pool so bots can be re-used after scaling down.
 */
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
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
 * Return a bot identity to the idle pool for reuse.
 */
export declare function returnToPool(bot: ProvisionedBot): void;
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
