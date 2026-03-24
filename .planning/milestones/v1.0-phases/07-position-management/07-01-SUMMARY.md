---
phase: 07-position-management
plan: 01
subsystem: config
tags: [zod, sqlite, better-sqlite3, position-management, config]

requires:
  - phase: 05-execution-engine
    provides: PumpPortal buy path (amountTokens undefined for PumpPortal trades entering MONITORING)
  - phase: 04-trade-persistence
    provides: TradeStore with state machine, MONITORING state, existing prepared statements

provides:
  - PositionManagementConfigSchema and TierSchema Zod schemas in trading.ts
  - PositionManagementConfig exported type
  - positionManagement field on TradingConfig (pollIntervalMs, stopLossPct, tieredTp, trailingStopPct)
  - positionManagement block in config.jsonc with defaults and inline documentation
  - TradeStore.updateMonitoringAmount(mint, amountTokens) for PumpPortal token backfill

affects:
  - 07-02 (PositionManager depends on config types and TradeStore method)

tech-stack:
  added: []
  patterns:
    - "Zod schema with .default() fields — PositionManagementConfigSchema needs no required fields in config.jsonc"
    - "Dedicated UPDATE prepared statement for single-field backfill without state transition"

key-files:
  created: []
  modified:
    - src/config/trading.ts
    - config.jsonc
    - src/persistence/trade-store.ts

key-decisions:
  - "Keep top-level stopLossPct and takeProfitPct in TradingConfigSchema — backward compat, positionManagement.stopLossPct is what PositionManager uses"
  - "Dedicated stmtSetMonitoringAmount statement for PumpPortal backfill — cleaner than reusing transition() for same-state update"
  - "TierSchema at field is a multiplier (2 = 2x entry value), pct is percent of remaining tokens"

patterns-established:
  - "Mock TradingConfig objects in tests must include positionManagement block with all 4 fields"

requirements-completed:
  - POS-01
  - POS-02
  - POS-03
  - POS-04
  - POS-05

duration: 5min
completed: 2026-02-27
---

# Phase 7 Plan 1: Position Management Config and TradeStore Backfill Method Summary

**Zod-validated positionManagement config block (pollIntervalMs, stopLossPct, tieredTp, trailingStopPct) added to TradingConfig, with TradeStore.updateMonitoringAmount() for PumpPortal token amount backfill**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T20:03:48Z
- **Completed:** 2026-02-27T20:08:48Z
- **Tasks:** 3
- **Files modified:** 10 (3 planned + 6 test files auto-fixed + 1 config)

## Accomplishments

- TradingConfig now has a `positionManagement` field with full Zod validation and defaults — Plan 02's PositionManager can consume typed config fields immediately
- config.jsonc positionManagement block with inline rate-limit notes and field semantics documentation
- TradeStore.updateMonitoringAmount() dedicated prepared statement targeting MONITORING state without state transition — enables PumpPortal token backfill in Phase 7-02

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PositionManagementConfigSchema to trading.ts** - `f935e4c` (feat)
2. **Task 2: Update config.jsonc with positionManagement block** - `0d3cafb` (feat)
3. **Task 3: Add updateMonitoringAmount() to TradeStore** - `81a7695` (feat)

## Files Created/Modified

- `src/config/trading.ts` - Added TierSchema, PositionManagementConfigSchema, PositionManagementConfig export type, positionManagement field on TradingConfigSchema
- `config.jsonc` - Added positionManagement section with pollIntervalMs=5000, stopLossPct=-50, tieredTp=[2x/5x/10x], trailingStopPct=0
- `src/persistence/trade-store.ts` - Added stmtSetMonitoringAmount prepared statement and updateMonitoringAmount() public method
- `src/detection/detection-manager.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)
- `src/execution/buy/jupiter-buyer.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)
- `src/execution/buy/pump-portal-buyer.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)
- `src/execution/execution-engine.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)
- `src/execution/sell/sell-ladder.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)
- `src/safety/safety-pipeline.test.ts` - Added positionManagement defaults to mock TradingConfig (auto-fix)

## Decisions Made

- Kept top-level `stopLossPct` and `takeProfitPct` in TradingConfigSchema for backward compatibility — positionManagement.stopLossPct is the field PositionManager will use
- Used a dedicated `stmtSetMonitoringAmount` prepared statement for the PumpPortal backfill case rather than reusing `transition()` — cleaner, avoids same-state confusion
- TierSchema `at` field is a price multiplier (2 = 2x entry value in SOL), `pct` is percent of remaining tokens to sell at that tier

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 6 test mock TradingConfig objects to include positionManagement**
- **Found during:** Task 1 (Add PositionManagementConfigSchema to trading.ts)
- **Issue:** Adding `positionManagement` as a required field to TradingConfigSchema caused tsc TS2741 errors in 6 test files that construct mock TradingConfig objects without the new field
- **Fix:** Added `positionManagement: { pollIntervalMs: 5000, stopLossPct: -50, tieredTp: [...], trailingStopPct: 0 }` to each mock object
- **Files modified:** detection-manager.test.ts, jupiter-buyer.test.ts, pump-portal-buyer.test.ts, execution-engine.test.ts, sell-ladder.test.ts, safety-pipeline.test.ts
- **Verification:** tsc --noEmit passes, pnpm vitest run: 162 tests pass
- **Committed in:** f935e4c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Auto-fix required for correct TypeScript compilation. Adding a required schema field requires updating all typed mock objects in tests. No scope creep.

## Issues Encountered

None — auto-fix resolved the only unexpected issue cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (PositionManager implementation) can import `positionManagement` from `tradingConfig` immediately
- `TradeStore.updateMonitoringAmount()` is ready for PositionManager to call during PumpPortal token backfill
- All 162 existing tests still passing — clean foundation for Phase 7-02

---
*Phase: 07-position-management*
*Completed: 2026-02-27*
