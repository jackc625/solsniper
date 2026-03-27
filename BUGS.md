Security Audit Status: ALL FINDINGS RESOLVED (Phase 17, 2026-03-27)

---

# Ship-Safe Audit Results

Original audit score: 33/100 (F) -- largely driven by false positives from tool misunderstanding the project context (trading bot flagged as AI agent, test keys flagged as secrets, legitimate packages flagged as typosquats).

Out of 24 total findings, 4 were real issues worth investigating and ~20 were false positives. All 4 real findings have been resolved in Phase 17.

---

## Real Findings (4/4 RESOLVED)

### Finding 1: SQL injection via template literal (trade-store.ts:100)

| Field | Value |
|-------|-------|
| Status | **RESOLVED -- False Positive Confirmed** |
| Phase | 17, Plan 01 |
| Commit | 98f7f19 |

**Resolution:** Full codebase SQL audit confirmed all 14 prepared statements in trade-store.ts use `@named` parameters. The flagged line 100 generates `?` placeholders from `NON_TERMINAL_STATES.map(() => '?')` -- a hardcoded array with no user input. Additional SQL in schema.ts (static DDL strings) and trades.ts (static prepared statements) also confirmed safe.

**Regression guard:** ESLint custom rule `security/no-sql-template-literals` added to flag template literals with interpolation inside `.prepare()`, `.run()`, `.exec()`, `.all()`, `.get()` method calls.

**Files audited:** `src/persistence/trade-store.ts`, `src/persistence/schema.ts`, `src/dashboard/routes/trades.ts`

---

### Finding 2: API key in URL query param (tier3-creator.ts:112)

| Field | Value |
|-------|-------|
| Status | **RESOLVED -- Fixed** |
| Phase | 17, Plan 01 |
| Commit | 120d8f8 |

**Resolution:** Helius API key migrated from `?api-key=` query parameter to `X-Api-Key` request header. URL no longer contains credentials. `safeUrl` masking code removed (no longer needed since key is not in URL). New test verifies API key is in header and not in URL.

**Regression guard:** ESLint custom rule `security/no-api-key-in-url` added to flag `?api-key=` or `?api_key=` patterns in string literals and template literals.

**Full fetch() audit:** All other API calls (Jupiter, RugCheck, PumpPortal, Jito, RPC) confirmed safe -- keys already in headers or no auth required. RPC URLs use standard `@solana/web3.js` Connection pattern with existing `maskUrl()` sanitization in logs.

**Files modified:** `src/safety/checks/tier3-creator.ts`, `src/safety/checks/tier3-creator.test.ts`

---

### Finding 3: No request body validation (config.ts:42)

| Field | Value |
|-------|-------|
| Status | **RESOLVED -- Fixed** |
| Phase | 17, Plan 02 |
| Commits | 0d89979, 5bb3e6b |

**Resolution:** Config PATCH endpoint now has 3-layer validation:
1. **Shape validation:** Patch body validated against ConfigPatchSchema
2. **Merged validation:** After applying patch, merged result validated against full TradingConfigSchema
3. **Cross-field semantic checks:** Safety weights must sum to 100, tiered TP percentages must sum to <= 100%

Invalid patches trigger rollback to previous config via `restoreRuntimeConfig()` using `structuredClone` snapshot taken before mutation. Zod validation errors formatted as human-friendly strings. Comprehensive 7-test suite covering all validation layers.

**Files modified:** `src/dashboard/routes/config.ts`, `src/config/trading.ts`
**Files created:** `src/dashboard/routes/config.test.ts`

---

### Finding 4: Dependency vulnerabilities (package.json)

| Field | Value |
|-------|-------|
| Status | **RESOLVED -- Fixed (1 accepted risk)** |
| Phase | 17, Plan 03 |
| Commit | cb9c42a |

**Resolution:**
- **Fastify** upgraded from 5.8.1 to 5.8.4 (fixes moderate X-Forwarded-Proto/Host spoofing CVE)
- **Picomatch** HIGH/MODERATE resolved via pnpm overrides (forced to 2.3.2 and 4.0.4)
- **Brace-expansion** MODERATE resolved via pnpm override (forced to 5.0.5)

**Accepted risk -- bigint-buffer HIGH:**
- No patched version exists (`patched: <0.0.0` -- maintainer has not released a fix)
- spl-token 0.4.14 is the latest version with no upgrade path (no 0.5.x exists)
- Vulnerability is a buffer overflow in `toBigIntLE()` -- exploitable only if untrusted input is passed
- In this codebase, bigint-buffer is used by `@solana/buffer-layout-utils` for deserializing on-chain data from RPC responses -- NOT user input
- **Real-world risk: LOW** for this use case
- No pnpm override possible (no fixed version exists)

**Verification:** `pnpm audit` shows only bigint-buffer remaining. All other vulnerabilities resolved.

---

## Almost Certainly False Positives

| Finding | Why it's false |
|---------|----------------|
| SSRF on jupiter-client, rugcheck, creator | URLs constructed from config/constants, not user input. Tool flagged any fetch() with a variable URL |
| Private keys in test files | Test files use dummy/hardcoded keys for unit testing -- standard practice, not a leak |
| "preact" typosquat of "react" | Preact is a legitimate, well-known framework -- not a typosquat |
| No .npmrc scope registry | Only relevant for private registries; all @solana, @fastify, @preact packages are public npm packages |
| AGENT_OUTPUT_TO_ACTION (5 hits in trade-store) | This is a trading bot, not an LLM agent -- the AI/LLM security category is entirely inapplicable |
| AGENT_MEMORY_NO_EXPIRY, RAG_EXCESSIVE_CONTEXT | Tool misidentified SQLite persistence and config as "AI agent memory/RAG" |
| PII_GEOLOCATION_STORAGE | Flagged in test files -- likely matching on numeric values that look like coordinates |
| SSRF_INTERNAL_IP (index.ts, dashboard-server) | 0.0.0.0 / 127.0.0.1 used for local server binding -- completely standard |
| File upload type check | Flagged in a test file, not production code |

---

## Summary

Out of 24 total findings, 4 were real issues and ~20 were false positives from the tool misunderstanding the project context. All 4 real findings have been resolved in Phase 17 (2026-03-27) across 3 plans:

- **Plan 01:** ESLint security rules + Helius API key migration (SEC-01, SEC-02)
- **Plan 02:** Config PATCH 3-layer validation with rollback (SEC-03)
- **Plan 03:** Dependency vulnerability resolution via upgrades and overrides (SEC-04)
