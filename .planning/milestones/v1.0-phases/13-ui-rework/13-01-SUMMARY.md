---
phase: 13-ui-rework
plan: 01
subsystem: ui
tags: [sse, bot-events, dashboard, lightweight-charts, sqlite, feed]

# Dependency graph
requires:
  - phase: 08-web-dashboard
    provides: BotEvent/SSE infrastructure, TradeStore, dashboard routes
  - phase: 12-dry-run-functionality
    provides: isDryRun field on BotEvent and FeedEvent
provides:
  - Enriched BotEvent interface with safetyScore, source, buyAmountSol, pnlSol
  - Enriched FeedEvent interface mirroring BotEvent optional fields
  - GET /api/trades/history endpoint returning completed trades with pnl_sol
  - lightweight-charts 5.1.0 installed for P&L charting in Plan 04
affects: [13-02, 13-03, 13-04, 13-05]

# Tech tracking
tech-stack:
  added: [lightweight-charts@5.1.0]
  patterns:
    - Post-transition trade lookup for P&L: call getTradeByMint() immediately after tradeStore.transition() to COMPLETED/FAILED to compute pnlSol
    - Optional enrichment fields on BotEvent: all new fields optional, backward-compatible with existing emit sites
    - Raw DB cast for history queries: (tradeStore as any).db pattern extended to /trades/history endpoint

key-files:
  created: []
  modified:
    - src/dashboard/bot-event-bus.ts
    - src/index.ts
    - src/execution/execution-engine.ts
    - src/execution/sell/sell-ladder.ts
    - src/dashboard/routes/trades.ts
    - dashboard/src/store/feed.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "result.aggregateScore (not result.score) used for safetyScore on TOKEN_DETECTED — SafetyResult has aggregateScore field, not score"
  - "BUY_CONFIRMED uses this.config.buyAmountSol for buyAmountSol (not BuyResult.amountSol — BuyResult has amountTokens only)"
  - "pnlSol computed from getTradeByMint() after transition — sellPriceSol typically undefined today so pnlSol will be undefined; field exists for when sell price tracking is added"
  - "lightweight-charts installed as prod dependency (not devDep) — used in dashboard bundle at runtime"
  - "/trades/history uses snake_case column names directly — frontend will map; avoids camelCase transformation boilerplate"

patterns-established:
  - "Post-sell P&L lookup: call getTradeByMint() after tradeStore.transition(SELLING, COMPLETED) and compute pnlSol conditionally on both prices present"

requirements-completed: [UI-02, UI-06]

# Metrics
duration: 4min
completed: 2026-03-03
---

# Phase 13 Plan 01: Backend Data Surface Enrichment Summary

**Enriched SSE BotEvents with safetyScore/source/buyAmountSol/pnlSol, added /api/trades/history endpoint, installed lightweight-charts 5.1.0**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-03T21:38:36Z
- **Completed:** 2026-03-03T21:42:36Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- BotEvent interface extended with 4 optional fields (safetyScore, source, buyAmountSol, pnlSol) — all emit sites updated accordingly
- FeedEvent frontend type mirrors BotEvent optional enrichment fields — SSE JSON parse auto-populates them
- GET /api/trades/history returns up to 500 COMPLETED/FAILED/ABANDONED trades with computed pnl_sol column (excludes dry-run)
- lightweight-charts 5.1.0 installed, importable — prerequisite for Plan 04 P&L chart
- All 267 existing tests pass — no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Enrich BotEvent interface and emit sites** - `36509a3` (feat)
2. **Task 2: Add /trades/history endpoint, FeedEvent enrichment, lightweight-charts** - `13df354` (feat)

**Plan metadata:** (committed below with SUMMARY.md and STATE.md)

## Files Created/Modified
- `src/dashboard/bot-event-bus.ts` - Added safetyScore, source, buyAmountSol, pnlSol optional fields to BotEvent
- `src/index.ts` - TOKEN_DETECTED emit now includes safetyScore (aggregateScore), source, buyAmountSol
- `src/execution/execution-engine.ts` - BUY_SENT and BUY_CONFIRMED emits include source and buyAmountSol
- `src/execution/sell/sell-ladder.ts` - SELL_CONFIRMED and SELL_FAILED compute pnlSol from post-transition trade lookup
- `src/dashboard/routes/trades.ts` - New GET /api/trades/history endpoint with pnl_sol computed column
- `dashboard/src/store/feed.ts` - FeedEvent interface extended with safetyScore, source, buyAmountSol, pnlSol
- `package.json` - lightweight-charts 5.1.0 added to dependencies
- `pnpm-lock.yaml` - lockfile updated

## Decisions Made
- `result.aggregateScore` used for `safetyScore` — SafetyResult has `aggregateScore`, not `score`
- `BUY_CONFIRMED.buyAmountSol` uses `this.config.buyAmountSol` — BuyResult has no amountSol field
- `pnlSol` computed from post-transition `getTradeByMint()` lookup, conditional on both prices being non-null
- `/trades/history` returns snake_case column names to keep route simple; frontend handles mapping

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used result.aggregateScore instead of result.score**
- **Found during:** Task 1 (TOKEN_DETECTED emit update)
- **Issue:** Plan referenced `result.score` but SafetyResult.aggregateScore is the correct field name
- **Fix:** Used `result.aggregateScore` in TOKEN_DETECTED emit
- **Files modified:** src/index.ts
- **Verification:** TypeScript typecheck passes with no errors
- **Committed in:** 36509a3

**2. [Rule 1 - Bug] Used this.config.buyAmountSol for BUY_CONFIRMED instead of result.amountSol**
- **Found during:** Task 1 (BUY_CONFIRMED emit update)
- **Issue:** Plan referenced `result.amountSol` but BuyResult has no amountSol field (only amountTokens)
- **Fix:** Used `this.config.buyAmountSol` — the actual amount spent equals the configured buy amount
- **Files modified:** src/execution/execution-engine.ts
- **Verification:** TypeScript typecheck passes with no errors
- **Committed in:** 36509a3

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug: wrong field references in plan spec)
**Impact on plan:** Both fixes necessary for TypeScript correctness. No scope creep.

## Issues Encountered
None - plan executed cleanly after correcting the two field name mismatches.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Enriched SSE events ready for Plans 02 (FeedCard rework) and 03 (Analytics header)
- /api/trades/history ready for Plan 04 (Performance chart view)
- lightweight-charts installed and available for Plan 04 bundle
- All backend data surface prerequisites for Phase 13 UI rework complete

---
*Phase: 13-ui-rework*
*Completed: 2026-03-03*
