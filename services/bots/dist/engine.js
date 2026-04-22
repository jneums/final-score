import { CONFIG } from "./config.js";
import { loadIdentityFromPem } from "./identity.js";
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet } from "./wallet.js";
import { assignPersona, shouldTradeThisCycle, isInActiveWindow, pickSport } from "./activity.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { addLog, registerEngine, incrementStat } from "./index.js";
import { provisionBot, returnToPool, loadExistingIdentities, restoreFromDisk, reconstructBot, persistToDisk, setNextBotIndex, getNextBotIndex, getProvisionerStats, } from "./provisioner.js";
// ─── Strategy assignment plan (cyclic for any index) ─────────
const STRATEGY_PLAN = [
    "favorite-buyer", // 0
    "favorite-buyer", // 1
    "underdog-hunter", // 2
    "scalper", // 3
    "scalper", // 4
    "whale", // 5
    "hedger", // 6
    "penny-bidder", // 7
    "portfolio-builder", // 8
    "panic-seller", // 9
    "mcp-casual-bettor", // 10
    "mcp-casual-bettor", // 11
    "mcp-portfolio-viewer", // 12
    "mcp-full-flow", // 13
    "mcp-full-flow", // 14
];
// ─── State ──────────────────────────────────────────────────
const bots = new Map();
const strategyMap = new Map();
for (const s of ALL_STRATEGIES) {
    strategyMap.set(s.name, s);
}
// ─── Helpers ────────────────────────────────────────────────
function getStrategyForIndex(index) {
    const planIndex = index % STRATEGY_PLAN.length;
    const name = STRATEGY_PLAN[planIndex];
    const strategy = strategyMap.get(name);
    if (!strategy) {
        addLog("system", "engine", "error", `Strategy "${name}" not found, falling back to ${ALL_STRATEGIES[0].name}`);
        return ALL_STRATEGIES[0];
    }
    return strategy;
}
async function runBot(state) {
    if (!state.running)
        return;
    try {
        // 0. Payday check — runs regardless of activity window (you get paid even when sleeping)
        await state.wallet.refreshBalance();
        await state.wallet.runPaydayIfDue(() => state.candid.callFaucet(), (msg) => addLog(state.identity.name, "payday", "success", msg));
        // 1. Activity window check — skip if bot is "asleep"
        if (!shouldTradeThisCycle(state.activity)) {
            // Silent skip — don't log every 30s cycle when sleeping.
            // Only log occasionally so we know it's alive.
            state.stats.skippedInactive++;
            if (state.stats.skippedInactive % 100 === 1) {
                const awake = isInActiveWindow(state.activity);
                const reason = awake
                    ? `Active but skipped (probability roll, ${state.activity.persona})`
                    : `Sleeping (${state.activity.persona}, UTC${state.activity.utcOffset >= 0 ? "+" : ""}${state.activity.utcOffset})`;
                addLog(state.identity.name, "activity", "skip", reason);
            }
            state.lastRun = new Date();
            return;
        }
        // 2. Refresh balance (may have changed from payday or other activity)
        await state.wallet.refreshBalance();
        // 3. Budget gate — skip if can't afford anything
        if (!state.wallet.canAfford(0.10)) { // $0.10 minimum order cost
            const w = state.wallet;
            if (w.balanceUsd < 1) {
                addLog(state.identity.name, "budget", "skip", `Broke ($${w.balanceUsd.toFixed(2)}). Day ${w.dayOfPeriod}/14, ${w.daysUntilPayday} days to payday.`);
            }
            else {
                addLog(state.identity.name, "budget", "skip", `Daily budget exhausted ($${w.spentToday.toFixed(2)}/$${w.dailySpendLimit.toFixed(2)}). Remaining this period: $${w.remainingBudget.toFixed(2)}`);
            }
            state.stats.runs++;
            state.lastRun = new Date();
            return;
        }
        // 4. Run the strategy with wallet-aware context
        const sport = pickSport(state.activity);
        const ctx = {
            name: state.identity.name,
            candid: state.candid,
            mcp: state.mcp,
            wallet: state.wallet,
            activity: state.activity,
            sport,
            log: (action, result, message) => {
                addLog(state.identity.name, action, result, message);
                if (result === "error") {
                    state.stats.errors++;
                    incrementStat("totalErrors");
                }
            },
        };
        await state.strategy.act(ctx);
        state.stats.runs++;
    }
    catch (e) {
        addLog(state.identity.name, "engine", "error", String(e).slice(0, 200));
        state.stats.errors++;
        incrementStat("totalErrors");
    }
    state.lastRun = new Date();
}
// ─── Bot Lifecycle ──────────────────────────────────────────
/**
 * Create a BotState from an identity + index. Used for both
 * initial bootstrap and dynamic scaling.
 */
