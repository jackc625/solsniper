---
phase: quick-260526-krq
plan: 01
subsystem: safety
tags: [rugcheck, api-auth, query-param, secret-hygiene, alerting, vitest]

# Dependency graph
requires:
  - phase: Phase 20 (reliability-monitoring, D-10)
    provides: ApiAlertCallback shared type + onApiAlert consumer + setRugCheckMonitoring wiring (committed 74c0f72)
provides:
  - RugCheck auth via documented ?key= query param (key on both initial + retry fetch)
  - Public-mode fallback (no ?key= when key unset/whitespace-only)
  - Scrubbed catch-block logging (key=*** + err.message, never raw err object)
  - Loud 'auth_failure' error-severity alert on HTTP 401/403 naming RUGCHECK_API_KEY
  - 'auth_failure' member added to the shared ApiAlertCallback union + index.ts mapping
affects: [safety-pipeline, tier3-creator (sibling precedent), any future API-auth wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Query-param API auth + catch-block URL scrubbing (mirrors tier3-creator.ts Helius fix)"
    - "Auth failures are diagnosable alerts, NOT safety hard-blocks (pass stays true)"

key-files:
  created: []
  modified:
    - src/core/fee-estimator.ts
    - src/index.ts
    - src/safety/checks/tier2-rugcheck.ts
    - src/safety/checks/tier2-rugcheck.test.ts

key-decisions:
  - "auth_failure maps to severity='error' + alertSource='api' (distinct from rate_limit's 'rateLimit')"
  - "Whitespace-only key treated as no key (apiKey.trim() guard) -> clean public mode"
  - "401/403 returns { pass: true, score: 0 } unchanged -- the alert is diagnosability only, never a hard block"
  - "Catch block logs err.message (not raw err) because the err stack can carry the unredacted URL+key"

patterns-established:
  - "Query-param auth + URL scrubbing: const safeUrl = url.replace(/key=[^&]+/, 'key=***')"
  - "Loud-but-non-blocking auth-failure alert pattern for safety checks"

requirements-completed: [SAF-05]

# Metrics
duration: 3min
completed: 2026-05-26
---

# Quick Task 260526-krq: Audit RugCheck API Wiring Summary

**Fixed four verified RugCheck wiring defects -- switched to documented `?key=` query-param auth with a public fallback, scrubbed the API key from error logs, and converted a silently-swallowed 401/403 into a loud `auth_failure` alert -- while preserving the safety invariant that every failure path still returns `{ pass: true, score: 0 }`.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-26T19:27:00Z (approx)
- **Completed:** 2026-05-26T19:30:30Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- **Documented `?key=` query-param auth** replaces the `X-API-KEY` header on both the initial and retry fetch (mirrors the committed Helius fix in `tier3-creator.ts` @ 74c0f72), aligning auth with RugCheck's account-documented form to secure the rate-limit tier.
- **Public-mode fallback**: when no key (or whitespace-only) is set, the URL carries no `?key=` param at all -- it does not append an empty value.
- **The root-cause defect is fixed**: a rejected/expired key (HTTP 401/403) now emits a loud `error`-severity `'auth_failure'` alert naming `RUGCHECK_API_KEY`, instead of being silently swallowed as a maximally-risky token. This makes a broken integration visible immediately rather than only after the circuit breaker trips.
- **Secret hygiene**: now that the key lives in the URL, the catch block logs a scrubbed URL (`key=***`) and `err.message` (never the raw `err` object, whose stack can carry the unredacted URL).
- **Safety invariant preserved**: 401/403 (and every other failure path) still returns `{ pass: true, score: 0 }`. The new test explicitly asserts `pass === true` on 401.

## Task Commits

Each task was committed atomically (code/tests only; docs handled separately by the orchestrator):

1. **Task 1: Add 'auth_failure' to ApiAlertCallback union + map it in index.ts** - `fc31d32` (feat)
2. **Task 2: RugCheck ?key= query auth, public fallback, scrubbed logs, loud auth_failure on 401/403 (+ tests)** - `05d4f90` (fix)

_Note: Task 2 followed RED -> GREEN within a single fix commit -- the two rewritten `?key=` assertions plus the new 401->auth_failure test were written first and confirmed failing (2 failed / 7 passed) against the header-based implementation, then the source changes turned them green (9/9). The test and implementation changes are co-located in one atomic fix commit since this is a defect fix against pre-existing tests rather than greenfield feature scaffolding._

## Files Created/Modified

- `src/core/fee-estimator.ts` - Extended the exported `ApiAlertCallback` type union's second param from `'consecutive_failure' | 'rate_limit'` to `... | 'auth_failure'`. FeeEstimator class body untouched (D-10).
- `src/index.ts` - In `onApiAlert`, both `'rate_limit'` and `'auth_failure'` now yield `severity='error'`; `'auth_failure'` routes to `alertSource='api'` via the existing else branch (no type change needed -- `'api'` is already a valid union member).
- `src/safety/checks/tier2-rugcheck.ts` - Conditional `?key=` URL (with `apiKey?.trim()` guard for public mode), removed `X-API-KEY` header from both fetches, added 401/403 `auth_failure` branch (error log + alert + pessimistic `{ pass: true, score: 0 }` return), and scrubbed the catch-block log.
- `src/safety/checks/tier2-rugcheck.test.ts` - Replaced the two `X-API-KEY` header assertions with `?key=` query-param assertions (present when key provided / absent in public mode), and added a new "emits auth_failure alert and stays pass=true on HTTP 401" test.

## Decisions Made

None beyond the LOCKED decisions in CONTEXT.md -- the plan was executed exactly as specified. Notable confirmations during execution:
- `alertSource`'s existing else branch already routes `'auth_failure' -> 'api'`, so only the `severity` line needed editing in `index.ts` (the plan anticipated this).
- 401/403 are not in the retry set (only 429/5xx retry), so the 401 test asserts exactly one fetch call, and the `finally`-block consecutive-failure tracking still counts these as failures (consistent with the prior non-200 behavior and with tier3-creator).

## Deviations from Plan

None - plan executed exactly as written. No deviation rules (1-4) were triggered; no auth gates were hit during execution (the 401 handling is the *feature*, exercised only via mocked tests).

## Issues Encountered

None. The RED run surfaced the expected 2 failures and visibly demonstrated the pre-fix secret leak (the raw `err` object's stack contained the full URL), which the scrub change then eliminated -- confirmed in the GREEN run's log output (`...?key=***`, `err: "network failure"`).

## Verification Results

- `npx vitest run src/safety/checks/tier2-rugcheck.test.ts` -> **9 passed / 9** (1 file passed). Includes the 2 rewritten `?key=` assertions and the new 401->auth_failure emission test; all pre-existing circuit-breaker / retry / score / clamp / lpLockedPct tests remain green.
- `npx tsc --noEmit` -> **exit 0** (whole-project typecheck clean), proving the `ApiAlertCallback` union extension and `index.ts` mapping compile end-to-end.
- Manual inspection confirmed: key appended as `?key=` on both fetches and omitted entirely in public mode; no `X-API-KEY` header remains; catch block logs scrubbed URL + `err.message`; 401/403 branch emits `'auth_failure'` at error level AND returns `{ pass: true, score: 0 }`; score math / endpoint path / schema / 429 handling / circuit breaker untouched.

## Threat Model Outcome

- **T-krq-01 (Information Disclosure -- key in URL reaching logs):** mitigated. Catch block scrubs `key=[^&]+` -> `key=***` and logs `err.message`, never the raw `err`.
- **T-krq-02 (rejected key silently treated as max-risk token):** mitigated. 401/403 emits a loud `error`-severity `'auth_failure'` alert naming `RUGCHECK_API_KEY`.
- **T-krq-03 (auth path inadvertently hard-blocking trades):** accepted/enforced. The invariant `{ pass: true, score: 0 }` is preserved on the 401/403 path and asserted in the new test (`pass === true`). No package installs in this task, so the supply-chain checkpoint did not apply.

No new threat surface introduced beyond the plan's `<threat_model>`.

## Known Stubs

None. No placeholder/empty-data stubs were introduced; all changed code paths are fully wired.

## Self-Check: PASSED

- `src/core/fee-estimator.ts` - FOUND (modified, contains `auth_failure` in union)
- `src/index.ts` - FOUND (modified, `auth_failure` mapped to severity='error')
- `src/safety/checks/tier2-rugcheck.ts` - FOUND (modified, contains `key=` query auth + `auth_failure` alert + `key=***` scrub)
- `src/safety/checks/tier2-rugcheck.test.ts` - FOUND (modified, contains `auth_failure` test + `?key=` assertions)
- Commit `fc31d32` (Task 1) - FOUND in git log
- Commit `05d4f90` (Task 2) - FOUND in git log
- `npx vitest run src/safety/checks/tier2-rugcheck.test.ts` - 9/9 GREEN
- `npx tsc --noEmit` - exit 0
