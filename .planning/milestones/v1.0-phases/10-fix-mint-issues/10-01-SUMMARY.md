---
phase: 10-fix-mint-issues
plan: "01"
subsystem: safety-pipeline, persistence, execution
tags: [token-2022, jupiter, sell-route, schema-migration, tdd]
dependency_graph:
  requires: []
  provides:
    - Pattern A mint detection (getAccountInfo + unpackMint with detected programId)
    - JupiterRouteError with parsed errorCode for 400 responses
    - Source-aware sell-route skip for pumpportal tokens
    - SafetyResult.programId field for downstream use
    - Trade.source and Trade.tokenProgramId persistence
  affects:
    - src/safety/checks/tier1-authority.ts
    - src/safety/checks/tier1-sell-route.ts
    - src/safety/safety-pipeline.ts
    - src/execution/jupiter-client.ts
    - src/persistence/schema.ts
    - src/persistence/trade-store.ts
    - src/types/index.ts
    - src/index.ts
tech_stack:
  added: []
  patterns:
    - Pattern A (getAccountInfo + unpackMint with owner-detected programId)
    - instanceof TokenAccountNotFoundError for retry (not string matching)
    - JupiterRouteError class with parsed .code for 400 responses
    - Source-aware guard (source === 'pumpportal') in safety check
    - SafetyResult programId threading from Tier 1 to createBuyingRecord
key_files:
  created: []
  modified:
    - src/safety/checks/tier1-authority.ts
    - src/safety/checks/tier1-authority.test.ts
    - src/persistence/schema.ts
    - src/persistence/trade-store.ts
    - src/persistence/trade-store.test.ts
    - src/types/index.ts
    - src/execution/jupiter-client.ts
    - src/execution/jupiter-client.test.ts
    - src/safety/checks/tier1-sell-route.ts
    - src/safety/checks/tier1-sell-route.test.ts
    - src/safety/safety-pipeline.ts
    - src/safety/safety-pipeline.test.ts
    - src/index.ts
decisions:
  - "Pattern A (getAccountInfo + unpackMint) replaces getMint() — owner detection enables Token-2022 support without getMint() programId parameter"
  - "instanceof TokenAccountNotFoundError for retry detection — .message is empty string on these errors; string matching was broken by design"
  - "Return TOKEN_PROGRAM_ID as conservative default programId on error — pessimistic but prevents crashes in downstream ATA lookup"
  - "JupiterRouteError extends Error with .code field — callers can distinguish 400 route errors from 429/5xx without string matching"
  - "source=pumpportal skips sell-route check — pump.fun tokens not indexed by Jupiter at detection time; post-buy verification instead"
  - "programId threaded from checkAuthorities through SafetyResult.programId to createBuyingRecord — single propagation path, no re-detection"
metrics:
  duration_min: 9
  completed_date: "2026-03-02"
  tasks_completed: 2
  files_modified: 13
---

# Phase 10 Plan 01: Token-2022 Fixes, Jupiter Error Parsing, Source/ProgramId Threading Summary

**One-liner:** Token-2022 mints now pass Tier 1 via Pattern A (getAccountInfo + owner-detected unpackMint), Jupiter 400s throw typed JupiterRouteError with parsed errorCode, and pump.fun tokens skip the sell-route check at detection time.

## What Was Built

### Task 1: Pattern A + Schema Migration + TradeStore Source/ProgramId

**tier1-authority.ts** — Core Token-2022 fix:
- Replaced `getMint()` with Pattern A: `getAccountInfo()` → detect owner → `unpackMint(pubkey, info, programId)`
- `info.owner.equals(TOKEN_2022_PROGRAM_ID)` determines which program to pass to `unpackMint`
- Return type changed from `[CheckResult, CheckResult]` to `[CheckResult, CheckResult, PublicKey]` (detected programId as third element)
- `isAccountNotFoundError()` now uses `instanceof TokenAccountNotFoundError` — the `.message` field on these errors is always empty, making string matching unreliable
- Conservative default `TOKEN_PROGRAM_ID` returned on error path

**schema.ts** — Two new columns:
- `source TEXT` and `token_program_id TEXT` added to CREATE TABLE
- `MIGRATION_SQL` array with ALTER TABLE statements for existing databases
- Migration runs in try-catch (no-op if columns already exist)

**types/index.ts** — Two interface updates:
- `Trade.source?: string` and `Trade.tokenProgramId?: string` fields
- `SafetyResult.programId?: string` field (base58 pubkey string from checkAuthorities)

**trade-store.ts** — Full source/tokenProgramId support:
- `createBuyingRecord(mint, source?, tokenProgramId?)` — optional new params stored in INSERT
- `transition()` extra params extended to include `source?` and `tokenProgramId?`
- All SELECT queries include `source, token_program_id` columns
- `mapRow()` maps new columns to `source` and `tokenProgramId` Trade fields
- New `getTradeByMint(mint): Trade | undefined` method for sell ladder lookup

### Task 2: Jupiter 400 Error Parsing, Sell-Route Source Skip, Pipeline Threading

**jupiter-client.ts** — Typed 400 errors:
- `JupiterRouteError` class exported with `code: string | undefined` property
- `quote()` and `swap()` handle HTTP 400 specifically: parse JSON body for `errorCode`, throw `JupiterRouteError` with parsed code
- Non-200/429/400 errors still throw generic `Error`

**tier1-sell-route.ts** — Source-aware skip:
- Added `source?: DetectionSource` third parameter to `checkSellRoute()`
- `source === 'pumpportal'` returns early with `pass: true, detail: 'skipped for pumpportal (post-buy verification)'`
- Raydium/pumpswap/undefined sources run the Jupiter quote check as before

**safety-pipeline.ts** — Source and programId threading:
- `checkSellRoute()` called with `event.source` as third argument
- `checkAuthorities()` result destructured as `[mintAuthResult, freezeAuthResult, detectedProgramId]`
- `buildSafetyResult()` signature extended with optional `programId?: string` parameter
- All four `buildSafetyResult()` call sites pass `detectedProgramId?.toBase58()`

**index.ts** — Call site update:
- `createBuyingRecord(event.mint)` → `createBuyingRecord(event.mint, event.source, result.programId)`
- Source and tokenProgramId stored from detection time in SQLite

## Test Results

- 216 tests pass (20 test files)
- 0 failures, 0 regressions
- New tests added:
  - tier1-authority.test.ts: 8 tests (Token-2022, legacy SPL, instanceof retry, non-retryable errors)
  - trade-store.test.ts: 7 tests (source/tokenProgramId storage, getTradeByMint)
  - jupiter-client.test.ts: 4 tests (JupiterRouteError on 400, non-JSON body, 500 not JupiterRouteError, instanceof)
  - tier1-sell-route.test.ts: 3 tests (pumpportal skip, raydium runs, undefined runs)
  - safety-pipeline.test.ts: 2 tests (source threading to checkSellRoute, programId in SafetyResult)

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 1941070 | feat(10-01): fix tier1-authority Pattern A, schema migration, TradeStore source/programId |
| 2 | 5d15c41 | feat(10-01): Jupiter 400 error parsing, sell-route source skip, safety-pipeline programId threading |

## Self-Check: PASSED

All 9 key files verified present. Both commits (1941070, 5d15c41) confirmed in git log.
216 tests passing across 20 test files.
