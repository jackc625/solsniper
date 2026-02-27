---
phase: 08-web-dashboard
plan: 01
subsystem: config
tags: [eventemitter3, zod, typescript, dashboard, config]

# Dependency graph
requires:
  - phase: 07-position-management
    provides: Final trading config shape (TradingConfig) that patchRuntimeConfig wraps
provides:
  - getRuntimeConfig() and patchRuntimeConfig() exports from src/config/trading.ts
  - DASHBOARD_PORT and DASHBOARD_API_KEY env vars in EnvSchema
  - botEventBus singleton and BotEvent/BotEventType types from src/dashboard/bot-event-bus.ts
affects: [08-02-http-server, 08-03-api-routes, 08-04-sse-events, 08-05-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mutable runtime shadow pattern: let _runtimeConfig mirrors static export for live mutation"
    - "Typed EventEmitter3 singleton: single event name with typed payload, named import to avoid TS2507"

key-files:
  created:
    - src/dashboard/bot-event-bus.ts
  modified:
    - src/config/trading.ts
    - src/config/env.ts
    - src/detection/detection-manager.test.ts

key-decisions:
  - "patchRuntimeConfig shallow-merges updates via spread — callers must pass validated Partial<TradingConfig>"
  - "botEventBus uses single event name 'event' with typed BotEvent payload — simpler than per-type event names"
  - "DASHBOARD_PORT has default 3001 so existing .env files require no changes"
  - "DASHBOARD_API_KEY optional with no default — absent means auth disabled (opt-in security)"

patterns-established:
  - "Mutable config shadow: static tradingConfig for backwards compat, _runtimeConfig for live patching"
  - "Named EventEmitter3 import to avoid TS2507 constructor error with Node16 module resolution"

requirements-completed: [DASH-01, DASH-04, DASH-05, DASH-06]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 8 Plan 01: Foundation Contracts Summary

**Mutable runtime config layer (getRuntimeConfig/patchRuntimeConfig), dashboard env vars (DASHBOARD_PORT/DASHBOARD_API_KEY), and typed BotEventBus singleton — the three contracts all subsequent Phase 8 plans import from**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T21:41:03Z
- **Completed:** 2026-02-27T21:44:26Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `getRuntimeConfig()` and `patchRuntimeConfig()` to trading.ts without disturbing existing `tradingConfig` export — all existing callers continue working
- Added `DASHBOARD_PORT` (default 3001) and `DASHBOARD_API_KEY` (optional, auth-disabled when absent) to env.ts EnvSchema
- Created `src/dashboard/bot-event-bus.ts` with typed EventEmitter3 singleton using project-standard named import pattern
- All 178 existing tests continue passing with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add mutable config layer and dashboard env vars** - `0b298d4` (feat)
2. **Task 2: Create BotEventBus singleton** - `56f2b77` (feat)

**Plan metadata:** (docs commit — recorded after state updates)

## Files Created/Modified

- `src/config/trading.ts` - Added `_runtimeConfig` shadow, `getRuntimeConfig()`, `patchRuntimeConfig()` below existing `tradingConfig`
- `src/config/env.ts` - Added `DASHBOARD_PORT` and `DASHBOARD_API_KEY` to `EnvSchema`
- `src/dashboard/bot-event-bus.ts` - New file: typed EventEmitter3 singleton with `BotEvent`, `BotEventType`, `botEventBus`
- `src/detection/detection-manager.test.ts` - Fixed `makeEnv()` fixture to include required `DASHBOARD_PORT` field

## Decisions Made

- `patchRuntimeConfig` uses shallow spread merge — callers must pass validated `Partial<TradingConfig>`. Nested objects (e.g., `execution.buy`) must be passed as complete sub-objects if overriding.
- `botEventBus` uses single event name `'event'` with typed `BotEvent` payload rather than per-type event names — simpler listener registration for SSE route.
- `DASHBOARD_API_KEY` absent means auth disabled (opt-in security model) — consistent with existing optional API keys pattern in env.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed detection-manager.test.ts makeEnv() fixture missing DASHBOARD_PORT**
- **Found during:** Task 1 (tsc verification)
- **Issue:** Adding `DASHBOARD_PORT: number` (non-optional with default) to `Env` type caused TS2719 in detection-manager.test.ts — `makeEnv()` returned a partial object missing the new required field
- **Fix:** Added `DASHBOARD_PORT: 3001` to the `makeEnv()` fixture object in detection-manager.test.ts
- **Files modified:** src/detection/detection-manager.test.ts
- **Verification:** `tsc --noEmit` exits 0, all 178 tests pass
- **Committed in:** `0b298d4` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test fixture)
**Impact on plan:** Necessary correction — Env type change propagated to test fixture. No scope creep.

## Issues Encountered

None beyond the test fixture fix documented above.

## User Setup Required

None - no external service configuration required. New env vars have sensible defaults and are optional.

## Next Phase Readiness

- `getRuntimeConfig()` and `patchRuntimeConfig()` ready for config PATCH endpoint in 08-03
- `DASHBOARD_PORT` and `DASHBOARD_API_KEY` ready for Fastify server startup in 08-02
- `botEventBus` ready for SSE route (08-03) and bot module emit calls (08-04)
- All 3 foundational contracts in place — 08-02 through 08-05 can proceed without ambiguity

---
*Phase: 08-web-dashboard*
*Completed: 2026-02-27*

## Self-Check: PASSED

- FOUND: src/config/trading.ts
- FOUND: src/config/env.ts
- FOUND: src/dashboard/bot-event-bus.ts
- FOUND: .planning/phases/08-web-dashboard/08-01-SUMMARY.md
- FOUND commit: 0b298d4 (feat(08-01): add mutable runtime config layer and dashboard env vars)
- FOUND commit: 56f2b77 (feat(08-01): create BotEventBus singleton for dashboard SSE events)
