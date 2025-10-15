### **Specification: Prediction Market MCP Server (v1.0)**

*   **Date:** October 7, 2025
*   **Author:** Alice
*   **Status:** For Development

#### **1. Objective**

To create a fully on-chain, AI-agent-operable prediction market for football match outcomes. This canister will function as a self-contained MCP server, providing a suite of tools for agents to discover markets, manage funds, place predictions, and claim winnings. The system will leverage the existing **Football Oracle** (`iq5so-oiaaa-aaaai-q34ia-cai`) as its source of truth for settling markets.

#### **2. Core Architectural Principles**

*   **Single Canister Architecture:** The entire system—market creation, fund management, and settlement—will be contained within a single canister for the MVP.
*   **Virtual Account Ledger:** The canister will manage user funds via an internal, stable ledger (`Map<Principal, Balance>`). Users will deposit funds into the canister once and then place predictions using their internal balance. This provides a fast, gasless user experience for betting.
*   **Parimutuel Betting:** All predictions for a given match will be placed into shared pools. Winners will be paid out proportionally from the losing pools.
*   **Agent-First Design:** The primary interface will be the MCP Tool Server. The tools should be designed to be intuitive and robust for an AI agent to use.
*   **Non-Custodial (in Spirit):** While the canister holds funds in escrow for active predictions, users retain full control to withdraw their available (non-escrowed) balance at any time.

#### **3. The Agent's Workflow**

An AI agent will interact with the system in a logical sequence. The tools must support this journey:

1.  **Fund the Account:** The agent deposits tokens (e.g., USDC) into its virtual account within the canister.
2.  **Discover Opportunities:** The agent queries for a list of open markets to see which matches are available for predictions.
3.  **Place Prediction:** The agent submits a prediction for a specific match outcome, committing funds from its virtual account.
4.  **Monitor & Claim:** After a match is over, the agent checks the status of its prediction and claims any winnings, which are then credited back to its virtual account.
5.  **Withdraw Funds:** The agent can withdraw its available balance from the canister back to its main wallet.

#### **4. Detailed Tool Specifications**

The canister must expose the following MCP tools:

##### **4.1. Tool: `account_deposit`**

*   **Purpose:** To fund the user's virtual account. This is a two-step process involving an `icrc2_approve` call followed by this tool call.
*   **Behavior:** The tool pulls funds from the user's wallet via `icrc2_transfer_from`, using the allowance they previously set. It then credits the user's internal virtual account.
*   **Input Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "amount": {
          "type": "string",
          "description": "The amount of tokens to deposit, in base units (string nat)."
        }
      },
      "required": ["amount"]
    }
    ```
*   **Output Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "new_balance": {
          "type": "string",
          "description": "The user's new total virtual account balance."
        }
      },
      "required": ["new_balance"]
    }
    ```

##### **4.2. Tool: `markets_list_open`**

*   **Purpose:** To allow an agent to discover available prediction markets.
*   **Behavior:** The tool queries its internal state for all markets that are currently in the `Open` status (i.e., the match has not started). It should also periodically sync with the Football Oracle's `get_scheduled_matches` to create new markets.
*   **Input Schema:** `{ "type": "object", "properties": {} }`
*   **Output Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "markets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "marketId": { "type": "string", "description": "Unique ID for this market." },
              "matchDetails": { "type": "string", "description": "e.g., 'Manchester United vs. Liverpool'" },
              "bettingDeadline": { "type": "string", "description": "ISO 8601 timestamp for when betting closes." },
              "totalPool": { "type": "string", "description": "Total value locked in this market." }
            }
          }
        }
      },
      "required": ["markets"]
    }
    ```

##### **4.3. Tool: `prediction_place`**

*   **Purpose:** To submit a prediction and commit funds to a market.
*   **Behavior:** The tool checks the user's virtual balance, debits the amount, and adds it to the corresponding outcome pool (`homeWinPool`, `awayWinPool`, or `drawPool`) for the specified `marketId`. It records the user's position.
*   **Input Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "marketId": { "type": "string", "description": "The ID of the market to bet on." },
        "outcome": {
          "type": "string",
          "enum": ["HomeWin", "AwayWin", "Draw"],
          "description": "The predicted outcome."
        },
        "amount": {
          "type": "string",
          "description": "The amount to bet from the virtual account, in base units."
        }
      },
      "required": ["marketId", "outcome", "amount"]
    }
    ```
*   **Output Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "positionId": { "type": "string", "description": "A unique ID for this specific prediction." },
        "status": { "type": "string", "description": "Confirmation that the prediction was placed." }
      },
      "required": ["positionId", "status"]
    }
    ```

##### **4.4. Tool: `prediction_claim_winnings`**

*   **Purpose:** To settle a user's position in a completed market and credit their account with any winnings.
*   **Behavior:** The tool checks if the specified market has been resolved. If not, it informs the agent. If it has, it calculates the user's payout for all their winning positions in that market, credits their virtual account, and marks the positions as claimed. This tool should be idempotent.
*   **Input Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "marketId": { "type": "string", "description": "The ID of the market to claim winnings from." }
      },
      "required": ["marketId"]
    }
    ```
*   **Output Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "amount_claimed": { "type": "string", "description": "Total amount credited to the virtual account." },
        "new_balance": { "type": "string", "description": "The user's new total virtual account balance." }
      },
      "required": ["amount_claimed", "new_balance"]
    }
    ```

##### **4.5. Tool: `account_get_info`**

*   **Purpose:** To provide the agent with a full overview of its account status.
*   **Behavior:** Returns the user's available balance and a list of their active, unresolved predictions.
*   **Input Schema:** `{ "type": "object", "properties": {} }`
*   **Output Schema:**
    ```json
    {
      "type": "object",
      "properties": {
        "available_balance": { "type": "string" },
        "active_predictions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "positionId": { "type": "string" },
              "marketId": { "type": "string" },
              "matchDetails": { "type": "string" },
              "staked_amount": { "type": "string" },
              "predicted_outcome": { "type": "string" }
            }
          }
        }
      },
      "required": ["available_balance", "active_predictions"]
    }
    ```

#### **5. Automated Processes (Internal Logic)**

*   **Market Creation:** The canister will use a timer to periodically call `get_scheduled_matches` on the Football Oracle. For any new matches found, it will automatically create a new internal market record and make it available via the `markets_list_open` tool.
*   **Market Resolution:** The canister will use a timer to check its `Open` markets. After a market's betting deadline has passed, it will periodically call `get_latest_event` on the Football Oracle. Once the Oracle reports a `MatchFinal` event, our canister will update the market's status to `Resolved`, record the winning outcome, and enable claims.

#### **6. Scope of Work (MVP)**

*   **Token Support:** The canister will support a single, specified ICRC token (e.g., USDC) for all deposits and predictions.
*   **Market Types:** Only the simple "Win/Loss/Draw" market type will be supported.
*   **Fees:** The MVP will not include any revenue-generating fees. 100% of the losing pools will be distributed to the winners.
*   **Oracle:** The system will rely exclusively on the specified mainnet Football Oracle canister.

#### **7. Acceptance Criteria**

The project is complete when:
1.  The canister is deployed as an MCP server exposing all five specified tools.
2.  An agent can successfully complete the full workflow: deposit funds, view markets, place a prediction, claim winnings, and view its account info.
3.  The canister's internal timers correctly create new markets from the Oracle's data.
4.  The canister's internal timers correctly resolve markets using the Oracle's final outcome data.
5.  The virtual account ledger accurately tracks user balances through all operations.
6.  Funds are correctly escrowed in the parimutuel pools and paid out to winners.