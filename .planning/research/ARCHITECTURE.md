# Architecture Patterns: v1.1 Hardening Integration

**Domain:** Solana token sniper bot -- hardening, security, performance, dashboard, reliability
**Researched:** 2026-03-27
**Focus:** How v1.1 improvements integrate with existing v1.0 architecture

## Existing Architecture (v1.0 Baseline)

The system is a single Node.js process with a reactive pipeline of five subsystems connected by an in-process EventEmitter3 bus and SQLite persistence.

```
Detection (WebSocket/RPC)
    |
    v  detectionManager.on('token')
Safety Pipeline (3-tier parallel checks)
    |
    v  botEventBus.emit / tradeStore.createBuyingRecord
Execution Engine (Jupiter + PumpPortal buy routing)
    |
    v  tradeStore.transition BUYING -> MONITORING
Position Manager (poll-based Jupiter quote monitoring)
    |
    v  sellLadder.sell()
Sell Ladder (6-step escalation: standard/high-fee/jito/chunked/pumpportal/emergency)
    |
    v  tradeStore.transition -> COMPLETED/FAILED

Cross-cutting:
  - TradeStore (SQLite, write-ahead persistence, state machine)
  - BotEventBus (singleton EventEmitter3, SSE bridge to dashboard)
  - RpcManager (primary/backup failover, health polling)
  - getRuntimeConfig() (hot-reload config, dashboard-patchable)
  - Dashboard (Fastify 5 + Preact SPA, SSE live feed)
```

### Current Module Map

| Module | Files | Key Classes/Functions |
|--------|-------|---------------------|
| `src/index.ts` | 1 | `main()` -- startup orchestrator, event wiring |
| `src/config/` | 2 | `env.ts` (Zod env), `trading.ts` (Zod config + getRuntimeConfig) |
| `src/core/` | 3 | `RpcManager`, `ResilientWebSocket`, `logger` |
| `src/detection/` | 4 | `DetectionManager`, `PumpPortalListener`, `RaydiumListener`, `preFilter` |
| `src/safety/` | 7 | `SafetyPipeline`, 5 check modules, `SafetyCache`, `Blocklist` |
| `src/execution/` | 9 | `ExecutionEngine`, `JupiterClient`, `broadcaster`, 4 sellers, 2 buyers |
| `src/position/` | 1 | `PositionManager` |
| `src/persistence/` | 2 | `TradeStore`, `schema.ts` |
| `src/recovery/` | 1 | `RecoveryManager` |
| `src/dashboard/` | 5 | `dashboard-server`, `bot-event-bus`, `auth`, 3 route modules |
| `dashboard/src/` | 8 | `App`, `Sidebar`, `LiveFeed`, `Performance`, `Settings`, `PnlChart`, `FeedCard`, stores |
| `src/types/` | 1 | Shared interfaces and type unions |

## v1.1 Integration Analysis

Each v1.1 improvement area is analyzed for: what existing code it touches, what new components are needed, what data flows change, and what the integration risk is.

### 1. Security Fixes (BUGS.md Findings)

**Integration type: MODIFY existing code, no new components.**

All four security findings are surgical fixes to existing modules. No new architectural components needed.

#### 1a. SQL Injection Risk (trade-store.ts)

**What changes:** The `stmtGetNonTerminal` query uses `NON_TERMINAL_STATES.map(() => '?').join(',')` to generate placeholder count. This is actually safe because the values are hardcoded constants, not user input. However, the trade history endpoint in `routes/trades.ts` uses raw SQL template literals (`db.prepare(...)` with inline string interpolation in the `WHERE` clause). Verify and parametrize any template-literal SQL.

**Touches:** `src/persistence/trade-store.ts` (audit), `src/dashboard/routes/trades.ts` (fix inline SQL if needed)
**Risk:** LOW -- better-sqlite3 prepared statements are already used everywhere except the dashboard stats/history queries that access `db` directly via type-cast escape hatch.

#### 1b. API Key in URL (tier3-creator.ts:112)

**What changes:** Line 112 passes `api-key=${heliusApiKey}` as a URL query parameter. Move to `x-api-key` header or Authorization header per Helius API docs.

**Touches:** `src/safety/checks/tier3-creator.ts` -- single fetch call
**Risk:** LOW -- one-line change to move API key from URL param to request header.

