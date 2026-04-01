---
phase: 21-dashboard-overhaul
plan: 03
subsystem: ui
tags: [preact, lightweight-charts, dashboard, analytics, source-filter]

# Dependency graph
requires:
  - phase: 21-02
    provides: "Refactored Performance page with HistoryTrade interface and buildChartData helper"
provides:
  - "Per-source stat cards showing P&L and W/L per detection source"
  - "Source toggle buttons (ALL/PUMP/RAY/PSWAP) filtering equity curve chart"
  - "Source dropdown filter in trade history table"
  - "Stable PnlChart that updates data without recreating chart instance"
affects: [21-dashboard-overhaul]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Stable chart pattern: create once, update via setData/applyOptions", "Client-side source grouping with useMemo"]

key-files:
  created: []
  modified:
    - dashboard/src/components/Performance.tsx
    - dashboard/src/components/PnlChart.tsx

key-decisions:
  - "Client-side source grouping via useMemo over history array (D-06: zero new backend endpoints)"
  - "PnlChart uses useRef for chart/series stability instead of destroy+recreate on data change"
  - "Fixed pre-existing TS errors in PnlChart: removed invalid textColor from timeScale, cast time to UTCTimestamp"

patterns-established:
  - "Stable chart pattern: create chart in useEffect([]), update data in useEffect([data]) via setData()"
  - "Source filter state: null means ALL, string means specific source"

requirements-completed: [DASH-07]

# Metrics
duration: 9min
completed: 2026-04-01
---

# Phase 21 Plan 03: Per-Source Analytics Summary

**Per-source stat cards, equity curve source filter, and table source dropdown -- all computed client-side from existing /api/trades/history data with flicker-free chart updates**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-01T17:49:43Z
- **Completed:** 2026-04-01T17:58:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Per-source stat cards (pumpportal, raydium, pumpswap) showing P&L and W/L counts below aggregate stats
- Source toggle buttons (ALL, PUMP, RAY, PSWAP) that filter equity curve chart data with amber active styling
- Source dropdown filter in trade history table alongside existing mint text filter
- Refactored PnlChart to create chart instance once and update data via setData() -- eliminates flickering on rapid source filter toggles

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-source stat cards and source filter state in Performance.tsx** - `831f2a0` (feat)
2. **Task 2: PnlChart stability with source filter changes** - `cd89e34` (refactor)

## Files Created/Modified
- `dashboard/src/components/Performance.tsx` - Added sourceFilter/sourceTableFilter state, sourceStats useMemo, per-source stat cards, source toggle buttons, chart data filtering, source table dropdown
- `dashboard/src/components/PnlChart.tsx` - Refactored to stable chart pattern with chartRef/seriesRef, separate creation and data update useEffects, fixed pre-existing TS type errors

## Decisions Made
- Client-side source grouping via useMemo over history array -- follows D-06 zero new backend endpoints constraint
- PnlChart refactored to use useRef for chart/series instance stability -- prevents flickering on rapid filter toggles (Pitfall 5 mitigation)
- Fixed pre-existing TypeScript errors in PnlChart: removed invalid `textColor` property from `timeScale` options, cast `time` to `UTCTimestamp` nominal type for `setData` compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TypeScript errors in PnlChart.tsx**
- **Found during:** Task 2 (PnlChart refactor)
- **Issue:** `textColor` is not a valid property on `TimeScaleOptions` in lightweight-charts v5; `number` not assignable to `Time` (branded `UTCTimestamp` type)
- **Fix:** Removed `textColor` from timeScale config; cast data `time` field to `UTCTimestamp` in setData call
- **Files modified:** dashboard/src/components/PnlChart.tsx
- **Verification:** `npx tsc --noEmit --project dashboard/tsconfig.json` passes cleanly
- **Committed in:** cd89e34 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Bug fix was necessary for clean TypeScript compilation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Performance page now has complete per-source analytics (DASH-07)
- PnlChart is stable for rapid filter changes, ready for any future data filtering features
- Source filter pattern can be reused if needed in other views

## Self-Check: PASSED

- All created/modified files verified on disk
- All commit hashes (831f2a0, cd89e34) verified in git log

---
*Phase: 21-dashboard-overhaul*
*Completed: 2026-04-01*
