---
phase: quick-3
plan: "01"
subsystem: safety
tags: [holder-concentration, config, tdd, pumpportal]
dependency_graph:
  requires: []
  provides: [minUserHolders threshold check in tier2-holder]
  affects: [safety-pipeline, tier2-holder, config-schema]
tech_stack:
  added: []
  patterns: [zod-schema-default, tdd-red-green]
key_files:
  created: []
  modified:
    - src/config/trading.ts
    - config.jsonc
    - src/safety/checks/tier2-holder.ts
    - src/safety/checks/tier2-holder.test.ts
    - src/safety/safety-pipeline.test.ts
    - src/execution/execution-engine.test.ts
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/buy/pump-portal-buyer.test.ts
    - src/execution/sell/jito-seller.test.ts
    - src/execution/sell/pump-portal-seller.test.ts
    - src/execution/sell/sell-ladder.test.ts
    - src/position/position-manager.test.ts
    - src/detection/detection-manager.test.ts
decisions:
  - "minUserHolders defaults to 2 — requires at least 2 real user holders for pumpportal tokens to pass"
  - "minUserHolders=0 preserves original bonding-curve pass-through (score=50, pass=true) for backwards compat"
  - "Threshold check inserted between zero-holder block and concentration math — non-pumpportal path unchanged"
metrics:
  duration: "6 minutes"
  completed_date: "2026-03-04"
  tasks_completed: 2
  files_changed: 13
---

# Quick Task 3: Add Configurable Minimum Holder Threshold Summary

**One-liner:** Configurable `minUserHolders` threshold in `HolderConfigSchema` rejects pumpportal tokens with fewer than N real user holders (default 2) while preserving zero-threshold pass-through behavior.

## What Was Built

Added a `minUserHolders` configuration field to the holder safety check that lets operators require a minimum number of real user holders before a pump.fun token passes safety screening. Previously, tokens entirely in the bonding curve with zero user holders received a neutral pass=true score=50. With the default of `minUserHolders: 2`, such tokens are now rejected.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add minUserHolders to config schema and config file | 3d06aa2 | trading.ts, config.jsonc, tier2-holder.ts |
| 2 (RED) | Write failing tests for minUserHolders behavior | 7a08779 | tier2-holder.test.ts |
| 2 (GREEN) | Implement minUserHolders threshold check | 1d50bae | tier2-holder.ts |
| 2 (fix) | Add minUserHolders to all test fixtures | 235224b | 10 test files |

## Key Changes

**`src/config/trading.ts`:** Added `minUserHolders: z.number().int().min(0).default(2)` to `HolderConfigSchema`.

**`src/safety/checks/tier2-holder.ts`:**
- Added `minUserHolders: number` to `HolderConfig` interface
- Replaced unconditional pumpportal zero-holder pass-through with threshold check:
  - `minUserHolders === 0` → preserves original pass=true score=50 behavior
  - `userHolders.length === 0` and `minUserHolders > 0` → pass=false with "below minimum holders: 0 < N required"
  - `userHolders.length < minUserHolders` → pass=false with "below minimum holders: M < N required"

**`config.jsonc`:** Added `"minUserHolders": 2` with inline documentation comment.

## Success Criteria Verification

- [x] minUserHolders field exists in HolderConfigSchema with default 2 and Zod validation (int, min 0)
- [x] config.jsonc includes minUserHolders: 2 under safety.holder with inline comment
- [x] Pumpportal tokens with < minUserHolders user holders return pass=false
- [x] Pumpportal tokens with >= minUserHolders user holders continue to normal concentration check
- [x] Setting minUserHolders=0 preserves original pass-through behavior
- [x] Non-pumpportal zero-holder behavior unchanged (pass=false)
- [x] All 270 tests pass, TypeScript compiles clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing field in required type] Added minUserHolders to HolderConfig fixtures in 9 test files**
- **Found during:** TypeScript type check after Task 2 implementation
- **Issue:** `HolderConfig` interface now requires `minUserHolders`, but 9 test files across the codebase had inline `{ top1SoftBlockThreshold, top10SoftBlockThreshold }` objects that became TS2741 errors
- **Fix:** Added `minUserHolders: 2` to all inline HolderConfig objects in detection-manager.test.ts, execution-engine.test.ts, jupiter-buyer.test.ts, pump-portal-buyer.test.ts, jito-seller.test.ts, pump-portal-seller.test.ts, sell-ladder.test.ts, position-manager.test.ts, and safety-pipeline.test.ts
- **Files modified:** 10 test files (including tier2-holder.test.ts inline usage)
- **Commit:** 235224b

## Self-Check: PASSED

Files verified:
- src/config/trading.ts: contains minUserHolders schema field
- src/safety/checks/tier2-holder.ts: contains minUserHolders threshold logic
- config.jsonc: contains minUserHolders: 2
- .planning/quick/3-add-configurable-minimum-holder-threshol/3-SUMMARY.md: this file

Commits verified:
- 3d06aa2: feat(quick-3): add minUserHolders to HolderConfigSchema
- 7a08779: test(quick-3): add failing tests for minUserHolders threshold
- 1d50bae: feat(quick-3): replace zero-holder pass-through with minUserHolders threshold
- 235224b: fix(quick-3): add minUserHolders to HolderConfig fixtures in all test files
