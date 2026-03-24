---
phase: 12-dry-run-functionality
plan: "01"
subsystem: dry-run
tags: [dry-run, config, persistence, broadcaster, jito-seller, recovery, position-manager]
dependency_graph:
  requires: []
  provides: [dry-run-backend]
  affects: [broadcaster, jito-seller, recovery-manager, position-manager, trade-store]
tech_stack:
  added: []
  patterns:
    - getRuntimeConfig().dryRun gate check pattern in broadcaster and jito-seller
    - Boolean(null) for nullable INTEGER column backward-compat in mapRow
    - dry-run abandon early-continue in recovery loops (BUYING, SELLING, MONITORING)
    - dry-run log-only trigger path in evaluatePosition before fireSell
key_files:
  created:
    - src/execution/sell/jito-seller.test.ts
  modified:
    - src/types/index.ts
    - src/config/trading.ts
    - src/persistence/schema.ts
    - src/persistence/trade-store.ts
    - src/persistence/trade-store.test.ts
    - src/execution/broadcaster.ts
    - src/execution/broadcaster.test.ts
    - src/execution/sell/jito-seller.ts
    - src/recovery/recovery-manager.ts
    - src/recovery/recovery-manager.test.ts
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
    - src/index.ts
    - config.jsonc
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/buy/pump-portal-buyer.test.ts
    - src/detection/detection-manager.test.ts
    - src/execution/execution-engine.test.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/safety/safety-pipeline.test.ts
decisions:
  - Gate 1 uses getRuntimeConfig().dryRun (not tradingConfig.dryRun) — runtime toggle works via dashboard patchRuntimeConfig
  - Gate 2 placed before Jupiter quote call in jitoSell — avoids wasting Jupiter API rate budget in dry-run
  - dry_run column uses nullable INTEGER (no NOT NULL) — consistent with source and token_program_id migration pattern; Boolean(null)=false handles legacy rows
  - dry-run BUYING/SELLING/MONITORING trades all abandoned on recovery — no real tokens exist, shadow tracking is ephemeral
  - PositionManager transitions MONITORING->COMPLETED (not FAILED) on dry-run trigger — COMPLETED is correct terminal state for a successfully monitored dry-run trade
  - Tiered TP advances tier index only for real trades — dry-run path returns early before tierIndices.set()
metrics:
  duration: 12 min
  completed_date: "2026-03-03"
  tasks_completed: 2
  files_modified: 21
---

# Phase 12 Plan 01: Dry-Run Backend Interceptor Layer Summary

Dry-run backend implemented: `getRuntimeConfig().dryRun` gate in broadcaster and jito-seller, `dry_run INTEGER` schema migration, `createBuyingRecord()` dryRun param, recovery abandonment for all dry-run states, and PositionManager log-only trigger path.

## What Was Built

Full backend dry-run interceptor layer with two gate points, SQLite persistence, and state machine support:

**Gate 1 (broadcaster.ts):** When `getRuntimeConfig().dryRun` is true, `broadcastAndConfirm()` fetches the blockhash (real), returns a synthetic `BroadcastResult` with `signature=DRY_RUN_{timestamp}`, and never calls `tx.sign()` or `sendRawTransaction()`. `broadcastWithRetry` inherits this automatically since it calls `broadcastAndConfirm`.

**Gate 2 (jito-seller.ts):** When `getRuntimeConfig().dryRun` is true, `jitoSell()` returns `DRY_RUN_JITO_{timestamp}` immediately before the Jupiter quote call — zero API calls, zero Jito bundle submissions.

**Schema (schema.ts + trade-store.ts):** `dry_run INTEGER` migration appended. `createBuyingRecord()` now accepts `dryRun=false` 4th param. All SELECT statements include `dry_run`. `mapRow` maps via `Boolean(row['dry_run'])` for null-safe backward compatibility.

**Recovery (recovery-manager.ts):** Dry-run trades in BUYING, SELLING, and MONITORING states are all abandoned on restart with `errorMessage: 'RECOVERY: dry-run trade abandoned on restart'`. Monitoring count excludes dry-run trades.

**Position Manager (position-manager.ts):** For all three exit trigger paths (tiered TP, trailing stop, stop-loss), when `trade.dryRun` is true: logs the trigger, transitions `MONITORING->COMPLETED` with `DRY_RUN_TRIGGER: {type}` error message, returns without calling `fireSell`.

**index.ts:** `createBuyingRecord` now receives `getRuntimeConfig().dryRun` so the dry-run flag is stamped on the trade record at creation time.

## Test Coverage

- 53 trade-store tests (7 new: dryRun field across all trade queries)
- 16 broadcaster tests (2 new: Gate 1 intercept, normal path preserved)
- 3 jito-seller tests (new file: Gate 2 intercept, no Jupiter/Jito calls)
- 20 recovery-manager tests (4 new: dry-run abandonment for BUYING/SELLING/MONITORING)
- 22 position-manager tests (4 new: dry-run log-only trigger for all 3 trigger types)
- Fixed: 8 test files had TradingConfig fixtures missing `dryRun: boolean` field

**Total: 262 tests pass (up from 235), 0 failures**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added dryRun: false to TradingConfig fixtures in 8 test files**
- **Found during:** Task 2 TypeScript compilation check
- **Issue:** Adding `dryRun: boolean` (non-optional, has default via Zod but required in TS type) to `TradingConfigSchema` caused TS2741 errors in 8 test files that construct `TradingConfig` objects inline
- **Files modified:** detection-manager.test.ts, execution-engine.test.ts, pump-portal-seller.test.ts, sell-ladder.test.ts, safety-pipeline.test.ts, jupiter-buyer.test.ts, pump-portal-buyer.test.ts, position-manager.test.ts
- **Fix:** Added `dryRun: false` to each fixture after `minSafetyScore`
- **Commit:** bbb579f

## Self-Check: PASSED

- src/types/index.ts: FOUND
- src/execution/sell/jito-seller.test.ts: FOUND
- .planning/phases/12-dry-run-functionality/12-01-SUMMARY.md: FOUND
- Commit 5b9143e (Task 1): FOUND
- Commit bbb579f (Task 2): FOUND
- All 262 tests pass: CONFIRMED
- TypeScript compilation clean: CONFIRMED
