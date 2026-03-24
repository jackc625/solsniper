---
phase: 09-fix-broken-jupiter-api
plan: 02
subsystem: execution
tags: [jupiter, rate-limit, migration, position-management]
dependency_graph:
  requires: [09-01]
  provides: [all-jupiter-callers-use-jupiterClient, dynamic-poll-interval]
  affects: [tier1-sell-route, jupiter-buyer, standard-seller, jito-seller, position-manager, index]
tech_stack:
  added: []
  patterns: [module-mock-with-vi.mock, env-mock-in-tests, dynamic-interval-cooldown]
key_files:
  created: []
  modified:
    - src/safety/checks/tier1-sell-route.ts
    - src/safety/checks/tier1-sell-route.test.ts
    - src/execution/buy/jupiter-buyer.ts
    - src/execution/buy/jupiter-buyer.test.ts
    - src/execution/sell/standard-seller.ts
    - src/execution/sell/jito-seller.ts
    - src/position/position-manager.ts
    - src/position/position-manager.test.ts
    - src/index.ts
decisions:
  - "env mock required in test files that transitively import logger.ts → env.ts; use vi.mock('../config/env.js') alongside vi.mock('jupiter-client.js')"
  - "jito-seller Jito bundle submission (JITO_BUNDLE_URL) left as raw fetch — not a Jupiter call, should not route through JupiterClient"
  - "position-manager.ts imports JupiterClient as type import only (no runtime circular dep); singleton jupiterClient injected via constructor"
  - "scheduleTick stretches interval = cooldownRemainingMs + pollIntervalMs when cooldown > 0 — yields rate budget to trade-critical calls"
  - "Pre-existing test failures (12 suites) from missing SOLSNIPER_JUPITER_API_KEY in .env deferred to separate task — out of scope for 09-02"
metrics:
  duration: 10 min
  completed: "2026-03-02"
  tasks: 2
  files_modified: 9
---

# Phase 9 Plan 02: Jupiter Client Migration Summary

All 5 Jupiter-calling files migrated from raw fetch() to centralized JupiterClient; PositionManager enhanced with dynamic poll interval and jupiterClient constructor injection.

## What Was Built

**Task 1 — Migrate 4 execution/safety files:**

- `tier1-sell-route.ts`: Removed `JUPITER_QUOTE_URL` and `SOL_MINT` constants. Replaced raw `fetch()` with `jupiterClient.quote(params, signal)`. All errors (429, 400, 500, network, cooldown) now uniformly return `pass=false` via single catch block — preserves pessimistic behavior.

- `jupiter-buyer.ts`: Removed `JUPITER_QUOTE` and `JUPITER_SWAP` constants. Replaced quote fetch with `jupiterClient.quote(params)` and swap fetch with `jupiterClient.swap(body)`. `SOL_MINT` constant kept (still needed for URLSearchParams).

- `standard-seller.ts`: Same pattern as jupiter-buyer — replaced both fetch calls with `jupiterClient.quote/swap()`.

- `jito-seller.ts`: Same pattern for Jupiter quote + swap. JITO_BUNDLE_URL and `pollBundleStatus()` left as raw fetch (these are Jito calls, not Jupiter calls).

**Task 2 — PositionManager + index.ts + test updates:**

- `position-manager.ts`: Added `jupiterClient: JupiterClient` as 6th constructor parameter. Replaced raw `fetch()` in `getPositionValueSol()` with `jupiterClient.quote(params)`. Enhanced `scheduleTick()` to read `cooldownRemainingMs()` and stretch poll interval when cooldown is active.

- `index.ts`: Added `import { jupiterClient } from './execution/jupiter-client.js'` and passed it as 6th arg to `PositionManager` constructor.

