/**
 * Bot provisioner — creates new bot identities at runtime.
 *
 * Handles: identity generation, token approval, API key creation,
 * identity pool for reuse, and encrypted persistence to disk.
 */
import { generateIdentity, loadIdentityFromPem } from "./identity.js";
import { CandidClient, TokenClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { CONFIG } from "./config.js";
import { addLog } from "./index.js";
import { loadPool, savePool, isPersistenceEnabled, } from "./persistence.js";
// ─── Config ─────────────────────────────────────────────────
const POOL_FILE = process.env.BOT_POOL_PATH || "/data/bot-pool.enc";
// ─── Identity Pool ──────────────────────────────────────────
/**
 * Pool of provisioned identities that can be reused when scaling
 * down and then back up. Avoids wasting funded identities.
 */
const idlePool = [];
/** Track all provisioned identities (for stats) */
const allProvisioned = new Map();
/** Counter for generating sequential bot names */
let nextBotIndex = 0;
export function setNextBotIndex(index) {
    nextBotIndex = index;
}
export function getNextBotIndex() {
    return nextBotIndex;
}
// ─── Persistence Integration ────────────────────────────────
/**
 * Restore identities from encrypted disk on startup.
 * Returns the persisted identities that should be used instead of
 * (or merged with) BOT_IDENTITIES env var.
 */
export async function restoreFromDisk() {
    const pool = loadPool(POOL_FILE);
    if (!pool)
        return null;
    return {
        identities: pool.identities,
        idleNames: new Set(pool.idleNames),
        nextBotIndex: pool.nextBotIndex,
    };
}
/**
 * Persist the current state to encrypted disk.
 * Called after every scale operation and periodically.
 */
export function persistToDisk() {
    if (!isPersistenceEnabled())
        return;
    // Collect all known identities (active + idle pool)
    const identities = [];
    const idleNames = [];
    // Active bots
    for (const [name, bot] of allProvisioned) {
        identities.push({
            name,
            keyBase64: bot.keyBase64,
            principal: bot.principal,
            apiKey: bot.apiKey,
            profile: bot.profile,
        });
    }
    // Idle pool (may overlap with allProvisioned by name, dedupe by principal)
    const seenPrincipals = new Set(identities.map((i) => i.principal));
    for (const bot of idlePool) {
        if (!seenPrincipals.has(bot.principal)) {
            identities.push({
                name: bot.name,
                keyBase64: bot.keyBase64,
                principal: bot.principal,
                apiKey: bot.apiKey,
                profile: bot.profile,
            });
        }
        idleNames.push(bot.name);
    }
    const pool = {
        identities,
        idleNames,
        nextBotIndex,
        updatedAt: new Date().toISOString(),
    };
    savePool(POOL_FILE, pool);
}
// ─── Provisioning ───────────────────────────────────────────
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
export async function provisionBot(botName, needsMcp) {
    // 1. Check idle pool
    const pooled = idlePool.pop();
    if (pooled) {
        addLog("provisioner", "reuse", "success", `Reusing pooled identity ${pooled.principal.slice(0, 12)}... as ${botName}`);
        pooled.name = botName;
        allProvisioned.set(botName, pooled);
        return pooled;
    }
    // 2. Generate fresh identity
    addLog("provisioner", "generate", "success", `Generating new identity for ${botName}...`);
    const gen = generateIdentity();
    // 3. Create CandidClient
    const candid = await CandidClient.create(gen.identity);
    // 4. Approve tokens (bot approves the canister to spend its tokens)
    try {
        const tokenClient = await TokenClient.create(gen.identity);
        await tokenClient.approve(CONFIG.CANISTER_ID, CONFIG.APPROVE_AMOUNT);
        addLog("provisioner", "approve", "success", `${botName}: token approval set`);
    }
    catch (e) {
        addLog("provisioner", "approve", "error", `${botName}: token approval failed: ${String(e).slice(0, 150)}`);
    }
    await sleep(1000);
    // 5. Create API key for MCP bots (self-serve — bot creates its own key)
    let apiKey = "";
    if (needsMcp) {
        try {
            apiKey = await candid.createMyApiKey(botName, ["all"]);
            addLog("provisioner", "api-key", "success", `${botName}: API key created (self-serve)`);
        }
        catch (e) {
            addLog("provisioner", "api-key", "error", `${botName}: API key failed: ${String(e).slice(0, 150)}`);
        }
        await sleep(1000);
    }
    const mcp = needsMcp && apiKey ? new McpClient(apiKey) : undefined;
    const provisioned = {
        name: botName,
        keyBase64: gen.pemBase64,
        principal: gen.principal,
        apiKey,
        candid,
        mcp,
    };
    allProvisioned.set(botName, provisioned);
    return provisioned;
}
/**
 * Reconstruct a ProvisionedBot from a persisted identity.
 * Used when restoring from disk.
 */
export async function reconstructBot(identity, needsMcp) {
    const ident = loadIdentityFromPem(identity.keyBase64);
    const candid = await CandidClient.create(ident);
    const mcp = needsMcp && identity.apiKey ? new McpClient(identity.apiKey) : undefined;
    const bot = {
        name: identity.name,
        keyBase64: identity.keyBase64,
        principal: identity.principal,
        apiKey: identity.apiKey,
        candid,
        mcp,
    };
    allProvisioned.set(identity.name, bot);
    return bot;
}
/**
 * Return a bot identity to the idle pool for reuse.
 */
export function returnToPool(bot) {
    idlePool.push(bot);
    addLog("provisioner", "pool", "success", `${bot.name} returned to idle pool (pool size: ${idlePool.length})`);
}
/**
 * Register an identity in the provisioner's tracking (for persistence).
 * Used for bots loaded from BOT_IDENTITIES that bypass provisionBot().
 */
export function registerIdentity(id) {
    // Only track if not already known
    if (!allProvisioned.has(id.name)) {
        allProvisioned.set(id.name, {
            name: id.name,
            keyBase64: id.keyBase64,
            principal: id.principal,
            apiKey: id.apiKey,
            candid: undefined, // not needed for persistence
            profile: id.profile,
        });
    }
}
/**
 * Load pre-existing identities from BOT_IDENTITIES config.
 * Called once on startup to bootstrap the initial set.
 */
export function loadExistingIdentities() {
    try {
        const parsed = JSON.parse(CONFIG.BOT_IDENTITIES);
        if (!Array.isArray(parsed))
            return [];
        return parsed;
    }
    catch {
        return [];
    }
}
// ─── Stats ──────────────────────────────────────────────────
export function getProvisionerStats() {
    return {
        totalProvisioned: allProvisioned.size,
        idlePoolSize: idlePool.length,
        nextBotIndex,
        persistenceEnabled: isPersistenceEnabled(),
        poolFile: POOL_FILE,
    };
}
// ─── Helpers ────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
