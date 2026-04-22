import { CandidClient } from "./candid-client.js";
export declare function sleep(ms: number): Promise<void>;
export declare function getRandomOpenMarket(candid: CandidClient, sport?: string): Promise<{
    marketId: string;
    question: string;
    sport: string;
} | null>;
export declare function getMarketWithLiquidity(candid: CandidClient, sport?: string): Promise<{
    marketId: string;
    yesAsk: number;
    noAsk: number;
} | null>;
export declare function snapPrice(priceBps: number): number;
export declare function bpsToFloat(bps: number): number;
export declare function randomInt(min: number, max: number): number;
export declare function randomChoice<T>(arr: T[]): T;
