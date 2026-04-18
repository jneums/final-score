#!/usr/bin/env python3
"""
Off-chain Polymarket sync for Final Score canister.

Fetches active sports events from Polymarket Gamma API and creates
markets on the ICP canister via dfx admin_create_market calls.

Designed to run as a cron job every 30 minutes.
"""

import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

# ─── Config ───────────────────────────────────────────────────

CANISTER_ID = "ilyol-uqaaa-aaaai-q34kq-cai"
NETWORK = "ic"
GAMMA_API = "https://gamma-api.polymarket.com"

# Whitelisted sports — keep tight for launch
WHITELIST = [
    # Football/Soccer — top 5 leagues + UCL
    "epl", "lal", "bun", "fl1", "sea", "ucl",
    # Cricket
    "cricipl", "ipl",
    # US Sports
    "nba", "wnba", "mlb", "nfl", "nhl",
    # Other
    "kbo",
]


def fetch_json(url: str) -> any:
    """Fetch JSON from a URL."""
    req = urllib.request.Request(url, headers={"User-Agent": "FinalScore/2.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def get_sport_tags() -> dict[str, str]:
    """Fetch /sports and pick the best (rarest) tag per whitelisted sport."""
    sports = fetch_json(f"{GAMMA_API}/sports")

    # Build tag frequency map
    tag_freq: dict[str, int] = {}
    for s in sports:
        for t in s["tags"].split(","):
            t = t.strip()
            if t:
                tag_freq[t] = tag_freq.get(t, 0) + 1

    # For each whitelisted sport, pick the rarest tag
    whitelist_set = set(WHITELIST)
    sport_tags: dict[str, str] = {}

    for s in sports:
        slug = s["sport"]
        if slug not in whitelist_set:
            continue
        tags = [t.strip() for t in s["tags"].split(",") if t.strip() and t.strip() != "1"]
        if not tags:
            continue
        best_tag = min(tags, key=lambda t: tag_freq.get(t, 999))
        sport_tags[slug] = best_tag

    return sport_tags


def fetch_events(tag_id: str, limit: int = 100) -> list:
    """Fetch active events for a tag with pagination."""
    all_events = []
    offset = 0
    max_pages = 5

    for _ in range(max_pages):
        url = (
            f"{GAMMA_API}/events"
            f"?tag_id={tag_id}&active=true&closed=false"
            f"&limit={limit}&offset={offset}"
        )
        events = fetch_json(url)
        all_events.extend(events)
        if len(events) < limit:
            break
        offset += limit

    return all_events


def parse_price_to_bps(price_str: str) -> int:
    """Convert '0.60' -> 6000 (basis points)."""
    try:
        return int(float(price_str) * 10000)
    except (ValueError, TypeError):
        return 5000


def iso_to_unix(iso_str: str) -> int:
    """Convert ISO 8601 datetime string to unix seconds."""
    if not iso_str:
        return 0
    try:
        # Handle various ISO formats
        iso_str = iso_str.replace("Z", "+00:00")
        if "." in iso_str:
            # Truncate microseconds to 6 digits
            parts = iso_str.split(".")
            frac_and_tz = parts[1]
            # Find where timezone starts
            for i, c in enumerate(frac_and_tz):
                if c in ('+', '-') and i > 0:
                    frac = frac_and_tz[:i][:6]
                    tz = frac_and_tz[i:]
                    iso_str = f"{parts[0]}.{frac}{tz}"
                    break
        dt = datetime.fromisoformat(iso_str)
        return int(dt.timestamp())
    except Exception:
        return 0


def create_market_dfx(
    question: str,
    event_title: str,
    sport: str,
    slug: str,
    condition_id: str,
    end_date_seconds: int,
    yes_price: int,
    no_price: int,
) -> tuple[bool, str]:
    """Call admin_create_market via dfx."""
    # Build Candid argument
    args = (
        f'("{question}", "{event_title}", "{sport}", '
        f'"{slug}", "{condition_id}", '
        f'{end_date_seconds} : int, {yes_price} : nat, {no_price} : nat)'
    )

    cmd = [
        "dfx", "canister", "call", CANISTER_ID,
        "admin_create_market", args,
        "--network", NETWORK,
    ]

    env = {
        "DFX_WARNING": "-mainnet_plaintext_identity",
        "PATH": "/usr/bin:/usr/local/bin:/home/jesse/.local/share/dfx/bin:/home/jesse/.cargo/bin",
        "HOME": "/home/jesse",
    }

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
            cwd="/home/jesse/final-score", env=env,
        )
        output = result.stdout.strip()
        if "variant { ok" in output:
            return True, output
        elif "already exists" in output:
            return False, "duplicate"
        else:
            return False, output + result.stderr.strip()
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception as e:
        return False, str(e)


def escape_candid(s: str) -> str:
    """Escape a string for Candid text literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Starting Polymarket sync...")

    # 1. Get sport → tag mapping
    sport_tags = get_sport_tags()
    print(f"  Mapped {len(sport_tags)} whitelisted sports to tags")

    created = 0
    skipped = 0
    errors = 0

    # 2. For each sport, fetch events and create markets
    for sport, tag in sorted(sport_tags.items()):
        try:
            events = fetch_events(tag)
            if not events:
                continue

            print(f"  {sport}: {len(events)} events (tag={tag})")

            for event in events:
                slug = event.get("slug", "")
                title = event.get("title", "")
                end_date = event.get("endDate", "")
                end_secs = iso_to_unix(end_date)
                markets = event.get("markets", [])

                # Only sync match-day events (slug contains a date like 2026-04-18)
                # This filters out season props, outright winners, top scorer, etc.
                if not re.search(r"\d{4}-\d{2}-\d{2}", slug):
                    continue

                # Skip prop events (toss, sixes, batter, more-markets, etc.)
                PROP_SUFFIXES = [
                    "-more-markets", "-toss", "-most-sixes", "-team-top-batter",
                    "-most-fours", "-most-wickets", "-top-scorer",
                ]
                if any(slug.endswith(s) or s + "-" in slug for s in PROP_SUFFIXES):
                    continue

                matched_in_event = 0
                for mkt in markets:
                    if matched_in_event >= 3:  # moneyline = max 3 (home/away/draw)
                        break
                    question = mkt.get("question", "")
                    condition_id = mkt.get("conditionId", "")
                    closed = mkt.get("closed", False)

                    if not condition_id or closed:
                        continue

                    # WHITELIST: only moneyline questions
                    # Soccer: "Will X win on 2026-04-18?", "end in a draw?"
                    # Cricket: "League: Team A vs Team B" (event title as question)
                    #          "League: ... - Who wins", "Completed Match"
                    # US Sports (NBA/MLB/NHL): "Team A vs. Team B" (bare matchup, no qualifiers)
                    q_lower = question.lower()
                    q_stripped = question.strip()

                    # Check for bare matchup title (US sports moneyline)
                    # These have "vs." or "vs" and NO colon, spread, O/U, or player props
                    is_bare_matchup = (
                        (" vs " in q_lower or " vs. " in q_lower)
                        and ":" not in q_stripped
                        and "spread" not in q_lower
                        and "o/u" not in q_lower
                        and "moneyline" not in q_lower
                    )

                    is_moneyline = (
                        ("win" in q_lower and ("on 20" in q_lower or "in 20" in q_lower))
                        or "end in a draw" in q_lower
                        or "draw?" in q_lower
                        or (" vs " in q_lower and ":" in question and "spread" not in q_lower
                            and "o/u" not in q_lower and "moneyline" not in q_lower)
                        or "who wins" in q_lower
                        or "completed match" in q_lower
                        or is_bare_matchup
                    )
                    if not is_moneyline:
                        continue

                    # Parse prices
                    prices_str = mkt.get("outcomePrices", "[]")
                    try:
                        prices = json.loads(prices_str) if isinstance(prices_str, str) else prices_str
                    except json.JSONDecodeError:
                        prices = []

                    yes_price = parse_price_to_bps(prices[0]) if len(prices) >= 1 else 5000
                    no_price = parse_price_to_bps(prices[1]) if len(prices) >= 2 else 5000

                    # Create on canister
                    ok, msg = create_market_dfx(
                        question=escape_candid(question),
                        event_title=escape_candid(title),
                        sport=sport,
                        slug=slug,
                        condition_id=condition_id,
                        end_date_seconds=end_secs,
                        yes_price=yes_price,
                        no_price=no_price,
                    )

                    if ok:
                        created += 1
                        matched_in_event += 1
                        print(f"    + {question[:60]}")
                    elif msg == "duplicate":
                        skipped += 1
                    else:
                        errors += 1
                        print(f"    ! ERROR: {question[:40]}: {msg[:80]}")

        except Exception as e:
            print(f"  ! Failed to fetch {sport}: {e}")
            errors += 1

    print(f"\nSync complete: {created} created, {skipped} skipped (dup), {errors} errors")


if __name__ == "__main__":
    main()
