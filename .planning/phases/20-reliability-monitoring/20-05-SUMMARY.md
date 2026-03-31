---
phase: 20-reliability-monitoring
plan: 05
subsystem: monitoring
tags: [health, api-error-rate, gap-closure, metrics-tracker]
dependency_graph:
  requires: [20-04]
  provides: [apis-health-provider, api-error-rate-thresholds]
  affects: [health-endpoint, monitoring-config]
tech_stack:
  added: []
  patterns: [closure-based-health-provider, sliding-window-error-rate]
key_files:
  created: []
  modified:
    - src/config/trading.ts
    - src/index.ts
    - src/monitoring/health-service.ts
    - src/monitoring/health-service.test.ts
    - src/dashboard/routes/health.test.ts
decisions:
  - "apisProviderLogic tested as pure function in test file mirroring index.ts closure -- avoids needing to import full index.ts dependency graph"
  - "count=0 endpoints ignored -- no data yet is not a failure signal"
  - "apis component mapped to 'api' alert source in ALERT_SOURCE_MAP -- consistent with safety/execution grouping"
metrics:
  duration: 6 min
  completed: 2026-03-31
---

# Phase 20 Plan 05: API Error Rate Health Provider Summary

APIs health provider that queries MetricsTracker.getAllStats() for per-endpoint error rates, returns degraded at 50% and down at 90%, with configurable thresholds in MonitoringConfigSchema.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add API error rate thresholds to config and register apis health provider (TDD) | 879f1df | src/config/trading.ts, src/index.ts, src/monitoring/health-service.ts, src/monitoring/health-service.test.ts, src/dashboard/routes/health.test.ts |
| 2 | Integration verification -- tsc and full test suite | (verification only) | N/A |

## What Was Built

1. **Config schema** (`src/config/trading.ts`): Added `apiErrorRateDegraded` (default 0.5) and `apiErrorRateDown` (default 0.9) to `MonitoringConfigSchema`. Updated TradingConfigSchema default to include both fields. Backward-compatible -- existing config.jsonc files without these fields parse correctly via Zod defaults.

2. **APIs health provider** (`src/index.ts`): Registered 5th health provider `'apis'` after execution provider. Closure captures `metricsTracker` and threshold config values. Iterates `getAllStats()`, classifies endpoints by error rate vs thresholds, returns worst-of status with failing endpoint names in detail string. Endpoints with `count=0` are ignored (no data is not a failure).

3. **Alert source mapping** (`src/monitoring/health-service.ts`): Added `apis: 'api'` to `ALERT_SOURCE_MAP` so transitions on the apis component route to the 'api' alert source.

4. **Tests** (`src/monitoring/health-service.test.ts`): 7 new tests covering: empty stats (healthy), below-threshold (healthy), degraded threshold boundary, down threshold boundary, detail includes endpoint names, multiple failing endpoints all listed, count=0 ignored.

5. **Health route tests** (`src/dashboard/routes/health.test.ts`): Updated mock from 4 to 5 components (added `apis`), assertion from 4 to 5.

## Verification Results

- TypeScript: compiles with zero errors
- Health-service tests: 13/13 pass (6 existing + 7 new)
- Health route tests: 4/4 pass
- Full test suite: 454/454 tests pass across 39 files, zero regressions

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- All 5 modified files exist on disk
- Commit 879f1df found in git log
- apiErrorRateDegraded present in trading.ts (2 occurrences)
- healthService.register('apis'...) present in index.ts
- metricsTracker.getAllStats() called in apis provider
