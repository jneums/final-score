/**
 * Polymarket WebSocket — real-time price feed.
 *
 * Connects to the public market channel, subscribes to all asset IDs we're
 * quoting, and triggers reactive re-quotes when prices drift beyond threshold.
 *
 * Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * No auth required. Heartbeat: send {} every 10s.
 */
import { CONFIG } from "./config.js";
import { updatePriceFromWs, getAllAssetIds } from "./priceCache.js";
const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
// ─── State ───────────────────────────────────────────────────
let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let subscribedAssets = new Set();
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60_000; // 1 min max backoff
// Callback: fired when a conditionId needs re-quoting
let onRequote = null;
// Callback: fired after WebSocket reconnects (to trigger full maker sweep)
let onReconnect = null;
// ─── Logging ─────────────────────────────────────────────────
const wsLogs = [];
const MAX_LOGS = 200;
function log(action, status, msg) {
    const entry = `[${new Date().toISOString()}] [ws] [${action}] [${status}] ${msg}`;
    console.log(entry);
    wsLogs.push(entry);
    if (wsLogs.length > MAX_LOGS)
        wsLogs.shift();
}
export function getWsLogs() {
    return wsLogs;
}
// ─── Stats ───────────────────────────────────────────────────
let stats = {
    messagesReceived: 0,
    priceUpdates: 0,
    requotesTriggered: 0,
    lastMessageAt: null,
    connectTime: null,
    disconnects: 0,
};
export function getWsStats() {
    return {
        ...stats,
        isConnected,
        subscribedAssets: subscribedAssets.size,
        reconnectAttempts,
    };
}
// ─── Core ────────────────────────────────────────────────────
function handleMessage(data) {
    stats.messagesReceived++;
    stats.lastMessageAt = new Date();
    // Ignore pong responses
    if (data === "PONG" || data === "pong")
        return;
    let event;
    try {
        event = JSON.parse(data);
    }
    catch {
        return; // non-JSON (heartbeat ack, etc.)
    }
    if (event.event_type === "price_change") {
        const pc = event;
        for (const change of pc.price_changes) {
            // Use midpoint of best_bid and best_ask as reference price
            const bestBid = parseFloat(change.best_bid || "0");
            const bestAsk = parseFloat(change.best_ask || "0");
            if (bestBid <= 0 && bestAsk <= 0)
                continue;
            // Use midpoint as reference, or whichever is available
            let refPrice;
            if (bestBid > 0 && bestAsk > 0) {
                refPrice = (bestBid + bestAsk) / 2;
            }
            else {
                refPrice = bestBid > 0 ? bestBid : bestAsk;
            }
            const priceBps = Math.round(refPrice * 10000);
            const result = updatePriceFromWs(change.asset_id, priceBps);
            if (result) {
                stats.priceUpdates++;
                if (result.deltaBps >= CONFIG.MAKER.REFRESH_THRESHOLD_BPS) {
                    stats.requotesTriggered++;
                    log("price", "requote", `${result.conditionId} moved ${result.deltaBps}bps`);
                    onRequote?.(result.conditionId);
                }
            }
        }
    }
    else if (event.event_type === "best_bid_ask") {
        const bba = event;
        const bestBid = parseFloat(bba.best_bid || "0");
        const bestAsk = parseFloat(bba.best_ask || "0");
        if (bestBid <= 0 && bestAsk <= 0)
            return;
        let refPrice;
        if (bestBid > 0 && bestAsk > 0) {
            refPrice = (bestBid + bestAsk) / 2;
        }
        else {
            refPrice = bestBid > 0 ? bestBid : bestAsk;
        }
        const priceBps = Math.round(refPrice * 10000);
        const result = updatePriceFromWs(bba.asset_id, priceBps);
        if (result) {
            stats.priceUpdates++;
            if (result.deltaBps >= CONFIG.MAKER.REFRESH_THRESHOLD_BPS) {
                stats.requotesTriggered++;
                log("price", "requote", `${result.conditionId} moved ${result.deltaBps}bps`);
                onRequote?.(result.conditionId);
            }
        }
    }
}
function startHeartbeat() {
    if (heartbeatTimer)
        clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
        if (ws && isConnected) {
            try {
                ws.send(JSON.stringify({}));
            }
            catch {
                log("heartbeat", "error", "Failed to send ping");
            }
        }
    }, 10_000);
}
function scheduleReconnect() {
    if (reconnectTimer)
        return; // already scheduled
    const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    log("reconnect", "info", `Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}
function sendSubscription(assetIds) {
    if (!ws || !isConnected || assetIds.length === 0)
        return;
    // Polymarket has a limit on subscription message size — batch in chunks
    const BATCH_SIZE = 100;
    for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
        const batch = assetIds.slice(i, i + BATCH_SIZE);
        const msg = i === 0 && subscribedAssets.size === 0
            ? {
                assets_ids: batch,
                type: "market",
                custom_feature_enabled: true,
            }
            : {
                assets_ids: batch,
                operation: "subscribe",
                custom_feature_enabled: true,
            };
        ws.send(JSON.stringify(msg));
    }
    for (const id of assetIds)
        subscribedAssets.add(id);
}
function connect() {
    if (ws) {
        try {
            ws.close();
        }
        catch { }
        ws = null;
    }
    const assetIds = getAllAssetIds();
    if (assetIds.length === 0) {
        log("connect", "skip", "No asset IDs to subscribe to — waiting for sync");
        return;
    }
    log("connect", "info", `Connecting to Polymarket WS with ${assetIds.length} assets...`);
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
        const wasReconnect = stats.disconnects > 0;
        isConnected = true;
        reconnectAttempts = 0;
        stats.connectTime = new Date();
        subscribedAssets.clear();
        log("connect", "success", `Connected — subscribing to ${assetIds.length} assets`);
        sendSubscription(assetIds);
        startHeartbeat();
        // After a reconnect, trigger full maker sweep to catch drift during downtime
        if (wasReconnect && onReconnect) {
            log("connect", "info", "Reconnect detected — triggering maker sweep");
            onReconnect();
        }
    };
    ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : String(event.data);
        handleMessage(data);
    };
    ws.onclose = (event) => {
        isConnected = false;
        stats.disconnects++;
        if (heartbeatTimer)
            clearInterval(heartbeatTimer);
        log("disconnect", "warn", `Closed: code=${event.code} reason=${event.reason || "none"}`);
        scheduleReconnect();
    };
    ws.onerror = (event) => {
        log("error", "error", `WebSocket error: ${String(event)}`);
    };
}
// ─── Public API ──────────────────────────────────────────────
/** Start the WebSocket connection. Call after first sync populates the price cache. */
export function startWs(requoteCallback, reconnectCallback) {
    onRequote = requoteCallback;
    onReconnect = reconnectCallback || null;
    connect();
}
/** Stop the WebSocket connection. */
export function stopWs() {
    onRequote = null;
    onReconnect = null;
    if (heartbeatTimer)
        clearInterval(heartbeatTimer);
    if (reconnectTimer)
        clearTimeout(reconnectTimer);
    if (ws) {
        try {
            ws.close();
        }
        catch { }
        ws = null;
    }
    isConnected = false;
}
/**
 * Subscribe to new asset IDs (e.g., after sync discovers new markets).
 * Sends a dynamic subscribe message without reconnecting.
 * When not connected, assets are silently picked up on next connect via getAllAssetIds().
 */
export function subscribeNewAssets(assetIds) {
    const newIds = assetIds.filter((id) => !subscribedAssets.has(id));
    if (newIds.length === 0)
        return;
    if (isConnected && ws) {
        log("subscribe", "info", `Adding ${newIds.length} new assets`);
        sendSubscription(newIds);
    }
    // else: will be picked up on next connect() via getAllAssetIds()
}
