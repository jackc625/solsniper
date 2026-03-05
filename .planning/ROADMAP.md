# Roadmap: SolSniper

## Overview

SolSniper is built as a reactive pipeline: foundation utilities first, then detection, safety, persistence, execution (buy AND sell together), position management, and finally the dashboard. The critical architectural constraint -- that sell reliability must be built alongside buy, not deferred -- shapes the phase ordering. Every phase delivers a coherent, independently verifiable capability. The bot runs headlessly through Phases 1-7; the dashboard in Phase 8 is a read-only observer layered on top of a proven trading pipeline.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & Operations** - Config, logging, RPC manager, resilient WebSocket, wallet security, graceful shutdown (completed 2015-02-20)
- [ ] **Phase 2: Token Detection** - PumpPortal and Raydium WebSocket listeners with auto-reconnect and heartbeat
- [x] **Phase 3: Safety Pipeline** - Parallel tiered safety checks with aggregate scoring and threshold enforcement (completed 2015-02-27)
- [x] **Phase 4: Trade Persistence** - SQLite trade journal with state machine, write-ahead pattern, and duplicate prevention (completed 2015-02-27)
- [x] **Phase 5: Execution Engine** - Jupiter and PumpPortal buy, sell escalation ladder with Jito bundles, multi-RPC broadcast (completed 2015-02-27)
- [x] **Phase 6: Crash Recovery** - Resume pending trades from SQLite, reconcile against on-chain state on restart (completed 2015-02-27)
- [x] **Phase 7: Position Management** - Price monitoring, stop-loss, take-profit, tiered exits, trailing stop, position limits (completed 2015-02-27)
- [x] **Phase 8: Web Dashboard** - Live trade feed via SSE, P&L tracking, filter configuration, in-process HTTP server (completed 2015-02-27)

## Phase Details

### Phase 1: Foundation & Operations
**Goal**: All cross-cutting infrastructure exists so every subsequent phase can log, connect to Solana, load config, and handle shutdown cleanly
**Depends on**: Nothing (first phase)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06
**Success Criteria** (what must be TRUE):
  1. Bot process starts, loads configuration from .env, and validates all required values at startup (invalid config causes immediate exit with clear error)
  2. Every log line is structured JSON with timestamps and contextual fields (trade IDs when applicable), viewable via pino-pretty in development
  3. RPC manager connects to primary Helius endpoint and falls over to backup provider when primary fails, with automatic recovery when primary returns
  4. Private key loads from environment variable and never appears in any log output at any verbosity level
  5. Bot handles SIGTERM/SIGINT by closing connections, flushing logs, and exiting cleanly within 5 seconds
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md — Scaffold project, config validation (env + config.json), structured logging with trade ID threading
- [ ] 01-02-PLAN.md — RPC manager with failover/events, wallet security, graceful shutdown, entry point wiring

### Phase 2: Token Detection
**Goal**: Bot receives real-time notification of every new token launch on Pump.fun and every new Raydium pool creation, without missing events due to connection drops
**Depends on**: Phase 1
**Requirements**: DET-01, DET-02, DET-03, DET-04, DET-05
**Success Criteria** (what must be TRUE):
  1. Bot logs new Pump.fun token creation events within seconds of launch via PumpPortal WebSocket
  2. Bot logs new Raydium pool creation events via Solana RPC logsSubscribe
  3. When a WebSocket connection drops (network interruption, server disconnect), the bot reconnects automatically with exponential backoff and resumes receiving events without manual intervention
  4. Bot detects silent WebSocket connection death (no data, no close event) via heartbeat pings and triggers reconnection within 30 seconds of last received message
  5. Every reconnection event is logged with a reconnection counter; excessive reconnections (configurable threshold) trigger a warning log
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — ResilientWebSocket base class, detection config/env vars, TokenEvent types
- [ ] 02-02-PLAN.md — PumpPortal listener, Raydium/PumpSwap listener, DetectionManager, bot lifecycle wiring

