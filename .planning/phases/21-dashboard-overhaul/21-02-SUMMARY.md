---
phase: 21-dashboard-overhaul
plan: 02
subsystem: dashboard-frontend
tags: [sidebar, navigation, controls-store, page-stubs, e-stop]
dependency_graph:
  requires: []
  provides: [sidebar-6-nav, controls-store, pipeline-stub, controls-stub, status-stub, app-router-6-views]
  affects: [dashboard/src/components/Sidebar.tsx, dashboard/src/app.tsx]
tech_stack:
  added: []
  patterns: [preact-signals-store, page-stub-layout, 3-state-connection-bar, health-dot-polling]
key_files:
  created:
    - dashboard/src/store/controls.ts
    - dashboard/src/components/Pipeline.tsx
    - dashboard/src/components/Controls.tsx
    - dashboard/src/components/SystemStatus.tsx
  modified:
    - dashboard/src/components/Sidebar.tsx
    - dashboard/src/app.tsx
decisions:
  - "ESTOP_BTN placed between stats panel and connection bar (after spacer) per D-03: always visible at bottom of sidebar above connection status"
  - "Health dot rendered after NAV_LABEL and before NAV_INDICATOR for visual ordering"
  - "fetchPausedState called in same 5s polling interval as stats/health to avoid additional timers"
  - "PAGE_SUB uses 10px/0.1em per UI-SPEC typography contract (not Settings.tsx 11px/0.05em legacy)"
metrics:
  duration_seconds: 354
  completed: "2026-04-01T17:16:37Z"
  tasks: 2
  files_created: 4
  files_modified: 2
---

# Phase 21 Plan 02: Sidebar + Navigation Foundation Summary

Extended sidebar to 6 nav items (FEED, PERF, PIPE, CTRL, STAT, CONF) with health dot, emergency stop button, 3-state connection bar, and wired App router for all views including Pipeline, Controls, SystemStatus stubs.

## What Was Done

### Task 1: Controls store and page stub components (3eff937)

Created 4 new files:

- **dashboard/src/store/controls.ts** -- Preact signals store with `pausedSignal`, `estopDialogOpen`, and API functions (`fetchPausedState`, `setDetectionPaused`, `forceSell`, `triggerEmergencyStop`). Follows feed.ts/config.ts signal pattern.
- **dashboard/src/components/Pipeline.tsx** -- Stub page with "SAFETY PIPELINE" heading, "Live safety evaluation stream" subtitle, and centered empty state with "Waiting for evaluations" copy per UI-SPEC copywriting contract.
- **dashboard/src/components/Controls.tsx** -- Stub page with "CONTROLS" heading, "Detection and position management" subtitle.
- **dashboard/src/components/SystemStatus.tsx** -- Stub page with "SYSTEM STATUS" heading, "Infrastructure health and monitoring" subtitle.

All stubs use `Record<string, string>` style objects matching Settings.tsx page layout pattern.

### Task 2: Sidebar overhaul + App router extension (7f1cd32)

**Sidebar.tsx changes:**
- Extended `View` type to 6 values: `'feed' | 'performance' | 'pipeline' | 'controls' | 'status' | 'settings'`
- Extended `NAV_ITEMS` to 6 entries with correct abbreviations
- Added health dot (6px circle) next to STAT nav item, colored by `/api/health` aggregate status (green/yellow/red)
- Added EMERGENCY STOP button with `var(--red)` background, 44px min touch target, red glow hover effect
- Enhanced connection bar with 3 states: CONNECTED (green), PAUSED (yellow), NO SIGNAL (red)
- Imported `pausedSignal`, `estopDialogOpen`, `fetchPausedState` from controls store
- Added health polling and paused state polling in existing 5s interval

**App.tsx changes:**
- Added imports for Pipeline, Controls, SystemStatus components
- Added 3 new route conditionals in main rendering block

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Typography] PAGE_SUB font size aligned to UI-SPEC contract**
- **Found during:** Task 1
- **Issue:** Settings.tsx uses `fontSize: '11px'` and `letterSpacing: '0.05em'` for PAGE_SUB, but UI-SPEC typography contract specifies Badge/Label role at 10px with 0.1em letter spacing for subtitles/descriptions
- **Fix:** Used 10px / 0.1em for new page stubs per UI-SPEC contract. Existing Settings.tsx left unchanged (pre-existing, out of scope).
- **Files modified:** Pipeline.tsx, Controls.tsx, SystemStatus.tsx

## Known Stubs

| File | Line | Stub | Reason |
|------|------|------|--------|
| dashboard/src/components/Pipeline.tsx | 8-10 | Empty state placeholder | Intentional stub; Plan 03 will implement full pipeline streaming view |
| dashboard/src/components/Controls.tsx | 8 | Empty state placeholder | Intentional stub; Plan 04 will implement detection controls and positions table |
| dashboard/src/components/SystemStatus.tsx | 8 | Empty state placeholder | Intentional stub; Plan 05 will implement health cards, RPC metrics, alert history |

These stubs are intentional navigation scaffolding. Plans 03-05 depend on these stubs existing and will replace the empty states with full implementations.

## Verification Results

- TypeScript compilation: PASS (only pre-existing PnlChart.tsx errors, no errors in new/modified files)
- View type has 6 values: PASS
- EMERGENCY STOP button present: PASS
- All 3 new components imported and rendered in App router: PASS
- Health dot rendering with healthStatus conditional: PASS
- 3-state connection bar (CONNECTED/PAUSED/NO SIGNAL): PASS
- Controls store exports all required symbols: PASS

## Self-Check: PASSED

All 7 files found on disk. Both commit hashes (3eff937, 7f1cd32) verified in git log.
