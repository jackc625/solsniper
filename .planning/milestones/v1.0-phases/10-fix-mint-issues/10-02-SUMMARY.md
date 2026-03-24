---
phase: 10-fix-mint-issues
plan: 02
subsystem: execution
tags: [solana, token-2022, pumpportal, sell-ladder, jupiter, tdd]

# Dependency graph
requires:
  - phase: 10-01
    provides: JupiterRouteError class, TradeStore.getTradeByMint, source/tokenProgramId fields on Trade
  - phase: 05-execution-engine
    provides: SellLadder, ExecutionEngine, chunkedSell base implementation, sell step types

provides:
  - PumpPortal sell adapter (pump-portal-seller.ts) mirroring buyer pattern
  - Token-2022-aware ATA derivation in chunkedSell via tokenProgramId from trade record
  - 6-step sell ladder with PUMPPORTAL step (source+error-aware conditional trigger)
  - Post-buy sell-route verification in ExecutionEngine for pumpportal tokens

affects:
  - sell ladder usage
  - token-2022 sell path
  - pumpportal sell fallback

# Tech tracking
tech-stack:
  added: []
  patterns:
    - lastError tracking in sell ladder loop for conditional step trigger
    - fire-and-forget deferred verification with structured retry delays
    - PUMPPORTAL step skips immediately via throw when conditions not met

key-files:
  created:
    - src/execution/sell/pump-portal-seller.ts
    - src/execution/sell/pump-portal-seller.test.ts
  modified:
    - src/execution/sell/chunked-seller.ts
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/execution/execution-engine.ts
    - src/execution/execution-engine.test.ts
    - src/types/index.ts

key-decisions:
  - "lastError tracked across all sell ladder steps — PUMPPORTAL reads it to check for JupiterRouteError trigger codes"
  - "PUMPPORTAL step skips via throw (not special flag) — uniform step loop handles both skip and failure identically"
  - "PUMPPORTAL only triggers on TOKEN_NOT_TRADABLE, NO_ROUTES_FOUND, ROUTE_NOT_FOUND — narrows to route-absent tokens (not rate limits or other errors)"
  - "chunkedSell tradeStore param is optional (backward compat) — defaults to TOKEN_PROGRAM_ID if not provided or trade not found"
  - "Post-buy verification is fire-and-forget void — buy() returns without waiting; retries at 10s/15s/20s"
  - "Verification failure logs warning only — does NOT force-sell; monitoring continues"
  - "pool=auto in pumpPortalSell — PumpPortal auto-picks bonding curve vs PumpSwap for the correct venue"

patterns-established:
  - "Step skip pattern: throw Error inside step fn() — caught by try/catch in loop, lastError updated, loop advances"
  - "Optional TradeStore param: chunkedSell(... tradeStore?) — callers in tests and ladder pass store; standalone callers can omit"
  - "Post-buy verification: void this.schedulePostBuySellRouteVerification(mint) after success transition"

requirements-completed: []

# Metrics
duration: 9min
completed: 2026-03-02
---

# Phase 10 Plan 02: Sell Layer Completion Summary

**PumpPortal sell fallback adapter, Token-2022-aware chunked ATA derivation, 6-step sell ladder with source+error-gated PUMPPORTAL step, and post-buy sell-route verification with retry backoff**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-03-02T20:11:14Z
- **Completed:** 2026-03-02T20:19:41Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 8 (2 created, 6 updated)

## Accomplishments

