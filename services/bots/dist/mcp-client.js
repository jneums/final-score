import { CONFIG } from "./config.js";
let requestId = 1;
async function callTool(apiKey, name, args) {
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
    const data = await response.json();
    if (data.error) {
        throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }
    const content = data.result?.content;
    if (content && Array.isArray(content)) {
        const textContent = content.find((c) => c.type === "text");
        if (textContent)
            return textContent.text;
    }
    return JSON.stringify(data.result);
}
export class McpClient {
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async placeOrder(marketId, outcome, price, amount) {
        return callTool(this.apiKey, "order_place", {
            market_id: marketId,
            outcome,
            price: parseFloat(price),
            size: parseInt(amount, 10),
        });
    }
    async cancelOrder(orderId) {
        return callTool(this.apiKey, "order_cancel", { order_id: orderId });
    }
    async listOrders(status, marketId) {
        const args = {};
        if (status)
            args.status = status;
        if (marketId)
            args.market_id = marketId;
        return callTool(this.apiKey, "orders_list", args);
    }
    async listPositions(marketId) {
        return callTool(this.apiKey, "positions_list", marketId ? { market_id: marketId } : {});
    }
    async listMarkets(sport, status) {
        const args = {};
        if (sport)
            args.sport = sport;
        if (status)
            args.status = status;
        return callTool(this.apiKey, "markets_list", args);
    }
    async getAccountInfo() {
        return callTool(this.apiKey, "account_get_info", {});
    }
}
