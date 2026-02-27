---
phase: 03-safety-pipeline
plan: 01
subsystem: safety
tags: [solana, spl-token, jupiter, safety-pipeline, tdd, zod, blocklist, cache]

requires:
  - phase: 02-token-detection
    provides: TokenEvent type with mint address used as input to all safety checks

provides:
  - CheckResult and SafetyResult types in src/types/index.ts
  - SafetyConfigSchema with weights, thresholds, timeouts in src/config/trading.ts
  - SafetyCache class with TTL-based expiry (src/safety/safety-cache.ts)
  - Blocklist class with disk persistence (src/safety/blocklist.ts)
  - checkAuthorities() using getMint() for mint/freeze authority hard-block checks
  - checkSellRoute() using Jupiter Quote API for sell route validation
affects: [03-02, 03-03, 03-04, safety-pipeline-orchestrator]

tech-stack:
  added:
    - "@solana/spl-token 0.4.14 — getMint() for authority checks"
  patterns:
    - "SafetyCache: Map<string, { result, expiresAt }> with TTL deletion on get()"
    - "Blocklist: Set<string> backed by fs.writeFileSync() on add(), fs.readFileSync() on load()"
    - "Tier 1 checks: return [CheckResult, CheckResult] tuple from single getMint() call"
    - "Pessimistic failure: all errors and non-200 HTTP responses return pass=false"
    - "TDD: RED (test fails) -> GREEN (implementation passes) -> commit"
    - "vi.mock('@solana/spl-token') with vi.hoisted() for getMint mock"
    - "vi.stubGlobal('fetch', mockFetch) for Jupiter API mock"

key-files:
  created:
    - src/safety/safety-cache.ts
    - src/safety/blocklist.ts
    - src/safety/blocklist.test.ts
    - src/safety/checks/tier1-authority.ts
    - src/safety/checks/tier1-authority.test.ts
    - src/safety/checks/tier1-sell-route.ts
    - src/safety/checks/tier1-sell-route.test.ts
  modified:
    - src/types/index.ts — added CheckResult, SafetyResult interfaces
    - src/config/trading.ts — added SafetyConfigSchema, HolderConfigSchema, SafetyWeightsSchema, SafetyConfig type
    - src/config/env.ts — added RUGCHECK_API_KEY and HELIUS_API_KEY optional vars
    - config.json — added safety block with weights, timeouts, thresholds
    - .env.example — added commented placeholders for API keys
    - src/detection/detection-manager.test.ts — updated makeTradingConfig fixture with safety field

key-decisions:
  - "MOCK_AUTHORITY in tests uses real valid base58 PublicKey (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA) — fake address strings cause PublicKey constructor to throw"
  - "checkAuthorities() makes 1 getMint() call returning both mint and freeze authority (not 2 separate calls)"
  - "Retry logic for account-not-found limited to 2 retries with 100ms delay — handles new mint race conditions"
  - "vi.stubGlobal used for fetch mock in sell route tests (not vi.mock) — simpler for global API mocking"
  - "SafetyCache size getter exposes Map.size (includes potentially expired entries, cleaned lazily)"

patterns-established:
  - "Tier 1 checks return CheckResult tuple not SafetyResult — orchestrator assembles full SafetyResult"
  - "All Tier 1 errors are pessimistic: any getMint throw or non-200 HTTP = pass:false"
  - "Blocklist.load() silently ignores missing file — no error on first startup"
  - "Blocklist.add() creates directory recursively before writing"

requirements-completed: [SAF-01, SAF-02, SAF-03, SAF-04, SAF-08, SAF-09]

duration: 6min
completed: 2026-02-26
---

# Phase 3 Plan 1: Safety Pipeline Foundation Summary

**Tier 1 hard-block safety checks (mint/freeze authority via getMint(), Jupiter sell route via Quote API) with shared SafetyCache, persistent Blocklist, CheckResult/SafetyResult types, and SafetyConfigSchema in config.json**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T02:13:01Z
- **Completed:** 2026-02-27T02:19:18Z
- **Tasks:** 2
- **Files modified:** 11 (7 created, 4 modified + package.json + pnpm-lock.yaml)

## Accomplishments

