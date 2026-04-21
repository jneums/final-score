export const CONFIG = {
  CANISTER_ID: process.env.CANISTER_ID || "ilyol-uqaaa-aaaai-q34kq-cai",
  TOKEN_LEDGER: process.env.TOKEN_LEDGER || "3jkp5-oyaaa-aaaaj-azwqa-cai",
  FAUCET_CANISTER: process.env.FAUCET_CANISTER || "nqoci-rqaaa-aaaap-qp53q-cai",
  IC_HOST: process.env.IC_HOST || "https://icp-api.io",
  MCP_URL: process.env.MCP_URL || `https://${process.env.CANISTER_ID || "ilyol-uqaaa-aaaai-q34kq-cai"}.icp0.io/mcp`,
  ADMIN_IDENTITY_PEM: process.env.ADMIN_IDENTITY_PEM || "",
  BOT_IDENTITIES: process.env.BOT_IDENTITIES || "[]",
  NUM_BOTS: parseInt(process.env.NUM_BOTS || "15"),
  BOT_INTERVAL_MS: parseInt(process.env.BOT_INTERVAL_MS || "30000"),
  FAUCET_CALLS_PER_BOT: parseInt(process.env.FAUCET_CALLS_PER_BOT || "5"),
  APPROVE_AMOUNT: BigInt(process.env.APPROVE_AMOUNT || "100000000000"),
  PORT: parseInt(process.env.PORT || "3001"),
};
