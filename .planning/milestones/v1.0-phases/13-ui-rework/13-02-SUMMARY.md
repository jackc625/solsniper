---
phase: 13-ui-rework
plan: 02
subsystem: ui
tags: [preact, vite, css-variables, sidebar, dashboard, design-system]

# Dependency graph
requires:
  - phase: 13-ui-rework-01
    provides: BotEvent types and trade history API that feed Sidebar stats

provides:
  - Industrial/utilitarian design system (Share Tech Mono + Rajdhani fonts, amber accent)
  - Fixed sidebar navigation replacing horizontal tab nav
  - Sidebar stats panel (P&L, win rate, open positions) with connection indicator
  - DRY RUN indicators in both sidebar and content-area banner
  - Redesigned Settings with responsive card grid layout
  - CSS grid app shell (sidebar-w + 1fr)

affects: [13-03-feed-cards, 13-04-performance-charts]

# Tech tracking
tech-stack:
  added:
    - Share Tech Mono (Google Font) — tactical monospace with military character
    - Rajdhani (Google Font) — condensed display font for headings and labels
  patterns:
    - CSS custom property design system (--amber, --teal, --bg0-bg4, --font-display, --font-mono)
    - Sidebar with onNavigate callback pattern for view routing
    - Hover state tracking via onMouseEnter/Leave (inline styles — no CSS class access)
    - view-keyed <main key={view}> for fade-in animation on navigation
    - Preact signal auto-subscription for isDryRun in render (configSignal.value?.dryRun)

key-files:
  created:
    - dashboard/src/components/Sidebar.tsx
  modified:
    - dashboard/index.html
    - dashboard/src/app.tsx
    - dashboard/src/components/Settings.tsx
  deleted:
    - dashboard/src/components/Header.tsx

key-decisions:
  - "Aesthetic direction: industrial/utilitarian trading terminal (amber primary, Share Tech Mono + Rajdhani)"
  - "DRY RUN shown in both sidebar (compact badge) AND content-area full-width banner for maximum visibility"
  - "Header.tsx deleted -- all responsibilities (stats, DRY RUN) moved to Sidebar and App banner"
  - "Responsive breakpoint at 1024px collapses sidebar to 52px (icon-only) via CSS custom property override"
  - "Settings uses responsive CSS grid (auto-fill, minmax 340px) not fixed maxWidth: 600px"

patterns-established:
  - "Sidebar pattern: View type exported from Sidebar.tsx, imported by App and any future consumers"
  - "Nav item active indicator: amber right-edge 2px bar (not color alone)"
  - "Data readouts use Share Tech Mono; section headers use Rajdhani 700 with letter-spacing"

requirements-completed: [UI-01, UI-05]

# Metrics
duration: 9min
completed: 2026-03-03
---

# Phase 13 Plan 02: Sidebar Layout and Design System Summary

**Industrial trading terminal aesthetic with amber accent sidebar, Share Tech Mono/Rajdhani fonts, and CSS grid app shell replacing horizontal tab navigation**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-03T21:46:50Z
- **Completed:** 2026-03-03T21:55:37Z
- **Tasks:** 4
- **Files modified:** 5 (4 modified, 1 created, 1 deleted)

## Accomplishments

- Replaced horizontal tab nav with CSS grid shell (`gridTemplateColumns: var(--sidebar-w) 1fr`)
- Created Sidebar with nav items, stats panel (P&L / win rate / open positions), SSE connection indicator, and DRY RUN badge
- Established industrial aesthetic: amber (#f0a500) primary accent, Share Tech Mono + Rajdhani fonts, dark bg scale
- Redesigned Settings with responsive 2-column card grid and animated toggle for Dry Run
- Deleted Header.tsx and redistributed all functionality to Sidebar and App-level banner
- Dashboard builds cleanly at 24 modules, 0 errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Establish design system in index.html** - `27d97a1` (feat)
2. **Task 2: Create Sidebar component** - `4bf05d0` (feat)
3. **Task 3: Restructure App layout and redesign Settings** - `0d5bb55` (feat)
4. **Task 4: Polish and cleanup** - `099a4fc` (feat)

## Files Created/Modified

- `dashboard/index.html` - Extended CSS variables (--amber, --teal, --bg0-bg4, font families, spacing, shadows), Google Fonts, scrollbar/selection/focus styles, keyframes, responsive breakpoint
- `dashboard/src/components/Sidebar.tsx` - 280-line component: nav items with amber indicator bar, stats panel, connection pulse dot, DRY RUN badge
- `dashboard/src/app.tsx` - CSS grid layout, Sidebar import, view-keyed main for transition, DRY RUN content banner
- `dashboard/src/components/Settings.tsx` - Responsive card grid, Rajdhani section headers, amber inputs, animated toggle track
- `dashboard/src/components/Header.tsx` - DELETED (stats and DRY RUN moved to Sidebar and App)

## Decisions Made

- **Amber as primary accent**: Differentiates from green-dominant terminal look; reads as "decision/active" rather than "safe/positive" which fits trading context
- **Rajdhani for display text**: Condensed, military-adjacent without being cliché; pairs well with Share Tech Mono's data-dense readouts
- **DRY RUN dual display**: Sidebar shows compact badge, content area shows full-width banner — per Phase 12 decision that DRY RUN visibility must be prominent
- **52px responsive sidebar**: At 1024px the sidebar collapses to icon-only width via CSS custom property; abbr labels (FEED/PERF/CONF) remain visible; no JavaScript needed
- **Header.tsx deleted**: All three responsibilities (brand, stats, DRY RUN) fully absorbed; deleting dead file reduces confusion for Plans 03/04

## Deviations from Plan

None — plan executed exactly as written. The decision to show DRY RUN in both sidebar AND content area was explicitly specified in the plan.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Design system (CSS variables, fonts, spacing scale) is established for Plans 03 and 04 to consume
- Plans 03/04 should read the CSS comment at top of index.html `<style>` block for the aesthetic direction
- LiveFeed and Performance components still reference original `--green`, `--red`, `--blue`, `--gray`, `--border`, `--text`, `--mono`, `--bg`, `--bg2` — all preserved and valid
- Sidebar stats poll `/api/stats` independently; Plans 03/04 don't need to worry about that endpoint

---
*Phase: 13-ui-rework*
*Completed: 2026-03-03*
