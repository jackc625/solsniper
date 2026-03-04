---
phase: quick-5
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/execution/sell/sell-ladder.ts
  - src/execution/sell/sell-ladder.test.ts
  - src/position/position-manager.ts
  - src/persistence/trade-store.ts
autonomous: true
requirements: [QUICK-5]

must_haves:
  truths:
    - "After a partial tiered TP sell succeeds, the trade returns to MONITORING state (not COMPLETED)"
    - "amount_tokens in the DB is decremented by the sold amount after a partial sell"
    - "The final tier sell still transitions to COMPLETED as before"
    - "Stop-loss, trailing-stop, and full sells (non-tiered) still transition to COMPLETED"
  artifacts:
    - path: "src/execution/sell/sell-ladder.ts"
      provides: "Partial-sell-aware sell ladder with SELLING->MONITORING transition"
    - path: "src/persistence/trade-store.ts"
      provides: "decrementTokenAmount method for atomic amount_tokens reduction"
    - path: "src/position/position-manager.ts"
      provides: "Passes partial flag to sell ladder for tiered TP"
    - path: "src/execution/sell/sell-ladder.test.ts"
      provides: "Tests covering partial sell -> MONITORING and final tier -> COMPLETED"
  key_links:
    - from: "src/position/position-manager.ts"
      to: "src/execution/sell/sell-ladder.ts"
      via: "fireSell passes partial boolean to sell()"
      pattern: "sellLadder\\.sell\\(mint.*partial"
    - from: "src/execution/sell/sell-ladder.ts"
      to: "src/persistence/trade-store.ts"
      via: "decrementTokenAmount after partial sell success"
      pattern: "tradeStore\\.decrementTokenAmount"
---

<objective>
Fix tiered take-profit partial sells: after a partial tier sell succeeds, the sell ladder must transition SELLING -> MONITORING (not COMPLETED) and decrement amount_tokens in the DB so subsequent tiers evaluate correctly off the remaining balance.

Purpose: Currently, any successful sell -- even a 33% tier sell -- unconditionally transitions to COMPLETED, killing the trade and abandoning the remaining 67% of tokens.

Output: Working tiered TP with proper state cycling: MONITORING -> SELLING -> MONITORING -> SELLING -> ... -> COMPLETED
</objective>

<execution_context>
@C:/Users/jackc/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/jackc/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/execution/sell/sell-ladder.ts
@src/execution/sell/sell-ladder.test.ts
@src/position/position-manager.ts
@src/persistence/trade-store.ts
@src/types/index.ts

Key interfaces the executor needs:

```typescript
// From src/types/index.ts
export interface SellResult {
  success: boolean;
  step?: SellStep;
  signature?: string;
  errorMessage?: string;
}

// From src/persistence/trade-store.ts - transition() signature:
transition(mint: string, from: TradeState, to: TradeState, extra?: Partial<Pick<Trade, ...>>): number;

// From src/persistence/trade-store.ts - updateMonitoringAmount() signature:
updateMonitoringAmount(mint: string, amountTokens: number): number;

// From src/execution/sell/sell-ladder.ts - current sell() signature:
async sell(mint: string, tokenAmount: bigint, fallbackSolReceived?: number): Promise<SellResult>
```

Bug location: sell-ladder.ts lines 212-216 unconditionally transitions SELLING -> COMPLETED after ANY successful sell, even partial tier sells.

Position manager fires tiered TP sells via fireSell() (line 391-400) which is fire-and-forget. The tier index is advanced at line 294 BEFORE the sell completes, which is fine because sellsInFlight guard (line 165) prevents re-evaluation during selling.

The sell-ladder needs to know whether this is a partial sell so it can choose SELLING->MONITORING vs SELLING->COMPLETED. The cleanest approach: add a `partial` boolean parameter.

