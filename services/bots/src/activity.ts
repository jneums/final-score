/**
 * Activity windows — when bots are "awake" and how often they trade.
 *
 * Each bot gets a persona that defines:
 *   - timezone (UTC offset, North American)
 *   - active hours (when they check the app)
 *   - base activity rate (% of 30s cycles they actually trade)
 *   - event proximity boost (trade more when games are soon)
 */

// ─── Types ──────────────────────────────────────────────────

export type PersonaType =
  | "early-bird"       // 6am-2pm ET — morning trader, checks before work
  | "nine-to-five"     // 9am-5pm ET — trades on breaks during work
  | "evening"          // 5pm-11pm ET — after-work session
  | "night-owl"        // 8pm-3am ET — late night degen
  | "all-day"          // 8am-11pm ET — heavy user, multiple sessions
  | "weekend-warrior"; // evenings weekdays, all day weekends

export interface ActivityConfig {
  persona: PersonaType;
  /** UTC offset for the bot's "home" timezone (e.g. -5 for ET, -8 for PT) */
  utcOffset: number;
  /** Base probability of trading on any given 30s cycle (0.0-1.0) */
  baseActivityRate: number;
  /** Primary sport interest — bot mostly trades this sport */
  primarySport: string;
  /** Secondary sport — occasionally browses (null = primary only) */
  secondarySport: string | null;
  /** Probability of trading primary vs secondary (0.0-1.0, e.g. 0.8 = 80% primary) */
  primaryBias: number;
}

interface HourRange {
  start: number; // 0-23
  end: number;   // 0-23, can wrap past midnight
}

// ─── Persona Definitions ────────────────────────────────────

const PERSONA_SCHEDULES: Record<PersonaType, {
  weekday: HourRange[];
  weekend: HourRange[];
}> = {
  "early-bird": {
    weekday: [{ start: 6, end: 14 }],         // 6am-2pm
    weekend: [{ start: 7, end: 15 }],          // sleeps in slightly on weekends
  },
  "nine-to-five": {
    weekday: [
      { start: 9, end: 10 },                   // morning check
      { start: 12, end: 13 },                  // lunch break
      { start: 16, end: 17 },                  // end of day
    ],
    weekend: [{ start: 10, end: 14 }],          // casual weekend check
  },
  "evening": {
    weekday: [{ start: 17, end: 23 }],          // 5pm-11pm
    weekend: [{ start: 12, end: 23 }],          // longer on weekends
  },
  "night-owl": {
    weekday: [{ start: 20, end: 27 }],          // 8pm-3am (27 = 3am next day)
    weekend: [{ start: 20, end: 28 }],          // 8pm-4am weekends
  },
  "all-day": {
    weekday: [{ start: 8, end: 23 }],           // 8am-11pm
    weekend: [{ start: 9, end: 23 }],           // 9am-11pm
  },
  "weekend-warrior": {
    weekday: [{ start: 18, end: 22 }],          // just evenings on workdays
    weekend: [{ start: 9, end: 23 }],           // all day weekends
  },
};

// ─── Default activity rates by persona ──────────────────────

const BASE_RATES: Record<PersonaType, number> = {
  "early-bird":       0.15,   // trades ~15% of cycles when active (1 in 7 = ~every 3.5 min)
  "nine-to-five":     0.10,   // less frequent, short windows
  "evening":          0.20,   // dedicated evening session
  "night-owl":        0.12,   // slower, more deliberate
  "all-day":          0.08,   // spread thin across many hours
  "weekend-warrior":  0.25,   // goes hard when available
};

// ─── Event Proximity Multipliers ────────────────────────────

/**
 * How much to boost activity based on how close an event is.
 * Closer events = more checking/trading (like a real fan).
 */
export function eventProximityMultiplier(hoursUntilEvent: number): number {
  if (hoursUntilEvent <= 0) return 0.5;      // event started/passed — winding down
  if (hoursUntilEvent <= 3) return 3.0;       // game day, close to tip-off!
  if (hoursUntilEvent <= 24) return 2.5;      // game day
  if (hoursUntilEvent <= 72) return 1.8;      // 1-3 days out, getting excited
  if (hoursUntilEvent <= 168) return 1.3;     // within a week, checking in more
  return 1.0;                                  // >7 days out, base rate
}

