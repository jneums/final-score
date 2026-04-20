// packages/libs/ic-js/src/api/markets.api.ts

import { type Identity } from '@icp-sdk/core/agent';
import { getFinalScoreActor } from '../actors.js';

export interface MarketCount {
  total: number;
  open: number;
  closed: number;
  resolved: number;
  cancelled: number;
}

export interface PlatformStats {
  totalTrades: number;
  activeMarkets: number;
  totalVolume: number;
  totalUsers: number;
  resolvedMarkets: number;
}

export interface MarketInfo {
  marketId: string;
  question: string;
  eventTitle: string;
  sport: string;
  status: string;
  polymarketSlug: string;
  endDate: bigint;
  totalVolume: bigint;
  lastYesPrice: bigint;
  lastNoPrice: bigint;
}

/**
 * Gets the count of markets by status.
 */
export const getMarketCount = async (): Promise<MarketCount> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_market_count();
  return {
    total: Number(result.total),
    open: Number(result.open),
    closed: Number(result.closed),
    resolved: Number(result.resolved),
    cancelled: Number(result.cancelled),
  };
};

/**
 * Gets platform-wide statistics.
 */
export const getPlatformStats = async (): Promise<PlatformStats> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_platform_stats();
  return {
    totalTrades: Number(result.totalTrades),
    activeMarkets: Number(result.activeMarkets),
    totalVolume: Number(result.totalVolume),
    totalUsers: Number(result.totalUsers),
    resolvedMarkets: Number(result.resolvedMarkets),
  };
};

/**
 * Gets a specific market by ID (debug endpoint).
 * @param marketId The market ID string
 * @returns The market info or null if not found
 */
export const getMarket = async (
  marketId: string,
): Promise<MarketInfo | null> => {
  const actor = await getFinalScoreActor();
  const result = await actor.debug_get_market(marketId);
  if (result.length === 0) return null;
  return result[0] ?? null;
};

export interface MarketListItem {
  marketId: string;
  question: string;
  eventTitle: string;
  sport: string;
  status: string;
  yesPrice: number;
  noPrice: number;
  polymarketSlug: string;
  endDate: bigint;
  totalVolume: bigint;
}

export interface MarketListResult {
  total: number;
  returned: number;
  markets: MarketListItem[];
}

export const queryMarkets = async (
  sportFilter?: string,
  offset: number = 0,
  limit: number = 50,
): Promise<MarketListResult> => {
  const actor = await getFinalScoreActor();
  const result = await actor.debug_list_markets(
    sportFilter ? [sportFilter] : [],
    BigInt(offset),
    BigInt(limit),
  );
  return {
    total: Number(result.total),
    returned: Number(result.returned),
    markets: result.markets.map((m) => ({
      marketId: m.marketId,
      question: m.question,
      eventTitle: m.eventTitle,
      sport: m.sport,
      status: m.status,
      yesPrice: Number(m.yesPrice),
      noPrice: Number(m.noPrice),
      polymarketSlug: m.polymarketSlug,
      endDate: m.endDate,
      totalVolume: m.totalVolume,
    })),
  };
};

// ─── Order Book ──────────────────────────────────────────────────────────────

export interface DepthLevel {
  price: number;       // basis points (100 = $0.01)
  totalSize: number;   // shares at this level
  orderCount: number;
}

export interface OrderBookData {
  yesBids: DepthLevel[];
  noBids: DepthLevel[];
  bestYesBid: number;
  bestNoBid: number;
  impliedYesAsk: number;
  impliedNoAsk: number;
  spread: number;
}

export const getOrderBook = async (
  marketId: string,
  maxLevels: number = 20,
): Promise<OrderBookData> => {
  const actor = await getFinalScoreActor();
  const result = await actor.debug_get_order_book(marketId, BigInt(maxLevels));
  return {
    yesBids: result.yesBids.map((l) => ({
      price: Number(l.price),
      totalSize: Number(l.totalSize),
      orderCount: Number(l.orderCount),
    })),
    noBids: result.noBids.map((l) => ({
      price: Number(l.price),
      totalSize: Number(l.totalSize),
      orderCount: Number(l.orderCount),
    })),
    bestYesBid: Number(result.bestYesBid),
    bestNoBid: Number(result.bestNoBid),
    impliedYesAsk: Number(result.impliedYesAsk),
    impliedNoAsk: Number(result.impliedNoAsk),
    spread: Number(result.spread),
  };
};