For tiered TP, `partial=true` when there are more tiers remaining after the current one. For the LAST tier, `partial=false` so it transitions to COMPLETED normally. For stop-loss/trailing-stop/max-hold-time sells, `partial=false`.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add decrementTokenAmount to TradeStore and partial sell logic to SellLadder</name>
  <files>
    src/persistence/trade-store.ts
    src/execution/sell/sell-ladder.ts
    src/execution/sell/sell-ladder.test.ts
    src/position/position-manager.ts
  </files>
  <behavior>
    - Test: partial=true sell succeeds -> tradeStore.transition called with SELLING->MONITORING (not COMPLETED)
    - Test: partial=true sell succeeds -> tradeStore.decrementTokenAmount called with mint and sold token amount
    - Test: partial=false sell succeeds -> tradeStore.transition called with SELLING->COMPLETED (existing behavior)
    - Test: partial=true, first tier (no prior sellPriceSol) -> addSellPrice called, then SELLING->MONITORING
    - Test: partial=true, subsequent tier (has prior sellPriceSol) -> addSellPrice called, SELL_PARTIAL emitted, then SELLING->MONITORING
    - Test: all steps exhaust with partial=true -> still transitions SELLING->FAILED
  </behavior>
  <action>
**1. TradeStore: Add decrementTokenAmount method** (src/persistence/trade-store.ts)

Add a new prepared statement and method:

```typescript
// New prepared statement (add after stmtAddSellPrice):
private readonly stmtDecrementTokenAmount: BetterSqlite3.Statement;

// In constructor, after stmtAddSellPrice initialization:
this.stmtDecrementTokenAmount = this.db.prepare(
  `UPDATE trades SET
     amount_tokens = amount_tokens - @delta,
     updated_at = @now
   WHERE mint = @mint AND state = 'MONITORING'`
);

// New public method (add after addSellPrice):
/**
 * Decrements amount_tokens by delta for a MONITORING trade.
 * Used after a partial tiered TP sell succeeds: the sold amount is
 * subtracted so subsequent tiers calculate against remaining balance.
 *
 * Only updates trades in MONITORING state.
 * Returns number of rows changed (0 if trade not in MONITORING state).
 */
decrementTokenAmount(mint: string, delta: number): number {
  const result = this.stmtDecrementTokenAmount.run({
    mint,
    delta,
    now: Date.now(),
  });
  return result.changes;
}
```

**2. SellLadder: Add `partial` parameter and conditional transition** (src/execution/sell/sell-ladder.ts)

Change the `sell()` signature to accept a `partial` boolean (default `false`):

```typescript
async sell(mint: string, tokenAmount: bigint, fallbackSolReceived?: number, partial = false): Promise<SellResult>
```

In the `if (stepSucceeded)` block (lines 192-227), restructure the logic:

- ALWAYS call `addSellPrice` when `solReceived != null` (not just when `hasPriorSellPrice`). This handles the first tier too.
- Emit `SELL_PARTIAL` when `hasPriorSellPrice && solReceived != null` (keep existing behavior for subsequent tiers).
- **Also emit SELL_PARTIAL for the FIRST tier** when `partial=true && solReceived != null && !hasPriorSellPrice` (new: first tier also gets a SELL_PARTIAL event).
- When `partial=true`: transition `SELLING -> MONITORING` (NOT COMPLETED), call `decrementTokenAmount(mint, Number(tokenAmount))`, do NOT emit SELL_CONFIRMED, and return `{ success: true, step: step.name, signature }`.
- When `partial=false`: transition `SELLING -> COMPLETED` (existing behavior), emit SELL_CONFIRMED, return as before.

Replacement for the `if (stepSucceeded)` block (lines 192-227):

