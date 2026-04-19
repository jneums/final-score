import express from "express";
import { CONFIG } from "./config.js";
import { runSync, getLogs } from "./sync.js";
import { runResolve, getResolveLogs } from "./resolve.js";
import { runMaker, getMakerLogs } from "./maker.js";

const app = express();

let isSyncRunning = false;
let isResolveRunning = false;
let isMakerRunning = false;
let lastSync: Date | null = null;
let lastResolve: Date | null = null;
let lastMaker: Date | null = null;
let lastSyncResult: { created: number; skipped: number; errors: number } | null = null;
let lastResolveResult: { resolved: number; cancelled: number; waiting: number; errors: number; total: number } | null = null;
let lastMakerResult: {
  marketsChecked: number; marketsQuoted: number; marketsSkipped: number;
  ordersPlaced: number; ordersCancelled: number; ordersKept: number;
  errors: number; cursor: string;
} | null = null;
let nextSync: Date | null = null;
let nextResolve: Date | null = null;
let nextMaker: Date | null = null;

async function main() {
  console.log("⚽ Final Score — Polymarket Sync + Resolve + Market Maker");
  console.log("==========================================================\n");

  if (!CONFIG.DFX_IDENTITY_PEM) {
    console.error("⚠️  DFX_IDENTITY_PEM not set — sync/resolve will fail!");
    console.log("   Set DFX_IDENTITY_PEM env var to base64-encoded PEM\n");
  } else {
    console.log("✅ Admin identity configured");
    console.log(`   Canister: ${CONFIG.CANISTER_ID}\n`);
  }

  if (!CONFIG.MAKER_IDENTITY_PEM) {
    console.warn("⚠️  MAKER_IDENTITY_PEM not set — market maker will be disabled");
    console.log("   Set MAKER_IDENTITY_PEM env var to base64-encoded PEM\n");
  } else {
    console.log("✅ Maker identity configured");
    console.log(`   Spread: ${CONFIG.MAKER.SPREAD_BPS} bps, Levels: ${CONFIG.MAKER.LEVELS}, Size: ${CONFIG.MAKER.SIZE_PER_LEVEL}\n`);
  }

  // Health check
  app.get("/", (_req, res) => {
    res.json({
      service: "final-score-sync",
      status: "running",
      canisterId: CONFIG.CANISTER_ID,
      hasAdminIdentity: !!CONFIG.DFX_IDENTITY_PEM,
      hasMakerIdentity: !!CONFIG.MAKER_IDENTITY_PEM,
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
      maker: {
        lastRun: lastMaker?.toISOString() || null,
        lastResult: lastMakerResult,
        nextRun: nextMaker?.toISOString() || null,
        interval: CONFIG.MAKER_INTERVAL,
        isRunning: isMakerRunning,
        config: CONFIG.MAKER,
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

  // Logs — maker
  app.get("/logs/maker", (_req, res) => {
    res.json(getMakerLogs());
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

  // Manual trigger — maker
  app.post("/maker", async (_req, res) => {
    if (!CONFIG.MAKER_IDENTITY_PEM) {
      res.status(503).json({ error: "MAKER_IDENTITY_PEM not configured" });
      return;
    }
    if (isMakerRunning) {
      res.status(409).json({ error: "Maker already running" });
      return;
    }

    isMakerRunning = true;
    try {
      lastMakerResult = await runMaker();
      lastMaker = new Date();
      res.json({ success: true, lastRun: lastMaker.toISOString(), ...lastMakerResult });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    } finally {
      isMakerRunning = false;
    }
  });

  // Start server
  app.listen(CONFIG.PORT, () => {
    console.log(`🚀 Server on port ${CONFIG.PORT}`);
    console.log(`   Health:  http://localhost:${CONFIG.PORT}/`);
    console.log(`   Logs:    http://localhost:${CONFIG.PORT}/logs`);
    console.log(`   Resolve: http://localhost:${CONFIG.PORT}/logs/resolve`);
    console.log(`   Maker:   http://localhost:${CONFIG.PORT}/logs/maker`);
    console.log(`   Run:     POST http://localhost:${CONFIG.PORT}/run`);
    console.log(`   Resolve: POST http://localhost:${CONFIG.PORT}/resolve`);
    console.log(`   Maker:   POST http://localhost:${CONFIG.PORT}/maker\n`);
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
    console.log(`⏰ Sync every ${CONFIG.SYNC_INTERVAL / 1000 / 60}min, Resolve every ${CONFIG.RESOLVE_INTERVAL / 1000 / 60}min`);
  }

  // Maker loop — separate identity, separate guard
  if (CONFIG.MAKER_IDENTITY_PEM) {
    const makerLoop = async () => {
      if (isMakerRunning) return;
      isMakerRunning = true;
      try {
        lastMakerResult = await runMaker();
        lastMaker = new Date();
      } catch (e) {
        console.error("Maker error:", e);
      } finally {
        isMakerRunning = false;
        nextMaker = new Date(Date.now() + CONFIG.MAKER_INTERVAL);
      }
    };

    // Run maker after initial sync (so price cache is populated)
    await makerLoop();

    setInterval(makerLoop, CONFIG.MAKER_INTERVAL);
    console.log(`🏦 Maker every ${CONFIG.MAKER_INTERVAL / 1000 / 60}min (spread=${CONFIG.MAKER.SPREAD_BPS}bps, levels=${CONFIG.MAKER.LEVELS}, size=${CONFIG.MAKER.SIZE_PER_LEVEL})\n`);
  }
}

main().catch(console.error);