// ─── Core Logic ─────────────────────────────────────────────

/**
 * Check if a bot is currently in its active window.
 */
export function isInActiveWindow(config: ActivityConfig, now?: Date): boolean {
  const d = now ?? new Date();
  // Get local hour for the bot's timezone
  const utcHour = d.getUTCHours();
  const localHour = (utcHour + config.utcOffset + 24) % 24;
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const schedule = PERSONA_SCHEDULES[config.persona];
  const ranges = isWeekend ? schedule.weekend : schedule.weekday;

  for (const range of ranges) {
    // Handle wrapping past midnight (e.g. 20-27 means 8pm-3am)
    const startHour = range.start % 24;
    const endHour = range.end % 24;

    if (range.end > 24) {
      // Wraps past midnight: active if hour >= start OR hour < endHour
      if (localHour >= startHour || localHour < endHour) return true;
    } else {
      // Normal range
      if (localHour >= startHour && localHour < endHour) return true;
    }
  }

  return false;
}

/**
 * Decide if a bot should trade THIS cycle (probabilistic).
 *
 * Combines: base rate × event proximity × random roll.
 * Returns true if the bot should act this cycle.
 */
export function shouldTradeThisCycle(
  config: ActivityConfig,
  hoursUntilNearestEvent?: number,
): boolean {
  // If not in active window, definitely don't trade
  if (!isInActiveWindow(config)) return false;

  let rate = config.baseActivityRate;

  // Boost for event proximity
  if (hoursUntilNearestEvent !== undefined) {
    rate *= eventProximityMultiplier(hoursUntilNearestEvent);
  }

  // Cap at 80% — never trade EVERY cycle, even game day
  rate = Math.min(rate, 0.80);

  return Math.random() < rate;
}

// ─── Persona Assignment ─────────────────────────────────────

/** North American UTC offsets: ET=-5, CT=-6, MT=-7, PT=-8 */
const NA_OFFSETS = [-5, -5, -5, -6, -6, -7, -8, -8];

/**
 * Generate an activity config for a bot index.
 * Spreads personas, timezones, and sport interests across the fleet.
 */
