---
phase: quick-260526-krq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/fee-estimator.ts
  - src/index.ts
  - src/safety/checks/tier2-rugcheck.ts
  - src/safety/checks/tier2-rugcheck.test.ts
autonomous: true
requirements: [SAF-05]
must_haves:
  truths:
    - "checkRugCheck sends the API key as a ?key= query parameter, not an X-API-KEY header"
    - "When no API key is set, the request URL contains no ?key= param (clean public mode)"
    - "A rejected key (HTTP 401/403) emits a loud 'auth_failure' alert naming RUGCHECK_API_KEY at error severity"
    - "HTTP 401/403 still returns { pass: true, score: 0 } -- safety/trade semantics are unchanged (diagnosability only, never a hard block)"
    - "The API key never appears in any log line (URL is scrubbed, raw err object is not logged)"
    - "tier2-rugcheck.test.ts passes, including new ?key= assertions and a 401->auth_failure test"
  artifacts:
    - path: "src/core/fee-estimator.ts"
      provides: "ApiAlertCallback union extended with 'auth_failure'"
      contains: "auth_failure"
    - path: "src/index.ts"
      provides: "onApiAlert maps 'auth_failure' to severity='error', alertSource='api'"
      contains: "auth_failure"
    - path: "src/safety/checks/tier2-rugcheck.ts"
      provides: "Query-param auth, public fallback, scrubbed logs, loud 401/403 auth_failure alert"
      contains: "key="
    - path: "src/safety/checks/tier2-rugcheck.test.ts"
      provides: "Updated ?key= assertions + 401->auth_failure emission test"
      contains: "auth_failure"
  key_links:
    - from: "src/safety/checks/tier2-rugcheck.ts"
      to: "src/core/fee-estimator.ts"
      via: "ApiAlertCallback type import; passes 'auth_failure' to alertCb"
      pattern: "auth_failure"
    - from: "src/index.ts"
      to: "src/safety/checks/tier2-rugcheck.ts"
      via: "setRugCheckMonitoring(metricsTracker, onApiAlert, apiFailureThreshold)"
      pattern: "setRugCheckMonitoring"
    - from: "src/safety/checks/tier2-rugcheck.ts"
      to: "https://api.rugcheck.xyz/v1/tokens"
      via: "fetch with ?key= query param on both initial and retry request"
      pattern: "report/summary"
---

<objective>
Fix the four verified defects in the RugCheck safety-check wiring (`src/safety/checks/tier2-rugcheck.ts`) surfaced by the 260526-krq audit. The endpoint, path, response schema, and score math are already correct and MUST NOT change. The defects are: (1) auth is sent as an `X-API-KEY` header instead of the documented `?key=` query param; (2) no public-mode fallback when the key is unset; (3) the catch-block log can leak the key now that it lives in the URL; (4) a rejected key (HTTP 401/403) is silently swallowed as a maximally-risky token instead of raising a loud, diagnosable alert.

This MIRRORS the already-committed Helius fix in `tier3-creator.ts` (74c0f72): query-param auth + URL scrubbing in the catch block. The only change outside `tier2-rugcheck.*` is adding the `'auth_failure'` member to the shared `ApiAlertCallback` union (`fee-estimator.ts`) and mapping it to error severity in the `onApiAlert` consumer (`index.ts`).

CRITICAL SAFETY INVARIANT: every failure path -- including the new 401/403 auth-failure path -- MUST still return `{ pass: true, score: 0 }`. The `auth_failure` alert is for DIAGNOSABILITY ONLY. It does NOT hard-block trades. Do not change the pass/fail behavior of any path.

Purpose: Make a broken RugCheck integration visible immediately (instead of silently zero-scoring every token until the circuit breaker trips), and align auth with the documented query-param form to secure the account's rate-limit tier.
Output: Query-param auth with public fallback, scrubbed logs, a loud `'auth_failure'` alert on 401/403, and updated tests -- all verified by `vitest` + `tsc`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260526-krq-audit-rugcheck-api-wiring/260526-krq-CONTEXT.md

# Canonical in-repo precedent to MIRROR (query-param auth + catch-block URL scrubbing).
# Read this first -- the new tier2-rugcheck.ts code should look just like it.
@src/safety/checks/tier3-creator.ts

