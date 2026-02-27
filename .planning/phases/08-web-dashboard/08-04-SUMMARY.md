---
phase: 08-web-dashboard
plan: 04
subsystem: integration
tags: [fastify, sse, eventemitter, bot-events, dashboard]

# Dependency graph
requires:
  - phase: 08-01
    provides: botEventBus singleton and BotEventType definitions
  - phase: 08-02
    provides: createDashboardServer (Fastify + SSE routes + REST API)
  - phase: 08-03
    provides: Preact SPA frontend compiled to dashboard/dist/
provides:
  - "BUY_SENT, BUY_CONFIRMED, BUY_FAILED events emitted from ExecutionEngine.buy()"
  - "SELL_TRIGGERED, SELL_CONFIRMED, SELL_FAILED events emitted from SellLadder.sell()"
  - "ERROR events emitted from SafetyPipeline.evaluate() catch block"
  - "TOKEN_DETECTED emitted in index.ts token handler when safety passes"
  - "Fastify dashboard server started in main() at step 12.5 (127.0.0.1:DASHBOARD_PORT)"
  - "dashboardServer.close() called in shutdown() at step 0.5 before rpcManager.close()"
affects: [all future phases involving execution or safety changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "botEventBus fire-and-forget pattern: emit() calls as non-critical side effects in try/catch blocks"
    - "Dashboard server lifecycle: start after positionManager.start(), close before rpcManager.close()"

key-files:
  created: []
  modified:
    - src/execution/execution-engine.ts
    - src/execution/sell/sell-ladder.ts
    - src/safety/safety-pipeline.ts
    - src/index.ts

key-decisions:
  - "BUY_SENT emitted before the actual buy call (after write-ahead record) to give dashboard earliest possible signal"
  - "SELL_TRIGGERED emitted before MONITORING->SELLING transition — dashboard sees intent before state change"
  - "SafetyPipeline.evaluate() wrapped in try/catch to emit ERROR; catch re-throws to preserve existing caller behavior"
  - "TOKEN_DETECTED placed as first line inside result.pass block — before position limit and duplicate checks — so dashboard sees all safety-passing tokens even if later guards reject"
  - "dashboardServer typed as FastifyInstance in shutdown() parameter — avoids importing full Fastify module for type"

patterns-established:
  - "BotEvent emission is always fire-and-forget: never awaited, never in critical path, never swallows buy/sell errors"

requirements-completed: [DASH-01, DASH-06]

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 08 Plan 04: Bot Event Wiring + Dashboard Server Integration Summary

**BotEvents wired into ExecutionEngine/SellLadder/SafetyPipeline and Fastify dashboard server integrated into main() startup/shutdown lifecycle — SSE feed now live end-to-end**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T22:00:42Z
- **Completed:** 2026-02-27T22:05:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- ExecutionEngine.buy() emits BUY_SENT before dispatch, BUY_CONFIRMED on success, BUY_FAILED on failure or exception
- SellLadder.sell() emits SELL_TRIGGERED at entry, SELL_CONFIRMED on first successful step, SELL_FAILED when all ladder steps exhaust
- SafetyPipeline.evaluate() wrapped in try/catch that emits ERROR on unexpected exceptions and re-throws
- TOKEN_DETECTED emitted in index.ts token handler immediately when safety.pass is true
- Fastify dashboard server created and started at step 12.5 (after positionManager.start, before detection)
- Server binds to 127.0.0.1:DASHBOARD_PORT; dashboardServer.close() called at shutdown step 0.5

## Task Commits

Each task was committed atomically:

1. **Task 1: BotEvent emissions in ExecutionEngine, SellLadder, SafetyPipeline** - `c6e124b` (feat)
2. **Task 2: Dashboard server + TOKEN_DETECTED wiring in index.ts** - `008bb65` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `src/execution/execution-engine.ts` - Added botEventBus import; BUY_SENT/BUY_CONFIRMED/BUY_FAILED emissions in buy()
- `src/execution/sell/sell-ladder.ts` - Added botEventBus import; SELL_TRIGGERED/SELL_CONFIRMED/SELL_FAILED emissions in sell()
- `src/safety/safety-pipeline.ts` - Added botEventBus import; wrapped evaluate() body in try/catch to emit ERROR on unexpected errors
- `src/index.ts` - Added dashboard imports; updated shutdown() signature; dashboard server start at step 12.5; TOKEN_DETECTED emission; shutdown handler passes dashboardServer

## Decisions Made
- BUY_SENT placed before the actual buy call (inside the try block, after the write-ahead record is created by index.ts) so dashboard receives signal at earliest possible moment
- SELL_TRIGGERED placed before the MONITORING->SELLING transition so dashboard sees the intent at entry, regardless of which step ultimately runs
- SafetyPipeline ERROR emission re-throws the error — existing caller behavior in index.ts (logging the error) is preserved
- TOKEN_DETECTED emitted as the first line of the `result.pass` block in the token handler so the dashboard feed shows all safety-passing tokens even if position limit or duplicate guard later rejects the buy

## Deviations from Plan

None - plan executed exactly as written. The plan referenced an `execute()` method in SellLadder but the actual method name is `sell()` — no deviation, just that the plan's description was approximate and the implementation used the actual method name.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dashboard is now fully operational end-to-end: backend (Fastify SSE + REST), event bus (botEventBus), and frontend (Preact SPA) are all wired together
- Phase 8 Plan 05 (smoke test / UAT verification) is ready to proceed
- Bot process starts with dashboard HTTP server on DASHBOARD_PORT; all key lifecycle events (token detection, buy, sell) flow through SSE to connected dashboard clients

---
*Phase: 08-web-dashboard*
*Completed: 2026-02-27*