```typescript
if (stepSucceeded) {
  // Accumulate sell price for tiered TP tracking (crash-safe SQL increment)
  if (solReceived != null) {
    this.tradeStore.addSellPrice(mint, solReceived);
  }

  // Detect partial sell context for event emission
  const priorTrade = this.tradeStore.getTradeByMint(mint);
  const hasPriorSellPrice = priorTrade?.sellPriceSol != null && priorTrade.sellPriceSol > 0;

  if (partial) {
    // --- PARTIAL SELL: return to MONITORING for next tier ---

    // Emit SELL_PARTIAL event
    const totalSellPrice = priorTrade?.sellPriceSol ?? 0;
    botEventBus.emit('event', {
      type: 'SELL_PARTIAL',
      mint,
      ts: Date.now(),
      detail: `${step.name}: +${(solReceived ?? 0).toFixed(6)} SOL (total: ${totalSellPrice.toFixed(6)} SOL)`,
      isDryRun: getRuntimeConfig().dryRun,
      pnlSol: solReceived,
    });
    log.info({ mint, step: step.name, tierSolReceived: solReceived, totalSellPrice }, 'Partial sell confirmed -- returning to MONITORING');

    // Transition SELLING -> MONITORING (not COMPLETED)
    this.tradeStore.transition(mint, 'SELLING', 'MONITORING', {
      sellSignature: signature,
    });

    // Decrement amount_tokens by the sold amount so next tier uses remaining balance
    this.tradeStore.decrementTokenAmount(mint, Number(tokenAmount));

    return { success: true, step: step.name, signature };
  }

  // --- FULL SELL: transition to COMPLETED ---

  // Emit SELL_PARTIAL for accumulated tiers context (if this is the final tier after prior partials)
  if (hasPriorSellPrice && solReceived != null) {
    const runningTotal = priorTrade.sellPriceSol! + solReceived;
    botEventBus.emit('event', {
      type: 'SELL_PARTIAL',
      mint,
      ts: Date.now(),
      detail: `${step.name}: +${solReceived.toFixed(6)} SOL (total: ${runningTotal.toFixed(6)} SOL)`,
      isDryRun: getRuntimeConfig().dryRun,
      pnlSol: solReceived,
    });
  }

  // Transition SELLING -> COMPLETED with sellPriceSol
  this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', {
    sellSignature: signature,
    sellPriceSol: solReceived,
  });

  const completedTrade = this.tradeStore.getTradeByMint(mint);
  const pnlSol = (completedTrade?.sellPriceSol != null && completedTrade?.amountSol != null)
    ? completedTrade.sellPriceSol - completedTrade.amountSol
    : undefined;
  botEventBus.emit('event', { type: 'SELL_CONFIRMED', mint, ts: Date.now(), detail: step.name, isDryRun: getRuntimeConfig().dryRun, pnlSol });
  log.info({ mint, step: step.name, signature, solReceived, pnlSol }, 'Sell confirmed -- trade COMPLETED');
  return { success: true, step: step.name, signature };
}
```

IMPORTANT: The `addSellPrice` call is BEFORE the `getTradeByMint` call so that `priorTrade.sellPriceSol` reflects the already-accumulated total (including the current tier's contribution). This means for the partial path, `totalSellPrice` already includes this tier.

IMPORTANT: For the `partial=false` (COMPLETED) path, keep the existing pattern of passing `sellPriceSol: solReceived` to transition(). This is correct because `addSellPrice` already accumulated into the DB -- the transition's COALESCE will keep the accumulated value since the transition's `sellPriceSol` goes through `COALESCE(@sell_price_sol, sell_price_sol)`. Wait -- actually COALESCE takes the NEW value first, so passing `solReceived` would OVERWRITE the accumulated total. Fix: pass `sellPriceSol: undefined` (or omit it) when `hasPriorSellPrice` is true, so the accumulated value in DB is preserved via COALESCE. When `hasPriorSellPrice` is false (normal non-tiered sell), pass `sellPriceSol: solReceived` as before.

Correction to the COMPLETED transition:
```typescript
this.tradeStore.transition(mint, 'SELLING', 'COMPLETED', {
  sellSignature: signature,
  // Don't overwrite accumulated sell_price_sol from addSellPrice -- let COALESCE preserve it
  sellPriceSol: hasPriorSellPrice ? undefined : solReceived,
});
```

**3. PositionManager: Pass `partial` flag to fireSell** (src/position/position-manager.ts)

Update `fireSell` signature to accept `partial`:
```typescript
private fireSell(mint: string, tokensToSell: bigint, partial = false): void {
  this.sellsInFlight.add(mint);
  const fallbackSolValue = this.lastKnownQuoteSol.get(mint);
  const p = this.sellLadder.sell(mint, tokensToSell, fallbackSolValue, partial);
  void p;
  p.finally(() => {
    this.sellsInFlight.delete(mint);
  });
}
```

Update the tiered TP fireSell call (line 293) to pass `partial=true` when there are more tiers remaining:
```typescript
// In the tiered TP block (around line 293):
const isPartial = nextTierIndex < tieredTp.length;
this.fireSell(mint, tokensToSell, isPartial);
this.tierIndices.set(mint, nextTierIndex);
```

All other fireSell calls (trailing stop, stop-loss, max-hold-time, Jupiter route failure) remain `partial=false` (default).

**4. Update sell-ladder.test.ts** with new tests and fix existing tests:

Add `decrementTokenAmount` to the mock `makeTradeStore`:
```typescript
function makeTradeStore(overrides?: { getTradeByMintResult?: Partial<Trade> | undefined }) {
  return {
    transition: vi.fn().mockReturnValue(1),
    getTradeByMint: vi.fn().mockReturnValue(overrides?.getTradeByMintResult),
    addSellPrice: vi.fn().mockReturnValue(1),
    decrementTokenAmount: vi.fn().mockReturnValue(1),
  };
}
```

Add new tests:

a) `partial=true sell succeeds -- transitions SELLING->MONITORING and decrements tokens`:
   - mockStandardSell resolves with signature + solReceived
   - Call sell(MINT, TOKEN_AMOUNT, undefined, true)
   - Assert tradeStore.transition called with (MINT, 'SELLING', 'MONITORING', ...)
   - Assert tradeStore.decrementTokenAmount called with (MINT, Number(TOKEN_AMOUNT))
   - Assert tradeStore.addSellPrice called with (MINT, solReceived)
   - Assert result is { success: true, step: 'STANDARD', signature: ... }

