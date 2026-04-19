export const CONFIG = {
  // ICP canister
  CANISTER_ID: "ilyol-uqaaa-aaaai-q34kq-cai",
  IC_HOST: "https://ic0.app",

  // DFX identity PEM (base64-encoded in env var)
  DFX_IDENTITY_PEM: process.env.DFX_IDENTITY_PEM || "",

  // Polymarket API
  GAMMA_API: "https://gamma-api.polymarket.com",

  // Sync interval (30 minutes)
  SYNC_INTERVAL: 30 * 60 * 1000,

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
};