async function createBotState(id, index, candid, mcp) {
    const strategy = getStrategyForIndex(index);
    if (!candid) {
        const identity = loadIdentityFromPem(id.keyBase64);
        candid = await CandidClient.create(identity);
    }
    if (!mcp && strategy.tier === "mcp" && id.apiKey) {
        mcp = new McpClient(id.apiKey);
    }
    const wallet = new BotWallet(candid, strategy.budget);
    const activity = assignPersona(index);
    return {
        identity: id,
        strategy,
        candid,
        mcp,
        wallet,
        activity,
        running: false,
        timer: null,
        lastRun: null,
        stats: { runs: 0, errors: 0, ordersPlaced: 0, skippedInactive: 0 },
        botIndex: index,
    };
}
function startBotState(state) {
    if (state.running)
        return;
    state.running = true;
    runBot(state);
    state.timer = setInterval(() => runBot(state), CONFIG.BOT_INTERVAL_MS);
}
function stopBotState(state) {
    state.running = false;
    if (state.timer) {
        clearInterval(state.timer);
        clearTimeout(state.timer);
        state.timer = null;
    }
}
// ─── Engine API ─────────────────────────────────────────────
export async function initEngine() {
    // 1. Try restoring from encrypted disk first (has all dynamically scaled bots)
    const restored = await restoreFromDisk();
    if (restored && restored.identities.length > 0) {
        addLog("system", "engine-init", "success", `Restoring ${restored.identities.length} bots from encrypted pool (${restored.idleNames.size} idle)...`);
        for (const id of restored.identities) {
            // Skip idle identities — they go back to the pool, not as active bots
            if (restored.idleNames.has(id.name))
                continue;
            try {
                const index = parseInt(id.name.replace("bot-", "")) - 1;
                const strategy = getStrategyForIndex(index);
                const provisioned = await reconstructBot(id, strategy.tier === "mcp");
                const state = await createBotState(id, index, provisioned.candid, provisioned.mcp);
                bots.set(id.name, state);
                addLog(id.name, "engine-init", "success", `Restored: ${strategy.name} (${strategy.tier}) | ${state.activity.persona}`);
            }
            catch (e) {
                addLog(id.name, "engine-init", "error", `Failed to restore: ${String(e).slice(0, 200)}`);
            }
        }
        // Reconstruct idle pool entries
        for (const id of restored.identities) {
            if (!restored.idleNames.has(id.name))
                continue;
            try {
                const strategy = getStrategyForIndex(0); // strategy doesn't matter for idle
                const provisioned = await reconstructBot(id, strategy.tier === "mcp");
                returnToPool(provisioned);
            }
            catch (e) {
                addLog(id.name, "engine-init", "error", `Failed to restore idle: ${String(e).slice(0, 200)}`);
            }
        }
        setNextBotIndex(restored.nextBotIndex);
    }
    else {
        // 2. Fall back to BOT_IDENTITIES env var (original 15)
        const existingIdentities = loadExistingIdentities();
        if (existingIdentities.length === 0) {
            addLog("system", "engine-init", "skip", "No identities found — engine ready for dynamic scaling via /scale");
            setNextBotIndex(0);
        }
        else {
            addLog("system", "engine-init", "success", `Initializing ${existingIdentities.length} bots from BOT_IDENTITIES...`);
            for (let i = 0; i < existingIdentities.length; i++) {
                const id = existingIdentities[i];
                try {
                    const state = await createBotState(id, i);
                    bots.set(id.name, state);
                    addLog(id.name, "engine-init", "success", `${state.strategy.name} (${state.strategy.tier}) | $${state.wallet.paycheck}/14d [${state.strategy.budget.discipline}] | ${state.activity.persona} UTC${state.activity.utcOffset >= 0 ? "+" : ""}${state.activity.utcOffset} (${Math.round(state.activity.baseActivityRate * 100)}% rate)`);
                }
                catch (e) {
                    addLog(id.name, "engine-init", "error", `Failed to init bot: ${String(e).slice(0, 200)}`);
                }
            }
            setNextBotIndex(existingIdentities.length);
        }
        // Persist initial state if persistence is enabled
        persistToDisk();
    }
    registerEngine({
        start: async () => { startAll(); },
        stop: async () => { stopAll(); },
        startBot: async (name) => { startBot(name); },
        stopBot: async (name) => { stopBot(name); },
    });
    addLog("system", "engine-init", "success", `Engine ready with ${bots.size} bots`);
}
export function startAll() {
    const botCount = bots.size;
    if (botCount === 0)
        return;
    const staggerMs = Math.floor(CONFIG.BOT_INTERVAL_MS / botCount);
    let i = 0;
    for (const [, state] of bots) {
        if (state.running) {
            i++;
            continue;
        }
        state.running = true;
        const delay = i * staggerMs;
        const initialTimeout = setTimeout(() => {
            runBot(state);
            state.timer = setInterval(() => runBot(state), CONFIG.BOT_INTERVAL_MS);
        }, delay);
        state.timer = initialTimeout;
        i++;
    }
    addLog("system", "engine", "success", `Started ${botCount} bots (stagger: ${staggerMs}ms)`);
}
export function stopAll() {
    for (const [, state] of bots) {
        stopBotState(state);
    }
    addLog("system", "engine", "success", "All bots stopped");
}
export function startBot(name) {
    const state = bots.get(name);
    if (!state) {
        addLog(name, "engine", "error", "Bot not found");
        return;
    }
    if (state.running)
        return;
    state.running = true;
    runBot(state);
    state.timer = setInterval(() => runBot(state), CONFIG.BOT_INTERVAL_MS);
    addLog(name, "engine", "success", `Bot started with strategy: ${state.strategy.name}`);
}
export function stopBot(name) {
    const state = bots.get(name);
    if (!state) {
        addLog(name, "engine", "error", "Bot not found");
        return;
    }
    stopBotState(state);
    addLog(name, "engine", "success", "Bot stopped");
}
// ─── Dynamic Scaling ────────────────────────────────────────
/**
 * Scale the bot army to exactly `targetCount` bots.
 *
 * - If targetCount > current: provision new bots, start them if engine is running.
 * - If targetCount < current: stop and remove excess bots (highest index first),
 *   returning their identities to the pool for reuse.
 * - If targetCount === current: no-op.
 *
 * Returns a summary of what was done.
 */