#### 1c. Unvalidated Config Endpoint (config.ts)

**What changes:** The config route already has `ConfigPatchSchema` Zod validation on POST. The audit finding may refer to the `patchRuntimeConfig()` function accepting `Partial<TradingConfig>` without re-validating the merged result through `TradingConfigSchema`. Add full-schema validation of the merged config before applying.

**Touches:** `src/config/trading.ts` (`patchRuntimeConfig`), `src/dashboard/routes/config.ts`
**Risk:** LOW -- validation already exists partially; tighten it.

#### 1d. Dependency Vulnerabilities

**What changes:** Run `npm audit fix` and update vulnerable packages. No architectural impact.

**Touches:** `package.json`, `package-lock.json`
**Risk:** LOW -- unless a major version bump is required for a core dependency.

### 2. Safety Pipeline Audit & Improvement

**Integration type: MODIFY existing checks + ADD new check modules.**

The safety pipeline (`SafetyPipeline.evaluate()`) has a clean tier-based architecture that supports adding new checks without modifying the orchestrator.

#### 2a. Existing Check Accuracy Audit

**What changes:** Review and calibrate each existing check's scoring, thresholds, and edge cases.

**Touches:**
- `tier1-authority.ts` -- verify correct handling of Token-2022 authority semantics
- `tier1-sell-route.ts` -- verify pumpportal skip logic still correct for current Jupiter behavior
- `tier2-rugcheck.ts` -- verify RugCheck API response format hasn't changed, score inversion correct
- `tier2-holder.ts` -- verify top-holder thresholds are effective (check false positive/negative rates)
- `tier3-creator.ts` -- verify Helius transaction type filter and mint count heuristic
- `safety-pipeline.ts` -- verify aggregate score weights produce good discrimination

**Risk:** MEDIUM -- scoring calibration requires real trade data analysis to validate.

#### 2b. New Safety Checks (if gaps identified)

**Architecture impact:** The pipeline's parallel execution pattern (`Promise.allSettled`) makes adding checks straightforward:

```
Current Tier 2 parallel group:
  [checkRugCheck, checkHolderConcentration, checkCreatorHistory]

To add a new check (e.g., LP lock check, metadata mutability):
  1. Create src/safety/checks/tier2-newcheck.ts exporting async function
  2. Import in safety-pipeline.ts
  3. Add to the Promise.allSettled array in evaluate()
  4. Add weight to SafetyWeightsSchema in config/trading.ts
  5. Update aggregate score calculation
```

**New files (potential):**
- `src/safety/checks/tier1-lp-lock.ts` -- LP burn/lock verification (SAF-10 from v2 backlog)
- `src/safety/checks/tier1-metadata.ts` -- isMutable flag check (SAF-11 from v2 backlog)

**Key constraint:** New Tier 1 checks add latency to the critical path (Promise.all, blocking). New Tier 2/3 checks run in parallel with timeout, so latency impact is bounded.

**Touches:** `src/safety/safety-pipeline.ts`, `src/config/trading.ts` (new weight config), new check files
**Risk:** MEDIUM -- adding checks is architecturally simple, but calibrating weights across all checks requires empirical data.

### 3. Buy Execution Performance

**Integration type: MODIFY existing execution path, potentially ADD priority fee adaptation.**

#### 3a. Faster Transaction Landing

**What changes:** The buy path is: `index.ts` event handler -> `executionEngine.buy()` -> `pumpPortalBuy()` or `jupiterBuy()` -> `broadcastAndConfirm()`. Improvements target:
- Priority fee tuning in `broadcaster.ts` (currently static `priorityFeeBaseLamports * multiplier`)
- Blockhash freshness (already optimal -- fetched last before signing)
- Transaction size optimization (reduce compute budget, use address lookup tables)

**New component (potential):**
- `src/execution/priority-fee-estimator.ts` -- queries recent block priority fees to dynamically set compute unit price. This is OPT-03 from the v2 backlog, but a simplified version could significantly improve landing rates.

**Data flow change:** `broadcastAndConfirm()` currently receives a pre-built transaction. If priority fee estimation is added, the fee estimator must run AFTER Jupiter quote (to know compute budget) but BEFORE transaction signing. The call sequence becomes:

