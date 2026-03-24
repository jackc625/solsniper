---
phase: quick-4
plan: 1
subsystem: position-management
tags: [config, position-manager, auto-sell, max-hold-time, tdd]
key-files:
  created: []
  modified:
    - src/config/trading.ts
    - config.jsonc
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
    - src/dashboard/routes/config.ts
    - src/detection/detection-manager.test.ts
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/buy/pump-portal-buyer.test.ts
    - src/execution/execution-engine.test.ts
    - src/execution/sell/jito-seller.test.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/safety/safety-pipeline.test.ts
decisions:
  - "maxHoldTimeMs placed after stop-loss (lowest priority) — TP > trailing stop > SL > max hold time ensures price-based exits always take precedence"
  - "maxHoldTimeMs=0 disables via > 0 guard — consistent with trailingStopPct=0 disabled pattern already in codebase"
  - "Full tokenAmountRaw sold on max hold time trigger — no partial sell; sideways tokens get full exit to free capital"
metrics:
  duration_seconds: 367
  completed_date: "2026-03-03"
  tasks_completed: 2
  files_modified: 13
---

# Quick Task 4: Add maxHoldTimeMs Config to Auto-Sell Position Summary

**One-liner:** maxHoldTimeMs config field (default 2 min, 0=disabled) added to PositionManagementConfigSchema with lowest-priority exit trigger in evaluatePosition() — full position sold when hold time exceeded, dry-run transitions to COMPLETED.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Add maxHoldTimeMs to config schema and config.jsonc | de69649 | Done |
| 2 | Implement max hold time exit trigger in evaluatePosition() with tests | 74c25e4 | Done |

## What Was Built

### Config Changes (Task 1)

- `src/config/trading.ts`: Added `maxHoldTimeMs: z.number().int().min(0).default(120000)` to `PositionManagementConfigSchema` after `trailingStopPct`
- `config.jsonc`: Added `"maxHoldTimeMs": 120000` with two-line inline comment explaining purpose and disabled value
- `src/dashboard/routes/config.ts`: Added `maxHoldTimeMs: z.number().int().min(0).optional()` to `ConfigPatchSchema.positionManagement` for runtime dashboard patching
- `src/position/position-manager.ts`: Added `maxHoldTimeMs` to the `start()` log info object

### Max Hold Time Exit Trigger (Task 2)

Added to `evaluatePosition()` in `src/position/position-manager.ts` after the stop-loss block:

```typescript
// --- Max hold time ---
const { maxHoldTimeMs } = this.config.positionManagement;
if (maxHoldTimeMs > 0) {
  const holdDurationMs = Date.now() - trade.createdAt;
  if (holdDurationMs >= maxHoldTimeMs) {
    // fires fireSell(mint, tokenAmountRaw) or dry-run transition
  }
}
```

Exit priority order: tiered TP > trailing stop > stop-loss > max hold time (lowest).

### Tests Added (5 new tests in `describe('max hold time')`)

1. Fires sell (full position) when held > maxHoldTimeMs
2. Does NOT fire when held < maxHoldTimeMs
3. Does NOT fire when maxHoldTimeMs=0 (disabled)
4. Dry-run transitions to COMPLETED with `DRY_RUN_TRIGGER: MAX_HOLD_TIME`
5. SL takes priority when both SL and max hold time would trigger

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed missing maxHoldTimeMs in 8 other test file fixtures**
- **Found during:** Task 2 TypeScript compile check
- **Issue:** 8 test files had `positionManagement` fixtures without `maxHoldTimeMs`, causing TS2741 type errors after the schema change
- **Fix:** Added `maxHoldTimeMs: 120000` to `positionManagement` object in fixtures in: detection-manager.test.ts, jupiter-buyer.test.ts, pump-portal-buyer.test.ts, execution-engine.test.ts, jito-seller.test.ts, pump-portal-seller.test.ts, sell-ladder.test.ts, safety-pipeline.test.ts
- **Files modified:** 8 test files (listed above)
- **Commit:** 74c25e4 (included in Task 2 commit)

## Verification Results

All tests pass (31 total in position-manager.test.ts, +7 new from this plan):
```
Test Files  1 passed (1)
Tests       31 passed (31)
```

TypeScript compiles without errors:
```
npx tsc --noEmit  (no output = clean)
```

## Self-Check: PASSED

- [x] `src/config/trading.ts` contains `maxHoldTimeMs`
- [x] `config.jsonc` contains `maxHoldTimeMs`
- [x] `src/position/position-manager.ts` contains `maxHoldTimeMs`
- [x] `src/position/position-manager.test.ts` contains `max hold time` describe block
- [x] Commits de69649 and 74c25e4 exist
