#!/usr/bin/env tsx
/**
 * Setup script: generates bot identities, funds them, approves tokens, creates API keys.
 *
 * Usage:
 *   export ADMIN_IDENTITY_PEM=$(cat ~/.config/dfx/identity/pp_owner/identity.pem | base64 -w0)
 *   export NUM_BOTS=15
 *   npm run setup > bot-identities.json
 *
 * Progress is logged to stderr; clean JSON is written to stdout.
 */

import { CONFIG } from "./config.js";
import { generateIdentity, loadAdminIdentity } from "./identity.js";
import { AdminClient, TokenClient } from "./candid-client.js";

// ─── Helpers ──────────────────────────────────────────────────

function log(msg: string): void {
  process.stderr.write(`[setup] ${msg}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────

interface BotRecord {
  name: string;
  keyBase64: string;
  principal: string;
  apiKey: string;
}

async function main(): Promise<void> {
  const numBots = CONFIG.NUM_BOTS;
  const faucetCalls = CONFIG.FAUCET_CALLS_PER_BOT;
  const approveAmount = CONFIG.APPROVE_AMOUNT;

  log(`Setting up ${numBots} bots`);
  log(`Faucet calls per bot: ${faucetCalls}`);
  log(`Approve amount: ${approveAmount}`);
  log(`Canister ID: ${CONFIG.CANISTER_ID}`);
  log(`Token ledger: ${CONFIG.TOKEN_LEDGER}`);
  log(`Faucet canister: ${CONFIG.FAUCET_CANISTER}`);

  // 1. Load admin identity
  log("Loading admin identity...");
  const adminIdentity = loadAdminIdentity();
  log(`Admin principal: ${adminIdentity.getPrincipal().toText()}`);

  // 2. Create AdminClient
  log("Creating admin client...");
  const adminClient = await AdminClient.create(adminIdentity);
  await sleep(1000);

  const results: BotRecord[] = [];

  for (let i = 1; i <= numBots; i++) {
    const botName = `bot-${i}`;
    log(`\n━━━ ${botName} (${i}/${numBots}) ━━━`);

    try {
      // 3a. Generate identity
      const gen = generateIdentity();
      log(`  Principal: ${gen.principal}`);

      // 3b. Fund from faucet
      let fundedCount = 0;
      for (let f = 0; f < faucetCalls; f++) {
        try {
          log(`  Faucet call ${f + 1}/${faucetCalls}...`);
          await adminClient.fundFromFaucet(gen.principal);
          fundedCount++;
          await sleep(2500);
        } catch (e) {
          log(`  ⚠ Faucet call ${f + 1} failed: ${String(e).slice(0, 150)}`);
          await sleep(2500);
        }
      }
      log(`  Funded: ${fundedCount}/${faucetCalls} calls succeeded`);

      // 3c. Approve tokens (bot's own identity)
      try {
        log(`  Approving tokens for canister ${CONFIG.CANISTER_ID}...`);
        const tokenClient = await TokenClient.create(gen.identity);
        await sleep(2500);
        await tokenClient.approve(CONFIG.CANISTER_ID, approveAmount);
        log(`  ✓ Approved ${approveAmount} tokens`);
        await sleep(2500);
      } catch (e) {
        log(`  ⚠ Approve failed: ${String(e).slice(0, 150)}`);
        await sleep(2500);
      }

      // 3d. Create API key
      let apiKey = "";
      try {
        log(`  Creating API key...`);
        apiKey = await adminClient.createApiKey(gen.principal, botName, ["all"]);
        log(`  ✓ API key created (${apiKey.slice(0, 20)}...)`);
        await sleep(2500);
      } catch (e) {
        log(`  ⚠ API key creation failed: ${String(e).slice(0, 150)}`);
        await sleep(2500);
      }

      // 3e. Store result
      results.push({
        name: botName,
        keyBase64: gen.pemBase64,
        principal: gen.principal,
        apiKey,
      });

      log(`  ✓ ${botName} setup complete`);
    } catch (e) {
      log(`  ✗ ${botName} failed entirely: ${String(e).slice(0, 200)}`);
    }
  }

  // 4. Output JSON to stdout
  log(`\n━━━ Setup complete: ${results.length}/${numBots} bots created ━━━`);
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
}

main().catch((e) => {
  log(`Fatal error: ${String(e)}`);
  process.exit(1);
});
