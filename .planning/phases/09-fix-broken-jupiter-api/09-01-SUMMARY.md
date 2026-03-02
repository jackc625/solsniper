---
phase: 09-fix-broken-jupiter-api
plan: 01
subsystem: api
tags: [jupiter, fetch, rate-limiting, auth, tdd, vitest]

# Dependency graph
requires:
  - phase: 01-foundation-operations
    provides: env.ts Zod schema, createModuleLogger pattern
provides:
  - JupiterClient class with quote(), swap(), isRateLimited(), cooldownRemainingMs()
  - jupiterClient singleton export
  - SOLSNIPER_JUPITER_API_KEY required env var (fail-fast at startup)
affects: [09-fix-broken-jupiter-api, position-manager, safety-pipeline, execution-engine]

# Tech tracking
tech-stack:
  added: []
  patterns: [vi.mock env with LOG_LEVEL+NODE_ENV for logger.ts compatibility, vi.useFakeTimers for cooldown expiry tests, fresh class instance per test for isolation]

key-files:
  created:
    - src/execution/jupiter-client.ts
    - src/execution/jupiter-client.test.ts
  modified:
    - src/config/env.ts
    - .env.example

key-decisions:
  - "JupiterClient uses class (not helper function) for mutable cooldown state"
  - "Global cooldown state per JupiterClient instance — singleton blocks all callers on 429"
  - "Retry-After header parsed as seconds, multiplied by 1000 for ms; falls back to 10000ms"
  - "Test mock includes LOG_LEVEL and NODE_ENV so logger.ts does not crash on undefined pino level"
  - "Test mocks vi.mock('../config/env.js') entirely — avoids process.exit(1) from real env validation"

patterns-established:
  - "TDD pattern: vi.mock env module with all fields logger.ts needs (LOG_LEVEL, NODE_ENV, plus feature keys)"
  - "Rate limit pattern: private cooldownUntil timestamp, public isRateLimited()/cooldownRemainingMs() for callers"

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-03-02
---

# Phase 9 Plan 01: JupiterClient Summary

**JupiterClient class with x-api-key header injection, global 429 cooldown (Retry-After or 10s fallback), and AbortSignal propagation — 18 tests green via TDD**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-02T17:31:13Z
- **Completed:** 2026-03-02T17:35:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- Created centralized JupiterClient class that all Jupiter callers will use after migration
- Added SOLSNIPER_JUPITER_API_KEY as a required env var — bot now fails fast at startup if missing
- Global cooldown state blocks all Jupiter requests when any endpoint returns 429 (rate limit is per-key)
- Retry-After header respected to avoid premature retries; 10s fallback for responses without the header
- Full test suite: 18 tests covering auth headers, 429 cooldown, cross-method blocking, AbortSignal, timer expiry

## Task Commits

Each task was committed atomically:

1. **RED - Failing tests for JupiterClient** - `50fe30f` (test)
2. **GREEN - JupiterClient implementation + env/example updates** - `ac7571a` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD plan — test commit followed by implementation commit_

## Files Created/Modified
- `src/execution/jupiter-client.ts` - JupiterClient class + jupiterClient singleton
- `src/execution/jupiter-client.test.ts` - 18-test suite covering all behavior cases
- `src/config/env.ts` - Added SOLSNIPER_JUPITER_API_KEY required field to EnvSchema
- `.env.example` - Added SOLSNIPER_JUPITER_API_KEY with portal.jup.ag comment

## Decisions Made
- Used class instead of helper function for mutable cooldown state (private `cooldownUntil` timestamp)
- Test mock includes `LOG_LEVEL: 'error'` and `NODE_ENV: 'development'` alongside `SOLSNIPER_JUPITER_API_KEY` because `logger.ts` imports env for those fields — pino throws if `level` is undefined
- Entire env module mocked with `vi.mock` to prevent `process.exit(1)` from real validation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test mock missing LOG_LEVEL and NODE_ENV fields**
- **Found during:** GREEN phase (first test run)
- **Issue:** `jupiter-client.ts` imports `createModuleLogger` from `logger.ts`, which in turn imports `env.ts` for `LOG_LEVEL` and `NODE_ENV`. The test mock only provided `SOLSNIPER_JUPITER_API_KEY`, so pino received `level: undefined` and threw "default level:undefined must be included in custom levels"
- **Fix:** Added `LOG_LEVEL: 'error'` and `NODE_ENV: 'development'` to the `vi.mock('../config/env.js')` return object
- **Files modified:** `src/execution/jupiter-client.test.ts`
- **Verification:** All 18 tests pass after fix
- **Committed in:** ac7571a (GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test mock)
**Impact on plan:** Required for tests to run — pino level validation is a hard crash. No scope creep.

## Issues Encountered
- Pino throws at initialization when `LOG_LEVEL` env var is `undefined` — `logger.ts` importing `env.ts` inside the test process means any `vi.mock` of env for the feature must also supply all fields logger.ts needs. Resolved by expanding the mock (deviation Rule 1).

## User Setup Required

**External service requires manual configuration before the bot can run.**

1. Sign up at https://portal.jup.ag (email, instant, free)
2. Copy your API key
3. Add to `.env`:
   ```
   SOLSNIPER_JUPITER_API_KEY=your_key_here
   ```
4. Verify: `node -e "require('dotenv/config'); require('./dist/config/env.js'); console.log('env OK')"`

Free tier: 60 req/min. Bot fails fast at startup if key is missing.

## Next Phase Readiness
- `jupiterClient` singleton and `JupiterClient` class ready for import by all 5 Jupiter-calling files
- Plan 09-02 will migrate those callers to use `jupiterClient.quote()` / `jupiterClient.swap()`
- `isRateLimited()` and `cooldownRemainingMs()` ready for PositionManager interval stretching (plan 09-02 or later)

---
*Phase: 09-fix-broken-jupiter-api*
*Completed: 2026-03-02*
