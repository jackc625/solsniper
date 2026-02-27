---
phase: 05-execution-engine
plan: 03
subsystem: execution
tags: [solana, jupiter, jito, sell, escalation-ladder, bigint, vitest]

# Dependency graph
requires:
  - phase: 05-01
    provides: broadcastAndConfirm, BroadcastResult, SellResult, SellStep, ExecutionConfig types
  - phase: 04-01
    provides: TradeStore with transition() and state machine

provides:
  - SellLadder class with 5-step time-based escalation (STANDARD→HIGH_FEE→JITO_BUNDLE→CHUNKED→EMERGENCY)
  - standardSell() for STANDARD and HIGH_FEE steps (configurable slippage + fee multiplier)
  - jitoSell() for JITO_BUNDLE step (2-tx bundle: swap first, tip last)
  - chunkedSell() for CHUNKED step (3 sequential tranches, bigint arithmetic, partial recovery)

affects: [06-monitoring, 07-price-monitoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Time-based sell step advancement via Promise.race with per-step setTimeout
    - Jito bundle protocol: 2 separate transactions (swap + tip), tip LAST in bundle array
    - Chunked sell partial recovery: tranche failures do not abort remaining tranches
    - bigint throughout for token amounts (avoids Number.MAX_SAFE_INTEGER overflow)

key-files:
  created:
    - src/execution/sell/standard-seller.ts
    - src/execution/sell/jito-seller.ts
    - src/execution/sell/chunked-seller.ts
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/sell-ladder.test.ts
  modified: []

key-decisions:
  - "Jito tip tx is SEPARATE from swap tx (not embedded) — required by Jito protocol; both share the same blockhash"
  - "CHUNKED step returning 0 tranches advances to EMERGENCY — only >0 confirmed tranches counts as success"
  - "SellLadder passes feeMultiplier=1 for STANDARD, highFeeMultiplier for HIGH_FEE — same standardSell() function reused for both"
  - "EMERGENCY step uses emergencySlippageBps (4900 bps = 49%) + emergencyPriorityMultiplier (10x) per EXE-09"
  - "pollBundleStatus polls once — timeout managed externally by SellLadder Promise.race, not internally"

patterns-established:
  - "Time-based sell step advancement: Promise.race([step.fn(), timeoutPromise]) — advancement on timeout, not failure count"
  - "Sell step fns return string|number: string=signature (STANDARD/HIGH_FEE/JITO/EMERGENCY), number=tranche count (CHUNKED)"
  - "TradeStore transitions in SellLadder: MONITORING→SELLING at ladder start, then SELLING→COMPLETED or SELLING→FAILED"

requirements-completed: [EXE-06, EXE-07, EXE-09]

# Metrics
duration: 8min
completed: 2026-02-27
---

# Phase 05 Plan 03: Sell Escalation Ladder Summary

**5-step sell escalation ladder with time-based advancement: Jupiter standard/high-fee sells, Jito 2-tx MEV bundle, chunked 3-tranche sequential, and 49% emergency slippage fallback**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-27T12:05:00Z
- **Completed:** 2026-02-27T12:13:00Z
- **Tasks:** 2
- **Files modified:** 5 created

## Accomplishments

- SellLadder orchestrator with 5 steps advancing on time-based timeout (Promise.race), not failure count
- Jupiter sell reused for STANDARD (1x fee), HIGH_FEE (3x fee), and EMERGENCY (4900 bps / 10x fee) steps
- Jito MEV bundle sell: swap tx first, separate tip tx last, polls getBundleStatuses for landing confirmation
- Chunked sell splits token balance into 3 sequential bigint tranches with partial recovery (continues on tranche failure)
- 7 new tests covering all steps, timeout advancement (fake timers), CHUNKED 0-tranche advancement, EMERGENCY slippage validation
- 128 total tests passing (7 new + 121 pre-existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Build sell step implementations (standard, jito, chunked)** - `78d7e3e` (feat)
2. **Task 2: Build SellLadder orchestrator with time-based step advancement and tests** - `3fcd514` (feat)

## Files Created/Modified

- `src/execution/sell/standard-seller.ts` - Jupiter sell for STANDARD + HIGH_FEE steps; configurable slippageBps and feeMultiplier
- `src/execution/sell/jito-seller.ts` - Jito 2-tx bundle sell: swap first, separate tip tx last; polls getBundleStatuses
- `src/execution/sell/chunked-seller.ts` - 3 sequential bigint tranches; last tranche gets remainder; partial recovery continues
- `src/execution/sell/sell-ladder.ts` - SellLadder class; 5-step escalation; time-based timeout via Promise.race; TradeStore wiring
- `src/execution/sell/sell-ladder.test.ts` - 7 tests: step sequencing, timeout advancement, CHUNKED tranche logic, EMERGENCY slippage

## Decisions Made

- Jito tip tx is SEPARATE from swap tx per Jito protocol — both share the same blockhash
- CHUNKED returning 0 tranches is not a success — ladder advances to EMERGENCY
- SellLadder uses the same `standardSell()` for STANDARD (multiplier=1), HIGH_FEE (multiplier=3), and EMERGENCY (4900bps, multiplier=10)
- `pollBundleStatus` polls once and returns — timeout is managed externally by Promise.race in SellLadder, not internally with a loop
- bigint arithmetic throughout chunked-seller to safely handle token amounts exceeding Number.MAX_SAFE_INTEGER

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SellLadder ready to be wired into ExecutionEngine.sell() in Phase 6 (monitoring triggers sell)
- All 5 sell steps implemented and tested; TradeStore state machine integrated
- Token amount (bigint) for sell must come from Phase 7 price monitoring or stored amountTokens from buy

---
*Phase: 05-execution-engine*
*Completed: 2026-02-27*
