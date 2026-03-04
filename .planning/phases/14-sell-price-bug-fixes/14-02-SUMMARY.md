---
phase: 14-sell-price-bug-fixes
plan: 02
subsystem: execution
tags: [sell-ladder, trade-store, pnl, position-manager, bot-event-bus, sqlite]

# Dependency graph
requires:
  - phase: 14-01
    provides: SellOutcome/ChunkedSellOutcome types, parseSolReceived utility, sellers returning structured outcome objects with solReceived
provides:
  - SellLadder threads solReceived through to tradeStore.transition() as sellPriceSol on every successful sell
  - pnlSol formula corrected to sellPriceSol - amountSol (not - buyPriceSol)
  - TradeStore.addSellPrice() for incremental tiered TP accumulation using COALESCE SQL pattern
  - SELL_PARTIAL event emitted per tiered TP tier fire with SOL received for that tier
  - EMERGENCY step uses on-chain parseSolReceived instead of Jupiter quote (per locked decision)
  - PositionManager tracks lastKnownQuoteSol from Jupiter quotes and passes as fallback to SellLadder.sell()
affects: [position-manager, sell-ladder, trade-store, dashboard-events, bot-event-bus]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "solReceived threading: seller returns SellOutcome.solReceived -> SellLadder extracts -> passes as sellPriceSol to tradeStore.transition()"
    - "COALESCE SQL increment pattern for addSellPrice: COALESCE(sell_price_sol, 0) + @delta"
    - "Fallback chain for sell price: on-chain parse (EMERGENCY) -> quote estimate -> PositionManager lastKnownQuoteSol -> undefined"
    - "Tiered TP partial detection: hasPriorSellPrice = sellPriceSol != null && sellPriceSol > 0"

key-files:
  created: []
  modified:
    - src/execution/sell/sell-ladder.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/persistence/trade-store.ts
    - src/dashboard/bot-event-bus.ts
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
    - src/execution/jupiter-client.test.ts
    - src/recovery/recovery-manager.test.ts

key-decisions:
  - "EMERGENCY step uses parseSolReceived on-chain parse to get actual SOL received (Jupiter quote unreliable at 49% slippage)"
  - "On-chain parse failure falls back to PositionManager lastKnownQuoteSol (last Jupiter quote value), then to undefined"
  - "addSellPrice uses COALESCE(sell_price_sol, 0) + delta SQL pattern (crash-safe, no in-memory accumulation)"
  - "SELL_PARTIAL detection via hasPriorSellPrice: sellPriceSol > 0 means prior tiers have fired"

patterns-established:
  - "SellLadder.sell(mint, tokenAmount, fallbackSolReceived?) -- 3rd param is PositionManager last known quote for fallback"
  - "tradeStore.addSellPrice(mint, delta) for tiered partial accumulation vs tradeStore.transition() for final completion"

requirements-completed: []

# Metrics
duration: 14min
completed: 2026-03-04
---

# Phase 14 Plan 02: SellLadder solReceived Threading and pnlSol Fix Summary

**SellLadder now threads solReceived from seller outcomes to SQLite via sellPriceSol, fixes pnlSol formula to use amountSol, adds SELL_PARTIAL events for tiered TP, and overrides EMERGENCY with on-chain parse**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-04T14:49:51Z
- **Completed:** 2026-03-04T15:03:51Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- SellLadder extracts solReceived from SellOutcome/ChunkedSellOutcome and passes it as sellPriceSol to tradeStore.transition() on every successful sell step
- pnlSol formula corrected: SELL_CONFIRMED events now report `sellPriceSol - amountSol` (total received minus total spent), replacing the incorrect `sellPriceSol - buyPriceSol` (which was a per-token unit comparison)
- TradeStore.addSellPrice() method added for incremental tiered TP accumulation using COALESCE SQL pattern
- SELL_PARTIAL event emitted per tiered TP tier fire with SOL received for that tier and running total
- EMERGENCY step overrides solReceived with on-chain parseSolReceived (per locked decision: Jupiter quotes unreliable at 49% slippage)
- PositionManager tracks lastKnownQuoteSol from Jupiter quotes and passes as fallback to SellLadder.sell() for parse failures
- All 292 tests green after updating position-manager/jupiter-client/recovery-manager tests to match current source strings

## Task Commits

Each task was committed atomically:

1. **Task 1: Add TradeStore.addSellPrice(), SELL_PARTIAL event type, PositionManager lastKnownQuoteSol** - `97d6a45` (feat)
2. **Task 2: Thread solReceived through SellLadder, fix pnlSol, EMERGENCY on-chain parse** - `dab54e6` (feat)

