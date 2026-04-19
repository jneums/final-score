export const CONFIG = {
  // ICP canister
  CANISTER_ID: "ilyol-uqaaa-aaaai-q34kq-cai",
  IC_HOST: "https://ic0.app",

  // DFX identity PEM — admin (base64-encoded in env var)
  DFX_IDENTITY_PEM: process.env.DFX_IDENTITY_PEM || "",

  // DFX identity PEM — market maker (separate identity)
  MAKER_IDENTITY_PEM: process.env.MAKER_IDENTITY_PEM || "",

  // Polymarket API
  GAMMA_API: "https://gamma-api.polymarket.com",

  // Sync interval (30 minutes) — market discovery
  SYNC_INTERVAL: 30 * 60 * 1000,

  // Resolve interval (15 minutes) — check Polymarket for closed markets
  RESOLVE_INTERVAL: 15 * 60 * 1000,

  // Maker interval (5 minutes) — refresh quotes
  MAKER_INTERVAL: 5 * 60 * 1000,

  // Server port
  PORT: process.env.PORT || 3000,

  // Whitelisted sports — keep tight for launch
  WHITELIST: [
    // Football/Soccer — top 5 leagues + UCL
    "epl", "lal", "bun", "fl1", "sea", "ucl",
    // Cricket
    "cricipl", "ipl",
    // US Sports
    "nba", "wnba", "mlb", "nfl", "nhl",
    // Other
    "kbo",
  ],

  // Hardcoded sport → tag_id mapping (from Polymarket /sports API)
  SPORT_TAGS: {
    bun: "1494",
    cricipl: "517",
    epl: "306",
    fl1: "102070",
    ipl: "101977",
    kbo: "102668",
    lal: "780",
    mlb: "100381",
    nba: "745",
    nfl: "450",
    nhl: "899",
    sea: "101962",
    ucl: "100977",
    wnba: "100254",
  } as Record<string, string>,

  // ─── Market Maker Config ──────────────────────────────────
  MAKER: {
    // Spread: each side offset from reference (bps). 200 = 2 cents each side = 4% total spread
    SPREAD_BPS: parseInt(process.env.MAKER_SPREAD_BPS || "200"),

    // Number of price levels per side (Yes + No)
    LEVELS: parseInt(process.env.MAKER_LEVELS || "3"),

    // Shares per order at each level
    SIZE_PER_LEVEL: parseInt(process.env.MAKER_SIZE || "10"),

    // Re-quote if reference price moved more than this from resting order (bps)
    REFRESH_THRESHOLD_BPS: parseInt(process.env.MAKER_REFRESH_THRESHOLD || "100"),

    // Skip markets within this many ms of endDate (1 hour)
    SKIP_NEAR_EXPIRY_MS: 60 * 60 * 1000,

    // Max price age before skipping (2 hours)
    MAX_PRICE_AGE_MS: 2 * 60 * 60 * 1000,

    // Max markets to quote per tick (rate-limit budget)
    MAX_MARKETS_PER_TICK: parseInt(process.env.MAKER_MAX_PER_TICK || "25"),

    // Delay between canister calls (ms) — canister has 2s rate limit
    ORDER_DELAY_MS: 2200,

    // Don't quote if both sides are within this range of 50/50 (no signal)
    MIN_PRICE_EDGE_BPS: 200,  // skip if yesPrice is 4800-5200 (no clear reference)
  },
};
