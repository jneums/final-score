// packages/libs/ic-js/src/api/mcp.api.ts
//
// MCP (Model Context Protocol) client for calling the canister's tool endpoints
// via JSON-RPC over HTTP at the /mcp path.
//
// The canister exposes these MCP tools:
//   account_get_info, account_get_history, markets_list, market_detail,
//   order_place, order_cancel, orders_list, positions_list, sports_list,
//   leaderboard
import { getCanisterId, getHost } from '../config.js';
// --------------------------------------------------------------------------
// Core MCP caller
// --------------------------------------------------------------------------
let _requestId = 0;
/**
 * Calls an MCP tool on the Final Score canister via JSON-RPC over HTTP.
 *
 * @param apiKey  The user's API key for authentication
 * @param toolName  The MCP tool name (e.g. 'markets_list')
 * @param args  Arguments object for the tool
 * @param canisterIdOverride  Optional override for the canister ID
 * @returns Parsed tool result
 */
export async function callMcpTool(apiKey, toolName, args = {}, canisterIdOverride) {
    const canisterId = canisterIdOverride || getCanisterId('FINAL_SCORE');
    const host = getHost();
    // Build the URL — on mainnet it's https://<canisterId>.raw.icp0.io/mcp
    // On local it's http://<host>/api/v2/canister/<canisterId>/call but we
    // use the raw HTTP endpoint instead.
    let url;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
        url = `${host}/?canisterId=${canisterId}`;
    }
    else {
        url = `https://${canisterId}.raw.icp0.io/mcp`;
    }
    const body = {
        jsonrpc: '2.0',
        id: ++_requestId,
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: args,
        },
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`MCP request failed (${response.status}): ${text}`);
    }
    const json = await response.json();
    if (json.error) {
        throw new Error(`MCP tool error [${json.error.code}]: ${json.error.message}`);
    }
    return json.result;
}
/**
 * Helper to parse the text content from an MCP tool result.
 */
function parseResult(result) {
    if (result.isError) {
        const errorText = result.content?.map((c) => c.text).join('\n') || 'Unknown MCP error';
        throw new Error(errorText);
    }
    const text = result.content?.[0]?.text;
    if (!text)
        throw new Error('Empty MCP response');
    return JSON.parse(text);
}
// --------------------------------------------------------------------------
// Typed wrappers for each MCP tool
// --------------------------------------------------------------------------
/**
 * List markets with optional filters.
 */
export async function listMarkets(apiKey, args = {}) {
    const result = await callMcpTool(apiKey, 'markets_list', args);
    return parseResult(result);
}
/**
 * Get detailed info about a specific market.
 */
export async function getMarketDetail(apiKey, marketId) {
    const result = await callMcpTool(apiKey, 'market_detail', {
        market_id: marketId,
    });
    return parseResult(result);
}
/**
 * Place an order on a market.
 */
export async function placeOrder(apiKey, args) {
    const result = await callMcpTool(apiKey, 'order_place', args);
    return parseResult(result);
}
/**
 * Cancel an existing order.
 */
export async function cancelOrder(apiKey, orderId) {
    const result = await callMcpTool(apiKey, 'order_cancel', {
        order_id: orderId,
    });
    return parseResult(result);
}
/**
 * List the user's orders.
 */
export async function listOrders(apiKey, args = {}) {
    const result = await callMcpTool(apiKey, 'orders_list', args);
    return parseResult(result);
}
/**
 * List the user's positions.
 */
export async function listPositions(apiKey, args = {}) {
    const result = await callMcpTool(apiKey, 'positions_list', args);
    return parseResult(result);
}
/**
 * Get account info for the authenticated user.
 */
export async function getAccountInfo(apiKey) {
    const result = await callMcpTool(apiKey, 'account_get_info', {});
    return parseResult(result);
}
/**
 * Get account history (trades, deposits, withdrawals).
 */
export async function getAccountHistory(apiKey, args = {}) {
    const result = await callMcpTool(apiKey, 'account_get_history', args);
    return parseResult(result);
}
/**
 * List available sports.
 */
export async function listSports(apiKey) {
    const result = await callMcpTool(apiKey, 'sports_list', {});
    return parseResult(result);
}
/**
 * Get leaderboard via MCP (alternative to the direct Candid call).
 */
export async function getLeaderboard(apiKey, args = {}) {
    const result = await callMcpTool(apiKey, 'leaderboard', args);
    return parseResult(result);
}
