---
phase: 03-safety-pipeline
plan: 03
subsystem: safety
tags: [solana, safety-pipeline, orchestrator, tdd, promise-allsettled, aggregate-score, cache, soft-block]

requires:
  - phase: 03-safety-pipeline
    plan: 01
    provides: SafetyCache, Blocklist, checkAuthorities, checkSellRoute, CheckResult/SafetyResult types
  - phase: 03-safety-pipeline
    plan: 02
    provides: checkRugCheck, checkHolderConcentration, checkCreatorHistory

provides:
  - SafetyPipeline class in src/safety/safety-pipeline.ts
  - DetectionManager token events wired through SafetyPipeline in src/index.ts
affects: [03-04, 05-execution]

tech-stack:
  added: []
  patterns:
    - "Tier 1: Promise.all([checkAuthorities, checkSellRoute]) — hard blocks, short-circuit on any failure"
    - "Tier 2/3: Promise.allSettled with AbortSignal.timeout() — scoring signals, pessimistic on rejection"
    - "Soft blocks: holderConcentration and creatorHistory pass=false rejects independently of aggregate score"
    - "Aggregate score: Math.round((rugScore/100)*40 + (holderScore/100)*30 + (creatorScore/100)*30)"
    - "TDD: vi.hoisted() for shared spy refs across vi.mock factories — avoids TDZ errors in vi.mock"
    - "Constructor mock pattern: vi.fn(function() { return {...} }) not arrow function — required for 'new' keyword"

key-files:
  created:
    - src/safety/safety-pipeline.ts
    - src/safety/safety-pipeline.test.ts
  modified:
    - src/index.ts — added SafetyPipeline import, initialization, and token event handler

key-decisions:
  - "vi.hoisted() used for shared spy references (mockCacheGet, mockCacheSet, etc.) — allows vi.mock factories to close over them without TDZ errors"
  - "vi.fn(function() { return {...} }) not vi.fn(() => ...) for constructor mocks — arrow functions are not constructors"
  - "SafetyPipeline has no cleanup method — cache is in-memory, blocklist writes are synchronous, no persistent connections or timers"
  - "resolveSettled() returns pass=true on Promise.allSettled rejection — errors don't prove danger (consistent with Tier 3 error handling pattern from Plan 03-02)"

metrics:
  duration: 5min
  completed: 2026-02-27
---

# Phase 3 Plan 3: SafetyPipeline Orchestrator Summary

**SafetyPipeline orchestrator tying all three tiers together: Tier 1 parallel hard blocks via Promise.all, Tier 2/3 parallel scoring via Promise.allSettled with AbortSignal timeouts, weighted aggregate score, configurable threshold rejection, per-check soft blocks, TTL cache, and detailed rejection logging — wired into DetectionManager token event flow**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T02:33:09Z
- **Completed:** 2026-02-27T02:38:51Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Implemented `SafetyPipeline` class with full three-tier orchestration: Tier 1 `Promise.all` hard blocks, Tier 2/3 `Promise.allSettled` scoring with `AbortSignal.timeout()` — no library needed (Node 18+ built-in)
- Tier 1 short-circuit: if any of mint authority, freeze authority, or sell route fails, pipeline rejects immediately with aggregateScore=0 and skips all Tier 2/3 API calls (saves API quota on obvious rejects)
- Aggregate score computed as weighted average: rugCheck(40%) + holder(30%) + creator(30%) — configurable in config.json (SAF-08)
- Tokens below `minSafetyScore` (default 60) rejected with `rejectionReasons` including actual score vs threshold (SAF-09)
- Per-check soft blocks: holder concentration or creator history `pass=false` independently rejects before aggregate computation
- Results cached per mint with `cacheTtlMs` TTL (5 min default) — re-detected mints skip all checks
- Detailed rejection logs at `info` level include: mint, source, decision, scores, thresholds, per-tier results, durationMs
- Wired into `src/index.ts`: DetectionManager `token` events flow through `safetyPipeline.evaluate()` with error handling
- 9 new tests covering all pipeline branches; full suite 77 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement SafetyPipeline orchestrator with TDD** - `afc389d` (feat)
2. **Task 2: Wire SafetyPipeline into index.ts** - `29c7b1c` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks used RED (test fails — module not found) -> GREEN (implementation passes) -> commit pattern_

## Files Created/Modified

- `src/safety/safety-pipeline.ts` — SafetyPipeline class (125 lines): constructor, evaluate(), resolveSettled(), buildSafetyResult()
- `src/safety/safety-pipeline.test.ts` — 9 tests: cache hit, 3 Tier 1 hard blocks (mint authority, freeze authority, no sell route), 2 soft blocks (holder, creator), aggregate pass, aggregate rejection, pessimistic Promise.allSettled
- `src/index.ts` — Import SafetyPipeline, initialize after DetectionManager, wire token event handler with error handling

## Decisions Made

- `vi.hoisted()` used for shared spy refs (mockCacheGet, mockCacheSet, etc.) — allows vi.mock factory closures without TDZ; same pattern as Plan 02-01 for MockWebSocket
- `vi.fn(function() { return {...} })` not arrow function for constructor mocks — vitest requires function keyword for constructors (`new` keyword support)
- `resolveSettled()` returns `pass=true` on Promise.allSettled rejection — consistent with Tier 3 error handling: errors don't prove danger, score=0 is pessimistic enough to fail aggregate if all three checks timeout
- No SafetyPipeline cleanup method needed: SafetyCache is in-memory (GC handles it), Blocklist writes are synchronous, no WebSocket or polling timers

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.mock constructor mock used wrong function form**
- **Found during:** Task 1 GREEN phase (first test run)
- **Issue:** `vi.fn().mockImplementation(() => ({...}))` pattern used arrow function — JavaScript arrow functions cannot be called with `new` keyword, causing "is not a constructor" TypeError
- **Fix:** Changed to `vi.fn(function() { return {...} })` — regular function can be used as constructor; also moved shared spy refs to `vi.hoisted()` so vi.mock factories can close over them
- **Files modified:** `src/safety/safety-pipeline.test.ts`
- **Verification:** All 9 pipeline tests pass
- **Committed in:** `afc389d` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test infrastructure bug, not implementation bug)
**Impact on plan:** Minimal. vi.mock pattern corrected during GREEN phase. No scope creep.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## User Setup Required

None — SafetyPipeline uses existing API keys from `.env` (`RUGCHECK_API_KEY`, `HELIUS_API_KEY`, both optional). No new configuration required.

## Next Phase Readiness

- Phase 3 Plan 4 (03-04): SafetyPipeline is fully operational; Plan 04 can focus on integration testing, load testing, or any remaining edge cases
- Phase 5 (execution engine): `safetyPipeline.evaluate()` returns `SafetyResult` with `pass=true` and `aggregateScore` — execution engine picks up from the `if (result.pass)` branch in `src/index.ts`
- The detection-to-safety pipeline is operational end-to-end: DetectionManager → SafetyPipeline → reject/approve decision

## Self-Check: PASSED

All created files verified present. Both task commits (afc389d, 29c7b1c) verified below.
