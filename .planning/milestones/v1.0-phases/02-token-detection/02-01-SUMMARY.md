---
phase: 02-token-detection
plan: 01
subsystem: infra
tags: [websocket, ws, reconnection, heartbeat, zod, types, detection]

# Dependency graph
requires:
  - phase: 01-foundation-operations
    provides: createModuleLogger, env.ts Zod schema pattern, TradingConfigSchema pattern

provides:
  - ResilientWebSocket abstract base class with exponential backoff reconnection (DET-03)
  - Heartbeat silence detection via lastMessageAt (DET-04)
  - Excessive reconnect sliding-window alerting (DET-05)
  - TokenEvent, DetectionSource, DetectorEvents, ResilientWsConfig types
  - PUMPPORTAL_ENABLED and RAYDIUM_ENABLED env var toggles with boolean coercion
  - detection config section in TradingConfigSchema and config.json

affects:
  - 02-02 (PumpPortal listener extends ResilientWebSocket)
  - 02-03 (Raydium/PumpSwap listener extends ResilientWebSocket)
  - 03-safety (consumes TokenEvent type)
  - 05-execution (consumes DetectionSource, TokenEvent)

# Tech tracking
tech-stack:
  added: [ws@8.19.0, @types/ws@8.18.1]
  patterns:
    - vi.hoisted() used for mock classes that vi.mock() factory references (avoids TDZ errors)
    - Abstract base class pattern for protocol-specific WebSocket subclasses
    - Heartbeat via setInterval + lastMessageAt timestamp (not WebSocket pong events)

key-files:
  created:
    - src/core/resilient-ws.ts
    - src/core/resilient-ws.test.ts
  modified:
    - src/config/env.ts
    - src/config/trading.ts
    - config.json
    - .env.example
    - src/types/index.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "vi.hoisted() required for MockWebSocket in vi.mock factory — top-level class declarations cause TDZ errors under vitest hoisting"
  - "Heartbeat silence check uses >= (not >) so stale detection fires precisely at 2x interval tick"
  - "ws installed as runtime dependency (not devDep) — ResilientWebSocket is production code"
  - "Jitter is multiplicative (1.0-1.15x) applied to currentBackoffMs before cap, not additive"

patterns-established:
  - "ResilientWebSocket: extend and implement onMessage() + getSubscriptions() for each protocol"
  - "Detection toggles are env vars (PUMPPORTAL_ENABLED, RAYDIUM_ENABLED) not config.json — deployment-time switches belong in env"

requirements-completed: [DET-03, DET-04, DET-05]

# Metrics
duration: 7min
completed: 2026-02-21
---

# Phase 2 Plan 01: WebSocket Infrastructure and Token Detection Types Summary

**ResilientWebSocket abstract class with exponential backoff (3s base/60s max/15% jitter), 30s heartbeat silence detection, sliding-window reconnect alerting, and TokenEvent/DetectionSource types for all downstream detection consumers**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-21T16:03:38Z
- **Completed:** 2026-02-21T16:10:38Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- ResilientWebSocket abstract base class fully implements DET-03 (reconnect), DET-04 (heartbeat), DET-05 (alerting) — all downstream listeners extend this single class
- TokenEvent type captures all PumpPortal fields from research (mint, creator, bondingCurveKey, marketCapSol, vSolInBondingCurve, vTokensInBondingCurve, etc.)
- PUMPPORTAL_ENABLED and RAYDIUM_ENABLED env var toggles with boolean coercion and safe defaults
- Detection WS config (heartbeat, backoff, dedup) added to TradingConfigSchema + config.json
- 9 unit tests covering connect, subscription replay, message routing, backoff reset, explicit close, excessive reconnect alerting, heartbeat silence detection, and heartbeat ping
- All 19 tests pass across 3 test files (no regressions)

## Task Commits

1. **Task 1: Add detection config, env vars, and TokenEvent types** - `f49ba8a` (feat)
2. **Task 2: Implement ResilientWebSocket abstract base class with tests** - `0782c46` (feat)

**Plan metadata:** _(docs commit follows)_

## Files Created/Modified

- `src/core/resilient-ws.ts` - Abstract WebSocket base class with backoff, heartbeat, alerting
- `src/core/resilient-ws.test.ts` - 9 unit tests for all ResilientWebSocket behaviors
- `src/types/index.ts` - TokenEvent, DetectionSource, DetectorEvents, ResilientWsConfig types
- `src/config/env.ts` - PUMPPORTAL_ENABLED, RAYDIUM_ENABLED env vars with boolean coercion
- `src/config/trading.ts` - DetectionConfigSchema + detection section in TradingConfigSchema
- `config.json` - detection block with ws heartbeat/backoff/dedup defaults
- `.env.example` - PUMPPORTAL_ENABLED and RAYDIUM_ENABLED with comments
- `package.json` - ws@8.19.0 dependency, @types/ws@8.18.1 devDependency
- `pnpm-lock.yaml` - lockfile updated

## Decisions Made

- `vi.hoisted()` is required when a mock class is referenced inside a `vi.mock()` factory — vitest hoists `vi.mock()` calls before imports, causing TDZ errors if the mock class is declared at module scope. The solution is to define the class inside `vi.hoisted()` using `require()` for any Node built-ins.
- Heartbeat silence detection uses `>=` comparison (`silenceMs >= maxSilenceMs`) so detection fires precisely at the 2x interval tick rather than requiring an extra full interval.
- `ws` is a runtime dependency (not devDependency) because ResilientWebSocket is production code used in the running bot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing ws package before Task 1 commit**
- **Found during:** Task 1 setup (reviewing package.json vs plan requirements)
- **Issue:** `ws` not in package.json — ResilientWebSocket requires it at import time
- **Fix:** Ran `pnpm add ws && pnpm add -D @types/ws`
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** Import succeeded, TypeScript resolved types
- **Committed in:** f49ba8a (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking dependency)
**Impact on plan:** `ws` was an implicit dependency; installing it before implementation was necessary. No scope creep.

## Issues Encountered

- `vi.mock()` factory references `MockWebSocket` before initialization due to vitest hoisting — resolved by moving class definition into `vi.hoisted()` block using `require('events')` for EventEmitter (since ESM imports aren't accessible inside `vi.hoisted()`).
- First heartbeat silence test failed because `>` (strict greater-than) requires waiting for the next interval after the threshold, not exactly at it. Changed to `>=` in implementation — semantically equivalent (detect stale at exactly 2x interval, not 2x+1 interval later).

## Next Phase Readiness

- ResilientWebSocket ready for PumpPortal listener (02-02) to extend
- ResilientWebSocket ready for Raydium/PumpSwap listener (02-03) to extend
- TokenEvent type contract established — safety (Phase 3) and execution (Phase 5) can depend on it
- Both detection toggles exist with safe defaults — existing .env files work without changes

---
*Phase: 02-token-detection*
*Completed: 2026-02-21*
