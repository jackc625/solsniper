---
phase: quick-5
plan: "01"
subsystem: execution/sell
tags: [sell-ladder, tiered-tp, partial-sell, trade-store, position-manager]
dependency_graph:
  requires: []
  provides:
    - "Partial-sell-aware SellLadder with SELLING->MONITORING transition"
    - "decrementTokenAmount method on TradeStore for atomic token amount reduction"
    - "PositionManager passing partial=true for non-final tiered TP tiers"
  affects:
    - src/execution/sell/sell-ladder.ts
    - src/persistence/trade-store.ts
    - src/position/position-manager.ts
tech_stack:
  added: []
  patterns:
    - "partial=false default parameter -- backward-compatible 4th arg to sell()"
    - "addSellPrice called before getTradeByMint so accumulated total is reflected in event detail"
    - "COALESCE(sell_price_sol, 0) + delta -- crash-safe SQL accumulation pattern"
    - "isPartial = nextTierIndex < tieredTp.length -- final tier detection"
key_files:
  created: []
  modified:
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/persistence/trade-store.ts
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
decisions:
  - "partial=false default on sell() -- all existing callers work unchanged"
  - "addSellPrice before getTradeByMint so priorTrade.sellPriceSol reflects accumulated total including current tier"
  - "SELL_PARTIAL emitted for both first-tier and subsequent-tier partial sells (not just subsequent)"
  - "hasPriorSellPrice ? undefined : solReceived for COMPLETED transition -- avoids overwriting accumulated sell_price_sol via COALESCE"
  - "decrementTokenAmount only updates MONITORING state -- safe guard if transition races"
metrics:
  duration_minutes: 7
  completed_date: "2026-03-04"
  tasks_completed: 2
  files_changed: 5
  tests_added: 4
  tests_total: 296
---

# Quick Task 5: Fix Tiered Take-Profit Partial Sells Summary

**One-liner:** Partial tiered TP sells now cycle SELLING->MONITORING (not COMPLETED) and decrement amount_tokens, enabling subsequent tiers to fire against remaining balance.

## What Was Built

Fixed the critical bug where any successful sell -- even a 33% tier sell -- unconditionally transitioned to COMPLETED, killing the trade and abandoning the remaining 67% of tokens.

### Changes

**TradeStore** (`src/persistence/trade-store.ts`):
- Added `stmtDecrementTokenAmount` prepared statement: `UPDATE trades SET amount_tokens = amount_tokens - @delta WHERE mint = @mint AND state = 'MONITORING'`
- Added `decrementTokenAmount(mint, delta)` public method -- atomic amount_tokens reduction after partial sells

**SellLadder** (`src/execution/sell/sell-ladder.ts`):
- Added `partial = false` 4th parameter to `sell()` -- fully backward-compatible
- Restructured `stepSucceeded` block: `addSellPrice` always called first (before `getTradeByMint`) so the accumulated total is reflected in event detail
- `partial=true` path: transitions SELLING->MONITORING, emits SELL_PARTIAL, calls decrementTokenAmount, returns early (no SELL_CONFIRMED)
- `partial=false` path: existing behavior preserved -- transitions SELLING->COMPLETED, emits SELL_CONFIRMED
- Fixed COMPLETED transition: passes `sellPriceSol: hasPriorSellPrice ? undefined : solReceived` to avoid overwriting accumulated value via COALESCE

**PositionManager** (`src/position/position-manager.ts`):
- `fireSell()` now accepts `partial = false` 4th parameter, passes it through to `sellLadder.sell()`
- Tiered TP call: `const isPartial = nextTierIndex < tieredTp.length` -- partial=true for non-final tiers, partial=false for final tier
- All other fireSell callers (stop-loss, trailing-stop, max-hold-time, Jupiter route failure) remain partial=false (default)

**Tests** (`src/execution/sell/sell-ladder.test.ts`):
- Added `decrementTokenAmount: vi.fn()` to `makeTradeStore()` mock
- 4 new tests: partial sell transitions MONITORING, partial=false preserves COMPLETED, partial=true exhausted steps -> FAILED, SELL_PARTIAL emitted without SELL_CONFIRMED

**Tests** (`src/position/position-manager.test.ts`):
- Updated 10 existing `sell()` call assertions to include the 4th `partial` argument
- stop-loss, trailing-stop, max-hold-time, full sells: `partial=false`
- Tiered TP tier 0 and tier 1: `partial=true` (more tiers remain in 3-tier config)
- TP vs SL priority test: `partial=false` (single-tier config = final tier)

## State Cycling

Before fix:
```
MONITORING -> SELLING -> COMPLETED  (on ANY sell, even 33% tier)
```

After fix:
```
MONITORING -> SELLING -> MONITORING  (partial tier sell, returns for next tier)
MONITORING -> SELLING -> MONITORING  (next tier fires)
...
MONITORING -> SELLING -> COMPLETED   (final tier sell)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] position-manager.test.ts: 10 tests asserting 3-arg sell() call**
- **Found during:** Task 2 (full test suite run)
- **Issue:** Existing position-manager tests asserted `sell(mint, tokens, fallback)` with exactly 3 args; the new 4th `partial` arg caused assertion mismatches
- **Fix:** Updated all 10 affected test assertions to include the correct 4th argument (`false` for full sells, `true` for non-final tiered TP tiers)
- **Files modified:** src/position/position-manager.test.ts
- **Commit:** 175cf42

## Self-Check: PASSED

- src/execution/sell/sell-ladder.ts: FOUND
- src/persistence/trade-store.ts: FOUND
- src/position/position-manager.ts: FOUND
- Commit 968844e: FOUND
- Commit 175cf42: FOUND
- All 296 tests pass
- tsc --noEmit: zero errors
