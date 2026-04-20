/**
 * Price cache — stores Polymarket reference prices for market making.
 * Populated by sync.ts and ws.ts, consumed by maker.ts.
 */

export interface PriceEntry {
  conditionId: string;
  slug: string;
  yesPrice: number;  // 0-10000 bps
  noPrice: number;   // 0-10000 bps
  updatedAt: Date;
  /** Polymarket CLOB token IDs: [yesTokenId, noTokenId] */
  clobTokenIds?: [string, string];
}

// Map: conditionId → PriceEntry
const cache = new Map<string, PriceEntry>();

// Reverse map: assetId (CLOB token ID) → list of { conditionId, side, inverted }
// Multiple conditionIds can share the same token IDs (split markets: base, -a, -b)
interface AssetMapping {
  conditionId: string;
  side: "yes" | "no";
  inverted: boolean; // true for -b split markets where yes/no are flipped
}
const assetIndex = new Map<string, AssetMapping[]>();

/** Update or insert a price entry. Called by sync after parsing Polymarket events. */
export function setPrice(
  conditionId: string,
  slug: string,
  yesPrice: number,
  noPrice: number,
  clobTokenIds?: [string, string],
  inverted: boolean = false,
): void {
  const existing = cache.get(conditionId);
  const tokens = clobTokenIds || existing?.clobTokenIds;
  cache.set(conditionId, {
    conditionId,
    slug,
    yesPrice,
    noPrice,
    updatedAt: new Date(),
    clobTokenIds: tokens,
  });

  // Update reverse index — append to list (don't overwrite)
  if (tokens) {
    const addMapping = (tokenId: string, side: "yes" | "no") => {
      const list = assetIndex.get(tokenId) || [];
      // Don't add duplicates
      if (!list.some(m => m.conditionId === conditionId)) {
        list.push({ conditionId, side, inverted });
        assetIndex.set(tokenId, list);
      }
    };
    addMapping(tokens[0], "yes");
    addMapping(tokens[1], "no");
  }
}

/** Update price for a single side from a WebSocket event.
 * Fans out to ALL conditionIds sharing this asset (base + split markets).
 * Returns all affected conditionIds that exceeded the threshold. */
export function updatePriceFromWs(
  assetId: string,
  newPriceBps: number,
): { conditionIds: string[]; maxDeltaBps: number } | null {
  const mappings = assetIndex.get(assetId);
  if (!mappings || mappings.length === 0) return null;

  let maxDelta = 0;
  const affectedIds: string[] = [];

  for (const mapping of mappings) {
    const entry = cache.get(mapping.conditionId);
    if (!entry) continue;

    let delta = 0;

    // For inverted markets (-b), the Polymarket "yes" price is our "no" price
    if (mapping.inverted) {
      if (mapping.side === "yes") {
        // Polymarket yes token update → for inverted market, this is our noPrice
        delta = Math.abs(newPriceBps - entry.noPrice);
        entry.noPrice = newPriceBps;
        entry.yesPrice = 10000 - newPriceBps;
      } else {
        // Polymarket no token update → for inverted market, this is our yesPrice
        delta = Math.abs(newPriceBps - entry.yesPrice);
        entry.yesPrice = newPriceBps;
        entry.noPrice = 10000 - newPriceBps;
      }
    } else {
      // Normal (non-inverted): base conditionId and -a
      if (mapping.side === "yes") {
        delta = Math.abs(newPriceBps - entry.yesPrice);
        entry.yesPrice = newPriceBps;
        entry.noPrice = 10000 - newPriceBps;
      } else {
        delta = Math.abs(newPriceBps - entry.noPrice);
        entry.noPrice = newPriceBps;
        entry.yesPrice = 10000 - newPriceBps;
      }
    }
    entry.updatedAt = new Date();

    if (delta > 0) {
      affectedIds.push(mapping.conditionId);
      if (delta > maxDelta) maxDelta = delta;
    }
  }

  if (affectedIds.length === 0) return null;
  return { conditionIds: affectedIds, maxDeltaBps: maxDelta };
}

/** Get price for a conditionId. Returns undefined if not cached. */
export function getPrice(conditionId: string): PriceEntry | undefined {
  return cache.get(conditionId);
}

/** Get all cached prices. */
export function getAllPrices(): Map<string, PriceEntry> {
  return cache;
}

/** How many entries in cache. */
export function cacheSize(): number {
  return cache.size;
}

/** Check if a price is stale (older than maxAgeMs). */
export function isStale(conditionId: string, maxAgeMs: number): boolean {
  const entry = cache.get(conditionId);
  if (!entry) return true;
  return Date.now() - entry.updatedAt.getTime() > maxAgeMs;
}

/** Look up conditionId from an asset ID. Returns first (non-inverted) mapping. */
export function lookupAsset(assetId: string): { conditionId: string; side: "yes" | "no" } | undefined {
  const mappings = assetIndex.get(assetId);
  if (!mappings || mappings.length === 0) return undefined;
  // Return first non-inverted mapping (base conditionId)
  const normal = mappings.find(m => !m.inverted);
  const m = normal || mappings[0];
  return { conditionId: m.conditionId, side: m.side };
}

/** Get all subscribed asset IDs (for WebSocket subscription). */
export function getAllAssetIds(): string[] {
  return [...assetIndex.keys()];
}
