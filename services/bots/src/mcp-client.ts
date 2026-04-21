import { CONFIG } from "./config.js";

let requestId = 1;

interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: Array<{ type: string; text: string }>; [key: string]: unknown };
  error?: { code: number; message: string };
}

async function callTool(
  apiKey: string,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  const body = {
    jsonrpc: "2.0",
    id: requestId++,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const response = await fetch(CONFIG.MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
  }
  const data: McpResponse = await response.json() as McpResponse;
  if (data.error) {
    throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
  }
  const content = data.result?.content;
  if (content && Array.isArray(content)) {
    const textContent = content.find((c) => c.type === "text");
    if (textContent) return textContent.text;
  }
  return JSON.stringify(data.result);
}

export class McpClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async placeOrder(
    marketId: string,
    outcome: string,
    price: string,
    amount: string,
  ): Promise<string> {
    return callTool(this.apiKey, "order_place", {
      market_id: marketId,
      outcome,
      price,
      amount,
    });
  }

  async cancelOrder(orderId: string): Promise<string> {
    return callTool(this.apiKey, "order_cancel", { order_id: orderId });
  }

  async listOrders(status?: string, marketId?: string): Promise<string> {
    const args: Record<string, string> = {};
    if (status) args.status = status;
    if (marketId) args.market_id = marketId;
    return callTool(this.apiKey, "orders_list", args);
  }

  async listPositions(marketId?: string): Promise<string> {
    return callTool(this.apiKey, "positions_list", marketId ? { market_id: marketId } : {});
  }

  async listMarkets(sport?: string, status?: string): Promise<string> {
    const args: Record<string, string> = {};
    if (sport) args.sport = sport;
    if (status) args.status = status;
    return callTool(this.apiKey, "markets_list", args);
  }

  async getAccountInfo(): Promise<string> {
    return callTool(this.apiKey, "account_get_info", {});
  }
}
