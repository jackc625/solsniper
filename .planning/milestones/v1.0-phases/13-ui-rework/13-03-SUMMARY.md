---
phase: 13-ui-rework
plan: 03
subsystem: ui
tags: [dashboard, feed, preact, trading-terminal, components]

# Dependency graph
requires:
  - phase: 13-ui-rework
    plan: 01
    provides: Enriched FeedEvent interface with safetyScore, source, buyAmountSol, pnlSol
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - FeedCard expand/collapse uses local useState (not signals) — per-card state is not shared
    - Auto-scroll effect depends only on feedEvents.value to avoid triggering on card expansion
    - CSS max-height transition for smooth expand animation without JS animation libraries
    - Inline style tag for keyframe animations in functional component

key-files:
  created:
    - dashboard/src/components/FeedCard.tsx
  modified:
    - dashboard/src/components/LiveFeed.tsx

key-decisions:
  - "FeedRow removed; FeedCard is the sole rendering unit — no shared state needed between cards"
  - "BADGE_COLORS and EVENT_LABELS moved entirely to FeedCard.tsx — single source of truth"
  - "P&L em-dash uses Unicode escape U+2014 (not HTML entity) for JSX compatibility"
  - "Auto-scroll useEffect dependency array: [feedEvents.value, isLive] only — card expand/collapse does not trigger scroll (per plan pitfall requirement)"
  - "Keyframe animations injected via inline style tag in LiveFeed — avoids CSS module dependency while keeping animations scoped"

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 13 Plan 03: Live Feed Cards Summary

**Rich expandable FeedCard component replacing flat text rows — trading terminal feed with per-event badge, mint link, source, safety score, buy amount, P&L, and expand/collapse detail panel**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T21:46:43Z
- **Completed:** 2026-03-03T21:49:34Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 rewritten)

## Accomplishments

- `FeedCard.tsx` created (243 lines): rich collapsed header with event badge, mint Solscan link, source badge, pump.fun conditional link, safety score color-coded, buy amount, P&L value (or em-dash), timestamp, DRY RUN badge
- `LiveFeed.tsx` rewritten: FeedRow/shortenMint/BADGE_COLORS removed; renders FeedCards; auto-scroll preserved on feedEvents.value only; toolbar shows event count + pulsing LIVE dot + RESUME LIVE button; empty state with blinking terminal cursor
- All links open `target="_blank" rel="noopener noreferrer"`
- P&L displays signed value with color on SELL events; em-dash in gray for all other event types
- Dashboard build clean: 17 modules, 38 kB bundle

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FeedCard component** - `6d47ded` (feat)
2. **Task 2: Rework LiveFeed to render FeedCards** - `4d08a82` (feat)

## Files Created/Modified

- `dashboard/src/components/FeedCard.tsx` (created) — Rich expandable feed card component with all enriched data fields
- `dashboard/src/components/LiveFeed.tsx` (modified) — Reworked to import/render FeedCard; removed FeedRow, shortenMint, BADGE_COLORS

## Decisions Made

- `BADGE_COLORS` and `EVENT_LABELS` moved from LiveFeed.tsx to FeedCard.tsx — FeedCard owns all event-type visual mapping
- Auto-scroll `useEffect` depends on `[feedEvents.value, isLive]` only — ensuring card expansion does not trigger scroll (critical requirement from plan pitfall list)
- `useState(false)` used for expand state — local per-card, not shared signal
- P&L em-dash rendered as `'\u2014'` Unicode escape (not HTML entity `&mdash;`) for JSX text node compatibility

## Deviations from Plan

None — plan executed exactly as written. All must_have truths and artifact requirements satisfied.

## Self-Check: PASSED

- `dashboard/src/components/FeedCard.tsx`: FOUND
- `dashboard/src/components/LiveFeed.tsx`: FOUND (modified)
- Commit `6d47ded`: FOUND (feat(13-03): create FeedCard component)
- Commit `4d08a82`: FOUND (feat(13-03): rework LiveFeed to render FeedCards)
- `pnpm build:dashboard`: passes cleanly (17 modules, no errors)
- Solscan link pattern (`solscan.io/token`): FOUND in FeedCard.tsx lines 202, 310
- pump.fun link pattern (`pump.fun/coin`): FOUND in FeedCard.tsx lines 214, 320
- `feedEvents.value` in auto-scroll effect: FOUND in LiveFeed.tsx line 21
- DRY RUN badge: FOUND in FeedCard.tsx
- `target="_blank"`: 4 occurrences in FeedCard.tsx (all links)
- Em-dash for missing P&L: FOUND in FeedCard.tsx (U+2014)

---
*Phase: 13-ui-rework*
*Completed: 2026-03-03*
