---
phase: 17-security-fixes
verified: 2026-03-27T16:45:00Z
status: gaps_found
score: 6/8 must-haves verified
gaps:
  - truth: "ESLint custom rules prevent future regressions for both SQL injection and API key exposure patterns"
    status: failed
    reason: "ESLint (10.1.0) is listed in package.json devDependencies and pnpm-lock.yaml but is NOT installed in node_modules. The pnpm virtual store (.pnpm/) has 312 packages but contains no eslint or typescript-eslint entries. `pnpm lint:security` exits with 'eslint not found'. The rule source files exist (eslint-rules/no-sql-template-literals.js, eslint-rules/no-api-key-in-url.js, eslint.config.js) but cannot be invoked."
    artifacts:
      - path: "eslint-rules/no-sql-template-literals.js"
        issue: "File exists and is correct, but eslint binary is not installed"
      - path: "eslint-rules/no-api-key-in-url.js"
        issue: "File exists and is correct, but eslint binary is not installed"
      - path: "eslint.config.js"
        issue: "File exists and correctly wires both rules, but eslint binary is not installed"
    missing:
      - "Run `pnpm install` to install missing devDependencies (eslint@10.1.0, typescript-eslint@8.57.2 not present in node_modules/.pnpm/)"
  - truth: "REQUIREMENTS.md traceability table reflects completed requirements"
    status: failed
    reason: "REQUIREMENTS.md checkbox list still shows SEC-03 and SEC-04 as [ ] (Pending) even though both were completed. Traceability table shows SEC-03 as Pending and SEC-04 as Pending. Only SEC-01 and SEC-02 were updated to [x] / Complete."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Lines 14-15: SEC-03 and SEC-04 show [ ] instead of [x]. Lines 87-88: traceability shows Pending instead of Complete."
    missing:
      - "Update SEC-03 checkbox to [x] in REQUIREMENTS.md"
      - "Update SEC-04 checkbox to [x] in REQUIREMENTS.md"
      - "Update SEC-03 traceability row to Complete"
      - "Update SEC-04 traceability row to Complete"
human_verification:
  - test: "ESLint rules catch SQL injection patterns"
    expected: "Running `pnpm lint:security` on a test file with a template literal inside .prepare() reports an error from security/no-sql-template-literals"
    why_human: "ESLint not installed -- cannot verify rule execution without completing the installation gap"
  - test: "ESLint rules catch API key in URL patterns"
    expected: "Running `pnpm lint:security` on a test file with ?api-key= in a string reports an error from security/no-api-key-in-url"
    why_human: "ESLint not installed -- cannot verify rule execution without completing the installation gap"
---

# Phase 17: Security Fixes Verification Report

**Phase Goal:** Bot has no known security vulnerabilities -- SQL injection risk resolved, API keys secured, config validation airtight, dependency audit clean
**Verified:** 2026-03-27T16:45:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All SQL queries use parameterized placeholders -- no template literal interpolation touches user input | VERIFIED | 14 prepared statements in trade-store.ts use `@named` params. Line 100 template literal generates `?` placeholders from hardcoded array `NON_TERMINAL_STATES.map(() => '?')` -- no user input. `eslint-disable` comment documents justification. |
| 2 | Helius API key is passed via X-Api-Key header, never in URL query parameters | VERIFIED | `tier3-creator.ts:117` -- `headers: { 'X-Api-Key': heliusApiKey }`. URL at line 112 has no `api-key=`. `grep -rn "api-key=" src/` finds only the masking function in rpc-manager.ts (sanitizing logs, not constructing URLs). Test at line 184 in tier3-creator.test.ts asserts key is in header and NOT in URL. |
| 3 | ESLint custom rules prevent future regressions for SQL injection and API key exposure | FAILED | Rule source files exist and are correct, but `eslint` binary is not installed in node_modules. `pnpm lint:security` exits with error. See Gaps section. |
| 4 | Existing tier3-creator tests pass with the new header-based auth | VERIFIED | `pnpm exec vitest run` -- 322 tests pass including tier3-creator.test.ts (10 tests). |
| 5 | Dashboard PATCH /api/config rejects patches that would produce an invalid merged config | VERIFIED | config.ts:99-106 -- `TradingConfigSchema.safeParse(merged)` on the merged result, returns 400 + rollback on failure. |
| 6 | Invalid patches do NOT mutate the runtime config -- rollback restores previous state | VERIFIED | config.ts:93 -- `structuredClone(getRuntimeConfig())` snapshot. config.ts:101 -- `restoreRuntimeConfig(snapshot)` on Layer 2 failure. config.ts:111 -- `restoreRuntimeConfig(snapshot)` on Layer 3 failure. config.test.ts rollback test passes. |
| 7 | `pnpm audit --audit-level high` reports zero high/critical vulnerabilities except the unfixable bigint-buffer | VERIFIED | `pnpm audit --audit-level high` outputs exactly 1 vulnerability: bigint-buffer HIGH with `patched: <0.0.0` (no fix exists). All other high/moderate vulns resolved via overrides (picomatch, brace-expansion) and upgrade (fastify 5.8.4). |
| 8 | BUGS.md reflects resolution status for all 4 original security findings | VERIFIED | BUGS.md line 1: "Security Audit Status: ALL FINDINGS RESOLVED (Phase 17, 2026-03-27)". All 4 findings have RESOLVED status with commit hashes, resolution detail, and accepted-risk rationale for bigint-buffer. |