- Installed `@solana/spl-token` and added `SafetyConfigSchema` with weights/thresholds to `config.json` and `trading.ts`
- Created `SafetyCache` (TTL-based in-memory cache) and `Blocklist` (persistent disk-backed set) as shared safety infrastructure
- Implemented `checkAuthorities()` — single `getMint()` call for both mint and freeze authority hard-block checks (SAF-01, SAF-02) with 2-retry race condition handling
- Implemented `checkSellRoute()` — Jupiter Quote API validation with pessimistic failure handling (SAF-03)
- 46 total tests passing (19 new: 7 blocklist + 6 authority + 6 sell route + TDD test doubles)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install spl-token, add safety types, config schema, cache, and blocklist** - `40ffe11` (feat)
2. **Task 2: Implement Tier 1 authority checks and Jupiter sell route check with TDD** - `62070c7` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks used RED (test fails) -> GREEN (impl passes) -> commit pattern_

## Files Created/Modified

- `src/safety/safety-cache.ts` — TTL-based SafetyResult cache keyed by mint address
- `src/safety/blocklist.ts` — Persistent Set<string> backed by local JSON file with auto-directory creation
- `src/safety/blocklist.test.ts` — 7 tests: empty on missing file, has/add, size, persist, reload, dedup, mkdir
- `src/safety/checks/tier1-authority.ts` — checkAuthorities() returning [mintAuth, freezeAuth] CheckResult tuple
- `src/safety/checks/tier1-authority.test.ts` — 6 tests: both-null, mint-active, freeze-active, throw-pessimistic, retry-exhausted, retry-success
- `src/safety/checks/tier1-sell-route.ts` — checkSellRoute() for Jupiter Quote API validation
- `src/safety/checks/tier1-sell-route.test.ts` — 6 tests: 200-pass, 400-fail, 500-fail, network-error, signal-passed, URL-format
- `src/types/index.ts` — Added CheckResult and SafetyResult interfaces
- `src/config/trading.ts` — Added SafetyConfigSchema, HolderConfigSchema, SafetyWeightsSchema, SafetyConfig type
- `src/config/env.ts` — Added optional RUGCHECK_API_KEY and HELIUS_API_KEY
- `config.json` — Added safety block with weights {rugCheck:40, holder:30, creator:30}, TTLs, thresholds
- `.env.example` — Added commented API key placeholders
- `src/detection/detection-manager.test.ts` — Updated makeTradingConfig fixture to include safety field

## Decisions Made

- `checkAuthorities()` uses one `getMint()` call for both checks (not two separate calls) — efficient, satisfies SAF-04 parallelism
- `MockPublicKey` in tests uses real valid base58 address (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) — the `PublicKey` constructor validates base58 encoding, short/fake strings throw
- `vi.stubGlobal('fetch', mockFetch)` used for sell route tests instead of `vi.mock` — cleaner for global built-in mocking
- Retry logic uses `isAccountNotFoundError()` string match on error message — handles both "could not find" and "account not found" variants

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated detection-manager.test.ts TradingConfig fixture missing safety field**
- **Found during:** Task 1 (TypeScript check after adding SafetyConfigSchema to TradingConfigSchema)
- **Issue:** `makeTradingConfig()` in existing test returned `TradingConfig` without the new required `safety` field, causing TS2741 errors
- **Fix:** Added full `safety` object with default values to the fixture
- **Files modified:** `src/detection/detection-manager.test.ts`
- **Verification:** `pnpm exec tsc --noEmit` returned zero errors
- **Committed in:** `40ffe11` (Task 1 commit)

**2. [Rule 1 - Bug] Fixed invalid MOCK_AUTHORITY PublicKey string in authority tests**
- **Found during:** Task 2 GREEN phase (first test run after implementation)
- **Issue:** `new PublicKey('Authority111111111111111111111111111111111')` threw "Invalid public key input" — the string was not valid base58 and wrong length
- **Fix:** Replaced with valid existing Solana program address `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- **Files modified:** `src/safety/checks/tier1-authority.test.ts`
- **Verification:** All 6 authority tests pass
- **Committed in:** `62070c7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes were necessary for TypeScript and test correctness. No scope creep.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required for Tier 1 checks (authority checks use existing RPC URL, Jupiter Quote API is public). Optional API keys for Tier 2/3 (added to .env.example as comments).

## Next Phase Readiness

- `checkAuthorities()` and `checkSellRoute()` ready to be composed into a `Promise.all` Tier 1 gate
- `SafetyCache` and `Blocklist` instantiated by the pipeline orchestrator (Plan 03-04)
- `SafetyConfig` loadable from `tradingConfig.safety` — Plan 03-02 (RugCheck) and 03-03 (holders/creator) can read weights and timeouts
- Tier 2 and Tier 3 checks can build on the same `CheckResult` type pattern established here

---
*Phase: 03-safety-pipeline*
*Completed: 2026-02-26*
