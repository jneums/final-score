/**
 * Activity windows — when bots are "awake" and how often they trade.
 *
 * Each bot gets a persona that defines:
 *   - timezone (UTC offset, North American)
 *   - active hours (when they check the app)
 *   - base activity rate (% of 30s cycles they actually trade)
 *   - event proximity boost (trade more when games are soon)
 */
export type PersonaType = "early-bird" | "nine-to-five" | "evening" | "night-owl" | "all-day" | "weekend-warrior";
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
/**
 * How much to boost activity based on how close an event is.
 * Closer events = more checking/trading (like a real fan).
 */
export declare function eventProximityMultiplier(hoursUntilEvent: number): number;
/**
 * Check if a bot is currently in its active window.
 */
export declare function isInActiveWindow(config: ActivityConfig, now?: Date): boolean;
/**
 * Decide if a bot should trade THIS cycle (probabilistic).
 *
 * Combines: base rate × event proximity × random roll.
 * Returns true if the bot should act this cycle.
 */
export declare function shouldTradeThisCycle(config: ActivityConfig, hoursUntilNearestEvent?: number): boolean;
/**
 * Generate an activity config for a bot index.
 * Spreads personas, timezones, and sport interests across the fleet.
 */
export declare function assignPersona(botIndex: number): ActivityConfig;
/**
 * Pick which sport the bot should browse this cycle.
 * Respects primaryBias probability.
 */
export declare function pickSport(config: ActivityConfig): string;