### Phase 3: Safety Pipeline
**Goal**: Bot evaluates every detected token against a multi-tiered safety pipeline and only allows buying tokens that pass a configurable safety score threshold
**Depends on**: Phase 2
**Requirements**: SAF-01, SAF-02, SAF-03, SAF-04, SAF-05, SAF-06, SAF-07, SAF-08, SAF-09
**Success Criteria** (what must be TRUE):
  1. Bot hard-blocks any token where mint authority is not null (revoked) -- no buy transaction is ever attempted for such tokens
  2. Bot hard-blocks any token where freeze authority is not null -- no buy transaction is ever attempted
  3. Bot hard-blocks any token that has no valid sell route via Jupiter quote simulation
  4. All three Tier 1 checks (mint authority, freeze authority, sell simulation) complete in parallel in under 300ms for the typical case
  5. Bot computes an aggregate safety score incorporating Tier 1 hard checks, Tier 2 RugCheck and holder concentration data, and Tier 3 creator history analysis, and rejects tokens below a configurable threshold
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — Safety types, config, cache, blocklist, @solana/spl-token install, Tier 1 hard checks (authority + sell route) with TDD
- [ ] 03-02-PLAN.md — Tier 2 RugCheck API + holder concentration, Tier 3 creator history with blocklist integration, TDD
- [ ] 03-03-PLAN.md — SafetyPipeline orchestrator with aggregate scoring, soft blocks, caching, detailed logging, and index.ts wiring

### Phase 4: Trade Persistence
**Goal**: Every trade intent and state transition is durably recorded in SQLite before any on-chain action occurs, preventing duplicate buys and enabling crash recovery
**Depends on**: Phase 3
**Requirements**: PER-01, PER-02, PER-04
**Success Criteria** (what must be TRUE):
  1. Every trade has a persistent record in SQLite that tracks its complete lifecycle through states: DETECTED, BUYING, MONITORING, SELLING, COMPLETED
  2. Before sending any buy transaction, the bot writes a PENDING entry to SQLite (write-ahead pattern) -- if the process crashes between write and send, the record exists for recovery
  3. Bot maintains an in-memory Set of active buy intents and rejects duplicate concurrent buys for the same token mint
**Plans**: TBD

Plans:
- [x] 04-01-PLAN.md — TradeStore with SQLite state machine, in-memory duplicate guard, optimistic locking, crash-recovery Set rebuild (TDD, better-sqlite3)

### Phase 5: Execution Engine
**Goal**: Bot can buy tokens via Jupiter or PumpPortal based on token state, and reliably sell positions through an escalation ladder that recovers capital even in low-liquidity conditions
**Depends on**: Phase 4
**Requirements**: EXE-01, EXE-02, EXE-03, EXE-04, EXE-05, EXE-06, EXE-07, EXE-08, EXE-09
**Success Criteria** (what must be TRUE):
  1. Bot buys bonding-curve tokens via PumpPortal trade-local API and migrated tokens via Jupiter Swap API, automatically selecting the correct path based on token state
  2. Blockhash is fetched as the absolute last step before transaction signing (never before safety checks) and refreshed on every retry attempt
  3. Buy and sell transactions are broadcast to multiple RPC providers simultaneously, improving landing rate over single-RPC submission
  4. When a standard sell fails, bot escalates through increasingly aggressive strategies (higher fees, Jito bundle, chunked sell, emergency 49% slippage) before giving up
  5. Jito bundles are constructed and submitted for MEV-protected sell execution as part of the escalation ladder
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md — ExecutionConfig schema, shared types (BuyResult, SellResult, SellStep), broadcaster (blockhash-last, multi-RPC, confirmation)
- [ ] 05-02-PLAN.md — PumpPortal buyer (raw bytes), Jupiter buyer (base64), ExecutionEngine with routing + TradeStore transitions
- [ ] 05-03-PLAN.md — Sell ladder: standard/high-fee seller, Jito bundle seller, chunked seller, SellLadder orchestrator with time-based steps
- [ ] 05-04-PLAN.md — Wire ExecutionEngine and SellLadder into src/index.ts

### Phase 6: Crash Recovery
**Goal**: Bot resumes operation after any crash or restart without losing track of positions or executing duplicate trades
**Depends on**: Phase 5
**Requirements**: PER-03, PER-05
**Success Criteria** (what must be TRUE):
  1. On restart, bot loads all non-terminal trades from SQLite and resumes monitoring/selling them as appropriate based on their persisted state
  2. On restart, bot reconciles PENDING (pre-confirmation) entries against actual on-chain wallet token accounts to determine whether the buy landed or not, and updates state accordingly
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — TradeStore extensions (getBuyingTrades, getSellingTrades, getMonitoringTrades, getDetectedTrades, transitionById) with tests
- [x] 06-02-PLAN.md — RecoveryManager class (dual-program balance check, per-trade timeout, SELLING step-back, structured summary log) + index.ts startup resequencing

