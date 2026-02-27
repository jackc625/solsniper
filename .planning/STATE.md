---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-02-27T21:57:44.661Z"
progress:
  total_phases: 8
  completed_phases: 7
  total_plans: 23
  completed_plans: 21
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Land buy transactions in the first block on new token launches while filtering out scams -- speed and safety together.
**Current focus:** Phase 8: Dashboard (next)

## Current Position

Phase: 8 of 8 (Web Dashboard) - IN PROGRESS
Plan: 3 of 5 in current phase - COMPLETE
Status: Phase 8 Plan 03 complete — Preact+Vite SPA frontend: three-tab layout, SSE LiveFeed, Performance table, Settings form, dashboard/dist/ compiled
Last activity: 2026-02-27 -- Plan 08-03 complete (Preact+Vite scaffold, store primitives, Header/LiveFeed/Performance/Settings components, pnpm build:dashboard)

Progress: [█████████░] 91% (21/23 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 8.8 min
- Total execution time: 1.47 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation-operations | 2/2 | 39 min | 19.5 min |
| 02-token-detection | 2/4 | 13 min | 6.5 min |
| 03-safety-pipeline | 3/4 | 17 min | 5.7 min |
| 04-trade-persistence | 2/2 | 10 min | 5 min |
| 05-execution-engine | 4/4 | 18 min | 4.5 min |

**Recent Trend:**
- Last 5 plans: 4 min, 4 min, 6 min, 6 min, 6 min
- Trend: fast (implementation tasks with clear specs)

*Updated after each plan completion*

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06-crash-recovery | 1/2 | 3 min | 3 min |
| Phase 06-crash-recovery P02 | 10 | 3 tasks | 3 files |
| Phase 07-position-management P02 | 4 | 2 tasks | 2 files |
| Phase 07-position-management P03 | 4 | 1 tasks | 1 files |
| Phase 08-web-dashboard P01 | 4 | 2 tasks | 4 files |
| Phase 08-web-dashboard P02 | 6 | 2 tasks | 7 files |
| Phase 08-web-dashboard P03 | 12 | 2 tasks | 12 files |

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
- [03-01]: checkAuthorities() uses single getMint() call for both mint and freeze authority checks -- 1 RPC round-trip satisfies SAF-04 parallelism
- [03-01]: MockPublicKey in tests must be real valid base58 address -- PublicKey constructor validates encoding, fake strings throw "Invalid public key input"
- [03-01]: vi.stubGlobal('fetch', mockFetch) used for Jupiter sell route tests -- simpler than vi.mock for global built-in mocking
- [03-01]: SafetyConfigSchema nested inside TradingConfigSchema under 'safety' key -- all safety config in config.json per user decision
- [03-02]: checkCreatorHistory returns pass=true on API error (score=0) -- Tier 3 is a scoring signal; errors don't prove danger the way Tier 1 hard-blocks do
- [03-02]: Holder concentration uses BigInt arithmetic throughout -- token amounts can exceed Number.MAX_SAFE_INTEGER
- [03-02]: analyzeCreatorHistory filters by type=TOKEN_MINT before counting -- Helius returns all tx types
- [03-02]: Test scenario for "no dominance" uses 10%/8%/7%/10% distribution (not 4x25%) -- 4x25% correctly fails the top10=100% threshold check
- [03-03]: vi.fn(function() { return {...} }) not arrow function for vi.mock constructor mocks -- arrow functions cannot be called with 'new' keyword
- [03-03]: vi.hoisted() required for shared spy refs across vi.mock factories -- prevents TDZ errors (same pattern as vi.hoisted MockWebSocket in 02-01)
- [03-03]: resolveSettled() returns pass=true on Promise.allSettled rejection -- errors don't prove danger; score=0 is pessimistic enough to fail aggregate
- [03-03]: SafetyPipeline has no cleanup method -- in-memory cache (GC), synchronous blocklist writes, no persistent connections or timers
- [04-01]: better-sqlite3 ESM interop uses createRequire() -- Node16 moduleResolution with esModuleInterop still fails TS1259 on CJS native modules; createRequire is the correct fallback
- [04-01]: pnpm.onlyBuiltDependencies in package.json for better-sqlite3 -- pnpm 10 requires explicit build approval; prebuild-install downloads prebuilt binary from GitHub releases
- [04-01]: WAL pragma guarded by dbPath !== ':memory:' -- SQLite silently reverts WAL on in-memory DBs
- [04-01]: stmtGetNonTerminal uses positional ? placeholders for IN clause -- named params not supported for arrays in better-sqlite3
- [Phase 04-02]: getActiveCount() not added to TradeStore log — method not on TradeStore interface; used simple TradeStore initialized log without activeMints field
- [Phase 04-02]: isActive() guard placed before createBuyingRecord() in token handler — matches PER-04 duplicate guard requirement; both synchronous with no async gap
- [05-01]: broadcastAndConfirm fetches blockhash from connections[0] only — single round-trip; any valid blockhash is accepted by all connections
- [05-01]: Promise.allSettled used (not Promise.any) — ensures ALL connections receive the transaction even when some fail
- [05-01]: skipPreflight=true, maxRetries=0 on sendRawTransaction — Jupiter pre-simulates; caller handles retry with fresh blockhash
- [05-01]: ExecutionConfig fields use Zod .default() — allows partial or omitted execution section in config.json
- [05-02]: PumpPortal slippage is percent (slippageBps/100), NOT basis points — critical comment added to source
- [05-02]: Jupiter slippage is basis points passed directly in quoteResponse — no conversion needed
- [05-02]: amountTokens undefined for PumpPortal (API doesn't return it); Phase 7 price polling fills this
- [05-02]: ExecutionEngine buy() has no retry — single attempt, speed over resilience per plan spec
- [Phase 05-execution-engine]: Jito tip tx is SEPARATE from swap tx per Jito protocol — both share same blockhash; tip LAST in bundle array
- [Phase 05-execution-engine]: CHUNKED returning 0 tranches advances to EMERGENCY — only >0 confirmed tranches counts as success
- [Phase 05-execution-engine]: pollBundleStatus polls once — SellLadder Promise.race manages timeout externally, not an internal polling loop
- [Phase 05-04]: void executionEngine.buy(event) fire-and-forget after write-ahead record — event handler is synchronous, async buy runs in background with internal error handling
- [Phase 05-04]: getWallet() called once and shared between ExecutionEngine and SellLadder — wallet cached internally, single load cleaner
- [Phase 05-04]: sellLadder held as local variable with Phase 7 comment — noUnusedLocals not set in tsconfig, no void workaround needed
- [Phase 06-01]: transitionById takes mint param (not queried from DB) to update activeMints Set without extra SELECT
- [Phase 06-01]: mapRow maps only the columns present in each query SELECT list — absent columns remain undefined per Trade interface optional fields
- [Phase 06-01]: stmtUpdateStateById uses COALESCE only for error_message — recovery transitions don't need full field update surface
- [Phase 06-02]: getParsedTokenAccountsByOwner used for both legacy SPL and Token-2022 (GetTokenAccountsByOwnerConfig has no encoding param)
- [Phase 06-02]: RPC failure on SELLING trade counted as sellingCompleted — no sellingUnrecovered counter; fail-safe-closed pattern treats both empty wallet and RPC fail as gone
- [Phase 06-02]: Valid base58 Solana pubkeys required in all unit tests — PublicKey constructor throws on invalid base58; use mainnet addresses (WSOL, USDC) not fake strings
- [Phase 07-01]: Keep top-level stopLossPct and takeProfitPct in TradingConfigSchema — backward compat; positionManagement.stopLossPct is what PositionManager uses
- [Phase 07-01]: Dedicated stmtSetMonitoringAmount for PumpPortal backfill — cleaner than reusing transition() for same-state MONITORING update
- [Phase 07-01]: TierSchema at field is a price multiplier (2 = 2x entry value in SOL), pct is percent of remaining tokens to sell at that tier
- [Phase 07-02]: fireSell() captures promise ref before void to allow .finally() cleanup while maintaining fire-and-forget semantics
- [Phase 07-02]: Math.round() before BigInt() conversion for float amountTokens — SQLite stores amount_tokens as REAL
- [Phase 07-02]: High watermark initialized to trade.amountSol (entry price) on first tick — prevents false trailing stop triggers on startup
- [Phase 07-03]: PositionManager initialized before recovery but started after — start() must wait for recovered MONITORING trades to be in store
- [Phase 07-03]: positionManager.stop() is first action in shutdown() — prevents new sell triggers while RPC connections still needed for in-flight sells
- [Phase 07-03]: POS-06 guard placed before isActive() duplicate guard in token handler — position limit check is semantically prior
- [Phase 08-web-dashboard]: patchRuntimeConfig shallow-merges updates via spread — callers must pass validated Partial<TradingConfig>
- [Phase 08-web-dashboard]: botEventBus uses single event name 'event' with typed BotEvent payload — simpler than per-type event names for SSE listener registration
- [Phase 08-web-dashboard]: DASHBOARD_API_KEY absent means auth disabled (opt-in security) — consistent with existing optional API keys pattern in env.ts
- [Phase 08-web-dashboard]: createRequire() used for @fastify/sse CJS module in dashboard-server.ts — prevents TS2769 overload mismatch with Fastify 5 register()
- [Phase 08-web-dashboard]: import type {} from '@fastify/sse' in events.ts triggers module augmentation (reply.sse, sse route option) without loading runtime code
- [Phase 08-web-dashboard]: Raw DB cast (tradeStore as any).db for /api/stats completed trade counts — avoids adding getCompletedTrades() to TradeStore in this plan
- [Phase 08-03]: dashboard/tsconfig.json separate from root tsconfig — targets browser (ES2020 DOM) with moduleResolution=bundler for Vite
- [Phase 08-03]: EventSource registers listeners for both generic 'message' and each BotEventType — handles both SSE data= and event= field formats
- [Phase 08-03]: Settings patch limited to known patchable fields only — avoids overwriting unknown config keys on POST /api/config

### Pending Todos

None.

### Blockers/Concerns

- PumpSwap migration status unknown -- Pump.fun launched PumpSwap (their own AMM) in early 2026. Validate current token migration destination (Raydium vs PumpSwap) during Phase 2 implementation.
- PumpPortal WebSocket schema may have evolved -- validate field names against current docs at Phase 2 start.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | document config.json values with inline comments | 2026-02-27 | 94a3749 | [1-document-config-json-values-with-inline-](./quick/1-document-config-json-values-with-inline-/) |

## Session Continuity

Last activity: 2026-02-27 - Completed 08-03-PLAN.md (Preact+Vite SPA: scaffold, store signals, Header/LiveFeed/Performance/Settings components, pnpm build:dashboard)

Last session: 2026-02-27
Stopped at: Completed 08-03-PLAN.md (Preact+Vite dashboard SPA complete, dashboard/dist/ compiled, 178 bot tests passing)
Resume file: .planning/phases/08-web-dashboard/08-04-PLAN.md
