---
phase: 06-crash-recovery
plan: 02
subsystem: recovery
tags: [crash-recovery, solana, spl-token, token-2022, vitest, state-machine]

# Dependency graph
requires:
  - phase: 06-crash-recovery
    plan: 01
    provides: getBuyingTrades, getSellingTrades, getMonitoringTrades, getDetectedTrades, transitionById
  - phase: 05-execution-engine
    provides: SellLadder.sell(mint, tokenAmount) with MONITORING→SELLING transition
  - phase: 04-trade-persistence
    provides: TradeStore.transition(), isActive(), createBuyingRecord()
provides:
  - RecoveryManager class with run() returning RecoverySummary
  - RecoverySummary interface (monitoring/sellingResumed/sellingCompleted/buyingRecovered/buyingUnrecovered/detectedDiscarded)
  - index.ts startup ordering: recovery blocks detection start (PER-03, PER-05)
affects: [07-position-management, 08-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fire-and-forget sell re-initiation: step back SELLING→MONITORING then void sellLadder.sell()
    - Per-trade RPC timeout via Promise.race to prevent single slow RPC blocking recovery
    - Dual token program query: getParsedTokenAccountsByOwner for both TOKEN_PROGRAM_ID (legacy) and TOKEN_2022_PROGRAM_ID (pump.fun create_v2) in parallel
    - Startup gate: await recoveryManager.run() before detectionManager.start() in index.ts

key-files:
  created:
    - src/recovery/recovery-manager.ts
    - src/recovery/recovery-manager.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "getParsedTokenAccountsByOwner used for both legacy SPL and Token-2022 (not getTokenAccountsByOwner) — GetTokenAccountsByOwnerConfig type does not accept encoding param; getParsedTokenAccountsByOwner returns typed ParsedAccountData with .parsed typed as any"
  - "RPC failure on SELLING trade counted as sellingCompleted (not a new counter) — fail-safe closed trade is gone from wallet perspective regardless of failure mode"
  - "Valid base58 Solana pubkeys required in tests — PublicKey constructor validates base58 encoding; fake strings like 'mint1' throw before RPC mock is called"
  - "MONITORING trades loaded with no wallet check and no transition() call — already at correct state, only need SellLadder re-arm in Phase 7 (position management)"
  - "Duplicate SELLING dedup uses transitionById for stale rows and transition for current — transition targets by mint+state (ambiguous with duplicates), transitionById targets by id (unambiguous)"

patterns-established:
  - "withTimeout<T>(promise, ms) helper wraps per-trade async operations — consistent timeout handling across SELLING and BUYING recovery"
  - "Valid Solana pubkeys in unit tests — use well-known mainnet addresses (WSOL, USDC, etc.) for any test needing PublicKey construction"

requirements-completed: [PER-03, PER-05]

# Metrics
duration: 10min
completed: 2026-02-27
---

# Phase 06 Plan 02: Crash Recovery — RecoveryManager Summary

**RecoveryManager with 6-state recovery sequence reconciles in-flight trades against on-chain wallet state at startup, querying both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID, with index.ts restructured so detection never starts until recovery completes**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-27T18:28:30Z
- **Completed:** 2026-02-27T18:38:40Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- RecoveryManager.run() implements full 6-step recovery: DETECTED discard, SELLING dedup, SELLING reconcile, BUYING reconcile, MONITORING passthrough, summary return
- On-chain balance check queries both TOKEN_PROGRAM_ID (legacy SPL) and TOKEN_2022_PROGRAM_ID (pump.fun create_v2 Nov 2025+) in parallel via Promise.all
- 16 unit tests covering all decision branches: balance > 0, balance = 0, RPC timeout, duplicate SELLING dedup, mixed scenario, startup ordering (fire-and-forget semantics)
- index.ts startup reordered: recovery at step 10, detectionManager.start() at step 11 — no token events race with recovery
- 162 total tests pass (0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement RecoveryManager class** - `aaba635` (feat)
2. **Task 2: Tests for RecoveryManager** - `4bc3cbb` (test)
3. **Task 3: Wire RecoveryManager into index.ts startup sequence** - `15eaf20` (feat)

## Files Created/Modified
- `src/recovery/recovery-manager.ts` - RecoveryManager class + RecoverySummary interface + withTimeout helper. Full 6-step run() sequence. getWalletTokenBalance() queries both token programs in parallel.
- `src/recovery/recovery-manager.test.ts` - 16 unit tests using mocked TradeStore, SellLadder, and Connection. Uses valid mainnet pubkeys (WSOL, USDC, etc.) to avoid PublicKey constructor validation errors.
- `src/index.ts` - Added PublicKey + RecoveryManager imports. Reordered startup: safetyPipeline before tradeStore, recovery at step 10 (blocking), detectionManager at step 11 (after recovery).

## Decisions Made
- `getParsedTokenAccountsByOwner` used for both legacy SPL and Token-2022 calls (instead of the plan's `getTokenAccountsByOwner` for legacy) — the `GetTokenAccountsByOwnerConfig` type does not accept an `encoding` parameter; `getParsedTokenAccountsByOwner` returns `AccountInfo<ParsedAccountData>` with `.parsed` typed as `any`, allowing direct field access without runtime casts
- RPC failure on a SELLING trade is counted as `sellingCompleted` — the plan's RecoverySummary has no `sellingUnrecovered` counter; treating RPC-failed SELLING as "completed" is consistent with the fail-safe-closed pattern (trade is FAILED in DB regardless)
- Valid base58 Solana pubkeys required for all mint addresses in tests — `new PublicKey('mint1')` throws before the mock RPC is even called, causing all test assertions to fail with "RPC unavailable"

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used getParsedTokenAccountsByOwner for legacy SPL (not getTokenAccountsByOwner with encoding)**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Plan's interface spec shows `getTokenAccountsByOwner(owner, { mint }, { encoding: 'jsonParsed' })` but `GetTokenAccountsByOwnerConfig` type only accepts `{ commitment?, minContextSlot? }` — no `encoding` field
- **Fix:** Used `getParsedTokenAccountsByOwner(owner, { mint })` for both legacy SPL and Token-2022 calls. Same RPC behavior, correct TypeScript types. `ParsedAccountData.parsed` is typed as `any` so no cast needed.
- **Files modified:** src/recovery/recovery-manager.ts
- **Verification:** pnpm tsc --noEmit passes clean
- **Committed in:** aaba635 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - type mismatch in plan's interface spec)
**Impact on plan:** Fix is functionally equivalent — getParsedTokenAccountsByOwner makes the same JSON-parsed RPC call. No behavior change, only correct typing.

## Issues Encountered
- Test mocks using invalid mint strings (e.g. 'mintA') caused all tests to fail with "RECOVERY: RPC unavailable" — PublicKey constructor validates base58 encoding and throws before the mock connection is ever called. Fixed by using real mainnet pubkeys (WSOL, USDC, wrapped ETH, etc.) as test mint addresses.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 6 complete: crash recovery fully implemented (PER-03, PER-05)
- Phase 7 (position management) will call sellLadder.sell() directly for stop-loss/take-profit — RecoveryManager already uses the same fire-and-forget pattern
- MONITORING trades loaded as-is — Phase 7 will need to re-arm SellLadder monitoring for these on recovery if position management uses polling
- No blockers for Phase 7

## Self-Check: PASSED

- src/recovery/recovery-manager.ts: FOUND
- src/recovery/recovery-manager.test.ts: FOUND
- src/index.ts: FOUND
- .planning/phases/06-crash-recovery/06-02-SUMMARY.md: FOUND
- Commit aaba635 (feat RecoveryManager): FOUND
- Commit 4bc3cbb (test RecoveryManager): FOUND
- Commit 15eaf20 (feat index.ts startup): FOUND

---
*Phase: 06-crash-recovery*
*Completed: 2026-02-27*
