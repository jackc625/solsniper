---
phase: 21-dashboard-overhaul
plan: 01
subsystem: api
tags: [fastify, sse, controls, safety-pipeline, preact]

# Dependency graph
requires:
  - phase: 08-web-dashboard
    provides: "Fastify dashboard server, BotEventBus, SSE streaming"
  - phase: 13-ui-rework
    provides: "FeedCard pattern, LiveFeed streaming, sidebar nav"
provides:
  - "SAFETY_EVALUATION event type emitted from SafetyPipeline on every non-cached evaluation"
  - "Controls route plugin with pause/resume, force-sell, emergency-stop endpoints"
  - "Detection pause flag wired as first guard in token event handler"
  - "PositionManager.isSellInFlight() public method for double-sell prevention"
  - "TradeStore.getTradeById() method for ID-based trade lookups"
  - "Frontend feed store updated with new event types (SAFETY_EVALUATION, LOW_BALANCE, SYSTEM_ALERT)"
affects: [21-02, 21-03, 21-04, 21-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [controls-route-plugin, detection-pause-flag, safety-evaluation-emission]

key-files:
  created:
    - src/dashboard/routes/controls.ts
    - src/dashboard/routes/controls.test.ts
  modified:
    - src/dashboard/bot-event-bus.ts
    - src/safety/safety-pipeline.ts
    - src/safety/safety-pipeline.test.ts
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
    - src/dashboard/dashboard-server.ts
    - src/index.ts
    - src/persistence/trade-store.ts
    - dashboard/src/store/feed.ts

key-decisions:
  - "emitSafetyEvaluation called at all 4 non-cached exit paths in SafetyPipeline.evaluate()"
  - "Detection pause check is the FIRST guard in token handler (before maxConcurrentPositions)"
  - "createDashboardServer signature extended with controlsOpts object (not individual params)"
  - "getTradeById added to TradeStore (not raw DB query) for consistent snake_case mapping"
  - "Added env mock to safety-pipeline.test.ts for worktree compatibility"

patterns-established:
  - "ControlsPluginOptions pattern: callbacks injected via Fastify plugin opts (getDetectionPaused, setDetectionPaused, isSellInFlight, triggerSell)"
  - "Detection pause flag: mutable object { paused: false } in index.ts closure, read/write via callbacks"

requirements-completed: [DASH-08, DASH-09]

# Metrics
duration: 14min
completed: 2026-04-01
---

# Phase 21 Plan 01: Backend Controls API Summary

**SAFETY_EVALUATION event emission from safety pipeline, controls route plugin (pause/resume, force-sell, emergency-stop), and detection pause flag wiring**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-01T17:10:33Z
- **Completed:** 2026-04-01T17:25:17Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- SAFETY_EVALUATION events emitted from SafetyPipeline on every non-cached evaluation with full per-check detail (tier breakdown, scores, timing)
- Controls route plugin with 4 endpoints: GET /api/controls/status, POST /api/controls/detection, POST /api/trades/:id/force-sell, POST /api/controls/emergency-stop
- Detection pause flag wired as first guard in token handler, controllable via dashboard API
- PositionManager.isSellInFlight() exposed as public method for force-sell 409 conflict detection

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, event bus, safety emission, PositionManager method** - `f6c4ac3` (feat)
2. **Task 2: Controls route plugin + dashboard-server registration + index.ts wiring** - `c5664c2` (feat)

## Files Created/Modified
- `src/dashboard/routes/controls.ts` - Controls route plugin with pause/resume, force-sell, emergency-stop endpoints
- `src/dashboard/routes/controls.test.ts` - 8 unit tests covering all endpoint behaviors
- `src/dashboard/bot-event-bus.ts` - SAFETY_EVALUATION, LOW_BALANCE, SYSTEM_ALERT added to BotEventType; safetyResult field added to BotEvent
- `src/safety/safety-pipeline.ts` - emitSafetyEvaluation() method, called at all 4 non-cached evaluation paths
- `src/safety/safety-pipeline.test.ts` - 3 SAFETY_EVALUATION tests added, env mock for worktree compatibility
- `src/position/position-manager.ts` - isSellInFlight() public method
- `src/position/position-manager.test.ts` - 2 isSellInFlight tests added
- `src/dashboard/dashboard-server.ts` - controlsRoute import and registration, controlsOpts parameter
- `src/index.ts` - detectionState pause flag, controls callbacks in createDashboardServer call, pause guard in token handler
- `src/persistence/trade-store.ts` - getTradeById() method with prepared statement
- `dashboard/src/store/feed.ts` - eventTypes array extended, safetyResult field added to FeedEvent

## Decisions Made
- emitSafetyEvaluation called at all 4 non-cached exit paths (tier1 reject, soft block, threshold reject, pass) -- ensures dashboard sees every evaluation
- Detection pause check placed as FIRST guard in token handler before maxConcurrentPositions check per D-12 and Pitfall 2
- createDashboardServer extended with controlsOpts object parameter rather than individual params for cleaner API
- getTradeById added as a proper TradeStore method with mapRow() for consistent camelCase field names
- Added env mock to safety-pipeline.test.ts to fix pre-existing worktree test failure (env.ts process.exit on missing vars)
- LOW_BALANCE and SYSTEM_ALERT added to BotEventType alongside SAFETY_EVALUATION for completeness

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added env mock to safety-pipeline.test.ts**
- **Found during:** Task 1 (TDD RED phase)
- **Issue:** safety-pipeline.test.ts failed in worktree because .env file doesn't exist; env.ts called process.exit(1)
- **Fix:** Added vi.mock('../config/env.js') with required env vars to test file
- **Files modified:** src/safety/safety-pipeline.test.ts
- **Verification:** All 15 safety pipeline tests pass
- **Committed in:** f6c4ac3 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for test execution in worktree environment. No scope creep.

## Issues Encountered
None beyond the env mock deviation noted above.

## Known Stubs
None -- all endpoints are fully wired with real callbacks.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All backend infrastructure for Plans 02-05 is in place
- SAFETY_EVALUATION events flow through SSE stream to dashboard
- Controls API endpoints ready for frontend consumption
- Detection pause flag and emergency stop fully functional

## Self-Check: PASSED

All created files verified present. Both task commits (f6c4ac3, c5664c2) verified in git log.

---
*Phase: 21-dashboard-overhaul*
*Completed: 2026-04-01*