```
Current:  jupiterBuy -> broadcastAndConfirm(tx, wallet, connections)
Proposed: jupiterBuy -> estimatePriorityFee(tx) -> modifyComputeBudget(tx, fee) -> broadcastAndConfirm(tx, wallet, connections)
```

**Touches:** `src/execution/broadcaster.ts`, `src/execution/buy/jupiter-buyer.ts`, `src/execution/buy/pump-portal-buyer.ts`, new fee estimator
**Risk:** MEDIUM -- priority fee estimation adds an RPC call to the latency-critical buy path. Must be fast (<50ms) or use cached recent-block data.

#### 3b. PumpPortal Buy Optimization

**What changes:** Currently uses PumpPortal's trade-local API (0.5% fee). Direct Pump.fun program calls (OPT-01) would bypass this fee. However, this is a significant implementation effort and likely out of v1.1 scope per the "hardening" focus.

**Lighter alternative:** Optimize the existing PumpPortal path -- connection reuse, pre-warmed WebSocket for buy submission, compute budget tuning.

**Risk:** LOW for optimization of existing path; HIGH for direct program calls (new architecture).

### 4. Sell Execution Performance

**Integration type: MODIFY sell ladder and position manager.**

#### 4a. Smarter Sell Timing

**What changes:** Currently, `PositionManager.evaluatePosition()` checks exit triggers every `pollIntervalMs` (default 5s). Improvements:
- More responsive trailing stop (shorter poll interval when price is near trigger)
- Adaptive poll frequency based on position age and proximity to exit triggers

**Touches:** `src/position/position-manager.ts` (`scheduleTick`, `evaluatePosition`)
**Risk:** LOW -- behavioral tuning within existing code, no architectural change.

#### 4b. Better Price Outcomes / Reduced Slippage

**What changes:** The sell ladder's 6 steps use fixed slippage values from config. Improvements:
- Dynamic slippage calculation based on token liquidity (Jupiter quote provides route info)
- Better step timeout tuning (current defaults may advance too fast or too slow)
- Consider slippage estimation before committing to a sell step

**Touches:** `src/execution/sell/sell-ladder.ts`, `src/execution/sell/standard-seller.ts`, config
**Risk:** LOW -- parameter tuning within existing ladder architecture.

#### 4c. Sell Ladder Observability

**What changes:** Currently the sell ladder logs each step but doesn't emit structured events for each step attempt/failure. Adding per-step BotEventBus events would give the dashboard visibility into sell progression.

**New event types:**
```typescript
// Add to BotEventType:
| 'SELL_STEP_STARTED'   // emitted when each ladder step begins
| 'SELL_STEP_FAILED'    // emitted when a step fails/times out
```

**Touches:** `src/dashboard/bot-event-bus.ts` (types), `src/execution/sell/sell-ladder.ts` (emit events)
**Risk:** LOW -- additive change, no existing behavior modified.

### 5. Dashboard Overhaul

**Integration type: ADD new API routes + MODIFY frontend components + ADD new frontend views.**

#### 5a. Better Analytics

**What changes:** The existing `/api/stats` and `/api/trades/history` endpoints provide basic stats. Improvements:
- Time-series P&L data (daily/weekly aggregation)
- Safety pipeline stats (pass rate, rejection reasons breakdown)
- Detection stats (tokens seen, sources, detection latency)

**New API routes:**
- `GET /api/analytics/pnl` -- time-bucketed P&L series for chart
- `GET /api/analytics/safety` -- safety pipeline statistics
- `GET /api/analytics/detection` -- detection statistics

**Backend touches:** New route file `src/dashboard/routes/analytics.ts`, registered in `dashboard-server.ts`
**Frontend touches:** New `Analytics.tsx` component, new view in `Sidebar.tsx`
**Data source:** All from existing SQLite data + in-memory stats from `DetectionManager` and `SafetyPipeline`. Need to expose stats getters from these classes.

**Risk:** MEDIUM -- analytics queries on SQLite need to be efficient to avoid blocking the event loop. Use pre-computed aggregations or read replicas if needed.

#### 5b. Live Pipeline Visibility

**What changes:** Show the safety pipeline's real-time decisions (token detected -> checks running -> pass/reject) in the dashboard.

**Architecture approach:** The BotEventBus already receives TOKEN_DETECTED events. Extend to emit safety check progress:

```typescript
// New event types for pipeline visibility:
| 'SAFETY_STARTED'     // safety pipeline evaluation began
| 'SAFETY_CHECK_DONE'  // individual check completed (tier1/tier2/tier3)
| 'SAFETY_PASSED'      // token passed safety pipeline
| 'SAFETY_REJECTED'    // token rejected
```

**Touches:** `src/safety/safety-pipeline.ts` (add botEventBus.emit calls), `src/dashboard/bot-event-bus.ts` (new event types), dashboard frontend (new pipeline visualization component)
**Risk:** LOW -- additive events. Must not add meaningful latency to the safety pipeline critical path (emit is synchronous but EventEmitter3 dispatch is fast).

#### 5c. Operational Controls

**What changes:** Dashboard controls for:
- Pause/resume detection (stop accepting new tokens without full shutdown)
- Force-sell a position
- Manual buy trigger
- Emergency stop-all

**Architecture impact:** These require WRITE operations from dashboard to trading logic, which currently only flows one way (dashboard reads, bot writes). The config endpoint already establishes the pattern -- `patchRuntimeConfig()` modifies runtime behavior. Extend this:

```
New endpoints:
  POST /api/controls/pause-detection    -> DetectionManager.pause()
  POST /api/controls/resume-detection   -> DetectionManager.resume()
  POST /api/controls/force-sell/:mint   -> PositionManager.forceSell(mint)
  POST /api/controls/emergency-stop     -> sets global halt flag
```

**Touches:** New route file `src/dashboard/routes/controls.ts`, modifications to `DetectionManager` (add pause/resume), `PositionManager` (add forceSell), `index.ts` (add halt flag)
**Risk:** MEDIUM -- introducing write paths from dashboard to trading logic breaks the "dashboard is read-only observer" pattern. Must be carefully gated with confirmation and validation. The `forceSell` path is especially risky -- must go through the same sell ladder, not bypass it.

### 6. Reliability Improvements

**Integration type: MODIFY existing infrastructure + ADD monitoring layer.**

#### 6a. RPC Failover Hardening