export function assignPersona(botIndex: number): ActivityConfig {
  // Persona assignment by strategy type (matches engine.ts STRATEGY_PLAN)
  const PERSONA_PLAN: PersonaType[] = [
    "evening",          // bot-1  favorite-buyer — after work bettor
    "early-bird",       // bot-2  favorite-buyer — morning bettor
    "night-owl",        // bot-3  underdog-hunter — late night degen
    "nine-to-five",     // bot-4  scalper — trades on work breaks
    "all-day",          // bot-5  scalper — active scalper
    "weekend-warrior",  // bot-6  whale — goes hard on weekends
    "nine-to-five",     // bot-7  hedger — methodical, work hours
    "night-owl",        // bot-8  penny-bidder — late night penny picker
    "evening",          // bot-9  portfolio-builder — evening portfolio mgmt
    "all-day",          // bot-10 panic-seller — anxious, always checking
    "evening",          // bot-11 mcp-casual-bettor — casual evening user
    "early-bird",       // bot-12 mcp-casual-bettor — morning user
    "nine-to-five",     // bot-13 mcp-portfolio-viewer — checks at work
    "all-day",          // bot-14 mcp-full-flow — power user
    "weekend-warrior",  // bot-15 mcp-full-flow — weekend deep dives
  ];

  // Sport interest per bot — designed for natural coverage with realistic fan profiles.
  // Available sports: nba, nhl, mlb, cricipl, epl, lal, sea, fl1, bun, ucl
  // primaryBias: 1.0 = single-sport fan, 0.7 = follows one closely but browses another
  const SPORT_PLAN: { primary: string; secondary: string | null; bias: number }[] = [
    { primary: "nba",     secondary: "nhl",     bias: 0.75 }, // bot-1  basketball fan, catches some hockey
    { primary: "mlb",     secondary: null,       bias: 1.0  }, // bot-2  baseball purist
    { primary: "nhl",     secondary: "nba",      bias: 0.70 }, // bot-3  hockey degen, dabbles basketball
    { primary: "epl",     secondary: "ucl",      bias: 0.80 }, // bot-4  Premier League scalper, UCL when available
    { primary: "cricipl", secondary: null,        bias: 1.0  }, // bot-5  cricket IPL devotee
    { primary: "nba",     secondary: "epl",      bias: 0.60 }, // bot-6  whale: NBA + follows EPL
    { primary: "lal",     secondary: "sea",      bias: 0.70 }, // bot-7  La Liga head, watches Serie A
    { primary: "mlb",     secondary: "nba",      bias: 0.65 }, // bot-8  penny bids across baseball + NBA
    { primary: "nba",     secondary: "mlb",      bias: 0.70 }, // bot-9  portfolio across NBA + baseball
    { primary: "epl",     secondary: "bun",      bias: 0.70 }, // bot-10 EPL panic-seller, stress-bets Bundesliga
    { primary: "cricipl", secondary: "nba",      bias: 0.80 }, // bot-11 MCP cricket casual, catches NBA highlights
    { primary: "bun",     secondary: "fl1",      bias: 0.75 }, // bot-12 MCP Bundesliga morning bettor, French league
    { primary: "mlb",     secondary: "cricipl",  bias: 0.70 }, // bot-13 MCP portfolio viewer, MLB + cricket
    { primary: "fl1",     secondary: "sea",      bias: 0.75 }, // bot-14 MCP full-flow Ligue 1, Serie A
    { primary: "nhl",     secondary: "mlb",      bias: 0.70 }, // bot-15 MCP full-flow hockey weekend warrior
  ];

  const persona = PERSONA_PLAN[botIndex % PERSONA_PLAN.length];
  const utcOffset = NA_OFFSETS[botIndex % NA_OFFSETS.length];
  const baseActivityRate = BASE_RATES[persona];
  const sport = SPORT_PLAN[botIndex % SPORT_PLAN.length];

  return {
    persona,
    utcOffset,
    baseActivityRate,
    primarySport: sport.primary,
    secondarySport: sport.secondary,
    primaryBias: sport.bias,
  };
}

/**
 * Pick which sport the bot should browse this cycle.
 * Respects primaryBias probability.
 */
export function pickSport(config: ActivityConfig): string {
  if (!config.secondarySport || Math.random() < config.primaryBias) {
    return config.primarySport;
  }
  return config.secondarySport;
}

// ─── Random Profile Generator ────────────────────────────────

/** All available sports for random assignment */
const ALL_SPORTS = ["nba", "nhl", "mlb", "cricipl", "epl", "lal", "sea", "fl1", "bun", "ucl"];

/** All persona types */
const ALL_PERSONAS: PersonaType[] = [
  "early-bird", "nine-to-five", "evening", "night-owl", "all-day", "weekend-warrior",
];

/** UTC offsets spread across North American timezones + some international */
const ALL_OFFSETS = [-5, -5, -6, -6, -7, -8, -8, 0, 1, 5.5, 8, 10]; // ET, CT, MT, PT, GMT, CET, IST, SGT, AEST

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a randomized activity config for a dynamically scaled bot.
 * Every bot gets a unique combination of persona, timezone, and sport interests.
 */
export function generateRandomPersona(): ActivityConfig {
  const persona = pickRandom(ALL_PERSONAS);
  const utcOffset = pickRandom(ALL_OFFSETS);
  const baseActivityRate = BASE_RATES[persona];

  // Pick primary sport, then optionally a different secondary
  const primarySport = pickRandom(ALL_SPORTS);
  const hasSecondary = Math.random() < 0.7; // 70% of bots follow 2 sports
  let secondarySport: string | null = null;
  if (hasSecondary) {
    const others = ALL_SPORTS.filter((s) => s !== primarySport);
    secondarySport = pickRandom(others);
  }

  // Bias: single-sport fans get 1.0, dual-sport between 0.6-0.85
  const primaryBias = secondarySport
    ? 0.6 + Math.random() * 0.25 // 0.60-0.85
    : 1.0;

  return {
    persona,
    utcOffset,
    baseActivityRate,
    primarySport,
    secondarySport,
    primaryBias,
  };
}
