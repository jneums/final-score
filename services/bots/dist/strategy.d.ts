import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
export interface BotContext {
    name: string;
    candid: CandidClient;
    mcp?: McpClient;
    log: (action: string, result: "success" | "error" | "skip", message: string) => void;
}
export interface Strategy {
    name: string;
    description: string;
    tier: "candid" | "mcp";
    act: (ctx: BotContext) => Promise<void>;
}
