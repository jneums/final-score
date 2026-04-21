export declare function addLog(bot: string, action: string, result: string, message: string): void;
export declare let isRunning: boolean;
export declare function registerEngine(fns: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    startBot: (name: string) => Promise<void>;
    stopBot: (name: string) => Promise<void>;
}): void;
export declare function incrementStat(key: "totalOrders" | "totalCancels" | "totalErrors"): void;
