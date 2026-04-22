import { CONFIG } from "./config.js";
import { loadIdentityFromPem } from "./identity.js";
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet } from "./wallet.js";
import { assignPersona, generateRandomPersona, shouldTradeThisCycle, isInActiveWindow, pickSport } from "./activity.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { addLog, registerEngine, incrementStat } from "./index.js";
import { provisionBot, returnToPool, loadExistingIdentities, restoreFromDisk, reconstructBot, persistToDisk, registerIdentity, setNextBotIndex, getNextBotIndex, getProvisionerStats, } from "./provisioner.js";
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
// ─── Random Profile Generation ──────────────────────────────
const BUDGET_TIERS = ["low", "medium", "high"];
const BUDGET_WEIGHTS = [0.25, 0.55, 0.20]; // 25% low, 55% medium, 20% high
const DISCIPLINES = ["disciplined", "moderate", "impulsive"];
const DISCIPLINE_WEIGHTS = [0.30, 0.45, 0.25]; // 30% disciplined, 45% moderate, 25% impulsive
function weightedPick(items, weights) {
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < items.length; i++) {
        cum += weights[i];
        if (r < cum)
            return items[i];
    }
    return items[items.length - 1];
}
/**
 * Generate a fully random bot profile for dynamically scaled bots.
 * Picks random strategy, persona, timezone, sport, budget, discipline.
 */
function generateRandomProfile() {
    // Pick a random strategy from the full pool
    const strategy = ALL_STRATEGIES[Math.floor(Math.random() * ALL_STRATEGIES.length)];
    const activity = generateRandomPersona();
    const budgetTier = weightedPick(BUDGET_TIERS, BUDGET_WEIGHTS);
    const discipline = weightedPick(DISCIPLINES, DISCIPLINE_WEIGHTS);
    return {
        strategy: strategy.name,
        persona: activity.persona,
        utcOffset: activity.utcOffset,
        primarySport: activity.primarySport,
        secondarySport: activity.secondarySport,
        primaryBias: activity.primaryBias,
        budgetTier,
        discipline,
    };
}
/**
 * Convert a BotProfile back into the runtime objects needed by the engine.
 */
function profileToRuntime(profile) {
    const strategy = strategyMap.get(profile.strategy) ?? ALL_STRATEGIES[0];
    const activity = {
        persona: profile.persona,
        utcOffset: profile.utcOffset,
        baseActivityRate: 0.15, // Will be overridden below
        primarySport: profile.primarySport,
        secondarySport: profile.secondarySport,
        primaryBias: profile.primaryBias,
    };
    // Set correct base rate for the persona
    const BASE_RATES = {
        "early-bird": 0.15, "nine-to-five": 0.10, "evening": 0.20,
        "night-owl": 0.12, "all-day": 0.08, "weekend-warrior": 0.25,
    };
    activity.baseActivityRate = BASE_RATES[profile.persona] ?? 0.15;
    return {
        strategy,
        activity,
        budgetTier: profile.budgetTier,
        discipline: profile.discipline,
    };
}
/**
 * Build a BotProfile from the hardcoded plans (for original 15 bots).
 */
