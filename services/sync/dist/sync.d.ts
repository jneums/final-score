export interface SyncLog {
    timestamp: Date;
    action: string;
    result: "success" | "error" | "skipped";
    message: string;
}
export declare function getLogs(): SyncLog[];
export declare function runSync(): Promise<{
    created: number;
    skipped: number;
    errors: number;
}>;
