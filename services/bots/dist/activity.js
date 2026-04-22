/**
 * Activity windows — when bots are "awake" and how often they trade.
 *
 * Each bot gets a persona that defines:
 *   - timezone (UTC offset, North American)
 *   - active hours (when they check the app)
 *   - base activity rate (% of 30s cycles they actually trade)
 *   - event proximity boost (trade more when games are soon)
 */
// ─── Persona Definitions ────────────────────────────────────
const PERSONA_SCHEDULES = {
    "early-bird": {
        weekday: [{ start: 6, end: 14 }], // 6am-2pm
        weekend: [{ start: 7, end: 15 }], // sleeps in slightly on weekends
    },
    "nine-to-five": {
        weekday: [
            { start: 9, end: 10 }, // morning check
            { start: 12, end: 13 }, // lunch break
            { start: 16, end: 17 }, // end of day
        ],
        weekend: [{ start: 10, end: 14 }], // casual weekend check
    },
    "evening": {
        weekday: [{ start: 17, end: 23 }], // 5pm-11pm
        weekend: [{ start: 12, end: 23 }], // longer on weekends
    },
    "night-owl": {
        weekday: [{ start: 20, end: 27 }], // 8pm-3am (27 = 3am next day)
        weekend: [{ start: 20, end: 28 }], // 8pm-4am weekends
    },
    "all-day": {
        weekday: [{ start: 8, end: 23 }], // 8am-11pm
        weekend: [{ start: 9, end: 23 }], // 9am-11pm
    },
    "weekend-warrior": {
        weekday: [{ start: 18, end: 22 }], // just evenings on workdays
        weekend: [{ start: 9, end: 23 }], // all day weekends
    },
};
// ─── Default activity rates by persona ──────────────────────
const BASE_RATES = {
    "early-bird": 0.15, // trades ~15% of cycles when active (1 in 7 = ~every 3.5 min)
    "nine-to-five": 0.10, // less frequent, short windows
    "evening": 0.20, // dedicated evening session
    "night-owl": 0.12, // slower, more deliberate
    "all-day": 0.08, // spread thin across many hours
    "weekend-warrior": 0.25, // goes hard when available
};
// ─── Event Proximity Multipliers ────────────────────────────
/**
 * How much to boost activity based on how close an event is.
 * Closer events = more checking/trading (like a real fan).
 */
export function eventProximityMultiplier(hoursUntilEvent) {
    if (hoursUntilEvent <= 0)
        return 0.5; // event started/passed — winding down
    if (hoursUntilEvent <= 3)
        return 3.0; // game day, close to tip-off!
    if (hoursUntilEvent <= 24)
        return 2.5; // game day
    if (hoursUntilEvent <= 72)
        return 1.8; // 1-3 days out, getting excited
    if (hoursUntilEvent <= 168)
        return 1.3; // within a week, checking in more
    return 1.0; // >7 days out, base rate
}
// ─── Core Logic ─────────────────────────────────────────────
/**
 * Check if a bot is currently in its active window.
 */
export function isInActiveWindow(config, now) {
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
            if (localHour >= startHour || localHour < endHour)
                return true;
        }
        else {
            // Normal range
            if (localHour >= startHour && localHour < endHour)
                return true;
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
export function shouldTradeThisCycle(config, hoursUntilNearestEvent) {
    // If not in active window, definitely don't trade
    if (!isInActiveWindow(config))
        return false;
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
 * Spreads personas and timezones across the bot fleet.
 */
export function assignPersona(botIndex) {
    // Persona assignment by strategy type (matches engine.ts STRATEGY_PLAN)
    const PERSONA_PLAN = [
        "evening", // bot-1  favorite-buyer — after work bettor
        "early-bird", // bot-2  favorite-buyer — morning bettor
        "night-owl", // bot-3  underdog-hunter — late night degen
        "nine-to-five", // bot-4  scalper — trades on work breaks
        "all-day", // bot-5  scalper — active scalper
        "weekend-warrior", // bot-6  whale — goes hard on weekends
        "nine-to-five", // bot-7  hedger — methodical, work hours
        "night-owl", // bot-8  penny-bidder — late night penny picker
        "evening", // bot-9  portfolio-builder — evening portfolio mgmt
        "all-day", // bot-10 panic-seller — anxious, always checking
        "evening", // bot-11 mcp-casual-bettor — casual evening user
        "early-bird", // bot-12 mcp-casual-bettor — morning user
        "nine-to-five", // bot-13 mcp-portfolio-viewer — checks at work
        "all-day", // bot-14 mcp-full-flow — power user
        "weekend-warrior", // bot-15 mcp-full-flow — weekend deep dives
    ];
    const persona = PERSONA_PLAN[botIndex % PERSONA_PLAN.length];
    const utcOffset = NA_OFFSETS[botIndex % NA_OFFSETS.length];
    const baseActivityRate = BASE_RATES[persona];
    return { persona, utcOffset, baseActivityRate };
}
