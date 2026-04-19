import express from "express";
import { CONFIG } from "./config.js";
import { runSync, getLogs } from "./sync.js";
import { runResolve, getResolveLogs } from "./resolve.js";

const app = express();

let isSyncRunning = false;
let isResolveRunning = false;
let lastSync: Date | null = null;
let lastResolve: Date | null = null;
let lastSyncResult: { created: number; skipped: number; errors: number } | null = null;
let lastResolveResult: { resolved: number; cancelled: number; waiting: number; errors: number; total: number } | null = null;
let nextSync: Date | null = null;
let nextResolve: Date | null = null;

async function main() {
  console.log("⚽ Final Score — Polymarket Sync + Resolve Service");
  console.log("===================================================\n");

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
      sync: {
        lastRun: lastSync?.toISOString() || null,
        lastResult: lastSyncResult,
        nextRun: nextSync?.toISOString() || null,
        interval: CONFIG.SYNC_INTERVAL,
        isRunning: isSyncRunning,
      },
      resolve: {
        lastRun: lastResolve?.toISOString() || null,
        lastResult: lastResolveResult,
        nextRun: nextResolve?.toISOString() || null,
        interval: CONFIG.RESOLVE_INTERVAL,
        isRunning: isResolveRunning,
      },
    });
  });

  // Logs — sync
  app.get("/logs", (_req, res) => {
    res.json(getLogs());
  });

  // Logs — resolve
  app.get("/logs/resolve", (_req, res) => {
    res.json(getResolveLogs());
  });

  // Manual trigger — sync
  app.post("/run", async (_req, res) => {
    if (!CONFIG.DFX_IDENTITY_PEM) {
      res.status(503).json({ error: "DFX_IDENTITY_PEM not configured" });
      return;
    }
    if (isSyncRunning) {
      res.status(409).json({ error: "Sync already running" });
      return;
    }

    isSyncRunning = true;
    try {
      lastSyncResult = await runSync();
      lastSync = new Date();
      res.json({ success: true, lastRun: lastSync.toISOString(), ...lastSyncResult });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    } finally {
      isSyncRunning = false;
    }
  });

  // Manual trigger — resolve
  app.post("/resolve", async (_req, res) => {
    if (!CONFIG.DFX_IDENTITY_PEM) {
      res.status(503).json({ error: "DFX_IDENTITY_PEM not configured" });
      return;
    }
    if (isResolveRunning) {
      res.status(409).json({ error: "Resolve already running" });
      return;
    }

    isResolveRunning = true;
    try {
      lastResolveResult = await runResolve();
      lastResolve = new Date();
      res.json({ success: true, lastRun: lastResolve.toISOString(), ...lastResolveResult });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    } finally {
      isResolveRunning = false;
    }
  });

  // Start server
  app.listen(CONFIG.PORT, () => {
    console.log(`🚀 Server on port ${CONFIG.PORT}`);
    console.log(`   Health:  http://localhost:${CONFIG.PORT}/`);
    console.log(`   Logs:    http://localhost:${CONFIG.PORT}/logs`);
    console.log(`   Resolve: http://localhost:${CONFIG.PORT}/logs/resolve`);
    console.log(`   Run:     POST http://localhost:${CONFIG.PORT}/run`);
    console.log(`   Resolve: POST http://localhost:${CONFIG.PORT}/resolve\n`);
  });

  // Start loops
  if (CONFIG.DFX_IDENTITY_PEM) {
    // Sync loop — market discovery
    const syncLoop = async () => {
      if (isSyncRunning) return;
      isSyncRunning = true;
      try {
        lastSyncResult = await runSync();
        lastSync = new Date();
      } catch (e) {
        console.error("Sync error:", e);
      } finally {
        isSyncRunning = false;
        nextSync = new Date(Date.now() + CONFIG.SYNC_INTERVAL);
      }
    };

    // Resolve loop — market resolution
    const resolveLoop = async () => {
      if (isResolveRunning) return;
      isResolveRunning = true;
      try {
        lastResolveResult = await runResolve();
        lastResolve = new Date();
      } catch (e) {
        console.error("Resolve error:", e);
      } finally {
        isResolveRunning = false;
        nextResolve = new Date(Date.now() + CONFIG.RESOLVE_INTERVAL);
      }
    };

    // Run sync immediately on startup
    await syncLoop();

    // Then run resolve
    await resolveLoop();

    // Recurring loops
    setInterval(syncLoop, CONFIG.SYNC_INTERVAL);
    setInterval(resolveLoop, CONFIG.RESOLVE_INTERVAL);
    console.log(`⏰ Sync every ${CONFIG.SYNC_INTERVAL / 1000 / 60}min, Resolve every ${CONFIG.RESOLVE_INTERVAL / 1000 / 60}min\n`);
  }
}

main().catch(console.error);
