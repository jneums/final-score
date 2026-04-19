interface ResolveResult {
    resolved: number;
    cancelled: number;
    waiting: number;
    errors: number;
    total: number;
}
export declare function getResolveLogs(): string[];
export declare function runResolve(): Promise<ResolveResult>;
export {};
