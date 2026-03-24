---
phase: 12-dry-run-functionality
plan: "02"
subsystem: ui
tags: [dashboard, preact, sse, signals, dry-run]

# Dependency graph
requires:
  - phase: 12-dry-run-functionality plan 01
    provides: dryRun config flag, dry_run SQLite column, getRuntimeConfig().dryRun, backend interceptor gates

provides:
  - BotEvent.isDryRun field (SSE server-to-client propagation)
  - ConfigPatchSchema accepts dryRun boolean toggle from Settings
  - Stats SQL excludes dry_run=1 trades from header P&L / win rate
  - LiveFeed DRY RUN yellow badge with 0.7 opacity on dry-run events
  - Header DRY RUN MODE banner (yellow background) via configSignal reactive read
  - Settings "Mode" section with dryRun toggle checkbox

affects: [dashboard, bot-event-bus, execution-engine, sell-ladder]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "configSignal.value read in render causes Preact signals auto-subscription — reactive banner without explicit effect"
    - "isDryRun optional field on both BotEvent (server) and FeedEvent (client) — SSE JSON serialization passes through automatically"

key-files:
  created: []
  modified:
    - src/dashboard/bot-event-bus.ts
    - src/dashboard/routes/config.ts
    - src/dashboard/routes/trades.ts
    - src/execution/execution-engine.ts
    - src/execution/sell/sell-ladder.ts
    - src/index.ts
    - dashboard/src/store/feed.ts
    - dashboard/src/components/LiveFeed.tsx
    - dashboard/src/components/Header.tsx
    - dashboard/src/components/Settings.tsx

key-decisions:
  - "isDryRun threaded via BotEvent -> SSE JSON -> FeedEvent — both interfaces must declare the field for TypeScript, but serialization is automatic"
  - "Stats SQL exclusion uses AND (dry_run IS NULL OR dry_run = 0) — handles legacy rows before Phase 12 without NOT NULL constraint"
  - "Header banner reads configSignal.value.dryRun directly in render — Preact signals auto-subscription means no explicit effect or state needed"
  - "DRY RUN badge uses var(--yellow) with 1px border and 0.7 opacity on the row — visually distinct but non-intrusive in feed"

patterns-established:
  - "Preact signal reactive reads: access signal.value in render function body (not effect) to get automatic component re-render on change"

requirements-completed: [DRY-06, DRY-07, DRY-08]

# Metrics
duration: 20min
completed: 2026-03-03
---

# Phase 12 Plan 02: Dry-Run Dashboard Visibility Summary

**Dashboard DRY RUN badge on feed rows, header banner via Preact signals, stats SQL exclusion, and Settings toggle — complete end-to-end dry-run visibility.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-03T17:02:00Z
- **Completed:** 2026-03-03T17:22:00Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint approved)
- **Files modified:** 10

## Accomplishments

- `isDryRun?: boolean` added to both `BotEvent` (server) and `FeedEvent` (client), with SSE JSON propagating it automatically
- Header stats SQL updated to exclude `dry_run=1` trades so P&L / win rate / trade count reflect real trades only
- Preact `Header` reads `configSignal.value.dryRun` directly in render, auto-subscribing to the signal for a reactive yellow banner
- LiveFeed `FeedRow` renders a "DRY RUN" badge with yellow border and 0.7 opacity on dry-run events
- Settings adds a "Mode" section with a `dryRun` checkbox wired to POST `/api/config`, and `ConfigPatchSchema` now accepts the `dryRun` boolean field
- End-to-end verified by user: banner appears/disappears on toggle, feed badges visible, no real SOL spent

## Task Commits

Each task was committed atomically:

1. **Task 1: Server-side dashboard changes (BotEvent, config route, stats query, emit wiring)** — `edd79d9` (feat)
2. **Task 2: Frontend dashboard changes (FeedEvent, LiveFeed badge, Header banner, Settings toggle)** — `adad0c9` (feat)
3. **Task 3: End-to-end dry-run verification** — Human-verify checkpoint, approved by user (no code commit)

## Files Created/Modified

- `src/dashboard/bot-event-bus.ts` — Added `isDryRun?: boolean` to `BotEvent` interface
- `src/dashboard/routes/config.ts` — Added `dryRun: z.boolean().optional()` to `ConfigPatchSchema`
- `src/dashboard/routes/trades.ts` — Stats query now excludes `dry_run=1` rows
- `src/execution/execution-engine.ts` — BotEvent emissions include `isDryRun: getRuntimeConfig().dryRun`
- `src/execution/sell/sell-ladder.ts` — BotEvent emissions include `isDryRun`
- `src/index.ts` — BotEvent emissions include `isDryRun`
- `dashboard/src/store/feed.ts` — Added `isDryRun?: boolean` to `FeedEvent` interface
- `dashboard/src/components/LiveFeed.tsx` — `FeedRow` renders DRY RUN badge with yellow styling and 0.7 opacity
- `dashboard/src/components/Header.tsx` — Imports `configSignal`, renders yellow DRY RUN MODE banner reactively
- `dashboard/src/components/Settings.tsx` — "Mode" section with `dryRun` checkbox, wired to save patch

## Decisions Made

- Both `BotEvent` (server) and `FeedEvent` (client) must declare `isDryRun` — SSE serialization passes it automatically but TypeScript requires both interfaces to know about it.
- Stats exclusion uses `AND (dry_run IS NULL OR dry_run = 0)` rather than `dry_run = 0` alone — handles legacy trades inserted before Phase 12 without requiring a schema migration.
- Preact signal reads in render body (not `useEffect`) auto-subscribe the component — banner reacts to Settings save without extra wiring.

## Deviations from Plan

None — plan executed exactly as written. The execution engine and sell-ladder emit wiring was adjusted to match the actual call sites found in the files, which is consistent with the plan's intent.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 12 dry-run functionality is fully complete (Plans 01 and 02 done)
- Dry-run mode: backend gates (broadcaster, jito-seller), trade persistence with `dry_run` flag, recovery skip, position manager log-only, dashboard badges, header banner, stats exclusion, and Settings toggle all wired end-to-end
- No blockers for future phases

## Self-Check

- [x] Task 1 commit `edd79d9` exists — verified via `git log`
- [x] Task 2 commit `adad0c9` exists — verified via `git log`
- [x] Task 3 was a human-verify checkpoint — no code commit expected
- [x] All 10 key files listed above were modified in those commits
- [x] SUMMARY.md written to correct path

## Self-Check: PASSED

---
*Phase: 12-dry-run-functionality*
*Completed: 2026-03-03*