### Phase 7: Position Management
**Goal**: Bot automatically manages open positions with configurable exit strategies, protecting capital with stop-loss and capturing gains with take-profit
**Depends on**: Phase 6
**Requirements**: POS-01, POS-02, POS-03, POS-04, POS-05, POS-06
**Success Criteria** (what must be TRUE):
  1. Bot polls Jupiter quotes at configurable intervals to track current value of each active position
  2. Bot automatically triggers a sell when a position drops below the configurable stop-loss threshold (e.g., -50% from entry)
  3. Bot automatically triggers a sell when a position reaches the configurable take-profit target (e.g., 3x entry)
  4. Bot supports tiered take-profit: selling configured percentages at multiple price targets (e.g., 33% at 2x, 33% at 5x, remainder at 10x)
  5. Bot enforces a configurable maximum concurrent position limit, rejecting new buys when the limit is reached
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md — Config schema extension (positionManagement block), config.jsonc defaults, TradeStore.updateMonitoringAmount()
- [ ] 07-02-PLAN.md — PositionManager class with polling loop, stop-loss, tiered TP, trailing stop, sellsInFlight guard, PumpPortal backfill, unit tests
- [ ] 07-03-PLAN.md — Wire PositionManager into index.ts: max-position guard (POS-06), start after recovery, stop in shutdown

### Phase 8: Web Dashboard
**Goal**: Operator can monitor all bot activity, review performance, and adjust trading parameters through a web interface without restarting the bot
**Depends on**: Phase 7
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. Dashboard displays a real-time feed of snipes, buys, and sells that updates live via Server-Sent Events without requiring page refresh
  2. Dashboard shows per-trade P&L (entry price, current price, profit/loss percentage) and overall portfolio performance (total P&L, win rate, trade count)
  3. Operator can adjust safety filter thresholds and scoring weights through the dashboard UI, and changes take effect immediately without restarting the bot process
  4. Operator can adjust buy amount and maximum concurrent position limits through the dashboard UI, effective immediately
  5. Dashboard runs as an in-process HTTP server within the bot process (not a separate service), requiring no additional deployment or IPC configuration
**Plans**: 5 plans

Plans:
- [x] 08-01-PLAN.md — BotEventBus contracts, TypeScript interfaces, env vars (DASHBOARD_PORT, DASHBOARD_API_KEY)
- [x] 08-02-PLAN.md — Fastify HTTP server: SSE /events, /api/trades, /api/stats, /api/config, auth hook
- [x] 08-03-PLAN.md — Preact+Vite SPA: Header bar, Live Feed, Performance, Settings tabs with dark terminal theme
- [x] 08-04-PLAN.md — BotEvent emissions wired into ExecutionEngine, SellLadder, SafetyPipeline, index.ts lifecycle
- [x] 08-05-PLAN.md — End-to-end human verification of dashboard: all tabs, SSE, Settings save, header stats confirmed

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Operations | 2/2 | Complete   | 2015-02-20 |
| 2. Token Detection | 1/2 | In Progress|  |
| 3. Safety Pipeline | 3/3 | Complete   | 2015-02-27 |
| 4. Trade Persistence | 2/2 | Complete   | 2015-02-27 |
| 5. Execution Engine | 4/4 | Complete   | 2015-02-27 |
| 6. Crash Recovery | 2/2 | Complete   | 2015-02-27 |
| 7. Position Management | 3/3 | Complete   | 2015-02-27 |
| 8. Web Dashboard | 5/5 | Complete   | 2015-02-27 |
| 9. Fix Broken Jupiter API | 2/2 | Complete   | 2015-03-02 |

### Phase 9: Fix broken Jupiter API

**Goal:** Add x-api-key authentication to all Jupiter API requests (broken since Jan 31, 2026 deprecation of unauthenticated access) and implement production-grade rate-limit handling with global 429 cooldown and dynamic poll interval stretching
**Requirements**: None (bugfix phase — no new requirements)
**Depends on:** Phase 8
**Plans:** 2/2 plans complete

Plans:
- [x] 09-01-PLAN.md — JupiterClient centralized API client with auth + 429 global cooldown + TDD test suite, env var registration
- [ ] 09-02-PLAN.md — Migrate all 5 Jupiter callers to JupiterClient, PositionManager dynamic poll interval, index.ts wiring, test updates

### Phase 10: fix mint issues

