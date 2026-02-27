---
phase: 07-position-management
plan: 03
subsystem: position-management
tags: [typescript, solana, position-management, index-wiring, lifecycle, shutdown]

# Dependency graph
requires:
  - phase: 07-02
    provides: PositionManager class with start/stop, polling loop, exit triggers
  - phase: 07-01
    provides: maxConcurrentPositions config field, TradeStore.getMonitoringTrades()
  - phase: 06-crash-recovery
    provides: RecoveryManager startup ordering — PositionManager must start after recovery

provides:
  - PositionManager wired into src/index.ts startup sequence and shutdown handler
  - POS-06 max-position guard in token event handler (rejects buys at limit)
  - PositionManager lifecycle: initialized before recovery, started after recovery, stopped first in shutdown

affects:
  - 07-04 or future dashboard phases (PositionManager is running; position count observable)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shutdown teardown order: PositionManager.stop() → rpcManager.close() → detectionManager.stop() → tradeStore.close()"
    - "POS-06 guard: getMonitoringTrades().length >= maxConcurrentPositions before createBuyingRecord()"

key-files:
  created: []
  modified:
    - src/index.ts

key-decisions:
  - "PositionManager initialized before recovery (step 10) but started after recovery (step 12) — initialization is synchronous and safe to do early; start() must wait for recovered MONITORING trades to be in store"
  - "positionManager.stop() is first action in shutdown() — prevents new sell triggers while teardown proceeds and RPC connections are still open"
  - "POS-06 guard placed before isActive() duplicate guard — position limit check is cheaper than the active-mints lookup; also semantically correct (limit applies even to unseen mints)"

patterns-established:
  - "Lifecycle ordering: recovery → positionManager.start() → detectionManager.start() — detection produces new MONITORING trades that PositionManager picks up on next tick"

requirements-completed: [POS-06]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 7 Plan 03: index.ts PositionManager Wiring Summary

**PositionManager wired into index.ts with POS-06 max-concurrent-position guard, correct post-recovery start ordering, and first-in-shutdown teardown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T20:21:44Z
- **Completed:** 2026-02-27T20:25:44Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- PositionManager integrated into the bot's main startup sequence with correct ordering: initialized after SellLadder, started after crash recovery completes, stopped as the very first shutdown action
- POS-06 position limit enforced: new buys rejected when `getMonitoringTrades().length >= maxConcurrentPositions`, logged with activePositions and limit values
- Shutdown teardown order documented: PositionManager (step 0) → rpcManager (step 1) → detectionManager (step 2) → tradeStore (step 3)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire PositionManager into index.ts** - `cead934` (feat)

## Files Created/Modified

- `src/index.ts` - Added PositionManager import, initialization (step 10), post-recovery start (step 12), POS-06 max-position guard in token event handler, shutdown() parameter and first-action stop()

## Decisions Made

- PositionManager initialized before crash recovery but started after — initialization is cheap/synchronous; start() begins polling immediately and must see the recovered MONITORING trades already in the store
- `positionManager.stop()` is step 0 in shutdown — RPC connections must still be available in case any in-flight sells need to complete; stopping the polling loop first prevents new sell triggers from being initiated during teardown
- POS-06 guard placed before the isActive() duplicate guard — position limit check is semantically prior; we reject at the limit even for unseen mints

## Deviations from Plan

None — plan executed exactly as written. All four changes (import, init, start, shutdown) applied without issues. tsc passed clean, all 178 tests passed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PositionManager is now live: it polls every `pollIntervalMs` milliseconds for MONITORING trades and fires stop-loss/take-profit/trailing-stop exits
- Phase 7 is complete — all three plans executed: config (07-01), PositionManager class (07-02), index.ts wiring (07-03)
- Phase 8 (Dashboard) can proceed — PositionManager position count is observable via `tradeStore.getMonitoringTrades()`

---
*Phase: 07-position-management*
*Completed: 2026-02-27*

## Self-Check: PASSED

- FOUND: src/index.ts
- FOUND: .planning/phases/07-position-management/07-03-SUMMARY.md
- FOUND commit: cead934 (feat(07-03): wire PositionManager into index.ts)
- tsc --noEmit: 0 errors
- pnpm vitest run: 178/178 tests passed (0 regressions)
