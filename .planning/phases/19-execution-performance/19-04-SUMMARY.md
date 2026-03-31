---
phase: 19-execution-performance
plan: 04
subsystem: execution/tests
tags: [gap-closure, test-mocks, feeEstimator-wiring, typescript-compilation]
dependency_graph:
  requires: [19-01, 19-02, 19-03]
  provides: [zero-tsc-errors, test-mock-parity]
  affects: [chunked-seller, sell-ladder, 12-test-files]
tech_stack:
  added: []
  patterns: [as-unknown-as-cast-for-class-mocks]
key_files:
  created: []
  modified:
    - src/execution/sell/chunked-seller.ts
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/chunked-seller.test.ts
    - src/execution/execution-engine.test.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/buy/pump-portal-buyer.test.ts
    - src/execution/sell/standard-seller.test.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/jito-seller.test.ts
    - src/detection/detection-manager.test.ts
    - src/position/position-manager.test.ts
    - src/safety/safety-pipeline.test.ts
decisions:
  - "as unknown as FeeEstimator cast pattern for mocking class instances in tests (avoids exposing private fields)"
  - "minBalanceBufferSol: 0.01 added to all test config mocks (deviation: plan 19-03 field not mentioned in original plan)"
metrics:
  duration: 20 min
  completed: "2026-03-31T01:06:00Z"
---

# Phase 19 Plan 04: Fix Stale Test Mocks + Chunked-Seller Wiring Summary

Wire feeEstimator through chunkedSell production code and fix 74 TypeScript errors across 13 files caused by stale test config mocks from phases 18 and 19.

## What Changed

### Task 1: Fix chunked-seller.ts production bug (68ddcc9)

**Production code fix:**
- Added `feeEstimator: FeeEstimator` as 6th parameter to `chunkedSell()` function
- Changed `tradeStore` from optional (`tradeStore?: TradeStore`) to explicit union (`tradeStore: TradeStore | undefined`) since `feeEstimator` follows as required
- Forwarded `feeEstimator` as 7th argument to `standardSell()` call inside the tranche loop
- Updated sell-ladder.ts CHUNKED step to pass `this.feeEstimator` to `chunkedSell()`

**Test fix (chunked-seller.test.ts):**
- Added `mockFeeEstimator` with `as unknown as FeeEstimator` cast
- Added `minLiquiditySol`, `lpLockScorePenalty`, `metadataMutablePenalty` to safety config
- Added `maxPriorityFeeCapLamports` to execution.buy config
- Added `minBalanceBufferSol` to top-level config
- Updated all 3 `chunkedSell()` calls to pass `undefined` (tradeStore) and `mockFeeEstimator`

### Task 2: Fix stale config mocks in 10 remaining test files (03ae188)

Applied mechanical fixes across 10 test files:

| Fix | Description | Files |
|-----|-------------|-------|
| A | Add 3 safety fields (minLiquiditySol, lpLockScorePenalty, metadataMutablePenalty) | 9 files |
| B | Add maxPriorityFeeCapLamports: 500000 to execution.buy | 5 files |
| C | Cast FeeEstimator mock with `as unknown as FeeEstimator` | 4 files |
| D | Add mockFeeEstimator as 5th arg to ExecutionEngine (13 calls) and SellLadder (23 calls) | 2 files |
| E | Add minBalanceBufferSol: 0.01 to top-level config (deviation) | All files |

## Decisions Made

1. **`as unknown as FeeEstimator` cast pattern**: FeeEstimator has private fields (`cache`, `ttlMs`, `rpcUrl`) that can't be satisfied by plain object mocks. Double-cast through `unknown` is the standard vitest pattern for mocking class instances without exposing internals.

2. **`minBalanceBufferSol` addition (deviation)**: Plan 19-03 added `minBalanceBufferSol` to `TradingConfigSchema` but this wasn't listed in the original plan's error analysis. Auto-fixed as Rule 3 (blocking issue preventing compilation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added minBalanceBufferSol to all test config mocks**
- **Found during:** Task 1 verification
- **Issue:** Plan 19-03 (BalanceGuard) added `minBalanceBufferSol` as a required field to `TradingConfigSchema`, but the original plan only identified 3 root causes (chunked-seller wiring, safety fields, FeeEstimator cast). This 4th root cause wasn't in the plan.
- **Fix:** Added `minBalanceBufferSol: 0.01` to all 13 test files' `makeTradingConfig()` functions
- **Files modified:** All 13 test files
- **Commits:** 68ddcc9, 03ae188

## Verification Results

- `npx tsc --noEmit`: exits with code 0 (zero errors, down from 74)
- All 7 test files with proper env mocking pass (71 tests)
- 12 test files fail with pre-existing `process.exit(1)` from env.ts validation (missing `.env` in worktree) -- this is a known pre-existing issue documented in PROJECT.md ("12 test files need Jupiter API key mock")
- Zero errors referencing any of the 13 target files

## Known Stubs

None -- all changes are wiring fixes and config mock updates with no placeholder data.

## Self-Check: PASSED

- All 13 modified files exist on disk
- Commit 68ddcc9 (Task 1) found in git log
- Commit 03ae188 (Task 2) found in git log
- `npx tsc --noEmit` exits 0