## Files Created/Modified

- `src/execution/sell/sell-ladder.ts` - sell() accepts fallbackSolReceived, extracts solReceived from outcomes, EMERGENCY on-chain parse, SELL_PARTIAL emission, correct pnlSol formula
- `src/execution/sell/sell-ladder.test.ts` - mocks updated to SellOutcome/ChunkedSellOutcome, parseSolReceived mock added, new tests for sellPriceSol threading/pnlSol formula/fallback
- `src/persistence/trade-store.ts` - addSellPrice() method added with COALESCE SQL increment pattern
- `src/dashboard/bot-event-bus.ts` - SELL_PARTIAL added to BotEventType union
- `src/position/position-manager.ts` - lastKnownQuoteSol Map tracking, fireSell() passes fallback to sell()
- `src/position/position-manager.test.ts` - sell() assertions updated to include 3rd fallback arg
- `src/execution/jupiter-client.test.ts` - em dash -> double dash in error message assertions (match source)
- `src/recovery/recovery-manager.test.ts` - em dash -> double dash in error message assertions (match source)

## Decisions Made

- EMERGENCY step uses parseSolReceived on-chain parse instead of Jupiter quote outAmount -- Jupiter quotes are unreliable at 49% slippage extremes; on-chain parse provides actual SOL received
- On-chain parse failure falls back to PositionManager's lastKnownQuoteSol (last Jupiter quote), then undefined -- avoids storing NULL in DB when possible
- addSellPrice uses COALESCE(sell_price_sol, 0) + delta SQL pattern -- crash-safe, no in-memory accumulation between restarts
- SELL_PARTIAL detection via `hasPriorSellPrice` (sellPriceSol > 0) -- first tier sets sell_price_sol, subsequent tiers detect it and emit SELL_PARTIAL before transition

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] makeTradeStore mock missing addSellPrice method**
- **Found during:** Task 2 (sell-ladder tests)
- **Issue:** makeTradeStore() in sell-ladder.test.ts did not include addSellPrice mock; pnlSol test failed with "this.tradeStore.addSellPrice is not a function" because getTradeByMintResult had sellPriceSol > 0
- **Fix:** Added `addSellPrice: vi.fn().mockReturnValue(1)` to makeTradeStore mock
- **Files modified:** src/execution/sell/sell-ladder.test.ts
- **Verification:** All 15 sell-ladder tests pass
- **Committed in:** dab54e6 (Task 2 commit)

**2. [Rule 1 - Bug] position-manager.test.ts sell() assertions missing 3rd arg**
- **Found during:** Task 2 (full test suite run)
- **Issue:** 10 position-manager tests failed because fireSell() now passes lastKnownQuoteSol as 3rd arg to sell(), but tests asserted sell(mint, tokens) with only 2 args
- **Fix:** Updated all fireSell assertion sites to include expected 3rd arg (lastKnownQuoteSol value matching the mockJupiterQuote return for that test)
- **Files modified:** src/position/position-manager.test.ts
- **Verification:** All 31 position-manager tests pass
- **Committed in:** dab54e6 (Task 2 commit)

**3. [Rule 1 - Bug] Em dash -> double dash mismatch in test error message assertions**
- **Found during:** Task 2 (full test suite run)
- **Issue:** jupiter-client.ts and recovery-manager.ts were modified in prior phase commits to use `--` instead of `—` (em dash) in error messages, but test assertions still matched em dash strings
- **Fix:** Updated 3 test assertions in jupiter-client.test.ts and 2 in recovery-manager.test.ts to use `--`
- **Files modified:** src/execution/jupiter-client.test.ts, src/recovery/recovery-manager.test.ts
- **Verification:** All 25 test files pass (292 tests)
- **Committed in:** dab54e6 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs)
**Impact on plan:** All auto-fixes necessary for test correctness. First two directly caused by Task 2 implementation. Third is a pre-existing mismatch from prior phase commits now surfaced. No scope creep.

## Issues Encountered

None significant beyond the auto-fixed test assertion mismatches above.

## Next Phase Readiness

- Plan 14-02 complete: full data flow from seller execution to database is connected
- sellPriceSol is now stored on every successful sell; pnlSol computed correctly in SELL_CONFIRMED events
- Remaining phase 14 work: no other wave 2 plans visible in context
- 292 tests green, TypeScript clean

---
*Phase: 14-sell-price-bug-fixes*
*Completed: 2026-03-04*
