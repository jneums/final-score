import { CandidClient } from "./candid-client.js";
import { McpClient } from "./mcp-client.js";
import { BotWallet } from "./wallet.js";
import { BudgetProfile } from "./wallet.js";
import { ActivityConfig } from "./activity.js";

export interface BotContext {
  name: string;
  candid: CandidClient;
  mcp?: McpClient;
  wallet: BotWallet;
  activity: ActivityConfig;
  /** Which sport to trade this cycle (from pickSport) */
  sport: string;
  log: (action: string, result: "success" | "error" | "skip", message: string) => void;
}

export interface Strategy {
  name: string;
  description: string;
  tier: "candid" | "mcp";
  budget: BudgetProfile;
  act: (ctx: BotContext) => Promise<void>;
}
