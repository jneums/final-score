# Final Score - Prediction Market Implementation

## Overview
This implementation creates a fully on-chain, AI-agent-operable prediction market for football match outcomes, following the specification in `SPEC.md`.

## Architecture

### Core Components

1. **Main Canister** (`src/main.mo`)
   - MCP Server implementation
   - Market creation and resolution logic
   - Automated timers for syncing with Football Oracle
   - Virtual account ledger management

2. **Tool Context** (`src/tools/ToolContext.mo`)
   - Shared context and state management
   - Helper functions for balance management
   - Type definitions for markets, positions, and outcomes

3. **Football Oracle Interface** (`src/tools/FootballOracle.mo`)
   - Interface to the mainnet Football Oracle canister
   - Type definitions for match events and outcomes

4. **MCP Tools** (in `src/tools/`)
   - `account_deposit.mo` - Deposit tokens via ICRC2 transfer_from
   - `account_withdraw.mo` - Withdraw tokens back to wallet
   - `markets_list_open.mo` - List available prediction markets
   - `prediction_place.mo` - Place predictions on match outcomes
   - `prediction_claim_winnings.mo` - Claim winnings from resolved markets
   - `account_get_info.mo` - Get account balance and active predictions

## Key Features

### Virtual Account System
- Users deposit tokens once into their virtual account
- Fast, gasless predictions using internal ledger
- Withdrawals anytime for non-escrowed funds

### Parimutuel Betting
- All predictions pool into outcome-specific pools
- Winners share the total pool proportionally
- Payout formula: `(user_stake / winning_pool) * total_pool`

### Automated Market Management
- **Market Creation Timer** (every 5 minutes)
  - Syncs with Football Oracle for scheduled matches
  - Creates new markets automatically
  - Sets betting deadline 5 minutes before kickoff

- **Market Resolution Timer** (every 3 minutes)
  - Closes markets after betting deadline
  - Checks oracle for final match outcomes
  - Resolves markets when results are available

### Authentication
- OIDC authentication via Prometheus Protocol
- User principal identification for account management
- Required for all financial operations

## State Management

### Stable Storage
All state is automatically stable using `mo:map/Map`:
- `markets` - Map of all prediction markets
- `userBalances` - Virtual account balances
- `userPositions` - User predictions and their status
- `nextMarketId` / `nextPositionId` - ID counters
- `processedOracleIds` - Track created markets

### Market Lifecycle
1. **Open** - Accepting predictions
2. **Closed** - Betting deadline passed, waiting for result
3. **Resolved** - Final outcome determined, winnings claimable

## Configuration

### Canister Arguments
```motoko
{
  owner : ?Principal;           // Canister owner
  footballOracleId : ?Principal; // Default: iq5so-oiaaa-aaaai-q34ia-cai
  tokenLedger : ?Principal;      // Default: USDC mainnet
}
```

### Dependencies (mops.toml)
- `mcp-motoko-sdk` - MCP server framework
- `icrc2-types` - ICRC1/ICRC2 token standards
- `map` - Stable map data structure
- `json` - JSON serialization
- Plus standard libraries

## Agent Workflow

1. **Fund Account**
   ```
   1. User approves canister to spend tokens (icrc2_approve)
   2. Call account_deposit tool with amount
   3. Tokens transferred to canister, virtual balance credited
   ```

2. **Discover Markets**
   ```
   Call markets_list_open to see available matches
   ```

3. **Place Prediction**
   ```
   Call prediction_place with marketId, outcome, and amount
   Funds debited from virtual balance to outcome pool
   ```

4. **Monitor & Claim**
   ```
   After match completes:
   1. Call account_get_info to see positions
   2. Call prediction_claim_winnings for resolved markets
   3. Winnings credited to virtual balance
   ```

5. **Withdraw**
   ```
   Call account_withdraw with amount
   Tokens transferred back to user's wallet
   ```

## Testing & Deployment

### Local Testing
```bash
dfx start --background
dfx deploy
```

### Mainnet Deployment
```bash
dfx deploy --network ic --argument '(opt record {
  owner = opt principal "your-principal-here";
  footballOracleId = null;  // Uses default
  tokenLedger = null;       // Uses default USDC
})'
```

## Future Enhancements (Post-MVP)

- Multiple token support
- Additional market types (over/under, correct score, etc.)
- Fee structure for sustainability
- Market maker incentives
- Historical statistics and leaderboards
- Multi-league support
