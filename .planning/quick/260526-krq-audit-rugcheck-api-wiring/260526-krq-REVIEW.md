---
phase: quick-260526-krq-audit-rugcheck-api-wiring
reviewed: 2026-05-26T15:36:00Z
depth: quick
files_reviewed: 4
files_reviewed_list:
  - src/core/fee-estimator.ts
  - src/index.ts
  - src/safety/checks/tier2-rugcheck.ts
  - src/safety/checks/tier2-rugcheck.test.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Quick Task 260526-krq: Code Review Report

**Reviewed:** 2026-05-26T15:36:00Z
**Depth:** quick
**Files Reviewed:** 4
**Status:** issues_found (1 warning, 1 info — both latent/minor; the core fix is sound)

## Summary

The RugCheck API wiring fix is correct and meets every locked decision in CONTEXT.md. I verified the five highest-priority concerns directly:

1. **Secret leakage (highest priority) — CLEAN.** The raw `url` (carrying `?key=<uuid>`) is referenced in exactly three places: the two `fetch()` calls and the scrubbed `safeUrl` derivation. It is never logged raw, never passed to `mt.record()` (which uses the static label `'rugcheck:report'`), and never passed to `alertCb` (alert messages are static strings). The catch block logs `err.message` only — I empirically confirmed Node/undici's fetch produces generic messages (`"fetch failed"` for connection errors, `"This operation was aborted"` for AbortError/timeout) that contain neither the URL nor the key. The scrubbing regex `key=[^&]+` correctly redacts the real URL shape (verified: output is `...summary?key=***`, `includes(key) === false`).
2. **Safety invariant — CLEAN.** Every failure path (401/403, non-200, 429, timeout/error, circuit-breaker-open) returns `{ pass: true, score: 0 }` (or higher). No path returns `pass: false` and no path throws. The new 401/403 branch sets `success = response.ok` (false) at line 104 *before* its early return at line 118, so the `finally` circuit-breaker correctly counts it as a failure.
3. **URL correctness — CLEAN.** `?key=` is the only query param; the path `/report/summary` carries no pre-existing query string to collide with. Both the initial fetch (line 91) and the retry fetch (line 100) use the same authed `url`. 401/403 is correctly excluded from the retry set (only 429 and ≥500 retry), so no double-fetch on auth failure — matching the test's `toHaveBeenCalledOnce()`.
4. **Empty/whitespace key — CLEAN.** `apiKey?.trim()` yields `undefined` (undefined input) or `''` (empty/whitespace), both falsy, so the ternary selects the no-`key=` public-mode URL. Never emits `?key=` with an empty value. Covered by the "public mode" test.
5. **auth_failure wiring — CLEAN.** Union extended in `fee-estimator.ts`; emitted in `tier2-rugcheck.ts:116`; consumer in `index.ts:130` maps it to `severity='error'`. `tsc --noEmit` passes clean across the whole project; all 9 rugcheck tests pass. `AlertInput.type` is a plain `string`, so `'auth_failure'` persists to SQLite without a schema change.

The two findings below are latent/minor and do not block shipping.

## Warnings

### WR-01: API key interpolated into URL without `encodeURIComponent` — breaks scrubbing if a key ever contains `&`

**File:** `src/safety/checks/tier2-rugcheck.ts:85` (and the scrub at `:153`)
**Issue:** `trimmedKey` is interpolated raw into the query string: `...summary?key=${trimmedKey}`. For the current key (a bare 36-char UUID, per the verified audit) this is safe. But it is unvalidated input from `.env`, and if a future key ever contained a `&` mid-string, two things break:
1. The URL would split into a spurious second query param, sending a truncated key.
2. **More importantly for secret hygiene:** the scrub regex `key=[^&]+` stops at the first `&`, so only the prefix up to that `&` would be redacted — the tail of the key would leak into the log as if it were a separate param value.

This is a defense-in-depth gap, not an active bug (the real key is `&`-free). Note the mirrored precedent in `tier3-creator.ts:153` has the identical pattern, so this is consistent with the repo — but consistency does not make it safe for arbitrary future keys.
**Fix:** URL-encode the key so the scrub invariant holds for any key value:
```ts
const url = trimmedKey
  ? `${RUGCHECK_BASE_URL}/${mint}/report/summary?key=${encodeURIComponent(trimmedKey)}`
  : `${RUGCHECK_BASE_URL}/${mint}/report/summary`;
```
`encodeURIComponent` percent-encodes `&`/`#`/whitespace, guaranteeing the key occupies a single `[^&]+` run that the existing scrub fully redacts. (Consider applying the same to `tier3-creator.ts` for parity, though that file is out of scope here.)

## Info

### IN-01: `auth_failure` alertSource resolves to `'api'`, not `'rateLimit'` — minor deviation from CONTEXT wording

**File:** `src/index.ts:131`
**Issue:** CONTEXT decision #4 says `'auth_failure'` should map "to `severity='error'` (treat like `rate_limit` for severity/source)." The severity mapping was updated correctly (line 130), but the `alertSource` line was not: `const alertSource = type === 'rate_limit' ? 'rateLimit' : 'api'` leaves `auth_failure` falling through to `'api'`. So an auth failure is tagged `severity=error, alertSource=api` rather than `alertSource=rateLimit`.

This is harmless and arguably *more* semantically correct — an auth failure genuinely belongs to the `api` subsystem, not rate-limiting — and `'api'` is a valid member of the `alertSource` union (`'detection' | 'rpc' | 'api' | 'rateLimit'`). Flagging only because it diverges from the literal CONTEXT instruction; confirm the `'api'` tag is intended for the dashboard's alert-origin filtering.
**Fix:** No code change required if `alertSource='api'` is acceptable for dashboard categorization (recommended). If strict CONTEXT adherence is desired:
```ts
const alertSource = type === 'rate_limit' || type === 'auth_failure' ? 'rateLimit' as const : 'api' as const;
```

---

_Reviewed: 2026-05-26T15:36:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
