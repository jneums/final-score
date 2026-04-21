import express from "express";
import { CONFIG } from "./config.js";

// ─── Logging ─────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  bot: string;
  action: string;
  result: string;
  message: string;
}

const MAX_LOGS = 500;
const logs: LogEntry[] = [];

export function addLog(bot: string, action: string, result: string, message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    bot,
    action,
    result,
    message,
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  console.log(`[${entry.timestamp}] [${bot}] ${action} → ${result}: ${message}`);
}

// ─── State ───────────────────────────────────────────────────

export let isRunning = false;

// Bot-level running state
const botRunningState: Map<string, boolean> = new Map();

// Stats tracking
const stats = {
  totalOrders: 0,
  totalCancels: 0,
  totalErrors: 0,
  startedAt: null as string | null,
};

// Placeholder for engine start/stop (will be wired in later)
let engineStartFn: (() => Promise<void>) | null = null;
let engineStopFn: (() => Promise<void>) | null = null;
let botStartFn: ((name: string) => Promise<void>) | null = null;
let botStopFn: ((name: string) => Promise<void>) | null = null;

export function registerEngine(fns: {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startBot: (name: string) => Promise<void>;
  stopBot: (name: string) => Promise<void>;
}): void {
  engineStartFn = fns.start;
  engineStopFn = fns.stop;
  botStartFn = fns.startBot;
  botStopFn = fns.stopBot;
}

export function incrementStat(key: "totalOrders" | "totalCancels" | "totalErrors"): void {
  stats[key]++;
}

// ─── Express server ──────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.json({
    service: "final-score-bots",
    status: isRunning ? "running" : "stopped",
    canisterId: CONFIG.CANISTER_ID,
    numBots: CONFIG.NUM_BOTS,
    uptime: stats.startedAt
      ? `${Math.round((Date.now() - new Date(stats.startedAt).getTime()) / 1000)}s`
      : null,
  });
});

// Recent logs
app.get("/logs", (_req, res) => {
  const count = Math.min(parseInt(String(_req.query.count) || "100"), MAX_LOGS);
  res.json(logs.slice(-count));
});

// Filtered logs for one bot
app.get("/logs/:botName", (req, res) => {
  const botName = req.params.botName;
  const count = Math.min(parseInt(String(req.query.count) || "100"), MAX_LOGS);
  const filtered = logs.filter((l) => l.bot === botName).slice(-count);
  res.json(filtered);
});

// Aggregate stats
app.get("/stats", (_req, res) => {
  res.json({
    ...stats,
    isRunning,
    logCount: logs.length,
    botStates: Object.fromEntries(botRunningState),
  });
});

// Start all bots
app.post("/start", async (_req, res) => {
  if (isRunning) {
    res.json({ status: "already_running" });
    return;
  }
  isRunning = true;
  stats.startedAt = new Date().toISOString();
  addLog("system", "start", "ok", "Bot engine started");
  if (engineStartFn) {
    try {
      await engineStartFn();
    } catch (e) {
      addLog("system", "start", "error", String(e));
    }
  }
  res.json({ status: "started" });
});

// Stop all bots
app.post("/stop", async (_req, res) => {
  if (!isRunning) {
    res.json({ status: "already_stopped" });
    return;
  }
  isRunning = false;
  addLog("system", "stop", "ok", "Bot engine stopped");
  if (engineStopFn) {
    try {
      await engineStopFn();
    } catch (e) {
      addLog("system", "stop", "error", String(e));
    }
  }
  res.json({ status: "stopped" });
});

// Start specific bot
app.post("/start/:botName", async (req, res) => {
  const botName = req.params.botName;
  botRunningState.set(botName, true);
  addLog(botName, "start", "ok", "Bot started");
  if (botStartFn) {
    try {
      await botStartFn(botName);
    } catch (e) {
      addLog(botName, "start", "error", String(e));
    }
  }
  res.json({ status: "started", bot: botName });
});

// Stop specific bot
app.post("/stop/:botName", async (req, res) => {
  const botName = req.params.botName;
  botRunningState.set(botName, false);
  addLog(botName, "stop", "ok", "Bot stopped");
  if (botStopFn) {
    try {
      await botStopFn(botName);
    } catch (e) {
      addLog(botName, "stop", "error", String(e));
    }
  }
  res.json({ status: "stopped", bot: botName });
});

// Engine stats endpoint (detailed per-bot stats from engine)
app.get("/engine-stats", async (_req, res) => {
  try {
    const { getStats } = await import("./engine.js");
    res.json(getStats());
  } catch (e) {
    res.json({ error: String(e) });
  }
});

// ─── Start server ────────────────────────────────────────────

app.listen(CONFIG.PORT, async () => {
  console.log(`🤖 Final Score Bot Simulator listening on port ${CONFIG.PORT}`);
  console.log(`   Canister: ${CONFIG.CANISTER_ID}`);
  console.log(`   MCP URL:  ${CONFIG.MCP_URL}`);
  console.log(`   Bots:     ${CONFIG.NUM_BOTS}`);
  addLog("system", "init", "ok", `Server started on port ${CONFIG.PORT}`);

  // Initialize engine (bots won't start until POST /start)
  try {
    const { initEngine } = await import("./engine.js");
    await initEngine();
  } catch (e) {
    addLog("system", "init", "error", `Engine init failed: ${String(e).slice(0, 200)}`);
  }
});
