import express from "express";
import { CONFIG } from "./config.js";
import { runSync, getLogs } from "./sync.js";

const app = express();

let isRunning = false;
let lastRun: Date | null = null;
let lastResult: { created: number; skipped: number; errors: number } | null = null;
let nextRun: Date | null = null;

async function main() {
  console.log("⚽ Final Score — Polymarket Sync Service");
  console.log("========================================\n");

  if (!CONFIG.DFX_IDENTITY_PEM) {
    console.error("⚠️  DFX_IDENTITY_PEM not set — sync will fail!");
    console.log("   Set DFX_IDENTITY_PEM env var to base64-encoded PEM\n");
  } else {
    console.log("✅ DFX identity configured");
    console.log(`   Canister: ${CONFIG.CANISTER_ID}\n`);
  }

  // Health check
  app.get("/", (_req, res) => {
    res.json({
      service: "final-score-sync",
      status: "running",
      canisterId: CONFIG.CANISTER_ID,
      hasIdentity: !!CONFIG.DFX_IDENTITY_PEM,
      lastRun: lastRun?.toISOString() || null,
      lastResult,
      nextRun: nextRun?.toISOString() || null,
      syncInterval: CONFIG.SYNC_INTERVAL,
      isRunning,
    });
  });

  // Logs
  app.get("/logs", (_req, res) => {
    res.json(getLogs());
  });

  // Manual trigger
  app.post("/run", async (_req, res) => {
    if (!CONFIG.DFX_IDENTITY_PEM) {
      res.status(503).json({ error: "DFX_IDENTITY_PEM not configured" });
      return;
    }
    if (isRunning) {
      res.status(409).json({ error: "Sync already running" });
      return;
    }

    isRunning = true;
    try {
      lastResult = await runSync();
      lastRun = new Date();
      res.json({ success: true, lastRun: lastRun.toISOString(), ...lastResult });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    } finally {
      isRunning = false;
    }
  });

  // Start server
  app.listen(CONFIG.PORT, () => {
    console.log(`🚀 Server on port ${CONFIG.PORT}`);
    console.log(`   Health: http://localhost:${CONFIG.PORT}/`);
    console.log(`   Logs:   http://localhost:${CONFIG.PORT}/logs`);
    console.log(`   Run:    POST http://localhost:${CONFIG.PORT}/run\n`);
  });

  // Start sync loop
  if (CONFIG.DFX_IDENTITY_PEM) {
    const runLoop = async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        lastResult = await runSync();
        lastRun = new Date();
      } catch (e) {
        console.error("Sync error:", e);
      } finally {
        isRunning = false;
        nextRun = new Date(Date.now() + CONFIG.SYNC_INTERVAL);
      }
    };

    // Run immediately on startup
    await runLoop();

    // Then every 30 minutes
    setInterval(runLoop, CONFIG.SYNC_INTERVAL);
    console.log(`⏰ Sync will run every ${CONFIG.SYNC_INTERVAL / 1000 / 60} minutes\n`);
  }
}

main().catch(console.error);
