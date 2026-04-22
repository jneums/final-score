import { CONFIG } from "./config.js";
import { loadIdentityFromPem } from "./identity.js";
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet } from "./wallet.js";
import { assignPersona, shouldTradeThisCycle, isInActiveWindow, pickSport } from "./activity.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { addLog, registerEngine, incrementStat } from "./index.js";
// ─── Strategy assignment plan ────────────────────────────────
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
        // 0. Activity window check — skip if bot is "asleep"
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
        // 1. Refresh balance (cached, only hits chain every 5 min)
        await state.wallet.refreshBalance();
        // 2. Payday check — auto-fund from faucet if due
        await state.wallet.runPaydayIfDue(() => state.candid.callFaucet(), (msg) => addLog(state.identity.name, "payday", "success", msg));
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
// ─── Engine API ─────────────────────────────────────────────
export async function initEngine() {
    let identities;
    try {
        identities = JSON.parse(CONFIG.BOT_IDENTITIES);
        if (!Array.isArray(identities) || identities.length === 0) {
            addLog("system", "engine-init", "skip", "BOT_IDENTITIES is empty or invalid — engine not initialized");
            return;
        }
    }
    catch (e) {
        addLog("system", "engine-init", "error", `Failed to parse BOT_IDENTITIES: ${String(e).slice(0, 200)}`);
        return;
    }
    addLog("system", "engine-init", "success", `Initializing ${identities.length} bots...`);
    for (let i = 0; i < identities.length; i++) {
        const id = identities[i];
        const strategy = getStrategyForIndex(i);
        try {
            const identity = loadIdentityFromPem(id.keyBase64);
            const candid = await CandidClient.create(identity);
            let mcp;
            if (strategy.tier === "mcp" && id.apiKey) {
                mcp = new McpClient(id.apiKey);
            }
            // Create wallet with strategy's budget profile
            const wallet = new BotWallet(candid, strategy.budget);
            // Assign activity persona (timezone, active hours, trade frequency)
            const activity = assignPersona(i);
            const state = {
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
            };
            bots.set(id.name, state);
            addLog(id.name, "engine-init", "success", `${strategy.name} (${strategy.tier}) | $${wallet.paycheck}/14d [${strategy.budget.discipline}] | ${activity.persona} UTC${activity.utcOffset >= 0 ? "+" : ""}${activity.utcOffset} (${Math.round(activity.baseActivityRate * 100)}% rate)`);
        }
        catch (e) {
            addLog(id.name, "engine-init", "error", `Failed to init bot: ${String(e).slice(0, 200)}`);
        }
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
function stopBotState(state) {
    state.running = false;
    if (state.timer) {
        clearInterval(state.timer);
        clearTimeout(state.timer);
        state.timer = null;
    }
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
    };
}
