#!/usr/bin/env python3
"""
Market Maker for Final Score — seeds order book liquidity.

Usage:
  python3 scripts/market-maker.py --market-id 0 --api-key YOUR_KEY
  python3 scripts/market-maker.py --market-id 0 --api-key YOUR_KEY --spread 0.05 --levels 5 --size 10
  python3 scripts/market-maker.py --all --api-key YOUR_KEY --limit 20

This script places Buy Yes and Buy No limit orders at evenly spaced
price levels around a midpoint to create two-sided liquidity.

For a match to happen: Buy Yes @ P + Buy No @ Q >= $1.00
So we place Yes bids below 0.50 and No bids below 0.50 (they complement).

Example with mid=0.50, spread=0.05, levels=3:
  Buy Yes @ $0.45, $0.40, $0.35
  Buy No  @ $0.45, $0.40, $0.35

A Yes @ $0.45 matches with No @ $0.55 or better (0.45 + 0.55 = 1.00).
Since No bids are at $0.45 (i.e. implied Yes ask = $0.55), they match!
"""

import argparse
import json
import requests
import time
import subprocess
import sys

CANISTER_ID = "ilyol-uqaaa-aaaai-q34kq-cai"
MCP_URL = f"https://{CANISTER_ID}.raw.icp0.io/mcp"

request_id = 0


def mcp_call(api_key: str, tool: str, args: dict) -> dict:
    """Call an MCP tool via JSON-RPC."""
    global request_id
    request_id += 1

    body = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {"name": tool, "arguments": args},
    }

    resp = requests.post(
        MCP_URL,
        json=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if "error" in data and data["error"]:
        raise Exception(f"MCP error [{data['error']['code']}]: {data['error']['message']}")

    result = data.get("result", {})
    if result.get("isError"):
        text = result.get("content", [{}])[0].get("text", "Unknown error")
        raise Exception(f"Tool error: {text}")

    text = result.get("content", [{}])[0].get("text", "{}")
    return json.loads(text)


def place_order(api_key: str, market_id: str, outcome: str, price: float, size: int) -> dict:
    """Place a limit order."""
    return mcp_call(api_key, "order_place", {
        "market_id": market_id,
        "outcome": outcome,
        "price": price,
        "size": size,
    })


def get_markets(api_key: str, limit: int = 100) -> list:
    """List markets."""
    return mcp_call(api_key, "markets_list", {"limit": limit, "status": "open"})


def seed_market(
    api_key: str,
    market_id: str,
    mid: float = 0.50,
    spread: float = 0.05,
    levels: int = 3,
    size: int = 10,
    delay: float = 0.5,
) -> dict:
    """
    Seed a market with two-sided liquidity.

    Places `levels` price levels on each side, starting at (mid - spread/2)
    and stepping down by `spread` increments.
    """
    results = {"yes_orders": [], "no_orders": [], "errors": []}

    # Calculate price levels (both sides bid below mid)
    start_price = mid - spread / 2

    for i in range(levels):
        price = round(start_price - (i * spread), 2)
        if price < 0.01 or price > 0.99:
            continue

        # Buy Yes at this price
        try:
            r = place_order(api_key, market_id, "yes", price, size)
            status = r.get("status", "?")
            fills = len(r.get("fills", []))
            results["yes_orders"].append({"price": price, "size": size, "status": status, "fills": fills})
            print(f"  ✓ Buy Yes @ ${price:.2f} x{size} → {status}" + (f" ({fills} fills)" if fills else ""))
        except Exception as e:
            results["errors"].append({"side": "yes", "price": price, "error": str(e)})
            print(f"  ✗ Buy Yes @ ${price:.2f} x{size} → {e}")

        time.sleep(delay)

        # Buy No at this price
        try:
            r = place_order(api_key, market_id, "no", price, size)
            status = r.get("status", "?")
            fills = len(r.get("fills", []))
            results["no_orders"].append({"price": price, "size": size, "status": status, "fills": fills})
            print(f"  ✓ Buy No  @ ${price:.2f} x{size} → {status}" + (f" ({fills} fills)" if fills else ""))
        except Exception as e:
            results["errors"].append({"side": "no", "price": price, "error": str(e)})
            print(f"  ✗ Buy No  @ ${price:.2f} x{size} → {e}")

        time.sleep(delay)

    return results


def main():
    parser = argparse.ArgumentParser(description="Market Maker for Final Score")
    parser.add_argument("--api-key", required=True, help="MCP API key")
    parser.add_argument("--market-id", help="Single market ID to seed")
    parser.add_argument("--all", action="store_true", help="Seed all open markets")
    parser.add_argument("--limit", type=int, default=10, help="Max markets to seed (with --all)")
    parser.add_argument("--mid", type=float, default=0.50, help="Midpoint price (default: 0.50)")
    parser.add_argument("--spread", type=float, default=0.05, help="Spread between levels (default: 0.05)")
    parser.add_argument("--levels", type=int, default=3, help="Number of price levels per side (default: 3)")
    parser.add_argument("--size", type=int, default=10, help="Shares per order (default: 10)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between orders in seconds")

    args = parser.parse_args()

    if not args.market_id and not args.all:
        parser.error("Specify --market-id or --all")

    if args.market_id:
        market_ids = [args.market_id]
    else:
        print(f"Fetching open markets (limit {args.limit})...")
        markets = get_markets(args.api_key, args.limit)
        if isinstance(markets, dict) and "markets" in markets:
            market_ids = [m["market_id"] for m in markets["markets"]]
        elif isinstance(markets, list):
            market_ids = [m["market_id"] for m in markets]
        else:
            market_ids = []
        print(f"Found {len(market_ids)} markets")

    print(f"\nMarket maker config:")
    print(f"  Mid: ${args.mid:.2f}")
    print(f"  Spread: ${args.spread:.2f}")
    print(f"  Levels: {args.levels} per side")
    print(f"  Size: {args.size} shares per order")
    print(f"  Markets: {len(market_ids)}")
    print()

    total_orders = 0
    total_errors = 0

    for mid in market_ids:
        print(f"═══ Market {mid} ═══")
        result = seed_market(
            args.api_key, mid,
            mid=args.mid,
            spread=args.spread,
            levels=args.levels,
            size=args.size,
            delay=args.delay,
        )
        total_orders += len(result["yes_orders"]) + len(result["no_orders"])
        total_errors += len(result["errors"])
        print()

    print(f"Done! Placed {total_orders} orders with {total_errors} errors.")


if __name__ == "__main__":
    main()
