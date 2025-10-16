# Final Score - Parimutuel Football Predic### Account Management
- **`account_deposit`** - Deposit ckUSDC into your virtual account (requires ICRC-2 approval first)
- **`account_withdraw`** - Withdraw available balance back to your wallet
- **`account_get_info`** - View your balance and unclaimed positions

### Market Discovery
- **`markets_list`** - Unified market listing with status filters (Open/Closed/Resolved)
  - Filter by team name, match status, upcoming only
  - Sort by kickoff time, total pool, or market ID
  - Returns formatted UTC timestamps
  - Shows live scores for in-progress matches

### Predictions
- **`prediction_place`** - Take a position on HomeWin, AwayWin, or Draw
- **`prediction_claim_winnings`** - Claim payouts after a market resolves (idempotent)ly on-chain, AI-agent-operable prediction market for football matches. Built on the Internet Computer as a Motoko MCP server for the [Prometheus Protocol](https://prometheusprotocol.org) ecosystem.

## Overview

Final Score enables users and AI agents to predict football match outcomes (HomeWin, AwayWin, Draw) using a parimutuel prediction market system. Markets are automatically created from a Football Oracle and resolved when matches complete.

**Live on Mainnet:** `ix4u2-dqaaa-aaaai-q34iq-cai`

### Key Features

- 🤖 **AI-Agent Ready:** Full MCP (Model Context Protocol) integration with 6 tools
- ⚽ **Multi-League Coverage:** Women's Champions League, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, World Cup Qualifiers, CONCACAF Nations League, and more
- 💰 **Parimutuel Markets:** Fair odds calculated from participant pool distribution
- 🔄 **Automatic Resolution:** Matches resolve automatically via oracle integration
- 💳 **Virtual Account Ledger:** ICRC-2 token deposits (ckUSDC) with instant position taking
- 🎯 **Production Ready:** Paginated queries, 60-day time filters, automatic market lifecycle
- 🔴 **Live Scores:** Real-time match scores displayed for closed markets
- 🔒 **Secure:** Owner-only admin functions with Result types for error handling

### Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Football       │      │   Final Score    │      │   Token Ledger  │
│  Oracle         │─────▶│   MCP Server     │◀─────│   (USDC)      │
│  (Match Data)   │      │   (Markets)      │      │                 │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                  │
                                  │ MCP Protocol
                                  │
                         ┌────────▼────────┐
                         │   AI Agents /   │
                         │   Users         │
                         └─────────────────┘
```

## MCP Tools

Final Score exposes 7 tools for AI agents and users:

### Account Management
- **`account_deposit`** - Deposit USDC into your virtual account (requires ICRC-2 approval first)
- **`account_withdraw`** - Withdraw available balance back to your wallet
- **`account_get_info`** - View your balance and active predictions

### Market Discovery
- **`markets_list_open`** - List markets accepting bets with pagination, filtering, and sorting
  - Filter by team name, upcoming only
  - Sort by kickoff time, total pool, or market ID
  - Returns formatted UTC timestamps
- **`markets_list_closed`** - List markets that have closed for betting with **live scores**
  - Shows real-time match scores for in-progress games
  - Displays final scores for completed matches
  - Indicates awaiting resolution status

### Predictions
- **`prediction_place`** - Place a prediction on HomeWin, AwayWin, or Draw
- **`prediction_claim_winnings`** - Claim winnings after a market resolves (idempotent)

### Example Usage

```bash
# 1. Approve USDC transfer (outside MCP)
dfx canister call --network ic 53nhb-haaaa-aaaar-qbn5q-cai icrc2_approve \
  '(record { amount = 1_000_000:nat; spender = record { owner = principal "ix4u2-dqaaa-aaaai-q34iq-cai" } })'

# 2. Via MCP tools (using Claude Desktop, Cline, or other MCP client)
account_deposit(amount: "1000000")  # Deposit $1 ckUSDC
markets_list(status: ["Open"], limit: 10, upcoming_only: true)  # Find upcoming matches
prediction_place(marketId: "110", outcome: "HomeWin", amount: "500000")  # Predict $0.50
account_get_info()  # Check balance and positions
prediction_claim_winnings(marketId: "110")  # Claim after match resolves
```

## System Design

### Virtual Account Ledger
- Users deposit ckUSDC which credits their virtual account balance
- Instant position taking (no waiting for token transfers)
- Funds are escrowed in outcome pools until market resolves
- Withdrawals require available (non-escrowed) balance

### Parimutuel System
Each market has three pools: HomeWin, AwayWin, Draw
- **Before Deadline:** Users take positions, funds go into pools
- **At Deadline:** Market closes, no more positions accepted
- **After Match:** Oracle provides result, market resolves
- **Payout Formula:** `(your_stake / winning_pool) * total_pool`

### Market Lifecycle
```
┌──────────┐   Deadline    ┌────────┐   Match Ends   ┌──────────┐
│   Open   │──────────────▶│ Closed │───────────────▶│ Resolved │
└──────────┘   (5 min      └────────┘   (Oracle      └──────────┘
               before)                    MatchFinal)
```

### Automatic Operations
- **Market Creation:** Every 6 hours, syncs new matches from oracle (60-day window, paginated)
- **Market Closure:** Every 15 minutes, checks deadlines and closes markets
- **Market Resolution:** Every 15 minutes, queries oracle for MatchFinal events and resolves markets

## Prerequisites

Before you begin, make sure you have the following tools installed on your system:

1.  **DFX:** The DFINITY Canister SDK. [Installation Guide](https://internetcomputer.org/docs/current/developer-docs/setup/install/).
2.  **Node.js:** Version 18.0 or higher. [Download](https://nodejs.org/).
3.  **MOPS:** The Motoko Package Manager. [Installation Guide](https://mops.one/docs/install).
4.  **Git:** The version control system. [Download](https://git-scm.com/).

---

## Part 1: Quick Start (Local Development)

This section guides you from zero to a working, testable prediction market server on your local machine.

### Step 1: Initialize Your Repository

The Prometheus publishing process is tied to your Git history. Initialize a repository and make your first commit now.

```bash
git init
git add .
git commit -m "Initial commit - Final Score prediction market"
```

### Step 2: Install Dependencies

This command will install both the required Node.js packages and the Motoko packages.

```bash
npm install
npm run mops:install
```

### Step 3: Configure Oracle and Token Ledger

The canister requires two external services:

1. **Football Oracle:** `iq5so-oiaaa-aaaai-q34ia-cai` (mainnet)
2. **USDC Ledger:** `53nhb-haaaa-aaaar-qbn5q-cai` (mainnet)

These are configured in `src/main.mo` with mainnet defaults. For local testing, you'll need to deploy mock versions.

### Step 4: Deploy Your Server Locally

1.  **Start the Local Replica:** (Skip this if it's already running)
    ```bash
    npm run start
    ```
2.  **Deploy to the Local Replica:** (In a new terminal window)
    ```bash
    npm run deploy
    ```

The canister will automatically:
- Start the market sync timer (fetches matches every 6 hours)
- Start the resolution timer (checks for market closures/resolutions every 15 minutes)
- Create initial markets from the oracle

### Step 5: Test with the MCP Inspector

Your prediction market server is live and ready to accept bets.

1.  **Launch the Inspector:**
    ```bash
    npm run inspector
    ```
2.  **Connect to Your Canister:** Use the local canister ID endpoint provided in the `npm run deploy` output.
    ```
    # Replace `your_canister_id` with the actual ID from the deploy output
    http://127.0.0.1:4943/mcp/?canisterId=your_canister_id
    ```
3.  **Try the tools:**
    - `markets_list_open` - See available matches
    - `account_get_info` - Check your balance
    
🎉 **Congratulations!** You have a working local prediction market server.

---

## Part 2: Enable Monetization (Authentication)

The server includes authentication to track user balances and positions. This is **required** for the prediction market to function.

### Step 1: Authentication is Already Active

Unlike the template, Final Score **requires authentication** to operate. The authentication context is already enabled in `src/main.mo`:

```motoko
let issuerUrl = "https://bfggx-7yaaa-aaaai-q32gq-cai.icp0.io";
let allowanceUrl = "https://prometheusprotocol.org/app/io.github.jneums.final-score";
let requiredScopes = ["openid"];
```

### Step 2: Testing with API Keys

For automated testing and AI agents, use API keys:

```bash
# Generate a key
dfx canister call <your_canister_id> create_my_api_key '("Test Key", vec {})'

# Save the returned key and use it in MCP Inspector
# Set header: x-api-key: <your_key>
```

### Step 3: Interactive Login (Optional)

For web apps, enable the OAuth flow:
```bash
npm run auth register
```

---

## Part 3: Deploy to Mainnet

### Option A: Self-Deploy to IC

```bash
# Deploy directly to mainnet
dfx deploy --network ic

# Note your canister ID
dfx canister --network ic id my_mcp_server
```

### Option B: Publish to Prometheus Protocol (Recommended)

### Option B: Publish to Prometheus Protocol (Recommended)

Instead of deploying to mainnet yourself, you publish your service to the Prometheus Protocol. The protocol then verifies, audits, and deploys your code for you.

**Step 1: Commit Your Changes**

Make sure all your code changes are committed to Git.

```bash
git add .
git commit -m "feat: ready for mainnet"
```

**Step 2: Publish Your Service**

Use the `app-store` CLI to submit your service for verification and deployment.

```bash
# 1. Get your commit hash
git rev-parse HEAD

# 2. Run the init command to create your manifest
npm run app-store init 

# 3. Run the publish command with your app version
npm run app-store publish "0.1.0"
```

Once your service passes the audit, the protocol will automatically deploy it and provide you with a mainnet canister ID.

---

## Part 4: Managing Your Live Server

### Manual Operations

```bash
# Manually trigger market sync (fetches new matches from oracle)
dfx canister call --network ic <canister_id> refresh_markets '()'

# Get market count
dfx canister call --network ic <canister_id> get_market_count '()' --query

# Check specific market (debug)
dfx canister call --network ic <canister_id> debug_get_market '("110")' --query

# Check oracle events for a match (debug)
dfx canister call --network ic <canister_id> debug_check_oracle_events '("81")' --query
```

### Treasury Management

Your canister includes built-in Treasury functions to securely manage the funds it collects.

```bash
# Check owner
dfx canister call --network ic <canister_id> get_owner '()' --query

# Check treasury balance
dfx canister call --network ic <canister_id> get_treasury_balance \
  '(principal "53nhb-haaaa-aaaar-qbn5q-cai")' --query

# Withdraw funds (owner only)
dfx canister call --network ic <canister_id> withdraw \
  '(principal "53nhb-haaaa-aaaar-qbn5q-cai", 1_000_000:nat, principal "<destination>")'
```

### Admin Recovery Functions

In case of oracle issues or incorrect resolutions:

```bash
# Revert a market back to appropriate status (Open or Closed based on deadline)
dfx canister call --network ic <canister_id> admin_revert_market_to_open '("80")'

# Clear a processed event to allow re-resolution
dfx canister call --network ic <canister_id> admin_clear_processed_event '(81)'

# Delete a market with zero pools (cleanup orphaned markets)
dfx canister call --network ic <canister_id> admin_delete_market '("80")'

# Manually trigger resolution for a specific market (debug)
dfx canister call --network ic <canister_id> debug_resolve_market '("80")'
```

**Note:** All admin and debug functions are **owner-only** and return `Result<Text, Text>` types for proper error handling.

---

## Technical Details

### Dependencies

**Motoko Packages (via MOPS):**
- `base@0.16.0` - Standard library
- `map@9.0.1` - Stable map for persistent state
- `mcp-motoko-sdk@2.0.2` - MCP protocol implementation
- `icrc2-types@1.1.0` - Token standards
- `datetime@1.1.0` - Timestamp formatting
- `ic@3.2.0` - IC management interface

### State Management

All state is persistent across upgrades using stable variables:
- `markets` - Map of all prediction markets
- `userBalances` - Map of principal to virtual account balance
- `userPositions` - Map of principal to array of positions
- `processedOracleIds` - Set of oracle match IDs we've already created markets for

### Oracle Integration

**Football Oracle:** `iq5so-oiaaa-aaaai-q34ia-cai`

The oracle provides:
- `query_scheduled_matches()` - Paginated match listings with filtering
- `get_match_events()` - Match status updates (MatchScheduled, MatchInProgress, MatchFinal, MatchCancelled)

**Query Strategy:**
- Fetch scheduled matches in batches of 100
- Filter by time (next 60 days) and status (Scheduled only)
- Prevents creating markets for historical or very distant matches

### Token Integration

**USDC Ledger:** `53nhb-haaaa-aaaar-qbn5q-cai`
- 6 decimals (1 USDC = 1_000_000 base units)
- ICRC-2 standard (approve + transfer_from for deposits)
- ICRC-1 standard (transfer for withdrawals)

---

## What's Next?

- **Monitor Your Markets:** Use the MCP tools or debug functions to watch matches resolve
- **Seed Markets:** Provide liquidity by taking positions on multiple outcomes
- **Integrate with AI Agents:** Connect Claude Desktop, Cline, or custom agents
- **Expand Coverage:** Add more leagues as the oracle adds them
- **Build a UI:** Create a web interface using the same MCP endpoints

### Security & Production Notes

- **All admin/debug functions are owner-only** and secured with proper authentication checks
- **Result types** used throughout for proper error handling
- **Live testing validated:** Multiple matches successfully created → closed → resolved → claimed
- **See docs/SECURITY_AUDIT.md** for detailed security analysis and deployment verification
- **See docs/DEPLOYMENT_VERIFICATION.md** for production deployment status

### Related Resources

- **Football Oracle:** [View on IC Dashboard](https://dashboard.internetcomputer.org/canister/iq5so-oiaaa-aaaai-q34ia-cai)
- **MCP Protocol Docs:** [Prometheus Protocol](https://prometheusprotocol.org/docs)
- **docs/SPEC.md:** See original specification for detailed requirements
- **docs/SECURITY_AUDIT.md:** Complete security audit report with all fixes applied
- **docs/DEPLOYMENT_VERIFICATION.md:** Production deployment verification and testing results
- **docs/IMPLEMENTATION.md:** Implementation notes and learnings

---

## License

MIT

## Contributing

Issues and PRs welcome! This is an experimental prediction market implementation.