**Score:** 6/8 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `eslint.config.js` | ESLint flat config with TypeScript parser and 2 custom security rules | ORPHANED | File exists (35 lines), correctly imports both rules, registers them as `security/no-sql-template-literals` and `security/no-api-key-in-url` as errors. But ESLint binary not installed -- file cannot be executed. |
| `eslint-rules/no-sql-template-literals.js` | Custom ESLint rule flagging template literals with expressions inside SQL methods | ORPHANED | File exists (35 lines), contains `SQL_METHODS` set, correct AST visitor pattern. Substantive and correct. Cannot be invoked due to missing ESLint installation. |
| `eslint-rules/no-api-key-in-url.js` | Custom ESLint rule flagging api-key/api_key patterns in string literals | ORPHANED | File exists (38 lines), contains `apiKeyInUrl` message, correct regex `/[?&](api[-_]?key)=/i`. Substantive and correct. Cannot be invoked due to missing ESLint installation. |
| `src/safety/checks/tier3-creator.ts` | Helius API call using X-Api-Key header instead of query parameter | VERIFIED | Line 112: URL has no api-key. Line 117: `headers: { 'X-Api-Key': heliusApiKey }`. safeUrl masking code removed (no longer needed). |
| `src/dashboard/routes/config.ts` | Config PATCH endpoint with 3-layer validation | VERIFIED | Lines 44-68: `formatZodErrors` and `validateSemantics` helpers. Lines 83-116: Layer 1 (ConfigPatchSchema), Layer 2 (TradingConfigSchema.safeParse(merged)), Layer 3 (validateSemantics). Rollback on Layer 2 and Layer 3 failures. |
| `src/config/trading.ts` | Exported TradingConfigSchema + restoreRuntimeConfig | VERIFIED | Line 85: `export const TradingConfigSchema`. Line 134: `export function restoreRuntimeConfig`. |
| `src/dashboard/routes/config.test.ts` | Test suite covering all 3 validation layers, rollback, error formatting | VERIFIED | 7 tests, all pass: valid update (200), invalid shape (400), semantic weight sum (400), semantic TP pct (400), rollback after rejection, unknown key stripping (200), human-friendly error format. |
| `package.json` | pnpm overrides for picomatch and brace-expansion, upgraded fastify | VERIFIED | Lines 57-61: overrides for `picomatch@<2.3.2`, `picomatch@>=4.0.0 <4.0.4`, `brace-expansion@>=4.0.0 <5.0.5`. fastify at `^5.8.4`. Lockfile confirms overrides applied and fastify at 5.8.4. |
| `BUGS.md` | Updated security audit with per-finding resolution status | VERIFIED | All 4 findings marked RESOLVED with commit hashes, resolution detail, and accepted-risk rationale. False positives section preserved. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `eslint.config.js` | `eslint-rules/no-sql-template-literals.js` | inline plugin import | ORPHANED | Import exists at line 2, rule registered at lines 24/30. But eslint binary not installed -- link is never exercised. |
| `eslint.config.js` | `eslint-rules/no-api-key-in-url.js` | inline plugin import | ORPHANED | Import exists at line 3, rule registered at lines 25/31. But eslint binary not installed -- link is never exercised. |
| `src/safety/checks/tier3-creator.ts` | Helius Enhanced TX API | fetch with X-Api-Key header | VERIFIED | Line 115-118: `fetch(url, { signal, headers: { 'X-Api-Key': heliusApiKey } })`. API key in header, not URL. |
| `src/dashboard/routes/config.ts` | `src/config/trading.ts` | import TradingConfigSchema, restoreRuntimeConfig | VERIFIED | Line 3: `import { TradingConfigSchema, getRuntimeConfig, patchRuntimeConfig, restoreRuntimeConfig }`. |
| `src/dashboard/routes/config.ts` | `TradingConfigSchema.safeParse(merged)` | merged result validation | VERIFIED | Line 99: `const mergedResult = TradingConfigSchema.safeParse(merged)`. |
| `package.json pnpm.overrides` | `pnpm-lock.yaml` | pnpm install regenerates lockfile | VERIFIED | Lockfile lines: `picomatch@<2.3.2: 2.3.2`, `picomatch@>=4.0.0 <4.0.4: 4.0.4`, `brace-expansion@>=4.0.0 <5.0.5: 5.0.5`. |

---

### Data-Flow Trace (Level 4)