**Goal:** Fix Token-2022 compatibility bugs blocking pump.fun create_v2 tokens from the safety pipeline, add Jupiter error code parsing, skip sell-route for new pump.fun tokens, add PumpPortal sell fallback in the sell ladder, and thread token source/programId through the trade lifecycle
**Requirements**: None (bugfix phase — no new requirements)
**Depends on:** Phase 9
**Plans:** 2/2 plans complete

Plans:
- [ ] 10-01-PLAN.md — Core Token-2022 getMint fix (Pattern A), instanceof error detection, Jupiter 400 error parsing, sell-route skip for pump.fun, schema migration (source + token_program_id), safety pipeline source/programId threading
- [ ] 10-02-PLAN.md — PumpPortal sell adapter, chunked-seller Token-2022 ATA fix, sell ladder PUMPPORTAL step, post-buy sell-route verification

### Phase 11: fix bonding curve issue

**Goal:** Fix the holder concentration check that incorrectly counts the Pump.fun bonding curve PDA as a whale holder, causing ~90% of new Pump.fun tokens to fail. Derive bonding curve PDA per-mint and exclude it dynamically, add source-aware zero-holder handling for pumpportal tokens.
**Requirements**: None (bugfix phase — no new requirements)
**Depends on:** Phase 10
**Plans:** 1/1 plans complete

Plans:
- [ ] 11-01-PLAN.md — Bonding curve PDA exclusion in tier2-holder (both paths), source-aware zero-holder logic, SafetyPipeline source threading, test updates

### Phase 12: dry run functionality

**Goal:** Run the entire real pipeline against mainnet (real detection, real safety checks, real transaction building) but intercept at two gate points before signing/broadcasting. Shadow price tracking via PositionManager shows what P&L would have been. Dashboard shows DRY RUN badges on feed events and a prominent mode banner.
**Requirements**: DRY-01, DRY-02, DRY-03, DRY-04, DRY-05, DRY-06, DRY-07, DRY-08
**Depends on:** Phase 11
**Plans:** 2/2 plans complete

Plans:
- [ ] 12-01-PLAN.md — Backend core: Trade interface + config flag + schema migration + trade-store threading + broadcaster Gate 1 + jito-seller Gate 2 + recovery skip + position manager log-only triggers + index.ts wiring
- [ ] 12-02-PLAN.md — Dashboard: BotEvent isDryRun field + config patch route + stats exclusion + LiveFeed badge + Header banner + Settings toggle + end-to-end human verification

### Phase 13: UI rework

**Goal:** Complete visual and functional rework of the Preact web dashboard: sidebar + content layout replacing horizontal tabs, rich expandable feed cards with external links, P&L charts and sortable completed trade history, and a bold visual overhaul driven by the frontend-design skill
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06
**Depends on:** Phase 12
**Plans:** 5/5 plans complete

Plans:
- [ ] 13-01-PLAN.md — Backend data surface: enrich BotEvent with safetyScore/source/buyAmountSol, add /api/trades/history endpoint, install lightweight-charts
- [ ] 13-02-PLAN.md — Layout shell: Sidebar component, App grid restructure, design system foundation, Settings redesign
- [ ] 13-03-PLAN.md — LiveFeed rework: rich expandable FeedCards with Solscan/pump.fun links, safety scores, source badges
- [ ] 13-04-PLAN.md — Performance rework: P&L chart (lightweight-charts), win rate visualization, sortable completed trade history table
- [ ] 13-05-PLAN.md — End-to-end human verification of complete UI rework across all views

### Phase 14: sell price bug fixes

**Goal:** Fix the two sell price bugs that break all P&L tracking: (1) sellers discard SOL received amounts so sellPriceSol is never stored, and (2) dashboard SQL computes P&L using the wrong formula. After this phase, every completed sell stores total SOL received and the dashboard shows accurate per-trade and aggregate P&L.
**Requirements**: None (bugfix phase — no new requirements)
**Depends on:** Phase 13
**Plans:** 3/3 plans complete

Plans:
- [ ] 14-01-PLAN.md — SellOutcome/ChunkedSellOutcome types, update all 4 sellers to return solReceived (Jupiter quote outAmount or on-chain parse)
- [ ] 14-02-PLAN.md — SellLadder solReceived threading, pnlSol formula fix, TradeStore.addSellPrice(), SELL_PARTIAL event type
- [ ] 14-03-PLAN.md — Dashboard SQL fix: P&L formula sell_price_sol - amount_sol, win rate denominator fix
