# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Land buy transactions in the first block on new token launches while filtering out scams -- speed and safety together.
**Current focus:** Phase 2: Token Detection (Plan 2 complete, Plan 3 next)

## Current Position

Phase: 2 of 8 (Token Detection)
Plan: 2 of 4 in current phase - COMPLETE
Status: Phase 2 Plan 2 complete, ready for Plan 3 (detection testing/hardening)
Last activity: 2026-02-21 -- Plan 02-02 complete (PumpPortal + Raydium listeners + DetectionManager)

Progress: [████░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 15.3 min
- Total execution time: 0.71 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-operations | 2/2 | 39 min | 19.5 min |
| 02-token-detection | 2/4 | 13 min | 6.5 min |

**Recent Trend:**
- Last 5 plans: 17 min, 22 min, 7 min, 6 min
- Trend: fast (detection implementation tasks)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Buy and sell execution built in same phase (Phase 5) per research mandate -- sell reliability is primary profit driver
- [Roadmap]: Persistence (Phase 4) placed before execution (Phase 5) because write-ahead pattern requires SQLite schema to exist before any transaction is sent
- [Roadmap]: Dashboard (Phase 8) is last -- bot must work headlessly first; UI is a read-only observer
- [01-01]: Zod v4 installed (latest) -- safeParse and z.infer APIs remain compatible with v3 patterns; no migration needed
- [01-01]: stdout-only logging -- redirect to file at PM2/process level, not in application code
- [01-01]: debug default log level in dev (not trace -- too verbose for daily debugging)
- [01-01]: withLatency always logs latency with no threshold gate -- complete dataset more useful than selective
- [01-01]: Pino serializer strips keys containing PRIVATE_KEY or SECRET for belt-and-suspenders OPS-04 protection
- [Phase 01-02]: Named import from eventemitter3 { EventEmitter } not default import -- default causes TS2507 constructor error with Node16 module resolution
- [Phase 01-02]: vitest.config.ts loads .env via dotenv + sets NODE_ENV=development -- env.ts calls process.exit(1) on validation failure, so test environment must supply valid values
- [02-01]: vi.hoisted() required for MockWebSocket in vi.mock factory -- vitest hoists vi.mock calls before imports, causing TDZ errors if mock class declared at module scope
- [02-01]: Heartbeat silence detection uses >= (not >) so stale detection fires precisely at 2x interval tick
- [02-01]: ws is a runtime dependency (not devDep) -- ResilientWebSocket is production code
- [02-01]: Detection toggles (PUMPPORTAL_ENABLED, RAYDIUM_ENABLED) are env vars not config.json -- deployment-time switches belong in env
- [Phase 02-02]: connection.onLogs() requires PublicKey (not string) as filter — LogsFilter type excludes raw strings
- [Phase 02-02]: vi.fn() class field in vi.hoisted() is instance property not on prototype — export shared spy ref, clear in beforeEach, assert on ref directly
- [Phase 02-02]: PumpSwap mint extraction uses defensive account scan (first non-SOL, non-program addr) — account layout unknown until first live detection
- [Phase 02-02]: Dedup uses Map<string, number> (mint -> timestamp) not Set — enables age-based eviction to prevent unbounded growth

### Pending Todos

None.

### Blockers/Concerns

- PumpSwap migration status unknown -- Pump.fun launched PumpSwap (their own AMM) in early 2026. Validate current token migration destination (Raydium vs PumpSwap) during Phase 2 implementation.
- PumpPortal WebSocket schema may have evolved -- validate field names against current docs at Phase 2 start.

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 02-02-PLAN.md (PumpPortal + Raydium listeners + DetectionManager)
Resume file: .planning/phases/02-token-detection/02-03-PLAN.md
