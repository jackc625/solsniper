---
phase: 19-execution-performance
plan: 01
subsystem: execution
tags: [helius, priority-fees, balance-guard, fee-estimation, solana]

# Dependency graph
requires:
  - phase: 05-execution-engine
    provides: ExecutionBuyConfigSchema, priorityFeeBaseLamports, priorityFeeMultiplier
provides:
  - FeeEstimator class with Helius getPriorityFeeEstimate integration
  - BalanceGuard class with cached wallet balance checks
  - maxPriorityFeeCapLamports config field (absolute fee ceiling)
  - minBalanceBufferSol config field (wallet drain protection)
  - LOW_BALANCE event type in BotEventBus
affects: [19-02-PLAN, 19-03-PLAN, execution-engine, detection-handler]

# Tech tracking
tech-stack:
  added: []
  patterns: [fee-estimation-with-cache, balance-guard-with-ttl]

key-files:
  created:
    - src/core/fee-estimator.ts
    - src/core/fee-estimator.test.ts
    - src/core/balance-guard.ts
    - src/core/balance-guard.test.ts
  modified:
    - src/config/trading.ts
    - config.jsonc
    - src/dashboard/bot-event-bus.ts

key-decisions:
  - "FeeEstimator caches raw microlamports/CU from Helius, converts on read -- avoids re-conversion on cached hits"
  - "BalanceGuard uses toBeCloseTo for threshold assertions -- JS floating-point addition (0.05 + 0.01) is not exact"

patterns-established:
  - "Service-with-cache pattern: constructor takes ttlMs, cache stores raw value + expiry timestamp, checked with Date.now() < expiry"
  - "Dual-output fee pattern: maxLamports for Jupiter paths, priorityFeeSol for PumpPortal paths, both derived from same estimate"

requirements-completed: [EXE-10, EXE-11, EXE-12]

# Metrics
duration: 6min
completed: 2026-03-30
---

# Phase 19 Plan 01: FeeEstimator and BalanceGuard Foundation Summary

**Helius-integrated FeeEstimator with 5s TTL cache, cap enforcement, and static fallback; BalanceGuard with cached getBalance and threshold logic; config schema extended with maxPriorityFeeCapLamports and minBalanceBufferSol**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-30T22:58:17Z
- **Completed:** 2026-03-30T23:04:35Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- FeeEstimator service fetches from Helius getPriorityFeeEstimate with VeryHigh priority, converts microlamports/CU to total lamports via ESTIMATED_CU=200_000, enforces maxPriorityFeeCapLamports ceiling, falls back to static config on failure
- BalanceGuard service checks wallet SOL balance against buyAmountSol + minBalanceBufferSol with 5s TTL cached getBalance
- Config schema extended with maxPriorityFeeCapLamports (default 500_000) and minBalanceBufferSol (default 0.01)
- LOW_BALANCE event type added to BotEventBus for downstream dashboard alerting
- 12 unit tests (7 FeeEstimator + 5 BalanceGuard) all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Config schema extensions + FeeEstimator service with tests** - `b099543` (feat)
2. **Task 2: BalanceGuard service with tests + LOW_BALANCE event type** - `4e95b7a` (feat)

## Files Created/Modified
- `src/core/fee-estimator.ts` - Helius fee estimation with cache, cap, and fallback
- `src/core/fee-estimator.test.ts` - 7 unit tests covering fetch, fallback, cache, expiry, cap, priorityFeeSol
- `src/core/balance-guard.ts` - Wallet balance check with cache and threshold logic
- `src/core/balance-guard.test.ts` - 5 unit tests covering sufficient, insufficient, cache, expiry, invalidation
- `src/config/trading.ts` - Added maxPriorityFeeCapLamports and minBalanceBufferSol to schema
- `config.jsonc` - Added maxPriorityFeeCapLamports and minBalanceBufferSol with comments
- `src/dashboard/bot-event-bus.ts` - Added LOW_BALANCE to BotEventType union

## Decisions Made
- FeeEstimator caches raw microlamports/CU from Helius, converts on read -- avoids re-conversion on cached hits
- BalanceGuard test uses toBeCloseTo for threshold assertions -- JS floating-point addition (0.05 + 0.01) is not exact

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Floating-point precision in BalanceGuard test: 0.05 + 0.01 = 0.060000000000000005 in JavaScript, so test assertions use toBeCloseTo instead of toBe for thresholdSol comparisons

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- FeeEstimator ready for Plan 02 to wire into jupiter-buyer.ts, pump-portal-buyer.ts, and sell ladder
- BalanceGuard ready for Plan 03 to wire into detection handler for pre-buy balance checks
- LOW_BALANCE event ready for dashboard consumption when BalanceGuard is wired in

## Self-Check: PASSED

- All 8 files verified present on disk
- Both task commits (b099543, 4e95b7a) found in git log
- All 10 content acceptance criteria verified

---
*Phase: 19-execution-performance*
*Completed: 2026-03-30*
