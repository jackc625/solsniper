---
phase: 260322-q4u
plan: 01
subsystem: execution, recovery, config, safety, position-management
tags: [bug-fix, security, memory-leak, polling, deep-merge]
dependency_graph:
  requires: []
  provides: [jito-polling-loop, deep-merge-config, map-cleanup, api-key-masking]
  affects: [sell-ladder, recovery-manager, trading-config, tier3-creator, position-manager, jito-seller]
tech_stack:
  added: []
  patterns: [exponential-backoff-polling, 2-level-deep-merge, conditional-cleanup]
key_files:
  created:
    - src/config/trading.test.ts
  modified:
    - src/execution/sell/jito-seller.ts
    - src/recovery/recovery-manager.ts
    - src/config/trading.ts
    - src/execution/sell/sell-ladder.ts
    - src/position/position-manager.ts
    - src/safety/checks/tier3-creator.ts
    - src/recovery/recovery-manager.test.ts
    - src/execution/sell/jito-seller.test.ts
    - src/position/position-manager.test.ts
decisions:
  - "pollBundleStatus uses while(true) with exponential backoff (1s->2s->4s->5s cap) -- no internal timeout, relies on SellLadder Promise.race"
  - "patchRuntimeConfig deep merge is exactly 2 levels (matching TradingConfigSchema nesting depth) using Object.keys iteration"
  - "Map cleanup in fireSell .finally() is conditional on !partial flag -- preserves state for tiered TP re-entry"
  - "pollBundleStatus exported (@internal) for direct unit testing of polling behavior"
  - "SELL_TRIGGERED emission moved after zero-balance check -- uses freshBalance (not tokenAmount) in detail string"
metrics:
  duration: 8 min
  completed: "2026-03-22"
  tasks: 2
  files_modified: 10
  tests_added: 11
---

# Quick Task 260322-q4u: Fix Validated Bugs from Codebase Audit Summary

7 validated bugs fixed: Jito polling loop with exponential backoff, recovery counter accuracy, 2-level deep merge config patching, orphaned dashboard event elimination, double-count display correction, per-mint Map memory leak prevention, and API key masking in error logs.

## Task Results

### Task 1: Fix 5 localized bugs (BUG 2, 3, 4, 5, S1) [92c8c66]

**BUG 2 -- recovery-manager.ts:** Removed `sellingCompleted++` from the RPC failure catch block. RPC failures now correctly do not inflate the "sell assumed landed" counter. The trade transitions to FAILED via the DB, and the summary totals speak for themselves. Updated test assertion from `sellingCompleted: 1` to `sellingCompleted: 0` for the RPC timeout scenario.

**BUG 3 -- trading.ts:** Replaced shallow spread `{ ..._runtimeConfig, ...updates }` with a generic 2-level deep merge. For each key in updates: if both current and update values are non-null non-array plain objects, merge at level 1; for each sub-key, repeat the check for level 2 (handles safety.weights, safety.holder, execution.buy, execution.sell). Arrays (like tieredTp) are replaced atomically via `!Array.isArray()` guard. Created `src/config/trading.test.ts` with 5 tests covering: sibling preservation, 2-level nested merge, array replacement, primitive overwrite, and cross-section preservation (execution.sell patch preserves execution.buy).

**BUG 4 -- sell-ladder.ts:** Moved `SELL_TRIGGERED` event emission from line 68 (before zero-balance check) to after line 93 (after early return for empty wallet). Uses `freshBalance` instead of `tokenAmount` in the detail string. Dashboard no longer sees orphaned SELL_TRIGGERED events for positions that exit early.

**BUG 5 -- sell-ladder.ts:** Changed line 268 from `priorTrade.sellPriceSol! + solReceived` to `priorTrade.sellPriceSol!`. Since `addSellPrice(mint, solReceived)` was called before `getTradeByMint`, `priorTrade.sellPriceSol` already includes the just-added amount. The SELL_PARTIAL event detail string no longer shows an inflated running total.

**S1 -- tier3-creator.ts:** Added URL masking in the catch block using the same regex pattern from rpc-manager.ts: `url.replace(/api-key=[^&]*/gi, 'api-key=***')`. The masked URL is passed as a named property in the log.warn call, preventing API key leakage in error log output.

### Task 2: Fix Jito polling loop (BUG 1) and PositionManager memory leak (BUG 6) [e7556e9]

**BUG 1 -- jito-seller.ts:** Replaced the single-request `pollBundleStatus` with a `while(true)` polling loop using exponential backoff starting at 1000ms, doubling each iteration, capped at 5000ms. The loop continues indefinitely because SellLadder's `Promise.race` with `jitoTimeoutMs` (30s default) serves as the outer bound. Returns immediately on terminal states ('Landed' or 'Failed'). No internal timeout was added per Pitfall 3 from RESEARCH.md. Exported the function (`@internal`) for direct unit testing. Added 4 tests: multi-poll to Landed, immediate Failed, exponential backoff timing verification, and missing status defaults to Pending.

**BUG 6 -- position-manager.ts:** Added Map cleanup to the existing `.finally()` callback in `fireSell()`. When `partial === false` (full sell -- stop-loss, trailing stop, final tier, max hold time), deletes entries from `highWatermarks`, `tierIndices`, and `lastKnownQuoteSol` Maps. When `partial === true` (tiered TP non-final tier), Maps are preserved because the position returns to MONITORING and needs state intact for subsequent tier evaluations. Added 2 tests: verify Maps cleaned after full sell, verify Maps preserved after partial sell.

## Verification

- 261 tests pass (25 of 26 test files green)
- 1 pre-existing test file failure: `trade-store.test.ts` (53 tests) -- better-sqlite3 native module version mismatch, unrelated to changes
- TypeScript compiles with 0 errors (`tsc --noEmit`)
- 11 new test assertions added across 4 test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported pollBundleStatus for testing**
- **Found during:** Task 2
- **Issue:** `pollBundleStatus` was a private function, making direct unit testing of the polling loop impossible without full jitoSell mock chain (VersionedTransaction.deserialize requires valid bytes)
- **Fix:** Added `export` keyword with `@internal` JSDoc annotation
- **Files modified:** src/execution/sell/jito-seller.ts

## Known Stubs

None -- all fixes are complete implementations with no placeholder values.

## Self-Check: PASSED

- All 10 key files verified present on disk
- Commit 92c8c66 verified in git log (Task 1)
- Commit e7556e9 verified in git log (Task 2)
