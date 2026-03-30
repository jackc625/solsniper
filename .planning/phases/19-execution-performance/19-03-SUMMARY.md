---
phase: 19-execution-performance
plan: 03
subsystem: execution
tags: [balance-guard, wallet-balance, detection-handler, solana]

# Dependency graph
requires:
  - phase: 19-execution-performance
    provides: BalanceGuard class, LOW_BALANCE event type, minBalanceBufferSol config field
affects: []

provides:
  - BalanceGuard wired into detection handler -- pre-buy wallet balance check active in production pipeline

# Tech tracking
tech-stack:
  added: []
  patterns: [pre-buy-guard-pattern]

key-files:
  created: []
  modified:
    - src/index.ts

key-decisions:
  - "Balance guard placed after max-concurrent-positions check and before safetyPipeline.evaluate -- saves wasted RPC calls on safety checks when wallet cannot afford the buy (D-14)"
  - "getRuntimeConfig() called once as cfg for balance guard params -- downstream existing getRuntimeConfig() calls left as-is to minimize diff"

patterns-established:
  - "Pre-buy guard pattern: early-return guards in detection handler run before expensive async operations (safety pipeline, execution)"

requirements-completed: [EXE-12]

# Metrics
duration: 4min
completed: 2026-03-30
---

# Phase 19 Plan 03: BalanceGuard Wiring Summary

**BalanceGuard wired into detection handler between max-positions check and safety pipeline, emitting LOW_BALANCE events when wallet SOL is below buy threshold**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-30T23:18:35Z
- **Completed:** 2026-03-30T23:22:32Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- BalanceGuard imported and instantiated with 5s TTL cache in index.ts main() function
- Balance check inserted after max-concurrent-positions guard and before safetyPipeline.evaluate in detection handler
- LOW_BALANCE event emitted via BotEventBus with balance and threshold details when insufficient
- Early return prevents wasted safety RPC calls and buy execution when wallet is below threshold
- Sell paths (sell-ladder, position-manager) remain completely unaffected per D-19

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire BalanceGuard into index.ts detection handler** - `dc116e0` (feat)

## Files Created/Modified
- `src/index.ts` - Added BalanceGuard import, instantiation, and balance check in detection handler

## Decisions Made
- Balance guard placed after max-concurrent-positions check and before safetyPipeline.evaluate -- saves wasted RPC calls on safety checks when wallet cannot afford the buy (D-14)
- getRuntimeConfig() called once as `cfg` for balance guard params -- downstream existing getRuntimeConfig() calls left as-is to minimize diff

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All three plans of phase 19 execution-performance complete
- FeeEstimator (Plan 01) wired into buy/sell paths (Plan 02)
- BalanceGuard (Plan 01) wired into detection handler (Plan 03)
- Bot now has dynamic Helius-based priority fees and pre-buy wallet balance protection

## Self-Check: PASSED

- All files verified present on disk (src/index.ts, src/core/balance-guard.ts)
- Task commit (dc116e0) found in git log
- All 5 content acceptance criteria verified (import, constructor, check call, sufficient guard, LOW_BALANCE event)

---
*Phase: 19-execution-performance*
*Completed: 2026-03-30*
