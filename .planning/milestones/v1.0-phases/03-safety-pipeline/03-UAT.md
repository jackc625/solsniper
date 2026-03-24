---
status: complete
phase: 03-safety-pipeline
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md
started: 2026-02-26T00:00:00Z
updated: 2026-02-26T00:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Full test suite passes
expected: Run `pnpm test` (or `rtk vitest run`). All 77 tests should pass with 0 failures across all safety check files: blocklist, tier1-authority, tier1-sell-route, tier2-rugcheck, tier2-holder, tier3-creator, safety-pipeline.
result: pass

### 2. TypeScript compiles cleanly
expected: Run `pnpm exec tsc --noEmit`. Should exit with 0 errors — no type errors in any safety pipeline files.
result: pass

### 3. Safety config present in config.json
expected: Open `config.json`. A `safety` block should exist with: `weights` (rugCheck:40, holder:30, creator:30), `minSafetyScore: 60`, `tier2TimeoutMs`, `tier3TimeoutMs`, and `cacheTtlMs`.
result: pass

### 4. Blocklist persists across restarts
expected: The `Blocklist` class writes to disk on `add()`. Check `src/safety/blocklist.ts` — `load()` should read from a JSON file path, and `add()` should write it with `fs.writeFileSync`. No state lost if process restarts.
result: pass

### 5. SafetyPipeline wired into index.ts
expected: Open `src/index.ts`. Should show: import of `SafetyPipeline`, initialization after `DetectionManager`, and a `token` event handler that calls `safetyPipeline.evaluate()` and logs either approval or rejection.
result: pass

### 6. Tier 1 hard-block short-circuits Tier 2/3
expected: In `src/safety/safety-pipeline.ts`, the `evaluate()` method should run `checkAuthorities` and `checkSellRoute` first via `Promise.all`. If either fails (`pass=false`), the method should return immediately with `aggregateScore=0` without calling RugCheck, holder, or creator checks.
result: pass

### 7. Aggregate score formula correct
expected: In `src/safety/safety-pipeline.ts`, the aggregate score calculation should be: `Math.round((rugScore/100)*40 + (holderScore/100)*30 + (creatorScore/100)*30)` — matching the configured weights (40/30/30).
result: pass

### 8. RugCheck score inversion
expected: In `src/safety/checks/tier2-rugcheck.ts`, the score should be inverted: `safetyScore = 100 - score_normalised`. A RugCheck risk score of 80 (high risk) becomes safety score 20. A risk score of 10 (low risk) becomes safety score 90.
result: pass

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

[none yet]