- Created `pump-portal-seller.ts` matching the buyer pattern: POST to trade-local with action=sell, pool=auto, slippage as percent, raw bytes response deserialized as VersionedTransaction
- Fixed `chunked-seller.ts`: reads `tokenProgramId` from TradeStore for Token-2022 ATA derivation; passes correct programId to both `getAssociatedTokenAddress` and `getAccount`
- Extended sell ladder from 5 to 6 steps with PUMPPORTAL between CHUNKED and EMERGENCY; step only fires for pumpportal-sourced tokens when `lastError` is a JupiterRouteError with a route-failure code
- Added deferred post-buy sell-route verification to `ExecutionEngine.buy()` for pumpportal tokens: fire-and-forget, 3 retries at 10s/15s/20s, warning log on all-fail (no force-sell)
- Added `PUMPPORTAL` variant to `SellStep` type
- 229 tests green (was 216 after Plan 01; +13 in this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: PumpPortal sell adapter and chunked-seller Token-2022 ATA fix** - `3f0620e` (feat)
2. **Task 2: Sell ladder PUMPPORTAL step and post-buy sell-route verification** - `c8e5a01` (feat)

**Plan metadata:** (docs commit — see below)

_Note: Both tasks used TDD (RED → GREEN)_

## Files Created/Modified

- `src/execution/sell/pump-portal-seller.ts` - New PumpPortal sell adapter (mirrors buyer pattern)
- `src/execution/sell/pump-portal-seller.test.ts` - 4 tests: success, HTTP error, body shape, slippage percent
- `src/execution/sell/chunked-seller.ts` - Token-2022 ATA fix: reads tokenProgramId from tradeStore, optional param
- `src/execution/sell/sell-ladder.ts` - 6-step ladder with PUMPPORTAL step, lastError tracking, tradeStore to chunkedSell
- `src/execution/sell/sell-ladder.test.ts` - Updated for 6 steps, 4 new PUMPPORTAL/tradeStore tests
- `src/execution/execution-engine.ts` - Post-buy sell-route verification (fire-and-forget with retry)
- `src/execution/execution-engine.test.ts` - 5 new post-buy verification tests
- `src/types/index.ts` - Added PUMPPORTAL to SellStep union type

## Decisions Made

- **lastError tracking:** A `let lastError: unknown` is updated in each step's catch block. PUMPPORTAL reads it to check for `instanceof JupiterRouteError` with specific trigger codes. This avoids tight coupling to individual step implementations.
- **PUMPPORTAL skip via throw:** The step fn() throws immediately when conditions aren't met (not pumpportal, not route error). The uniform loop treats this identically to any other step failure — no special casing needed.
- **PUMPPORTAL trigger codes:** Only `TOKEN_NOT_TRADABLE`, `NO_ROUTES_FOUND`, `ROUTE_NOT_FOUND` — these are the codes indicating Jupiter can't route the token at all. Rate-limit errors (429) and generic errors do NOT trigger the fallback (those should retry Jupiter, not immediately fall to PumpPortal).
- **pool=auto:** PumpPortal's auto mode picks the correct venue (bonding curve vs PumpSwap) — no need to hard-code `pump` like the buyer does.
- **chunkedSell backward compat:** tradeStore is optional to avoid breaking any callers that don't have a store reference. Defaults to TOKEN_PROGRAM_ID, which was the old behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Minor: `execution-engine.test.ts` was missing `afterEach` in the import line (needed for `vi.useRealTimers()`). Fixed inline (Rule 3 — blocking test run).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 10 is now complete. All 2 plans executed:
- Plan 01: Token-2022 Pattern A fix, JupiterRouteError, sell-route skip for pumpportal, source/programId threading
- Plan 02: PumpPortal sell fallback, chunked-seller Token-2022 ATA, 6-step sell ladder, post-buy verification

The sell layer now handles Token-2022 tokens through all escalation steps including PumpPortal fallback when Jupiter cannot route.

---
*Phase: 10-fix-mint-issues*
*Completed: 2026-03-02*

## Self-Check: PASSED

- src/execution/sell/pump-portal-seller.ts: FOUND
- src/execution/sell/pump-portal-seller.test.ts: FOUND
- .planning/phases/10-fix-mint-issues/10-02-SUMMARY.md: FOUND
- commit 3f0620e: FOUND
- commit c8e5a01: FOUND
