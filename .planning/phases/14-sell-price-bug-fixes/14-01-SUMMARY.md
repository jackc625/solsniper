---
phase: 14-sell-price-bug-fixes
plan: 01
subsystem: execution
tags: [sellers, jupiter, pumpportal, jito, solReceived, SellOutcome, ChunkedSellOutcome, parseSolReceived, testing]

# Dependency graph
requires:
  - phase: 05-execution-engine
    provides: standardSell, jitoSell, pumpPortalSell, chunkedSell, SellResult interface
  - phase: 13-ui-rework
    provides: pnlSol usage in sell events (sellPriceSol undefined today)

provides:
  - SellOutcome interface { signature, solReceived } for Jupiter-based sellers
  - ChunkedSellOutcome interface { confirmedTranches, solReceived } for chunked seller
  - parseSolReceived shared utility for on-chain pre/post balance delta parsing
  - All 4 sellers return structured outcome instead of bare string/number
  - Wave 0 test files for standard-seller and chunked-seller

affects:
  - 14-02: sell-ladder threading of solReceived into sellPriceSol (uses new SellOutcome type)
  - position-manager: sellPriceSol can now be populated after sells complete

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "quoteResponse.outAmount / 1e9 for SOL received from Jupiter sells (same as PositionManager.getPositionValueSol)"
    - "parseSolReceived shared utility for on-chain pre/post balance delta (used by pumpportal + future emergency step)"
    - "SellOutcome/ChunkedSellOutcome structured return types replacing bare string/number"

key-files:
  created:
    - src/utils/parse-sol-received.ts
    - src/execution/sell/standard-seller.test.ts
    - src/execution/sell/chunked-seller.test.ts
  modified:
    - src/types/index.ts
    - src/execution/sell/standard-seller.ts
    - src/execution/sell/jito-seller.ts
    - src/execution/sell/pump-portal-seller.ts
    - src/execution/sell/chunked-seller.ts
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/jito-seller.test.ts

key-decisions:
  - "SellOutcome.solReceived is optional (undefined on parse failure) not nullable — avoids null checks at call sites"
  - "parseSolReceived extracted as shared utility (not inline) for reuse by both pumpportal-seller and sell-ladder EMERGENCY step (Plan 02)"
  - "sell-ladder.ts type updated in this plan (not Plan 02) to fix blocking tsc errors caused by return type change"
  - "chunked-seller returns undefined solReceived (not 0) when totalSolReceived=0 — distinguishes genuine zero-receive from accumulation failure"

patterns-established:
  - "parseSolReceived pattern: wallet pre/post balance delta from getTransaction metadata — authoritative for non-Jupiter routes"
  - "SellOutcome return type: all Jupiter-based sellers return { signature, solReceived } not bare string"

requirements-completed: []

# Metrics
duration: 9min
completed: 2026-03-04
---

# Phase 14 Plan 01: Seller Return Types Summary

**All 4 sellers now return SellOutcome/ChunkedSellOutcome with solReceived populated from Jupiter quote outAmount or on-chain tx parse**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-04T14:36:40Z
- **Completed:** 2026-03-04T14:45:40Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Added `SellOutcome` and `ChunkedSellOutcome` interfaces to `src/types/index.ts`
- Created `src/utils/parse-sol-received.ts` shared utility for on-chain pre/post balance delta parsing
- Updated all 4 sellers: standardSell, jitoSell, pumpPortalSell, chunkedSell return structured outcomes with `solReceived`
- Wave 0 test files created for standard-seller and chunked-seller (13 tests total, all passing)
- Fixed sell-ladder.ts type annotations to match new return types (blocking tsc error auto-fixed)

## Task Commits

Each task was committed atomically:

1. **Task 0: Wave 0 test scaffolds for standard-seller and chunked-seller** - `81a849b` (test)
2. **Task 1: Define types, extract parseSolReceived, update all 4 sellers** - `f23a685` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified

- `src/types/index.ts` - Added `SellOutcome` and `ChunkedSellOutcome` interfaces
- `src/utils/parse-sol-received.ts` - NEW: Shared on-chain SOL balance delta parser
- `src/execution/sell/standard-seller.ts` - Returns `SellOutcome { signature, solReceived }` from `quoteResponse.outAmount / 1e9`
- `src/execution/sell/jito-seller.ts` - Returns `SellOutcome { signature, solReceived }`; dry-run returns `{ signature, solReceived: undefined }`
- `src/execution/sell/pump-portal-seller.ts` - Returns `SellOutcome { signature, solReceived }` via `parseSolReceived`
- `src/execution/sell/chunked-seller.ts` - Returns `ChunkedSellOutcome { confirmedTranches, solReceived }` accumulated across tranches
- `src/execution/sell/sell-ladder.ts` - Updated step fn type to `SellOutcome | ChunkedSellOutcome`; extracts `outcome.signature`
- `src/execution/sell/standard-seller.test.ts` - NEW: Wave 0 tests for SellOutcome return type
- `src/execution/sell/chunked-seller.test.ts` - NEW: Wave 0 tests for ChunkedSellOutcome return type
- `src/execution/sell/pump-portal-seller.test.ts` - Updated assertion to `{ signature, solReceived: undefined }`
- `src/execution/sell/jito-seller.test.ts` - Updated dry-run assertion to check `result.signature`

## Decisions Made

- `SellOutcome.solReceived` is `number | undefined` (not nullable): undefined only on true parse failure, avoids null checks at call sites
- `parseSolReceived` extracted as a shared utility (not inline in pump-portal-seller) so it can be reused by sell-ladder EMERGENCY step in Plan 02
- `sell-ladder.ts` type annotations were updated in this plan (not Plan 02) to fix blocking TypeScript errors caused by changing seller return types
- `chunkedSell` returns `undefined` for `solReceived` when total is zero (not `0`) — distinguishes genuine zero-receive from accumulation failure

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated sell-ladder.ts type annotations for new return types**
- **Found during:** Task 1 (running `npx tsc --noEmit` verification)
- **Issue:** sell-ladder.ts had `fn: () => Promise<string | number>` type for step functions; after changing sellers to return `SellOutcome | ChunkedSellOutcome`, TypeScript emitted 6 type errors
- **Fix:** Updated `fn` type to `() => Promise<SellOutcome | ChunkedSellOutcome>` and updated result-handling logic to destructure `outcome.signature` and `chunkedOutcome.confirmedTranches`
- **Files modified:** `src/execution/sell/sell-ladder.ts`
- **Verification:** `npx tsc --noEmit` passes cleanly after fix
- **Committed in:** `f23a685` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Necessary fix for TypeScript correctness. No scope creep — sell-ladder behavioral logic unchanged; only type annotations and result destructuring updated.

## Issues Encountered

- `chunked-seller.test.ts` initial `MINT` value (`TestMint111111111111111111111111111111111111`) caused `Invalid public key input` because `chunked-seller.ts` calls `new PublicKey(mint)`. Fixed by using WSOL mint (`So11111111111111111111111111111111111111112`) as a valid base58 test fixture.

## Next Phase Readiness

- All 4 sellers return `solReceived` — ready for Plan 02 to thread `solReceived` through `sell-ladder.ts` into `tradeStore.transition(mint, 'SELLING', 'COMPLETED', { sellPriceSol })`
- `parseSolReceived` utility available for EMERGENCY step in Plan 02
- `sell-ladder.test.ts` mocks still return old types (bare string/number) — Plan 02 must update those mocks

---
*Phase: 14-sell-price-bug-fixes*
*Completed: 2026-03-04*
