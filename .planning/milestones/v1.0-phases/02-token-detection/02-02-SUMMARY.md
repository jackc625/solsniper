---
phase: 02-token-detection
plan: 02
subsystem: detection
tags: [websocket, pumpportal, raydium, pumpswap, onlogs, dedup, pre-filter, eventemitter3]

# Dependency graph
requires:
  - phase: 02-01
    provides: ResilientWebSocket base class, TokenEvent/DetectionSource/DetectorEvents types, ResilientWsConfig, detection config in TradingConfig, PUMPPORTAL_ENABLED/RAYDIUM_ENABLED env vars

provides:
  - PumpPortalListener extending ResilientWebSocket for subscribeNewToken events (DET-01)
  - RaydiumListener wrapping onLogs() for Raydium V4 + PumpSwap pool creation (DET-02)
  - RaydiumListener health-check recreates stale onLogs subscriptions every 60s (DET-03)
  - preFilter() for junk token rejection before safety pipeline
  - DetectionManager orchestrating both listeners with dedup, stats, pre-filter, unified event emission
  - Bot lifecycle integration via src/index.ts (start on boot, stop on shutdown)

affects:
  - 02-03 (if exists — further detection refinements)
  - 03-safety (consumes TokenEvent from DetectionManager 'token' event)
  - 05-execution (TokenEvent flows from detection through safety to execution)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - vi.hoisted() with shared vi.fn() instances cleared in beforeEach() for mock class field spying
    - Map<string, timestamp> for dedup with explicit eviction loop (vs Set with no TTL)
    - Connection.onLogs() with PublicKey filter (not string) — @solana/web3.js type requirement
    - setInterval health-check pattern for silent subscription death on onLogs()

key-files:
  created:
    - src/detection/pump-portal-listener.ts
    - src/detection/raydium-listener.ts
    - src/detection/pre-filter.ts
    - src/detection/detection-manager.ts
    - src/detection/detection-manager.test.ts
  modified:
    - src/index.ts

key-decisions:
  - "connection.onLogs() requires PublicKey (not string) as filter — string causes TS2345 type error"
  - "vi.fn() in vi.hoisted() class fields is an instance property not on prototype — must clear via mockClear() in beforeEach, not assert on MockClass.prototype.method"
  - "PumpSwap mint extraction uses first non-SOL, non-program account (defensive scan) rather than hardcoded index — account layout unknown until first live detection"
  - "Dedup uses Map<string, number> (timestamp) not Set — enables eviction by age to prevent unbounded growth"
  - "Health check interval (60s) vs silence threshold (120s) — two full intervals gives time to distinguish real silence from momentary lull"

patterns-established:
  - "onLogs subscriptions always use new PublicKey() wrapper — never raw string"
  - "Health check for onLogs: setInterval at N seconds checks lastEventAt, recreates subscriptions if > 2N seconds silent"
  - "DetectionManager.handleTokenEvent() is public (not private) to enable direct test injection without mocking WebSocket/RPC layers"

requirements-completed: [DET-01, DET-02, DET-03, DET-04, DET-05]

# Metrics
duration: 6min
completed: 2026-02-21
---

# Phase 2 Plan 02: Token Detection Listeners and DetectionManager Summary

**PumpPortalListener (extends ResilientWebSocket), RaydiumListener (onLogs with 60s health-check), and DetectionManager with mint dedup, junk pre-filter, 15-minute stats, and bot lifecycle integration**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-21T16:14:44Z
- **Completed:** 2026-02-21T16:20:38Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- PumpPortalListener extends ResilientWebSocket, captures detectedAt before JSON.parse (Pitfall 4), emits TokenEvent for every txType===create message with all PumpPortal fields mapped (DET-01)
- RaydiumListener creates two onLogs subscriptions (Raydium V4 on initialize2, PumpSwap on CreatePool/Instruction: CreatePool) with 60-second health-check to recreate subscriptions silently killed by @solana/web3.js reconnection (Pitfall 2 / DET-02/DET-03)
- DetectionManager orchestrates both listeners with Map-based dedup (timestamp eviction), preFilter junk rejection, one-liner-per-token info log (mint/source/latencyMs/preFilter), and 15-minute periodic stats with dedup pruning (DET-01 through DET-05)
- src/index.ts fully wired: detection starts after RPC manager, stops gracefully before pino flush, keepalive interval removed (WebSocket + onLogs keep event loop alive)
- 8 unit tests cover all DetectionManager behaviors; 27 total tests pass with zero regressions

## Task Commits