// ─── Direct Candid Trading ───────────────────────────────────────────────────

export interface PlaceOrderResult {
  orderId: string;
  status: string;
  filled: number;
  remaining: number;
  fills: { tradeId: string; price: number; size: number }[];
}

export const placeOrderCandid = async (
  identity: Identity,
  marketId: string,
  outcome: string,
  price: number,
  size: number,
): Promise<PlaceOrderResult> => {
  const actor = await getFinalScoreActor(identity);
  const result = await actor.place_order(marketId, outcome, price, BigInt(size));
  if ('err' in result) throw new Error(result.err);
  const ok = result.ok;
  return {
    orderId: ok.orderId,
    status: ok.status,
    filled: Number(ok.filled),
    remaining: Number(ok.remaining),
    fills: ok.fills.map((f) => ({
      tradeId: f.tradeId,
      price: Number(f.price),
      size: Number(f.size),
    })),
  };
};

export const cancelOrderCandid = async (
  identity: Identity,
  orderId: string,
): Promise<string> => {
  const actor = await getFinalScoreActor(identity);
  const result = await actor.cancel_order(orderId);
  if ('err' in result) throw new Error(result.err);
  return result.ok;
};

// ─── User Orders & Positions (Candid queries) ────────────────────────────────

export interface UserOrder {
  orderId: string;
  marketId: string;
  outcome: string;
  price: number;
  size: number;
  filledSize: number;
  status: string;
  timestamp: number;
}

export const getMyOrders = async (
  identity: Identity,
  statusFilter?: string,
  marketFilter?: string,
): Promise<UserOrder[]> => {
  const actor = await getFinalScoreActor(identity);
  const result = await actor.my_orders(
    statusFilter ? [statusFilter] : [],
    marketFilter ? [marketFilter] : [],
  );
  return result.map((o) => ({
    orderId: o.orderId,
    marketId: o.marketId,
    outcome: o.outcome,
    price: Number(o.price),
    size: Number(o.size),
    filledSize: Number(o.filledSize),
    status: o.status,
    timestamp: Number(o.timestamp),
  }));
};

export interface UserPosition {
  positionId: string;
  marketId: string;
  question: string;
  outcome: string;
  shares: number;
  costBasis: number;
  averagePrice: number;
  currentPrice: number;
  marketStatus: string;
}

export const getMyPositions = async (
  identity: Identity,
  marketFilter?: string,
): Promise<UserPosition[]> => {
  const actor = await getFinalScoreActor(identity);
  const result = await actor.my_positions(
    marketFilter ? [marketFilter] : [],
  );
  return result.map((p) => ({
    positionId: p.positionId,
    marketId: p.marketId,
    question: p.question,
    outcome: p.outcome,
    shares: Number(p.shares),
    costBasis: Number(p.costBasis),
    averagePrice: Number(p.averagePrice),
    currentPrice: Number(p.currentPrice),
    marketStatus: p.marketStatus,
  }));
};

// ─── Event Markets ────────────────────────────────────────────────────────────

export const getEventMarkets = async (
  polymarketSlug: string,
): Promise<MarketInfo[]> => {
  const actor = await getFinalScoreActor();
  const result = await actor.get_event_markets(polymarketSlug);
  return result.map((m) => ({
    marketId: m.marketId,
    question: m.question,
    eventTitle: m.eventTitle,
    sport: m.sport,
    status: m.status,
    polymarketSlug: m.polymarketSlug,
    endDate: m.endDate,
    totalVolume: m.totalVolume,
    lastYesPrice: m.lastYesPrice,
    lastNoPrice: m.lastNoPrice,
  }));
};
