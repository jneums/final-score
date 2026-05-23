#!/usr/bin/env tsx
/**
 * Setup script: generates bot identities, funds them, deposits tokens into Final Score, creates API keys.
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
import { AdminClient, CandidClient } from "./candid-client.js";
// ─── Helpers ──────────────────────────────────────────────────
function log(msg) {
    process.stderr.write(`[setup] ${msg}\n`);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
    const numBots = CONFIG.NUM_BOTS;
    const faucetCalls = CONFIG.FAUCET_CALLS_PER_BOT;
    log(`Setting up ${numBots} bots`);
    log(`Faucet calls per bot: ${faucetCalls}`);
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
    const results = [];
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
                }
                catch (e) {
                    log(`  ⚠ Faucet call ${f + 1} failed: ${String(e).slice(0, 150)}`);
                    await sleep(2500);
                }
            }
            log(`  Funded: ${fundedCount}/${faucetCalls} calls succeeded`);
            // 3c. Deposit funded tokens into the custodial account (bot's own identity)
            try {
                const grossAmount = BigInt(fundedCount) * 1000000000n; // faucet gives ~$10, 8 decimals
                const depositAmount = grossAmount > 20000n ? grossAmount - 20000n : 0n; // leave fees for approve + deposit
                if (depositAmount > 0n) {
                    log(`  Depositing ${depositAmount} token units into Final Score account...`);
                    const candidClient = await CandidClient.create(gen.identity);
                    await sleep(2500);
                    const newBalance = await candidClient.approveAndDeposit(depositAmount);
                    log(`  ✓ Deposited. Account balance: ${newBalance}`);
                    await sleep(2500);
                }
            }
            catch (e) {
                log(`  ⚠ Deposit failed: ${String(e).slice(0, 150)}`);
                await sleep(2500);
            }
            // 3d. Create API key
            let apiKey = "";
            try {
                log(`  Creating API key...`);
                apiKey = await adminClient.createApiKey(gen.principal, botName, ["all"]);
                log(`  ✓ API key created (${apiKey.slice(0, 20)}...)`);
                await sleep(2500);
            }
            catch (e) {
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
        }
        catch (e) {
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