# The shared alert callback type union (add 'auth_failure') and its consumer.
@src/core/fee-estimator.ts
@src/index.ts

# The file to modify and its tests.
@src/safety/checks/tier2-rugcheck.ts
@src/safety/checks/tier2-rugcheck.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add 'auth_failure' to ApiAlertCallback union and map it in the index.ts consumer</name>
  <files>src/core/fee-estimator.ts, src/index.ts</files>
  <behavior>
    - The ApiAlertCallback `type` parameter accepts 'auth_failure' in addition to 'consecutive_failure' and 'rate_limit' (so tier2-rugcheck.ts can pass it without a TS error).
    - In index.ts onApiAlert, a 'auth_failure' type produces severity='error' and alertSource='api' (per CONTEXT.md decision #4: error severity; 'api' is the correct alertSource member for an API auth problem, distinct from 'rateLimit').
    - 'rate_limit' and 'consecutive_failure' mappings are unchanged.
  </behavior>
  <action>
    In `src/core/fee-estimator.ts` (line 11), extend the exported `ApiAlertCallback` type union's second parameter from `'consecutive_failure' | 'rate_limit'` to `'consecutive_failure' | 'rate_limit' | 'auth_failure'`. Do not touch the FeeEstimator class body or its existing 'rate_limit'/'consecutive_failure' alert calls (D-10 work, already committed).

    In `src/index.ts` `onApiAlert` (lines 129-131), update the severity and source derivation so 'auth_failure' is treated as an error-severity API alert. The `severity` line currently reads `type === 'rate_limit' ? 'error' : 'warn'`; change it so BOTH 'rate_limit' AND 'auth_failure' yield `'error'` (the rest still `'warn'`). Leave the `alertSource` line so 'rate_limit' -> 'rateLimit' and everything else (including 'auth_failure') -> 'api'; 'api' is already a valid member of the `alertSource` union (`'detection' | 'rpc' | 'api' | 'rateLimit'`), so no type change is needed there. The `alertStore.insert({ type, ... })` call passes `type` through as `string` (AlertStore.AlertInput.type is `string`), so 'auth_failure' persists without any AlertStore schema change. Keep `severity`/`alertSource` as `as const`-narrowed values so the `botEventBus.emit` SystemAlert payload still type-checks.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>`npx tsc --noEmit` passes. `ApiAlertCallback` in fee-estimator.ts includes `'auth_failure'`. In index.ts, both 'rate_limit' and 'auth_failure' map to severity='error', and 'auth_failure' maps to alertSource='api'.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Switch RugCheck to ?key= query-param auth with public fallback, scrub logs, and emit a loud auth_failure alert on 401/403 (+ update tests)</name>
  <files>src/safety/checks/tier2-rugcheck.ts, src/safety/checks/tier2-rugcheck.test.ts</files>
  <behavior>
    - With a key provided: the fetched URL ends with `?key=<apiKey>` and NO `X-API-KEY` header is sent (mirror tier3-creator's query-param form). The retry fetch uses the same `?key=` URL.
    - With no key (undefined/empty): the fetched URL contains no `?key=` substring (clean public mode) -- it does NOT append `?key=` with an empty value.
    - On HTTP 401 or 403: emit `alertCb?.('rugcheck:report', 'auth_failure', '<message naming RUGCHECK_API_KEY>')`, log at error level, and STILL return `{ pass: true, score: 0, source: 'rugcheck', detail: 'HTTP 401' }` (or 403). pass stays true; this is diagnosability only, not a hard block.
    - Other non-200 (e.g. 500 after retry, 429) behavior is unchanged: still `{ pass: true, score: 0 }`; 429 still fires the existing 'rate_limit' alert; the existing circuit-breaker / consecutive-failure logic still runs.
    - The API key never appears in any log line: the catch-block logs a scrubbed URL (`key=***`) and `err instanceof Error ? err.message : String(err)` instead of the raw `err` object.
    - Successful responses still return inverted score `100 - score_normalised` and the `RugCheckResultData` tuple exactly as before.
  </behavior>
  <action>
    MIRROR `tier3-creator.ts` (lines 152-153, 158, 166, 204-206) for the query-param + scrubbing pattern.

    In `src/safety/checks/tier2-rugcheck.ts`:
    1. Build the URL conditionally. Replace the unconditional `const url = `${RUGCHECK_BASE_URL}/${mint}/report/summary`;` so that when a non-empty `apiKey` is present the URL is `${RUGCHECK_BASE_URL}/${mint}/report/summary?key=${apiKey}`, and when `apiKey` is undefined/empty it is the bare `${RUGCHECK_BASE_URL}/${mint}/report/summary` with no `?key=`. Treat an empty/whitespace-only string as "no key" (e.g. guard on `apiKey` being truthy after trim) per CONTEXT.md decision #2.
    2. Remove the `headers: { 'X-API-KEY': apiKey ?? '' }` option from BOTH the initial `fetch` (lines 86-91) and the retry `fetch` (lines 99-102). The retry must re-fetch the SAME `?key=` URL (the `url` variable already carries the key, so both fetches use it) -- mirror tier3-creator where retry calls `fetch(url, { signal })` with no headers (CONTEXT.md decision #1: "keep the key on both fetches").
    3. Add a 401/403 branch. Before (or within) the existing `if (!response.ok)` block, detect `response.status === 401 || response.status === 403`: log at `log.error` level (not warn) with `{ mint, status }`, and call `alertCb?.('rugcheck:report', 'auth_failure', `RugCheck API key rejected (HTTP ${response.status}) -- check RUGCHECK_API_KEY`)`. Then return the SAME pessimistic shape as the other non-200s: `{ pass: true, score: 0, source: 'rugcheck', detail: `HTTP ${response.status}` }` and `null` for the data tuple. Do NOT change pass to false. The non-401/403 non-200 path keeps its existing `log.warn` + pessimistic return unchanged. (`alertCb` is the already-resolved callback from `onApiAlert ?? _onApiAlert`.)
    4. Scrub the catch block (line 138). Replace `log.warn({ mint, err }, ...)` with a scrubbed log: compute `const safeUrl = url.replace(/key=[^&]+/, 'key=***');` and log `{ mint, url: safeUrl, err: err instanceof Error ? err.message : String(err) }` (mirror tier3-creator line 205-206 exactly; the only delta is the regex token is `key=` not `api-key=`). Keep the catch-block return shape (`timeout_or_error`) unchanged.
    5. Do NOT touch: the endpoint path/host, `RugCheckResponse`/`RugCheckResultData` shapes, the score-inversion math (`100 - score_normalised`), the 429 rate_limit alert, the circuit-breaker / `consecutiveFailures` / `cooldownUntil` logic, or the `finally` metrics block. Those are all verified-correct and out of scope.

    In `src/safety/checks/tier2-rugcheck.test.ts`:
    6. Replace the two `X-API-KEY` header assertions. The test "sends X-API-KEY header when apiKey provided" (lines 91-102) becomes a test that the fetched URL contains `?key=<MOCK_API_KEY>`: assert `(mockFetch.mock.calls[0][0] as string)` matches/contains `key=${MOCK_API_KEY}` (e.g. `.toContain(`key=${MOCK_API_KEY}`)`). Rename it accordingly (e.g. "sends key as ?key= query param when apiKey provided"). The test "handles missing apiKey gracefully (sends empty string header)" (lines 104-116) becomes: with `undefined` key, assert the fetched URL does NOT contain `key=` (e.g. `expect(url).not.toContain('key=')`) while still asserting `result.pass === true` and `result.score === 90`. Rename to reflect public-mode (e.g. "sends no key param in public mode when apiKey omitted").
    7. Add a new test: "emits auth_failure alert and stays pass=true on HTTP 401". Mock fetch to resolve a 401 response (use the existing `mockResponse(401, { error: 'invalid api key' })` helper). Pass a mock `onApiAlert` callback (a `vi.fn()`) into `checkRugCheck(MOCK_MINT, MOCK_API_KEY, signal, undefined, mockAlert)` (the signature is `(mint, apiKey, signal, metricsTracker?, onApiAlert?, apiFailureThreshold?)`). Assert: `result.pass === true`, `result.score === 0`, `result.detail === 'HTTP 401'`, `data === null`, AND `mockAlert` was called with `('rugcheck:report', 'auth_failure', <string containing 'RUGCHECK_API_KEY'>)` (use `expect.stringContaining('RUGCHECK_API_KEY')` for the third arg). Call `_resetCircuitBreaker()` is already handled in `beforeEach`. Note 401 is NOT in the retry set, so fetch is called once.
    8. Keep ALL existing circuit-breaker / retry / score / lpLockedPct tests passing unchanged. The 500-after-retry test still expects 2 fetch calls; the success/clamp/lpLockedPct tests are untouched.
  </action>
  <verify>
    <automated>npx vitest run src/safety/checks/tier2-rugcheck.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>`npx vitest run src/safety/checks/tier2-rugcheck.test.ts` passes (all existing tests green + the two rewritten ?key= assertions + the new 401->auth_failure test). `npx tsc --noEmit` passes. Verified by inspection: (a) the key is appended as `?key=` on both fetches and omitted entirely when no key is set; (b) no `X-API-KEY` header remains; (c) the catch block logs a scrubbed URL and `err.message` (never the raw key or raw err object); (d) the 401/403 branch emits 'auth_failure' at error level AND returns `{ pass: true, score: 0 }`; (e) the score math, endpoint path, schema, 429 handling, and circuit breaker are untouched.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| solsniper -> api.rugcheck.xyz | Outbound HTTP request carrying the RugCheck API key in the URL query string |
| RugCheck response -> safety pipeline | Untrusted JSON parsed into a safety score that influences (but never hard-blocks) trade decisions |
| API key -> logs | Secret (`RUGCHECK_API_KEY`) now travels in the request URL and must never reach a log sink |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-krq-01 | Information Disclosure | `tier2-rugcheck.ts` catch-block log (key now in URL) | mitigate | Scrub URL with `url.replace(/key=[^&]+/, 'key=***')` and log `err.message` (never the raw `err` object or raw URL) -- Task 2 step 4, mirroring tier3-creator.ts:205. |
| T-krq-02 | Spoofing / Tampering | Rejected/expired RugCheck key silently treated as a maximally-risky token | mitigate | 401/403 emits a loud `'auth_failure'` error-severity alert naming `RUGCHECK_API_KEY` so a bad key is visible immediately rather than after the circuit breaker trips -- Task 2 step 3. |
| T-krq-03 | Denial of Service | Auth alert path inadvertently changing safety semantics to hard-block all trades | accept | Invariant enforced in plan + test: every failure path still returns `{ pass: true, score: 0 }`; the auth_failure path is asserted `pass === true` in the new test. No package installs in this task, so the supply-chain (T-*-SC) checkpoint does not apply. |
</threat_model>

<verification>
- `npx vitest run src/safety/checks/tier2-rugcheck.test.ts` -- all tests green (NO `rtk` prefix, per CONTEXT.md decision #5).
- `npx tsc --noEmit` -- whole-project typecheck passes (proves the `ApiAlertCallback` union extension and index.ts mapping compile end-to-end).
- Manual inspection confirms the API key never appears in any log line and that 401/403 returns `pass: true`.
</verification>

<success_criteria>
- RugCheck auth uses the documented `?key=` query param (key on both initial and retry fetch); public mode (no key) sends no `?key=` param. (CONTEXT.md decisions #1, #2)
- The API key is scrubbed from the catch-block log; the raw `err` object is not logged. (CONTEXT.md decision #3)
- HTTP 401/403 emits a loud `'auth_failure'` alert naming `RUGCHECK_API_KEY` at error severity, via the extended `ApiAlertCallback` union and the index.ts consumer mapping. (CONTEXT.md decision #4)
- Safety semantics unchanged: 401/403 (and all other failures) still return `{ pass: true, score: 0 }` -- no hard block. (CONTEXT.md decision #4 invariant)
- Tests updated: `?key=` query-param assertions replace the `X-API-KEY` header assertions, plus a new 401 -> `auth_failure` emission test; existing circuit-breaker/retry/score tests stay green. (CONTEXT.md decision #5)
- Out-of-scope items untouched: endpoint path, response schema, score math, 429 handling, circuit breaker, tier3-creator, Shield Key, and the committed D-10 work.
</success_criteria>

<output>
Create `.planning/quick/260526-krq-audit-rugcheck-api-wiring/260526-krq-SUMMARY.md` when done.
</output>
