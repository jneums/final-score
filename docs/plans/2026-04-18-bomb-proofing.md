# Final Score — Bomb-Proofing Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make the non-custodial prediction market canister safe for external users and market makers — no path to token loss, no exploitable admin functions, clear UX for new users.

**Architecture:** All fixes are in the Motoko backend canister (`packages/canisters/final_score/src/`) and React frontend (`packages/apps/website/src/`). The core change is making the fill loop atomic per-fill (commit state after each successful transfer pair), adding guards to admin functions, and improving frontend error handling.

**Tech Stack:** Motoko (ICP canister), React + TypeScript + TanStack Query (frontend), ICRC-1/ICRC-2 token standard

**Build/Deploy:**
```bash
cd ~/final-score
export DFX_WARNING=-mainnet_plaintext_identity
dfx build final_score --network ic
yes | dfx deploy final_score --network ic --identity pp_owner
# Frontend (only if frontend changes):
yes | dfx deploy --network ic --identity pp_owner
```

**QA:**
```bash
bash scripts/qa-trading.sh
```

---

## Phase 1: Token Safety (CRITICAL — must fix before public)

### Task 1: Atomic per-fill state commits

**Objective:** Prevent orphaned tokens when the canister traps mid-fill loop. Currently, the fill loop does N async transfer pairs, then commits all state at the end. If a trap occurs after fill 2 of 5, the first 2 fills have real tokens on the ledger but no position records.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo` — `place_order` function (~line 1075-1250)
- Modify: `packages/canisters/final_score/src/tools/order_place.mo` — `handle` function (~line 145-300)

**Current problem:**
```
matchOrder() → fills = [fill1, fill2, fill3]
for each fill:
  await transfer_from(taker)   ← committed on ledger
  await transfer_from(maker)   ← committed on ledger
  create positions             ← IN MEMORY ONLY
  create trade record          ← IN MEMORY ONLY
update order book              ← IN MEMORY ONLY
← if trap here, all in-memory state is lost but ledger transfers persist
```

**Fix approach:** After each successful fill (both transfers + positions), immediately update the order book to reflect that fill. Move the book update and order status update INSIDE the fill loop, not after it.

**Step 1:** In `main.mo` `place_order`, restructure the fill loop:

```motoko
// BEFORE: var finalBook = result.updatedBook; (after loop)
// AFTER: update book incrementally inside the loop

var currentBook = book; // start with the pre-match book

for (fill in result.fills.vals()) {
  // ... transfer taker, transfer maker (existing safety logic) ...
  
  if (both transfers succeeded) {
    // Commit positions, trade, stats (existing code)
    
    // IMMEDIATELY update the book — remove the consumed maker order
    currentBook := OrderBook.removeOrder(currentBook, fill.makerOrderId, makerOutcome);
    Map.set(orderBooks, thash, marketId, currentBook);
    
    // Update maker order status immediately
    switch (Map.get(toolContext.orders, Map.thash, fill.makerOrderId)) { ... };
  };
};

