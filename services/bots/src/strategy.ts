import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet, BudgetProfile } from "./wallet.js";

export interface BotContext {
  name: string;
  candid: CandidClient;
  mcp?: McpClient;
  wallet: BotWallet;
  log: (action: string, result: "success" | "error" | "skip", message: string) => void;
}

export interface Strategy {
  name: string;
  description: string;
  tier: "candid" | "mcp";
  budget: BudgetProfile;
  act: (ctx: BotContext) => Promise<void>;
}
