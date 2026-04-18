#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# Final Score — QA Trading Script
# Tests the full non-custodial ICRC2 trading flow
# Run: bash scripts/qa-trading.sh
# ═══════════════════════════════════════════════════════════
set -euo pipefail
export DFX_WARNING=-mainnet_plaintext_identity

NETWORK="ic"
IDENTITY="pp_owner"
CANISTER="final_score"
LEDGER="3jkp5-oyaaa-aaaaj-azwqa-cai"

DFX="dfx canister call $CANISTER"
DFX_FLAGS="--network $NETWORK --identity $IDENTITY"

PRINCIPAL=$(dfx identity get-principal --identity $IDENTITY)
CANISTER_ID=$(dfx canister id $CANISTER --network $NETWORK)

pass=0
fail=0
total=0

# ─── Helpers ──────────────────────────────────────────────

call() {
  dfx canister call "$CANISTER" "$1" "$2" --network "$NETWORK" --identity "$IDENTITY" 2>&1
}

ledger_call() {
  dfx canister call "$LEDGER" "$1" "$2" --network "$NETWORK" --identity "$IDENTITY" 2>&1
}

get_balance() {
  ledger_call icrc1_balance_of "(record { owner = principal \"$PRINCIPAL\"; subaccount = null })" \
    | grep -oP '\d[\d_]*' | head -1 | tr -d '_'
}

check() {
  total=$((total + 1))
  local desc="$1"
  local condition="$2"
  if eval "$condition"; then
    echo "  ✓ $desc"
    pass=$((pass + 1))
  else
    echo "  ✗ $desc"
    fail=$((fail + 1))
  fi
}

# Pick a market to test on — find an open one
pick_market() {
  # Find an open market by scanning pages
  for offset in 0 50 100 150 200 300 400 500; do
    local result
    result=$(call debug_list_markets "(null, $offset, 50)" 2>&1)
    # Pair each status with its marketId using paste-style parsing
    local mid
    mid=$(echo "$result" | tr '\n' ' ' | grep -oP 'status = "Open";[^}]*?marketId = "\K[0-9]+' | head -1)
    if [ -n "$mid" ]; then
      echo "$mid"
      return
    fi
  done
  echo ""
}

echo "═══════════════════════════════════════════════════════════"
echo "  Final Score QA — Non-Custodial Trading Flow"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Principal: $PRINCIPAL"
echo "  Canister:  $CANISTER_ID"
echo "  Ledger:    $LEDGER"
echo ""

# ─── SETUP: Check balance & set allowance ─────────────────

echo "── Setup ──────────────────────────────────────────────────"

BALANCE_START=$(get_balance)
echo "  Starting wallet balance: $BALANCE_START"

if [ "$BALANCE_START" -lt 20000000 ]; then
  echo "  ✗ Need at least 20 USDC (20000000 atomic). Current: $BALANCE_START"
  echo "  Send tokens to $PRINCIPAL on ledger $LEDGER"
  exit 1
fi

# Set allowance to 50 USDC
echo "  Setting allowance to 50 USDC..."
APPROVE_RESULT=$(ledger_call icrc2_approve "(record { spender = record { owner = principal \"$CANISTER_ID\"; subaccount = null }; amount = 50_000_000; fee = null; memo = null; from_subaccount = null; created_at_time = null; expected_allowance = null; expires_at = null })")
check "Allowance set" 'echo "$APPROVE_RESULT" | grep -q "Ok"'

# Pick a market
MARKET=$(pick_market)
echo "  Test market: $MARKET"
echo ""

if [ -z "$MARKET" ]; then
  echo "  ✗ No open market found!"
  exit 1
fi

# ─── TEST 1: Resting order (no match) ─────────────────────

echo "── Test 1: Resting order (no fill, no transfer) ─────────"

BALANCE_BEFORE=$(get_balance)
RESULT=$(call place_order "(\"$MARKET\", \"yes\", 0.10 : float64, 5 : nat)")
check "Order placed" 'echo "$RESULT" | grep -q "ok"'
ORDER_ID_1=$(echo "$RESULT" | grep -oP 'orderId = "\K[^"]+')
check "Got order ID: $ORDER_ID_1" '[ -n "$ORDER_ID_1" ]'
check "Status is Open or PartiallyFilled" 'echo "$RESULT" | grep -qE "Open|PartiallyFilled"'
FILLED=$(echo "$RESULT" | grep -oP 'filled = \K\d+')
check "0 fills (resting)" '[ "$FILLED" = "0" ]'

BALANCE_AFTER=$(get_balance)
check "Wallet unchanged (no transfer on rest)" '[ "$BALANCE_BEFORE" = "$BALANCE_AFTER" ]'
echo ""

# ─── TEST 2: Self-matching (opposite crosses) ─────────────

echo "── Test 2: Self-match Buy No vs resting Buy Yes ─────────"

BALANCE_BEFORE=$(get_balance)
RESULT=$(call place_order "(\"$MARKET\", \"no\", 0.90 : float64, 5 : nat)")
check "Order placed" 'echo "$RESULT" | grep -q "ok"'
FILLED=$(echo "$RESULT" | grep -oP 'filled = \K\d+')
check "5 fills (matched resting Yes)" '[ "$FILLED" = "5" ]'

BALANCE_AFTER=$(get_balance)
check "Wallet changed (transfers happened)" '[ "$BALANCE_BEFORE" != "$BALANCE_AFTER" ]'
echo ""

# ─── TEST 3: Position netting (overlap redeemed) ──────────

echo "── Test 3: Positions netted (5 Yes + 5 No → 0) ──────────"