function buildProfileFromIndex(index) {
    const strategy = getStrategyForIndex(index);
    const activity = assignPersona(index);
    return {
        strategy: strategy.name,
        persona: activity.persona,
        utcOffset: activity.utcOffset,
        primarySport: activity.primarySport,
        secondarySport: activity.secondarySport,
        primaryBias: activity.primaryBias,
        budgetTier: strategy.budget.tier,
        discipline: strategy.budget.discipline,
    };
}
async function runBot(state) {
    if (!state.running)
        return;
    try {
        // 0. Payday check — runs regardless of activity window (you get paid even when sleeping)
        await state.wallet.refreshBalance();
        await state.wallet.runPaydayIfDue(() => state.candid.callFaucet(), (msg) => addLog(state.identity.name, "payday", "success", msg));
        // 0b. Ensure token approval is set (re-approves if allowance runs out)
        if (!state.approved) {
            try {
                await state.candid.approve(CONFIG.CANISTER_ID, CONFIG.APPROVE_AMOUNT);
                state.approved = true;
                addLog(state.identity.name, "approve", "success", "Token approval set");
            }
            catch (e) {
                addLog(state.identity.name, "approve", "error", `Token approval failed: ${String(e).slice(0, 150)}`);
            }
        }
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
                    // Reset approval flag if allowance ran out — will re-approve next cycle
                    if (message.includes("InsufficientAllowance")) {
                        state.approved = false;
                    }
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
 * Create a BotState from an identity + profile. Used for both
 * initial bootstrap and dynamic scaling.
 *
 * If profile is provided, it determines strategy/persona/budget.
 * If not, falls back to index-based derivation (original 15 bots).
 */
async function createBotState(id, index, candid, mcp, profile) {
    let strategy;
    let activity;
    let budgetTier;
    let discipline;
    if (profile) {
        const runtime = profileToRuntime(profile);
        strategy = runtime.strategy;
        activity = runtime.activity;
        budgetTier = runtime.budgetTier;
        discipline = runtime.discipline;
    }
    else {
        strategy = getStrategyForIndex(index);
        activity = assignPersona(index);
        budgetTier = strategy.budget.tier;
        discipline = strategy.budget.discipline;
    }
    if (!candid) {
        const identity = loadIdentityFromPem(id.keyBase64);
        candid = await CandidClient.create(identity);
    }
    if (!mcp && strategy.tier === "mcp" && id.apiKey) {
        mcp = new McpClient(id.apiKey);
    }
    const wallet = new BotWallet(candid, { tier: budgetTier, discipline });
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
        approved: false,
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
        let needsRepersist = false;
        for (const id of restored.identities) {
            // Skip idle identities — they go back to the pool, not as active bots
            if (restored.idleNames.has(id.name))
                continue;
            try {
                const index = parseInt(id.name.replace("bot-", "")) - 1;
                // Backfill profile if missing (bots persisted before profile feature)
                if (!id.profile) {
                    id.profile = index < 15 ? buildProfileFromIndex(index) : generateRandomProfile();
                    needsRepersist = true;
                }
                const strategyName = id.profile.strategy;
                const strategy = (strategyName ? strategyMap.get(strategyName) : undefined) ?? getStrategyForIndex(index);
                const provisioned = await reconstructBot(id, strategy.tier === "mcp");
                const state = await createBotState(id, index, provisioned.candid, provisioned.mcp, id.profile);
                bots.set(id.name, state);
                registerIdentity(id); // Re-register with profile for persistence
                const sportDesc = id.profile.secondarySport
                    ? `${id.profile.primarySport}/${id.profile.secondarySport}`
                    : id.profile.primarySport;
                addLog(id.name, "engine-init", "success", `Restored: ${strategy.name} (${strategy.tier}) | ${state.activity.persona} UTC${state.activity.utcOffset >= 0 ? "+" : ""}${state.activity.utcOffset} | ${sportDesc} | ${id.profile.budgetTier}/${id.profile.discipline}`);
            }
            catch (e) {
                addLog(id.name, "engine-init", "error", `Failed to restore: ${String(e).slice(0, 200)}`);
            }
        }
        // Reconstruct idle pool entries
        for (const id of restored.identities) {
            if (!restored.idleNames.has(id.name))
                continue;
            if (!id.profile) {
                const index = parseInt(id.name.replace("bot-", "")) - 1;
                id.profile = index < 15 ? buildProfileFromIndex(index) : generateRandomProfile();
                needsRepersist = true;
            }
            try {
                const strategy = strategyMap.get(id.profile.strategy) ?? ALL_STRATEGIES[0];
                const provisioned = await reconstructBot(id, strategy.tier === "mcp");
                returnToPool(provisioned);
            }
            catch (e) {
                addLog(id.name, "engine-init", "error", `Failed to restore idle: ${String(e).slice(0, 200)}`);
            }
        }
        setNextBotIndex(restored.nextBotIndex);
        // Re-persist if we backfilled any profiles
        if (needsRepersist) {
            persistToDisk();
            addLog("system", "engine-init", "success", "Backfilled missing profiles and re-persisted");
        }
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
                    const profile = buildProfileFromIndex(i);
                    const state = await createBotState(id, i, undefined, undefined, profile);
                    bots.set(id.name, state);
                    registerIdentity({ ...id, profile }); // Track with profile for persistence
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
                const profile = generateRandomProfile();
                const strategy = strategyMap.get(profile.strategy) ?? ALL_STRATEGIES[0];
                const needsMcp = strategy.tier === "mcp";
                try {
                    const provisioned = await provisionBot(botName, needsMcp);
                    const state = await createBotState({
                        name: provisioned.name,
                        keyBase64: provisioned.keyBase64,
                        principal: provisioned.principal,
                        apiKey: provisioned.apiKey,
                    }, botIndex, provisioned.candid, provisioned.mcp, profile);
                    bots.set(botName, state);
                    setNextBotIndex(botIndex + 1);
                    // Register with profile for persistence
                    registerIdentity({
                        name: provisioned.name,
                        keyBase64: provisioned.keyBase64,
                        principal: provisioned.principal,
                        apiKey: provisioned.apiKey,
                        profile,
                    });
                    if (shouldAutoStart) {
                        startBotState(state);
                    }
                    const sportDesc = profile.secondarySport
                        ? `${profile.primarySport}/${profile.secondarySport}`
                        : profile.primarySport;
                    addLog(botName, "scale", "success", `Added: ${profile.strategy} (${strategy.tier}) | ${profile.persona} UTC${profile.utcOffset >= 0 ? "+" : ""}${profile.utcOffset} | ${sportDesc} | ${profile.budgetTier}/${profile.discipline}`);
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