b) `partial=false sell succeeds -- transitions SELLING->COMPLETED (default behavior preserved)`:
   - Same setup but call sell(MINT, TOKEN_AMOUNT) without partial flag
   - Assert tradeStore.transition called with (MINT, 'SELLING', 'COMPLETED', ...)
   - Assert tradeStore.decrementTokenAmount NOT called

c) `partial=true all steps exhaust -- still transitions SELLING->FAILED`:
   - All steps hang/timeout
   - Call sell(MINT, TOKEN_AMOUNT, undefined, true)
   - Assert tradeStore.transition called with (MINT, 'SELLING', 'FAILED', ...)

d) Fix the existing "pnlSol is computed as sellPriceSol - amountSol" test if needed -- since addSellPrice is now called before getTradeByMint, the mock return value should reflect the accumulated total.

IMPORTANT: The existing tests that call sell() without a `partial` parameter should continue to pass unchanged since `partial` defaults to `false`.
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk vitest run src/execution/sell/sell-ladder.test.ts</automated>
  </verify>
  <done>
    - partial=true: sell ladder transitions SELLING->MONITORING (not COMPLETED) after successful sell
    - partial=true: decrementTokenAmount called with sold amount
    - partial=true: addSellPrice called to accumulate sell proceeds
    - partial=false: existing SELLING->COMPLETED behavior preserved for stop-loss, trailing-stop, full sells
    - All existing tests still pass
    - New tests cover partial sell -> MONITORING and final tier -> COMPLETED paths
    - PositionManager passes partial=true for non-final tiers, partial=false for final tier
  </done>
</task>

<task type="auto">
  <name>Task 2: TypeScript compilation and full test suite verification</name>
  <files>
    src/execution/sell/sell-ladder.ts
    src/position/position-manager.ts
    src/persistence/trade-store.ts
  </files>
  <action>
Run TypeScript compilation to verify no type errors introduced by the changes. Then run the full test suite to ensure no regressions.

If tsc fails, fix type errors. Common issues:
- If `partial` parameter causes type mismatch in existing call sites, verify all callers pass correct types
- If `decrementTokenAmount` is not recognized, ensure the method is properly exported on TradeStore class

If any position-manager tests fail, check that the mock SellLadder.sell() signature matches the updated 4-parameter version.
  </action>
  <verify>
    <automated>cd C:/Users/jackc/Code/solsniper && rtk tsc --noEmit && rtk vitest run</automated>
  </verify>
  <done>
    - tsc --noEmit passes with zero errors
    - Full vitest suite passes (all existing + new tests green)
    - No regressions in position-manager, trade-store, or other test files
  </done>
</task>

</tasks>

<verification>
1. `rtk tsc --noEmit` -- zero type errors
2. `rtk vitest run src/execution/sell/sell-ladder.test.ts` -- all sell ladder tests pass including new partial sell tests
3. `rtk vitest run` -- full suite green, no regressions
</verification>

<success_criteria>
- Tiered TP partial sells transition SELLING -> MONITORING (not COMPLETED)
- amount_tokens decremented in DB after each partial tier sell
- Final tier sell transitions SELLING -> COMPLETED as before
- Stop-loss, trailing-stop, max-hold-time sells are unaffected (still COMPLETED)
- addSellPrice accumulates correctly across tiers
- All existing tests continue to pass
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/5-fix-tiered-take-profit-partial-sells-mus/5-SUMMARY.md`
</output>
