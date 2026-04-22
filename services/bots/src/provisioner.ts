/**
 * Bot provisioner — creates new bot identities at runtime.
 *
 * Handles: identity generation, token approval, API key creation,
 * and an identity pool so bots can be re-used after scaling down.
 */

import { generateIdentity, loadIdentityFromPem } from "./identity.js";
import { CandidClient, TokenClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { CONFIG } from "./config.js";
import { addLog } from "./index.js";

// ─── Types ──────────────────────────────────────────────────

export interface ProvisionedBot {
  name: string;
  keyBase64: string;
  principal: string;
  apiKey: string;
  candid: CandidClient;
  mcp?: McpClient;
}

// ─── Identity Pool ──────────────────────────────────────────

/**
 * Pool of provisioned identities that can be reused when scaling
 * down and then back up. Avoids wasting funded identities.
 */
const idlePool: ProvisionedBot[] = [];

/** Track all provisioned identities (for stats) */
const allProvisioned = new Map<string, ProvisionedBot>();

/** Counter for generating sequential bot names */
let nextBotIndex = 0;

export function setNextBotIndex(index: number): void {
  nextBotIndex = index;
}

export function getNextBotIndex(): number {
  return nextBotIndex;
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
export async function provisionBot(
  botName: string,
  needsMcp: boolean,
): Promise<ProvisionedBot> {
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
  } catch (e) {
    addLog("provisioner", "approve", "error", `${botName}: token approval failed: ${String(e).slice(0, 150)}`);
    // Continue anyway — approval can be retried, and the bot can still do read operations
  }

  // Small delay to avoid hammering the IC
  await sleep(1000);

  // 5. Create API key for MCP bots (self-serve — bot creates its own key)
  let apiKey = "";
  if (needsMcp) {
    try {
      apiKey = await candid.createMyApiKey(botName, ["all"]);
      addLog("provisioner", "api-key", "success", `${botName}: API key created (self-serve)`);
    } catch (e) {
      addLog("provisioner", "api-key", "error", `${botName}: API key failed: ${String(e).slice(0, 150)}`);
    }
    await sleep(1000);
  }

  const mcp = needsMcp && apiKey ? new McpClient(apiKey) : undefined;

  const provisioned: ProvisionedBot = {
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
 * Return a bot identity to the idle pool for reuse.
 */
export function returnToPool(bot: ProvisionedBot): void {
  idlePool.push(bot);
  addLog("provisioner", "pool", "success", `${bot.name} returned to idle pool (pool size: ${idlePool.length})`);
}

/**
 * Load pre-existing identities from BOT_IDENTITIES config.
 * Called once on startup to bootstrap the initial set.
 */
export function loadExistingIdentities(): Array<{
  name: string;
  keyBase64: string;
  principal: string;
  apiKey: string;
}> {
  try {
    const parsed = JSON.parse(CONFIG.BOT_IDENTITIES);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

// ─── Stats ──────────────────────────────────────────────────

export function getProvisionerStats(): Record<string, unknown> {
  return {
    totalProvisioned: allProvisioned.size,
    idlePoolSize: idlePool.length,
    nextBotIndex,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
