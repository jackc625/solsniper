---
phase: 19-execution-performance
plan: 02
subsystem: execution
tags: [fee-estimator, dynamic-fees, helius, compute-units, jito, solana]

# Dependency graph
requires:
  - phase: 19-01
    provides: FeeEstimator class, FeeEstimate interface, maxPriorityFeeCapLamports config
provides:
  - All 5 buyer/seller paths use dynamic Helius-based fees via FeeEstimator
  - Jito seller CU simulation + instruction replacement in MessageV0
  - SellLadder and ExecutionEngine accept feeEstimator constructor param
  - index.ts creates and wires FeeEstimator instance
affects: [19-03-PLAN, execution-engine, sell-ladder]

# Tech tracking
tech-stack:
  added: []
  patterns: [cu-simulation-and-replacement, dynamic-fee-wiring-through-call-chain]

key-files:
  modified:
    - src/execution/buy/jupiter-buyer.ts
    - src/execution/buy/pump-portal-buyer.ts
    - src/execution/sell/standard-seller.ts
    - src/execution/sell/pump-portal-seller.ts
    - src/execution/sell/jito-seller.ts
    - src/execution/sell/sell-ladder.ts
    - src/execution/execution-engine.ts
    - src/index.ts
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/buy/pump-portal-buyer.test.ts
    - src/execution/sell/standard-seller.test.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/jito-seller.test.ts

key-decisions:
  - "Standard seller applies feeMultiplier on dynamic base then caps at maxPriorityFeeCapLamports -- escalation multipliers (HIGH_FEE, EMERGENCY) work on top of network-aware estimate"
  - "Jito seller CU simulation uses replaceRecentBlockhash=true, sigVerify=false for simulation-only mode"
  - "CU instruction replacement finds existing instruction via ComputeBudgetProgram.programId account index + 0x02 discriminator byte -- avoids recompiling all instructions"
  - "CU simulation failure is caught and logged, not thrown -- graceful degradation uses Jupiter's original CU limit"
  - "Jito tip remains fixed per D-21 -- dynamic fees only affect swap transaction priority fee, not tip amount"

patterns-established:
  - "FeeEstimator dependency injection: created once in index.ts, passed through ExecutionEngine/SellLadder constructors to individual buyer/seller functions"
  - "CU replacement pattern: simulate -> find CB program index -> match 0x02 discriminator -> rebuild MessageV0 -> rebuild VersionedTransaction -> re-sign"

requirements-completed: [EXE-10, EXE-11]

# Metrics
duration: 21min
completed: 2026-03-30
---

# Phase 19 Plan 02: Wire FeeEstimator + Jito CU Simulation Summary

**Dynamic Helius-based fees wired into all 5 buyer/seller paths; Jito seller adds CU simulation with ComputeBudgetProgram instruction replacement in MessageV0, 15% buffer, and graceful degradation**

## Performance

- **Duration:** 21 min
- **Started:** 2026-03-30T23:21:05Z
- **Completed:** 2026-03-30T23:42:12Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Jupiter buyer uses `feeEstimator.getEstimate().maxLamports` instead of static `priorityFeeBaseLamports * priorityFeeMultiplier`
- PumpPortal buyer uses `feeEstimate.priorityFeeSol` for dynamic fee
- Standard seller applies `feeMultiplier` on dynamic base, capped by `maxPriorityFeeCapLamports` -- enables escalation (STANDARD=1x, HIGH_FEE=3x, EMERGENCY=10x) on network-aware base
- PumpPortal seller uses `feeEstimate.priorityFeeSol` for dynamic fee
- Jito seller uses dynamic fee with `highFeeMultiplier` + cap, then simulates CU consumption, finds Jupiter's ComputeBudgetProgram.setComputeUnitLimit instruction by matching program ID index + 0x02 discriminator, replaces data with `Math.ceil(simulatedCU * 1.15)`, rebuilds MessageV0 + VersionedTransaction, and re-signs
- Jito CU simulation failure gracefully degrades to Jupiter's original CU limit
- Jito tip remains fixed per D-21
- Fee source logged per D-07 in all 5 paths
- SellLadder and ExecutionEngine constructors accept `feeEstimator` parameter
- `index.ts` creates `FeeEstimator(env.SOLSNIPER_RPC_URL)` and wires to both
- 8 new test cases added across 5 test files (31 total passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire FeeEstimator into 4 buyer/seller paths + callers** - `22d6a27` (feat)
2. **Task 2: Jito CU simulation + instruction replacement + dynamic fee** - `97cba84` (feat)

## Files Modified

- `src/execution/buy/jupiter-buyer.ts` - Dynamic fee from FeeEstimator replaces static calc
- `src/execution/buy/jupiter-buyer.test.ts` - Dynamic fee test added
- `src/execution/buy/pump-portal-buyer.ts` - Dynamic priorityFeeSol from FeeEstimator
- `src/execution/buy/pump-portal-buyer.test.ts` - Dynamic fee test added
- `src/execution/sell/standard-seller.ts` - Dynamic base + feeMultiplier + cap
- `src/execution/sell/standard-seller.test.ts` - Dynamic fee + cap enforcement tests
- `src/execution/sell/pump-portal-seller.ts` - Dynamic priorityFeeSol from FeeEstimator
- `src/execution/sell/pump-portal-seller.test.ts` - Dynamic fee test added
- `src/execution/sell/jito-seller.ts` - Dynamic fee + CU simulation + instruction replacement
- `src/execution/sell/jito-seller.test.ts` - Dynamic fee, CU graceful, tip fixed tests
- `src/execution/sell/sell-ladder.ts` - feeEstimator field + constructor param + all step calls updated
- `src/execution/execution-engine.ts` - feeEstimator field + constructor param + buy calls updated
- `src/index.ts` - FeeEstimator instance creation + wiring to ExecutionEngine and SellLadder

## Decisions Made

- Standard seller applies feeMultiplier on dynamic base then caps at maxPriorityFeeCapLamports -- escalation multipliers work on top of network-aware estimate
- Jito CU simulation uses replaceRecentBlockhash=true, sigVerify=false for simulation-only mode
- CU instruction replacement finds existing instruction via ComputeBudgetProgram.programId account index + 0x02 discriminator byte
- CU simulation failure is caught and logged, not thrown -- graceful degradation uses Jupiter's original CU limit
- Jito tip remains fixed per D-21

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Test mock ordering: `vi.clearAllMocks()` in beforeEach resets `mockGetEstimate` to returning undefined; required re-establishing default resolved value in each describe block's beforeEach
- VersionedTransaction.deserialize needed mocking in jito-seller.test.ts to provide controlled MessageV0 structure for CU simulation tests

## Next Phase Readiness

- All execution paths now use dynamic Helius-based fees (EXE-10 complete)
- Jito seller has CU simulation + instruction replacement (EXE-11 complete)
- Plan 03 wires BalanceGuard into detection handler for pre-buy balance checks (EXE-12)

## Self-Check: PASSED

- All 13 modified files verified present on disk
- Both task commits (22d6a27, 97cba84) found in git log
- All acceptance criteria patterns verified via grep

---
*Phase: 19-execution-performance*
*Completed: 2026-03-30*