export async function scaleTo(targetCount, shouldAutoStart) {
    const currentCount = bots.size;
    const added = [];
    const removed = [];
    if (targetCount === currentCount) {
        return { before: currentCount, after: currentCount, added, removed };
    }
    try {
        if (targetCount > currentCount) {
            // ─── Scale UP ─────────────────────────────────────
            const toAdd = targetCount - currentCount;
            addLog("system", "scale", "success", `Scaling UP: ${currentCount} → ${targetCount} (+${toAdd})`);
            for (let i = 0; i < toAdd; i++) {
                const botIndex = getNextBotIndex();
                const botName = `bot-${botIndex + 1}`;
                const strategy = getStrategyForIndex(botIndex);
                const needsMcp = strategy.tier === "mcp";
                try {
                    const provisioned = await provisionBot(botName, needsMcp);
                    const state = await createBotState({
                        name: provisioned.name,
                        keyBase64: provisioned.keyBase64,
                        principal: provisioned.principal,
                        apiKey: provisioned.apiKey,
                    }, botIndex, provisioned.candid, provisioned.mcp);
                    bots.set(botName, state);
                    setNextBotIndex(botIndex + 1);
                    if (shouldAutoStart) {
                        startBotState(state);
                    }
                    addLog(botName, "scale", "success", `Added: ${strategy.name} (${strategy.tier}) | ${state.activity.persona}`);
                    added.push(botName);
                }
                catch (e) {
                    addLog(botName, "scale", "error", `Failed to provision: ${String(e).slice(0, 200)}`);
                }
            }
        }
        else {
            // ─── Scale DOWN ───────────────────────────────────
            const toRemove = currentCount - targetCount;
            addLog("system", "scale", "success", `Scaling DOWN: ${currentCount} → ${targetCount} (-${toRemove})`);
            // Remove highest-index bots first (LIFO)
            const sortedBots = Array.from(bots.entries())
                .sort((a, b) => b[1].botIndex - a[1].botIndex);
            for (let i = 0; i < toRemove && i < sortedBots.length; i++) {
                const [name, state] = sortedBots[i];
                stopBotState(state);
                // Return identity to pool for reuse
                returnToPool({
                    name: state.identity.name,
                    keyBase64: state.identity.keyBase64,
                    principal: state.identity.principal,
                    apiKey: state.identity.apiKey,
                    candid: state.candid,
                    mcp: state.mcp,
                });
                bots.delete(name);
                addLog(name, "scale", "success", `Removed (returned to pool)`);
                removed.push(name);
            }
        }
        return {
            before: currentCount,
            after: bots.size,
            added,
            removed,
        };
    }
    finally {
        // Always persist after scaling
        persistToDisk();
    }
}
// ─── Stats ──────────────────────────────────────────────────
export function getStats() {
    const botStats = {};
    for (const [name, state] of bots) {
        botStats[name] = {
            strategy: state.strategy.name,
            tier: state.strategy.tier,
            running: state.running,
            lastRun: state.lastRun?.toISOString() ?? null,
            ...state.stats,
            wallet: state.wallet.toJSON(),
            activity: {
                persona: state.activity.persona,
                utcOffset: state.activity.utcOffset,
                baseRate: state.activity.baseActivityRate,
                awake: isInActiveWindow(state.activity),
                primarySport: state.activity.primarySport,
                secondarySport: state.activity.secondarySport,
            },
        };
    }
    return {
        totalBots: bots.size,
        activeBots: Array.from(bots.values()).filter((b) => b.running).length,
        bots: botStats,
        provisioner: getProvisionerStats(),
    };
}