1. **Task 1: Implement PumpPortal listener, Raydium/PumpSwap listener, and pre-filter** - `d677233` (feat)
2. **Task 2: Implement DetectionManager, wire into index.ts, and add tests** - `b6f6b56` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `src/detection/pump-portal-listener.ts` - PumpPortal WebSocket listener extending ResilientWebSocket, parses subscribeNewToken → TokenEvent with latency-first stamping
- `src/detection/raydium-listener.ts` - Raydium V4 + PumpSwap onLogs subscriptions with 60s health-check for silent subscription death
- `src/detection/pre-filter.ts` - Junk token pre-filter: name/symbol length, spam keywords (FREE/AIRDROP), impersonation of well-known tokens
- `src/detection/detection-manager.ts` - Orchestrator with dedup Map, pre-filter, one-liner logging, 15-min stats, source toggling
- `src/detection/detection-manager.test.ts` - 8 unit tests with mocked listeners (vi.hoisted shared vi.fn() cleared in beforeEach)
- `src/index.ts` - Wired DetectionManager into startup/shutdown, removed keepalive interval

## Decisions Made

- `connection.onLogs()` requires a `PublicKey` object as the filter parameter — passing a raw string causes `TS2345 Argument of type 'string' is not assignable to parameter of type 'LogsFilter'`. Fixed by wrapping with `new PublicKey(PROGRAM_ADDRESS)`.
- `vi.fn()` assigned as a class field in `vi.hoisted()` is an **instance property**, not on the prototype. `MockClass.prototype.method` is `undefined`. Solution: export the shared `vi.fn()` from `vi.hoisted()` and call `.mockClear()` in `beforeEach()` — tests then assert on the shared spy reference directly.
- PumpSwap token mint extraction uses a defensive scan (find first non-SOL, non-program address) rather than hardcoded account indices — the PumpSwap account layout is unknown until first live pool creation is observed. Debug logging on first detection will identify the correct index for future hardening.
- Dedup uses `Map<string, number>` (mint → timestamp) rather than a `Set<string>`. The timestamp enables age-based eviction during the stats interval, preventing unbounded memory growth as pump.fun creates thousands of tokens daily.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript error: onLogs() requires PublicKey, not string**
- **Found during:** Task 1 (RaydiumListener implementation)
- **Issue:** `connection.onLogs(RAYDIUM_V4_PROGRAM, ...)` where `RAYDIUM_V4_PROGRAM` is a `string` caused `TS2345: Argument of type 'string' is not assignable to parameter of type 'LogsFilter'`
- **Fix:** Changed import to `import { Connection, PublicKey }` and wrapped program addresses with `new PublicKey(RAYDIUM_V4_PROGRAM)`
- **Files modified:** `src/detection/raydium-listener.ts`
- **Verification:** `npx tsc --noEmit` returned zero errors
- **Committed in:** d677233 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed test assertions for mock class field spies**
- **Found during:** Task 2 (unit tests)
- **Issue:** Tests 6 and 7 (source toggling) asserted on `MockClass.prototype.method` which is `undefined` because `vi.fn()` assigned as a class field is an instance property, not on the prototype. Both tests failed with "undefined is not a spy or a call to a spy"
- **Fix:** Exported shared `vi.fn()` references from `vi.hoisted()`, reset them in `beforeEach()` with `mockClear()`, and asserted on the shared spy references directly
- **Files modified:** `src/detection/detection-manager.test.ts`
- **Verification:** All 8 tests pass
- **Committed in:** b6f6b56 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both bugs were discovered during initial implementation and fixed inline. No scope creep. The TypeScript fix was necessary for compilation; the test spy fix was necessary for correct test assertions.

## Issues Encountered

- `@solana/web3.js` `LogsFilter` type accepts `PublicKey | 'all' | 'allWithVotes'`, not a plain string — documented in key-decisions for future phases using `onLogs`.
- Vitest's `vi.hoisted()` class field pattern behaves differently from prototype methods when asserting on spies — documented as a pattern for future test files using mock classes.

## Next Phase Readiness

- Full detection pipeline wired end-to-end: PumpPortal → DetectionManager → `'token'` event ready for Phase 3 safety pipeline
- RaydiumListener health-check handles silent subscription death; first live detection will log account layout for PumpSwap hardening
- All DET-01 through DET-05 requirements complete
- No blockers — Phase 3 (safety pipeline) can begin immediately

---
*Phase: 02-token-detection*
*Completed: 2026-02-21*

## Self-Check: PASSED

- FOUND: src/detection/pump-portal-listener.ts
- FOUND: src/detection/raydium-listener.ts
- FOUND: src/detection/pre-filter.ts
- FOUND: src/detection/detection-manager.ts
- FOUND: src/detection/detection-manager.test.ts
- FOUND: .planning/phases/02-token-detection/02-02-SUMMARY.md
- FOUND commit: d677233 (Task 1)
- FOUND commit: b6f6b56 (Task 2)
