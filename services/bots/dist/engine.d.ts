export declare function initEngine(): Promise<void>;
export declare function startAll(): void;
export declare function stopAll(): void;
export declare function startBot(name: string): void;
export declare function stopBot(name: string): void;
/**
 * Scale the bot army to exactly `targetCount` bots.
 *
 * - If targetCount > current: provision new bots, start them if engine is running.
 * - If targetCount < current: stop and remove excess bots (highest index first),
 *   returning their identities to the pool for reuse.
 * - If targetCount === current: no-op.
 *
 * Returns a summary of what was done.
 */
export declare function scaleTo(targetCount: number, shouldAutoStart: boolean): Promise<{
    before: number;
    after: number;
    added: string[];
    removed: string[];
}>;
export declare function getStats(): Record<string, unknown>;