# Check positions for this market via debug
POSITIONS_RESULT=$(call get_positions "(principal \"$PRINCIPAL\")" 2>&1 || true)
# Count positions in this market — should be 0 after netting
YES_SHARES=$(echo "$POSITIONS_RESULT" | grep -A5 "market_id = \"$MARKET\"" | grep -oP 'shares = \K\d+' | head -1 || echo "0")
check "No residual position (netted to 0)" '[ "${YES_SHARES:-0}" = "0" ]'

# Wallet should have gotten ~$5.00 back (5 sets × $1.00) minus fees
# Start - taker side cost - fees + netting refund ≈ Start - small fees
BALANCE_NETTED=$(get_balance)
echo "  Balance after netting: $BALANCE_NETTED (started: $BALANCE_START)"
LOSS=$((BALANCE_START - BALANCE_NETTED))
echo "  Total cost (fees + surplus): $LOSS atomic units"
check "Loss reasonable (< 3 USDC)" '[ "$LOSS" -lt 3000000 ]'
echo ""

# ─── TEST 4: Partial netting ──────────────────────────────

echo "── Test 4: Partial netting (10 Yes, 6 No → 4 Yes remain) "

BALANCE_BEFORE=$(get_balance)
# Place 10 Yes @ $0.30 (rests)
RESULT1=$(call place_order "(\"$MARKET\", \"yes\", 0.30 : float64, 10 : nat)")
check "10 Yes placed" 'echo "$RESULT1" | grep -q "ok"'
ORDER_ID_YES=$(echo "$RESULT1" | grep -oP 'orderId = "\K[^"]+')

# Place 6 No @ $0.70 (matches 6 of the resting Yes)
RESULT2=$(call place_order "(\"$MARKET\", \"no\", 0.70 : float64, 6 : nat)")
check "6 No placed" 'echo "$RESULT2" | grep -q "ok"'
FILLED=$(echo "$RESULT2" | grep -oP 'filled = \K\d+')
check "6 fills" '[ "$FILLED" = "6" ]'

BALANCE_AFTER_PARTIAL=$(get_balance)
echo "  Balance after partial net: $BALANCE_AFTER_PARTIAL"

# Check the Yes order is partially filled (6/10)
ORDER_STATUS=$(echo "$RESULT1" | grep -oP 'status = "\K[^"]+' || echo "")
echo "  Yes order filled: $(echo "$RESULT1" | grep -oP 'filled = \K\d+')/10"
echo ""

# ─── TEST 5: Cancel resting order ─────────────────────────

echo "── Test 5: Cancel resting order (no balance change) ──────"

# The Yes order from test 4 should have 4 remaining
BALANCE_BEFORE_CANCEL=$(get_balance)
CANCEL_RESULT=$(call cancel_order "(\"$ORDER_ID_YES\")")
check "Order cancelled" 'echo "$CANCEL_RESULT" | grep -q "ok\|Ok\|Cancelled"'

BALANCE_AFTER_CANCEL=$(get_balance)
check "Wallet unchanged after cancel" '[ "$BALANCE_BEFORE_CANCEL" = "$BALANCE_AFTER_CANCEL" ]'
echo ""

# ─── TEST 6: Insufficient balance error ───────────────────

echo "── Test 6: Error on insufficient funds ───────────────────"

# Try to buy a huge amount that exceeds wallet
RESULT=$(call place_order "(\"$MARKET\", \"yes\", 0.50 : float64, 999999 : nat)" 2>&1 || true)
# This should either rest (no fill = no error) or fail on transfer
echo "  Result: $(echo "$RESULT" | head -3 | tr '\n' ' ')"
echo ""

# ─── TEST 7: Zero allowance error ─────────────────────────

echo "── Test 7: Zero allowance — fills skipped safely ─────────"

# Set allowance to 0
ledger_call icrc2_approve "(record { spender = record { owner = principal \"$CANISTER_ID\"; subaccount = null }; amount = 0; fee = null; memo = null; from_subaccount = null; created_at_time = null; expected_allowance = null; expires_at = null })" > /dev/null 2>&1

# Place matching orders: first rests, second matches but transfer_from fails
# With safety fix: failed fills are skipped, order returns ok with 0 fills
RESULT_A=$(call place_order "(\"$MARKET\", \"yes\", 0.40 : float64, 2 : nat)" 2>&1 || true)
BALANCE_BEFORE_7=$(get_balance)
RESULT_B=$(call place_order "(\"$MARKET\", \"no\", 0.60 : float64, 2 : nat)" 2>&1 || true)
BALANCE_AFTER_7=$(get_balance)
# No tokens should have moved (fills skipped)
check "Wallet unchanged (fills skipped safely)" '[ "$BALANCE_BEFORE_7" = "$BALANCE_AFTER_7" ]'

# Restore allowance
ledger_call icrc2_approve "(record { spender = record { owner = principal \"$CANISTER_ID\"; subaccount = null }; amount = 50_000_000; fee = null; memo = null; from_subaccount = null; created_at_time = null; expected_allowance = null; expires_at = null })" > /dev/null 2>&1
echo ""

# ─── Summary ──────────────────────────────────────────────

BALANCE_END=$(get_balance)
echo "═══════════════════════════════════════════════════════════"
echo "  Results: $pass/$total passed, $fail failed"
echo "  Starting balance: $BALANCE_START"
echo "  Ending balance:   $BALANCE_END"
echo "  Total spent (fees): $((BALANCE_START - BALANCE_END)) atomic"
echo "═══════════════════════════════════════════════════════════"

if [ "$fail" -gt 0 ]; then
  exit 1
fi
