---
phase: 03-safety-pipeline
plan: 02
subsystem: safety
tags: [solana, rugcheck, helius, holder-concentration, creator-history, tdd, blocklist, pessimistic-failure]

requires:
  - phase: 03-safety-pipeline
    plan: 01
    provides: CheckResult type, Blocklist class, SafetyConfigSchema with holder thresholds

provides:
  - checkRugCheck() in src/safety/checks/tier2-rugcheck.ts
  - checkHolderConcentration() in src/safety/checks/tier2-holder.ts
  - checkCreatorHistory() in src/safety/checks/tier3-creator.ts
affects: [03-03, 03-04, safety-pipeline-orchestrator]

tech-stack:
  added: []
  patterns:
    - "RugCheck score inversion: safetyScore = 100 - score_normalised (risk scale inverted to safety scale)"
    - "Holder concentration: BigInt arithmetic, parallel getParsedAccountInfo, 5-address system account exclusion Set"
    - "Creator fast path: blocklist.has() check before any API call"
    - "Pessimistic failure: all errors and non-200 return score=0"
    - "vi.stubGlobal('fetch', mockFetch) for fetch mocking in all Tier 2/3 tests"

key-files:
  created:
    - src/safety/checks/tier2-rugcheck.ts
    - src/safety/checks/tier2-rugcheck.test.ts
    - src/safety/checks/tier2-holder.ts
    - src/safety/checks/tier2-holder.test.ts
    - src/safety/checks/tier3-creator.ts
    - src/safety/checks/tier3-creator.test.ts
  modified: []

key-decisions:
  - "top-1 holder threshold uses strict > comparison — 25.0% exactly passes, 25.1% soft-blocks"
  - "Holder concentration uses BigInt for token amount arithmetic to avoid precision loss on large supplies"
  - "creator check returns pass=true (not false) on API error — Tier 3 is a scoring signal, hard blocks require explicit evidence"
  - "analyzeCreatorHistory filters tx array by type=TOKEN_MINT before counting — Helius returns all tx types"
  - "Test scenario for 'no dominance' uses 10%/8%/7%/10% distribution — original 25% x4 scenario failed because combined top10=100% exceeds 50% threshold"

metrics:
  duration: 6min
  completed: 2026-02-27
---

# Phase 3 Plan 2: Tier 2/3 Safety Checks Summary

**RugCheck API integration (score inversion), holder concentration analysis (BigInt, system account exclusion, soft-block thresholds), and creator history check (blocklist fast path, Helius API, serial deployer detection) — all pessimistic on failure**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T02:23:23Z
- **Completed:** 2026-02-27T02:29:00Z
- **Tasks:** 2
- **Files modified:** 6 created

## Accomplishments

- Implemented `checkRugCheck()` — queries RugCheck API, inverts risk score to safety scale (`100 - score_normalised`), pessimistic on non-200 and errors (score=0)
- Implemented `checkHolderConcentration()` — resolves all 20 largest token accounts to owner wallets via `getParsedAccountInfo()` in parallel, excludes 5 system/program addresses, enforces top1=25% and top10=50% soft-block thresholds
- Implemented `checkCreatorHistory()` — blocklist fast path before any API call, queries Helius Enhanced TX API for TOKEN_MINT history, scores 0-1/2-3/4-9/10+ mint tiers, auto-adds serial deployers to persistent Blocklist
- 22 new tests passing (6 RugCheck + 7 holder + 9 creator); full suite 68 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement RugCheck API and holder concentration checks with TDD** - `c519cca` (feat)
2. **Task 2: Implement creator history check with blocklist integration and TDD** - `95409b9` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks used RED (tests fail — module not found) -> GREEN (implementation passes) -> commit pattern_

## Files Created/Modified

- `src/safety/checks/tier2-rugcheck.ts` — `checkRugCheck()`: fetch RugCheck API, invert score, pessimistic failure
- `src/safety/checks/tier2-rugcheck.test.ts` — 6 tests: score inversion, non-200 pessimism, error pessimism, API key header, missing key, clamping
- `src/safety/checks/tier2-holder.ts` — `checkHolderConcentration()`: BigInt arithmetic, parallel owner resolution, system account exclusion, top1/top10 soft-block
- `src/safety/checks/tier2-holder.test.ts` — 7 tests: no dominance, top1 block, top10 block, system exclusion, RPC error, zero supply, token program exclusion
- `src/safety/checks/tier3-creator.ts` — `checkCreatorHistory()`: blocklist fast path, Helius API, mint count scoring, serial deployer blocklist addition
- `src/safety/checks/tier3-creator.test.ts` — 9 tests: undefined creator, blocklist hit, missing key, empty key, new creator (0-1 mints), serial deployer (4-9 mints), hard reject 10+ + blocklist add, API error 403, timeout

## Decisions Made

- `checkCreatorHistory()` returns `pass=true` on API error (score=0) — Tier 3 is a soft scoring signal; errors don't prove danger the way they do for Tier 1 hard-block checks
- Holder concentration uses `BigInt` throughout to handle token amounts that may exceed JavaScript `Number.MAX_SAFE_INTEGER`
- `analyzeCreatorHistory` filters Helius transactions by `type === 'TOKEN_MINT'` before counting — the API returns all tx types when queried for a creator
- Test scenario correction: "no holder dominance" test changed from 4x25% equal distribution to 10%/8%/7%/10% distribution — the 4x25% scenario correctly fails the top10=100% threshold check

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test scenario invalid: 4x25% distribution fails top10 threshold**
- **Found during:** Task 1 GREEN phase (first test run)
- **Issue:** Test "returns high score when no single holder dominates" used 4 holders at 25% each. Combined top10 = 100%, which correctly exceeds the 50% top10 soft-block threshold. The test assertion `pass=true` was wrong.
- **Fix:** Replaced test data with realistic well-distributed scenario: 10% / 8% / 7% / 10% distribution (combined top10 = 35%, both thresholds satisfied)
- **Files modified:** `src/safety/checks/tier2-holder.test.ts`
- **Verification:** All 7 holder tests pass
- **Committed in:** `c519cca` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test logic error, not implementation bug)
**Impact on plan:** Minimal. One test scenario corrected before commit. No scope creep.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## User Setup Required

- `RUGCHECK_API_KEY` in `.env` — optional, improves rate limits with RugCheck API (public endpoint still works without key, sends empty `X-API-KEY` header)
- `HELIUS_API_KEY` in `.env` — required to enable Tier 3 creator history checks; without it, `checkCreatorHistory()` returns neutral score=50 and skips the API call

## Next Phase Readiness

- All three check functions (`checkRugCheck`, `checkHolderConcentration`, `checkCreatorHistory`) return `CheckResult` compatible with the orchestrator Plan 03-03 expects
- Creator checks integrate with the `Blocklist` class from Plan 03-01 — serial deployers auto-populate the blocklist for instant future rejection
- Plan 03-03 can compose Tier 2+3 checks into a `Promise.allSettled()` gate with configurable timeouts from `SafetyConfig.tier2TimeoutMs` and `tier3TimeoutMs`

## Self-Check: PASSED

All 6 created files verified present. Both task commits (c519cca, 95409b9) verified in git log.

---
*Phase: 03-safety-pipeline*
*Completed: 2026-02-27*
