---
phase: 20-reliability-monitoring
plan: 01
subsystem: monitoring
tags: [pino-roll, better-sqlite3, zod, websocket, alerts, logging]

# Dependency graph
requires:
  - phase: 19-execution-performance
    provides: FeeEstimator, BalanceGuard, execution config extensions
provides:
  - SYSTEM_ALERT BotEventType with severity/alertSource optional fields
  - MonitoringConfigSchema with alert cooldown, API failure threshold, log rotation defaults
  - ALERTS_SCHEMA_SQL DDL with timestamp and source indexes
  - AlertStore class with insert, paginated query, and count methods
  - pino-roll production log rotation (daily, 50MB, 7-day retention)
  - ResilientWebSocket getLastMessageAt() and isClosed() health accessors
  - TradeStore.getDb() for shared DB connection
affects: [20-02-PLAN, 20-03-PLAN, 20-04-PLAN, 21-dashboard-overhaul]

# Tech tracking
tech-stack:
  added: [pino-roll@4.0.0]
  patterns: [shared-db-accessor-pattern, monitoring-config-with-defaults]

key-files:
  created:
    - src/monitoring/alert-store.ts
    - src/monitoring/alert-store.test.ts
  modified:
    - src/dashboard/bot-event-bus.ts
    - src/config/trading.ts
    - src/persistence/schema.ts
    - src/persistence/trade-store.ts
    - src/core/logger.ts
    - src/core/resilient-ws.ts
    - package.json

key-decisions:
  - "MonitoringConfigSchema uses .default() with full objects for Zod v4 compatibility -- .default({}) fails TypeScript because Zod v4 expects output type"
  - "AlertStore receives shared DB instance from TradeStore.getDb() instead of creating own connection -- WAL mode requires single connection"
  - "pino-roll uses relative path 'logs/solsniper' with mkdir: true -- bot is always started from project root"

patterns-established:
  - "Shared DB pattern: new services receive DB from TradeStore.getDb() rather than opening separate connections"
  - "Monitoring config defaults: all monitoring fields have explicit defaults so existing config.jsonc works without modification"

requirements-completed: [REL-02, REL-04]

# Metrics
duration: 19min
completed: 2026-03-31
---

# Phase 20 Plan 01: Foundation Types, Config, AlertStore, Log Rotation Summary

**SYSTEM_ALERT event type, MonitoringConfigSchema, SQLite AlertStore, pino-roll production log rotation, and ResilientWebSocket health accessors for downstream monitoring plans**

## Performance

- **Duration:** 19 min
- **Started:** 2026-03-31T11:58:18Z
- **Completed:** 2026-03-31T12:17:10Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments
- Extended BotEventType with SYSTEM_ALERT and BotEvent with optional severity/alertSource fields (backward compatible)
- Added MonitoringConfigSchema to TradingConfigSchema with alert cooldown (60s), API failure threshold (5), and log rotation (50MB/daily/7-day) defaults
- Created AlertStore with insert, paginated query (LIMIT/OFFSET), and count methods backed by SQLite alerts table with timestamp DESC and source indexes
- Configured pino-roll for production log rotation while keeping pino-pretty for development
- Added getLastMessageAt() and isClosed() read-only accessors to ResilientWebSocket for HealthService consumption

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend types, config schema, alerts table schema, and AlertStore** - `3fe62d0` (feat)
2. **Task 2: pino-roll log rotation and ResilientWebSocket health accessors** - `1392285` (feat)

## Files Created/Modified
- `src/monitoring/alert-store.ts` - AlertStore class with insert/query/count, Alert interface
- `src/monitoring/alert-store.test.ts` - 5 tests: insert, pagination, ordering, count, offset
- `src/dashboard/bot-event-bus.ts` - SYSTEM_ALERT type, severity/alertSource optional fields
- `src/config/trading.ts` - MonitoringConfigSchema, LogRotationConfigSchema, MonitoringConfig type
- `src/persistence/schema.ts` - ALERTS_SCHEMA_SQL DDL, ALERTS_MIGRATION_SQL array
- `src/persistence/trade-store.ts` - ALERTS_SCHEMA_SQL exec in constructor, getDb() accessor
- `src/core/logger.ts` - buildTransport() with pino-roll production / pino-pretty development
- `src/core/resilient-ws.ts` - getLastMessageAt(), isClosed() public accessors
- `package.json` / `pnpm-lock.yaml` - pino-roll@4.0.0 dependency
- 11 test files - Added monitoring field to mock TradingConfig objects

## Decisions Made
- MonitoringConfigSchema uses `.default()` with full objects (`{ alertCooldownMs: 60_000, apiFailureThreshold: 5, logRotation: { sizeMb: 50, retentionDays: 7 } }`) because Zod v4 `.default({})` rejects empty objects when the output type has required fields
- AlertStore receives a shared `BetterSqlite3.Database` instance from `TradeStore.getDb()` instead of creating its own -- WAL mode requires single connection per file
- pino-roll uses relative path `logs/solsniper` with `mkdir: true` -- bot is always started from project root; early startup messages are buffered by pino

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Zod .default({}) TypeScript error for MonitoringConfigSchema**
- **Found during:** Task 2 (post-install TypeScript check)
- **Issue:** `MonitoringConfigSchema.default({})` and `LogRotationConfigSchema.default({})` fail tsc because Zod v4 default() expects the full output type, not the input type
- **Fix:** Provided explicit full default objects: `MonitoringConfigSchema.default({ alertCooldownMs: 60_000, ... })` and `LogRotationConfigSchema.default({ sizeMb: 50, retentionDays: 7 })`
- **Files modified:** src/config/trading.ts
- **Verification:** `npx tsc --noEmit` passes with 0 errors
- **Committed in:** 1392285

**2. [Rule 3 - Blocking] Added monitoring field to 11 test mock TradingConfig objects**
- **Found during:** Task 2 (TypeScript type check after adding monitoring to TradingConfigSchema)
- **Issue:** 11 test files manually construct TradingConfig objects without the new `monitoring` field, causing TS2741 errors
- **Fix:** Added `monitoring: { alertCooldownMs: 60000, apiFailureThreshold: 5, logRotation: { sizeMb: 50, retentionDays: 7 } }` to each mock config
- **Files modified:** detection-manager.test.ts, jupiter-buyer.test.ts, pump-portal-buyer.test.ts, execution-engine.test.ts, chunked-seller.test.ts, jito-seller.test.ts, pump-portal-seller.test.ts, sell-ladder.test.ts, standard-seller.test.ts, position-manager.test.ts, safety-pipeline.test.ts
- **Verification:** `npx tsc --noEmit` reports 0 errors
- **Committed in:** 1392285

---

**Total deviations:** 2 auto-fixed (2 blocking issues)
**Impact on plan:** Both fixes necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required. Log rotation is automatic in production mode.

## Known Stubs
None - all features are fully wired with real implementations.

## Next Phase Readiness
- All foundation types, schemas, and stores are ready for 20-02 (HealthService, MetricsTracker)
- AlertStore is importable and uses shared DB from TradeStore.getDb()
- BotEventType SYSTEM_ALERT is available for emitting from any subsystem
- ResilientWebSocket health accessors are available for HealthService consumption
- pino-roll transport is active in production for log rotation

## Self-Check: PASSED

All 8 key files found. Both task commits (3fe62d0, 1392285) verified in git history.

---
*Phase: 20-reliability-monitoring*
*Completed: 2026-03-31*