- Test updates:
  - `tier1-sell-route.test.ts`: Replaced `vi.stubGlobal('fetch')` with `vi.mock('../../execution/jupiter-client.js', () => ({ jupiterClient: { quote: mockQuote } }))`. Added 7 test cases covering all error paths and AbortSignal propagation.
  - `jupiter-buyer.test.ts`: Added `vi.mock('../../config/env.js')` + `vi.mock('../jupiter-client.js')` with `mockJupiterQuote`/`mockJupiterSwap`. Replaced `vi.stubGlobal(fetch)` patterns. 5 tests pass.
  - `position-manager.test.ts`: Added `vi.mock('../config/env.js')` + `mockJupiterClient` fixture with `quote`, `isRateLimited`, `cooldownRemainingMs`. Updated all constructor calls to pass `mockJupiterClient` as 6th arg. Added 2 new tests for dynamic interval behavior. 18 tests pass.

## Verification Results

```
Test Files  4 passed (4)
Tests       48 passed (48)
```

- `tier1-sell-route.test.ts`: 7/7 passed
- `jupiter-buyer.test.ts`: 5/5 passed
- `position-manager.test.ts`: 18/18 passed
- `jupiter-client.test.ts`: 18/18 passed (unchanged, verifies no regression)

TypeScript: No errors in production source files. One pre-existing error in `detection-manager.test.ts` (out of scope).

No hardcoded `api.jup.ag` URLs remain outside `jupiter-client.ts`.

## Decisions Made

1. **env mock required in test files**: When a source file transitively imports `logger.ts → env.ts`, vitest will trigger `process.exit(1)` unless `env.js` is mocked. Added `vi.mock('../config/env.js', ...)` alongside `vi.mock('jupiter-client.js')` in affected test files.

2. **Jito bundle submission stays as raw fetch**: `JITO_BUNDLE_URL` calls in `jito-seller.ts` are Jito-specific (not Jupiter). Rate limits and auth requirements are different — should not go through JupiterClient.

3. **Constructor injection (not module-level import)**: PositionManager receives `jupiterClient` via constructor instead of importing the singleton directly. This enables clean test isolation via mock injection.

4. **Dynamic interval formula**: `intervalMs = cooldownRemainingMs + pollIntervalMs` when cooldown > 0. This means the next tick waits for the full cooldown to expire PLUS the normal poll interval — slightly conservative but ensures monitoring doesn't immediately hammer Jupiter after cooldown expires.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added env mock to jupiter-buyer.test.ts and position-manager.test.ts**
- **Found during:** Task 2 test execution
- **Issue:** Both test files import modules that transitively reach `env.ts` (via `logger.ts`). Without mocking `env.js`, `process.exit(1)` fires immediately on test file load because `SOLSNIPER_JUPITER_API_KEY` is not in the test environment.
- **Fix:** Added `vi.mock('../../config/env.js', () => ({ env: { SOLSNIPER_JUPITER_API_KEY: 'test-api-key', LOG_LEVEL: 'error', NODE_ENV: 'development' } }))` as first statement in both test files.
- **Files modified:** `jupiter-buyer.test.ts`, `position-manager.test.ts`
- **Commit:** 936d03a

### Deferred Issues

**12 pre-existing test suite failures** — not caused by this plan's changes. These were broken by Plan 09-01 adding `SOLSNIPER_JUPITER_API_KEY` as required in `env.ts`. Each affected test file needs either a `vi.mock('../config/env.js')` added, or the user must add `SOLSNIPER_JUPITER_API_KEY=<key>` to `.env`. Documented in `deferred-items.md`.

## Commits

| Hash | Message |
|------|---------|
| fc2328b | feat(09-02): migrate 4 Jupiter-calling files to jupiterClient |
| 936d03a | feat(09-02): add dynamic poll interval to PositionManager + wire jupiterClient + update tests |

## Self-Check: PASSED

- FOUND: src/safety/checks/tier1-sell-route.ts
- FOUND: src/execution/buy/jupiter-buyer.ts
- FOUND: src/execution/sell/standard-seller.ts
- FOUND: src/execution/sell/jito-seller.ts
- FOUND: src/position/position-manager.ts
- FOUND: src/index.ts
- FOUND: .planning/phases/09-fix-broken-jupiter-api/09-02-SUMMARY.md
- FOUND commit: fc2328b
- FOUND commit: 936d03a
