---
phase: 20-reliability-monitoring
plan: 03
subsystem: dashboard-routes
tags: [fastify, health-check, alerts, metrics, api-routes]

# Dependency graph
requires:
  - phase: 20-01
    provides: AlertStore class with query method, Alert/AlertQueryResult types
  - phase: 20-02
    provides: HealthService with check(), MetricsTracker with getAllStats(), ComponentStatus/EndpointStats types
provides:
  - GET /api/health route returning HealthCheckResult with HTTP 503 on down status
  - GET /api/alerts route with paginated query (page/limit params, limit capped at 100)
  - GET /api/metrics route returning per-endpoint stats with windowMs
  - Updated createDashboardServer signature accepting HealthService, AlertStore, MetricsTracker
affects: [20-04-PLAN, 21-dashboard-overhaul]

# Tech tracking
tech-stack:
  added: []
  patterns: [fastify-plugin-with-typed-options, query-param-parsing-with-defaults]

key-files:
  created:
    - src/dashboard/routes/health.ts
    - src/dashboard/routes/health.test.ts
    - src/dashboard/routes/alerts.ts
    - src/dashboard/routes/alerts.test.ts
    - src/dashboard/routes/metrics.ts
    - src/dashboard/routes/metrics.test.ts
  modified:
    - src/dashboard/dashboard-server.ts

key-decisions:
  - "Health route returns HTTP 503 only for status=down, 200 for both healthy and degraded -- degraded is operational"
  - "Alerts limit capped at 100 to prevent abuse -- default 50 is generous for dashboard pagination"
  - "Metrics route returns hardcoded windowMs: 300000 matching MetricsTracker default -- single source of truth in tracker constructor"
  - "Routes registered after configRoute in dashboard-server.ts -- order matters for Fastify plugin encapsulation"

patterns-established:
  - "Monitoring route pattern: typed options interface extending FastifyPluginOptions, service injected via opts"

requirements-completed: [REL-01, REL-02, REL-03]

# Metrics
duration: 4min
completed: 2026-03-31
---

# Phase 20 Plan 03: Health, Alerts, and Metrics API Routes Summary

**Three Fastify route plugins exposing monitoring data via GET /api/health (503 on down), GET /api/alerts (paginated), and GET /api/metrics (per-endpoint stats) registered in dashboard-server.ts**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-31T12:54:13Z
- **Completed:** 2026-03-31T12:58:11Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created healthRoute plugin: GET /api/health calls HealthService.check(), returns HTTP 503 when status is 'down', 200 for healthy/degraded
- Created alertsRoute plugin: GET /api/alerts parses page/limit query params with defaults (1/50), caps limit at 100, delegates to AlertStore.query()
- Created metricsRoute plugin: GET /api/metrics calls MetricsTracker.getAllStats(), returns { endpoints, windowMs: 300000 }
- Updated createDashboardServer signature to accept HealthService, AlertStore, MetricsTracker and registered all three routes under /api prefix
- 10 tests total: 4 health (200 healthy, 200 degraded, 503 down, response shape), 4 alerts (defaults, custom params, response shape, limit cap), 2 metrics (endpoints with data, empty endpoints)

## Task Commits

Each task was committed atomically (TDD: test + feat commits):

1. **Task 1: Create health, alerts, and metrics route plugins (TDD)**
   - `1b62274` (test) -- failing tests for health, alerts, and metrics routes
   - `35930e5` (feat) -- implement health, alerts, and metrics route plugins
2. **Task 2: Register new routes in dashboard-server.ts**
   - `eb6d398` (feat) -- register routes in dashboard-server with updated function signature

## Files Created/Modified
- `src/dashboard/routes/health.ts` - Fastify plugin: GET /health with HealthService injection, 503/200 status logic
- `src/dashboard/routes/health.test.ts` - 4 tests: healthy=200, degraded=200, down=503, response shape contract
- `src/dashboard/routes/alerts.ts` - Fastify plugin: GET /alerts with AlertStore injection, page/limit parsing, limit cap
- `src/dashboard/routes/alerts.test.ts` - 4 tests: default params, custom params, response shape, limit cap at 100
- `src/dashboard/routes/metrics.ts` - Fastify plugin: GET /metrics with MetricsTracker injection, windowMs constant
- `src/dashboard/routes/metrics.test.ts` - 2 tests: endpoints with stats data, empty endpoints
- `src/dashboard/dashboard-server.ts` - Added imports, updated createDashboardServer params, registered 3 new routes

## Decisions Made
- Health route returns HTTP 503 only for `status === 'down'`, 200 for both healthy and degraded -- degraded means operational but impaired
- Alerts limit capped at 100 (`Math.min(100, ...)`) to prevent abuse; default is 50 for dashboard pagination
- Metrics route returns hardcoded `windowMs: 300_000` matching MetricsTracker's default -- single source of truth in tracker constructor
- Routes registered after configRoute in dashboard-server.ts to maintain logical ordering

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required
None -- routes are automatically available when dashboard server starts. No new env vars or configuration needed.

## Known Stubs
None -- all routes are fully wired to real service implementations from Plans 01 and 02.

## Next Phase Readiness
- All three API endpoints are ready for dashboard UI consumption in Phase 21
- createDashboardServer signature change requires Plan 04 to update index.ts call site (expected -- noted in plan)
- Health endpoint is probe-ready for external monitoring tools (GET /api/health returns 200/503)

## Self-Check: PASSED

All 7 key files found:
- src/dashboard/routes/health.ts: FOUND
- src/dashboard/routes/health.test.ts: FOUND
- src/dashboard/routes/alerts.ts: FOUND
- src/dashboard/routes/alerts.test.ts: FOUND
- src/dashboard/routes/metrics.ts: FOUND
- src/dashboard/routes/metrics.test.ts: FOUND
- src/dashboard/dashboard-server.ts: FOUND

All 3 task commits verified in git history:
- 1b62274: test(20-03) route tests
- 35930e5: feat(20-03) route implementations
- eb6d398: feat(20-03) dashboard-server registration

---
*Phase: 20-reliability-monitoring*
*Completed: 2026-03-31*
