---
status: complete
phase: 17-security-fixes
source: [17-01-SUMMARY.md, 17-02-SUMMARY.md, 17-03-SUMMARY.md]
started: 2026-03-27T17:00:00Z
updated: 2026-03-27T17:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. ESLint Security Lint Passes
expected: Run `pnpm lint:security`. ESLint exits clean (exit code 0) with no violations reported. Both custom rules (no-sql-template-literals, no-api-key-in-url) are active.
result: PASS

### 2. Helius API Key Uses Header Auth
expected: The Helius API call in tier3-creator.ts sends the API key via `X-Api-Key` header instead of a `?api-key=` URL query parameter. Running the tier3-creator test (`pnpm vitest run src/safety/checks/tier3-creator.test.ts`) passes, including the SEC-02 test verifying header-based auth.
result: pass

### 3. Config PATCH Rejects Invalid Shape
expected: Sending a PATCH to `/api/config` with an invalid field type (e.g., a string where a number is expected) returns HTTP 400 with a human-friendly error message describing the validation failure.
result: pass

### 4. Config PATCH Rejects Bad Safety Weights
expected: Sending a PATCH to `/api/config` with safety weights that don't sum to 100 (e.g., `{safety: {weights: {liquidity: 50, holder: 20, age: 10}}}`) returns HTTP 400 with a semantic validation error about weights not summing to 100.
result: pass

### 5. Config Rollback After Failed Validation
expected: After a rejected PATCH request, the runtime config remains unchanged — the invalid values are not applied. The structuredClone snapshot rollback restores the pre-patch state.
result: skipped

### 6. Dependency Audit Clean
expected: Running `pnpm audit` shows only the accepted bigint-buffer HIGH vulnerability. No other high or critical vulnerabilities remain. Previously reported picomatch HIGH and brace-expansion MODERATE are resolved via pnpm overrides.
result: pass

### 7. All Tests Pass
expected: Running `pnpm vitest run` passes all tests (314+ existing + 7 new config validation tests + SEC-02 header test). No regressions introduced by security changes.
result: pass

### 8. BUGS.md Documents All Findings
expected: BUGS.md exists at project root with resolution status for all 4 original security findings (SEC-01 through SEC-04). Each finding shows RESOLVED status with details of how it was fixed.
result: pass

## Summary

total: 8
passed: 7
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none yet]
