---
phase: quick-2
plan: "01"
subsystem: index
tags: [performance, position-management, safety-pipeline]
dependency_graph:
  requires: []
  provides: [early-capacity-rejection]
  affects: [src/index.ts]
tech_stack:
  added: []
  patterns: [early-exit guard, synchronous check before async pipeline]
key_files:
  created: []
  modified:
    - src/index.ts
decisions:
  - maxConcurrentPositions check moved before safetyPipeline.evaluate() — eliminates ~25 wasted RPC/API calls per token when bot is already at capacity
metrics:
  duration: 2 min
  completed: 2026-03-03
---

# Quick Task 2: Move maxConcurrentPositions Check Before Safety Pipeline Summary

**One-liner:** Synchronous capacity guard moved before safetyPipeline.evaluate() to eliminate ~25 wasted RPC/API calls per detected token when already at max positions.

## What Was Done

Reordered the `detectionManager.on('token', ...)` handler in `src/index.ts` so the `maxConcurrentPositions` check executes before `safetyPipeline.evaluate(event)`.

**Before:**
1. `safetyPipeline.evaluate(event)` — ~25 RPC/API calls
2. Inside `if (result.pass)`: capacity check, dedup guard, createBuyingRecord, buy execution

**After:**
1. Capacity check — synchronous, zero cost — returns early if at limit
2. `safetyPipeline.evaluate(event)` — only runs when capacity is available
3. Inside `if (result.pass)`: dedup guard, createBuyingRecord, buy execution

The log message was updated from `'Max concurrent positions reached — buy rejected'` to `'Max concurrent positions reached — skipping safety checks'` to accurately reflect the new semantics (the entire pipeline is skipped, not just the buy).

## Files Modified

- `src/index.ts` — reordered token handler pipeline (lines 164-193)

## Verification

- All 262 tests pass (`npx vitest run`)
- TypeScript compiles without errors (`tsc --noEmit`)
- Confirmed `maxConcurrentPositions` check appears before `safetyPipeline.evaluate()` call

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| fe068fb | feat(quick-2): move maxConcurrentPositions check before safety pipeline |

## Self-Check: PASSED

- `src/index.ts` modified: FOUND
- Commit fe068fb: FOUND
- maxConcurrentPositions check before safetyPipeline.evaluate(): CONFIRMED (lines 166-172 vs line 174)
