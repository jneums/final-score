import { CONFIG } from "./config.js";
import { loadIdentityFromPem } from "./identity.js";
import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotContext, Strategy } from "./strategy.js";
import { ALL_STRATEGIES } from "./strategies/index.js";
import { addLog, registerEngine, incrementStat } from "./index.js";

// ─── Strategy assignment plan ────────────────────────────────

// Maps bot index → strategy name for the first 15 bots.
// If fewer bots, assign what we have. If more, cycle through.
const STRATEGY_PLAN: string[] = [
  "favorite-buyer",    // 0
  "favorite-buyer",    // 1
  "underdog-hunter",   // 2
  "scalper",           // 3
  "scalper",           // 4
  "whale",             // 5
  "hedger",            // 6
  "penny-bidder",      // 7
  "portfolio-builder", // 8
  "panic-seller",      // 9
  "mcp-casual-bettor", // 10
  "mcp-casual-bettor", // 11
  "mcp-portfolio-viewer", // 12
  "mcp-full-flow",     // 13
  "mcp-full-flow",     // 14
];

// ─── Types ──────────────────────────────────────────────────

interface BotIdentity {
  name: string;
  keyBase64: string;
  principal: string;
  apiKey: string;
}

interface BotState {
  identity: BotIdentity;
  strategy: Strategy;
  candid: CandidClient;
  mcp?: McpClient;
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
  lastRun: Date | null;
  stats: { runs: number; errors: number; ordersPlaced: number };
}

// ─── State ──────────────────────────────────────────────────

const bots = new Map<string, BotState>();

// Build a map from strategy name → Strategy object
const strategyMap = new Map<string, Strategy>();
for (const s of ALL_STRATEGIES) {
  strategyMap.set(s.name, s);
}

// ─── Helpers ────────────────────────────────────────────────

function getStrategyForIndex(index: number): Strategy {
  const planIndex = index % STRATEGY_PLAN.length;
  const name = STRATEGY_PLAN[planIndex];
  const strategy = strategyMap.get(name);
  if (!strategy) {
    // Fallback to first available strategy
    addLog("system", "engine", "error", `Strategy "${name}" not found, falling back to ${ALL_STRATEGIES[0].name}`);
    return ALL_STRATEGIES[0];
  }
  return strategy;
}

async function runBot(state: BotState): Promise<void> {
  if (!state.running) return;

  const ctx: BotContext = {
    name: state.identity.name,
    candid: state.candid,
    mcp: state.mcp,
    log: (action: string, result: "success" | "error" | "skip", message: string) => {
      addLog(state.identity.name, action, result, message);
      if (result === "error") {
        state.stats.errors++;
        incrementStat("totalErrors");
      }
    },
  };

  try {
    await state.strategy.act(ctx);
    state.stats.runs++;
  } catch (e) {
    addLog(state.identity.name, "engine", "error", String(e).slice(0, 200));
    state.stats.errors++;
    incrementStat("totalErrors");
  }
  state.lastRun = new Date();
}

// ─── Engine API ─────────────────────────────────────────────

export async function initEngine(): Promise<void> {
  // Parse BOT_IDENTITIES
  let identities: BotIdentity[];
  try {
    identities = JSON.parse(CONFIG.BOT_IDENTITIES);
    if (!Array.isArray(identities) || identities.length === 0) {
      addLog("system", "engine-init", "skip", "BOT_IDENTITIES is empty or invalid — engine not initialized");
      return;
    }
  } catch (e) {
    addLog("system", "engine-init", "error", `Failed to parse BOT_IDENTITIES: ${String(e).slice(0, 200)}`);
    return;
  }

  addLog("system", "engine-init", "success", `Initializing ${identities.length} bots...`);

  for (let i = 0; i < identities.length; i++) {
    const id = identities[i];
    const strategy = getStrategyForIndex(i);

    try {
      // Load identity and create clients
      const identity = loadIdentityFromPem(id.keyBase64);
      const candid = await CandidClient.create(identity);

      // Create MCP client only for MCP-tier strategies
      let mcp: McpClient | undefined;
      if (strategy.tier === "mcp" && id.apiKey) {
        mcp = new McpClient(id.apiKey);
      }

      const state: BotState = {
        identity: id,
        strategy,
        candid,
        mcp,
        running: false,
        timer: null,
        lastRun: null,
        stats: { runs: 0, errors: 0, ordersPlaced: 0 },
      };

      bots.set(id.name, state);
      addLog(id.name, "engine-init", "success", `Assigned strategy: ${strategy.name} (${strategy.tier})`);
    } catch (e) {
      addLog(id.name, "engine-init", "error", `Failed to init bot: ${String(e).slice(0, 200)}`);
    }
  }

  // Register engine callbacks with Express server
  registerEngine({
    start: async () => { startAll(); },
    stop: async () => { stopAll(); },
    startBot: async (name: string) => { startBot(name); },
    stopBot: async (name: string) => { stopBot(name); },
  });

  addLog("system", "engine-init", "success", `Engine ready with ${bots.size} bots`);
}

export function startAll(): void {
  const botCount = bots.size;
  if (botCount === 0) return;

  const staggerMs = Math.floor(CONFIG.BOT_INTERVAL_MS / botCount);
  let i = 0;

  for (const [, state] of bots) {
    if (state.running) {
      i++;
      continue;
    }
    state.running = true;
    const delay = i * staggerMs;

    // Initial staggered run, then interval
    const initialTimeout = setTimeout(() => {
      runBot(state);
      state.timer = setInterval(() => runBot(state), CONFIG.BOT_INTERVAL_MS);
    }, delay);

    // Store the initial timeout so we can clear it on stop
    // We'll use a trick: store the interval timer; clear both on stop
    state.timer = initialTimeout as unknown as ReturnType<typeof setInterval>;
    i++;
  }

  addLog("system", "engine", "success", `Started ${botCount} bots (stagger: ${staggerMs}ms)`);
}

export function stopAll(): void {
  for (const [, state] of bots) {
    stopBotState(state);
  }
  addLog("system", "engine", "success", "All bots stopped");
}

function stopBotState(state: BotState): void {
  state.running = false;
  if (state.timer) {
    clearInterval(state.timer);
    clearTimeout(state.timer);
    state.timer = null;
  }
}

export function startBot(name: string): void {
  const state = bots.get(name);
  if (!state) {
    addLog(name, "engine", "error", "Bot not found");
    return;
  }
  if (state.running) return;

  state.running = true;
  runBot(state);
  state.timer = setInterval(() => runBot(state), CONFIG.BOT_INTERVAL_MS);
  addLog(name, "engine", "success", `Bot started with strategy: ${state.strategy.name}`);
}

export function stopBot(name: string): void {
  const state = bots.get(name);
  if (!state) {
    addLog(name, "engine", "error", "Bot not found");
    return;
  }
  stopBotState(state);
  addLog(name, "engine", "success", "Bot stopped");
}

export function getStats(): Record<string, unknown> {
  const botStats: Record<string, unknown> = {};
  for (const [name, state] of bots) {
    botStats[name] = {
      strategy: state.strategy.name,
      tier: state.strategy.tier,
      running: state.running,
      lastRun: state.lastRun?.toISOString() ?? null,
      ...state.stats,
    };
  }
  return {
    totalBots: bots.size,
    activeBots: Array.from(bots.values()).filter((b) => b.running).length,
    bots: botStats,
  };
}
