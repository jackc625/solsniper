---
phase: 05-execution-engine
plan: 01
subsystem: execution
tags: [solana, web3, broadcaster, rpc, transaction, zod]

# Dependency graph
requires:
  - phase: 04-trade-persistence
    provides: Trade, TradeState types and SQLite store (needed for execution result recording)
  - phase: 01-foundation-operations
    provides: RpcManager with Connection management, logger, config system
provides:
  - broadcastAndConfirm() — blockhash-last signing, parallel multi-RPC broadcast, confirmation polling
  - ExecutionConfigSchema — buy/sell execution tuning parameters in TradingConfig
  - SellStep, BroadcastResult, BuyResult, SellResult types
  - RpcManager.getAllConnections() — exposes both RPC connections for parallel broadcast
affects:
  - 05-02 (buy executor builds on broadcastAndConfirm)
  - 05-03 (sell ladder builds on broadcastAndConfirm)
  - future phases that need execution config values

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Blockhash-last: fetch blockhash immediately before tx.sign() — never pre-fetch"
    - "Promise.allSettled parallel broadcast: fire to all RPCs, pick first fulfilled"
    - "skipPreflight=true, maxRetries=0: Jupiter pre-simulates; we retry with fresh blockhash ourselves"
    - "Zod nested sub-schemas: ExecutionBuyConfigSchema + ExecutionSellConfigSchema under ExecutionConfigSchema"

key-files:
  created:
    - src/execution/broadcaster.ts
    - src/execution/broadcaster.test.ts
  modified:
    - src/types/index.ts
    - src/config/trading.ts
    - src/core/rpc-manager.ts
    - config.json
    - src/detection/detection-manager.test.ts
    - src/safety/safety-pipeline.test.ts

key-decisions:
  - "Blockhash fetched from connections[0] only — single round-trip; all connections will accept any valid blockhash"
  - "Promise.allSettled picks first fulfilled result — partial RPC failure is non-fatal"
  - "skipPreflight=true, maxRetries=0 on sendRawTransaction — caller handles retry with fresh blockhash"
  - "confirmTransaction uses connections[0] — signature is chain-global; any RPC can confirm it"
  - "ExecutionConfig uses Zod .default() values — config.json section can be partially or fully omitted without breaking schema"

patterns-established:
  - "Broadcaster pattern: obtain tx (deserialized) → fetch blockhash → sign → parallel send → confirm"
  - "Mock Connection pattern: vi.fn() stubs on getLatestBlockhash/sendRawTransaction/confirmTransaction"
  - "VersionedTransaction stub: { message: { recentBlockhash: '' }, sign: vi.fn(), serialize: vi.fn() }"

requirements-completed: [EXE-04, EXE-05, EXE-08]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 05 Plan 01: Execution Foundation — Types, Config, and Broadcaster Summary

**Shared broadcast primitive with blockhash-last signing and Promise.allSettled multi-RPC parallel send using @solana/web3.js VersionedTransaction**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T16:50:02Z
- **Completed:** 2026-02-27T16:54:18Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Built `broadcastAndConfirm()` implementing EXE-04 (blockhash last), EXE-05 (parallel broadcast), EXE-08 (fresh blockhash per attempt)
- Added `ExecutionConfigSchema` with full buy/sell sub-schemas to `TradingConfigSchema` and `config.json`
- Added `SellStep`, `BroadcastResult`, `BuyResult`, `SellResult` types to `types/index.ts`
- Added `getAllConnections()` to `RpcManager` enabling Plans 02/03 to pass both connections to broadcaster
- 7 broadcaster tests pass; 106 total tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add execution types, config schema, and getAllConnections** - `9748190` (feat)
2. **Task 2: Build broadcaster with blockhash-last signing and multi-RPC broadcast** - `f176e81` (feat)

## Files Created/Modified

- `src/execution/broadcaster.ts` — `broadcastAndConfirm()` function: blockhash fetch, sign, parallel send, confirmation
- `src/execution/broadcaster.test.ts` — 7 tests: happy path, partial failure, full failure, on-chain error, empty connections, EXE-04 sourcing, send options
- `src/types/index.ts` — Added `SellStep`, `BroadcastResult`, `BuyResult`, `SellResult`
- `src/config/trading.ts` — Added `ExecutionBuyConfigSchema`, `ExecutionSellConfigSchema`, `ExecutionConfigSchema`, `ExecutionConfig` type; added `execution` to `TradingConfigSchema`
- `src/core/rpc-manager.ts` — Added `getAllConnections(): Connection[]`
- `config.json` — Added `execution` section with buy/sell defaults
- `src/detection/detection-manager.test.ts` — Added `execution` field to `makeTradingConfig()` mock (Rule 1 auto-fix)
- `src/safety/safety-pipeline.test.ts` — Added `execution` field to `mockTradingConfig` (Rule 1 auto-fix)

## Decisions Made

- Blockhash fetched from `connections[0]` only (single round-trip; any valid blockhash is accepted by all connections)
- `Promise.allSettled` used (not `Promise.any`) to ensure ALL connections receive the transaction even if some fail
- `skipPreflight: true, maxRetries: 0` — Jupiter pre-simulates; we control retry loop in caller with fresh blockhash each time
- Confirmation uses `connections[0]` — transaction signature is chain-global; any connection can confirm it
- `ExecutionConfig` fields use Zod `.default()` — allows partial or omitted `execution` section in `config.json`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated mock TradingConfig objects in existing tests to include execution field**
- **Found during:** Task 1 (TypeScript compile verification)
- **Issue:** Two test files (`detection-manager.test.ts`, `safety-pipeline.test.ts`) had inline mock `TradingConfig` objects missing the new required `execution` field, causing TS2741 errors
- **Fix:** Added complete `execution.buy` and `execution.sell` sub-objects with default values to both mock configs
- **Files modified:** `src/detection/detection-manager.test.ts`, `src/safety/safety-pipeline.test.ts`
- **Verification:** `npx tsc --noEmit` passes clean; all 106 tests pass
- **Committed in:** `9748190` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — type error in existing test mocks caused by schema extension)
**Impact on plan:** Fix was necessary and correct — schema extension without updating mocks would leave tests broken. No scope creep.

## Issues Encountered

None beyond the auto-fixed mock update above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `broadcastAndConfirm()` is ready for Plans 02 and 03 to build against
- `ExecutionConfig` is available via `tradingConfig.execution` throughout the codebase
- `RpcManager.getAllConnections()` enables both Plans 02 and 03 to pass all connections to the broadcaster
- Plan 02 (buy executor) can now build the Jupiter swap transaction and call `broadcastAndConfirm()`
- Plan 03 (sell ladder) can build its 5-step escalation using `broadcastAndConfirm()` as the shared primitive

## Self-Check: PASSED

All created files exist on disk. Both task commits verified in git log.

---
*Phase: 05-execution-engine*
*Completed: 2026-02-27*