Not applicable -- this phase produces security hardening logic (validation, lint rules, dependency fixes), not data-rendering components.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All tests pass (full suite) | `pnpm test` | 27 test files, 322 tests, 0 failures | PASS |
| Config validation tests pass | `pnpm exec vitest run src/dashboard/routes/config.test.ts` | 7/7 pass | PASS |
| pnpm audit --audit-level high shows only bigint-buffer | `pnpm audit --audit-level high` | "1 vulnerabilities found -- Severity: 1 high" -- bigint-buffer only | PASS |
| ESLint security rules invocable | `pnpm lint:security` | "'eslint' is not recognized" -- binary not installed | FAIL |
| Helius URL has no api-key= query param | `grep "api-key=" src/safety/checks/tier3-creator.ts` | No matches | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEC-01 | 17-01 | SQL injection risk in trade-store.ts audited and either fixed or documented as safe | SATISFIED | All 14 prepared statements use `@named` params. Line 100 is false positive (hardcoded array). ESLint rule created as regression guard (though not currently invocable). |
| SEC-02 | 17-01 | Helius API key passed via header instead of URL query parameter | SATISFIED | `X-Api-Key` header used at line 117. URL at line 112 contains no credentials. Note: REQUIREMENTS.md says "Authorization header" -- actual implementation uses `X-Api-Key` per Helius API design (documented in RESEARCH.md as correction to D-05). Goal achieved. |
| SEC-03 | 17-02 | Dashboard config PATCH endpoint validates merged result against full TradingConfigSchema before applying | SATISFIED | 3-layer validation at config.ts lines 83-116. TradingConfigSchema.safeParse(merged) at line 99. Rollback at lines 101 and 111. 7 tests all pass. |
| SEC-04 | 17-03 | All high/moderate dependency vulnerabilities resolved or documented with justification | SATISFIED | pnpm audit: picomatch, brace-expansion, fastify all resolved. bigint-buffer HIGH documented as accepted risk (no patched version, low real-world risk rationale in BUGS.md). |

**REQUIREMENTS.md documentation gap:** SEC-03 and SEC-04 are marked `[ ]` (Pending) in REQUIREMENTS.md even though both are complete. The traceability table also shows them as Pending. SEC-01 and SEC-02 are correctly marked `[x]` / Complete. This is a documentation-only gap -- no code is missing.

**ORPHANED REQUIREMENTS (Phase 17):** None found beyond SEC-01 through SEC-04.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.planning/REQUIREMENTS.md` | 14-15, 87-88 | SEC-03, SEC-04 checkboxes not updated | Warning | Documentation inconsistency -- traceability shows work as incomplete when it is done |
| `eslint-rules/*.js` + `eslint.config.js` | - | ESLint binary not installed | Blocker | Regression-prevention lint rules are non-functional. Any developer can introduce SQL injection or API key in URL patterns without triggering a lint error. |

---

### Human Verification Required

#### 1. ESLint Rule Functionality

**Test:** After running `pnpm install` to complete ESLint installation, run `pnpm lint:security`.
**Expected:** Zero violations (existing codebase should be clean). Then add a test file with `db.prepare(\`SELECT * FROM t WHERE x = ${userInput}\`)` and verify the lint reports a violation.
**Why human:** ESLint binary not installed -- cannot verify rule execution in current state.

#### 2. ESLint API Key Rule Catches RPC URL Pattern

**Test:** Verify the RPC URL pattern (`?api-key=` inside `@solana/web3.js Connection` constructor) does NOT trigger the `no-api-key-in-url` rule (it's in a third-party pattern and is an accepted exception per RESEARCH.md line 116).
**Expected:** ESLint should not flag the RPC URL usage since it's not in `src/` source strings -- or if it does flag it, an `eslint-disable` comment should be present.
**Why human:** ESLint not installed. Also requires contextual judgment about whether the RPC URL handling is an acceptable exception.

---

### Gaps Summary

Two gaps block a full pass:

**Gap 1 -- ESLint not installed (Blocker):** ESLint 10.1.0 is declared in `package.json` devDependencies and appears in `pnpm-lock.yaml`, but neither the `eslint` binary nor any eslint packages appear in `node_modules/.pnpm/` (312 packages present, none are eslint or typescript-eslint). Running `pnpm install` should resolve this. The rule source files (`eslint-rules/no-sql-template-literals.js`, `eslint-rules/no-api-key-in-url.js`, `eslint.config.js`) are all correct and complete -- they just cannot be invoked.

**Gap 2 -- REQUIREMENTS.md not updated (Warning):** SEC-03 and SEC-04 remain marked as `[ ]` Pending in REQUIREMENTS.md (lines 14-15) and as Pending in the traceability table (lines 87-88). This is documentation-only -- the code implementing both requirements is complete and tested. Running the `/gsd:mark-complete` flow or manually updating the checkboxes would close this.

**What is working (6/8 truths):**
- SQL parameterization confirmed across all 14 prepared statements (SEC-01 code goal achieved)
- Helius API key migrated to `X-Api-Key` header, zero api-key= URLs in production code (SEC-02 achieved)
- 3-layer config validation (shape, merged schema, semantic) with rollback -- all 7 tests pass (SEC-03 achieved)
- pnpm audit clean except bigint-buffer (unfixable, documented) -- overrides and fastify upgrade working (SEC-04 achieved)
- Full test suite: 27 files, 322 tests, 0 failures
- BUGS.md documents all 4 findings as RESOLVED with commit hashes and rationale

---

_Verified: 2026-03-27T16:45:00Z_
_Verifier: Claude (gsd-verifier)_
