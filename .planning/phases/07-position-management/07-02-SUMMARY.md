---
phase: 07-position-management
plan: 02
subsystem: position-management
tags: [jupiter-api, solana, position-management, stop-loss, take-profit, trailing-stop, typescript, vitest]

# Dependency graph
requires:
  - phase: 07-01
    provides: PositionManagementConfigSchema, TradeStore.updateMonitoringAmount() backfill method
  - phase: 05-execution-engine
    provides: SellLadder.sell() for exit trigger execution
  - phase: 04-trade-persistence
    provides: TradeStore.getMonitoringTrades() and trade state machine
  - phase: 06-crash-recovery
    provides: dual-program on-chain balance query pattern (TOKEN_PROGRAM_ID + TOKEN_2022_PROGRAM_ID)
provides:
  - PositionManager class with start/stop, recursive setTimeout polling loop
  - Stop-loss exit trigger (fires when position value drops below configured threshold)
  - Tiered take-profit exit trigger (partial sells at each multiplier tier)
  - Trailing stop exit trigger (fires when price drops below high watermark by pct)
  - PumpPortal amountTokens backfill via on-chain balance query
  - sellsInFlight guard preventing double-sells on same position
  - 16 unit tests covering all exit strategy branches
affects:
  - 07-03 (index.ts wiring — PositionManager must be instantiated and started)
  - 07-04 or future dashboard phases (monitoring position count/state)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recursive setTimeout for polling (not setInterval) — each poll waits for previous to complete"
    - "TP takes priority over SL by evaluating tiered TP before SL in evaluatePosition()"
    - "sellsInFlight Set for double-sell guard — cleaned up via .finally() on sell promise"
    - "fireSell() captures promise before void — allows .finally() cleanup while discarding return value"
    - "Math.round before BigInt() conversion for float amountTokens (SQLite REAL float)"
    - "Dual-program on-chain balance query (same pattern as RecoveryManager)"
    - "Jupiter quote null return = skip tick, not a sell trigger (defensive design)"

key-files:
  created:
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
  modified: []

key-decisions:
  - "fireSell() captures promise ref before void — enables .finally() cleanup while maintaining fire-and-forget semantics for the tick"
  - "TP priority over SL implemented by checking tiered TP first in evaluatePosition() — early return before SL check"
  - "Math.round applied before BigInt() — SQLite stores amountTokens as REAL float which can have fractional parts"
  - "High watermark initialized to entry price (amountSol) on first tick — not to zero — prevents false trailing stop on startup"

patterns-established:
  - "Polling loop pattern: recursive setTimeout with try/catch/finally in scheduleTick()"
  - "Fire-and-forget with cleanup: const p = fn(); void p; p.finally(() => cleanup())"

requirements-completed: [POS-01, POS-02, POS-03, POS-04, POS-05]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 7 Plan 02: Position Management Summary

**PositionManager class with Jupiter-quoted polling loop, stop-loss/tiered-TP/trailing-stop exit triggers, PumpPortal backfill, and 16 unit tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T20:13:17Z
- **Completed:** 2026-02-27T20:17:46Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Implemented PositionManager with recursive setTimeout polling (not setInterval) — polls all MONITORING trades every `pollIntervalMs`
- All five exit strategies implemented: stop-loss, tiered take-profit (3 tiers by default), trailing stop, sellsInFlight guard, PumpPortal backfill
- 16 unit tests passing with zero regressions in the existing 162-test suite (total: 178 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement PositionManager class** - `ba2ba08` (feat)
2. **Task 2: Unit tests for PositionManager** - `b417e90` (test)

**Plan metadata:** (docs commit below)

## Files Created/Modified

- `src/position/position-manager.ts` - PositionManager class with start/stop, polling loop, all exit triggers, PumpPortal backfill, Jupiter quote fetch
- `src/position/position-manager.test.ts` - 16 unit tests covering stop-loss, tiered TP (all tiers), trailing stop, TP priority, sellsInFlight guard, Jupiter failure, backfill, float-to-bigint

## Decisions Made

- `fireSell()` pattern: capture promise ref before `void` to allow `.finally()` cleanup while maintaining fire-and-forget semantics for the tick cycle
- TP priority over SL: implemented by evaluating tiered TP first in `evaluatePosition()` and returning early — no need for explicit priority flag
- `Math.round()` before `BigInt()` conversion: SQLite stores `amount_tokens` as REAL (float), which can have fractional parts from division operations
- High watermark initialized to `trade.amountSol` (entry price) on first tick, not to zero — prevents false trailing stop triggers on startup

## Deviations from Plan

None — plan executed exactly as written. The 16 tests written exceed the plan's 12-test requirement, providing additional coverage for multi-position handling, start/stop lifecycle, and tier-exhaustion + SL interaction.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `src/position/position-manager.ts` is ready to be instantiated in `index.ts`
- Constructor requires: `TradeStore`, `SellLadder`, `Connection`, `PublicKey` (wallet), `TradingConfig`
- Must call `positionManager.start()` after `recoveryManager.run()` completes
- Phase 7 Plan 03 (index.ts wiring) can proceed immediately

---
*Phase: 07-position-management*
*Completed: 2026-02-27*

## Self-Check: PASSED

- FOUND: src/position/position-manager.ts
- FOUND: src/position/position-manager.test.ts
- FOUND: .planning/phases/07-position-management/07-02-SUMMARY.md
- FOUND commit: ba2ba08 (feat: PositionManager class)
- FOUND commit: b417e90 (test: PositionManager unit tests)
- tsc --noEmit: 0 errors
- pnpm vitest run: 178/178 tests passed (16 new + 162 existing)
