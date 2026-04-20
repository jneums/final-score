/**
 * Polymarket WebSocket — real-time price feed.
 *
 * Connects to the public market channel, subscribes to all asset IDs we're
 * quoting, and triggers reactive re-quotes when prices drift beyond threshold.
 *
 * Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * No auth required. Heartbeat: send {} every 10s.
 */
export declare function getWsLogs(): string[];
export declare function getWsStats(): {
    isConnected: boolean;
    subscribedAssets: number;
    reconnectAttempts: number;
    messagesReceived: number;
    priceUpdates: number;
    requotesTriggered: number;
    lastMessageAt: Date | null;
    connectTime: Date | null;
    disconnects: number;
};
/** Start the WebSocket connection. Call after first sync populates the price cache. */
export declare function startWs(requoteCallback: (conditionId: string) => void): void;
/** Stop the WebSocket connection. */
export declare function stopWs(): void;
/**
 * Subscribe to new asset IDs (e.g., after sync discovers new markets).
 * Sends a dynamic subscribe message without reconnecting.
 * When not connected, assets are silently picked up on next connect via getAllAssetIds().
 */
export declare function subscribeNewAssets(assetIds: string[]): void;