**What changes:** Current `RpcManager` tracks consecutive failures and switches to backup after 3 failures. Improvements:
- Per-call latency tracking (detect degraded-but-not-dead primary)
- Smarter recovery (don't just check getSlot -- check actual endpoint health)
- Connection-level health monitoring (WebSocket subscription staleness detection is already good in `ResilientWebSocket`, but RPC HTTP calls have no equivalent)
- Expose RPC health status to dashboard

**New component (potential):**
- `src/core/rpc-health.ts` -- periodic health check with latency tracking, exposed via API

**Touches:** `src/core/rpc-manager.ts`, new health module, `src/dashboard/routes/` (new status endpoint)
**Risk:** LOW -- observability improvements don't affect the hot path.

#### 6b. Better Crash Recovery

**What changes:** Current `RecoveryManager` handles the five states well. Improvements:
- Recovery audit logging (structured report of what was recovered and how)
- Dashboard notification of recovery actions on startup
- Periodic self-check: verify in-memory state matches SQLite state

**Touches:** `src/recovery/recovery-manager.ts`, `src/dashboard/bot-event-bus.ts` (recovery events)
**Risk:** LOW -- additive improvements to existing recovery flow.

#### 6c. Surfacing Silent Failures

**What changes:** Several failure modes are currently logged but not surfaced to the dashboard:
- Jupiter rate limiting (JupiterClient logs warning, but dashboard doesn't show it)
- RPC failover events (RpcManager emits events, but they don't reach BotEventBus)
- Detection WebSocket reconnections (ResilientWebSocket logs, but dashboard is unaware)
- Position monitoring failures (tick errors logged but not surfaced)

**Architecture approach:** Bridge existing component-level events to the BotEventBus:

```typescript
// In index.ts, after component initialization:
rpcManager.on('failover', (data) => {
  botEventBus.emit('event', { type: 'SYSTEM_ALERT', mint: '', ts: Date.now(), detail: `RPC failover: ${data.reason}` });
});
```

**New event types:**
```typescript
| 'SYSTEM_ALERT'       // RPC failover, rate limit, WebSocket reconnect
| 'SYSTEM_RECOVERY'    // RPC recovered, rate limit lifted
```

**Touches:** `src/index.ts` (bridge wiring), `src/dashboard/bot-event-bus.ts` (new types), `src/execution/jupiter-client.ts` (emit on rate limit), dashboard frontend (alert display)
**Risk:** LOW -- all additive, no existing behavior changed.

#### 6d. Monitoring & Alerting

**What changes:** No external alerting exists. Improvements:
- Health check endpoint (`GET /api/health`) returning structured status
- Optional webhook alerting for critical events (stuck positions, daily loss exceeded, RPC down)

**New components:**
- `src/dashboard/routes/health.ts` -- health check endpoint
- `src/core/alerter.ts` (optional) -- webhook dispatcher for critical events

**Touches:** New route, potentially new alerter module, `dashboard-server.ts` (register route)
**Risk:** LOW for health endpoint; MEDIUM for webhook alerter (new external dependency).

## New Components Summary

| Component | Type | Purpose | Depends On |
|-----------|------|---------|------------|
| `src/safety/checks/tier1-lp-lock.ts` | NEW | LP burn/lock verification | Connection (RPC) |
| `src/safety/checks/tier1-metadata.ts` | NEW | Metadata mutability check | Connection (RPC) |
| `src/execution/priority-fee-estimator.ts` | NEW | Dynamic priority fee from recent blocks | Connection (RPC) |
| `src/dashboard/routes/analytics.ts` | NEW | Time-series P&L, safety stats, detection stats | TradeStore, DetectionManager, SafetyPipeline |
| `src/dashboard/routes/controls.ts` | NEW | Pause/resume, force-sell, emergency stop | DetectionManager, PositionManager |
| `src/dashboard/routes/health.ts` | NEW | Structured health check | RpcManager, TradeStore, DetectionManager |
| `src/core/rpc-health.ts` | NEW | RPC latency tracking and health scoring | RpcManager |
| `dashboard/src/components/Analytics.tsx` | NEW | Analytics dashboard view | API routes |
| `dashboard/src/components/PipelineView.tsx` | NEW | Real-time safety pipeline visualization | SSE events |
| `dashboard/src/components/Controls.tsx` | NEW | Operational controls UI | API routes |
| `dashboard/src/components/SystemStatus.tsx` | NEW | RPC health, rate limits, alerts | SSE events + API |

## Modified Components Summary

| Component | Change Type | What Changes |
|-----------|-------------|--------------|
| `src/persistence/trade-store.ts` | AUDIT | Verify all SQL is parameterized |
| `src/dashboard/routes/trades.ts` | FIX | Parameterize raw SQL in history/stats queries |
| `src/safety/checks/tier3-creator.ts` | FIX | Move API key from URL to header |
| `src/config/trading.ts` | HARDEN | Full-schema validation of merged config in patchRuntimeConfig |
| `src/safety/safety-pipeline.ts` | MODIFY | Add new checks to parallel groups, emit pipeline visibility events |
| `src/execution/broadcaster.ts` | MODIFY | Integrate priority fee estimator |
| `src/execution/buy/*.ts` | MODIFY | Apply priority fee, optimize transaction params |
| `src/execution/sell/sell-ladder.ts` | MODIFY | Emit per-step events, improve slippage handling |
| `src/position/position-manager.ts` | MODIFY | Adaptive poll intervals, forceSell method |
| `src/detection/detection-manager.ts` | MODIFY | Add pause/resume methods, expose stats getters |
| `src/core/rpc-manager.ts` | MODIFY | Latency tracking, smarter recovery logic |
| `src/dashboard/bot-event-bus.ts` | MODIFY | Add new event types (SAFETY_*, SYSTEM_*, SELL_STEP_*) |
| `src/dashboard/dashboard-server.ts` | MODIFY | Register new route modules |
| `src/index.ts` | MODIFY | Bridge component events to BotEventBus |
| `dashboard/src/app.tsx` | MODIFY | Add new views to navigation |
| `dashboard/src/components/Sidebar.tsx` | MODIFY | Add analytics, controls, system status tabs |

## Data Flow Changes

### New: Component Events -> BotEventBus Bridge (index.ts)

Currently only execution and safety modules emit to BotEventBus. v1.1 bridges infrastructure events:

```
RpcManager.on('failover')      --> botEventBus.emit('SYSTEM_ALERT')
RpcManager.on('recovered')     --> botEventBus.emit('SYSTEM_RECOVERY')
JupiterClient rate limit       --> botEventBus.emit('SYSTEM_ALERT')
SafetyPipeline check progress  --> botEventBus.emit('SAFETY_*')
SellLadder step progress       --> botEventBus.emit('SELL_STEP_*')
```

### New: Dashboard -> Trading Logic Write Path (controls)

Currently dashboard is read-only (except config PATCH). v1.1 adds:

```
POST /api/controls/*  -->  Fastify route handler  -->  Component method call
                                                       (DetectionManager.pause(),
                                                        PositionManager.forceSell(),
                                                        global halt flag)
```

**Constraint:** Write operations must be idempotent and emit BotEventBus events so the dashboard SSE reflects the action.

### New: Analytics Aggregation Path

```
TradeStore (SQLite)  -->  /api/analytics/*  -->  Pre-aggregated time-series data
DetectionManager.stats  -->  /api/analytics/detection
SafetyPipeline.stats (new getter)  -->  /api/analytics/safety
```

**Constraint:** Analytics queries must not block the event loop. Use SQLite prepared statements, pre-compute aggregations where possible. The current `trades.ts` pattern of casting `(tradeStore as any).db` to access raw SQLite is an escape hatch that should be formalized with a proper analytics query interface on TradeStore.

## Suggested Build Order

Based on dependency analysis and risk assessment, here is the recommended phase ordering for v1.1:

### Phase 1: Security Fixes

**Rationale:** Fix known vulnerabilities before any feature work. These are surgical changes with minimal architectural impact.

1. SQL injection audit and fix in trades.ts (parameterize raw queries)
2. Move Helius API key from URL to header in tier3-creator.ts
3. Full-schema validation in patchRuntimeConfig()
4. Dependency vulnerability audit and update
5. Test all fixes

**Dependencies:** None -- standalone fixes.
**Risk:** LOW

### Phase 2: Safety Pipeline Audit & Enhancement

**Rationale:** Safety accuracy directly affects profitability. Must be done before execution optimization because better safety filtering reduces wasted execution attempts.

1. Audit existing check accuracy against real trade data
2. Calibrate scoring weights and thresholds
3. Add LP lock/burn check (if gap identified)
4. Add metadata mutability check (if gap identified)
5. Add safety pipeline event emissions (SAFETY_STARTED, SAFETY_PASSED, etc.)

**Dependencies:** Phase 1 (security fixes for Helius API key affect tier3-creator)
**Risk:** MEDIUM -- calibration needs data-driven approach.

### Phase 3: Execution Performance

**Rationale:** Improved execution benefits from Phase 2's better filtering (fewer wasted buys).

1. Priority fee estimator implementation
2. Buy path integration (modify broadcaster/buyers)
3. Sell ladder per-step event emissions
4. Sell slippage optimization
5. Position manager adaptive polling

**Dependencies:** Phase 2 (safety pipeline events establish the BotEventBus extension pattern)
**Risk:** MEDIUM -- priority fee estimation adds RPC call to critical path.

### Phase 4: Reliability & Monitoring

**Rationale:** Infrastructure hardening should be stable before dashboard exposes it.

1. RPC health tracking module
2. RpcManager latency monitoring and smarter recovery
3. Component event -> BotEventBus bridge in index.ts
4. Health check endpoint
5. Recovery manager improvements

**Dependencies:** Phase 3 (sell ladder events are bridged in same wiring pass)
**Risk:** LOW

### Phase 5: Dashboard Overhaul

**Rationale:** Dashboard depends on all the new events and endpoints from previous phases.

1. Formalize TradeStore analytics query interface
2. Analytics API routes
3. Controls API routes (pause/resume, force-sell)
4. Health/status API route
5. Frontend: Analytics view
6. Frontend: Pipeline visibility view
7. Frontend: Controls panel
8. Frontend: System status display

**Dependencies:** Phases 2-4 (new events, stats getters, control methods)
**Risk:** MEDIUM -- controls introduce dashboard->trading write path.

### Build Order Rationale

```
Phase 1 (Security)  -- no deps, blocks nothing, highest urgency
    |
    v
Phase 2 (Safety)    -- depends on Phase 1 API key fix
    |
    v
Phase 3 (Execution) -- benefits from Phase 2 filtering
    |
    v
Phase 4 (Reliability) -- builds on Phase 3 events, stabilizes infra
    |
    v
Phase 5 (Dashboard)  -- consumes all previous phases' new APIs/events
```

**Why security first:** Vulnerabilities should be fixed before adding new surface area.
**Why safety before execution:** Better filtering means fewer wasted buys. Execution optimization on top of bad filtering wastes effort.
**Why reliability before dashboard:** Dashboard should expose stable monitoring, not unstable half-implemented metrics.
**Why dashboard last:** It consumes everything -- new events, new API routes, new control methods. Building it first means reworking it as each feature lands.

## Anti-Patterns to Avoid in v1.1

### Anti-Pattern: Dashboard Direct Component Access

**What:** Having dashboard route handlers import and call trading components directly (e.g., importing SellLadder in a route handler).

**Why bad:** Creates bidirectional coupling. Dashboard becomes a dependency of trading logic, breaking the observer pattern.

**Instead:** Route handlers call well-defined methods on components passed via plugin options (same pattern as `tradesRoute` receiving `tradeStore`). Components are injected at server creation time in `createDashboardServer()`.

### Anti-Pattern: Analytics Queries in Hot Path

**What:** Running complex SQL aggregations synchronously on every dashboard poll.

**Why bad:** better-sqlite3 is synchronous. A 100ms aggregation query blocks the event loop, delaying buy execution.

**Instead:** Pre-compute aggregations on a timer (every 30-60s) and cache the result. Dashboard reads the cached aggregation. Or use a separate read-only SQLite connection (WAL mode supports concurrent readers).

### Anti-Pattern: Exposing Raw TradeStore.db

**What:** The current `routes/trades.ts` casts `(tradeStore as any).db` to access raw SQLite for stats queries.

**Why bad:** Bypasses TradeStore's abstraction. Any schema change breaks these queries silently. No type safety on query results.

**Instead:** Add proper public methods to TradeStore for analytics queries: `getTradeHistory(limit)`, `getAggregateStats()`, `getPnlTimeSeries(fromTs, toTs, bucket)`. Keep raw SQL inside TradeStore.

### Anti-Pattern: Unbounded Event Bus History

**What:** Keeping all emitted BotEventBus events in memory for new SSE clients to replay.

**Why bad:** Memory leak proportional to bot uptime.

**Instead:** SSE clients receive events from connection time forward (current behavior -- correct). For historical data, dashboard fetches from REST API on mount. Do not add event replay.

## Scalability Impact of v1.1

| Change | Impact on Throughput | Impact on Latency | Mitigation |
|--------|---------------------|-------------------|------------|
| New safety checks (LP lock, metadata) | None (parallel) | +50-100ms worst case if Tier 1 | Add to Tier 2 group with timeout |
| Priority fee estimation | None | +20-50ms on buy path | Cache recent fee data, 2s TTL |
| Per-step sell events | None | Negligible (sync emit) | N/A |
| Safety pipeline events | None | Negligible (sync emit) | N/A |
| Analytics SQL queries | Blocks event loop during query | 0 on hot path (separate route) | Pre-compute + cache |
| Dashboard controls | None on hot path | N/A | Idempotent, validated |
| RPC health tracking | +1 RPC call / 10s | None on hot path | Runs on timer, not in trade flow |

## Confidence Assessment

| Aspect | Confidence | Basis |
|--------|-----------|-------|
| Security fixes are surgical | HIGH | Read all 4 affected files, changes are isolated |
| Safety pipeline extensibility | HIGH | Verified: Promise.allSettled pattern supports adding checks |
| BotEventBus extension for new events | HIGH | Existing pattern works, just adding new type literals |
| Dashboard controls architecture | MEDIUM | Write path from dashboard to trading is new; needs careful design |
| Priority fee estimation feasibility | MEDIUM | Standard pattern in Solana ecosystem, but adds latency to critical path |
| Analytics query performance | MEDIUM | SQLite can handle aggregations, but must not block event loop |
| Build order correctness | HIGH | Dependency graph analysis from actual code imports |

## Sources

- Direct codebase analysis of all source files listed in Module Map above
- BUGS.md security audit findings (4 validated findings)
- PROJECT.md v1.1 milestone scope definition
- REQUIREMENTS.md v2 backlog items (SAF-10, SAF-11, OPT-01, OPT-03)
- v1.0 architecture patterns validated across 16 phases and 243 commits

---

*Architecture research for v1.1: 2026-03-27*
