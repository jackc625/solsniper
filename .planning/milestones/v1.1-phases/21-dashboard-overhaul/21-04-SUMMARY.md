---
phase: 21-dashboard-overhaul
plan: 04
subsystem: dashboard-frontend
tags: [preact, pipeline, controls, force-sell, emergency-stop, sse]

# Dependency graph
requires:
  - phase: 21-01
    provides: "Controls API endpoints (pause/resume, force-sell, emergency-stop), SAFETY_EVALUATION event emission"
  - phase: 21-02
    provides: "Controls store (pausedSignal, estopDialogOpen, API functions), Pipeline/Controls stubs, sidebar e-stop button"
provides:
  - "Full Pipeline page with streaming SAFETY_EVALUATION cards, expandable per-check detail, and stats header"
  - "Full Controls page with pause/resume toggle, positions table with force-sell inline confirmation"
  - "EmergencyStopDialog in App.tsx with STOP confirmation input and EXECUTING state"
affects: [21-05]

# Tech tracking
tech-stack:
  added: []
  patterns: [pipeline-card-expand, inline-confirm-dismiss, estop-dialog-overlay]

key-files:
  created: []
  modified:
    - dashboard/src/components/Pipeline.tsx
    - dashboard/src/components/Controls.tsx
    - dashboard/src/app.tsx

key-decisions:
  - "shortenMint and SourceBadge defined locally in Pipeline.tsx and Controls.tsx since Performance.tsx does not export them"
  - "Pipeline uses LiveFeed auto-scroll pattern with LIVE/RESUME indicator for streaming card list"
  - "EmergencyStopDialog rendered inside CONTENT_COL in App.tsx (after main, before closing div) for proper z-index stacking"
  - "KEEP_BTN uses var(--border) for outline (confirmed --border-strong exists but --border matches established transparent button patterns)"
  - "ActionCell extracted as sub-component with own state to isolate confirmation flow per position row"

patterns-established:
  - "Inline confirmation pattern: FORCE SELL -> CONFIRM SELL / KEEP POSITION with 5s auto-dismiss timeout"
  - "Pipeline stats header: client-side rolling accumulator on filtered SSE events (no backend computation)"
  - "Confirmation dialog pattern: fixed overlay at zIndex 1000 with text-match confirmation gate"

requirements-completed: [DASH-08, DASH-09]

# Metrics
duration: 7min
completed: 2026-04-01
---

# Phase 21 Plan 04: Pipeline and Controls Pages Summary

**Full Pipeline page with streaming safety evaluation cards and stats header, plus Controls page with pause/resume, positions table with force-sell inline confirmation, and emergency stop dialog**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-01T17:49:49Z
- **Completed:** 2026-04-01T17:56:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Pipeline page streams SAFETY_EVALUATION events as expandable cards with PASS/FAIL badges, score/100, per-check detail tables, and rejection reasons
- Pipeline stats header computes pass rate %, avg score, and evals/min client-side from received SSE events with MAX_PIPELINE_EVENTS=200 cap
- Controls page provides detection pause/resume toggle, positions table with force-sell inline confirmation flow, and emergency stop section
- EmergencyStopDialog in App.tsx requires typing STOP to confirm, shows EXECUTING state, handles errors, dismissable via overlay click or DISMISS button

## Task Commits

Each task was committed atomically:

1. **Task 1: Pipeline page -- streaming safety evaluation cards with stats header** - `73f3b4d` (feat)
2. **Task 2: Controls page -- pause/resume, positions table, force-sell, emergency stop dialog** - `0326b41` (feat)

## Files Created/Modified
- `dashboard/src/components/Pipeline.tsx` - Full pipeline page: stats header (PASS RATE, AVG SCORE, EVALS/MIN), PipelineCard sub-component with expandable per-check detail table, auto-scroll with LIVE indicator, empty state
- `dashboard/src/components/Controls.tsx` - Full controls page: detection pause/resume toggle, open positions table with ActionCell force-sell flow (CONFIRM SELL / KEEP POSITION / SELLING... badge), emergency stop card
- `dashboard/src/app.tsx` - Added EmergencyStopDialog component with fixed overlay, STOP text confirmation, EXECUTE STOP / DISMISS buttons, and dialog style objects

## Decisions Made
- shortenMint and SourceBadge defined locally in Pipeline.tsx and Controls.tsx since Performance.tsx does not export them (avoids modifying Performance.tsx out of scope)
- Pipeline uses LiveFeed auto-scroll pattern (useRef + isLive state + scroll detection) for streaming card list consistency
- EmergencyStopDialog placed inside CONTENT_COL after main element -- renders above content with fixed positioning and zIndex 1000
- KEEP_BTN uses var(--border) for outline consistency with established transparent button patterns across the dashboard
- ActionCell extracted as sub-component with own confirming/error state to properly isolate per-row confirmation flows

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None -- all pages fully implemented with real data wiring.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline and Controls pages are fully functional
- Emergency stop dialog wired from both sidebar button and controls page
- Plan 05 (SystemStatus page) is the remaining page to implement

## Self-Check: PASSED

All created files verified present. Both task commits (73f3b4d, 0326b41) verified in git log.
