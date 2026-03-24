---
phase: 11-fix-bonding-curve-issue
plan: 01
subsystem: safety
tags: [solana, pumpfun, holder-concentration, pda, token-2022]

# Dependency graph
requires:
  - phase: 10-fix-mint-issues
    provides: programId threading from checkAuthorities through SafetyResult; Token-2022 code paths
provides:
  - Bonding curve PDA derivation and exclusion from holder concentration (both standard and Token-2022 paths)
  - Source-aware zero-holder logic (pumpportal gets pass=true, score=50 instead of hard block)
  - event.source threaded from SafetyPipeline.evaluate() to checkHolderConcentration as 5th arg
affects: [safety-pipeline, holder-concentration, pumpportal-tokens]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-mint PDA derivation via PublicKey.findProgramAddressSync in filter logic (CPU-only, zero RPC cost)"
    - "Source-aware fallback: pumpportal zero-holder = pass/50 (bonding curve phase); others = fail/0"
    - "Optional 5th param backward-compatible signature extension (existing callers unaffected)"

key-files:
  created: []
  modified:
    - src/safety/checks/tier2-holder.ts
    - src/safety/checks/tier2-holder.test.ts
    - src/safety/safety-pipeline.ts
    - src/safety/safety-pipeline.test.ts

key-decisions:
  - "Pump.fun program ID removed from SYSTEM_ACCOUNTS set — it was never a token account owner, so static inclusion never matched anything; it is repurposed as PUMP_FUN_PROGRAM_ID constant for PDA derivation"
  - "Bonding curve PDA exclusion is universal (not gated on source) — handles migration edge cases where pump.fun tokens graduate to other AMMs but still have a bonding curve PDA in the holder list"
  - "Zero-holder pumpportal returns pass=true score=50 'insufficient data' — pump.fun tokens in bonding curve phase have no user holders yet; neutral score avoids blocking valid tokens while signaling low confidence"
  - "source param added as optional 5th arg to checkHolderConcentration — backward-compatible; all 8 existing call sites without source continue to work unchanged"

patterns-established:
  - "TDD: write failing tests first, verify RED, implement production code, verify GREEN, run full suite"
  - "Per-mint PDA derivation is cheap (CPU-only) — can run inside filter loops without RPC cost concerns"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 11 Plan 01: Fix Bonding Curve Issue Summary

**Per-mint bonding curve PDA derivation and exclusion from holder concentration, unblocking ~90% of Pump.fun tokens that previously failed due to the bonding curve being miscounted as a whale holder**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T22:04:35Z
- **Completed:** 2026-03-02T22:07:35Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- Removed Pump.fun program ID from SYSTEM_ACCOUNTS (it was never a token account owner — static inclusion never matched anything)
- Added PUMP_FUN_PROGRAM_ID constant and derivation of per-mint bonding curve PDA via `findProgramAddressSync` (CPU-only, zero RPC cost)
- Excluded bondingCurvePdaStr from holder filters in both standard and Token-2022 code paths
- Added `source?: string` as optional 5th parameter to `checkHolderConcentration` (backward-compatible)
- Source-aware zero-holder logic: pumpportal returns pass=true, score=50, 'insufficient data'; all others return pass=false, score=0
- Threaded `event.source` from `SafetyPipeline.evaluate()` to `checkHolderConcentration`
- 235 tests pass, TypeScript compiles cleanly

## Task Commits

1. **Task 1: Fix bonding curve PDA exclusion and source-aware zero-holder logic** - `7b95610` (feat)

**Plan metadata:** (final commit below)

## Files Created/Modified
- `src/safety/checks/tier2-holder.ts` - Removed program ID from SYSTEM_ACCOUNTS; added PUMP_FUN_PROGRAM_ID constant; derive bondingCurvePdaStr per-mint; exclude from both filter paths; source-aware zero-holder branch; source? 5th param
- `src/safety/checks/tier2-holder.test.ts` - Added BONDING_CURVE_ADDR pre-computation; 4 new tests (standard exclusion, Token-2022 exclusion, pumpportal zero-holder pass, raydium zero-holder fail)
- `src/safety/safety-pipeline.ts` - Thread event.source as 5th arg to checkHolderConcentration
- `src/safety/safety-pipeline.test.ts` - Updated 'passes detectedProgramId' test to assert 5th arg 'pumpportal'

## Decisions Made
- Pump.fun program ID removed from SYSTEM_ACCOUNTS — it was never a token account owner, so the static check never matched anything; repurposed as PUMP_FUN_PROGRAM_ID for PDA derivation
- PDA exclusion is universal (not source-gated) — handles migration edge cases where graduated tokens still have a bonding curve PDA holder
- Zero-holder pumpportal = neutral (pass=true, score=50) rather than suspicious (pass=false, score=0) — pump.fun tokens are in the bonding curve phase and legitimately have no user holders yet

## Deviations from Plan

None - plan executed exactly as written. TDD cycle followed: RED (4 failing tests) confirmed before GREEN (production code) applied.

## Issues Encountered
None — all tests passed immediately after production code changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11 complete: Pump.fun tokens no longer blocked by spurious bonding curve holder concentration
- Bot can now buy tokens detected via pumpportal that are still in the bonding curve phase
- No blockers for production deployment

---
*Phase: 11-fix-bonding-curve-issue*
*Completed: 2026-03-02*
