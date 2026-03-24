---
phase: 15-live-config-hotreload
plan: 03
subsystem: ui
tags: [preact, sse, eventsource, signals]

requires:
  - phase: 15-02
    provides: CONFIG_CHANGED feed card rendering and SSE subscription in feed store
provides:
  - App-level SSE lifecycle that persists across tab navigation
  - LiveFeed component decoupled from SSE connection management
affects: []

tech-stack:
  added: []
  patterns:
    - "SSE connections managed at App root, not per-component"

key-files:
  created: []
  modified:
    - dashboard/src/app.tsx
    - dashboard/src/components/LiveFeed.tsx

key-decisions:
  - "Removed key={view} from <main> — tab-switch fade animation lost but SSE stability more important"
  - "connectFeed() hoisted to App useEffect — single connection for entire dashboard session"

patterns-established:
  - "SSE lifecycle at App level: any new SSE connections should follow same pattern in app.tsx"

requirements-completed: [DASH-04, DASH-05]

duration: 5min
completed: 2026-03-22
---

# Phase 15 Plan 03: Fix SSE EventSource persistence across tab navigation

**Hoisted connectFeed() SSE lifecycle from LiveFeed to App root, removing key={view} forced unmount that killed EventSource on every tab switch**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22
- **Completed:** 2026-03-22
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- SSE EventSource connection now persists across all tab navigations (Feed, Performance, Settings)
- CONFIG_CHANGED events (and all other SSE events) are received regardless of active tab
- LiveFeed component simplified — only reads feedEvents signal, no longer manages SSE lifecycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Hoist SSE connection from LiveFeed to App and remove key={view}** - `c8d249e` (fix)
2. **Task 2: Verify CONFIG_CHANGED card appears after settings change** - Human verification checkpoint (approved)

## Files Created/Modified
- `dashboard/src/app.tsx` - Added useEffect with connectFeed() at App level, removed key={view} from main
- `dashboard/src/components/LiveFeed.tsx` - Removed connectFeed import and SSE useEffect block

## Decisions Made
- Removed key={view} from `<main>` which eliminates the fade-in animation on tab switch — acceptable trade-off for SSE stability
- Kept the fade-in CSS animation definition in MAIN style object (harmless, still applies on initial mount)

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 15 live config hot-reload is fully operational
- SSE connection is stable across all dashboard interactions
- Ready for phase verification

---
*Phase: 15-live-config-hotreload*
*Completed: 2026-03-22*