// Insert remainder (if any) into the already-updated book
var finalBook = currentBook;
let finalOrder = switch (result.remainingOrder) {
  case (?remaining) {
    finalBook := OrderBook.insertOrder(finalBook, remaining);
    ...
  };
  ...
};
Map.set(orderBooks, thash, marketId, finalBook);
```

**Key insight:** `OrderBook.removeOrder` already exists and works. We just need to call it per-fill instead of relying on `result.updatedBook` (which was computed before any async happened).

**Step 2:** Apply identical restructuring to `order_place.mo`.

**Step 3:** Verify — run QA script. All 17 tests should pass.

**Step 4:** Commit: `fix: atomic per-fill state commits — prevent orphaned tokens on trap`

---

### Task 2: Fix netting — transfer before deleting positions

**Objective:** Don't delete positions until the refund transfer is confirmed. Currently `netPositions()` deletes positions first, then transfers. If transfer fails, positions are gone AND tokens stuck.

**Files:**
- Modify: `packages/canisters/final_score/src/tools/ToolContext.mo` — `netPositions` function (~line 358-415)
- Modify: `packages/canisters/final_score/src/main.mo` — netting block (~line 1207-1235)
- Modify: `packages/canisters/final_score/src/tools/order_place.mo` — netting block (~line 260-295)

**Fix approach:** Split `netPositions` into two functions:
1. `getNetOverlap(context, user, marketId) : Nat` — returns the overlap count WITHOUT modifying state
2. `commitNet(context, user, marketId, amount)` — actually deletes the positions

**Step 1:** Add `getNetOverlap` to ToolContext.mo:

```motoko
/// Check how many Yes+No pairs overlap WITHOUT modifying state
public func getNetOverlap(context : ToolContext, user : Principal, marketId : Text) : Nat {
  let yesPos = findPosition(context, user, marketId, #Yes);
  let noPos = findPosition(context, user, marketId, #No);
  switch (yesPos, noPos) {
    case (?yes, ?no) Nat.min(yes.shares, no.shares);
    case _ 0;
  };
};
```

**Step 2:** Rename existing `netPositions` to `commitNet` (or keep it as-is since it already does the deletion).

**Step 3:** Update netting blocks in both `main.mo` and `order_place.mo`:

```motoko
let overlap = ToolContext.getNetOverlap(toolContext, user, marketId);
if (overlap > 0) {
  let payout = overlap * ToolContext.SHARE_VALUE;
  if (payout > ToolContext.TRANSFER_FEE) {
    let refundOk = try {
      let result = await ledger.icrc1_transfer({ ... });
      switch (result) { case (#Ok(_)) true; case (#Err(_)) false };
    } catch (_e) { false };
    
    if (refundOk) {
      // Only NOW delete the positions
      ignore ToolContext.netPositions(toolContext, user, marketId);
    } else {
      Debug.print("Netting refund failed — positions preserved for retry");
    };
  };
};
```

**Step 4:** Run QA. Verify netting still works on happy path.

**Step 5:** Commit: `fix: netting transfers before deleting positions — no token loss on failed refund`

---

### Task 3: Guard admin_drain_market_subaccount

**Objective:** Prevent draining funds from active markets. Currently owner can drain any market subaccount at any time.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo` — `admin_drain_market_subaccount` (~line 1586-1655)

**Step 1:** Add a guard at the top of the function:

```motoko
public shared ({ caller }) func admin_drain_market_subaccount(marketId : Text) : async Result.Result<Text, Text> {
  if (caller != owner) return #err("Unauthorized: owner only");

  // Only allow draining resolved or cancelled markets
  switch (Map.get(markets, thash, marketId)) {
    case (?market) {
      switch (market.status) {
        case (#Resolved(_)) {}; // OK
        case (#Cancelled) {};   // OK
        case _ return #err("Cannot drain active market. Status: " # ToolContext.marketStatusToText(market.status));
      };
    };
    case null {}; // Market not found — allow drain (could be leftover from cleared markets)
  };

  // ... existing drain logic ...
};
```

**Step 2:** Commit: `fix: guard admin_drain — only resolved/cancelled markets`

---

### Task 4: Restore ghost orders on maker transfer failure

**Objective:** When a maker's transfer fails, their resting order has already been consumed from the book by `matchOrder()`. It becomes a ghost — not on the book, not cancelled. Fix: re-insert it.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo` — maker failure block in fill loop
- Modify: `packages/canisters/final_score/src/tools/order_place.mo` — same

**Step 1:** In the `if (not makerOk)` block, after refunding taker, re-insert the maker order:

```motoko
if (not makerOk) {
  // Refund the taker (existing code)
  try { ignore await ledger.icrc1_transfer({ ... }); } catch (e) { ... };
  
  // Re-insert maker's order back into the book
  // The order was consumed by matchOrder — put it back
  switch (Map.get(toolContext.orders, Map.thash, fill.makerOrderId)) {
    case (?makerOrder) {
      let restoredBook = OrderBook.insertOrder(
        switch (Map.get(orderBooks, thash, marketId)) { case (?b) b; case null OrderBook.emptyBook() },
        makerOrder
      );
      Map.set(orderBooks, thash, marketId, restoredBook);
      Debug.print("Restored maker order " # fill.makerOrderId # " to book");
    };
    case null {};
  };
  
  Debug.print("Skipping fill — maker transfer failed, taker refunded");
} else { ... }
```

**Note:** With Task 1's per-fill book updates, we need to use `currentBook` instead of re-reading from `orderBooks`. Adjust accordingly based on Task 1 implementation.

**Step 2:** Apply same fix to `order_place.mo`.

**Step 3:** Commit: `fix: restore ghost orders when maker transfer fails`

---

### Task 5: Cap fills per order to prevent instruction limit traps

**Objective:** Prevent a single order from matching so many resting orders that the fill loop exceeds ICP's instruction limit (~5B instructions per message).

**Files:**
- Modify: `packages/canisters/final_score/src/tools/OrderBook.mo` — `matchOrder` function
- Modify: `packages/canisters/final_score/src/tools/ToolContext.mo` — add constant

**Step 1:** Add a constant to ToolContext.mo:

```motoko
/// Maximum fills per order placement (prevents instruction limit traps)
public let MAX_FILLS_PER_ORDER : Nat = 10;
```

**Step 2:** In `OrderBook.matchOrder`, add a fill count limit:

```motoko
public func matchOrder(book : Book, order : ToolContext.Order) : MatchResult {
  // ... existing setup ...
  var fillCount : Nat = 0;

  for (level in contraLevels.vals()) {
    if (doneMatching or remainingSize == 0 or fillCount >= ToolContext.MAX_FILLS_PER_ORDER) {
      updatedContraLevels := Array.append(updatedContraLevels, [level]);
    } else {
      // ... existing matching logic ...
      // Inside the inner loop, after each fill:
      fillCount += 1;
      if (fillCount >= ToolContext.MAX_FILLS_PER_ORDER) {
        // Keep remaining orders at this level
        // ... append remaining to updatedOrders ...
      };
    };
  };
  // ...
};
```

**Step 3:** The remaining unfilled portion of the order rests on the book as usual. The user can call `place_order` again to match more.

**Step 4:** Commit: `fix: cap fills per order at 10 — prevent instruction limit traps`

---

## Phase 2: UX Safety (SHOULD FIX — trust for external users)

### Task 6: Show fees in order form

**Objective:** Users should see the real cost (including 1% taker fee) and potential payout (minus 2% rake) before submitting.

**Files:**
- Modify: `packages/apps/website/src/pages/EventPage.tsx` — order form cost/payout display (~line 167-169)

**Step 1:** Update the cost and payout calculations:

```tsx
// Current:
const totalCost = priceNum * sizeNum;
const potentialPayout = sizeNum * 1.0;

// Fixed:
const baseCost = priceNum * sizeNum;
const takerFee = baseCost * 0.01; // 1% taker fee
const totalCost = baseCost + takerFee;
const grossPayout = sizeNum * 1.0;
const protocolRake = grossPayout * 0.02; // 2% rake on winnings
const potentialPayout = grossPayout - protocolRake;
```

**Step 2:** Update the display to show fees:

```tsx
<div className="text-sm text-muted-foreground">
  Cost: ${baseCost.toFixed(2)} + ${takerFee.toFixed(2)} fee = ${totalCost.toFixed(2)}
</div>
<div className="text-sm text-muted-foreground">
  Payout if correct: ${potentialPayout.toFixed(2)} (after 2% rake)
</div>
```

**Step 3:** Rebuild frontend: `cd packages/apps/website && pnpm build`

**Step 4:** Commit: `feat: show taker fee and protocol rake in order form`

---

### Task 7: Pre-flight balance + allowance check in frontend

**Objective:** Check balance and allowance before submitting order. Show inline error instead of waiting for canister error toast.

**Files:**
- Modify: `packages/apps/website/src/pages/EventPage.tsx` — order submit handler
- Read: `packages/apps/website/src/hooks/useLedger.ts` (existing balance hook)
- Read: `packages/apps/website/src/hooks/useAllowance.ts` (existing allowance hook)

**Step 1:** In EventPage, import and use the existing hooks:

```tsx
const { data: balance } = useUsdcBalance(user?.principal);
const { data: allowance } = useAllowance(user?.principal);
```

**Step 2:** Add validation before the `placeOrder` mutation:

```tsx
const handleSubmit = async () => {
  const totalCostAtomic = Math.ceil(totalCost * 1_000_000);
  
  if (!balance || Number(balance) * 1_000_000 < totalCostAtomic) {
    setError(`Insufficient balance. You have $${Number(balance ?? 0).toFixed(2)} USDC.`);
    return;
  }
  
  if (!allowance || Number(allowance) * 1_000_000 < totalCostAtomic) {
    setError(`Insufficient allowance. Set allowance in Wallet drawer.`);
    return;
  }
  
  // proceed with order...
};
```

**Step 3:** Show error inline above the submit button, not as a toast.

**Step 4:** Commit: `feat: pre-flight balance/allowance check in order form`

---

### Task 8: New user onboarding — faucet guidance

**Objective:** When a connected user has 0 balance, show a message about how to get test tokens.

**Files:**
- Modify: `packages/apps/website/src/components/WalletDrawer.tsx` — balance section

**Step 1:** Add a conditional below the balance display:

```tsx
{Number(balance ?? 0) === 0 && (
  <div className="p-3 bg-blue-950/30 border border-blue-800/50 rounded-lg text-sm">
    <p className="font-medium text-blue-400">No USDC balance</p>
    <p className="text-muted-foreground mt-1">
      This platform uses test USDC tokens. Visit the{' '}
      <a 
        href="https://3jkp5-oyaaa-aaaaj-azwqa-cai.icp0.io" 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-blue-400 underline"
      >
        faucet
      </a>
      {' '}to get some, then set an allowance below.
    </p>
  </div>
)}
```

**Note:** Check if the faucet has a web UI. If not, provide instructions for using dfx or a claim button. Update the URL accordingly.

**Step 2:** Commit: `feat: new user onboarding — faucet guidance when balance is 0`

---

### Task 9: Order confirmation dialog

**Objective:** Add a confirmation step before placing orders to prevent accidental trades.

**Files:**
- Modify: `packages/apps/website/src/pages/EventPage.tsx` — order submit flow

**Step 1:** Add a confirmation state:

```tsx
const [showConfirm, setShowConfirm] = useState(false);
const [pendingOrder, setPendingOrder] = useState<{...} | null>(null);
```

**Step 2:** On submit, show confirmation instead of immediately placing:

```tsx
// First click → show confirmation
const handleSubmit = () => {
  setPendingOrder({ marketId, outcome, price: priceNum, size: sizeNum, totalCost, potentialPayout });
  setShowConfirm(true);
};

// Confirm click → place order
const handleConfirm = async () => {
  setShowConfirm(false);
  // ... existing placeOrder mutation ...
};
```

**Step 3:** Render a simple inline confirmation:

```tsx
{showConfirm && pendingOrder && (
  <div className="p-3 bg-muted rounded-lg space-y-2">
    <p className="text-sm font-medium">Confirm order?</p>
    <p className="text-sm text-muted-foreground">
      Buy {pendingOrder.size} {pendingOrder.outcome} @ ${pendingOrder.price.toFixed(2)} = ${pendingOrder.totalCost.toFixed(2)}
    </p>
    <div className="flex gap-2">
      <Button size="sm" onClick={handleConfirm}>Confirm</Button>
      <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
    </div>
  </div>
)}
```

**Step 4:** Commit: `feat: order confirmation dialog before placing trades`

---

### Task 10: Basic rate limiting on place_order

**Objective:** Prevent spam. Add a per-user cooldown between order placements.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo` — `place_order` function top

**Step 1:** Add a cooldown map near the top of the actor:

```motoko
// Rate limiting: 2-second cooldown between orders per user
var lastOrderTime = Map.new<Principal, Int>();
let ORDER_COOLDOWN_NS : Int = 2_000_000_000; // 2 seconds in nanoseconds
```

**Step 2:** Add the check at the start of `place_order`:

```motoko
let now = Time.now();
switch (Map.get(lastOrderTime, Map.phash, caller)) {
  case (?last) {
    if (now - last < ORDER_COOLDOWN_NS) {
      return #err("Rate limited. Wait 2 seconds between orders.");
    };
  };
  case null {};
};
Map.set(lastOrderTime, Map.phash, caller, now);
```

**Step 3:** Apply same check to the MCP `order_place.mo` handler (pass `lastOrderTime` via context or add to ToolContext).

**Step 4:** Commit: `feat: 2-second per-user rate limit on place_order`

---

## Phase 3: Polish (NICE TO HAVE — credibility)

### Task 11: Clean up resolved positions

**Objective:** After resolution payouts, zero out position shares so they stop appearing in active position queries.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo` — `admin_resolve_market_internal` (~line 740-815)

**Step 1:** After recording settlement, zero out the position:

```motoko
// After recordSettlement and addHistoricalPosition:
Map.set(positions, thash, posId, { position with shares = 0; costBasis = 0 });
```

**Step 2:** Commit: `fix: zero out resolved positions to prevent unbounded growth`

---

### Task 12: Index orders by user for getLockedBalance

**Objective:** Replace O(n) scan of all orders with O(1) lookup by user.

**Files:**
- Modify: `packages/canisters/final_score/src/tools/ToolContext.mo` — ToolContext type + getLockedBalance
- Modify: `packages/canisters/final_score/src/main.mo` — add userOrderIds map

**Step 1:** Add a `userOrderIds` map to ToolContext (like `userPositionIds`):

```motoko
// In ToolContext type:
userOrderIds : Map.Map<Principal, [Text]>;
```

**Step 2:** Update `getLockedBalance` to only scan user's orders:

```motoko
public func getLockedBalance(context : ToolContext, user : Principal) : Nat {
  let orderIds = switch (Map.get(context.userOrderIds, Map.phash, user)) {
    case (?ids) ids;
    case null return 0;
  };
  var locked : Nat = 0;
  for (orderId in orderIds.vals()) {
    switch (Map.get(context.orders, Map.thash, orderId)) {
      case (?order) {
        if (order.status == #Open or order.status == #PartiallyFilled) {
          let remaining = order.size - order.filledSize;
          locked += (remaining * order.price * SHARE_VALUE) / BPS_DENOM;
        };
      };
      case null {};
    };
  };
  locked;
};
```

**Step 3:** Maintain the index when creating/cancelling orders in both main.mo and order_place.mo.

**Step 4:** Commit: `perf: index orders by user for O(1) locked balance lookup`

---

### Task 13: Remove Debug.print in production paths

**Objective:** Reduce cycle burn from debug logging.

**Files:**
- Modify: `packages/canisters/final_score/src/main.mo`
- Modify: `packages/canisters/final_score/src/tools/order_place.mo`

**Step 1:** Replace `Debug.print` in hot paths (fill loop, resolution) with a no-op or conditional:

```motoko
// Option A: Remove entirely
// Option B: Add a debug flag
var debugMode : Bool = false;

func debugLog(msg : Text) {
  if (debugMode) Debug.print(msg);
};
```

**Step 2:** Keep Debug.print only in error/catch paths where it's essential for diagnosing failures.

**Step 3:** Commit: `perf: remove hot-path Debug.print to save cycles`

---

### Task 14: Set default allowance expiration

**Objective:** Allowances should expire to limit exposure if wallet is compromised.

**Files:**
- Modify: `packages/libs/ic-js/src/api/ledger.api.ts` — `approveUsdc` function
- Modify: `packages/apps/website/src/hooks/useAllowance.ts`

**Step 1:** Set a 7-day expiration on approve:

```typescript
const SEVEN_DAYS_NS = BigInt(7 * 24 * 60 * 60) * BigInt(1_000_000_000);
const expiresAt = BigInt(Date.now()) * BigInt(1_000_000) + SEVEN_DAYS_NS;

const result = await ledger.icrc2_approve({
  // ... existing fields ...
  expires_at: [expiresAt],
});
```

**Step 2:** Show expiration in AllowanceManager UI.

**Step 3:** Commit: `feat: 7-day allowance expiration by default`

---

## Verification Checklist

After all tasks, run:

```bash
# 1. Build both canisters
cd ~/final-score
export DFX_WARNING=-mainnet_plaintext_identity
dfx build final_score --network ic
cd packages/apps/website && pnpm build && cd ../../..

# 2. Deploy
yes | dfx deploy --network ic --identity pp_owner

# 3. Run QA script
bash scripts/qa-trading.sh

# 4. Manual smoke tests:
#    - Connect wallet as new user (should see faucet guidance)
#    - Get test tokens from faucet
#    - Set allowance
#    - Place order (should see fee breakdown + confirmation)
#    - Place counter-order from second identity
#    - Verify positions, netting, resolution payout
#    - Try with 0 allowance (should see inline error)
#    - Try rapid-fire orders (should hit rate limit)
```

---

## Task Dependencies

```
Phase 1 (sequential — each builds on previous):
  Task 1 (atomic fills) ← foundation for all other safety
  Task 2 (netting safety) ← depends on Task 1 structure
  Task 3 (admin guard) ← independent
  Task 4 (ghost orders) ← depends on Task 1 structure
  Task 5 (fill cap) ← independent

Phase 2 (parallel — all independent):
  Task 6-9 (frontend) ← can do in any order
  Task 10 (rate limit) ← independent

Phase 3 (parallel — all independent):
  Tasks 11-14 ← can do in any order after Phase 1
```
